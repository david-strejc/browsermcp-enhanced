/**
 * Advanced patterns for BrowserMCP Multitool
 * These patterns handle more complex scenarios like shadow DOM, infinite scroll, 
 * modal handling, and multi-step workflows
 */

import { Pattern, PatternStep, PatternResult, MultitoolContext, FieldDetector } from './multitool';

// Shadow DOM Navigation Pattern (for Challenge 1)
export class ShadowDOMPattern implements Pattern {
  name = 'shadow_dom';
  description = 'Navigates through shadow DOM to find and interact with elements';
  requiredParams = ['targetText'];
  optionalParams = ['maxDepth', 'shadowHosts'];

  async canHandle(context: MultitoolContext): Promise<boolean> {
    if (context.params.pattern === this.name) return true;
    
    // Check if page has shadow roots
    const hasShadowDOM = context.params.shadowHosts || 
                         context.snapshot?.elements?.some((el: any) => 
                           el.shadowRoot === true
                         );
    return hasShadowDOM && !!context.params.targetText;
  }

  async *execute(context: MultitoolContext): AsyncGenerator<PatternStep, PatternResult, unknown> {
    const startTime = Date.now();
    let stepCount = 0;
    const maxDepth = context.params.maxDepth || 3;

    try {
      // Use JS to traverse shadow DOM
      yield {
        action: 'browser_execute_js',
        params: {
          code: `
            function findInShadowDOM(root, text, depth = 0, maxDepth = ${maxDepth}) {
              if (depth > maxDepth) return null;
              
              // Check current level
              const elements = root.querySelectorAll('*');
              for (const el of elements) {
                if (el.textContent?.includes('${context.params.targetText}')) {
                  if (el.tagName === 'BUTTON' || el.onclick) {
                    el.setAttribute('data-multitool-target', 'true');
                    return el;
                  }
                }
                
                // Check shadow root
                if (el.shadowRoot) {
                  const found = findInShadowDOM(el.shadowRoot, text, depth + 1, maxDepth);
                  if (found) return found;
                }
              }
              return null;
            }
            
            const target = findInShadowDOM(document, '${context.params.targetText}');
            if (target) {
              target.click();
              return { found: true, depth: target.getAttribute('data-shadow-depth') };
            }
            return { found: false };
          `,
          unsafe: true
        },
        description: `Searching shadow DOM for: ${context.params.targetText}`
      };
      stepCount++;

      return {
        success: true,
        pattern: this.name,
        steps: stepCount,
        duration: Date.now() - startTime
      };
    } catch (error) {
      return {
        success: false,
        pattern: this.name,
        error: error.message,
        steps: stepCount,
        duration: Date.now() - startTime
      };
    }
  }

  async recover(error: Error, context: MultitoolContext): Promise<boolean> {
    // Try increasing depth or waiting for shadow DOM to render
    if (context.retryCount < 2) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      context.params.maxDepth = (context.params.maxDepth || 3) + 1;
      return true;
    }
    return false;
  }
}

// Modal Dismissal Pattern
export class ModalDismissalPattern implements Pattern {
  name = 'dismiss_modals';
  description = 'Detects and dismisses modal overlays, popups, and cookie banners';
  requiredParams = [];
  optionalParams = ['dismissTexts', 'escapeKey'];

  async canHandle(context: MultitoolContext): Promise<boolean> {
    if (context.params.pattern === this.name) return true;
    
    // Check for common modal indicators
    const hasModal = context.snapshot?.elements?.some((el: any) => 
      el.className?.includes('modal') ||
      el.className?.includes('overlay') ||
      el.className?.includes('popup') ||
      el.className?.includes('cookie') ||
      el.role === 'dialog' ||
      (el.style?.zIndex && parseInt(el.style.zIndex) > 1000)
    );
    
    return hasModal;
  }

