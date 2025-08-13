/**
 * Hint Expansion System - Token-efficient encoding with on-demand expansion
 * Provides surgically precise recovery strategies
 */

import { HintCode, RecoveryMacros } from './hint-engine';

// Compact hint expansions - surgically precise instructions
export const HintExpansions: Record<HintCode, string> = {
  // Basic strategies
  [HintCode.RETRY_SIMPLE]: 'Retry the same action immediately',
  [HintCode.RETRY_WITH_WAIT]: 'Wait 2 seconds with browser_wait(2) then retry the action',
  [HintCode.REFRESH_SNAPSHOT]: 'Use browser_snapshot to get fresh element references, then retry with new ref',
  [HintCode.USE_JAVASCRIPT]: 'Use browser_execute_js to directly manipulate or interact with the element',
  [HintCode.CHECK_CONSOLE]: 'Use browser_get_console_logs to see JavaScript errors, then browser_execute_js to fix',
  
  // Advanced strategies
  [HintCode.QUERY_SHADOW_DOM]: 'Use browser_execute_js with: [...document.querySelectorAll("*")].filter(e=>e.shadowRoot).map(e=>e.shadowRoot.querySelector(selector))',
  [HintCode.SWITCH_IFRAME]: 'Use browser_execute_js to check iframe.contentDocument, if accessible switch context, else navigate to iframe.src',
  [HintCode.DISMISS_MODAL]: 'Use browser_common_operation("hide_popups") or browser_execute_js to remove elements with class containing modal/popup/overlay',
  [HintCode.HANDLE_AUTH]: 'Check for login forms with browser_snapshot, if present fill credentials or inform user authentication required',
  [HintCode.SCROLL_TO_ELEMENT]: 'Use browser_execute_js: element.scrollIntoView({behavior:"smooth",block:"center"})',
  
  // Edge case strategies  
  [HintCode.WAIT_FOR_NETWORK]: 'Use browser_execute_js to check if window.fetch or XMLHttpRequest active, wait for completion',
  [HintCode.BYPASS_RATE_LIMIT]: 'Wait 5-10 seconds with browser_wait, consider using different action or browser_execute_js for direct manipulation',
  [HintCode.HANDLE_AB_TEST]: 'Use browser_execute_js to check for experiment cookies/localStorage, may need to clear or set specific variant',
  [HintCode.CLEAR_OVERLAYS]: 'Use browser_execute_js: document.querySelectorAll("[style*=fixed],[style*=absolute]").forEach(e=>e.style.display="none")',
  [HintCode.FORCE_INTERACTION]: 'Use browser_execute_js to trigger events directly: element.click() or element.dispatchEvent(new Event("click",{bubbles:true}))',
  
  // Compound strategies
  [HintCode.PARALLEL_ATTEMPTS]: 'Try multiple approaches simultaneously: both waiting and scrolling, use first successful result',
  [HintCode.CASCADE_RECOVERY]: 'Try: 1) Simple retry 2) Wait and retry 3) Refresh snapshot 4) Use JavaScript directly',
  [HintCode.DIAGNOSTIC_SUITE]: 'Run full diagnosis: browser_get_console_logs, browser_snapshot(full), browser_execute_js to inspect element state',
};

// Micro-expansions for extreme token efficiency
export const MicroHints: Record<HintCode, string> = {
  [HintCode.RETRY_SIMPLE]: 'retry',
  [HintCode.RETRY_WITH_WAIT]: 'wait→retry',
  [HintCode.REFRESH_SNAPSHOT]: 'snapshot→retry',
  [HintCode.USE_JAVASCRIPT]: 'use_js',
  [HintCode.CHECK_CONSOLE]: 'check_logs',
  [HintCode.QUERY_SHADOW_DOM]: 'shadow_dom',
  [HintCode.SWITCH_IFRAME]: 'iframe',
  [HintCode.DISMISS_MODAL]: 'clear_modal',
  [HintCode.HANDLE_AUTH]: 'auth_needed',
  [HintCode.SCROLL_TO_ELEMENT]: 'scroll_to',
  [HintCode.WAIT_FOR_NETWORK]: 'wait_net',
  [HintCode.BYPASS_RATE_LIMIT]: 'rate_limit',
  [HintCode.HANDLE_AB_TEST]: 'ab_test',
  [HintCode.CLEAR_OVERLAYS]: 'clear_overlay',
  [HintCode.FORCE_INTERACTION]: 'force_click',
  [HintCode.PARALLEL_ATTEMPTS]: 'parallel',
  [HintCode.CASCADE_RECOVERY]: 'cascade',
  [HintCode.DIAGNOSTIC_SUITE]: 'diagnose',
};

