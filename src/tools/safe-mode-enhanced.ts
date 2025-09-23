import type { Context } from '../context';
import type { Tool } from './tool';

// Enhanced safe-mode input tool - no unsafe mode required
export const browserSetInput: Tool = {
  schema: {
    name: 'browser_set_input',
    description: 'Set input field value with optional Enter key. Eliminates need for unsafe mode for basic input operations.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector for the input element'
        },
        value: {
          type: 'string',
          description: 'Value to set in the input field'
        },
        pressEnter: {
          type: 'boolean',
          description: 'Whether to press Enter after setting the value',
          default: false
        }
      },
      required: ['selector', 'value']
    }
  },
  handle: async (context: Context, { selector, value, pressEnter = false }) => {
    const code = `
      return await api.setInput('${selector}', '${value}', { pressEnter: ${pressEnter} });
    `;

    try {
      const response = await context.sendSocketMessage("js.execute", {
        code: code,
        timeout: 5000,
        unsafe: false
      }, { timeoutMs: 5500 });
      const result = response.result;
      return {
        content: [{
          type: "text",
          text: result ? 'Input set successfully' : 'Failed to set input - element not found or not an input'
        }]
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
};

// Enhanced scrolling tool
export const browserScroll: Tool = {
  schema: {
    name: 'browser_scroll',
    description: 'Advanced scrolling with steps and delays. Perfect for loading virtualized content.',
    inputSchema: {
      type: 'object',
      properties: {
        to: {
          type: ['string', 'number'],
          description: 'Where to scroll: "bottom", "top", selector string, or pixel value',
          default: 'bottom'
        },
        steps: {
          type: 'number',
          description: 'Number of scroll steps (useful for loading dynamic content)',
          default: 1
        },
        delayMs: {
          type: 'number',
          description: 'Delay between scroll steps in milliseconds',
          default: 500
        },
        smooth: {
          type: 'boolean',
          description: 'Use smooth scrolling animation',
          default: true
        }
      }
    }
  },
  handle: async (context: Context, { to = 'bottom', steps = 1, delayMs = 500, smooth = true }) => {
    const code = `
      return await api.scroll({
        to: ${typeof to === 'string' ? `'${to}'` : to},
        steps: ${steps},
        delayMs: ${delayMs},
        smooth: ${smooth}
      });
    `;

    try {
      await context.sendSocketMessage("js.execute", {
        code: code,
        timeout: (steps * delayMs) + 5000,
        unsafe: false
      }, { timeoutMs: (steps * delayMs) + 5500 });
      return {
        content: [{
          type: "text",
          text: `Scrolled to ${to}`
        }]
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
};

// Wait for element tool
export const browserWaitFor: Tool = {
  schema: {
    name: 'browser_wait_for',
    description: 'Wait for element to appear/become visible. Essential for dynamic content.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector to wait for'
        },
        timeoutMs: {
          type: 'number',
          description: 'Maximum time to wait in milliseconds',
          default: 10000
        },
        visible: {
          type: 'boolean',
          description: 'Wait for element to be visible (not just present in DOM)',
          default: false
        },
        intervalMs: {
          type: 'number',
          description: 'Check interval in milliseconds',
          default: 100
        }
      },
      required: ['selector']
    }
  },
  handle: async (context: Context, { selector, timeoutMs = 10000, visible = false, intervalMs = 100 }) => {
    const code = `
      const el = await api.waitFor('${selector}', {
        timeoutMs: ${timeoutMs},
        visible: ${visible},
        intervalMs: ${intervalMs}
      });
      return el ? true : false;
    `;

    try {
      const response = await context.sendSocketMessage("js.execute", {
        code: code,
        timeout: timeoutMs + 1000,
        unsafe: false
      }, { timeoutMs: timeoutMs + 1500 });
      const result = response.result;
      return {
        content: [{
          type: "text",
          text: result ? `Element found: ${selector}` : `Timeout waiting for: ${selector}`
        }]
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
};

// Query elements with attributes
export const browserQuery: Tool = {
  schema: {
    name: 'browser_extract',
    description: 'Get attrs/text, collect links, or schema-based data from matched nodes',
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['simple', 'links', 'schema'],
          description: 'Query mode: simple (extract attributes), links (collect links), schema (structured extraction)',
          default: 'simple'
        },
        selector: {
          type: 'string',
          description: 'CSS selector to query (for simple mode) or container selector (for schema/links mode)'
        },
        attrs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Simple mode: Attributes to extract from elements',
          default: ['textContent', 'href', 'value']
        },
        schema: {
          type: 'object',
          description: 'Schema mode: Extraction schema mapping field names to selectors',
          additionalProperties: {
            type: 'object',
            properties: {
              selector: { type: 'string' },
              attr: { type: 'string' },
              multiple: { type: 'boolean' }
            }
          }
        },
        hrefContains: {
          type: 'string',
          description: 'Links mode: Filter links where href contains this string'
        },
        textContains: {
          type: 'string',
          description: 'Links mode: Filter links where text contains this string'
        },
        exclude: {
          type: 'array',
          items: { type: 'string' },
          description: 'Links mode: Exclude links containing these strings in href',
          default: []
        },
        unique: {
          type: 'boolean',
          description: 'Links mode: Return only unique URLs',
          default: true
        },
        limit: {
          type: 'number',
          description: 'Maximum number of elements to return',
          default: 100
        },
        includeHidden: {
          type: 'boolean',
          description: 'Include hidden elements',
          default: false
        }
      },
      required: ['selector']
    }
  },
  handle: async (context: Context, params) => {
    const {
      mode = 'simple',
      selector,
      attrs = ['textContent', 'href', 'value'],
      schema,
      hrefContains,
      textContains,
      exclude = [],
      unique = true,
      limit = 100,
      includeHidden = false
    } = params;

    let code = '';

    if (mode === 'links') {
      // Links collection mode
      code = `
        const container = document.querySelector('${selector || 'body'}');
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
    } else if (mode === 'schema' && schema) {
      // Schema-based extraction mode
      code = `
        (function() {
          const containers = Array.from(document.querySelectorAll('${selector}')).slice(0, ${limit});
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
    } else {
      // Simple attribute extraction mode
      code = `
        return api.query('${selector}', {
          attrs: ${JSON.stringify(attrs)},
          limit: ${limit},
          includeHidden: ${includeHidden}
        });
      `;
    }

    try {
      const response = await context.sendSocketMessage("js.execute", {
        code: code,
        timeout: 10000,
        unsafe: mode === 'schema' || mode === 'links'
      }, { timeoutMs: 10500 });
      const result = response.result;

      if (mode === 'simple') {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              elements: result,
              count: result.length
            }, null, 2)
          }]
        };
      } else {
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      }
    } catch (error: any) {
      return {
        content: [{
          type: "text",
          text: `Error: ${error.message}`
        }],
        isError: true
      };
    }
  }
};

