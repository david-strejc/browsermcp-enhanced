/**
 * FeedbackSummarizer - Server-side intelligent feedback generation
 * Converts raw feedback bundles into token-efficient, actionable feedback
 */

import {
  ActionFeedback,
  FeedbackCode,
  RawFeedbackBundle,
  RecoveryHints,
  FeedbackCodeLabels,
  NetworkActivity,
  getSeverity,
  FeedbackSeverity,
  FeedbackContext
} from '../types/feedback';
import { hintEngine } from './hint-engine';
import { hintFormatter } from './hint-expansion';

export class FeedbackSummarizer {
  private readonly MAX_ERRORS = 3;
  private readonly MAX_ERROR_LENGTH = 100;
  private readonly MAX_NET_EVENTS = 5;
  private readonly SIGNIFICANT_DOM_THRESHOLD = 10;

  /**
   * Summarize raw feedback into token-efficient format
   */
  summarize(
    action: string,
    ref: string | undefined,
    rawBundle: RawFeedbackBundle,
    success: boolean,
    error?: string
  ): ActionFeedback {
    const code = this.determineCode(rawBundle, success, error);
    const severity = getSeverity(code);
    
    // Build base feedback
    const feedback: ActionFeedback = {
      act: this.abbreviateAction(action),
      ref,
      ok: success,
      code
    };

    // Add deltas only if significant changes occurred
    const delta = this.extractDeltas(rawBundle);
    if (delta && Object.keys(delta).length > 0) {
      feedback.delta = delta;
    }

    // Add errors for failures or warnings
    if (severity >= FeedbackSeverity.WARNING && rawBundle.errors?.length > 0) {
      feedback.errors = this.summarizeErrors(rawBundle.errors);
    }

    // Add network activity if significant
    const netActivity = this.summarizeNetwork(rawBundle.network);
    if (netActivity && netActivity.length > 0) {
      feedback.net = netActivity as NetworkActivity[];
    }

    // Add timing if notably slow
    if (rawBundle.duration > 500) {
      feedback.timing = rawBundle.duration;
    }

    // Generate recovery hint for failures
    if (!success && code !== FeedbackCode.SUCCESS) {
      feedback.hint = this.generateHint(code, rawBundle, error);
    }

    // Add context for specific scenarios
    const ctx = this.extractContext(rawBundle, action);
    if (ctx && Object.keys(ctx).length > 0) {
      feedback.ctx = ctx;
    }

    return feedback;
  }

  /**
   * Determine the feedback code from raw data
   */
  private determineCode(
    bundle: RawFeedbackBundle,
    success: boolean,
    error?: string
  ): FeedbackCode {
    if (success && !error) {
      return FeedbackCode.SUCCESS;
    }

    // Analyze error patterns
    const errorText = error?.toLowerCase() || '';
    const errors = bundle.errors || [];
    const allErrorText = errors.map(e => e.message?.toLowerCase()).join(' ') + ' ' + errorText;

    // Pattern matching for specific codes
    if (allErrorText.includes('not found') || allErrorText.includes('no such element')) {
      return FeedbackCode.NOT_FOUND;
    }
    if (allErrorText.includes('disabled') || bundle.elementState?.enabled === false) {
      return FeedbackCode.DISABLED;
    }
    if (allErrorText.includes('obscured') || bundle.elementState?.obscured) {
      return FeedbackCode.OBSCURED;
    }
    if (allErrorText.includes('timeout') || allErrorText.includes('timed out')) {
      return FeedbackCode.TIMEOUT;
    }
    if (allErrorText.includes('navigation') || this.detectNavigation(bundle)) {
      return FeedbackCode.NAVIGATION;
    }
    if (allErrorText.includes('permission') || allErrorText.includes('denied')) {
      return FeedbackCode.PERMISSION;
    }
    if (allErrorText.includes('validation') || allErrorText.includes('invalid')) {
      return FeedbackCode.VALIDATION;
    }
    if (allErrorText.includes('network') || allErrorText.includes('fetch')) {
      return FeedbackCode.NETWORK_ERROR;
    }
    if (errors.some(e => e.type === 'error' || e.type === 'unhandledRejection')) {
      return FeedbackCode.JS_ERROR;
    }

    return FeedbackCode.UNKNOWN;
  }

