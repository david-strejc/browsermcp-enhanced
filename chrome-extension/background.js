// WebSocket connection to MCP server
let ws = null;
let activeTabId = null;
let messageHandlers = new Map();

// Connect to MCP server
function connectToMCP() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    return;
  }
  
  ws = new WebSocket('ws://localhost:8765');
  
  ws.onopen = () => {
    console.log('Connected to MCP server');
  };
  
  ws.onmessage = async (event) => {
    try {
      const message = JSON.parse(event.data);
      console.log('Received message:', message);
      
      if (messageHandlers.has(message.type)) {
        const handler = messageHandlers.get(message.type);
        const response = await handler(message.payload);
        
        ws.send(JSON.stringify({
          id: message.id,
          type: message.type,
          payload: response
        }));
      } else {
        ws.send(JSON.stringify({
          id: message.id,
          type: message.type,
          error: `Unknown message type: ${message.type}`
        }));
      }
    } catch (error) {
      console.error('Error handling message:', error);
      ws.send(JSON.stringify({
        id: message.id,
        error: error.message
      }));
    }
  };
  
  ws.onclose = () => {
    console.log('Disconnected from MCP server');
    // Reconnect after 5 seconds
    setTimeout(connectToMCP, 5000);
  };
  
  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
}

// Tab management handlers
messageHandlers.set('tabs.list', async () => {
  const tabs = await chrome.tabs.query({});
  return {
    tabs: tabs.map(tab => ({
      id: String(tab.id),
      url: tab.url || '',
      title: tab.title || '',
      index: tab.index,
      active: tab.active
    }))
  };
});

messageHandlers.set('tabs.select', async ({ index }) => {
  const tabs = await chrome.tabs.query({ index });
  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    activeTabId = tabs[0].id;
    return { success: true };
  }
  return { success: false };
});

messageHandlers.set('tabs.new', async ({ url }) => {
  const tab = await chrome.tabs.create({ url: url || 'about:blank' });
  activeTabId = tab.id;
  return { 
    tabId: String(tab.id), 
    index: tab.index 
  };
});

messageHandlers.set('tabs.close', async ({ index }) => {
  if (index !== undefined) {
    const tabs = await chrome.tabs.query({ index });
    if (tabs.length > 0) {
      await chrome.tabs.remove(tabs[0].id);
      return { success: true };
    }
  } else if (activeTabId) {
    await chrome.tabs.remove(activeTabId);
    return { success: true };
  }
  return { success: false };
});

// Existing handlers
messageHandlers.set('snapshot.accessibility', async (options = {}) => {
  if (!activeTabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = tab?.id;
  }
  
  if (!activeTabId) {
    throw new Error('No active tab');
  }
  
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    func: captureAccessibilitySnapshot,
    args: [options]
  });
  
  return { snapshot: result.result };
});

messageHandlers.set('snapshot.query', async ({ selector, all }) => {
  if (!activeTabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = tab?.id;
  }
  
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    func: queryElements,
    args: [selector, all]
  });
  
  return result.result;
});

messageHandlers.set('dom.click', async ({ ref }) => {
  await chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    func: clickElement,
    args: [ref]
  });
  return {};
});

messageHandlers.set('dom.hover', async ({ ref }) => {
  await chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    func: hoverElement,
    args: [ref]
  });
  return {};
});

messageHandlers.set('dom.type', async ({ ref, text, submit }) => {
  await chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    func: typeInElement,
    args: [ref, text, submit]
  });
  return {};
});

messageHandlers.set('dom.select', async ({ ref, values }) => {
  await chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    func: selectOptions,
    args: [ref, values]
  });
  return {};
});

messageHandlers.set('keyboard.press', async ({ key }) => {
  await chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    func: pressKey,
    args: [key]
  });
  return {};
});

messageHandlers.set('console.get', async () => {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    func: getConsoleLogs
  });
  return { logs: result.result || [] };
});

messageHandlers.set('screenshot.capture', async () => {
  const dataUrl = await chrome.tabs.captureVisibleTab();
  const base64 = dataUrl.split(',')[1];
  return { data: base64 };
});

messageHandlers.set('page.navigate', async ({ url }) => {
  await chrome.tabs.update(activeTabId, { url });
  return {};
});

messageHandlers.set('page.goBack', async () => {
  await chrome.tabs.goBack(activeTabId);
  return {};
});

messageHandlers.set('page.goForward', async () => {
  await chrome.tabs.goForward(activeTabId);
  return {};
});

