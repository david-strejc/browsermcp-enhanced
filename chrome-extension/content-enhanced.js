// Enhanced content script with error buffer system
// Based on O3's recommendations for console error feedback

// Error buffer to track errors with timestamps
const errorBuffer = [];
const MAX_BUFFER_SIZE = 1000; // Prevent memory issues
const BUFFER_RETENTION_MS = 60000; // Keep errors for 1 minute

// Capture console logs (existing functionality)
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;
const originalInfo = console.info;

window.__consoleLogs = [];

console.log = function(...args) {
  const entry = { 
    type: 'log', 
    args, 
    timestamp: performance.now(),
    message: args.map(String).join(' ')
  };
  window.__consoleLogs.push(entry);
  originalLog.apply(console, args);
};

console.error = function(...args) {
  const entry = {
    type: 'error',
    args,
    timestamp: performance.now(),
    message: args.map(String).join(' ')
  };
  window.__consoleLogs.push(entry);
  errorBuffer.push({
    ts: performance.now(),
    type: 'console.error',
    message: args.map(String).join(' '),
    stack: new Error().stack
  });
  trimErrorBuffer();
  originalError.apply(console, args);
};

console.warn = function(...args) {
  const entry = {
    type: 'warn',
    args,
    timestamp: performance.now(),
    message: args.map(String).join(' ')
  };
  window.__consoleLogs.push(entry);
  errorBuffer.push({
    ts: performance.now(),
    type: 'console.warn',
    message: args.map(String).join(' ')
  });
  trimErrorBuffer();
  originalWarn.apply(console, args);
};

console.info = function(...args) {
  const entry = {
    type: 'info',
    args,
    timestamp: performance.now(),
    message: args.map(String).join(' ')
  };
  window.__consoleLogs.push(entry);
  originalInfo.apply(console, args);
};

// Global error handlers
window.addEventListener('error', (e) => {
  errorBuffer.push({
    ts: performance.now(),
    type: 'window.error',
    message: e.message,
    stack: e.error?.stack,
    filename: e.filename,
    lineno: e.lineno,
    colno: e.colno
  });
  trimErrorBuffer();
});

window.addEventListener('unhandledrejection', (e) => {
  errorBuffer.push({
    ts: performance.now(),
    type: 'unhandledrejection',
    message: e.reason?.message || String(e.reason),
    stack: e.reason?.stack,
    promise: String(e.promise)
  });
  trimErrorBuffer();
});

// Buffer maintenance
function trimErrorBuffer() {
  // Remove old entries
  const cutoffTime = performance.now() - BUFFER_RETENTION_MS;
  while (errorBuffer.length > 0 && errorBuffer[0].ts < cutoffTime) {
    errorBuffer.shift();
  }
  
  // Cap buffer size
  if (errorBuffer.length > MAX_BUFFER_SIZE) {
    errorBuffer.splice(0, errorBuffer.length - MAX_BUFFER_SIZE);
  }
}

// Periodic buffer cleanup
setInterval(trimErrorBuffer, 10000); // Clean every 10 seconds

// Enhanced message handler with error feedback
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Record action start time
  const actionStart = performance.now();
  
  // Handle the action
  handleAction(request, (result) => {
    // Get settle time from request or use default
    const settleMs = request.settleMs || 400;
    
    // Wait for errors to settle, then include them in response
    setTimeout(() => {
      // Get errors that occurred after action started
      const recentErrors = errorBuffer.filter(e => e.ts >= actionStart);
      
      // Add errors to result if any occurred
      if (recentErrors.length > 0) {
        result.consoleErrors = recentErrors.slice(0, 50); // Limit to 50 errors
        if (recentErrors.length > 50) {
          result.errorsTruncated = true;
          result.totalErrors = recentErrors.length;
        }
      }
      
      // Send enhanced response
      sendResponse(result);
    }, settleMs);
  });
  
  return true; // Keep message channel open for async response
});

// Action handler (stub - actual implementation would go here)
function handleAction(request, callback) {
  // This would be replaced with actual action handling
  // For now, just pass through to demonstrate the pattern
  
  try {
    // Simulate action handling
    switch(request.action) {
      case 'click':
        // Perform click action
        callback({ success: true, action: 'click' });
        break;
      case 'type':
        // Perform type action
        callback({ success: true, action: 'type' });
        break;
      default:
        callback({ success: false, error: 'Unknown action' });
    }
  } catch (error) {
    callback({ 
      success: false, 
      error: error.message,
      stack: error.stack
    });
  }
}

// Export error buffer for debugging
window.__getErrorBuffer = function() {
  return errorBuffer.slice(); // Return copy
};

window.__clearErrorBuffer = function() {
  errorBuffer.length = 0;
};

// Performance monitoring
window.__getBufferStats = function() {
  return {
    bufferSize: errorBuffer.length,
    oldestEntry: errorBuffer[0]?.ts,
    newestEntry: errorBuffer[errorBuffer.length - 1]?.ts,
    memoryUsage: JSON.stringify(errorBuffer).length
  };
};

console.log('[BrowserMCP] Enhanced content script with error buffer loaded');