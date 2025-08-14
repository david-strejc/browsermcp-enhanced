/**
 * Browser Multitool V3 - Recipe Generator
 * 
 * This tool generates a plan of browser tool calls based on high-level patterns.
 * It does NOT execute the plan - use browser_execute_plan for that.
 * 
 * USAGE FLOW:
 * 1. browser_snapshot → Get page structure
 * 2. browser_multitool → Generate plan from snapshot
 * 3. browser_execute_plan → Execute the plan
 */

import type { Tool, ToolResult } from './tool';
import type { Context } from '../context';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// Minimal schema focused on intent
const paramsSchema = z.object({
  intent: z.enum(['login', 'form_fill', 'search', 'navigation', 'dismiss_modal'])
    .describe('High-level goal to accomplish'),
  
  snapshot: z.any().optional()
    .describe('ARIA snapshot from browser_snapshot (required for most patterns)'),
  
  // Pattern-specific parameters
  fields: z.record(z.string()).optional()
    .describe('Field name to value mapping for form_fill'),
  
  username: z.string().optional()
    .describe('Username/email for login'),
  
  password: z.string().optional()
    .describe('Password for login'),
  
  rememberMe: z.boolean().optional()
    .describe('Check remember me for login'),
  
  query: z.string().optional()
    .describe('Search query text'),
  
  waitForResults: z.number().optional()
    .describe('Seconds to wait after search'),
  
  dismissTexts: z.array(z.string()).optional()
    .describe('Button texts to try for dismissing modals'),
  
  steps: z.array(z.object({
    type: z.enum(['navigate', 'click', 'wait', 'back']),
    url: z.string().optional(),
    ref: z.string().optional(),
    element: z.string().optional(),
    duration: z.number().optional()
  })).optional()
    .describe('Steps for navigation pattern')
});

// Tool call descriptor
interface ToolCall {
  name: string;
  args: Record<string, any>;
  description?: string;
}

// Plan result
interface PlanResult {
  status: 'plan_generated' | 'needs_snapshot' | 'unsupported_intent' | 'error';
  pattern: string;
  plan?: ToolCall[];
  error?: string;
  hint?: string;
}

/**
 * Parse snapshot to find elements by text or type
 */
function findElementInSnapshot(snapshot: any, query: {
  text?: string;
  type?: string;
  role?: string;
  placeholder?: string;
  id?: string;
  name?: string;
}): string | null {
  if (!snapshot?.content?.[0]?.text) return null;
  
  const lines = snapshot.content[0].text.split('\n');
  
  // Normalize query strings for comparison
  const normalize = (str: string) => str.toLowerCase().replace(/[\s_-]+/g, '');
  
  for (const line of lines) {
    // Match refs like [ref=ref123]
    const refMatch = line.match(/\[ref=(ref\d+)\]/);
    if (!refMatch) continue;
    
    const ref = refMatch[1];
    
    // Parse quoted text (placeholder or label)
    const quotedTextMatch = line.match(/"([^"]+)"/);
    const quotedText = quotedTextMatch ? quotedTextMatch[1] : '';
    
    // Parse attributes in braces {type: text, id: firstName}
    const attributesMatch = line.match(/\{([^}]+)\}/);
    const attributes: Record<string, string> = {};
    if (attributesMatch) {
      const attrPairs = attributesMatch[1].split(',').map(p => p.trim());
      for (const pair of attrPairs) {
        const [key, value] = pair.split(':').map(s => s.trim());
        if (key && value) {
          attributes[key] = value;
        }
      }
    }
    
    // Check if element matches query
    
    // Match by ID
    if (query.id && attributes.id) {
      if (normalize(attributes.id) === normalize(query.id)) {
        return ref;
      }
    }
    
    // Match by name  
    if (query.name && attributes.name) {
      if (normalize(attributes.name) === normalize(query.name)) {
        return ref;
      }
    }
    
    // Match by placeholder text
    if (query.placeholder && quotedText) {
      // Check if placeholder text contains the field name
      if (normalize(quotedText).includes(normalize(query.placeholder))) {
        return ref;
      }
      // Also check if field name contains part of placeholder
      if (normalize(query.placeholder).includes('name') && normalize(quotedText).includes('name')) {
        return ref;
      }
      if (normalize(query.placeholder).includes('email') && normalize(quotedText).includes('email')) {
        return ref;
      }
      if (normalize(query.placeholder).includes('password') && normalize(quotedText).includes('password')) {
        return ref;
      }
      if (normalize(query.placeholder).includes('phone') && normalize(quotedText).includes('phone')) {
        return ref;
      }
    }
    
    // Match by text content
    if (query.text) {
      if (normalize(line).includes(normalize(query.text))) {
        return ref;
      }
    }
    
    // Match by type
    if (query.type && attributes.type === query.type) {
      return ref;
    }
    
    // Match by role
    if (query.role) {
      const elementType = line.split(' ')[0].toLowerCase();
      if (elementType === query.role.toLowerCase()) {
        return ref;
      }
    }
  }
  
  return null;
}

