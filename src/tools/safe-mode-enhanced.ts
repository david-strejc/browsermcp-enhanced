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
    try {
      const response = await context.sendSocketMessage("js.execute", {
        method: 'setInput',
        args: [selector, value, { pressEnter }],
        timeout: 5000
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
    try {
      await context.sendSocketMessage("js.execute", {
        method: 'scroll',
        args: [{ to, steps, delayMs, smooth }],
        timeout: (steps * delayMs) + 5000
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
    try {
      const response = await context.sendSocketMessage("js.execute", {
        method: 'waitFor',
        args: [selector, { timeoutMs, visible, intervalMs }],
        timeout: timeoutMs + 1000
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
    name: 'browser_extract_html',
    description: 'Extract HTML content, attributes, collect links, or schema-based extraction',
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['simple', 'links', 'schema', 'html'],
          description: 'Query mode: simple (attrs), links (collect), schema (structured), html (inner/outer HTML)',
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
        },
        outer: {
          type: 'boolean',
          description: 'HTML mode: Get outer HTML (includes element) vs inner HTML',
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
      includeHidden = false,
      outer = false
    } = params;

    let method: string;
    let args: any[];

    if (mode === 'html') {
      // HTML extraction mode
      method = outer ? 'getOuterHTML' : 'getHTML';
      args = [selector];
    } else if (mode === 'links') {
      // Links collection mode
      method = 'extractLinks';
      args = [selector || 'body', { hrefContains, textContains, exclude, unique, limit }];
    } else if (mode === 'schema' && schema) {
      // Schema-based extraction mode
      method = 'extractSchema';
      args = [selector, schema, limit];
    } else {
      // Simple attribute extraction mode
      method = 'query';
      args = [selector, { attrs, limit, includeHidden }];
    }

    try {
      const response = await context.sendSocketMessage("js.execute", {
        method,
        args,
        timeout: 10000
      }, { timeoutMs: 10500 });
      const result = response.result;

      if (mode === 'simple') {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              elements: result,
              count: result?.length || 0
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

// Get HTML content (merged into browserQuery with mode='html')
// Commented out - functionality moved to browserQuery
/*
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
*/

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
    try {
      const response = await context.sendSocketMessage("js.execute", {
        method: 'fillForm',
        args: [formSelector, fields],
        timeout: 5000
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

// Dismiss overlays tool - REMOVED as requested
/*
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
*/