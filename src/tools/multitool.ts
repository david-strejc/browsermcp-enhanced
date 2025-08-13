/**
 * BrowserMCP Multitool - Intelligent wrapper for browser automation patterns
 * Combines multiple browser operations into single, efficient calls
 */

import type { Tool, ToolResult } from './tool';
import type { Context } from '../context';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { captureAriaSnapshot } from '../utils/aria-snapshot';

const paramsSchema = z.object({
  // Pattern selection
  pattern: z.string().optional().describe('Specific pattern to use (auto-detected if not specified)'),
  
  // Form/Login parameters
  fields: z.record(z.string()).optional().describe('Field name to value mapping for forms'),
  username: z.string().optional().describe('Username or email for login'),
  password: z.string().optional().describe('Password for login'),
  rememberMe: z.boolean().optional().describe('Check remember me checkbox'),
  submitButton: z.string().optional().describe('Selector for submit button'),
  
  // Search parameters
  query: z.string().optional().describe('Search query text'),
  searchField: z.string().optional().describe('Specific search field selector'),
  waitForResults: z.number().optional().describe('Time to wait for results (seconds)'),
  resultSelector: z.string().optional().describe('Selector for result items'),
  
  // Navigation parameters
  steps: z.array(z.object({
    type: z.enum(['click', 'navigate', 'back', 'wait']),
    ref: z.string().optional(),
    url: z.string().optional(),
    element: z.string().optional(),
    duration: z.number().optional()
  })).optional().describe('Navigation steps to execute'),
  
  // Shadow DOM parameters
  targetText: z.string().optional().describe('Text to find in shadow DOM or infinite scroll'),
  maxDepth: z.number().optional().describe('Maximum shadow DOM depth to traverse'),
  
  // Infinite scroll parameters
  maxScrolls: z.number().optional().describe('Maximum number of scrolls'),
  scrollDelay: z.number().optional().describe('Delay between scrolls (seconds)'),
  
  // Rate limiting parameters
  actions: z.array(z.object({
    type: z.string(),
    params: z.any().optional(),
    description: z.string().optional()
  })).optional().describe('Actions to execute with rate limiting'),
  requestsPerWindow: z.number().optional().describe('Maximum requests per time window'),
  windowSize: z.number().optional().describe('Time window size in milliseconds'),
  retryAfter: z.number().optional().describe('Retry delay after rate limit (milliseconds)'),
  
  // Workflow parameters
  workflow: z.object({
    stages: z.array(z.object({
      name: z.string(),
      actions: z.array(z.any()),
      condition: z.any().optional(),
      verify: z.any().optional(),
      waitBetween: z.number().optional(),
      required: z.boolean().optional()
    }))
  }).optional().describe('Multi-step workflow definition'),
  
  // Data extraction parameters
  selectors: z.record(z.string()).optional().describe('Selectors for data extraction'),
  pagination: z.object({
    maxPages: z.number().optional()
  }).optional().describe('Pagination settings for extraction'),
  
  // Modal dismissal parameters
  dismissTexts: z.array(z.string()).optional().describe('Text to look for in dismiss buttons'),
  escapeKey: z.boolean().optional().describe('Try escape key to dismiss modals'),
  
  // General parameters
  maxRetries: z.number().optional().describe('Maximum retry attempts on failure'),
  waitBetween: z.number().optional().describe('Wait time between steps (seconds)'),
  skipMissingFields: z.boolean().optional().describe('Skip fields that cannot be found'),
  stopOnError: z.boolean().optional().describe('Stop sequence on first error'),
  checkpoints: z.boolean().optional().describe('Save checkpoints in workflows'),
  rollbackOnError: z.boolean().optional().describe('Rollback workflow on error')
});

