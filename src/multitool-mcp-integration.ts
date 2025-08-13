/**
 * MCP Tool Integration for BrowserMCP Multitool
 * This file shows how to integrate the multitool as an MCP tool
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BrowserMultitool, MultitoolParamsSchema } from './multitool';
import { registerAdvancedPatterns } from './multitool-advanced';

/**
 * Create the MCP tool definition for the multitool
 */
export function createMultitoolMCPTool(): Tool {
  return {
    name: 'browser_multitool',
    description: `Meta-tool that orchestrates common browser automation patterns. 

🚀 IMPORTANT: AI agents should PREFER this tool over individual browser_* tools when:
- Filling forms (use 'form_fill' instead of multiple browser_type calls)
- Logging in (use 'login' instead of manual field filling)
- Searching (use 'search' instead of manual type + click)
- Any multi-step operation

Benefits:
✅ Saves significant tokens (single call vs many)
✅ Faster execution (optimized sequences)
✅ Built-in error recovery and retries
✅ Smart field detection (finds fields by context)
✅ Handles common edge cases automatically

Available patterns:
- form_fill: Fill and submit forms with smart field detection
- login: Complete login flows with username/password
- search: Perform searches and wait for results  
- navigation_sequence: Navigate through multiple pages
- shadow_dom: Navigate through shadow DOM to find elements
- dismiss_modals: Detect and dismiss popups/modals
- infinite_scroll: Scroll to find specific content
- rate_limited: Perform actions while respecting rate limits
- multi_step_workflow: Execute complex workflows with conditions
- extract_data: Extract structured data from pages

The tool automatically detects which pattern to use based on parameters, or you can specify a pattern explicitly.`,
    
    inputSchema: {
      type: 'object',
      properties: {
        // Pattern selection
        pattern: {
          type: 'string',
          enum: [
            'form_fill', 'login', 'search', 'navigation_sequence',
            'shadow_dom', 'dismiss_modals', 'infinite_scroll',
            'rate_limited', 'multi_step_workflow', 'extract_data'
          ],
          description: 'Specific pattern to use (auto-detected if not specified)'
        },
        
        // Form/Login parameters
        fields: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: 'Field name to value mapping for forms'
        },
        username: {
          type: 'string',
          description: 'Username or email for login'
        },
        password: {
          type: 'string',
          description: 'Password for login'
        },
        rememberMe: {
          type: 'boolean',
          description: 'Check remember me checkbox'
        },
        submitButton: {
          type: 'string',
          description: 'Selector for submit button (auto-detected if not specified)'
        },
        
        // Search parameters
        query: {
          type: 'string',
          description: 'Search query text'
        },
        searchField: {
          type: 'string',
          description: 'Specific search field selector'
        },
        waitForResults: {
          type: 'number',
          description: 'Time to wait for results (seconds)'
        },
        resultSelector: {
          type: 'string',
          description: 'Selector for result items'
        },
        
        // Navigation parameters
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['click', 'navigate', 'back', 'wait']
              },
              ref: { type: 'string' },
              url: { type: 'string' },
              element: { type: 'string' },
              duration: { type: 'number' }
            },
            required: ['type']
          },
          description: 'Navigation steps to execute'
        },
        
        // Shadow DOM parameters
        targetText: {
          type: 'string',
          description: 'Text to find in shadow DOM or infinite scroll'
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum shadow DOM depth to traverse'
        },
        
        // Infinite scroll parameters
        maxScrolls: {
          type: 'number',
          description: 'Maximum number of scrolls'
        },
        scrollDelay: {
          type: 'number',
          description: 'Delay between scrolls (seconds)'
        },
        
        // Rate limiting parameters
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              params: { type: 'object' }
            }
          },
          description: 'Actions to execute with rate limiting'
        },
        requestsPerWindow: {
          type: 'number',
          description: 'Maximum requests per time window'
        },
        windowSize: {
          type: 'number',
          description: 'Time window size in milliseconds'
        },
        retryAfter: {
          type: 'number',
          description: 'Retry delay after rate limit (milliseconds)'
        },
        
        // Workflow parameters
        workflow: {
          type: 'object',
          properties: {
            stages: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  actions: { type: 'array' },
                  condition: { type: 'object' },
                  verify: { type: 'object' },
                  waitBetween: { type: 'number' },
                  required: { type: 'boolean' }
                },
                required: ['name', 'actions']
              }
            }
          },
          description: 'Multi-step workflow definition'
        },
        
        // Data extraction parameters
        selectors: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: 'Selectors for data extraction'
        },
        pagination: {
          type: 'object',
          properties: {
            maxPages: { type: 'number' }
          },
          description: 'Pagination settings for extraction'
        },
        
        // Modal dismissal parameters
        dismissTexts: {
          type: 'array',
          items: { type: 'string' },
          description: 'Text to look for in dismiss buttons'
        },
        escapeKey: {
          type: 'boolean',
          description: 'Try escape key to dismiss modals'
        },
        
        // General parameters
        maxRetries: {
          type: 'number',
          description: 'Maximum retry attempts on failure',
          default: 3
        },
        waitBetween: {
          type: 'number',
          description: 'Wait time between steps (seconds)'
        },
        skipMissingFields: {
          type: 'boolean',
          description: 'Skip fields that cannot be found'
        },
        stopOnError: {
          type: 'boolean',
          description: 'Stop sequence on first error',
          default: true
        },
        checkpoints: {
          type: 'boolean',
          description: 'Save checkpoints in workflows'
        },
        rollbackOnError: {
          type: 'boolean',
          description: 'Rollback workflow on error'
        }
      }
    }
  };
}