messageHandlers.set('page.wait', async ({ time }) => {
  await new Promise(resolve => setTimeout(resolve, time * 1000));
  return {};
});

// Debugger handler instance
const debuggerHandler = {
  attached: false,
  tabId: null,
  data: {
    console: [],
    network: [],
    errors: [],
    performance: {}
  },
  maxEntries: 1000
};

// Debugger message handlers
messageHandlers.set('debugger.attach', async ({ domains = ["console", "network", "performance", "runtime"] }) => {
  if (debuggerHandler.attached) {
    await chrome.debugger.detach({ tabId: debuggerHandler.tabId });
  }

  debuggerHandler.tabId = activeTabId;
  
  return new Promise((resolve) => {
    chrome.debugger.attach({ tabId: activeTabId }, "1.3", async () => {
      if (chrome.runtime.lastError) {
        resolve({ error: chrome.runtime.lastError.message });
        return;
      }
      
      debuggerHandler.attached = true;
      
      // Enable requested domains
      try {
        if (domains.includes("console") || domains.includes("runtime")) {
          await chrome.debugger.sendCommand({ tabId: activeTabId }, "Runtime.enable", {});
        }
        if (domains.includes("network")) {
          await chrome.debugger.sendCommand({ tabId: activeTabId }, "Network.enable", {});
        }
        if (domains.includes("performance")) {
          await chrome.debugger.sendCommand({ tabId: activeTabId }, "Performance.enable", {});
        }
        
        // Always enable Log domain for errors
        await chrome.debugger.sendCommand({ tabId: activeTabId }, "Log.enable", {});
        
        resolve({ success: true });
      } catch (error) {
        resolve({ error: error.message });
      }
    });
  });
});

messageHandlers.set('debugger.detach', async () => {
  if (!debuggerHandler.attached) {
    return { success: false, error: "Debugger not attached" };
  }

  return new Promise((resolve) => {
    chrome.debugger.detach({ tabId: debuggerHandler.tabId }, () => {
      debuggerHandler.attached = false;
      debuggerHandler.tabId = null;
      
      // Keep only last 100 entries
      debuggerHandler.data.console = debuggerHandler.data.console.slice(-100);
      debuggerHandler.data.network = debuggerHandler.data.network.slice(-100);
      debuggerHandler.data.errors = debuggerHandler.data.errors.slice(-100);
      
      resolve({ success: true });
    });
  });
});

messageHandlers.set('debugger.getData', async ({ type, limit = 50, filter }) => {
  let data = [];

  switch (type) {
    case "console":
      data = debuggerHandler.data.console;
      break;
    case "network":
      data = debuggerHandler.data.network;
      break;
    case "errors":
      data = debuggerHandler.data.errors;
      break;
    case "performance":
      // Get fresh performance metrics
      if (debuggerHandler.attached) {
        try {
          const metrics = await chrome.debugger.sendCommand(
            { tabId: debuggerHandler.tabId }, 
            "Performance.getMetrics", 
            {}
          );
          const result = {};
          metrics.metrics.forEach(metric => {
            result[metric.name] = metric.value;
          });
          debuggerHandler.data.performance = result;
        } catch (error) {
          console.error("Failed to get performance metrics:", error);
        }
      }
      return { data: debuggerHandler.data.performance };
  }

  // Apply filter if provided
  if (filter && data.length > 0) {
    data = data.filter(item => 
      JSON.stringify(item).toLowerCase().includes(filter.toLowerCase())
    );
  }

  // Apply limit
  return { data: data.slice(-limit) };
});

