import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod";
import type { Context } from "../context";
import type { Tool } from "./tool";

// Define the tool schema
const ExecuteCodeTool = z.object({
  name: z.literal("browser_execute_js"),
  description: z.literal("Execute JavaScript code in the browser. CRITICAL SYNTAX: Always wrap code in IIFE: (function(){ your code here; return result; })() - this prevents 'Illegal return' errors. DIAGNOSTIC TOOL ONLY - use browser_click/browser_type for interactions. Safe mode: use api.$(). Unsafe mode: direct DOM access."),
  arguments: z.object({
    code: z.string().describe(`ALWAYS USE IIFE SYNTAX: (function(){ return api.getText('h1'); })()
      
      SAFE MODE (default) - Use api methods:
      api.$('sel'), api.$$('sel'), api.getText('sel'), api.getValue('sel'), api.exists('sel')
      api.click('sel'), api.setValue('sel','val'), api.hide('sel'), api.scrollTo('sel')
      
      UNSAFE MODE - Direct DOM access:
      (function(){ return document.querySelector('h1').textContent; })()
      Required for: CodeMirror/Monaco/Ace editors, React/Vue internals
      
      COMMON PATTERNS:
      - Check exists: (function(){ return api.exists('selector'); })()
      - Get text: (function(){ return api.getText('h1'); })()
      - CodeMirror: (function(){ return document.querySelector('.CodeMirror').CodeMirror.getValue(); })()
      
      NEVER use bare return statements - always wrap in IIFE!`),
    timeout: z.number().optional().default(5000).describe("Execution timeout in milliseconds"),
    unsafe: z.boolean().optional().describe("Use unsafe mode (requires server/extension configuration)")
  })
});

// Execute JavaScript code tool
export const executeJS: Tool = {
  schema: {
    name: ExecuteCodeTool.shape.name.value,
    description: ExecuteCodeTool.shape.description.value,
    inputSchema: zodToJsonSchema(ExecuteCodeTool.shape.arguments),
  },
  handle: async (context: Context, params) => {
    const validatedParams = ExecuteCodeTool.shape.arguments.parse(params || {});
    
    // Check if unsafe mode is requested
    let useUnsafeMode = validatedParams.unsafe || false;
    
    // Check environment variable for default unsafe mode
    if (!validatedParams.unsafe && process.env.BROWSERMCP_UNSAFE_MODE === 'true') {
      useUnsafeMode = true;
      console.log('[Code Execution] Using unsafe mode from environment variable');
    }
    
    try {
      // Add security logging
      const modeStr = useUnsafeMode ? 'UNSAFE' : 'SAFE';
      console.log(`[Code Execution] Executing ${validatedParams.code.length} chars of code in ${modeStr} mode`);
      
      if (useUnsafeMode) {
        console.warn('⚠️ WARNING: Executing code in UNSAFE mode with full browser access');
      }
      
      // Send to browser for execution
      // Add buffer to account for communication overhead
      const messageTimeout = validatedParams.timeout + 500;
      const response = await context.sendSocketMessage("js.execute", {
        code: validatedParams.code,
        timeout: validatedParams.timeout,
        unsafe: useUnsafeMode
      }, { timeoutMs: messageTimeout });
      
      // Format the result
      let resultText: string;
      if (response.result === undefined || response.result === null) {
        resultText = "Code executed successfully (no return value)";
      } else if (typeof response.result === 'object') {
        resultText = JSON.stringify(response.result, null, 2);
      } else {
        resultText = String(response.result);
      }
      
      return {
        content: [
          {
            type: "text",
            text: resultText,
          },
        ],
      };
    } catch (error: any) {
      // Log security event
      console.error(`[Code Execution] Error:`, error.message);
      
      // Provide helpful hints based on common errors
      let errorMessage = `Execution failed: ${error.message}`;
      let hint = '';
      
      // Check for common issues and provide hints
      if (error.message.includes('Illegal return statement')) {
        hint = '\n\n💡 HINT: In unsafe mode, wrap your code in an IIFE:\n(function() {\n  // your code here\n  return result;\n})();';
      } else if (error.message.includes('SyntaxError') && validatedParams.code.includes('return') && !validatedParams.code.includes('function')) {
        hint = '\n\n💡 HINT: Top-level return statements need a function wrapper. Use:\n(function() { return value; })()';
      } else if (error.message.includes('is not defined') && !useUnsafeMode) {
        hint = '\n\n💡 HINT: In safe mode, use the api object: api.$(selector), api.getText(), etc.\nFor full DOM access, use unsafe: true';
      } else if (error.message.includes('Cannot read properties')) {
        hint = '\n\n💡 HINT: Element might not exist. Check if element exists first:\nconst el = document.querySelector(selector);\nif (el) { /* use element */ }';
      } else if (error.message.includes('api.') && useUnsafeMode) {
        hint = '\n\n💡 HINT: In unsafe mode, use standard DOM APIs directly:\ndocument.querySelector() instead of api.$()';
      }
      
      return {
        content: [
          {
            type: "text",
            text: errorMessage + hint,
          },
        ],
        isError: true,
      };
    }
  },
};

// Helper tool for common operations
const CommonOperationsTool = z.object({
  name: z.literal("browser_common_operation"),
  description: z.literal("Perform common browser operations using pre-built scripts. Includes debugging utilities like popup detection and element validation."),
  arguments: z.object({
    operation: z.enum([
      "hide_popups",
      "remove_ads",
      "extract_all_text",
      "extract_all_links",
      "extract_all_images",
      "highlight_interactive",
      "auto_fill_form",
      "scroll_to_bottom",
      "expand_all_sections"
    ]).describe("The operation to perform"),
    options: z.record(z.any()).optional().describe("Operation-specific options")
  })
});