// Surgical precision patterns for specific scenarios
export const SurgicalPatterns = {
  // React-specific element not found
  REACT_ELEMENT_MISSING: {
    detect: (ctx: any) => ctx.pageMeta?.framework === 'React' && ctx.code === 'NOT_FOUND',
    hint: 'React re-render may have changed DOM. Use browser_wait(1) for reconciliation, then browser_snapshot',
    code: 'wait(1)→snapshot'
  },
  
  // Google reCAPTCHA
  RECAPTCHA_BLOCKING: {
    detect: (ctx: any) => ctx.errors?.some((e: string) => e.includes('recaptcha')) || 
                         ctx.elementMeta?.attributes?.includes('g-recaptcha'),
    hint: 'reCAPTCHA detected. Cannot automate. Inform user manual intervention required',
    code: 'manual_required'
  },
  
  // Cloudflare protection
  CLOUDFLARE_CHECK: {
    detect: (ctx: any) => ctx.pageTitle?.includes('Just a moment') || 
                         ctx.errors?.some((e: string) => e.includes('cf-browser-verification')),
    hint: 'Cloudflare protection active. Use browser_wait(5) for check to complete',
    code: 'cf_wait'
  },
  
  // Lazy loaded images
  LAZY_IMAGE: {
    detect: (ctx: any) => ctx.elementMeta?.tag === 'img' && 
                         ctx.elementMeta?.attributes?.includes('loading="lazy"'),
    hint: 'Image is lazy loaded. Use browser_execute_js to trigger: element.loading="eager"; element.src=element.dataset.src',
    code: 'lazy_trigger'
  },
  
  // Cookie consent modal
  COOKIE_CONSENT: {
    detect: (ctx: any) => ctx.errors?.some((e: string) => e.toLowerCase().includes('cookie')) ||
                         ctx.pageMeta?.hasModal?.includes('cookie'),
    hint: 'Cookie consent blocking. Use browser_execute_js: document.querySelector("[class*=cookie] button[class*=accept]").click()',
    code: 'accept_cookies'
  },
  
  // Infinite scroll
  INFINITE_SCROLL: {
    detect: (ctx: any) => ctx.elementMeta?.notFound && ctx.pageMeta?.hasInfiniteScroll,
    hint: 'Element may be below fold in infinite scroll. Use browser_execute_js to scroll to bottom repeatedly until found',
    code: 'scroll_load'
  },
  
  // Payment form protection
  PAYMENT_FIELD: {
    detect: (ctx: any) => ctx.elementMeta?.attributes?.includes('stripe') || 
                         ctx.elementMeta?.attributes?.includes('payment'),
    hint: 'Payment field detected. May be in secure iframe. Use browser_execute_js to check for Stripe/payment provider iframe',
    code: 'payment_iframe'
  },
  
  // Video player overlay
  VIDEO_OVERLAY: {
    detect: (ctx: any) => ctx.elementMeta?.tag === 'video' || 
                         ctx.pageMeta?.hasVideo,
    hint: 'Video player may have overlay controls. Use browser_execute_js to trigger: video.play() or remove overlay',
    code: 'video_control'
  },
  
  // Social media embed
  SOCIAL_EMBED: {
    detect: (ctx: any) => ctx.elementMeta?.attributes?.includes('twitter') || 
                         ctx.elementMeta?.attributes?.includes('facebook'),
    hint: 'Social media embed detected. Content in cross-origin iframe. Limited interaction possible',
    code: 'social_limited'
  },
  
  // Date picker widget
  DATE_PICKER: {
    detect: (ctx: any) => ctx.elementMeta?.type === 'date' || 
                         ctx.elementMeta?.attributes?.includes('datepicker'),
    hint: 'Date picker widget. Use browser_execute_js to set value directly: input.value="YYYY-MM-DD"',
    code: 'date_direct'
  }
};