// Debugger event listener
chrome.debugger.onEvent.addListener((source, method, params) => {
  if (source.tabId !== debuggerHandler.tabId) return;

  switch (method) {
    case "Runtime.consoleAPICalled":
      debuggerHandler.data.console.push({
        type: params.type,
        timestamp: new Date().toISOString(),
        args: params.args.map(arg => {
          if (arg.type === "string") return arg.value;
          if (arg.type === "number") return arg.value;
          if (arg.type === "boolean") return arg.value;
          if (arg.type === "undefined") return undefined;
          if (arg.type === "object" && arg.subtype === "null") return null;
          return arg.description || arg.type;
        }),
        stackTrace: params.stackTrace ? params.stackTrace.callFrames
          .map(f => `${f.functionName || '<anonymous>'} (${f.url}:${f.lineNumber}:${f.columnNumber})`)
          .join('\n    ') : null
      });
      if (debuggerHandler.data.console.length > debuggerHandler.maxEntries) {
        debuggerHandler.data.console = debuggerHandler.data.console.slice(-debuggerHandler.maxEntries);
      }
      break;
    
    case "Network.requestWillBeSent":
      debuggerHandler.data.network.push({
        id: params.requestId,
        url: params.request.url,
        method: params.request.method,
        type: params.type,
        timestamp: params.timestamp,
        initiator: params.initiator,
        headers: params.request.headers
      });
      if (debuggerHandler.data.network.length > debuggerHandler.maxEntries) {
        debuggerHandler.data.network = debuggerHandler.data.network.slice(-debuggerHandler.maxEntries);
      }
      break;
    
    case "Network.responseReceived":
      const request = debuggerHandler.data.network.find(r => r.id === params.requestId);
      if (request) {
        request.status = params.response.status;
        request.statusText = params.response.statusText;
        request.responseHeaders = params.response.headers;
        request.size = params.response.encodedDataLength;
        request.time = (params.timestamp - request.timestamp) * 1000; // Convert to ms
      }
      break;
    
    case "Runtime.exceptionThrown":
      debuggerHandler.data.errors.push({
        timestamp: new Date().toISOString(),
        message: params.exceptionDetails.text,
        url: params.exceptionDetails.url,
        line: params.exceptionDetails.lineNumber,
        column: params.exceptionDetails.columnNumber,
        stack: params.exceptionDetails.stackTrace ? 
          params.exceptionDetails.stackTrace.callFrames
            .map(f => `${f.functionName || '<anonymous>'} (${f.url}:${f.lineNumber}:${f.columnNumber})`)
            .join('\n    ') : null
      });
      if (debuggerHandler.data.errors.length > debuggerHandler.maxEntries) {
        debuggerHandler.data.errors = debuggerHandler.data.errors.slice(-debuggerHandler.maxEntries);
      }
      break;
  }
});