  /**
   * Extract significant changes from mutations
   */
  private extractDeltas(bundle: RawFeedbackBundle): ActionFeedback['delta'] | null {
    const delta: ActionFeedback['delta'] = {};

    // Check for navigation
    if (bundle.pageState?.before && bundle.pageState?.after) {
      const before = bundle.pageState.before;
      const after = bundle.pageState.after;

      if (before.url !== after.url) {
        delta.url = after.url;
      }

      // Significant scroll change
      const scrollDiff = Math.abs(after.scrollPosition.y - before.scrollPosition.y);
      if (scrollDiff > 100) {
        delta.scroll = after.scrollPosition;
      }
    }

    // Summarize DOM mutations
    if (bundle.mutations && typeof bundle.mutations === 'object') {
      const mutations = bundle.mutations as any;
      
      // Extract text changes
      if (mutations.significantChanges?.length > 0) {
        delta.text = mutations.significantChanges
          .filter((c: any) => c.change?.startsWith('attr:') === false)
          .slice(0, 3)
          .map((c: any) => [c.target, c.change]);
      }

      // Check for significant DOM changes
      if (mutations.total > this.SIGNIFICANT_DOM_THRESHOLD) {
        if (!delta.text) delta.text = [];
        delta.text.push(['body', `${mutations.total} mutations`]);
      }
    }

    return Object.keys(delta).length > 0 ? delta : null;
  }

