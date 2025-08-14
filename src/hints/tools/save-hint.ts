import { Tool } from '../../tools/tool.js';
import { BrowserMCPError } from '../../utils/error-recovery.js';
import { HintStore } from '../core/hint-store.js';
import { PatternType } from '../types.js';

export const browser_save_hint: Tool = {
  schema: {
    name: 'browser_save_hint',
    description: 'Save a successful browser automation pattern as a reusable hint for future Claudes',
    inputSchema: {
      type: 'object',
      properties: {
        url: { 
          type: 'string', 
          description: 'The URL where pattern was discovered (will extract domain and path)' 
        },
        pattern_type: { 
          type: 'string',
          enum: ['login', 'form_fill', 'navigation', 'interaction', 'wait', 'modal', 'dynamic', 'search', 'upload', 'pagination'],
          description: 'Type of automation pattern'
        },
        selector_guard: { 
          type: 'string',
          description: 'CSS selector that must exist for hint to apply (e.g., "input[name=email]")'
        },
        recipe: {
          type: 'array',
          description: 'Sequence of tool calls that worked',
          items: {
            type: 'object',
            properties: {
              tool: { type: 'string', description: 'Tool name (e.g., browser_type, browser_click)' },
              args: { type: 'object', description: 'Arguments for the tool' },
              wait_after: { type: 'number', description: 'Optional ms to wait after this step' },
              retry_on_failure: { type: 'boolean', description: 'Whether to retry if step fails' }
            },
            required: ['tool', 'args']
          }
        },
        description: {
          type: 'string',
          description: 'One-line explanation of what this hint does (max 200 chars)'
        },
        context: {
          type: 'object',
          description: 'Optional context requirements',
          properties: {
            viewport_min: {
              type: 'object',
              properties: {
                width: { type: 'number' },
                height: { type: 'number' }
              }
            },
            requires_auth: { type: 'boolean' },
            locale: { type: 'string' },
            user_agent_pattern: { type: 'string' }
          }
        },
        confidence_override: {
          type: 'number',
          description: 'Optional initial confidence (0-1), defaults to 0.8 for new hints'
        }
      },
      required: ['url', 'pattern_type', 'recipe', 'description']
    }
  },
  
  handle: async (context, params) => {
    try {
      const store = new HintStore();
      
      // Parse URL to extract domain and path
      const urlObj = new URL(params.url);
      const domain = urlObj.hostname;
      const path = urlObj.pathname;
      
      // Determine path pattern (exact or with wildcards)
      let pathPattern: string | undefined;
      if (path !== '/' && path !== '') {
        // For login/auth pages, use exact path
        if (params.pattern_type === 'login') {
          pathPattern = path;
        } else {
          // For other patterns, use path prefix
          pathPattern = path.endsWith('/') ? `${path}*` : `${path}/*`;
        }
      }
      
      // Check for existing hints
      const existing = await store.getHints(params.url, 10);
      const similarHints = existing.filter(h => 
        h.pattern_type === params.pattern_type &&
        h.selector_guard === params.selector_guard
      );
      
      if (similarHints.length > 0) {
        // Conflict detected
        const best = similarHints[0];
        
        // If new hint seems better (user explicitly saved it), deactivate old one
        if (params.confidence_override && params.confidence_override > best.confidence) {
          await store.deactivateHint(best.id);
        } else {
          return {
            status: 'conflict',
            message: `Similar hint already exists with ${Math.round(best.confidence * 100)}% confidence`,
            existing_hint: {
              id: best.id,
              description: best.description,
              confidence: best.confidence
            }
          };
        }
      }
      
      // Save the hint
      const hintId = await store.saveHint({
        domain,
        path_pattern: pathPattern,
        pattern_type: params.pattern_type as PatternType,
        selector_guard: params.selector_guard,
        recipe: params.recipe,
        description: params.description.substring(0, 200),
        context: params.context,
        confidence: params.confidence_override || 0.8,
        dom_fingerprint: context.lastDomFingerprint // If available from navigation
      });
      
      return {
        status: 'success',
        hint_id: hintId,
        message: `Hint saved successfully for ${domain}${pathPattern || ''}`,
        details: {
          domain,
          path_pattern: pathPattern,
          pattern_type: params.pattern_type,
          recipe_steps: params.recipe.length
        }
      };
      
    } catch (error) {
      throw new BrowserMCPError(
        `Failed to save hint: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'HINT_SAVE_ERROR',
        false
      );
    }
  }
};