// Functions to inject into page
function captureAccessibilitySnapshot(options = {}) {
  // Enhanced implementation with stable element IDs and better formatting
  function isVisible(element) {
    if (element === document.body) return true;
    
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (style.opacity === '0') return false;
    
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    
    return true;
  }
  
  function getAccessibleName(element) {
    // Priority order for accessible name
    if (element.getAttribute('aria-label')) {
      return element.getAttribute('aria-label');
    }
    
    if (element.getAttribute('aria-labelledby')) {
      const labelId = element.getAttribute('aria-labelledby');
      const label = document.getElementById(labelId);
      if (label) return label.textContent.trim();
    }
    
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT') {
      const label = element.labels?.[0];
      if (label) return label.textContent.trim();
      if (element.placeholder) return element.placeholder;
    }
    
    if (element.getAttribute('alt')) {
      return element.getAttribute('alt');
    }
    
    if (element.getAttribute('title')) {
      return element.getAttribute('title');
    }
    
    // For buttons and links, use text content
    if (['BUTTON', 'A'].includes(element.tagName)) {
      const text = element.textContent.trim();
      if (text && text.length < 100) return text;
    }
    
    // Default to text content but limit length
    return element.textContent?.trim().substring(0, 60) || '';
  }
  
  function getRole(element) {
    // Use explicit role if available
    if (element.getAttribute('role')) {
      return element.getAttribute('role');
    }
    
    // Map HTML elements to implicit roles
    const tagName = element.tagName.toLowerCase();
    const roleMap = {
      'a': element.href ? 'link' : 'generic',
      'button': 'button',
      'input': element.type === 'submit' || element.type === 'button' ? 'button' : 'textbox',
      'textarea': 'textbox',
      'select': 'combobox',
      'option': 'option',
      'img': 'img',
      'h1': 'heading',
      'h2': 'heading',
      'h3': 'heading',
      'h4': 'heading',
      'h5': 'heading',
      'h6': 'heading',
      'nav': 'navigation',
      'main': 'main',
      'header': 'banner',
      'footer': 'contentinfo',
      'aside': 'complementary',
      'section': 'region',
      'article': 'article',
      'form': 'form',
      'table': 'table',
      'ul': 'list',
      'ol': 'list',
      'li': 'listitem'
    };
    
    return roleMap[tagName] || tagName;
  }
  
  // Check if element should be included based on mode
  function shouldInclude(element, mode) {
    if (mode === 'minimal') {
      // Interactive elements
      const interactiveTags = ['a', 'button', 'input', 'select', 'textarea', 'label'];
      const interactiveRoles = ['button', 'link', 'checkbox', 'radio', 'textbox', 'combobox', 'menuitem', 'tab'];
      
      const tagName = element.tagName.toLowerCase();
      const role = element.getAttribute('role') || getRole(element);
      
      // Include if interactive
      if (interactiveTags.includes(tagName) || interactiveRoles.includes(role)) {
        return true;
      }
      
      // Include headings and landmarks
      if (['h1', 'h2', 'h3', 'nav', 'main', 'header', 'footer', 'aside'].includes(tagName)) {
        return true;
      }
      
      // Include if has click handler
      if (element.onclick || element.hasAttribute('onclick') || element.style.cursor === 'pointer') {
        return true;
      }
      
      // Include if contenteditable
      if (element.contentEditable === 'true') {
        return true;
      }
      
      // Include if it's an ancestor of an interactive element
      const hasInteractiveDescendant = element.querySelector(interactiveTags.join(','));
      if (hasInteractiveDescendant) {
        return true;
      }
      
      return false;
    }
    
    // Full mode - include everything visible
    return true;
  }
  
  // Check if element is in viewport (with buffer)
  function isInViewport(element) {
    if (options.viewportOnly) {
      const rect = element.getBoundingClientRect();
      const buffer = window.innerHeight; // Include one viewport height as buffer
      return (
        rect.bottom >= -buffer &&
        rect.top <= window.innerHeight + buffer &&
        rect.right >= 0 &&
        rect.left <= window.innerWidth
      );
    }
    return true;
  }
  
  function traverse(element, depth = 0, isAncestorOfInteractive = false) {
    // Skip invisible elements
    if (!isVisible(element)) {
      return '';
    }
    
    // Skip if not in viewport (when viewportOnly is enabled)
    if (!isInViewport(element)) {
      return '';
    }
    
    const mode = options.level || 'full';
    
    // For minimal mode, check if we should include this element
    if (mode === 'minimal' && !isAncestorOfInteractive && !shouldInclude(element, mode)) {
      // Still traverse children in case they're interactive
      const children = Array.from(element.children);
      let childResults = [];
      for (const child of children) {
        const childResult = traverse(child, depth, false);
        if (childResult) {
          childResults.push(childResult);
        }
      }
      return childResults.join('\n');
    }
    
    const role = getRole(element);
    const name = getAccessibleName(element);
    const elementId = window.__elementTracker.getElementId(element);
    
    // Format similar to Playwright: role "name" [ref=123]
    let result = '  '.repeat(depth) + `${role}`;
    if (name) {
      result += ` "${name}"`;
    }
    result += ` [ref=${elementId}]`;
    
    // Add state information for interactive elements
    const states = [];
    if (element.disabled) states.push('disabled');
    if (element.checked) states.push('checked');
    if (element.selected) states.push('selected');
    if (element.required) states.push('required');
    if (element.readOnly) states.push('readonly');
    if (states.length > 0) {
      result += ` [${states.join(', ')}]`;
    }
    
    // Add additional context for specific elements
    if (element.tagName === 'INPUT') {
      result += ` {type: ${element.type}`;
      if (element.value && element.type !== 'password') {
        result += `, value: "${element.value.substring(0, 50)}"`;
      }
      result += `}`;
    } else if (element.tagName === 'A' && element.href) {
      result += ` {href: "${element.href}"}`;
    } else if (element.tagName === 'IMG' && element.src) {
      result += ` {src: "${element.src}"}`;
    }
    
    // Skip traversing children for certain elements
    const skipChildren = ['input', 'textarea', 'select', 'img', 'br', 'hr'];
    if (!skipChildren.includes(element.tagName.toLowerCase())) {
      const children = Array.from(element.children);
      // Check if this element or any ancestor is interactive for minimal mode
      const isInteractive = mode === 'minimal' && shouldInclude(element, mode);
      for (const child of children) {
        const childResult = traverse(child, depth + 1, isAncestorOfInteractive || isInteractive);
        if (childResult) {
          result += '\n' + childResult;
        }
      }
    }
    
    return result;
  }
  
  // Add page context at the top
  const pageInfo = `Page: ${document.title || 'Untitled'}\nURL: ${window.location.href}\n`;
  
  // Add mode info
  const mode = options.level || 'full';
  const modeInfo = mode === 'minimal' ? '[Minimal snapshot - showing interactive elements only]\n' : '';
  const viewportInfo = options.viewportOnly ? '[Viewport filtering enabled]\n' : '';
  
  return pageInfo + modeInfo + viewportInfo + '\n' + traverse(document.body);
}