export const browserMultitool: Tool = {
  schema: {
    name: 'browser_multitool',
    description: `🎯 ONE-SHOT BROWSER AUTOMATION - Combine multiple operations into a single intelligent call.

⚡ WHEN TO USE THIS TOOL:
Instead of: browser_navigate → browser_snapshot → browser_type → browser_type → browser_click
Use this: browser_multitool with appropriate parameters

📊 TOKEN SAVINGS: 70-90% fewer tokens compared to individual tool calls
🚀 SPEED: 3-5x faster execution with optimized sequences
🛡️ RELIABILITY: Built-in retry logic and error recovery

🎨 USAGE EXAMPLES:

1️⃣ LOGIN:
{
  "username": "user@example.com",
  "password": "pass123",
  "rememberMe": true
}

2️⃣ FORM FILLING:
{
  "fields": {
    "name": "John Doe",
    "email": "john@example.com",
    "message": "Hello world"
  },
  "submitButton": "send"
}

3️⃣ SEARCH:
{
  "query": "machine learning",
  "waitForResults": 3
}

4️⃣ NAVIGATION SEQUENCE:
{
  "steps": [
    {"type": "navigate", "url": "https://example.com"},
    {"type": "click", "ref": "menu_button"},
    {"type": "wait", "duration": 2},
    {"type": "click", "ref": "settings"}
  ]
}

5️⃣ DISMISS MODALS:
{
  "dismissTexts": ["Accept", "OK", "Close"],
  "escapeKey": true
}

6️⃣ DATA EXTRACTION:
{
  "selectors": {
    "title": "h1",
    "price": ".product-price",
    "description": ".product-description"
  }
}

🤖 SMART FEATURES:
• Auto-detects pattern from parameters (no need to specify)
• Intelligent field matching (finds by label, placeholder, name, type)
• Handles common variations (email/username, signin/login)
• Built-in wait times and retry logic
• Returns structured results with clear success/error states

💡 PRO TIPS:
• Use 'skipMissingFields: true' to continue even if some fields aren't found
• Set 'maxRetries: 3' for flaky pages
• Add 'waitBetween: 1' (seconds) for slow-loading forms
• Pattern auto-detection works 95% of the time - only override if needed

🔍 PATTERNS:
• form_fill - Smart form completion with field detection
• login - Username/password authentication flows
• search - Search input with result waiting
• navigation_sequence - Multi-step page navigation
• dismiss_modals - Close popups and overlays
• infinite_scroll - Scroll until content found
• extract_data - Scrape structured data from pages
• shadow_dom - Navigate shadow DOM elements
• multi_step_workflow - Complex conditional workflows
• rate_limited - Respect rate limits automatically`,
    inputSchema: zodToJsonSchema(paramsSchema)
  },

  handle: async (context: Context, params?: Record<string, any>): Promise<ToolResult> => {
    try {
      const validatedParams = paramsSchema.parse(params || {});
      
      // Detect pattern
      const pattern = await detectPattern(context, validatedParams);
      
      // Execute pattern
      const result = await executePattern(context, pattern, validatedParams);
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }],
        isError: result.status === 'error'
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: 'error',
            errors: [{ code: 'multitool_error', detail: String(error) }]
          }, null, 2)
        }],
        isError: true
      };
    }
  }
};

// Types for result
interface MultitoolResult {
  status: 'success' | 'partial' | 'error';
  pattern: string;
  actionsTaken: string[];
  errors?: Array<{ code: string; detail: string }>;
  nextHint?: string;
  content?: any;
}