// Common operations tool
export const commonOperations: Tool = {
  schema: {
    name: CommonOperationsTool.shape.name.value,
    description: CommonOperationsTool.shape.description.value,
    inputSchema: zodToJsonSchema(CommonOperationsTool.shape.arguments),
  },
  handle: async (context: Context, params) => {
    const validatedParams = CommonOperationsTool.shape.arguments.parse(params || {});
    
    // Pre-built scripts for common operations
    const operations: Record<string, string> = {
      hide_popups: `
        (function() {
          // Hide common popup/modal elements
          const popupSelectors = [
            '[class*="modal"]', '[class*="popup"]', '[class*="overlay"]',
            '[class*="dialog"]', '[id*="modal"]', '[id*="popup"]',
            '.cookie-banner', '#cookie-banner', '[class*="cookie"]'
          ];
          let hidden = 0;
          popupSelectors.forEach(selector => {
            hidden += api.hide(selector);
          });
          return { hidden: hidden, message: 'Hidden ' + hidden + ' popup elements' };
        })();
      `,
      
      remove_ads: `
        (function() {
          // Remove common ad elements
          const adSelectors = [
            '[class*="ad-"]', '[class*="ads-"]', '[class*="advertisement"]',
            '[id*="ad-"]', '[id*="ads-"]', 'iframe[src*="doubleclick"]',
            'iframe[src*="googlesyndication"]', '.sponsored', '[data-ad]'
          ];
          let removed = 0;
          adSelectors.forEach(selector => {
            removed += api.hide(selector);
          });
          return { removed: removed, message: 'Removed ' + removed + ' ad elements' };
        })();
      `,
      
      extract_all_text: `
        (function() {
          // Extract all visible text from the page
          const texts = api.$$('p, h1, h2, h3, h4, h5, h6, li, td, th, span, div')
            .map(el => el.textContent?.trim())
            .filter(text => text && text.length > 0);
          return { 
            totalElements: texts.length,
            totalChars: texts.join(' ').length,
            sample: texts.slice(0, 10),
            full: texts.join('\\n')
          };
        })();
      `,
      
      extract_all_links: `
        (function() {
          // Extract all links from the page
          return api.extractLinks('body');
        })();
      `,
      
      extract_all_images: `
        (function() {
          // Extract all images from the page
          const images = api.$$('img').map(img => ({
            src: img.src,
            alt: img.alt || '',
            width: img.width,
            height: img.height
          }));
          return { count: images.length, images: images };
        })();
      `,
      
      highlight_interactive: `
        (function() {
          // Highlight all interactive elements
          const style = document.createElement('style');
          style.textContent = \`
            .mcp-highlight {
              outline: 2px solid red !important;
              outline-offset: 2px !important;
            }
          \`;
          document.head.appendChild(style);
          
          const interactive = api.$$('a, button, input, select, textarea, [role="button"], [onclick]');
          interactive.forEach(el => el.classList.add('mcp-highlight'));
          
          return { 
            highlighted: interactive.length,
            message: 'Highlighted ' + interactive.length + ' interactive elements'
          };
        })();
      `,
      
      auto_fill_form: `
        (function() {
          // Auto-fill form with test data
          const filled = [];
          
          // Fill text inputs
          api.$$('input[type="text"], input:not([type])').forEach((input, i) => {
            const name = input.name || input.id || ('field' + i);
            const selector = input.id ? ('#' + input.id) : ('[name="' + input.name + '"]');
            api.setValue(selector, 'Test ' + name);
            filled.push(name);
          });
          
          // Fill email inputs
          api.$$('input[type="email"]').forEach(input => {
            const selector = input.id ? ('#' + input.id) : ('[name="' + input.name + '"]');
            api.setValue(selector, 'test@example.com');
            filled.push(input.name || input.id);
          });
          
          // Fill tel inputs
          api.$$('input[type="tel"]').forEach(input => {
            const selector = input.id ? ('#' + input.id) : ('[name="' + input.name + '"]');
            api.setValue(selector, '555-0123');
            filled.push(input.name || input.id);
          });
          
          return { filled: filled, count: filled.length };
        })();
      `,
      
      scroll_to_bottom: `
        (async function() {
          // Scroll to the bottom of the page
          window.scrollTo(0, document.body.scrollHeight);
          await api.wait(500);
          return { 
            scrolled: true, 
            height: document.body.scrollHeight,
            message: 'Scrolled to bottom of page'
          };
        })();
      `,
      
      expand_all_sections: `
        (function() {
          // Expand all collapsible sections
          const expanded = [];
          
          // Click all elements with expand-like attributes
          const expandSelectors = [
            '[aria-expanded="false"]',
            '.collapsed',
            '[class*="expand"]',
            '[class*="toggle"]',
            'summary'
          ];
          
          expandSelectors.forEach(selector => {
            api.$$(selector).forEach(el => {
              el.click();
              expanded.push(el.tagName);
            });
          });
          
          return { 
            expanded: expanded.length,
            message: 'Expanded ' + expanded.length + ' sections'
          };
        })();
      `
    };
    
    const code = operations[validatedParams.operation];
    if (!code) {
      throw new Error(`Unknown operation: ${validatedParams.operation}`);
    }
    
    // Execute the pre-built script
    const operationTimeout = 10000; // Longer timeout for complex operations
    const response = await context.sendSocketMessage("js.execute", {
      code: code,
      timeout: operationTimeout
    }, { timeoutMs: operationTimeout + 500 });
    
    // Format the result
    let resultText: string;
    if (typeof response.result === 'object') {
      resultText = JSON.stringify(response.result, null, 2);
    } else {
      resultText = String(response.result);
    }
    
    return {
      content: [
        {
          type: "text",
          text: resultText,
        },
      ],
    };
  },
};