  /**
   * Summarize errors for token efficiency
   */
  private summarizeErrors(errors: any[]): string[] {
    return errors
      .slice(0, this.MAX_ERRORS)
      .map(e => {
        const msg = e.message || e.toString();
        // Truncate and clean up error messages
        return msg
          .substring(0, this.MAX_ERROR_LENGTH)
          .replace(/\n/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      })
      .filter(msg => msg.length > 0);
  }

  /**
   * Summarize network activity
   */
  private summarizeNetwork(network?: NetworkActivity[]): NetworkActivity[] | null {
    if (!network || network.length === 0) return null;

    // Filter and limit network events
    return network
      .filter(n => n.s >= 400 || n.s === 0) // Only errors or important
      .slice(0, this.MAX_NET_EVENTS)
      .map(n => ({
        u: n.u.substring(0, 50), // Truncate URLs
        s: n.s,
        ...(n.m !== 'GET' ? { m: n.m } : {}) // Only include method if not GET
      }));
  }

  /**
   * Generate recovery hint based on error code - Now with surgical precision
   */
  private generateHint(
    code: FeedbackCode,
    bundle: RawFeedbackBundle,
    error?: string
  ): string {
    // Build context for hint engine
      const context: FeedbackContext = {
      hostname: bundle.pageState?.after?.url ? new URL(bundle.pageState.after.url).hostname : undefined,
      elementRef: (bundle as any).ref,
      elementMeta: bundle.elementState ? {
        tag: bundle.elementState.tag,
        type: bundle.elementState.type,
        attributes: bundle.elementState.attributes,
        shadowRoot: bundle.elementState.shadowRoot,
        frameId: bundle.elementState.frameId,
        rect: bundle.elementState.rect
      } : undefined,
      pageMeta: {
        framework: this.detectFramework(bundle),
        isIframe: bundle.elementState?.frameId !== undefined,
        hasModal: this.detectModals(bundle),
        hasInfiniteScroll: this.detectInfiniteScroll(bundle),
        hasVideo: this.detectVideo(bundle)
      },
      viewport: (bundle as any).viewport,
      networkHistory: bundle.network,
      mutations: bundle.mutations as any,
      actionStart: bundle.timestamp,
      pageTitle: bundle.pageState?.after?.title,
      pageState: bundle.pageState
    };

    // Try hint engine first for surgical precision
    try {
      // Determine token budget based on severity
      const severity = getSeverity(code);
      const tokenBudget = severity >= FeedbackSeverity.ERROR ? 'normal' : 'minimal';
      
      const engineHint = hintEngine.generateHint(code, context, tokenBudget);
      
      // If we get a hint code, expand it to readable format
      if (engineHint && engineHint.length <= 5) { // Likely a hint code
        return hintFormatter.format(engineHint, 'normal', context);
      }
      
      return engineHint;
    } catch (e) {
      // Fallback to basic hints
      console.warn('Hint engine failed, using fallback:', e);
      return RecoveryHints[code] || RecoveryHints[FeedbackCode.UNKNOWN];
    }
  }

  /**
   * Detect framework from bundle
   */
  private detectFramework(bundle: RawFeedbackBundle): 'React' | 'Vue' | 'Angular' | 'vanilla' {
    const errors = bundle.errors || [];
    const errorText = errors.map(e => e.message).join(' ');
    
    if (errorText.includes('React') || errorText.includes('jsx')) return 'React';
    if (errorText.includes('Vue') || errorText.includes('v-')) return 'Vue';
    if (errorText.includes('Angular') || errorText.includes('ng-')) return 'Angular';
    
    return 'vanilla';
  }

  /**
   * Detect modals on page
   */
  private detectModals(bundle: RawFeedbackBundle): string[] {
    const modals: string[] = [];
    if (bundle.mutations && typeof bundle.mutations === 'object') {
      const changes = (bundle.mutations as any).significantChanges || [];
      changes.forEach((c: any) => {
        if (c.target?.includes('modal') || c.target?.includes('popup')) {
          modals.push(c.target);
        }
      });
    }
    return modals;
  }

  /**
   * Detect infinite scroll
   */
  private detectInfiniteScroll(bundle: RawFeedbackBundle): boolean {
    const pageState = bundle.pageState;
    if (!pageState?.before || !pageState?.after) return false;
    const beforeBH = pageState.before.bodyHeight ?? 0;
    const afterBH = pageState.after.bodyHeight ?? 0;
    if (beforeBH <= 0) return false;
    // Check if body height increased significantly
    return afterBH > beforeBH * 1.5;
  }

  /**
   * Detect video elements
   */
  private detectVideo(bundle: RawFeedbackBundle): boolean {
    return bundle.elementState?.tag === 'video' || 
           bundle.errors?.some(e => e.message?.includes('video')) || false;
  }

  /**
   * Extract additional context
   */
  private extractContext(bundle: RawFeedbackBundle, action: string): any {
    const ctx: any = {};

    // Add element state if notably different
    if (bundle.elementState) {
      const state = bundle.elementState;
      if (!state.visible) ctx.visibility = 'hidden';
      if (!state.enabled) ctx.enabled = false;
      if (state.value !== undefined && action === 'type') {
        ctx.value = state.value;
      }
    }

    return Object.keys(ctx).length > 0 ? ctx : null;
  }

  /**
   * Detect if navigation occurred
   */
  private detectNavigation(bundle: RawFeedbackBundle): boolean {
    if (!bundle.pageState?.before || !bundle.pageState?.after) {
      return false;
    }

    const before = bundle.pageState.before;
    const after = bundle.pageState.after;

    // URL changed
    if (before.url !== after.url) return true;

    // Title significantly changed (not just updated)
    if (before.title !== after.title && 
        after.title.length > 0 && 
        !after.title.includes(before.title)) {
      return true;
    }

    // Body height significantly changed (page reload)
    const beforeBH = before.bodyHeight ?? 0;
    const afterBH = after.bodyHeight ?? 0;
    if (beforeBH > 0) {
      const heightDiff = Math.abs(afterBH - beforeBH);
      if (heightDiff > beforeBH * 0.5) {
        return true;
      }
    }

    return false;
  }

  /**
   * Abbreviate action names for token efficiency
   */
  private abbreviateAction(action: string): string {
    const abbreviations: Record<string, string> = {
      'click': 'clk',
      'type': 'typ',
      'navigate': 'nav',
      'select': 'sel',
      'hover': 'hov',
      'screenshot': 'scr',
      'execute': 'exe',
      'wait': 'wt',
      'snapshot': 'snp'
    };

    return abbreviations[action.toLowerCase()] || action.substring(0, 3);
  }

  /**
   * Format feedback for human-readable output
   */
  formatForDisplay(feedback: ActionFeedback): string {
    const parts: string[] = [];

    // Status
    const status = feedback.ok ? '✅' : '❌';
    const codeLabel = FeedbackCodeLabels[feedback.code];
    parts.push(`${status} ${feedback.act} [${codeLabel}]`);

    // Reference
    if (feedback.ref) {
      parts.push(`ref: ${feedback.ref}`);
    }

    // Errors
    const errs = feedback.errors;
    if (errs && errs.length > 0) {
      parts.push(`Errors: ${errs.join('; ')}`);
    }

    // Hint
    if (feedback.hint) {
      parts.push(`💡 ${feedback.hint}`);
    }

    // Timing
    if (feedback.timing) {
      parts.push(`⏱️ ${feedback.timing}ms`);
    }

    return parts.join('\n');
  }

  /**
   * Convert to minimal JSON for AI consumption
   */
  toMinimalJSON(feedback: ActionFeedback): string {
    // Remove null/undefined values and empty arrays/objects
    const clean = (obj: any): any => {
      if (Array.isArray(obj)) {
        return obj.length > 0 ? obj : undefined;
      }
      if (obj && typeof obj === 'object') {
        const cleaned: any = {};
        for (const [key, value] of Object.entries(obj)) {
          const cleanValue = clean(value);
          if (cleanValue !== undefined && cleanValue !== null) {
            cleaned[key] = cleanValue;
          }
        }
        return Object.keys(cleaned).length > 0 ? cleaned : undefined;
      }
      return obj;
    };

    const minimal = clean(feedback);
    return JSON.stringify(minimal, null, 0); // No formatting for tokens
  }
}

// Export singleton instance
export const feedbackSummarizer = new FeedbackSummarizer();
