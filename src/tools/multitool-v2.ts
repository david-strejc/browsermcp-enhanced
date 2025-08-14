/**
 * Browser Multitool V2 - Thin Wrapper for Browser Tools
 * 
 * This is a lightweight orchestrator that translates high-level patterns
 * into sequences of existing browser tool calls. It does NOT implement
 * its own DOM scanning or manipulation logic.
 */

import { Tool } from '../types.js';
import { Context } from '../context.js';

// Tool call descriptor - what tool to call and with what params
interface ToolCall {
  tool: string;
  params: Record<string, any>;
  description?: string;
}

// Pattern result
interface PatternResult {
  status: 'success' | 'partial' | 'error';
  pattern: string;
  toolCalls: ToolCall[];
  executedCalls: number;
  errors?: Array<{ tool: string; error: string }>;
}

/**
 * Generate tool calls for form filling pattern
 */
function generateFormFillCalls(params: any): ToolCall[] {
  const calls: ToolCall[] = [];
  
  // First, take a snapshot to see the page
  calls.push({
    tool: 'browser_snapshot',
    params: { level: 'full' },
    description: 'Capture page state'
  });
  
  // For each field, generate type commands
  if (params.fields) {
    for (const [fieldName, value] of Object.entries(params.fields)) {
      // We'll use the actual ref from the snapshot
      // For now, we'll try to find by placeholder or name
      calls.push({
        tool: 'browser_execute_js',
        params: {
          code: `
            // Find field by id, name, or placeholder
            const field = document.getElementById('${fieldName}') ||
                         document.querySelector('[name="${fieldName}"]') ||
                         document.querySelector('[placeholder*="${fieldName}" i]');
            if (field) {
              field.value = '${value}';
              field.dispatchEvent(new Event('input', { bubbles: true }));
              field.dispatchEvent(new Event('change', { bubbles: true }));
              return 'Field ${fieldName} filled';
            }
            return null;
          `,
          unsafe: true
        },
        description: `Fill field: ${fieldName}`
      });
    }
  }
  
  // If submit button specified, click it
  if (params.submitButton) {
    calls.push({
      tool: 'browser_execute_js',
      params: {
        code: `
          const button = document.querySelector('button[type="submit"]') ||
                        document.querySelector('input[type="submit"]') ||
                        document.querySelector('button:contains("${params.submitButton}")');
          if (button) {
            button.click();
            return 'Submit button clicked';
          }
          return null;
        `,
        unsafe: true
      },
      description: 'Click submit button'
    });
  }
  
  return calls;
}

/**
 * Generate tool calls for login pattern
 */
function generateLoginCalls(params: any): ToolCall[] {
  const calls: ToolCall[] = [];
  
  // Snapshot first
  calls.push({
    tool: 'browser_snapshot',
    params: { level: 'minimal' },
    description: 'Capture login form'
  });
  
  // Fill username
  if (params.username) {
    calls.push({
      tool: 'browser_execute_js',
      params: {
        code: `
          const userField = document.querySelector('input[type="text"][name*="user" i]') ||
                           document.querySelector('input[type="email"]') ||
                           document.querySelector('#username') ||
                           document.querySelector('input[placeholder*="username" i]') ||
                           document.querySelector('input[placeholder*="email" i]');
          if (userField) {
            userField.value = '${params.username}';
            userField.dispatchEvent(new Event('input', { bubbles: true }));
            return 'Username filled';
          }
          return null;
        `,
        unsafe: true
      },
      description: 'Fill username/email'
    });
  }
  
  // Fill password
  if (params.password) {
    calls.push({
      tool: 'browser_execute_js',
      params: {
        code: `
          const passField = document.querySelector('input[type="password"]');
          if (passField) {
            passField.value = '${params.password}';
            passField.dispatchEvent(new Event('input', { bubbles: true }));
            return 'Password filled';
          }
          return null;
        `,
        unsafe: true
      },
      description: 'Fill password'
    });
  }
  
  // Check remember me if requested
  if (params.rememberMe) {
    calls.push({
      tool: 'browser_execute_js',
      params: {
        code: `
          const checkbox = document.querySelector('input[type="checkbox"][name*="remember" i]') ||
                          document.querySelector('#rememberMe');
          if (checkbox && !checkbox.checked) {
            checkbox.click();
            return 'Remember me checked';
          }
          return null;
        `,
        unsafe: true
      },
      description: 'Check remember me'
    });
  }
  
  // Click login button
  calls.push({
    tool: 'browser_execute_js',
    params: {
      code: `
        const button = document.querySelector('button[type="submit"]') ||
                      document.querySelector('input[type="submit"]') ||
                      document.querySelector('button:has-text(/sign\\s*in|log\\s*in/i)');
        if (button) {
          button.click();
          return 'Login button clicked';
        }
        return null;
      `,
      unsafe: true
    },
    description: 'Click login button'
  });
  
  return calls;
}