// Get HTML content (merged inner/outer)
export const browserGetHtml: Tool = {
  schema: {
    name: 'browser_get_html',
    description: 'Get HTML content of an element. Can get either inner or outer HTML.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector of the element'
        },
        outer: {
          type: 'boolean',
          description: 'Whether to get outer HTML (includes the element itself) or inner HTML (default: false)',
          default: false
        }
      },
      required: ['selector']
    }
  },
  handle: async (context: Context, { selector, outer = false }) => {
    const code = outer
      ? `return api.getOuterHTML('${selector}');`
      : `return api.getHTML('${selector}');`;

    try {
      const response = await context.sendSocketMessage("js.execute", {
        code: code,
        timeout: 5000,
        unsafe: false
      }, { timeoutMs: 5500 });
      const result = response.result;
      return {
        content: [{
          type: "text",
          text: result || "Element not found"
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: "text",
          text: `Error: ${error.message}`
        }],
        isError: true
      };
    }
  }
};

// Fill form tool
export const browserFillForm: Tool = {
  schema: {
    name: 'browser_fill_form',
    description: 'Fill form fields by name, id, or label text. Smart form filling without unsafe mode.',
    inputSchema: {
      type: 'object',
      properties: {
        formSelector: {
          type: 'string',
          description: 'CSS selector for the form element',
          default: 'form'
        },
        fields: {
          type: 'object',
          description: 'Object mapping field names/ids to values',
          additionalProperties: { type: ['string', 'boolean', 'number'] }
        }
      },
      required: ['fields']
    }
  },
  handle: async (context: Context, { formSelector = 'form', fields }) => {
    const code = `
      return api.fillForm('${formSelector}', ${JSON.stringify(fields)});
    `;

    try {
      const response = await context.sendSocketMessage("js.execute", {
        code: code,
        timeout: 5000,
        unsafe: false
      }, { timeoutMs: 5500 });
      const result = response.result;
      return {
        content: [{
          type: "text",
          text: result ? 'Form filled successfully' : 'Failed to fill form - form not found or no fields matched'
        }]
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
};

// Dismiss overlays tool
export const browserDismissOverlays: Tool = {
  schema: {
    name: 'browser_dismiss_overlays',
    description: 'Dismiss popups, overlays, and modals. Includes common selectors for LinkedIn, cookie banners, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        selectors: {
          type: 'array',
          items: { type: 'string' },
          description: 'Additional selectors to try for dismissing overlays',
          default: []
        }
      }
    }
  },
  handle: async (context: Context, { selectors = [] }) => {
    const code = `
      return api.dismissOverlays(${JSON.stringify(selectors)});
    `;

    try {
      const response = await context.sendSocketMessage("js.execute", {
        code: code,
        timeout: 5000,
        unsafe: false
      }, { timeoutMs: 5500 });
      const result = response.result;
      return {
        content: [{
          type: "text",
          text: `Dismissed ${result} overlay(s)`
        }]
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
};