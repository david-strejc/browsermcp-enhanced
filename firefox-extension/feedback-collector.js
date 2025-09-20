/**
 * FeedbackCollector - Lightweight data collection in Chrome extension
 * Collects mutations, errors, network activity during actions
 */

class FeedbackCollector {
  constructor() {
    this.reset();
    this.observer = null;
    this.isCollecting = false;
    this.actionTimeout = null;
  }

  reset() {
    this.mutationBuffer = [];
    this.errorBuffer = [];
    this.networkBuffer = [];
    this.startTime = 0;
    this.elementState = null;
    this.pageStateBefore = null;
    this.pageStateAfter = null;
  }

  /**
   * Start collecting feedback for an action
   */
  startCollection(action, ref, element) {
    this.reset();
    this.isCollecting = true;
    this.startTime = performance.now();
    this.action = action;
    this.ref = ref;
    
    // Capture initial page state
    this.pageStateBefore = this.capturePageState();
    
    // Capture initial element state if ref provided
    if (element) {
      this.elementState = this.captureElementState(element);
    }
    
    // Start mutation observer
    this.startMutationObserver();
    
    // Set timeout to auto-stop collection
    this.actionTimeout = setTimeout(() => {
      this.stopCollection();
    }, 2000); // Max 2 seconds collection
  }

  /**
   * Stop collecting and return raw bundle
   */
  stopCollection() {
    if (!this.isCollecting) return null;
    
    this.isCollecting = false;
    clearTimeout(this.actionTimeout);
    
    // Stop mutation observer
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    
    // Capture final page state
    this.pageStateAfter = this.capturePageState();
    
    const duration = performance.now() - this.startTime;
    
    // Get recent errors from global error buffer
    const recentErrors = this.getRecentErrors();
    
    return {
      action: this.action,
      ref: this.ref,
      mutations: this.summarizeMutations(),
      errors: recentErrors,
      network: this.networkBuffer,
      duration: Math.round(duration),
      timestamp: this.startTime,
      elementState: this.elementState,
      pageState: {
        before: this.pageStateBefore,
        after: this.pageStateAfter
      }
    };
  }

  /**
   * Start observing DOM mutations
   */
  startMutationObserver() {
    this.observer = new MutationObserver((mutations) => {
      // Don't collect too many mutations (token efficiency)
      if (this.mutationBuffer.length > 100) return;
      
      mutations.forEach(mutation => {
        this.mutationBuffer.push({
          type: mutation.type,
          target: this.getElementIdentifier(mutation.target),
          added: mutation.addedNodes.length,
          removed: mutation.removedNodes.length,
          attr: mutation.attributeName,
          oldValue: mutation.oldValue
        });
      });
    });
    
    this.observer.observe(document.body, {
      childList: true,
      attributes: true,
      subtree: true,
      attributeOldValue: true,
      characterData: true,
      characterDataOldValue: true
    });
  }

  /**
   * Get element identifier (ref or selector)
   */
  getElementIdentifier(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }
    
    // Check if element has our ref attribute
    const ref = element.getAttribute?.('data-ref');
    if (ref) return ref;
    
    // Generate a simple selector
    if (element.id) return `#${element.id}`;
    if (element.className) {
      const classes = element.className.split(' ').filter(c => c).join('.');
      if (classes) return `.${classes}`;
    }
    
