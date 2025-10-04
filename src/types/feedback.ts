/**
 * BrowserMCP Enhanced - Intelligent Feedback System
 * Token-efficient, actionable feedback for AI understanding
 */

export enum FeedbackCode {
  SUCCESS = 0,
  NOT_FOUND = 1,
  DISABLED = 2,
  OBSCURED = 3,
  TIMEOUT = 4,
  NAVIGATION = 5,
  JS_ERROR = 6,
  NETWORK_ERROR = 7,
  PERMISSION = 8,
  VALIDATION = 9,
  EXECUTION_ERROR = 10,  // JavaScript execution errors
  UNKNOWN = 99
}

export interface NetworkActivity {
  u: string;  // url (path only, no domain)
  s: number;  // status code
  m?: string; // method (GET/POST/etc)
  t?: number; // time in ms
}

export interface ActionFeedback {
  // Core (always present)
  act: string;        // action type: "click", "type", "nav", etc
  ref?: string;       // target element reference
  ok: boolean;        // overall success
  code: FeedbackCode; // result code enum
  
  // Deltas (only significant changes)
  delta?: {
    url?: string;                     // navigation occurred
    text?: [string, string][];        // [selector, newText] pairs
    attrs?: [string, string, any][];  // [selector, attr, value] triples
    removed?: string[];               // removed element refs
    added?: string[];                 // new element refs
    scroll?: { x: number; y: number }; // scroll position changed
  };
  
  // Diagnostics (when relevant)
  errors?: string[];      // console errors (max 3, truncated to 100 chars each)
  net?: NetworkActivity[]; // significant network activity
  timing?: number;        // action duration ms
  
  // Recovery hint (when failed)
  hint?: string;          // AI-actionable suggestion
  
  // Additional context
  ctx?: {
    retries?: number;     // number of retry attempts
    element?: string;     // element description for context
    value?: any;          // actual value set/retrieved
    expected?: any;       // expected value (for validations)
  };
}

// Raw data collected from extension
export interface RawFeedbackBundle {
  mutations: any;                 // DOM mutations summary (object) or array
  errors: ErrorEvent[];           // Console/JS errors
  network: NetworkActivity[];     // Network requests
  duration: number;               // Action duration
  timestamp: number;              // When action started
  viewport?: { width: number; height: number }; // Viewport size
  ref?: string;                   // element reference (optional)
  
  // Element state (extended)
  elementState?: {
    exists: boolean;
    visible: boolean;
    enabled: boolean;
    focused: boolean;
    value?: any;
    rect?: DOMRect;
    obscured?: boolean;
    tag?: string;
    type?: string;
    attributes?: string[];
    shadowRoot?: boolean;
    frameId?: string;
  };
  
  // Page state (before/after for navigation detection)
  pageState?: {
    before?: {
      url: string;
      title: string;
      readyState?: string;
      scrollPosition: { x: number; y: number };
      bodyHeight?: number;
    };
    after?: {
      url: string;
      title: string;
      readyState?: string;
      scrollPosition: { x: number; y: number };
      bodyHeight?: number;
    };
  };
}

// Error event structure
export interface ErrorEvent {
  type: 'error' | 'warning' | 'unhandledRejection';
  message: string;
  stack?: string;
  timestamp: number;
  source?: string;
  lineno?: number;
  colno?: number;
}