/**
 * Generate tool calls for search pattern
 */
function generateSearchCalls(params: any): ToolCall[] {
  const calls: ToolCall[] = [];
  
  // Fill search field
  if (params.query) {
    calls.push({
      tool: 'browser_execute_js',
      params: {
        code: `
          const searchField = document.querySelector('input[type="search"]') ||
                             document.querySelector('input[name="q"]') ||
                             document.querySelector('input[placeholder*="search" i]');
          if (searchField) {
            searchField.value = '${params.query}';
            searchField.dispatchEvent(new Event('input', { bubbles: true }));
            return 'Search query entered';
          }
          return null;
        `,
        unsafe: true
      },
      description: 'Enter search query'
    });
    
    // Submit search
    calls.push({
      tool: 'browser_press_key',
      params: { key: 'Enter' },
      description: 'Submit search'
    });
    
    // Wait for results if specified
    if (params.waitForResults) {
      calls.push({
        tool: 'browser_wait',
        params: { time: params.waitForResults },
        description: `Wait ${params.waitForResults}s for results`
      });
    }
  }
  
  return calls;
}

/**
 * Generate tool calls for modal dismissal pattern
 */
function generateDismissModalCalls(params: any): ToolCall[] {
  const calls: ToolCall[] = [];
  
  // Try escape key first
  if (params.escapeKey !== false) {
    calls.push({
      tool: 'browser_press_key',
      params: { key: 'Escape' },
      description: 'Press Escape to close modal'
    });
  }
  
  // Try clicking dismiss buttons
  if (params.dismissTexts && params.dismissTexts.length > 0) {
    for (const text of params.dismissTexts) {
      calls.push({
        tool: 'browser_execute_js',
        params: {
          code: `
            const button = Array.from(document.querySelectorAll('button'))
              .find(b => b.textContent.toLowerCase().includes('${text.toLowerCase()}'));
            if (button) {
              button.click();
              return 'Clicked ${text} button';
            }
            return null;
          `,
          unsafe: true
        },
        description: `Click ${text} button`
      });
    }
  }
  
  return calls;
}

/**
 * Generate tool calls for navigation sequence
 */
function generateNavigationCalls(params: any): ToolCall[] {
  const calls: ToolCall[] = [];
  
  if (params.steps) {
    for (const step of params.steps) {
      if (step.type === 'navigate' && step.url) {
        calls.push({
          tool: 'browser_navigate',
          params: { url: step.url },
          description: `Navigate to ${step.url}`
        });
      } else if (step.type === 'click' && step.ref) {
        calls.push({
          tool: 'browser_click',
          params: { ref: step.ref, element: step.element || 'element' },
          description: `Click ${step.element || 'element'}`
        });
      } else if (step.type === 'wait' && step.duration) {
        calls.push({
          tool: 'browser_wait',
          params: { time: step.duration },
          description: `Wait ${step.duration}s`
        });
      } else if (step.type === 'back') {
        calls.push({
          tool: 'browser_go_back',
          params: {},
          description: 'Go back'
        });
      }
    }
  }
  
  return calls;
}

/**
 * Detect pattern from parameters
 */
