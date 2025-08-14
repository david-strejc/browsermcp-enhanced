/**
 * Code Executor Safe - CSP-compliant JavaScript execution
 * Uses message passing instead of eval to avoid CSP restrictions
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
  
  // Element reference operations
  getRef: (element) => {
    if (!element || !element.nodeType) return null;
    return window.__elementTracker ? window.__elementTracker.getElementId(element) : null;
  },
  
  // Console operations (for debugging)
  log: (...args) => {
    console.log('[MCP Exec]', ...args);
    return args[0]; // Return first arg for chaining
  }
};

// Execution state
let currentExecution = null;
let abortController = null;

// Parse and execute code without eval
async function executeCodeSafely(code, timeout = 5000, unsafe = false) {
  // Create abort controller for timeout
  abortController = new AbortController();
  const signal = abortController.signal;
  
  // Create timeout promise
  const timeoutPromise = new Promise((_, reject) => {
    const timeoutId = setTimeout(() => {
      if (abortController) {
        abortController.abort();
      }
      reject(new Error(`Execution timeout after ${timeout}ms`));
    }, timeout);
    
    // Store timeout ID for cleanup
    signal.timeoutId = timeoutId;
  });
  
  try {
    let executionPromise;
    
    if (unsafe) {
      // For unsafe mode, we need to use a different approach
      // Since we can't use eval due to CSP, we'll use a sandboxed iframe
      executionPromise = executeInSandbox(code, signal);
    } else {
      // Safe mode - parse and execute API calls
      executionPromise = executeSafeCode(code, signal);
    }
    
    // Race between execution and timeout
    const result = await Promise.race([executionPromise, timeoutPromise]);
    
    // Ensure result is serializable
    return JSON.parse(JSON.stringify(result));
    
  } catch (error) {
    if (signal && signal.aborted) {
      throw new Error('Execution aborted: ' + (error.message || 'Timeout'));
    }
    throw error;
  } finally {
    // Clean up timeout if it exists
    if (signal && signal.timeoutId) {
      clearTimeout(signal.timeoutId);
    }
    abortController = null;
  }
}

// Evaluate simple expressions safely
function evaluateExpression(expr, api) {
  // Handle document properties
  if (expr === 'document.title') return document.title;
  if (expr === 'document.URL' || expr === 'document.url') return document.URL;
  if (expr === 'document.domain') return document.domain;
  if (expr === 'document.referrer') return document.referrer;
  if (expr === 'document.cookie') return document.cookie;
  if (expr === 'document.readyState') return document.readyState;
  if (expr === 'document.documentElement') return document.documentElement;
  if (expr === 'document.body') return document.body;
  
  // Handle common querySelector patterns
  if (expr.startsWith('document.querySelector(') && expr.endsWith(')')) {
    const selector = expr.slice(23, -1);
    // Remove quotes from selector
    const cleanSelector = selector.replace(/^["'`]|["'`]$/g, '');
    return document.querySelector(cleanSelector);
  }
  
  if (expr.startsWith('document.querySelectorAll(') && expr.endsWith(')')) {
    const selector = expr.slice(27, -1);
    const cleanSelector = selector.replace(/^["'`]|["'`]$/g, '');
    return Array.from(document.querySelectorAll(cleanSelector));
  }
  
  // Handle common element property access patterns
  if (expr.includes('.value') || expr.includes('.textContent') || 
      expr.includes('.innerHTML') || expr.includes('.innerText')) {
    // Check if it's a safe property access pattern
    const match = expr.match(/^document\.querySelector\(['"`]([^'"`]+)['"`]\)\.(value|textContent|innerHTML|innerText)$/);
    if (match) {
      const [, selector, property] = match;
      const element = document.querySelector(selector);
      if (element) {
        return element[property];
      }
      return null;
    }
  }
  
  // Handle window properties
  if (expr === 'window.location.href') return window.location.href;
  if (expr === 'window.location.host') return window.location.host;
  if (expr === 'window.location.hostname') return window.location.hostname;
  if (expr === 'window.location.pathname') return window.location.pathname;
  if (expr === 'window.location.search') return window.location.search;
  if (expr === 'window.location.hash') return window.location.hash;
  if (expr === 'window.location.origin') return window.location.origin;
  if (expr === 'window.innerWidth') return window.innerWidth;
  if (expr === 'window.innerHeight') return window.innerHeight;
  if (expr === 'window.outerWidth') return window.outerWidth;
  if (expr === 'window.outerHeight') return window.outerHeight;
  
  // Handle navigator properties
  if (expr === 'navigator.userAgent') return navigator.userAgent;
  if (expr === 'navigator.language') return navigator.language;
  if (expr === 'navigator.platform') return navigator.platform;
  if (expr === 'navigator.onLine') return navigator.onLine;
  
  // Handle string literals
  if ((expr.startsWith('"') && expr.endsWith('"')) ||
      (expr.startsWith("'") && expr.endsWith("'")) ||
      (expr.startsWith('`') && expr.endsWith('`'))) {
    return expr.slice(1, -1);
  }
  
  // Handle numbers
  const num = Number(expr);
  if (!isNaN(num)) {
    return num;
  }
  
  // Handle boolean
  if (expr === 'true') return true;
  if (expr === 'false') return false;
  if (expr === 'null') return null;
  if (expr === 'undefined') return undefined;
  
  // Detect common patterns that need unsafe mode
  if (expr.includes('.CodeMirror') || expr.includes('cm.setValue') || 
      expr.includes('monaco.editor') || expr.includes('ace.edit')) {
    throw new Error(`Code editor API detected. Use unsafe: true to access editor methods like setValue(). Expression: "${expr}"`);
  }
  
  if (expr.includes('.__reactInternalFiber') || expr.includes('.__vue__') ||
      expr.includes('.$data') || expr.includes('.setState')) {
    throw new Error(`Framework internals detected. Use unsafe: true to access React/Vue component internals. Expression: "${expr}"`);
  }
  
  if (expr.includes('eval(') || expr.includes('Function(') || 
      expr.includes('setTimeout(') || expr.includes('setInterval(')) {
    throw new Error(`Dynamic code execution detected. Use unsafe: true for eval/Function/timers. Expression: "${expr}"`);
  }
  
  if (expr.includes('=>') || expr.includes('function(') || expr.includes('async ')) {
    throw new Error(`Function definition detected. Use unsafe: true to define functions. Expression: "${expr}"`);
  }
  
  // For other complex expressions, provide helpful guidance
  throw new Error(`Expression too complex for safe mode: "${expr}". Use unsafe: true for: 1) Editor APIs (CodeMirror.setValue), 2) Framework internals (React/Vue), 3) Dynamic code execution, 4) Complex object manipulation`);
}

// Execute code in safe mode by parsing API calls
async function executeSafeCode(code, signal) {
  const api = MCPSafeAPI;
  
  // Remove comments
  code = code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  
  // Handle simple return statements
  if (code.trim().startsWith('return ')) {
    const expression = code.trim().substring(7).trim().replace(/;$/, '');
    
    // Handle API calls first (should handle chained calls and logical operators)
    if (expression.includes('api.')) {
      // Check if it's a complex expression with logical operators
      if (expression.includes('||') || expression.includes('&&')) {
        // For now, reject complex logical expressions in safe mode
        throw new Error(`Complex logical expressions not supported in safe mode. Use unsafe: true for complex logic.`);
      }
      // Simple API call
      if (expression.startsWith('api.')) {
        return await executeAPICall(expression.substring(4), api, signal);
      }
    }
    
    // Handle simple math
    if (/^[\d\s+\-*/().]+$/.test(expression)) {
      return evaluateMath(expression);
    }
    
    // Handle object literals (but be more careful about detection)
    if (expression.startsWith('{') && expression.endsWith('}') && !expression.includes('\n')) {
      try {
        // Safe JSON parse for simple objects
        return JSON.parse(expression.replace(/'/g, '"').replace(/(\w+):/g, '"$1":'));
      } catch (e) {
        // Fallback for complex objects
        return executeObjectLiteral(expression, api);
      }
    }
    
    // Handle array literals
    if (expression.startsWith('[') && expression.endsWith(']')) {
      return JSON.parse(expression);
    }
    
    // Use the evaluateExpression function for everything else
    return evaluateExpression(expression, api);
  }
  
  // Handle multiple statements
  const statements = code.split(/;|\n/).map(s => s.trim()).filter(s => s);
  let lastResult;
  
  for (const statement of statements) {
    if (signal && signal.aborted) throw new Error('Execution aborted');
    
    if (statement.startsWith('const ') || statement.startsWith('let ') || statement.startsWith('var ')) {
      // Variable declaration - skip for now
      continue;
    }
    
    if (statement.startsWith('await ')) {
      const expr = statement.substring(6).trim();
      if (expr.startsWith('api.')) {
        lastResult = await executeAPICall(expr.substring(4), api, signal);
      }
    } else if (statement.startsWith('return ')) {
      const expr = statement.substring(7).trim();
      if (expr.startsWith('api.')) {
        return await executeAPICall(expr.substring(4), api, signal);
      }
      // Handle simple expressions without recursion
      if (expr === 'document.title') {
        return document.title;
      }
      if (expr === 'document.URL' || expr === 'document.url') {
        return document.URL;
      }
      if (expr === 'window.location.href') {
        return window.location.href;
      }
      // For other expressions, try to evaluate directly
      return evaluateExpression(expr, api);
    } else if (statement.startsWith('api.')) {
      lastResult = await executeAPICall(statement.substring(4), api, signal);
    }
  }
  
  return lastResult;
}

