/**
 * Surgically Precise Hint Engine
 * Context-aware, adaptive recovery strategies with edge case handling
 */

import { FeedbackCode } from '../types/feedback';

// Hint codes for token efficiency
export enum HintCode {
  // Basic strategies
  RETRY_SIMPLE = 'H1',         // Simple retry
  RETRY_WITH_WAIT = 'H2',      // Wait then retry
  REFRESH_SNAPSHOT = 'H3',     // Get new snapshot
  USE_JAVASCRIPT = 'H4',        // Execute JS
  CHECK_CONSOLE = 'H5',        // Check logs
  
  // Advanced strategies  
  QUERY_SHADOW_DOM = 'A1',     // Shadow DOM traversal
  SWITCH_IFRAME = 'A2',         // iframe navigation
  DISMISS_MODAL = 'A3',         // Modal/popup handling
  HANDLE_AUTH = 'A4',           // Authentication flow
  SCROLL_TO_ELEMENT = 'A5',     // Viewport positioning
  
  // Edge case strategies
  WAIT_FOR_NETWORK = 'E1',     // XHR/fetch completion
  BYPASS_RATE_LIMIT = 'E2',    // Rate limiting
  HANDLE_AB_TEST = 'E3',        // A/B variations
  CLEAR_OVERLAYS = 'E4',        // Remove blocking elements
  FORCE_INTERACTION = 'E5',     // Override restrictions
  
  // Compound strategies
  PARALLEL_ATTEMPTS = 'P1',     // Try multiple approaches
  CASCADE_RECOVERY = 'P2',      // Sequential fallbacks
  DIAGNOSTIC_SUITE = 'P3',      // Full diagnosis
}

// Recovery macros - multi-step strategies
export const RecoveryMacros = {
  MODAL_DISMISS: [
    { tool: 'browser_execute_js', code: `document.querySelectorAll('[class*="modal"], [class*="popup"], [class*="overlay"]').forEach(el => el.remove())` },
    { tool: 'browser_wait', time: 0.5 },
    { tool: 'browser_snapshot', level: 'minimal' }
  ],
  
  SHADOW_FIND: [
    { tool: 'browser_execute_js', code: `
      function findInShadow(selector) {
        const shadows = [...document.querySelectorAll('*')].filter(el => el.shadowRoot);
        for (const el of shadows) {
          const found = el.shadowRoot.querySelector(selector);
          if (found) return found;
        }
        return null;
      }
      return findInShadow('[TARGET]');
    `}
  ],
  
  IFRAME_SWITCH: [
    { tool: 'browser_execute_js', code: `document.querySelectorAll('iframe').length` },
    { tool: 'browser_execute_js', code: `
      const iframe = document.querySelector('iframe');
      if (iframe) {
        try {
          return iframe.contentDocument ? 'accessible' : 'cross-origin';
        } catch (e) {
          return 'cross-origin';
        }
      }
    `}
  ],
  
  RACE_LOAD: {
    parallel: [
      [{ tool: 'browser_wait', time: 0.5 }, { tool: 'retry' }],
      [{ tool: 'browser_execute_js', code: 'window.scrollTo(0, document.body.scrollHeight)' }]
    ]
  },
  
  AUTH_WALL: [
    { tool: 'browser_snapshot', level: 'minimal' },
    { tool: 'browser_execute_js', code: `!!document.querySelector('[type="password"], [name*="login"], .auth, .signin')` },
    { condition: 'if_true', hint: 'Authentication required. Login first or check cookies.' }
  ]
};

// Edge case detection
export interface EdgeCaseFlags {
  SHADOW_DOM: boolean;
  IN_IFRAME: boolean;
  CROSS_ORIGIN: boolean;
  OFF_VIEWPORT: boolean;
  RATE_LIMITED: boolean;
  AB_VARIANT: boolean;
  DYNAMIC_CONTENT: boolean;
  LAZY_LOADED: boolean;
  PROTECTED_ELEMENT: boolean;
  ASYNC_LOADING: boolean;
}

export class EdgeCaseDetector {
  detect(context: any): EdgeCaseFlags {
    return {
      SHADOW_DOM: this.hasShadowDOM(context),
      IN_IFRAME: this.isInIframe(context),
      CROSS_ORIGIN: this.isCrossOrigin(context),
      OFF_VIEWPORT: this.isOffViewport(context),
      RATE_LIMITED: this.isRateLimited(context),
      AB_VARIANT: this.hasABTest(context),
      DYNAMIC_CONTENT: this.isDynamic(context),
      LAZY_LOADED: this.isLazyLoaded(context),
      PROTECTED_ELEMENT: this.isProtected(context),
      ASYNC_LOADING: this.hasAsyncLoading(context)
    };
  }
  
  private hasShadowDOM(ctx: any): boolean {
    return ctx.elementMeta?.shadowRoot || 
           ctx.errors?.some((e: string) => e.includes('shadow'));
  }
  
