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
    name: 'browser_query',
    description: 'Query elements and extract specific attributes. Great for batch data extraction.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector to query'
        },
        attrs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Attributes to extract from each element',
          default: ['textContent', 'href', 'value']
        },
        limit: {
          type: 'number',
          description: 'Maximum number of elements to return',
          default: 100
        },
        includeHidden: {
          type: 'boolean',
          description: 'Include hidden elements in results',
          default: false
        }
      },
      required: ['selector']
    }
  },
  handle: async (context: Context, { selector, attrs = ['textContent', 'href', 'value'], limit = 100, includeHidden = false }) => {
    const code = `
      return api.query('${selector}', {
        attrs: ${JSON.stringify(attrs)},
        limit: ${limit},
        includeHidden: ${includeHidden}
      });
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
          text: JSON.stringify({
            success: true,
            elements: result,
            count: result.length
          }, null, 2)
        }]
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
};

// Get HTML content
export const browserGetHtml: Tool = {
  schema: {
    name: 'browser_get_html',
    description: 'Get inner HTML content of an element. Direct access without unsafe mode.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector of the element'
        }
      },
      required: ['selector']
    }
  },
  handle: async (context: Context, { selector }) => {
    const code = `return api.getHTML('${selector}');`;

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

// Get outer HTML content
export const browserGetOuterHtml: Tool = {
  schema: {
    name: 'browser_get_outer_html',
    description: 'Get outer HTML content of an element including the element itself.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector of the element'
        }
      },
      required: ['selector']
    }
  },
  handle: async (context: Context, { selector }) => {
    const code = `return api.getOuterHTML('${selector}');`;

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