  async *execute(context: MultitoolContext): AsyncGenerator<PatternStep, PatternResult, unknown> {
    const startTime = Date.now();
    let stepCount = 0;
    let dismissedCount = 0;

    try {
      // Common dismiss button texts
      const dismissTexts = context.params.dismissTexts || [
        'close', 'dismiss', 'accept', 'ok', 'got it', 'continue',
        'no thanks', 'skip', '×', '✕', 'X'
      ];

      // Try escape key first
      if (context.params.escapeKey !== false) {
        yield {
          action: 'browser_press_key',
          params: { key: 'Escape' },
          description: 'Pressing Escape to dismiss modals',
          optional: true
        };
        stepCount++;

        yield {
          action: 'browser_wait',
          params: { time: 0.5 },
          optional: true
        };
      }

      // Get fresh snapshot
      yield {
        action: 'browser_snapshot',
        params: { level: 'minimal' },
        description: 'Checking for modals'
      };
      stepCount++;

      // Find dismiss buttons
      for (const text of dismissTexts) {
        const dismissButton = context.snapshot?.elements?.find((el: any) => {
          const elementText = (el.text || '').toLowerCase();
          const ariaLabel = (el.attributes?.['aria-label'] || '').toLowerCase();
          
          return (elementText.includes(text.toLowerCase()) ||
                  ariaLabel.includes(text.toLowerCase())) &&
                 (el.tag === 'button' || el.role === 'button' || el.onclick);
        });

        if (dismissButton) {
          yield {
            action: 'browser_click',
            params: {
              ref: dismissButton.ref,
              element: `dismiss button (${text})`
            },
            description: `Clicking ${text} button`
          };
          stepCount++;
          dismissedCount++;

          // Wait for animation
          yield {
            action: 'browser_wait',
            params: { time: 0.5 },
            optional: true
          };
        }
      }

      // Use common operation as fallback
      yield {
        action: 'browser_common_operation',
        params: { operation: 'hide_popups' },
        description: 'Running popup removal',
        optional: true
      };
      stepCount++;

      return {
        success: true,
        pattern: this.name,
        data: { dismissedCount },
        steps: stepCount,
        duration: Date.now() - startTime
      };
    } catch (error) {
      return {
        success: false,
        pattern: this.name,
        error: error.message,
        steps: stepCount,
        duration: Date.now() - startTime
      };
    }
  }

  async recover(error: Error, context: MultitoolContext): Promise<boolean> {
    // Try clicking outside modal
    if (context.retryCount < 1) {
      return true;
    }
    return false;
  }
}

// Infinite Scroll Pattern (for Challenge 5)
export class InfiniteScrollPattern implements Pattern {
  name = 'infinite_scroll';
  description = 'Scrolls through infinite content to find specific element';
  requiredParams = ['targetText'];
  optionalParams = ['maxScrolls', 'scrollDelay', 'scrollAmount'];

  async canHandle(context: MultitoolContext): Promise<boolean> {
    if (context.params.pattern === this.name) return true;
    return !!context.params.targetText && !!context.params.scrollToFind;
  }

  async *execute(context: MultitoolContext): AsyncGenerator<PatternStep, PatternResult, unknown> {
    const startTime = Date.now();
    let stepCount = 0;
    const maxScrolls = context.params.maxScrolls || 50;
    const scrollDelay = context.params.scrollDelay || 1;
    let found = false;
    let scrollCount = 0;

    try {
      for (let i = 0; i < maxScrolls && !found; i++) {
        // Check current viewport for target
        yield {
          action: 'browser_execute_js',
          params: {
            code: `
              const elements = document.querySelectorAll('*');
              let found = false;
              for (const el of elements) {
                if (el.textContent?.includes('${context.params.targetText}')) {
                  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  el.setAttribute('data-multitool-found', 'true');
                  found = true;
                  break;
                }
              }
              if (!found) {
                window.scrollBy(0, window.innerHeight * 0.8);
              }
              return { found, scrollY: window.scrollY };
            `,
            unsafe: true
          },
          description: `Scrolling to find: ${context.params.targetText}`
        };
        stepCount++;
        scrollCount++;

        // Wait for content to load
        yield {
          action: 'browser_wait',
          params: { time: scrollDelay },
          description: 'Waiting for content to load'
        };

        // Check if found
        yield {
          action: 'browser_execute_js',
          params: {
            code: `
              const target = document.querySelector('[data-multitool-found="true"]');
              if (target) {
                // Interact with found element
                if (target.tagName === 'BUTTON' || target.onclick) {
                  target.click();
                }
                return { found: true, interacted: true };
              }
              return { found: false };
            `,
            unsafe: true
          },
          description: 'Checking for target element'
        };
        stepCount++;

        // Check result
        const checkResult = context.results.lastCheck;
        if (checkResult?.found) {
          found = true;
          break;
        }
      }

      return {
        success: found,
        pattern: this.name,
        data: { 
          found,
          scrollCount,
          targetText: context.params.targetText
        },
        steps: stepCount,
        duration: Date.now() - startTime
      };
    } catch (error) {
      return {
        success: false,
        pattern: this.name,
        error: error.message,
        steps: stepCount,
        duration: Date.now() - startTime
      };
    }
  }

  async recover(error: Error, context: MultitoolContext): Promise<boolean> {
    // Try scrolling to top and searching again
    if (context.retryCount < 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      return true;
    }
    return false;
  }
}

// Rate Limited Interaction Pattern (for Challenge 3)
export class RateLimitedPattern implements Pattern {
  name = 'rate_limited';
  description = 'Performs actions while respecting rate limits';
  requiredParams = ['actions'];
  optionalParams = ['requestsPerWindow', 'windowSize', 'retryAfter'];