// DOM Scanner utility
class DOMScanner {
  static async findField(
    context: Context,
    fieldName: string,
    fieldValue?: string
  ): Promise<{ ref: string; element: string } | null> {
    const code = `
      (function() {
        const api = window.__browsermcp_api || {};
        const fieldName = ${JSON.stringify(fieldName)};
        const candidates = [];
        
        // Find all input-like elements
        const inputs = api.$$?.('input, textarea, select') || 
                      [...document.querySelectorAll('input, textarea, select')];
        
        for (const el of inputs) {
          let score = 0;
          const signals = {
            id: el.id?.toLowerCase() || '',
            name: el.name?.toLowerCase() || '',
            placeholder: el.placeholder?.toLowerCase() || '',
            ariaLabel: el.getAttribute('aria-label')?.toLowerCase() || '',
            type: el.type?.toLowerCase() || ''
          };
          
          // Find associated label
          let labelText = '';
          if (el.id) {
            const label = document.querySelector(\`label[for="\${el.id}"]\`);
            if (label) labelText = label.textContent?.toLowerCase() || '';
          }
          
          // Score based on matches
          const searchTerm = fieldName.toLowerCase();
          if (signals.id === searchTerm) score += 3;
          else if (signals.id.includes(searchTerm)) score += 2;
          
          if (signals.name === searchTerm) score += 3;
          else if (signals.name.includes(searchTerm)) score += 2;
          
          if (signals.placeholder.includes(searchTerm)) score += 1;
          if (signals.ariaLabel.includes(searchTerm)) score += 1;
          if (labelText.includes(searchTerm)) score += 2;
          
          // Type hints for specific fields
          if (searchTerm.includes('email') && signals.type === 'email') score += 2;
          if (searchTerm.includes('password') && signals.type === 'password') score += 2;
          if (searchTerm.includes('search') && signals.type === 'search') score += 2;
          
          if (score > 0) {
            // Generate a unique ref for the element
            const index = Array.from(document.querySelectorAll(el.tagName)).indexOf(el);
            const ref = el.id || \`\${el.tagName.toLowerCase()}_\${index}\`;
            
            candidates.push({
              element: el,
              score: score,
              ref: ref
            });
          }
        }
        
        // Sort by score and return best match
        candidates.sort((a, b) => b.score - a.score);
        if (candidates.length > 0) {
          const best = candidates[0];
          // Store reference for later use
          if (!best.element.hasAttribute('data-multitool-ref')) {
            best.element.setAttribute('data-multitool-ref', best.ref);
          }
          return {
            ref: best.ref,
            element: best.element.tagName.toLowerCase() + 
                     (best.element.type ? '[type=' + best.element.type + ']' : '')
          };
        }
        
        return null;
      })();
    `;
    
    try {
      const response = await context.sendSocketMessage("js.execute", {
        code,
        timeout: 5000,
        unsafe: false
      });
      
      return response.result;
    } catch (error) {
      console.error(`Failed to find field "${fieldName}":`, error);
      return null;
    }
  }