function queryElements(selector, all) {
  const elements = all ? 
    document.querySelectorAll(selector) : 
    [document.querySelector(selector)].filter(Boolean);
    
  return Array.from(elements).map((el, index) => ({
    ref: `${selector}[${index}]`,
    element: el.tagName.toLowerCase() + (el.textContent ? `: ${el.textContent.substring(0, 50)}` : '')
  }));
}

function clickElement(ref) {
  // Validate element exists and is clickable
  const validation = window.__elementValidator.validateElement(ref);
  if (!validation.valid) {
    throw new Error(`Click validation failed: ${validation.error}`);
  }
  
  const element = validation.element;
  
  // Check if element is interactable
  if (!window.__elementValidator.canInteract(element)) {
    throw new Error(`Element ${ref} is not interactable`);
  }
  
  // Scroll element into view if needed
  if (!window.__elementValidator.isVisible(element)) {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Wait a bit for scroll to complete
    return new Promise(resolve => {
      setTimeout(() => {
        element.click();
        resolve(true);
      }, 300);
    });
  }
  
  element.click();
  return true;
}

function hoverElement(ref) {
  // Validate element exists
  const validation = window.__elementValidator.validateElement(ref);
  if (!validation.valid) {
    throw new Error(`Hover validation failed: ${validation.error}`);
  }
  
  const element = validation.element;
  
  // Scroll element into view if needed
  if (!window.__elementValidator.isVisible(element)) {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  
  const event = new MouseEvent('mouseover', {
    view: window,
    bubbles: true,
    cancelable: true
  });
  element.dispatchEvent(event);
  return true;
}

function typeInElement(ref, text, submit) {
  // Validate element exists and is an input
  const validation = window.__elementValidator.validateElement(ref, {
    tagName: ['INPUT', 'TEXTAREA']
  });
  if (!validation.valid) {
    // Check if it's a contenteditable element
    const generalValidation = window.__elementValidator.validateElement(ref);
    if (generalValidation.valid && generalValidation.element.contentEditable === 'true') {
      const element = generalValidation.element;
      element.focus();
      element.textContent = text;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    throw new Error(`Type validation failed: ${validation.error}`);
  }
  
  const element = validation.element;
  
  // Check if input is not disabled or readonly
  if (element.disabled) {
    throw new Error(`Input element ${ref} is disabled`);
  }
  if (element.readOnly) {
    throw new Error(`Input element ${ref} is readonly`);
  }
  
  // Scroll into view and focus
  if (!window.__elementValidator.isVisible(element)) {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  
  element.focus();
  element.value = text;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  
  if (submit) {
    const form = element.closest('form');
    if (form) {
      form.submit();
    } else {
      element.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter' }));
    }
  }
  return true;
}

function selectOptions(ref, values) {
  // Validate element exists and is a select
  const validation = window.__elementValidator.validateElement(ref, {
    tagName: 'SELECT'
  });
  if (!validation.valid) {
    throw new Error(`Select validation failed: ${validation.error}`);
  }
  
  const element = validation.element;
  
  // Check if select is not disabled
  if (element.disabled) {
    throw new Error(`Select element ${ref} is disabled`);
  }
  
  // Scroll into view if needed
  if (!window.__elementValidator.isVisible(element)) {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  
  // Validate values exist as options
  const validValues = [];
  const invalidValues = [];
  
  for (const value of values) {
    const optionExists = Array.from(element.options).some(opt => opt.value === value);
    if (optionExists) {
      validValues.push(value);
    } else {
      invalidValues.push(value);
    }
  }
  
  if (invalidValues.length > 0) {
    console.warn(`Select options not found: ${invalidValues.join(', ')}`);
  }
  
  if (validValues.length === 0) {
    throw new Error(`None of the provided values exist as options in the select element`);
  }
  
  // Select the valid options
  for (const option of element.options) {
    option.selected = validValues.includes(option.value);
  }
  
  element.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function pressKey(key) {
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key }));
  document.activeElement.dispatchEvent(new KeyboardEvent('keypress', { key }));
  document.activeElement.dispatchEvent(new KeyboardEvent('keyup', { key }));
}

function getConsoleLogs() {
  // This would need to be injected earlier to capture logs
  return window.__consoleLogs || [];
}

// Initialize connection
connectToMCP();

// Handle extension icon click
chrome.action.onClicked.addListener((tab) => {
  activeTabId = tab.id;
  connectToMCP();
});