  async canHandle(context: MultitoolContext): Promise<boolean> {
    if (context.params.pattern === this.name) return true;
    return Array.isArray(context.params.actions) && !!context.params.rateLimit;
  }

  async *execute(context: MultitoolContext): AsyncGenerator<PatternStep, PatternResult, unknown> {
    const startTime = Date.now();
    let stepCount = 0;
    const actions = context.params.actions as any[];
    const requestsPerWindow = context.params.requestsPerWindow || 2;
    const windowSize = context.params.windowSize || 5000;
    const retryAfter = context.params.retryAfter || 4000;
    
    const requestTimes: number[] = [];
    const results: any[] = [];

    try {
      for (const action of actions) {
        // Check rate limit
        const now = Date.now();
        const recentRequests = requestTimes.filter(t => now - t < windowSize);
        
        if (recentRequests.length >= requestsPerWindow) {
          // Wait for rate limit reset
          const oldestRequest = recentRequests[0];
          const waitTime = Math.max(0, windowSize - (now - oldestRequest));
          
          yield {
            action: 'browser_wait',
            params: { time: waitTime / 1000 },
            description: `Rate limited - waiting ${waitTime}ms`
          };
          
          // Clean old requests
          requestTimes.splice(0, requestTimes.length - requestsPerWindow + 1);
        }

        // Execute action
        requestTimes.push(Date.now());
        
        if (action.type === 'click') {
          yield {
            action: 'browser_click',
            params: action.params,
            description: action.description
          };
        } else if (action.type === 'type') {
          yield {
            action: 'browser_type',
            params: action.params,
            description: action.description
          };
        }
        
        stepCount++;
        results.push({ 
          action: action.type, 
          timestamp: Date.now(),
          success: true 
        });

        // Small delay between actions
        yield {
          action: 'browser_wait',
          params: { time: 0.5 },
          optional: true
        };
      }

      return {
        success: true,
        pattern: this.name,
        data: { 
          completedActions: results.length,
          totalActions: actions.length
        },
        steps: stepCount,
        duration: Date.now() - startTime
      };
    } catch (error) {
      return {
        success: false,
        pattern: this.name,
        error: error.message,
        data: { completedActions: results.length },
        steps: stepCount,
        duration: Date.now() - startTime
      };
    }
  }

  async recover(error: Error, context: MultitoolContext): Promise<boolean> {
    // Wait for rate limit to reset
    if (error.message.includes('rate') && context.retryCount < 3) {
      const retryAfter = context.params.retryAfter || 4000;
      await new Promise(resolve => setTimeout(resolve, retryAfter));
      return true;
    }
    return false;
  }
}

// Multi-Step Workflow Pattern
export class MultiStepWorkflowPattern implements Pattern {
  name = 'multi_step_workflow';
  description = 'Executes a complex multi-step workflow with conditional logic';
  requiredParams = ['workflow'];
  optionalParams = ['checkpoints', 'rollbackOnError'];

  async canHandle(context: MultitoolContext): Promise<boolean> {
    if (context.params.pattern === this.name) return true;
    return !!context.params.workflow;
  }

  async *execute(context: MultitoolContext): AsyncGenerator<PatternStep, PatternResult, unknown> {
    const startTime = Date.now();
    let stepCount = 0;
    const workflow = context.params.workflow as any;
    const checkpoints: any[] = [];

    try {
      for (const stage of workflow.stages) {
        // Save checkpoint
        if (context.params.checkpoints) {
          yield {
            action: 'browser_snapshot',
            params: { level: 'minimal' },
            description: `Checkpoint: ${stage.name}`
          };
          checkpoints.push({
            stage: stage.name,
            snapshot: context.snapshot
          });
        }

        // Check condition if specified
        if (stage.condition) {
          const conditionMet = await this.evaluateCondition(stage.condition, context);
          if (!conditionMet) {
            continue; // Skip this stage
          }
        }

        // Execute stage actions
        for (const action of stage.actions) {
          yield {
            action: action.tool,
            params: action.params,
            description: `${stage.name}: ${action.description}`
          };
          stepCount++;

          // Wait between actions if specified
          if (stage.waitBetween) {
            yield {
              action: 'browser_wait',
              params: { time: stage.waitBetween },
              optional: true
            };
          }
        }

        // Verify stage completion if specified
        if (stage.verify) {
          const verified = await this.verifyStage(stage.verify, context);
          if (!verified && stage.required) {
            throw new Error(`Stage ${stage.name} verification failed`);
          }
        }
      }

      return {
        success: true,
        pattern: this.name,
        data: { 
          completedStages: workflow.stages.length,
          checkpoints: checkpoints.length
        },
        steps: stepCount,
        duration: Date.now() - startTime
      };
    } catch (error) {
      // Rollback if specified
      if (context.params.rollbackOnError && checkpoints.length > 0) {
        // Could implement rollback logic here
      }

      return {
        success: false,
        pattern: this.name,
        error: error.message,
        steps: stepCount,
        duration: Date.now() - startTime
      };
    }
  }