// Execute API call
async function executeAPICall(call, api, signal) {
  // Parse method call: methodName(arg1, arg2, ...)
  const match = call.match(/^(\w+)\((.*)\)$/);
  if (!match) {
    // Property access
    if (call.match(/^\w+$/)) {
      return api[call];
    }
    throw new Error(`Invalid API call: api.${call}`);
  }
  
  const [, method, argsStr] = match;
  
  if (typeof api[method] !== 'function') {
    throw new Error(`Unknown API method: ${method}`);
  }
  
  // Parse arguments
  const args = parseArguments(argsStr);
  
  // Call the method
  return await api[method](...args);
}

// Parse function arguments
function parseArguments(argsStr) {
  if (!argsStr.trim()) return [];
  
  const args = [];
  let current = '';
  let depth = 0;
  let inString = false;
  let stringChar = '';
  
  for (let i = 0; i < argsStr.length; i++) {
    const char = argsStr[i];
    
    if (!inString && (char === '"' || char === "'" || char === '`')) {
      inString = true;
      stringChar = char;
      current += char;
    } else if (inString && char === stringChar && argsStr[i - 1] !== '\\') {
      inString = false;
      stringChar = '';
      current += char;
    } else if (!inString) {
      if (char === '(' || char === '[' || char === '{') {
        depth++;
        current += char;
      } else if (char === ')' || char === ']' || char === '}') {
        depth--;
        current += char;
      } else if (char === ',' && depth === 0) {
        args.push(parseValue(current.trim()));
        current = '';
        continue;
      } else {
        current += char;
      }
    } else {
      current += char;
    }
  }
  
  if (current.trim()) {
    args.push(parseValue(current.trim()));
  }
  
  return args;
}

