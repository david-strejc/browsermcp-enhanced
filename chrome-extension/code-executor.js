/**
 * Code Executor - Sandboxed JavaScript execution in page context
 * Pattern B: Limited API wrapper for security
 */

// Sandboxed API exposed to user code
const MCPSafeAPI = {
  // DOM Query operations (read-only)
  $: (selector) => document.querySelector(selector),
  $$: (selector) => Array.from(document.querySelectorAll(selector)),
  
  // Safe getters
  getText: (selector) => {
    const el = document.querySelector(selector);
    return el ? el.textContent.trim() : null;
  },
  
  getValue: (selector) => {
    const el = document.querySelector(selector);
    return el ? el.value : null;
  },
  
  getAttribute: (selector, attr) => {
    const el = document.querySelector(selector);
    return el ? el.getAttribute(attr) : null;
  },
  
  exists: (selector) => !!document.querySelector(selector),
  
  count: (selector) => document.querySelectorAll(selector).length,
  
  // Safe DOM manipulation
  click: (selector) => {
    const el = document.querySelector(selector);
    if (el) el.click();
    return !!el;
  },
  
  setValue: (selector, value) => {
    const el = document.querySelector(selector);
    if (el && ('value' in el)) {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  },
  
  hide: (selector) => {
    const elements = document.querySelectorAll(selector);
    elements.forEach(el => el.style.display = 'none');
    return elements.length;
  },
  
  show: (selector) => {
    const elements = document.querySelectorAll(selector);
    elements.forEach(el => el.style.display = '');
    return elements.length;
  },
  
  addClass: (selector, className) => {
    const elements = document.querySelectorAll(selector);
    elements.forEach(el => el.classList.add(className));
    return elements.length;
  },
  
  removeClass: (selector, className) => {
    const elements = document.querySelectorAll(selector);
    elements.forEach(el => el.classList.remove(className));
    return elements.length;
  },
  
  // Data extraction
  extractTable: (selector) => {
    const table = document.querySelector(selector);
    if (!table) return null;
    
    const rows = Array.from(table.querySelectorAll('tr'));
    return rows.map(row => {
      const cells = Array.from(row.querySelectorAll('td, th'));
      return cells.map(cell => cell.textContent.trim());
    });
  },
  
  extractLinks: (containerSelector = 'body') => {
    const container = document.querySelector(containerSelector);
    if (!container) return [];
    
    return Array.from(container.querySelectorAll('a[href]')).map(a => ({
      text: a.textContent.trim(),
      href: a.href,
      target: a.target
    }));
  },
  
  // Utilities
  wait: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  
  scrollTo: (selector) => {
    const el = document.querySelector(selector);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return true;
    }
    return false;
  },
  
  getPageInfo: () => ({
    url: window.location.href,
    title: document.title,
    domain: window.location.hostname,
    path: window.location.pathname,
    params: Object.fromEntries(new URLSearchParams(window.location.search))
  }),
  
  // Console operations (for debugging)
  log: (...args) => {
    console.log('[MCP Exec]', ...args);
    return args[0]; // Return first arg for chaining
  }
};

// Execution state
let currentExecution = null;
let abortController = null;

// Execute user code with timeout and abort support
async function executeUserCode(code, timeout = 5000, unsafe = false) {
  // Create abort controller
  abortController = new AbortController();
  const signal = abortController.signal;
  
  try {
    let result;
    
    if (unsafe) {
      // UNSAFE MODE: Full access to page context
      console.warn('[Code Executor] ⚠️ Running in UNSAFE mode - full page access');
      
      // Create async function with full access
      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
      
      // Provide full access: window, document, chrome (if available), fetch, etc.
      const unsafeFunction = new AsyncFunction(
        'window', 'document', 'chrome', 'fetch', 'XMLHttpRequest', 'signal',
        code
      );
      
      // Execute with full context
      const executionPromise = unsafeFunction(
        window,
        document,
        typeof chrome !== 'undefined' ? chrome : undefined,
        fetch,
        XMLHttpRequest,
        signal
      );
      
      // Create timeout promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          abortController.abort();
          reject(new Error(`Execution timeout after ${timeout}ms`));
        }, timeout);
      });
      
      // Race between execution and timeout
      result = await Promise.race([executionPromise, timeoutPromise]);
      
    } else {
      // SAFE MODE: Limited API only
      console.log('[Code Executor] Running in SAFE mode - sandboxed API only');
      
      // Wrap code in async function with API parameter
      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
      const userFunction = new AsyncFunction('api', 'signal', code);
      
      // Create execution promise with sandboxed API
      const executionPromise = userFunction(MCPSafeAPI, signal);
      
      // Create timeout promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          abortController.abort();
          reject(new Error(`Execution timeout after ${timeout}ms`));
        }, timeout);
      });
      
      // Race between execution and timeout
      result = await Promise.race([executionPromise, timeoutPromise]);
    }
    
    // Ensure result is serializable
    return JSON.parse(JSON.stringify(result));
    
  } catch (error) {
    if (signal.aborted) {
      throw new Error('Execution aborted: ' + (error.message || 'Timeout'));
    }
    throw error;
  } finally {
    abortController = null;
  }
}

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'execute.code') {
    const { code, timeout, executionId, unsafe = false } = message;
    
    console.log('[Code Executor] Executing code with ID:', executionId, 'Mode:', unsafe ? 'UNSAFE' : 'SAFE');
    currentExecution = executionId;
    
    executeUserCode(code, timeout, unsafe)
      .then(result => {
        console.log('[Code Executor] Success:', result);
        sendResponse({
          success: true,
          result: result,
          executionId: executionId,
          mode: unsafe ? 'unsafe' : 'safe'
        });
      })
      .catch(error => {
        console.error('[Code Executor] Error:', error);
        sendResponse({
          success: false,
          error: error.message || 'Unknown error',
          executionId: executionId,
          mode: unsafe ? 'unsafe' : 'safe'
        });
      })
      .finally(() => {
        currentExecution = null;
      });
    
    return true; // Keep channel open for async response
  }
  
  if (message.type === 'execute.abort') {
    const { executionId } = message;
    
    if (currentExecution === executionId && abortController) {
      console.log('[Code Executor] Aborting execution:', executionId);
      abortController.abort();
      sendResponse({ aborted: true });
    } else {
      sendResponse({ aborted: false, reason: 'No matching execution' });
    }
  }
  
  if (message.type === 'execute.ping') {
    // Health check
    sendResponse({ 
      healthy: true,
      currentExecution: currentExecution,
      apiVersion: '1.0'
    });
  }
});

// Notify that executor is ready
console.log('[Code Executor] Initialized with safe API');
window.__codeExecutorReady = true;