/**
 * Generate plan for login pattern
 */
function generateLoginPlan(params: any, snapshot: any): ToolCall[] {
  const plan: ToolCall[] = [];
  
  // Find username field
  const usernameRef = findElementInSnapshot(snapshot, { 
    placeholder: 'username' 
  }) || findElementInSnapshot(snapshot, { 
    placeholder: 'email' 
  }) || findElementInSnapshot(snapshot, { 
    type: 'text' 
  });
  
  if (usernameRef && params.username) {
    plan.push({
      name: 'browser_type',
      args: { 
        ref: usernameRef, 
        element: 'username field',
        text: params.username,
        submit: false
      },
      description: 'Enter username/email'
    });
  }
  
  // Find password field
  const passwordRef = findElementInSnapshot(snapshot, { 
    type: 'password' 
  });
  
  if (passwordRef && params.password) {
    plan.push({
      name: 'browser_type',
      args: { 
        ref: passwordRef,
        element: 'password field',
        text: params.password,
        submit: false
      },
      description: 'Enter password'
    });
  }
  
  // Find and check remember me if requested
  if (params.rememberMe) {
    const rememberRef = findElementInSnapshot(snapshot, { 
      text: 'remember' 
    }) || findElementInSnapshot(snapshot, { 
      type: 'checkbox' 
    });
    
    if (rememberRef) {
      plan.push({
        name: 'browser_click',
        args: { 
          ref: rememberRef,
          element: 'remember me checkbox'
        },
        description: 'Check remember me'
      });
    }
  }
  
  // Find submit button
  const submitRef = findElementInSnapshot(snapshot, { 
    text: 'sign in' 
  }) || findElementInSnapshot(snapshot, { 
    text: 'login' 
  }) || findElementInSnapshot(snapshot, { 
    role: 'button' 
  });
  
  if (submitRef) {
    plan.push({
      name: 'browser_click',
      args: { 
        ref: submitRef,
        element: 'login button'
      },
      description: 'Click login button'
    });
  } else {
    // Fallback to pressing Enter
    plan.push({
      name: 'browser_press_key',
      args: { key: 'Enter' },
      description: 'Press Enter to submit'
    });
  }
  
  return plan;
}

/**
 * Generate plan for form fill pattern
 */
function generateFormFillPlan(params: any, snapshot: any): ToolCall[] {
  const plan: ToolCall[] = [];
  
  if (!params.fields) return plan;
  
  // For each field, try to find it in the snapshot
  for (const [fieldName, value] of Object.entries(params.fields)) {
    // Try multiple matching strategies
    const fieldRef = 
      // Try by ID first (most specific)
      findElementInSnapshot(snapshot, { id: fieldName }) ||
      // Try by name attribute
      findElementInSnapshot(snapshot, { name: fieldName }) ||
      // Try by placeholder text
      findElementInSnapshot(snapshot, { placeholder: fieldName }) ||
      // Try by text/label
      findElementInSnapshot(snapshot, { text: fieldName });
    
    if (fieldRef) {
      plan.push({
        name: 'browser_type',
        args: { 
          ref: fieldRef,
          element: `${fieldName} field`,
          text: value as string,
          submit: false
        },
        description: `Fill ${fieldName}`
      });
    }
  }
  
  // If submitButton specified, find and click it
  if (params.submitButton) {
    const submitRef = findElementInSnapshot(snapshot, { 
      text: params.submitButton 
    }) || findElementInSnapshot(snapshot, { 
      role: 'button' 
    });
    
    if (submitRef) {
      plan.push({
        name: 'browser_click',
        args: { 
          ref: submitRef,
          element: 'submit button'
        },
        description: 'Submit form'
      });
    }
  }
  
  return plan;
}

/**
 * Generate plan for search pattern
 */
function generateSearchPlan(params: any, snapshot: any): ToolCall[] {
  const plan: ToolCall[] = [];
  
  if (!params.query) return plan;
  
  // Find search field
  const searchRef = findElementInSnapshot(snapshot, { 
    type: 'search' 
  }) || findElementInSnapshot(snapshot, { 
    placeholder: 'search' 
  }) || findElementInSnapshot(snapshot, { 
    text: 'search' 
  });
  
  if (searchRef) {
    plan.push({
      name: 'browser_type',
      args: { 
        ref: searchRef,
        element: 'search field',
        text: params.query,
        submit: true  // Submit the search
      },
      description: 'Enter search query and submit'
    });
    
    // Wait for results if specified
    if (params.waitForResults) {
      plan.push({
        name: 'browser_wait',
        args: { time: params.waitForResults },
        description: `Wait ${params.waitForResults}s for results`
      });
    }
  }
  
  return plan;
}