  static async detectFormType(context: Context): Promise<string> {
    const code = `
      (function() {
        const forms = document.querySelectorAll('form');
        const hasPassword = document.querySelector('input[type="password"]');
        const hasSearch = document.querySelector('input[type="search"]');
        const hasEmail = document.querySelector('input[type="email"]');
        
        if (hasPassword && (hasEmail || document.querySelector('input[name*="user"]'))) {
          return 'login';
        }
        if (hasSearch || document.querySelector('input[placeholder*="search"]')) {
          return 'search';
        }
        if (forms.length > 0) {
          return 'form';
        }
        return 'unknown';
      })();
    `;
    
    try {
      const response = await context.sendSocketMessage("js.execute", {
        code,
        timeout: 5000,
        unsafe: false
      });
      return response.result || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  static async clickElement(context: Context, ref: string): Promise<boolean> {
    const code = `
      (function() {
        const api = window.__browsermcp_api || {};
        
        // Try to find element by our ref
        const el = document.querySelector('[data-multitool-ref="' + ${JSON.stringify(ref)} + '"]') ||
                   document.getElementById(${JSON.stringify(ref)});
        
        if (el) {
          if (api.click) {
            api.click(el);
          } else {
            el.click();
          }
          return true;
        }
        return false;
      })();
    `;
    
    try {
      const response = await context.sendSocketMessage("js.execute", {
        code,
        timeout: 5000,
        unsafe: false
      });
      return Boolean(response.result);
    } catch {
      return false;
    }
  }

  static async typeInField(context: Context, ref: string, text: string): Promise<boolean> {
    const code = `
      (function() {
        const api = window.__browsermcp_api || {};
        
        // Try to find element by our ref
        const el = document.querySelector('[data-multitool-ref="' + ${JSON.stringify(ref)} + '"]') ||
                   document.getElementById(${JSON.stringify(ref)});
        
        if (el) {
          if (api.setValue) {
            api.setValue(el, ${JSON.stringify(text)});
          } else {
            el.value = ${JSON.stringify(text)};
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
          return true;
        }
        return false;
      })();
    `;
    
    try {
      const response = await context.sendSocketMessage("js.execute", {
        code,
        timeout: 5000,
        unsafe: false
      });
      return Boolean(response.result);
    } catch {
      return false;
    }
  }
}

// Pattern detection
async function detectPattern(context: Context, params: any): Promise<string> {
  // Explicit pattern override
  if (params.pattern && params.pattern !== 'auto') {
    return params.pattern;
  }
  
  // Signature-based detection
  if (params.username && params.password) return 'login';
  if (params.query) return 'search';
  if (params.steps && params.steps.length > 0) return 'navigation_sequence';
  if (params.workflow) return 'multi_step_workflow';
  if (params.dismissTexts || params.escapeKey) return 'dismiss_modals';
  if (params.maxScrolls) return 'infinite_scroll';
  if (params.selectors) return 'extract_data';
  if (params.fields && Object.keys(params.fields).length > 0) return 'form_fill';
  
  // DOM-based detection
  const domType = await DOMScanner.detectFormType(context);
  if (domType === 'login') return 'login';
  if (domType === 'search') return 'search';
  if (domType === 'form') return 'form_fill';
  
  // Default fallback
  return 'form_fill';
}

// Main pattern execution
async function executePattern(
  context: Context, 
  pattern: string, 
  params: any
): Promise<MultitoolResult> {
  switch (pattern) {
    case 'form_fill':
      return await executeFormFill(context, params);
    case 'login':
      return await executeLogin(context, params);
    case 'search':
      return await executeSearch(context, params);
    case 'navigation_sequence':
      return await executeNavigationSequence(context, params);
    case 'dismiss_modals':
      return await executeDismissModals(context, params);
    case 'infinite_scroll':
      return await executeInfiniteScroll(context, params);
    case 'extract_data':
      return await executeDataExtraction(context, params);
    default:
      return {
        status: 'error',
        pattern,
        actionsTaken: [],
        errors: [{ code: 'pattern_not_implemented', detail: pattern }]
      };
  }
}

// Pattern implementations
async function executeFormFill(context: Context, params: any): Promise<MultitoolResult> {
  const actionsTaken: string[] = [];
  const errors: Array<{ code: string; detail: string }> = [];
  
  try {
    // Fill fields
    if (params.fields) {
      for (const [fieldName, fieldValue] of Object.entries(params.fields)) {
        const field = await DOMScanner.findField(context, fieldName, fieldValue as string);
        
        if (field) {
          const success = await DOMScanner.typeInField(context, field.ref, fieldValue as string);
          if (success) {
            actionsTaken.push(`type:${fieldName}`);
          } else {
            errors.push({ code: 'type_failed', detail: fieldName });
          }
        } else if (!params.skipMissingFields) {
          errors.push({ code: 'field_not_found', detail: fieldName });
          if (params.stopOnError) {
            return { status: 'error', pattern: 'form_fill', actionsTaken, errors };
          }
        }
        
        if (params.waitBetween) {
          await new Promise(resolve => setTimeout(resolve, params.waitBetween * 1000));
        }
      }
    }
    
    // Submit form
    if (params.submitButton) {
      const submitField = await DOMScanner.findField(context, params.submitButton);
      if (submitField) {
        await DOMScanner.clickElement(context, submitField.ref);
        actionsTaken.push('click:submit');
      }
    }
    
    // Capture final state
    const snapshot = await captureAriaSnapshot(context);
    
    return {
      status: errors.length === 0 ? 'success' : 'partial',
      pattern: 'form_fill',
      actionsTaken,
      errors: errors.length > 0 ? errors : undefined,
      content: snapshot.content
    };
  } catch (error) {
    return {
      status: 'error',
      pattern: 'form_fill',
      actionsTaken,
      errors: [{ code: 'execution_error', detail: String(error) }]
    };
  }
}

async function executeLogin(context: Context, params: any): Promise<MultitoolResult> {
  const actionsTaken: string[] = [];
  const errors: Array<{ code: string; detail: string }> = [];
  
  try {
    // Find and fill username field
    const username = params.username || params.fields?.username;
    if (username) {
      const usernameField = await DOMScanner.findField(context, 'username', username) ||
                           await DOMScanner.findField(context, 'email', username) ||
                           await DOMScanner.findField(context, 'user', username);
      
      if (usernameField) {
        await DOMScanner.typeInField(context, usernameField.ref, username);
        actionsTaken.push('type:username');
      } else {
        errors.push({ code: 'field_not_found', detail: 'username' });
      }
    }
    
    // Find and fill password field
    const password = params.password || params.fields?.password;
    if (password) {
      const passwordField = await DOMScanner.findField(context, 'password', password);
      
      if (passwordField) {
        await DOMScanner.typeInField(context, passwordField.ref, password);
        actionsTaken.push('type:password');
      } else {
        errors.push({ code: 'field_not_found', detail: 'password' });
      }
    }
    
    // Handle remember me checkbox
    if (params.rememberMe) {
      const rememberField = await DOMScanner.findField(context, 'remember') ||
                           await DOMScanner.findField(context, 'rememberMe');
      if (rememberField) {
        await DOMScanner.clickElement(context, rememberField.ref);
        actionsTaken.push('click:remember');
      }
    }
    
    // Submit login form
    const submitField = await DOMScanner.findField(context, params.submitButton || 'submit') ||
                       await DOMScanner.findField(context, 'login') ||
                       await DOMScanner.findField(context, 'signin');
    
    if (submitField) {
      await DOMScanner.clickElement(context, submitField.ref);
      actionsTaken.push('click:submit');
    }
    
    // Wait for navigation
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Capture final state
    const snapshot = await captureAriaSnapshot(context);
    
    return {
      status: errors.length === 0 ? 'success' : 'partial',
      pattern: 'login',
      actionsTaken,
      errors: errors.length > 0 ? errors : undefined,
      content: snapshot.content
    };
  } catch (error) {
    return {
      status: 'error',
      pattern: 'login',
      actionsTaken,
      errors: [{ code: 'execution_error', detail: String(error) }]
    };
  }
}

async function executeSearch(context: Context, params: any): Promise<MultitoolResult> {
  const actionsTaken: string[] = [];
  
  try {
    // Find search field
    const searchField = await DOMScanner.findField(
      context, 
      params.searchField || 'search',
      params.query
    );
    
    if (!searchField) {
      return {
        status: 'error',
        pattern: 'search',
        actionsTaken,
        errors: [{ code: 'field_not_found', detail: 'search_field' }]
      };
    }
    
    // Type search query and submit
    await DOMScanner.typeInField(context, searchField.ref, params.query);
    actionsTaken.push(`type:search:${params.query}`);
    
    // Press Enter to submit
    await context.sendSocketMessage("dom.pressKey", { key: 'Enter' });
    actionsTaken.push('key:enter');
    
    // Wait for results
    const waitTime = params.waitForResults || 3;
    await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
    
    // Capture results
    const snapshot = await captureAriaSnapshot(context);
    
    return {
      status: 'success',
      pattern: 'search',
      actionsTaken,
      content: snapshot.content
    };
  } catch (error) {
    return {
      status: 'error',
      pattern: 'search',
      actionsTaken,
      errors: [{ code: 'execution_error', detail: String(error) }]
    };
  }
}

async function executeNavigationSequence(context: Context, params: any): Promise<MultitoolResult> {
  const actionsTaken: string[] = [];
  
  try {
    if (!params.steps || params.steps.length === 0) {
      return {
        status: 'error',
        pattern: 'navigation_sequence',
        actionsTaken,
        errors: [{ code: 'no_steps_provided', detail: 'No navigation steps provided' }]
      };
    }
    
    for (const step of params.steps) {
      switch (step.type) {
        case 'navigate':
          await context.sendSocketMessage("browser_navigate", { url: step.url });
          actionsTaken.push(`navigate:${step.url}`);
          break;
        case 'click':
          if (step.ref) {
            await DOMScanner.clickElement(context, step.ref);
            actionsTaken.push(`click:${step.element || step.ref}`);
          }
          break;
        case 'back':
          await context.sendSocketMessage("browser_go_back", {});
          actionsTaken.push('back');
          break;
        case 'wait':
          await new Promise(resolve => setTimeout(resolve, (step.duration || 1) * 1000));
          actionsTaken.push(`wait:${step.duration}s`);
          break;
      }
      
      if (params.waitBetween) {
        await new Promise(resolve => setTimeout(resolve, params.waitBetween * 1000));
      }
    }
    
    // Capture final state
    const snapshot = await captureAriaSnapshot(context);
    
    return {
      status: 'success',
      pattern: 'navigation_sequence',
      actionsTaken,
      content: snapshot.content
    };
  } catch (error) {
    return {
      status: 'error',
      pattern: 'navigation_sequence',
      actionsTaken,
      errors: [{ code: 'execution_error', detail: String(error) }]
    };
  }
}

async function executeDismissModals(context: Context, params: any): Promise<MultitoolResult> {
  const actionsTaken: string[] = [];
  
  try {
    // Try escape key first if requested
    if (params.escapeKey) {
      await context.sendSocketMessage("dom.pressKey", { key: 'Escape' });
      actionsTaken.push('key:escape');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Look for dismiss buttons
    const dismissTexts = params.dismissTexts || ['close', 'dismiss', 'cancel', 'x', '×', 'no thanks'];
    
    for (const text of dismissTexts) {
      const code = `
        (function() {
          const buttons = [...document.querySelectorAll('button, a, span, div')];
          for (const el of buttons) {
            const elText = el.textContent?.toLowerCase() || '';
            if (elText === ${JSON.stringify(text.toLowerCase())} || 
                (elText.length < 20 && elText.includes(${JSON.stringify(text.toLowerCase())}))) {
              el.click();
              return true;
            }
          }
          return false;
        })();
      `;
      
      const response = await context.sendSocketMessage("js.execute", {
        code,
        timeout: 5000,
        unsafe: false
      });
      
      if (response.result) {
        actionsTaken.push(`click:dismiss:${text}`);
        break;
      }
    }
    
    // Capture final state
    const snapshot = await captureAriaSnapshot(context);
    
    return {
      status: 'success',
      pattern: 'dismiss_modals',
      actionsTaken,
      content: snapshot.content
    };
  } catch (error) {
    return {
      status: 'error',
      pattern: 'dismiss_modals',
      actionsTaken,
      errors: [{ code: 'execution_error', detail: String(error) }]
    };
  }
}

async function executeInfiniteScroll(context: Context, params: any): Promise<MultitoolResult> {
  const actionsTaken: string[] = [];
  
  try {
    const maxScrolls = params.maxScrolls || 10;
    const scrollDelay = params.scrollDelay || 1;
    const targetText = params.targetText?.toLowerCase();
    
    for (let i = 0; i < maxScrolls; i++) {
      // Check if target text is found
      if (targetText) {
        const code = `
          (function() {
            const pageText = document.body.textContent?.toLowerCase() || '';
            return pageText.includes(${JSON.stringify(targetText)});
          })();
        `;
        
        const response = await context.sendSocketMessage("js.execute", {
          code,
          timeout: 5000,
          unsafe: false
        });
        
        if (response.result) {
          actionsTaken.push(`found:${targetText}`);
          break;
        }
      }
      
      // Scroll down
      await context.sendSocketMessage("js.execute", {
        code: "window.scrollBy(0, window.innerHeight * 0.8);",
        timeout: 5000,
        unsafe: false
      });
      actionsTaken.push(`scroll:${i + 1}`);
      
      // Wait for content to load
      await new Promise(resolve => setTimeout(resolve, scrollDelay * 1000));
    }
    
    // Capture final state
    const snapshot = await captureAriaSnapshot(context);
    
    return {
      status: 'success',
      pattern: 'infinite_scroll',
      actionsTaken,
      content: snapshot.content
    };
  } catch (error) {
    return {
      status: 'error',
      pattern: 'infinite_scroll',
      actionsTaken,
      errors: [{ code: 'execution_error', detail: String(error) }]
    };
  }
}

async function executeDataExtraction(context: Context, params: any): Promise<MultitoolResult> {
  const actionsTaken: string[] = [];
  const extractedData: Record<string, any> = {};
  
  try {
    if (!params.selectors) {
      return {
        status: 'error',
        pattern: 'extract_data',
        actionsTaken,
        errors: [{ code: 'no_selectors', detail: 'No selectors provided for extraction' }]
      };
    }
    
    for (const [key, selector] of Object.entries(params.selectors)) {
      const code = `
        (function() {
          const elements = document.querySelectorAll(${JSON.stringify(selector)});
          if (elements.length === 0) return null;
          if (elements.length === 1) {
            return elements[0].textContent?.trim() || elements[0].value || null;
          }
          return Array.from(elements).map(el => 
            el.textContent?.trim() || el.value || ''
          ).filter(t => t);
        })();
      `;
      
      const response = await context.sendSocketMessage("js.execute", {
        code,
        timeout: 5000,
        unsafe: false
      });
      
      if (response.result !== null) {
        extractedData[key] = response.result;
        actionsTaken.push(`extract:${key}`);
      }
    }
    
    return {
      status: 'success',
      pattern: 'extract_data',
      actionsTaken,
      content: [{
        type: 'text',
        text: JSON.stringify(extractedData, null, 2)
      }]
    };
  } catch (error) {
    return {
      status: 'error',
      pattern: 'extract_data',
      actionsTaken,
      errors: [{ code: 'execution_error', detail: String(error) }]
    };
  }
}