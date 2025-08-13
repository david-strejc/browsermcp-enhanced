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
  mutations: any[];       // DOM mutations
  errors: ErrorEvent[];   // Console/JS errors
  network: NetworkActivity[]; // Network requests
  duration: number;       // Action duration
  timestamp: number;      // When action started
  
  // Element state
  elementState?: {
    exists: boolean;
    visible: boolean;
    enabled: boolean;
    focused: boolean;
    value?: any;
    rect?: DOMRect;
  };
  
  // Page state
  pageState?: {
    url: string;
    title: string;
    readyState: string;
    scrollPosition: { x: number; y: number };
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

// Recovery hint templates
export const RecoveryHints = {
  [FeedbackCode.NOT_FOUND]: "Element not found. Use browser_snapshot to refresh references or browser_execute_js to search by different criteria.",
  [FeedbackCode.DISABLED]: "Element is disabled. Use browser_execute_js to check and enable it, or wait for page conditions to change.",
  [FeedbackCode.OBSCURED]: "Element is obscured by another element. Use browser_execute_js to remove overlays or scroll element into view.",
  [FeedbackCode.TIMEOUT]: "Action timed out. Try browser_wait before retrying, or check browser_get_console_logs for errors.",
  [FeedbackCode.JS_ERROR]: "JavaScript error occurred. Check browser_get_console_logs for details and use browser_execute_js to debug.",
  [FeedbackCode.NETWORK_ERROR]: "Network error detected. Check browser_debugger_get_data for network details or retry after delay.",
  [FeedbackCode.PERMISSION]: "Permission denied. The page may require authentication or the action may be restricted.",
  [FeedbackCode.VALIDATION]: "Validation failed. Check the expected format and use browser_execute_js to inspect validation rules.",
  [FeedbackCode.NAVIGATION]: "Unexpected navigation occurred. Use browser_snapshot to get new page context.",
  [FeedbackCode.UNKNOWN]: "Unknown error. Use browser_get_console_logs and browser_execute_js to investigate."
};

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
  [FeedbackCode.UNKNOWN]: "Unknown"
};