  private isInIframe(ctx: any): boolean {
    return ctx.elementMeta?.frameId !== undefined ||
           ctx.pageState?.isIframe;
  }
  
  private isCrossOrigin(ctx: any): boolean {
    return ctx.errors?.some((e: string) => 
      e.includes('cross-origin') || e.includes('SecurityError'));
  }
  
  private isOffViewport(ctx: any): boolean {
    const rect = ctx.elementMeta?.rect;
    if (!rect) return false;
    return rect.top < 0 || rect.left < 0 || 
           rect.top > ctx.viewport?.height || 
           rect.left > ctx.viewport?.width;
  }
  
  private isRateLimited(ctx: any): boolean {
    const recent = ctx.networkHistory?.slice(-10) || [];
    const errors = recent.filter((r: any) => r.status === 429 || r.status === 503);
    return errors.length > 2;
  }
  
  private hasABTest(ctx: any): boolean {
    return ctx.cookies?.some((c: any) => 
      c.name.includes('variant') || c.name.includes('experiment'));
  }
  
  private isDynamic(ctx: any): boolean {
    return ctx.pageMeta?.framework === 'React' || 
           ctx.pageMeta?.framework === 'Vue' ||
           ctx.mutations?.total > 50;
  }
  
  private isLazyLoaded(ctx: any): boolean {
    return ctx.elementMeta?.attributes?.includes('data-lazy') ||
           ctx.elementMeta?.attributes?.includes('loading="lazy"');
  }
  
  private isProtected(ctx: any): boolean {
    return ctx.errors?.some((e: string) => 
      e.includes('preventDefault') || e.includes('stopPropagation'));
  }
  
  private hasAsyncLoading(ctx: any): boolean {
    return ctx.networkHistory?.some((r: any) => 
      r.timestamp > ctx.actionStart && r.method === 'XHR');
  }
}

// Intelligent hint generator
export class HintGenerator {
  private scoreMatrix: Map<string, number> = new Map();
  private failureHistory: Map<string, number> = new Map();
  private successHistory: Map<string, number> = new Map();
  private detector = new EdgeCaseDetector();
  
  generateHint(
    errorCode: FeedbackCode,
    context: any,
    tokenBudget: 'minimal' | 'normal' | 'verbose' = 'normal'
  ): string {
    // Detect edge cases
    const edgeFlags = this.detector.detect(context);
    
    // Generate candidate hints with scores
    const candidates = this.generateCandidates(errorCode, context, edgeFlags);
    
    // Filter out recently failed hints
    const filtered = this.filterFailures(candidates, context);
    
    // Sort by score and apply token budget
    const selected = this.selectByBudget(filtered, tokenBudget);
    
    // Format output
    return this.formatHint(selected, tokenBudget);
  }
  
  private generateCandidates(
    code: FeedbackCode,
    ctx: any,
    flags: EdgeCaseFlags
  ): Array<{ hint: string; score: number; code?: HintCode }> {
    const candidates: Array<{ hint: string; score: number; code?: HintCode }> = [];
    
    // Base hints by error code
    switch (code) {
      case FeedbackCode.NOT_FOUND:
        candidates.push({ 
          hint: 'Use browser_snapshot to refresh references', 
          score: 0.5,
          code: HintCode.REFRESH_SNAPSHOT
        });
        
        if (flags.SHADOW_DOM) {
          candidates.push({
            hint: 'Element may be in shadow DOM. Use browser_execute_js with shadow DOM traversal',
            score: 0.8,
            code: HintCode.QUERY_SHADOW_DOM
          });
        }
        
        if (flags.IN_IFRAME) {
          candidates.push({
            hint: 'Element is in iframe. Use browser_execute_js to switch context',
            score: 0.7,
            code: HintCode.SWITCH_IFRAME
          });
        }
        
        if (flags.DYNAMIC_CONTENT) {
          candidates.push({
            hint: 'Page has dynamic content. Wait for element with browser_execute_js polling',
            score: 0.6,
            code: HintCode.WAIT_FOR_NETWORK
          });
        }
        break;
        
      case FeedbackCode.DISABLED:
        candidates.push({
          hint: 'Use browser_execute_js to enable element',
          score: 0.6,
          code: HintCode.USE_JAVASCRIPT
        });
        
        if (flags.ASYNC_LOADING) {
          candidates.push({
            hint: 'Element may be waiting for async data. Use browser_wait(2) then retry',
            score: 0.7,
            code: HintCode.RETRY_WITH_WAIT
          });
        }
        
        if (flags.PROTECTED_ELEMENT) {
          candidates.push({
            hint: 'Element has event protection. Use browser_execute_js to force interaction',
            score: 0.8,
            code: HintCode.FORCE_INTERACTION
          });
        }
        break;
        
      case FeedbackCode.OBSCURED:
        candidates.push({
          hint: 'Use browser_execute_js to remove overlays or scroll element into view',
          score: 0.6,
          code: HintCode.CLEAR_OVERLAYS
        });
        
        if (flags.OFF_VIEWPORT) {
          candidates.push({
            hint: 'Element is off screen. Use browser_execute_js to scroll to element',
            score: 0.9,
            code: HintCode.SCROLL_TO_ELEMENT
          });
        }
        
        candidates.push({
          hint: 'Try browser_common_operation with hide_popups',
          score: 0.5,
          code: HintCode.DISMISS_MODAL
        });
        break;
        
      case FeedbackCode.TIMEOUT:
        if (flags.RATE_LIMITED) {
          candidates.push({
            hint: 'Rate limited. Use browser_wait(5) before retrying',
            score: 0.9,
            code: HintCode.BYPASS_RATE_LIMIT
          });
        }
        
        if (flags.ASYNC_LOADING) {
          candidates.push({
            hint: 'Page still loading. Use browser_execute_js to check readyState',
            score: 0.7,
            code: HintCode.WAIT_FOR_NETWORK
          });
        }
        
        candidates.push({
          hint: 'Use browser_wait(3) then retry action',
          score: 0.5,
          code: HintCode.RETRY_WITH_WAIT
        });
        break;
        
      case FeedbackCode.JS_ERROR:
        candidates.push({
          hint: 'Check browser_get_console_logs for error details',
          score: 0.9,
          code: HintCode.CHECK_CONSOLE
        });
        
        candidates.push({
          hint: 'Use browser_execute_js with try-catch for diagnosis',
          score: 0.7,
          code: HintCode.DIAGNOSTIC_SUITE
        });
        break;
    }
    
    // Boost scores based on success history
    candidates.forEach(c => {
      const key = `${ctx.hostname}_${c.code}`;
      const successRate = this.getSuccessRate(key);
      c.score += successRate * 0.3;
    });
    
    return candidates;
  }
  
