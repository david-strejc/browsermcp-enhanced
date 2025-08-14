import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod";
import type { Context } from "../context";
import type { Tool } from "./tool";

// Define the tool schema
const ElementFinderTool = z.object({
  name: z.literal("browser_find_element"),
  description: z.literal("Find elements and get their refs for use with high-level tools (browser_click, browser_type, etc.). This bridges the gap between seeing elements and interacting with them properly. Returns refs that can be used with interaction tools."),
  arguments: z.object({
    strategy: z.enum(["text", "css", "attribute", "aria", "placeholder"])
      .describe("Strategy to find element"),
    value: z.string().describe("Value to search for based on strategy"),
    nth: z.number().optional().default(0).describe("If multiple matches, which one to return (0-based index)"),
    parent_selector: z.string().optional().describe("Optional parent container to search within"),
    return_all: z.boolean().optional().default(false).describe("Return all matching elements instead of just one")
  })
});

// Find element tool - returns refs for high-level tools
export const findElement: Tool = {
  schema: {
    name: ElementFinderTool.shape.name.value,
    description: ElementFinderTool.shape.description.value,
    inputSchema: zodToJsonSchema(ElementFinderTool.shape.arguments),
  },
  handle: async (context: Context, params) => {
    const validatedParams = ElementFinderTool.shape.arguments.parse(params || {});
    
    // Build the search code based on strategy
    let searchCode = '';
    const { strategy, value, nth, parent_selector, return_all } = validatedParams;
    
    switch (strategy) {
      case 'text':
        searchCode = `
          const elements = Array.from(document.querySelectorAll('*')).filter(el => {
            const text = el.textContent || el.innerText || '';
            return text.includes('${value}') && 
                   el.children.length === 0; // Leaf nodes only
          });
        `;
        break;
        
      case 'css':
        searchCode = `
          const elements = Array.from(document.querySelectorAll('${value}'));
        `;
        break;
        
      case 'attribute':
        const [attr, attrValue] = value.split('=');
        searchCode = `
          const elements = Array.from(document.querySelectorAll('[${attr}="${attrValue}"]'));
        `;
        break;
        
      case 'aria':
        searchCode = `
          const elements = Array.from(document.querySelectorAll('[aria-label*="${value}"], [aria-describedby*="${value}"]'));
        `;
        break;
        
      case 'placeholder':
        searchCode = `
          const elements = Array.from(document.querySelectorAll('[placeholder*="${value}"]'));
        `;
        break;
    }
    
    // Add parent filtering if specified
    if (parent_selector) {
      searchCode = `
        const parent = document.querySelector('${parent_selector}');
        if (!parent) {
          return { error: 'Parent selector not found' };
        }
        ${searchCode}
        const filtered = elements.filter(el => parent.contains(el));
        const elements = filtered;
      `;
    }
    
    // Generate refs for found elements
    const fullCode = `
      ${searchCode}
      
      if (elements.length === 0) {
        return { 
          found: false, 
          message: 'No elements found matching criteria',
          strategy: '${strategy}',
          value: '${value}'
        };
      }
      
      // Generate refs for elements
      const results = elements.map((el, index) => {
        // Try to generate a stable ref
        let ref = '';
        
        // Priority 1: ID
        if (el.id) {
          ref = '#' + el.id;
        }
        // Priority 2: Unique class combination
        else if (el.className) {
          ref = '.' + el.className.split(' ').join('.');
        }
        // Priority 3: Data attributes
        else if (el.dataset && Object.keys(el.dataset).length > 0) {
          const dataAttr = Object.keys(el.dataset)[0];
          ref = '[data-' + dataAttr + '="' + el.dataset[dataAttr] + '"]';
        }
        // Priority 4: Other attributes
        else if (el.hasAttribute('name')) {
          ref = '[name="' + el.getAttribute('name') + '"]';
        }
        // Priority 5: Tag + position
        else {
          const parent = el.parentElement;
          const siblings = Array.from(parent.children).filter(child => child.tagName === el.tagName);
          const position = siblings.indexOf(el);
          ref = el.tagName.toLowerCase() + ':nth-of-type(' + (position + 1) + ')';
          
          // Add parent context if needed
          if (parent.id) {
            ref = '#' + parent.id + ' > ' + ref;
          }
        }
        
        // Generate a unique ref ID for this session
        const refId = 'ref' + (1000 + index);
        el.setAttribute('data-browsermcp-ref', refId);
        
        return {
          ref: refId,
          selector: ref,
          text: (el.textContent || el.innerText || '').substring(0, 100),
          tagName: el.tagName.toLowerCase(),
          type: el.type || null,
          isVisible: el.offsetParent !== null,
          isInteractive: ['a', 'button', 'input', 'select', 'textarea'].includes(el.tagName.toLowerCase()) ||
                        el.onclick !== null || 
                        el.hasAttribute('onclick') ||
                        el.style.cursor === 'pointer'
        };
      });
      
      ${return_all ? 'return results;' : 'return results[' + nth + '] || results[0];'}
    `;
    
    try {
      console.log(`[Element Finder] Searching for elements with strategy: ${strategy}, value: ${value}`);
      
      // Execute the search
      const response = await context.sendSocketMessage("js.execute", {
        code: fullCode,
        timeout: 3000,
        unsafe: true // Need unsafe to set attributes
      }, { timeoutMs: 3500 });
      
      if (!response.result) {
        return {
          content: [{
            type: "text",
            text: "No elements found"
          }]
        };
      }
      
      // Format the response
      if (response.result.error) {
        return {
          content: [{
            type: "text",
            text: `Error: ${response.result.error}`
          }]
        };
      }
      
      if (response.result.found === false) {
        return {
          content: [{
            type: "text",
            text: response.result.message
          }]
        };
      }
      
      // Success - return the ref(s)
      const results = return_all ? response.result : [response.result];
      let output = `Found ${results.length} element(s):\n\n`;
      
      results.forEach((elem: any, index: number) => {
        output += `Element ${index + 1}:\n`;
        output += `  Ref: ${elem.ref}\n`;
        output += `  Tag: ${elem.tagName}\n`;
        output += `  Text: ${elem.text}\n`;
        output += `  Visible: ${elem.isVisible}\n`;
        output += `  Interactive: ${elem.isInteractive}\n`;
        output += `  CSS Selector: ${elem.selector}\n\n`;
      });
      
      output += `\nUse these refs with high-level tools:\n`;
      output += `- browser_click(ref="${results[0].ref}", element="...")\n`;
      output += `- browser_type(ref="${results[0].ref}", element="...", text="...")\n`;
      
      return {
        content: [{
          type: "text",
          text: output
        }]
      };
      
    } catch (error) {
      console.error('[Element Finder] Error:', error);
      throw error;
    }
  }
};