  private async evaluateCondition(condition: any, context: MultitoolContext): Promise<boolean> {
    // Implement condition evaluation logic
    if (condition.type === 'element_exists') {
      return context.snapshot?.elements?.some((el: any) => 
        el.selector === condition.selector
      );
    }
    return true;
  }

  private async verifyStage(verify: any, context: MultitoolContext): Promise<boolean> {
    // Implement verification logic
    if (verify.type === 'url_contains') {
      // Would need current URL from context
      return true;
    }
    return true;
  }

  async recover(error: Error, context: MultitoolContext): Promise<boolean> {
    // Could implement stage-specific recovery
    return false;
  }
}

// Data Extraction Pattern
export class DataExtractionPattern implements Pattern {
  name = 'extract_data';
  description = 'Extracts structured data from pages';
  requiredParams = ['selectors'];
  optionalParams = ['format', 'pagination'];

  async canHandle(context: MultitoolContext): Promise<boolean> {
    if (context.params.pattern === this.name) return true;
    return !!context.params.extract && !!context.params.selectors;
  }

  async *execute(context: MultitoolContext): AsyncGenerator<PatternStep, PatternResult, unknown> {
    const startTime = Date.now();
    let stepCount = 0;
    const extractedData: any[] = [];

    try {
      // Get page snapshot
      yield {
        action: 'browser_snapshot',
        params: { level: 'full' },
        description: 'Getting page content for extraction'
      };
      stepCount++;

      // Extract data using selectors
      const selectors = context.params.selectors as Record<string, string>;
      
      yield {
        action: 'browser_execute_js',
        params: {
          code: `
            const data = [];
            const selectors = ${JSON.stringify(selectors)};
            
            // Find container elements
            const containers = document.querySelectorAll(selectors.container || '*');
            
            for (const container of containers) {
              const item = {};
              for (const [key, selector] of Object.entries(selectors)) {
                if (key === 'container') continue;
                const element = container.querySelector(selector);
                if (element) {
                  item[key] = element.textContent?.trim() || 
                             element.getAttribute('href') ||
                             element.getAttribute('src');
                }
              }
              if (Object.keys(item).length > 0) {
                data.push(item);
              }
            }
            return data;
          `,
          unsafe: true
        },
        description: 'Extracting data from page'
      };
      stepCount++;

      // Handle pagination if specified
      if (context.params.pagination) {
        const maxPages = context.params.pagination.maxPages || 5;
        
        for (let page = 1; page < maxPages; page++) {
          // Click next button
          const nextButton = context.snapshot?.elements?.find((el: any) => 
            el.text?.toLowerCase().includes('next') ||
            el.attributes?.['aria-label']?.toLowerCase().includes('next')
          );

          if (!nextButton) break;

          yield {
            action: 'browser_click',
            params: {
              ref: nextButton.ref,
              element: 'next page button'
            },
            description: `Going to page ${page + 1}`
          };
          stepCount++;

          // Wait for page load
          yield {
            action: 'browser_wait',
            params: { time: 2 },
            description: 'Waiting for page to load'
          };

          // Extract from new page
          yield {
            action: 'browser_execute_js',
            params: {
              code: `/* Same extraction code */`,
              unsafe: true
            },
            description: `Extracting data from page ${page + 1}`
          };
          stepCount++;
        }
      }

      return {
        success: true,
        pattern: this.name,
        data: { 
          extracted: extractedData,
          itemCount: extractedData.length
        },
        steps: stepCount,
        duration: Date.now() - startTime
      };
    } catch (error) {
      return {
        success: false,
        pattern: this.name,
        error: error.message,
        data: { extracted: extractedData },
        steps: stepCount,
        duration: Date.now() - startTime
      };
    }
  }

  async recover(error: Error, context: MultitoolContext): Promise<boolean> {
    return false;
  }
}

// Export function to register all advanced patterns
export function registerAdvancedPatterns(multitool: any): void {
  multitool.registerPattern(new ShadowDOMPattern());
  multitool.registerPattern(new ModalDismissalPattern());
  multitool.registerPattern(new InfiniteScrollPattern());
  multitool.registerPattern(new RateLimitedPattern());
  multitool.registerPattern(new MultiStepWorkflowPattern());
  multitool.registerPattern(new DataExtractionPattern());
}