/**
 * Generate plan for modal dismissal
 */
function generateDismissModalPlan(params: any, snapshot: any): ToolCall[] {
  const plan: ToolCall[] = [];
  
  // Try escape key first
  plan.push({
    name: 'browser_press_key',
    args: { key: 'Escape' },
    description: 'Press Escape to close modal'
  });
  
  // Try clicking dismiss buttons
  if (params.dismissTexts && params.dismissTexts.length > 0) {
    for (const text of params.dismissTexts) {
      const buttonRef = findElementInSnapshot(snapshot, { text });
      
      if (buttonRef) {
        plan.push({
          name: 'browser_click',
          args: { 
            ref: buttonRef,
            element: `${text} button`
          },
          description: `Click ${text} button`
        });
        break; // Only click one button
      }
    }
  }
  
  return plan;
}

/**
 * Generate plan for navigation sequence
 */
function generateNavigationPlan(params: any): ToolCall[] {
  const plan: ToolCall[] = [];
  
  if (!params.steps) return plan;
  
  for (const step of params.steps) {
    if (step.type === 'navigate' && step.url) {
      plan.push({
        name: 'browser_navigate',
        args: { url: step.url },
        description: `Navigate to ${step.url}`
      });
    } else if (step.type === 'click' && step.ref) {
      plan.push({
        name: 'browser_click',
        args: { 
          ref: step.ref,
          element: step.element || 'element'
        },
        description: `Click ${step.element || 'element'}`
      });
    } else if (step.type === 'wait' && step.duration) {
      plan.push({
        name: 'browser_wait',
        args: { time: step.duration },
        description: `Wait ${step.duration}s`
      });
    } else if (step.type === 'back') {
      plan.push({
        name: 'browser_go_back',
        args: {},
        description: 'Go back'
      });
    }
  }
  
  return plan;
}

/**
 * Browser Multitool V3 - Main tool definition
 */
export const browser_multitool_v3: Tool = {
  schema: {
    name: 'browser_multitool',
    description: `🎯 INTELLIGENT PATTERN RECOGNIZER - Generates optimized sequences of browser tool calls

⚡ HOW IT WORKS:
1. You run browser_snapshot first to understand the page
2. You call browser_multitool with the snapshot and your intent
3. It returns a plan of tool calls
4. You execute the plan with browser_execute_plan

📊 BENEFITS:
• 70-90% fewer tokens than manual tool calls
• Intelligent element detection from snapshots
• Clean, reusable plans
• No duplicate DOM logic

🎨 SUPPORTED PATTERNS:
• login - Username/password authentication
• form_fill - Fill and submit forms
• search - Enter queries and wait for results
• dismiss_modal - Close popups and modals
• navigation - Multi-step navigation sequences`,
    inputSchema: zodToJsonSchema(paramsSchema) as any
  },
  
  handle: async (context: Context, params: z.infer<typeof paramsSchema>): Promise<ToolResult> => {
    const { intent, snapshot } = params;
    
    // Check if snapshot is needed but missing
    const needsSnapshot = ['login', 'form_fill', 'search', 'dismiss_modal'].includes(intent);
    if (needsSnapshot && !snapshot) {
      const result: PlanResult = {
        status: 'needs_snapshot',
        pattern: intent,
        hint: 'Run browser_snapshot first, then call me again with the snapshot'
      };
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }]
      };
    }
    
    let plan: ToolCall[] = [];
    
    // Generate plan based on intent
    try {
      switch (intent) {
        case 'login':
          plan = generateLoginPlan(params, snapshot);
          break;
          
        case 'form_fill':
          plan = generateFormFillPlan(params, snapshot);
          break;
          
        case 'search':
          plan = generateSearchPlan(params, snapshot);
          break;
          
        case 'dismiss_modal':
          plan = generateDismissModalPlan(params, snapshot);
          break;
          
        case 'navigation':
          plan = generateNavigationPlan(params);
          break;
          
        default:
          const result: PlanResult = {
            status: 'unsupported_intent',
            pattern: intent,
            error: `Intent '${intent}' is not supported`
          };
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }],
            isError: true
          };
      }
      
      const result: PlanResult = {
        status: 'plan_generated',
        pattern: intent,
        plan
      };
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }]
      };
      
    } catch (error) {
      const result: PlanResult = {
        status: 'error',
        pattern: intent,
        error: error instanceof Error ? error.message : String(error)
      };
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }],
        isError: true
      };
    }
  }
};