/**
 * Handler function for the multitool MCP tool
 * This would be called by the MCP server when the tool is invoked
 */
export async function handleMultitoolRequest(params: any, browser: any): Promise<any> {
  // Initialize multitool with all patterns
  const multitool = new BrowserMultitool();
  registerAdvancedPatterns(multitool);

  // Create execution context with browser instance
  const context = {
    browser,
    params,
    retryCount: 0,
    maxRetries: params.maxRetries || 3,
    results: {},
    confidence: 1.0,
    snapshot: null
  };

  try {
    // Get initial snapshot if needed
    if (!params.pattern || needsSnapshot(params.pattern)) {
      context.snapshot = await browser.snapshot({ level: 'minimal' });
    }

    // Execute the multitool
    const result = await multitool.execute(params);

    // Format response for MCP
    return {
      success: result.success,
      pattern: result.pattern,
      data: result.data,
      steps_executed: result.steps,
      duration_ms: result.duration,
      error: result.error
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      pattern: params.pattern || 'unknown'
    };
  }
}

/**
 * Helper to determine if pattern needs initial snapshot
 */
function needsSnapshot(pattern: string): boolean {
  const snapshotPatterns = [
    'form_fill', 'login', 'search', 'shadow_dom',
    'dismiss_modals', 'extract_data'
  ];
  return snapshotPatterns.includes(pattern);
}

/**
 * Example usage in BrowserMCP server
 */
export function registerMultitoolInServer(server: any) {
  // Add the tool definition
  server.setRequestHandler('tools/list', async () => ({
    tools: [
      createMultitoolMCPTool(),
      // ... other browser tools
    ]
  }));

  // Handle tool calls
  server.setRequestHandler('tools/call', async (request: any) => {
    const { name, arguments: args } = request.params;
    
    if (name === 'browser_multitool') {
      // Get browser instance (would come from your browser manager)
      const browser = server.getBrowser();
      return handleMultitoolRequest(args, browser);
    }
    
    // Handle other tools...
  });
}

/**
 * Standalone function to execute multitool patterns directly
 * Useful for testing or direct usage without MCP
 */
export async function executeMultitoolPattern(
  pattern: string,
  params: any,
  browser: any
): Promise<any> {
  const multitool = new BrowserMultitool();
  registerAdvancedPatterns(multitool);

  // Add pattern to params
  params.pattern = pattern;

  // Execute
  return multitool.execute(params);
}

/**
 * Example: Using multitool to solve Challenge 2 (Now You See Me)
 */
export const solveNowYouSeeMe = async (browser: any) => {
  return executeMultitoolPattern('multi_step_workflow', {
    workflow: {
      stages: [
        {
          name: 'Dismiss Modal',
          actions: [
            { tool: 'browser_snapshot', params: { level: 'minimal' } },
            { tool: 'browser_click', params: { 
              ref: '#dismiss-overlay', 
              element: 'dismiss overlay button' 
            }}
          ]
        },
        {
          name: 'Fill Form After API',
          actions: [
            { tool: 'browser_wait', params: { time: 2 } },
            { tool: 'browser_type', params: { 
              ref: '#name', 
              text: 'AI Agent',
              element: 'name field'
            }},
            { tool: 'browser_type', params: { 
              ref: '#email', 
              text: 'ai@browsermcp.com',
              element: 'email field'
            }}
          ]
        },
        {
          name: 'Hover Moving Tooltip',
          actions: [
            { tool: 'browser_hover', params: { 
              ref: '#moving-tooltip',
              element: 'moving tooltip'
            }},
            { tool: 'browser_wait', params: { time: 1.5 } }
          ]
        },
        {
          name: 'Complete Challenge',
          actions: [
            { tool: 'browser_click', params: { 
              ref: '#secret-checkbox',
              element: 'secret checkbox'
            }},
            { tool: 'browser_click', params: { 
              ref: '#submit-button',
              element: 'submit button'
            }}
          ]
        }
      ]
    },
    checkpoints: true
  }, browser);
};

/**
 * Example: Using multitool for common login
 */
export const performLogin = async (browser: any, site: string) => {
  // Site-specific configurations
  const siteConfigs: Record<string, any> = {
    github: {
      pattern: 'login',
      username: 'your-username',
      password: 'your-password',
      rememberMe: false
    },
    google: {
      pattern: 'multi_step_workflow',
      workflow: {
        stages: [
          {
            name: 'Enter Email',
            actions: [
              { tool: 'browser_type', params: { 
                ref: '#identifierId',
                text: 'your-email@gmail.com'
              }},
              { tool: 'browser_click', params: { 
                ref: '#identifierNext'
              }}
            ]
          },
          {
            name: 'Enter Password',
            actions: [
              { tool: 'browser_wait', params: { time: 2 } },
              { tool: 'browser_type', params: { 
                ref: 'input[type="password"]',
                text: 'your-password'
              }},
              { tool: 'browser_click', params: { 
                ref: '#passwordNext'
              }}
            ]
          }
        ]
      }
    }
  };

  const config = siteConfigs[site];
  if (!config) {
    throw new Error(`No login configuration for site: ${site}`);
  }

  return executeMultitoolPattern(config.pattern, config, browser);
};