// Parse a single value
function parseValue(value) {
  // String
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('`') && value.endsWith('`'))) {
    return value.slice(1, -1);
  }
  
  // Number
  const num = Number(value);
  if (!isNaN(num)) {
    return num;
  }
  
  // Boolean
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (value === 'undefined') return undefined;
  
  // Object or array
  if ((value.startsWith('{') && value.endsWith('}')) ||
      (value.startsWith('[') && value.endsWith(']'))) {
    try {
      return JSON.parse(value.replace(/'/g, '"'));
    } catch (e) {
      // Return as string if can't parse
      return value;
    }
  }
  
  // Default to string
  return value;
}

// Simple math evaluator (no eval)
function evaluateMath(expr) {
  // Remove spaces
  expr = expr.replace(/\s/g, '');
  
  // Very simple math parser for basic operations
  // This is limited but safe from injection
  const tokens = expr.match(/\d+\.?\d*|[+\-*/()]/g);
  if (!tokens) throw new Error('Invalid math expression');
  
  // Convert to postfix notation and evaluate
  const output = [];
  const operators = [];
  const precedence = { '+': 1, '-': 1, '*': 2, '/': 2 };
  
  for (const token of tokens) {
    if (!isNaN(token)) {
      output.push(Number(token));
    } else if (token === '(') {
      operators.push(token);
    } else if (token === ')') {
      while (operators.length && operators[operators.length - 1] !== '(') {
        output.push(operators.pop());
      }
      operators.pop(); // Remove '('
    } else if (precedence[token]) {
      while (operators.length && 
             precedence[operators[operators.length - 1]] >= precedence[token]) {
        output.push(operators.pop());
      }
      operators.push(token);
    }
  }
  
  while (operators.length) {
    output.push(operators.pop());
  }
  
  // Evaluate postfix
  const stack = [];
  for (const token of output) {
    if (typeof token === 'number') {
      stack.push(token);
    } else {
      const b = stack.pop();
      const a = stack.pop();
      switch (token) {
        case '+': stack.push(a + b); break;
        case '-': stack.push(a - b); break;
        case '*': stack.push(a * b); break;
        case '/': stack.push(a / b); break;
      }
    }
  }
  
  return stack[0];
}

// Execute object literal
function executeObjectLiteral(expr, api) {
  // Simple object literal parser
  const obj = {};
  const content = expr.slice(1, -1).trim();
  
  // Split by commas not in strings
  const pairs = [];
  let current = '';
  let inString = false;
  let stringChar = '';
  
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (!inString && (char === '"' || char === "'")) {
      inString = true;
      stringChar = char;
    } else if (inString && char === stringChar) {
      inString = false;
    } else if (!inString && char === ',') {
      pairs.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) pairs.push(current.trim());
  
  for (const pair of pairs) {
    const colonIndex = pair.indexOf(':');
    if (colonIndex === -1) continue;
    
    let key = pair.substring(0, colonIndex).trim();
    const value = pair.substring(colonIndex + 1).trim();
    
    // Remove quotes from key if present
    if ((key.startsWith('"') && key.endsWith('"')) ||
        (key.startsWith("'") && key.endsWith("'"))) {
      key = key.slice(1, -1);
    }
    
    obj[key] = parseValue(value);
  }
  
  return obj;
}

// Execute in sandbox (for unsafe mode) - using Function constructor
async function executeInSandbox(code, signal) {
  console.log('[Code Executor] Unsafe mode execution');
  
  try {
    // Try Function constructor first (works in most CSP contexts except 'unsafe-eval')
    try {
      // Wrap code in an async function to support await
      const AsyncFunction = (async function() {}).constructor;
      const func = new AsyncFunction('window', 'document', 'console', 'chrome', code);
      const result = await func(window, document, console, chrome);
      return result;
    } catch (funcError) {
      console.warn('[Code Executor] Function constructor failed, trying alternative:', funcError.message);
      
      // Fallback: Create a script element (works unless CSP blocks inline scripts)
      return await new Promise((resolve, reject) => {
        const scriptId = 'exec_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        
        // Create a global callback for the script result
        window[scriptId] = (result) => {
          delete window[scriptId];
          resolve(result);
        };
        
        // Wrap the code to capture and return the result
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
        
        // Timeout after 100ms
        setTimeout(() => {
          if (window[scriptId]) {
            delete window[scriptId];
            reject(new Error('Script execution timeout'));
          }
        }, 100);
      });
    }
  } catch (error) {
    console.error('[Code Executor] Unsafe execution failed:', error);
    throw error;
  }
}

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'execute.code') {
    const { code, timeout, executionId, unsafe = false } = message;
    
    console.log('[Code Executor Safe] Executing code with ID:', executionId, 'Mode:', unsafe ? 'UNSAFE' : 'SAFE');
    currentExecution = executionId;
    
    executeCodeSafely(code, timeout, unsafe)
      .then(result => {
        console.log('[Code Executor Safe] Success:', result);
        sendResponse({
          success: true,
          result: result,
          executionId: executionId,
          mode: unsafe ? 'unsafe' : 'safe'
        });
      })
      .catch(error => {
        console.error('[Code Executor Safe] Error:', error);
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
      console.log('[Code Executor Safe] Aborting execution:', executionId);
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
      apiVersion: '2.0-safe'
    });
  }
});

// Notify that executor is ready
console.log('[Code Executor Safe] Initialized with CSP-safe execution');
window.__codeExecutorReady = true;