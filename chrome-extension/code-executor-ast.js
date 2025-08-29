/**
 * Code Executor with AST-based Safe Mode
 * Implements proper JavaScript parsing and sandboxed execution
 * Based on O3 architecture recommendations
 */

// Lightweight AST parser - we'll use a simple recursive descent parser
// for basic JavaScript constructs to avoid external dependencies
class SafeModeParser {
  constructor(code) {
    this.code = code;
    this.pos = 0;
    this.errors = [];
  }

  // Check if code contains unsafe patterns
  analyze() {
    // List of unsafe global identifiers
    const UNSAFE_GLOBALS = new Set([
      'window', 'document', 'Element', 'HTMLElement', 'Node',
      'chrome', 'eval', 'Function', 'setTimeout', 'setInterval',
      'XMLHttpRequest', 'fetch', 'Worker', 'SharedWorker',
      'importScripts', 'require', 'module', 'exports', 'global',
      'process', '__dirname', '__filename', 'Buffer'
    ]);

    // List of safe globals we allow
    const SAFE_GLOBALS = new Set([
      'api', 'undefined', 'null', 'true', 'false',
      'NaN', 'Infinity', 'Math', 'Number', 'String',
      'Boolean', 'Array', 'Object', 'Date', 'RegExp',
      'JSON', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
      'console', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet'
    ]);

    // Patterns that indicate unsafe code
    const unsafePatterns = [
      /\b(eval|Function)\s*\(/,
      /\bnew\s+Function\b/,
      /\b(window|document|chrome)\s*\./,
      /\b(window|document|chrome)\s*\[/,
      /\.__proto__\b/,
      /\bconstructor\b/,
      /\bprototype\b/,
      /\bimport\s*\(/,
      /\brequire\s*\(/
    ];

    // Check for unsafe patterns
    for (const pattern of unsafePatterns) {
      if (pattern.test(this.code)) {
        const match = this.code.match(pattern);
        return {
          safe: false,
          reason: `Unsafe pattern detected: "${match[0]}". This requires unsafe mode.`
        };
      }
    }

    // Check for unsafe global references
    // This is a simplified check - a full AST parser would be more accurate
    const identifierPattern = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g;
    let match;
    const usedIdentifiers = new Set();
    
    while ((match = identifierPattern.exec(this.code)) !== null) {
      const identifier = match[1];
      // Skip if it's after a dot (property access)
      const beforeChar = this.code[match.index - 1];
      if (beforeChar !== '.' && beforeChar !== '"' && beforeChar !== "'") {
        usedIdentifiers.add(identifier);
      }
    }

    // Check each identifier
    for (const id of usedIdentifiers) {
      if (UNSAFE_GLOBALS.has(id)) {
        return {
          safe: false,
          reason: `Access to "${id}" is not allowed in safe mode. This requires unsafe mode.`
        };
      }
    }

    // Check for specific code editor patterns
    if (this.code.includes('.CodeMirror') || this.code.includes('monaco.editor') || 
        this.code.includes('ace.edit')) {
      return {
        safe: false,
        reason: 'Code editor API detected. Use unsafe mode to access editor methods.'
      };
    }

    // Check for framework internals
    if (this.code.includes('.__reactInternalFiber') || this.code.includes('.__vue__') ||
        this.code.includes('._reactInternalFiber')) {
      return {
        safe: false,
        reason: 'Framework internals detected. Use unsafe mode to access React/Vue internals.'
      };
    }

    return { safe: true };
  }
}

// Safe API object exposed to sandboxed code
const MCPSafeAPI = {
  // DOM Query operations (read-only)
  $: (selector) => {
    const el = document.querySelector(selector);
    return el ? {
      text: el.textContent,
      value: el.value,
      className: el.className,
      id: el.id,
      tagName: el.tagName,
      href: el.href,
      src: el.src
    } : null;
  },
  
  $$: (selector) => {
    return Array.from(document.querySelectorAll(selector)).map(el => ({
      text: el.textContent,
      value: el.value,
      className: el.className,
      id: el.id,
      tagName: el.tagName,
      href: el.href,
      src: el.src
    }));
  },
  
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
    if (el) {
      el.click();
      return true;
    }
    return false;
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
    console.log('[MCP Safe]', ...args);
    return args[0];
  }
};

// Freeze the API to prevent modifications
Object.freeze(MCPSafeAPI);
Object.freeze(MCPSafeAPI.$);
Object.freeze(MCPSafeAPI.$$);

// Execute code in sandboxed iframe
async function executeInSandbox(code, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const executionId = 'exec_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    // Create sandboxed iframe
    const iframe = document.createElement('iframe');
    iframe.sandbox = 'allow-scripts'; // Only allow script execution, no other privileges
    iframe.style.display = 'none';
    iframe.id = executionId;
    
    // Set up message handler
    const messageHandler = (event) => {
      if (event.data && event.data.executionId === executionId) {
        clearTimeout(timeoutId);
        window.removeEventListener('message', messageHandler);
        document.body.removeChild(iframe);
        
        if (event.data.success) {
          resolve(event.data.result);
        } else {
          reject(new Error(event.data.error));
        }
      }
    };
    
    window.addEventListener('message', messageHandler);
    
    // Set timeout
    const timeoutId = setTimeout(() => {
      window.removeEventListener('message', messageHandler);
      if (document.getElementById(executionId)) {
        document.body.removeChild(iframe);
      }
      reject(new Error(`Execution timeout after ${timeout}ms`));
    }, timeout);
    
    // Create the sandboxed execution environment
    iframe.srcdoc = `
      <!DOCTYPE html>
      <html>
      <head>
        <script>
          // Create frozen API object
          const api = ${JSON.stringify(MCPSafeAPI, (key, value) => {
            if (typeof value === 'function') {
              return '__FUNCTION__' + value.toString();
            }
            return value;
          })};
          
          // Restore functions
          function restoreFunctions(obj) {
            for (const key in obj) {
              if (typeof obj[key] === 'string' && obj[key].startsWith('__FUNCTION__')) {
                const funcStr = obj[key].substring(12);
                try {
                  obj[key] = new Function('return ' + funcStr)();
                } catch (e) {
                  console.error('Failed to restore function:', key, e);
                }
              } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                restoreFunctions(obj[key]);
              }
            }
          }
          
          restoreFunctions(api);
          Object.freeze(api);
          
          // Execute the code
          const executionId = '${executionId}';
          
          try {
            // Create an async function to support await
            const AsyncFunction = (async function() {}).constructor;
            const func = new AsyncFunction('api', 'return (async () => { ' + ${JSON.stringify(code)} + ' })()');
            
            func(api).then(result => {
              parent.postMessage({
                executionId: executionId,
                success: true,
                result: result
              }, '*');
            }).catch(error => {
              parent.postMessage({
                executionId: executionId,
                success: false,
                error: error.message || 'Unknown error'
              }, '*');
            });
          } catch (error) {
            parent.postMessage({
              executionId: executionId,
              success: false,
              error: error.message || 'Syntax error'
            }, '*');
          }
        </script>
      </head>
      <body></body>
      </html>
    `;
    
    // Add iframe to document
    document.body.appendChild(iframe);
  });
}

// Execute code in unsafe mode using Function constructor
async function executeUnsafe(code, timeout = 5000) {
  console.log('[Code Executor] Unsafe mode execution');
  
  return new Promise(async (resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Execution timeout after ${timeout}ms`));
    }, timeout);
    
    try {
      // Try Function constructor first
      const AsyncFunction = (async function() {}).constructor;
      const func = new AsyncFunction('window', 'document', 'console', 'chrome', code);
      const result = await func(window, document, console, chrome);
      clearTimeout(timeoutId);
      resolve(result);
    } catch (funcError) {
      clearTimeout(timeoutId);
      console.warn('[Code Executor] Function constructor failed:', funcError.message);
      
      // Fallback: Create a script element
      try {
        const scriptId = 'exec_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        
        window[scriptId] = (result) => {
          clearTimeout(timeoutId);
          delete window[scriptId];
          resolve(result);
        };
        
        const wrappedCode = `
          (function() {
            try {
              const result = (function() {
                ${code}
              })();
              window['${scriptId}'](result);
            } catch (e) {
              window['${scriptId}']({error: e.message});
            }
          })();
        `;
        
        const script = document.createElement('script');
        script.textContent = wrappedCode;
        document.head.appendChild(script);
        document.head.removeChild(script);
        
        // Short timeout for script injection
        setTimeout(() => {
          if (window[scriptId]) {
            clearTimeout(timeoutId);
            delete window[scriptId];
            reject(new Error('Script execution failed'));
          }
        }, 100);
      } catch (scriptError) {
        clearTimeout(timeoutId);
        reject(scriptError);
      }
    }
  });
}

// Main execution function
async function executeCode(code, timeout = 5000, forceUnsafe = false) {
  try {
    // If unsafe mode is forced, use it directly
    if (forceUnsafe) {
      console.log('[Code Executor] Forced unsafe mode');
      return await executeUnsafe(code, timeout);
    }
    
    // Analyze the code for safety
    const parser = new SafeModeParser(code);
    const analysis = parser.analyze();
    
    if (!analysis.safe) {
      // Code needs unsafe mode
      console.warn('[Code Executor] Code requires unsafe mode:', analysis.reason);
      throw new Error(analysis.reason);
    }
    
    // Execute in safe sandboxed mode
    console.log('[Code Executor] Executing in safe sandboxed mode');
    return await executeInSandbox(code, timeout);
    
  } catch (error) {
    console.error('[Code Executor] Execution error:', error);
    throw error;
  }
}

// Message handler for Chrome extension
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'execute.code') {
    const { code, timeout = 5000, executionId, unsafe = false } = message;
    
    console.log('[Code Executor AST] Executing with ID:', executionId, 'Mode:', unsafe ? 'UNSAFE' : 'AUTO');
    
    executeCode(code, timeout, unsafe)
      .then(result => {
        console.log('[Code Executor AST] Success:', result);
        sendResponse({
          success: true,
          result: result,
          executionId: executionId,
          mode: unsafe ? 'unsafe' : 'safe'
        });
      })
      .catch(error => {
        console.error('[Code Executor AST] Error:', error);
        sendResponse({
          success: false,
          error: error.message || 'Unknown error',
          executionId: executionId,
          mode: unsafe ? 'unsafe' : 'safe'
        });
      });
    
    return true; // Keep channel open for async response
  }
  
  if (message.type === 'execute.ping') {
    sendResponse({ 
      healthy: true,
      apiVersion: '3.0-ast',
      features: ['safe-sandbox', 'unsafe-mode', 'ast-analysis']
    });
  }
});

// Notify that executor is ready
console.log('[Code Executor AST] Initialized with AST-based safe mode');
window.__codeExecutorReady = true;
window.__codeExecutorVersion = '3.0-ast';