function detectPattern(params: any): string {
  // Explicit pattern
  if (params.pattern) {
    return params.pattern;
  }
  
  // Auto-detect based on parameters
  if (params.username && params.password) {
    return 'login';
  }
  if (params.query) {
    return 'search';
  }
  if (params.dismissTexts || params.escapeKey) {
    return 'dismiss_modals';
  }
  if (params.steps) {
    return 'navigation_sequence';
  }
  if (params.fields) {
    return 'form_fill';
  }
  
  return 'unknown';
}

/**
 * Browser Multitool V2 - Main tool definition
 */
export const browser_multitool_v2: Tool = {
  name: 'browser_multitool_v2',
  description: 'Lightweight orchestrator for common browser automation patterns',
  
  inputSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        enum: ['form_fill', 'login', 'search', 'dismiss_modals', 'navigation_sequence'],
        description: 'Pattern to execute (auto-detected if not specified)'
      },
      fields: {
        type: 'object',
        description: 'Field name to value mapping for forms',
        additionalProperties: { type: 'string' }
      },
      username: {
        type: 'string',
        description: 'Username for login'
      },
      password: {
        type: 'string',
        description: 'Password for login'
      },
      rememberMe: {
        type: 'boolean',
        description: 'Check remember me checkbox'
      },
      query: {
        type: 'string',
        description: 'Search query'
      },
      waitForResults: {
        type: 'number',
        description: 'Seconds to wait for search results'
      },
      dismissTexts: {
        type: 'array',
        items: { type: 'string' },
        description: 'Button texts to click for dismissing modals'
      },
      escapeKey: {
        type: 'boolean',
        description: 'Try Escape key to dismiss modals'
      },
      steps: {
        type: 'array',
        description: 'Navigation steps to execute',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['navigate', 'click', 'wait', 'back'] },
            url: { type: 'string' },
            ref: { type: 'string' },
            element: { type: 'string' },
            duration: { type: 'number' }
          }
        }
      },
      submitButton: {
        type: 'string',
        description: 'Text or selector for submit button'
      },
      execute: {
        type: 'boolean',
        description: 'Execute the calls immediately (default: true)',
        default: true
      }
    }
  },
  
  handler: async (params: any, context: Context): Promise<PatternResult> => {
    const pattern = detectPattern(params);
    let toolCalls: ToolCall[] = [];
    
    // Generate tool calls based on pattern
    switch (pattern) {
      case 'form_fill':
        toolCalls = generateFormFillCalls(params);
        break;
      case 'login':
        toolCalls = generateLoginCalls(params);
        break;
      case 'search':
        toolCalls = generateSearchCalls(params);
        break;
      case 'dismiss_modals':
        toolCalls = generateDismissModalCalls(params);
        break;
      case 'navigation_sequence':
        toolCalls = generateNavigationCalls(params);
        break;
      default:
        return {
          status: 'error',
          pattern,
          toolCalls: [],
          executedCalls: 0,
          errors: [{ tool: 'multitool', error: `Unknown pattern: ${pattern}` }]
        };
    }
    
    // If execute is false, just return the plan
    if (params.execute === false) {
      return {
        status: 'success',
        pattern,
        toolCalls,
        executedCalls: 0
      };
    }
    
    // Execute the tool calls
    let executedCalls = 0;
    const errors: Array<{ tool: string; error: string }> = [];
    
    for (const call of toolCalls) {
      try {
        // Send the tool call via the context
        await context.callTool(call.tool, call.params);
        executedCalls++;
      } catch (error) {
        errors.push({
          tool: call.tool,
          error: error instanceof Error ? error.message : String(error)
        });
        
        // Stop on first error unless skipErrors is true
        if (!params.skipErrors) {
          break;
        }
      }
    }
    
    return {
      status: errors.length === 0 ? 'success' : 
              executedCalls > 0 ? 'partial' : 'error',
      pattern,
      toolCalls,
      executedCalls,
      errors: errors.length > 0 ? errors : undefined
    };
  }
};