// Recovery hint templates - Now integrated with HintEngine
// These are fallbacks when HintEngine is not available
export const RecoveryHints = {
  [FeedbackCode.SUCCESS]: "",
  [FeedbackCode.NOT_FOUND]: "Element not found. Use browser_snapshot to refresh references or browser_execute_js to search by different criteria.",
  [FeedbackCode.DISABLED]: "Element is disabled. Use browser_execute_js to check and enable it, or wait for page conditions to change.",
  [FeedbackCode.OBSCURED]: "Element is obscured by another element. Use browser_execute_js to remove overlays or scroll element into view.",
  [FeedbackCode.TIMEOUT]: "Action timed out. Try browser_wait before retrying, or check browser_get_console_logs for errors.",
  [FeedbackCode.JS_ERROR]: "JavaScript error occurred. Check browser_get_console_logs for details and use browser_execute_js to debug.",
  [FeedbackCode.NETWORK_ERROR]: "Network error detected. Check browser_debugger_get_data for network details or retry after delay.",
  [FeedbackCode.PERMISSION]: "Permission denied. The page may require authentication or the action may be restricted.",
  [FeedbackCode.VALIDATION]: "Validation failed. Check the expected format and use browser_execute_js to inspect validation rules.",
  [FeedbackCode.NAVIGATION]: "Unexpected navigation occurred. Use browser_snapshot to get new page context.",
  [FeedbackCode.EXECUTION_ERROR]: "Execution error. Verify JS execution context and consider unsafe mode only if necessary.",
  [FeedbackCode.UNKNOWN]: "Unknown error. Use browser_get_console_logs and browser_execute_js to investigate."
};

// Enhanced feedback context for hint generation
export interface FeedbackContext {
  hostname?: string;
  elementRef?: string;
  elementMeta?: {
    tag?: string;
    type?: string;
    attributes?: string[];
    shadowRoot?: boolean;
    frameId?: string;
    rect?: DOMRect;
  };
  pageMeta?: {
    framework?: 'React' | 'Vue' | 'Angular' | 'vanilla';
    isIframe?: boolean;
    hasModal?: string[];
    hasInfiniteScroll?: boolean;
    hasVideo?: boolean;
  };
  viewport?: {
    width: number;
    height: number;
  };
  networkHistory?: NetworkActivity[];
  cookies?: Array<{ name: string; value: string }>;
  mutations?: {
    total: number;
    types: Record<string, number>;
  };
  actionStart?: number;
  pageTitle?: string;
  pageState?: any;
}

// Feedback severity levels for prioritization
export enum FeedbackSeverity {
  INFO = 0,     // Successful action with useful info
  WARNING = 1,  // Succeeded but with issues
  ERROR = 2,    // Failed but recoverable
  CRITICAL = 3  // Failed and likely unrecoverable
}

// Helper to determine severity from code
export function getSeverity(code: FeedbackCode): FeedbackSeverity {
  switch (code) {
    case FeedbackCode.SUCCESS:
      return FeedbackSeverity.INFO;
    case FeedbackCode.VALIDATION:
    case FeedbackCode.NAVIGATION:
      return FeedbackSeverity.WARNING;
    case FeedbackCode.NOT_FOUND:
    case FeedbackCode.DISABLED:
    case FeedbackCode.OBSCURED:
    case FeedbackCode.TIMEOUT:
      return FeedbackSeverity.ERROR;
    case FeedbackCode.JS_ERROR:
    case FeedbackCode.NETWORK_ERROR:
    case FeedbackCode.PERMISSION:
    case FeedbackCode.UNKNOWN:
      return FeedbackSeverity.CRITICAL;
    default:
      return FeedbackSeverity.ERROR;
  }
}

// Token-efficient code to string mapping
export const FeedbackCodeLabels: Record<FeedbackCode, string> = {
  [FeedbackCode.SUCCESS]: "OK",
  [FeedbackCode.NOT_FOUND]: "NotFound",
  [FeedbackCode.DISABLED]: "Disabled",
  [FeedbackCode.OBSCURED]: "Obscured",
  [FeedbackCode.TIMEOUT]: "Timeout",
  [FeedbackCode.NAVIGATION]: "NavChange",
  [FeedbackCode.JS_ERROR]: "JSError",
  [FeedbackCode.NETWORK_ERROR]: "NetError",
  [FeedbackCode.PERMISSION]: "Permission",
  [FeedbackCode.VALIDATION]: "Validation",
  [FeedbackCode.EXECUTION_ERROR]: "ExecError",
  [FeedbackCode.UNKNOWN]: "Unknown"
};
