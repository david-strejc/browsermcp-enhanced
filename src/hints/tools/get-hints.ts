import { Tool } from '../../tools/tool.js';
import { BrowserMCPError } from '../../utils/error-recovery.js';
import { HintStore } from '../core/hint-store.js';
import { BrowserHint } from '../types.js';

export const browser_get_hints: Tool = {
  schema: {
    name: 'browser_get_hints',
    description: 'Retrieve hints for a specific URL or domain to automate browser interactions',
    inputSchema: {
      type: 'object',
      properties: {
        url: { 
          type: 'string', 
          description: 'URL to get hints for' 
        },
        include_domain_hints: { 
          type: 'boolean',
          description: 'Include domain-wide hints in addition to page-specific ones',
          default: true
        },
        min_confidence: {
          type: 'number',
          description: 'Minimum confidence threshold (0-1), default 0.3'
        },
        pattern_type: {
          type: 'string',
          enum: ['login', 'form_fill', 'navigation', 'interaction', 'wait', 'modal', 'dynamic', 'search', 'upload', 'pagination'],
          description: 'Filter by specific pattern type'
        },
        limit: {
          type: 'number',
          description: 'Maximum hints to return (default 5)'
        }
      },
      required: ['url']
    }
  },
  
  handle: async (context, params) => {
    try {
      const store = new HintStore();
      
      // Get hints for the URL
      const hints = await store.getHints(params.url, params.limit || 5);
      
      // Filter by confidence
      let filtered = hints.filter(h => 
        h.confidence >= (params.min_confidence || 0.3)
      );
      
      // Filter by pattern type if specified
      if (params.pattern_type) {
        filtered = filtered.filter(h => h.pattern_type === params.pattern_type);
      }
      
      // Include domain hints if not already included and requested
      if (params.include_domain_hints !== false) {
        const urlObj = new URL(params.url);
        const domain = urlObj.hostname;
        
        // Check if we need more domain hints
        const pageSpecificCount = filtered.filter(h => h.path_pattern).length;
        if (pageSpecificCount < (params.limit || 5)) {
          const domainHints = await store.getHints(`https://${domain}`, 3);
          
          // Add domain hints that aren't duplicates
          const existingIds = new Set(filtered.map(h => h.id));
          for (const hint of domainHints) {
            if (!existingIds.has(hint.id) && 
                hint.confidence >= (params.min_confidence || 0.3)) {
              filtered.push(hint);
            }
          }
        }
      }
      
      // Sort by relevance (confidence * recency)
      filtered.sort((a, b) => {
        const scoreA = a.confidence * (a.last_success_at ? 1.2 : 1);
        const scoreB = b.confidence * (b.last_success_at ? 1.2 : 1);
        return scoreB - scoreA;
      });
      
      // Limit results
      const results = filtered.slice(0, params.limit || 5);
      
      // Format hints for Claude
      const formattedHints = results.map(formatHintForClaude);
      
      return {
        status: 'success',
        hints: formattedHints,
        total_found: filtered.length,
        applied_filters: {
          min_confidence: params.min_confidence || 0.3,
          pattern_type: params.pattern_type,
          include_domain: params.include_domain_hints !== false
        }
      };
      
    } catch (error) {
      throw new BrowserMCPError(
        `Failed to retrieve hints: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'HINT_RETRIEVE_ERROR',
        false
      );
    }
  }
};

/**
 * Format hint for Claude to easily understand and use
 */
function formatHintForClaude(hint: BrowserHint) {
  return {
    id: hint.id,
    pattern_type: hint.pattern_type,
    description: hint.description,
    confidence: Math.round(hint.confidence * 100) + '%',
    
    // Scope
    scope: {
      domain: hint.domain,
      path: hint.path_pattern || 'any',
      requires_element: hint.selector_guard
    },
    
    // Recipe with clear steps
    recipe: hint.recipe.map((step, index) => ({
      step: index + 1,
      tool: step.tool,
      args: step.args,
      ...(step.wait_after && { wait_after_ms: step.wait_after }),
      ...(step.retry_on_failure && { retry_on_failure: true })
    })),
    
    // Context if any
    ...(hint.context && { context: hint.context }),
    
    // Usage stats
    stats: {
      success_count: hint.success_count,
      failure_count: hint.failure_count,
      last_used: hint.last_used_at ? new Date(hint.last_used_at).toISOString() : 'never',
      last_success: hint.last_success_at ? new Date(hint.last_success_at).toISOString() : 'never'
    }
  };
}