  private filterFailures(
    candidates: Array<{ hint: string; score: number; code?: HintCode }>,
    context: any
  ): Array<{ hint: string; score: number; code?: HintCode }> {
    return candidates.filter(c => {
      if (!c.code) return true;
      
      const key = `${context.hostname}_${context.elementRef}_${c.code}`;
      const failures = this.failureHistory.get(key) || 0;
      
      // Don't suggest if failed recently
      if (failures > 2) return false;
      
      // Reduce score for previous failures
      c.score -= failures * 0.2;
      
      return true;
    });
  }
  
  private selectByBudget(
    candidates: Array<{ hint: string; score: number; code?: HintCode }>,
    budget: 'minimal' | 'normal' | 'verbose'
  ): Array<{ hint: string; score: number; code?: HintCode }> {
    // Sort by score
    candidates.sort((a, b) => b.score - a.score);
    
    // Select based on budget
    switch (budget) {
      case 'minimal':
        return candidates.slice(0, 1);
      case 'normal':
        return candidates.slice(0, 2);
      case 'verbose':
        return candidates.slice(0, 3);
    }
  }
  
  private formatHint(
    selected: Array<{ hint: string; score: number; code?: HintCode }>,
    budget: 'minimal' | 'normal' | 'verbose'
  ): string {
    if (selected.length === 0) {
      return 'Use browser_execute_js to investigate';
    }
    
    if (budget === 'minimal' && selected[0].code) {
      // Return just the code for maximum token efficiency
      return selected[0].code;
    }
    
    if (budget === 'normal') {
      // Return primary hint with code
      const primary = selected[0];
      if (primary.code) {
        return `[${primary.code}] ${primary.hint}`;
      }
      return primary.hint;
    }
    
    // Verbose: return multiple hints
    return selected
      .map(s => s.code ? `[${s.code}] ${s.hint}` : s.hint)
      .join(' OR ');
  }
  
  private getSuccessRate(key: string): number {
    const successes = this.successHistory.get(key) || 0;
    const failures = this.failureHistory.get(key) || 0;
    const total = successes + failures;
    
    if (total === 0) return 0;
    return successes / total;
  }
  
  // Record outcome for learning
  recordOutcome(
    code: HintCode,
    context: any,
    success: boolean
  ): void {
    const key = `${context.hostname}_${context.elementRef}_${code}`;
    
    if (success) {
      this.successHistory.set(key, (this.successHistory.get(key) || 0) + 1);
    } else {
      this.failureHistory.set(key, (this.failureHistory.get(key) || 0) + 1);
    }
    
    // Decay old entries
    this.decayHistories();
  }
  
  private decayHistories(): void {
    // Simple decay: halve counts every 100 entries
    if (this.successHistory.size > 100) {
      this.successHistory.forEach((value, key) => {
        this.successHistory.set(key, Math.floor(value / 2));
      });
    }
    
    if (this.failureHistory.size > 100) {
      this.failureHistory.forEach((value, key) => {
        this.failureHistory.set(key, Math.floor(value / 2));
      });
    }
  }
}

// Export singleton
export const hintEngine = new HintGenerator();