    return element.tagName?.toLowerCase() || 'unknown';
  }

  /**
   * Capture current page state
   */
  capturePageState() {
    return {
      url: window.location.href,
      title: document.title,
      readyState: document.readyState,
      scrollPosition: {
        x: window.scrollX,
        y: window.scrollY
      },
      bodyHeight: document.body.scrollHeight,
      viewportHeight: window.innerHeight
    };
  }

  /**
   * Capture element state
   */
  captureElementState(element) {
    if (!element) return null;
    
    const rect = element.getBoundingClientRect();
    const computed = window.getComputedStyle(element);
    
    return {
      exists: true,
      visible: rect.width > 0 && rect.height > 0 && computed.visibility !== 'hidden',
      enabled: !element.disabled && !element.hasAttribute('disabled'),
      focused: element === document.activeElement,
      value: element.value || element.textContent?.substring(0, 100),
      rect: {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height
      },
      // Check if obscured by other elements
      obscured: this.isElementObscured(element, rect)
    };
  }

  /**
   * Check if element is obscured by others
   */
  isElementObscured(element, rect) {
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const topElement = document.elementFromPoint(centerX, centerY);
    
    return topElement !== element && !element.contains(topElement);
  }

  /**
   * Summarize mutations for token efficiency
   */
  summarizeMutations() {
    const summary = {
      total: this.mutationBuffer.length,
      types: {},
      significantChanges: []
    };
    
    // Count mutation types
    this.mutationBuffer.forEach(m => {
      summary.types[m.type] = (summary.types[m.type] || 0) + 1;
    });
    
    // Extract significant changes (first 10)
    const significant = this.mutationBuffer
      .filter(m => m.target && (m.added > 0 || m.removed > 0 || m.attr))
      .slice(0, 10)
      .map(m => ({
        target: m.target,
        change: m.attr ? `attr:${m.attr}` : `nodes:+${m.added}/-${m.removed}`
      }));
    
    summary.significantChanges = significant;
    
    return summary;
  }

  /**
   * Get recent errors from global error buffer
   */
  getRecentErrors() {
    // Access the global error buffer if it exists
    if (window.__errorBuffer && Array.isArray(window.__errorBuffer)) {
      return window.__errorBuffer
        .filter(e => e.ts >= this.startTime)
        .slice(0, 3) // Max 3 errors
        .map(e => ({
          type: e.type,
          message: e.message?.substring(0, 100), // Truncate for tokens
          timestamp: e.ts
        }));
    }
    
    // Fallback to console logs
    if (window.__consoleLogs && Array.isArray(window.__consoleLogs)) {
      return window.__consoleLogs
        .filter(log => log.type === 'error' && log.timestamp >= this.startTime)
        .slice(0, 3)
        .map(log => ({
          type: 'console.error',
          message: log.args.join(' ').substring(0, 100),
          timestamp: log.timestamp
        }));
    }
    
    return [];
  }

  /**
   * Record network activity (requires separate network monitor)
   */
  recordNetworkActivity(url, status, method = 'GET') {
    if (!this.isCollecting) return;
    
    // Only record path, not full URL (token efficiency)
    const path = new URL(url, window.location.origin).pathname;
    
    this.networkBuffer.push({
      u: path,
      s: status,
      m: method,
      t: Math.round(performance.now() - this.startTime)
    });
  }
}

// Create global instance
window.__feedbackCollector = new FeedbackCollector();

// Hook into existing error buffer system
if (!window.__errorBuffer) {
  window.__errorBuffer = [];
}

// Enhanced error capture
const originalOnError = window.onerror;
window.onerror = function(message, source, lineno, colno, error) {
  const errorEvent = {
    type: 'window.error',
    message: message?.toString().substring(0, 100),
    source: source,
    lineno: lineno,
    colno: colno,
    stack: error?.stack?.substring(0, 200),
    ts: performance.now()
  };
  
  window.__errorBuffer.push(errorEvent);
  
  // Trim buffer
  if (window.__errorBuffer.length > 50) {
    window.__errorBuffer = window.__errorBuffer.slice(-50);
  }
  
  // Call original handler
  if (originalOnError) {
    return originalOnError.apply(this, arguments);
  }
};

// Capture unhandled promise rejections
window.addEventListener('unhandledrejection', (e) => {
  window.__errorBuffer.push({
    type: 'unhandledrejection',
    message: (e.reason?.message || e.reason?.toString() || 'Unknown rejection').substring(0, 100),
    ts: performance.now()
  });
});

// Network activity monitor (using PerformanceObserver if available)
if (window.PerformanceObserver) {
  const netObserver = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.entryType === 'resource' || entry.entryType === 'navigation') {
        if (window.__feedbackCollector && window.__feedbackCollector.isCollecting) {
          // Simplified network recording
          const status = entry.responseStatus || 200;
          window.__feedbackCollector.recordNetworkActivity(
            entry.name,
            status,
            'GET'
          );
        }
      }
    }
  });
  
  try {
    netObserver.observe({ entryTypes: ['resource', 'navigation'] });
  } catch (e) {
    console.warn('Performance observer not fully supported');
  }
}

console.log('[FeedbackCollector] Initialized with error buffer and network monitoring');