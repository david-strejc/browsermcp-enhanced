/**
 * Code Executor with RPC-based Safe Mode
 * Uses message passing between sandboxed iframe and parent for DOM access
 * Based on o3's architectural recommendations
 */

// Pattern analyzer to detect unsafe code
class SafeModeAnalyzer {
  constructor(code) {
    this.code = code;
  }

  analyze() {
    // List of unsafe global identifiers
    const UNSAFE_GLOBALS = new Set([
      'window', 'document', 'Element', 'HTMLElement', 'Node',
      'chrome', 'eval', 'Function', 'setTimeout', 'setInterval',
      'XMLHttpRequest', 'fetch', 'Worker', 'SharedWorker',
      'importScripts', 'require', 'module', 'exports', 'global',
      'process', '__dirname', '__filename', 'Buffer', 'parent', 'top'
    ]);

    // Patterns that indicate unsafe code
    const unsafePatterns = [
      /\b(eval|Function)\s*\(/,
      /\bnew\s+Function\b/,
      /\b(window|document|chrome|parent|top)\s*\./,
      /\b(window|document|chrome|parent|top)\s*\[/,
      /\.__proto__\b/,
      /\bconstructor\b\s*\.\s*constructor/,
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
    const identifierPattern = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g;
    let match;
    const usedIdentifiers = new Set();
    
    while ((match = identifierPattern.exec(this.code)) !== null) {
      const identifier = match[1];
      const beforeChar = this.code[match.index - 1];
      if (beforeChar !== '.' && beforeChar !== '"' && beforeChar !== "'") {
        usedIdentifiers.add(identifier);
      }
    }

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

// Safe API implementation in parent (content script)
const SafeAPIImplementation = {
  // DOM Query operations
  $: (selector) => {
    const el = document.querySelector(selector);
    return el ? {
      text: el.textContent,
      value: el.value,
      className: el.className,
      id: el.id,
      tagName: el.tagName,
      href: el.href,
      src: el.src,
      exists: true
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
  
  wait: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  
  log: (...args) => {
    console.log('[MCP Safe]', ...args);
    return args[0];
  }
};

// Active sandboxes tracking
const activeSandboxes = new Map();

// Execute code in RPC-based sandbox
async function executeInRPCSandbox(code, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const sandboxId = 'sandbox_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    // Create MessageChannel for secure communication
    const channel = new MessageChannel();
    
    // Set up message handler for RPC calls from sandbox
    channel.port1.onmessage = async (event) => {
      const { id, method, args, type } = event.data;
      
      if (type === 'rpc') {
        let result, error;
        try {
          // Execute the API method in parent context
          if (SafeAPIImplementation[method]) {
            result = await SafeAPIImplementation[method](...args);
          } else {
            throw new Error(`Unknown API method: ${method}`);
          }
        } catch (e) {
          error = e.message;
        }
        
        // Send response back to sandbox
        channel.port1.postMessage({ id, result, error });
      } else if (type === 'result') {
        // Final execution result
        clearTimeout(timeoutId);
        cleanupSandbox();
        
        if (event.data.error) {
          reject(new Error(event.data.error));
        } else {
          resolve(event.data.value);
        }
      }
    };
    
    // Create sandboxed iframe
    const iframe = document.createElement('iframe');
    iframe.sandbox = 'allow-scripts'; // Only allow script execution
    iframe.style.display = 'none';
    iframe.id = sandboxId;
    
    // Clean up function
    const cleanupSandbox = () => {
      channel.port1.close();
      if (document.getElementById(sandboxId)) {
        document.body.removeChild(iframe);
      }
      activeSandboxes.delete(sandboxId);
    };
    
    // Set timeout
    const timeoutId = setTimeout(() => {
      cleanupSandbox();
      reject(new Error(`Execution timeout after ${timeout}ms`));
    }, timeout);
    
    // Store sandbox info
    activeSandboxes.set(sandboxId, { iframe, channel, timeoutId });
    
    // Create the sandboxed execution environment with RPC client
    iframe.srcdoc = `
      <!DOCTYPE html>
      <html>
      <head>
        <script>
          // Wait for initialization message with MessagePort
          let port;
          let rpcId = 0;
          const pendingCalls = new Map();
          
          window.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'init') {
              port = event.ports[0];
              
              // Set up RPC response handler
              port.onmessage = (e) => {
                const { id, result, error } = e.data;
                const pending = pendingCalls.get(id);
                if (pending) {
                  pendingCalls.delete(id);
                  if (error) {
                    pending.reject(new Error(error));
                  } else {
                    pending.resolve(result);
                  }
                }
              };
              
              // Start execution
              executeCode();
            }
          });
          
          // RPC call function
          function rpcCall(method, ...args) {
            return new Promise((resolve, reject) => {
              const id = ++rpcId;
              pendingCalls.set(id, { resolve, reject });
              port.postMessage({ type: 'rpc', id, method, args });
            });
          }
          
          // Create API proxy that makes RPC calls
          const api = new Proxy({}, {
            get: (target, prop) => {
              // Special case for wait - implement locally
              if (prop === 'wait') {
                return (ms) => new Promise(resolve => setTimeout(resolve, ms));
              }
              // All other methods are RPC calls
              return (...args) => rpcCall(prop, ...args);
            }
          });
          
          // Freeze the API object
          Object.freeze(api);
          
          // Execute the user code
          async function executeCode() {
            try {
              // Create an async function to support await
              const AsyncFunction = (async function() {}).constructor;
              const func = new AsyncFunction('api', ${JSON.stringify(code)});
              
              // Execute and get result
              const result = await func(api);
              
              // Send result back
              port.postMessage({ type: 'result', value: result });
            } catch (error) {
              port.postMessage({ type: 'result', error: error.message || 'Execution error' });
            }
          }
        </script>
      </head>
      <body></body>
      </html>
    `;
    
    // Add iframe to document
    document.body.appendChild(iframe);
    
    // Send initialization message with MessagePort after iframe loads
    iframe.onload = () => {
      iframe.contentWindow.postMessage({ type: 'init' }, '*', [channel.port2]);
    };
  });
}

// Execute code in unsafe mode using Function constructor
async function executeUnsafe(code, timeout = 5000) {
  console.log('[Code Executor RPC] Unsafe mode execution');
  
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
      console.warn('[Code Executor RPC] Function constructor failed:', funcError.message);
      reject(funcError);
    }
  });
}

// Main execution function
async function executeCode(code, timeout = 5000, forceUnsafe = false) {
  try {
    // If unsafe mode is forced, use it directly
    if (forceUnsafe) {
      console.log('[Code Executor RPC] Forced unsafe mode');
      return await executeUnsafe(code, timeout);
    }
    
    // Analyze the code for safety
    const analyzer = new SafeModeAnalyzer(code);
    const analysis = analyzer.analyze();
    
    if (!analysis.safe) {
      // Code needs unsafe mode
      console.warn('[Code Executor RPC] Code requires unsafe mode:', analysis.reason);
      throw new Error(analysis.reason);
    }
    
    // Execute in safe RPC sandbox
    console.log('[Code Executor RPC] Executing in safe RPC sandbox');
    return await executeInRPCSandbox(code, timeout);
    
  } catch (error) {
    console.error('[Code Executor RPC] Execution error:', error);
    throw error;
  }
}

// Message handler for Chrome extension
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'execute.code') {
    const { code, timeout = 5000, executionId, unsafe = false } = message;
    
    console.log('[Code Executor RPC] Executing with ID:', executionId, 'Mode:', unsafe ? 'UNSAFE' : 'SAFE');
    
    executeCode(code, timeout, unsafe)
      .then(result => {
        console.log('[Code Executor RPC] Success:', result);
        sendResponse({
          success: true,
          result: result,
          executionId: executionId,
          mode: unsafe ? 'unsafe' : 'safe-rpc'
        });
      })
      .catch(error => {
        console.error('[Code Executor RPC] Error:', error);
        
        // Provide helpful error messages
        let errorMessage = error.message || 'Unknown error';
        let hint = '';
        
        if (errorMessage.includes('requires unsafe mode')) {
          hint = '\n💡 Switch to unsafe mode to use these features.';
        } else if (errorMessage.includes('timeout')) {
          hint = '\n💡 Code execution took too long. Try simplifying your code or increasing timeout.';
        }
        
        sendResponse({
          success: false,
          error: errorMessage + hint,
          executionId: executionId,
          mode: unsafe ? 'unsafe' : 'safe-rpc'
        });
      });
    
    return true; // Keep channel open for async response
  }
  
  if (message.type === 'execute.ping') {
    sendResponse({ 
      healthy: true,
      apiVersion: '4.0-rpc',
      features: ['safe-rpc-sandbox', 'unsafe-mode', 'pattern-analysis', 'async-api']
    });
  }
});

// Notify that executor is ready
console.log('[Code Executor RPC] Initialized with RPC-based safe mode');
window.__codeExecutorReady = true;
window.__codeExecutorVersion = '4.0-rpc';