// Compound recovery sequences
export const CompoundRecoveries = {
  // Modal dismissal sequence
  FULL_MODAL_CLEAR: [
    'browser_execute_js: document.body.style.overflow="auto"',
    'browser_common_operation("hide_popups")',
    'browser_execute_js: document.querySelectorAll(".modal-backdrop").forEach(e=>e.remove())',
    'browser_wait(0.5)',
    'browser_snapshot'
  ],
  
  // Shadow DOM search sequence
  DEEP_SHADOW_SEARCH: [
    'browser_execute_js: function findDeep(sel){let result=null;function search(root){const found=root.querySelector(sel);if(found)result=found;root.querySelectorAll("*").forEach(el=>{if(el.shadowRoot)search(el.shadowRoot)})}search(document);return result}',
    'If found, get coordinates and use browser_execute_js to interact'
  ],
  
  // Authentication check and handle
  AUTH_DETECTION: [
    'browser_snapshot',
    'Check for login/signin/password inputs',
    'If found, inform user authentication required',
    'Else use browser_execute_js to check document.cookie for auth tokens'
  ],
  
  // Network wait with timeout
  SMART_NETWORK_WAIT: [
    'browser_execute_js: window.__pendingRequests = 0; const open = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function() { window.__pendingRequests++; this.addEventListener("loadend", () => window.__pendingRequests--); open.apply(this, arguments); }',
    'browser_execute_js: await new Promise(r => { const check = () => window.__pendingRequests === 0 ? r() : setTimeout(check, 100); check(); })',
    'browser_wait(0.5) for DOM updates'
  ]
};

// Hint formatter with intelligence
export class HintFormatter {
  format(
    code: HintCode | string,
    level: 'micro' | 'compact' | 'normal' | 'verbose' = 'normal',
    context?: any
  ): string {
    // Check for surgical patterns first
    if (context) {
      for (const [name, pattern] of Object.entries(SurgicalPatterns)) {
        if (pattern.detect(context)) {
          switch (level) {
            case 'micro': return pattern.code;
            case 'compact': return `[${name}] ${pattern.code}`;
            case 'normal': return pattern.hint;
            case 'verbose': return `${pattern.hint}\nPattern: ${name}\nCode: ${pattern.code}`;
          }
        }
      }
    }
    
    // Standard hint formatting
    if (typeof code === 'string' && code in HintCode) {
      const hintCode = code as HintCode;
      
      switch (level) {
        case 'micro':
          return MicroHints[hintCode] || code;
          
        case 'compact':
          return `[${hintCode}] ${MicroHints[hintCode]}`;
          
        case 'normal':
          return HintExpansions[hintCode] || code;
          
        case 'verbose':
          const expansion = HintExpansions[hintCode];
          const micro = MicroHints[hintCode];
          const macro = this.getMacro(hintCode);
          
          let verbose = `${expansion}\n`;
          if (macro) {
            verbose += `Steps: ${JSON.stringify(macro, null, 2)}\n`;
          }
          verbose += `Code: ${hintCode} (${micro})`;
          return verbose;
      }
    }
    
    return code;
  }
  
  private getMacro(code: HintCode): any {
    switch (code) {
      case HintCode.DISMISS_MODAL:
        return RecoveryMacros.MODAL_DISMISS;
      case HintCode.QUERY_SHADOW_DOM:
        return RecoveryMacros.SHADOW_FIND;
      case HintCode.SWITCH_IFRAME:
        return RecoveryMacros.IFRAME_SWITCH;
      case HintCode.HANDLE_AUTH:
        return RecoveryMacros.AUTH_WALL;
      default:
        return null;
    }
  }
  
  // Generate compound hint for multiple codes
  compound(codes: HintCode[], level: 'micro' | 'compact' | 'normal' = 'normal'): string {
    if (level === 'micro') {
      return codes.map(c => MicroHints[c]).join('→');
    }
    
    if (level === 'compact') {
      return codes.map(c => `${c}:${MicroHints[c]}`).join(' | ');
    }
    
    // Normal: numbered steps
    return codes
      .map((c, i) => `${i + 1}. ${HintExpansions[c]}`)
      .join('\n');
  }
}

// Export formatter singleton
export const hintFormatter = new HintFormatter();