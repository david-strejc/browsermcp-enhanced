import type { Context } from '../context';
import type { Tool } from './tool';

// Batch link collection tool
export const browserCollectLinks: Tool = {
  schema: {
    name: 'browser_collect_links',
    description: 'Efficiently collect links matching criteria. Perfect for crawling and data extraction.',
    inputSchema: {
      type: 'object',
      properties: {
        hrefContains: {
          type: 'string',
          description: 'Filter links where href contains this string'
        },
        textContains: {
          type: 'string',
          description: 'Filter links where text contains this string'
        },
        exclude: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of strings - exclude links containing any of these in href',
          default: []
        },
        containerSelector: {
          type: 'string',
          description: 'Limit search to within this container',
          default: 'body'
        },
        unique: {
          type: 'boolean',
          description: 'Return only unique URLs',
          default: true
        },
        limit: {
          type: 'number',
          description: 'Maximum number of links to return',
          default: 200
        }
      }
    }
  },
  handle: async (context: Context, { hrefContains, textContains, exclude = [], containerSelector = 'body', unique = true, limit = 200 }) => {
    const code = `
      const container = document.querySelector('${containerSelector}');
      if (!container) return { links: [], error: 'Container not found' };

      let links = Array.from(container.querySelectorAll('a[href]'));

      // Apply filters
      ${hrefContains ? `links = links.filter(a => a.href.includes('${hrefContains}'));` : ''}
      ${textContains ? `links = links.filter(a => a.textContent.toLowerCase().includes('${textContains.toLowerCase()}'));` : ''}

      // Apply exclusions
      const excludePatterns = ${JSON.stringify(exclude)};
      if (excludePatterns.length > 0) {
        links = links.filter(a => !excludePatterns.some(pattern => a.href.includes(pattern)));
      }

      // Extract data
      let results = links.slice(0, ${limit}).map(a => ({
        href: a.href,
        text: a.textContent.trim(),
        title: a.title || '',
        target: a.target || '_self'
      }));

      // Make unique if requested
      ${unique ? `
      const seen = new Set();
      results = results.filter(link => {
        if (seen.has(link.href)) return false;
        seen.add(link.href);
        return true;
      });
      ` : ''}

      return { links: results, count: results.length };
    `;

    try {
      const response = await context.sendSocketMessage("js.execute", {
        code: code,
        timeout: 5000,
        unsafe: true
      }, { timeoutMs: 5500 });
      return {
        content: [{
          type: "text",
          text: JSON.stringify(response.result, null, 2)
        }]
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
};

// Batch HEAD request verification tool
export const browserFetchHead: Tool = {
  schema: {
    name: 'browser_fetch_head',
    description: 'Verify multiple URLs with HEAD requests. Check status without full page loads.',
    inputSchema: {
      type: 'object',
      properties: {
        urls: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of URLs to verify'
        },
        throttleMs: {
          type: 'number',
          description: 'Delay between requests in milliseconds',
          default: 300
        },
        timeout: {
          type: 'number',
          description: 'Timeout per request in milliseconds',
          default: 5000
        }
      },
      required: ['urls']
    }
  },
  handle: async (context: Context, { urls, throttleMs = 300, timeout = 5000 }) => {
    if (!urls || urls.length === 0) {
      return {
        content: [{
          type: "text",
          text: "Error: No URLs provided"
        }],
        isError: true
      };
    }

    const code = `
      (async function() {
        const urls = ${JSON.stringify(urls)};
        const results = [];

        for (let i = 0; i < urls.length; i++) {
          const url = urls[i];

          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), ${timeout});

            const response = await fetch(url, {
              method: 'HEAD',
              signal: controller.signal,
              mode: 'no-cors' // Allow cross-origin checks
            });

            clearTimeout(timeoutId);

            results.push({
              url: url,
              status: response.status,
              ok: response.ok,
              redirected: response.redirected,
              finalUrl: response.url
            });
          } catch (error) {
            results.push({
              url: url,
              status: 0,
              ok: false,
              error: error.message
            });
          }

          // Throttle between requests
          if (i < urls.length - 1) {
            await new Promise(r => setTimeout(r, ${throttleMs}));
          }
        }

        return {
          results: results,
          total: urls.length,
          successful: results.filter(r => r.ok).length,
          failed: results.filter(r => !r.ok).length
        };
      })()
    `;

    try {
      const response = await context.sendSocketMessage("js.execute", {
        code: code,
        timeout: (urls.length * (timeout + throttleMs)) + 5000,
        unsafe: true
      }, { timeoutMs: (urls.length * (timeout + throttleMs)) + 5500 });
      return {
        content: [{
          type: "text",
          text: JSON.stringify(response.result, null, 2)
        }]
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
};

// Batch data extraction tool
export const browserExtractData: Tool = {
  schema: {
    name: 'browser_extract_data',
    description: 'Extract structured data from multiple elements. Perfect for scraping tables, lists, cards.',
    inputSchema: {
      type: 'object',
      properties: {
        containerSelector: {
          type: 'string',
          description: 'Selector for container elements to extract from'
        },
        schema: {
          type: 'object',
          description: 'Extraction schema - maps field names to selectors relative to container',
          additionalProperties: {
            type: 'object',
            properties: {
              selector: { type: 'string' },
              attr: { type: 'string' },
              multiple: { type: 'boolean' }
            }
          }
        },
        limit: {
          type: 'number',
          description: 'Maximum number of items to extract',
          default: 100
        }
      },
      required: ['containerSelector', 'schema']
    }
  },
  handle: async (context: Context, { containerSelector, schema, limit = 100 }) => {
    const code = `
      (function() {
        const containers = Array.from(document.querySelectorAll('${containerSelector}')).slice(0, ${limit});
        const schema = ${JSON.stringify(schema)};

        const results = containers.map(container => {
          const item = {};

          for (const [fieldName, config] of Object.entries(schema)) {
            const selector = config.selector || fieldName;
            const attr = config.attr || 'textContent';
            const multiple = config.multiple || false;

            if (multiple) {
              const elements = container.querySelectorAll(selector);
              item[fieldName] = Array.from(elements).map(el => {
                if (attr === 'textContent') {
                  return el.textContent.trim();
                } else {
                  return el.getAttribute(attr) || el[attr];
                }
              });
            } else {
              const element = container.querySelector(selector);
              if (element) {
                if (attr === 'textContent') {
                  item[fieldName] = element.textContent.trim();
                } else {
                  item[fieldName] = element.getAttribute(attr) || element[attr];
                }
              } else {
                item[fieldName] = null;
              }
            }
          }

          return item;
        });

        return {
          data: results,
          count: results.length
        };
      })()
    `;

    try {
      const response = await context.sendSocketMessage("js.execute", {
        code: code,
        timeout: 10000,
        unsafe: true
      }, { timeoutMs: 10500 });
      return {
        content: [{
          type: "text",
          text: JSON.stringify(response.result, null, 2)
        }]
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
};