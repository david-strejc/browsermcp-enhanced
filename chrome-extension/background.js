// WebSocket connection to MCP server
let ws = null;
let activeTabId = null;
let messageHandlers = new Map();
let reconnectTimer = null;
let keepAliveTimer = null;

// Configuration
let extensionConfig = {
  unsafeMode: false,  // Default to safe mode
  serverUrl: 'ws://localhost:8765'
};

// Load configuration from storage
chrome.storage.local.get(['unsafeMode', 'serverUrl'], (result) => {
  if (result.unsafeMode !== undefined) {
    extensionConfig.unsafeMode = result.unsafeMode;
    console.log('Loaded unsafe mode setting:', extensionConfig.unsafeMode);
  }
  if (result.serverUrl) {
    extensionConfig.serverUrl = result.serverUrl;
  }
});

// Update extension icon based on connection status
function updateIcon(connected) {
  const iconPath = connected ? {
    "16": "icon-16-connected.png",
    "48": "icon-48-connected.png",
    "128": "icon-128-connected.png"
  } : {
    "16": "icon-16-disconnected.png",
    "48": "icon-48-disconnected.png", 
    "128": "icon-128-disconnected.png"
  };
  
  // Update the icon
  chrome.action.setIcon({ path: iconPath });
  
  // Also update badge text for additional clarity
  chrome.action.setBadgeText({ text: connected ? '' : '!' });
  chrome.action.setBadgeBackgroundColor({ color: connected ? '#4CAF50' : '#f44336' });
}

// Connect to MCP server
function connectToMCP() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log('Already connected to MCP server');
    return;
  }
  
  // Close existing connection if in connecting state
  if (ws && ws.readyState === WebSocket.CONNECTING) {
    console.log('Connection in progress, skipping...');
    return;
  }
  
  // Clear any existing reconnect timer
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  
  console.log('Connecting to MCP server at:', extensionConfig.serverUrl || 'ws://localhost:8765');
  ws = new WebSocket(extensionConfig.serverUrl || 'ws://localhost:8765');
  
  ws.onopen = () => {
    console.log('Connected to MCP server');
    updateIcon(true);
    
    // Start keepalive ping every 30 seconds
    if (keepAliveTimer) clearInterval(keepAliveTimer);
    keepAliveTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
      }
    }, 30000);
  };
  
  ws.onmessage = async (event) => {
    let messageId = null;
    try {
      const message = JSON.parse(event.data);
      messageId = message.id;
      console.log('Received message:', message);
      
      // Handle ping messages
      if (message.type === 'ping') {
        ws.send(JSON.stringify({
          id: message.id,
          type: 'pong',
          timestamp: Date.now()
        }));
        return;
      }
      
      if (messageHandlers.has(message.type)) {
        const handler = messageHandlers.get(message.type);
        const response = await handler(message.payload || {});
        
        ws.send(JSON.stringify({
          id: message.id,
          type: message.type,
          payload: response
        }));
      } else {
        console.warn(`Unknown message type: ${message.type}`);
        ws.send(JSON.stringify({
          id: message.id,
          type: message.type,
          error: `Unknown message type: ${message.type}`
        }));
      }
    } catch (error) {
      console.error('Error handling message:', error, error.stack);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          id: messageId,
          error: error.message
        }));
      }
    }
  };
  
  ws.onclose = () => {
    console.log('Disconnected from MCP server, will reconnect in 2 seconds...');
    updateIcon(false);
    
    // Clear keepalive
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
    
    // Reconnect after 2 seconds (more aggressive)
    reconnectTimer = setTimeout(connectToMCP, 2000);
  };
  
  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    updateIcon(false);
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
  
  // Check if scripts are already injected by testing for __elementTracker
  const [checkResult] = await chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    func: () => typeof window.__elementTracker !== 'undefined'
  });
  
  // Only inject if not already present
  if (!checkResult.result) {
    await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      files: ['element-tracker.js', 'element-validator.js']
    });
  }
  
  // Check for scaffold mode
  if (options.mode === 'scaffold') {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      func: captureScaffoldSnapshot
    });
    return { snapshot: result.result };
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
  // Check if scripts are already injected by testing for __elementTracker
  const [checkResult] = await chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    func: () => typeof window.__elementTracker !== 'undefined'
  });
  
  // Only inject if not already present
  if (!checkResult.result) {
    await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      files: ['element-tracker.js', 'element-validator.js']
    });
  }
  
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
  // Check if scripts are already injected by testing for __elementTracker
  const [checkResult] = await chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    func: () => typeof window.__elementTracker !== 'undefined'
  });
  
  // Only inject if not already present
  if (!checkResult.result) {
    await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      files: ['element-tracker.js', 'element-validator.js']
    });
  }
  
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

// Add handler for browser_press_key (MCP server compatibility)
messageHandlers.set('browser_press_key', async ({ key }) => {
  // Handle special browser-level keys
  if (key === 'F12' || key === 'f12') {
    // Use Chrome Debugger API to simulate DevTools opening
    // Note: We can't actually open DevTools, but we can attach debugger which shows a bar
    if (!debuggerHandler.attached) {
      try {
        await chrome.debugger.attach({ tabId: activeTabId }, "1.3");
        debuggerHandler.attached = true;
        debuggerHandler.tabId = activeTabId;
        // Enable necessary domains for full debugging
        await chrome.debugger.sendCommand({ tabId: activeTabId }, "Runtime.enable", {});
        await chrome.debugger.sendCommand({ tabId: activeTabId }, "Console.enable", {});
        await chrome.debugger.sendCommand({ tabId: activeTabId }, "Log.enable", {});
        return { message: "Debugger attached (DevTools simulation). Chrome shows debugging bar." };
      } catch (error) {
        return { error: `Could not attach debugger: ${error.message}` };
      }
    } else {
      // If already attached, detach
      await chrome.debugger.detach({ tabId: debuggerHandler.tabId });
      debuggerHandler.attached = false;
      debuggerHandler.tabId = null;
      return { message: "Debugger detached" };
    }
  }
  
  // Try to use debugger Input API for more powerful key simulation if debugger is attached
  if (debuggerHandler.attached && debuggerHandler.tabId === activeTabId) {
    try {
      // Parse key for debugger API
      let keyCode = key;
      const modifiers = [];
      
      if (key.includes('+')) {
        const parts = key.split('+');
        keyCode = parts[parts.length - 1];
        if (parts.includes('Ctrl') || parts.includes('Control')) modifiers.push(1); // Ctrl
        if (parts.includes('Shift')) modifiers.push(2); // Shift
        if (parts.includes('Alt')) modifiers.push(4); // Alt
        if (parts.includes('Meta') || parts.includes('Cmd')) modifiers.push(8); // Meta
      }
      
      // Use Input.dispatchKeyEvent for more powerful key simulation
      await chrome.debugger.sendCommand({ tabId: activeTabId }, "Input.dispatchKeyEvent", {
        type: "keyDown",
        key: keyCode,
        code: keyCode,
        modifiers: modifiers.reduce((a, b) => a | b, 0)
      });
      
      await chrome.debugger.sendCommand({ tabId: activeTabId }, "Input.dispatchKeyEvent", {
        type: "keyUp",
        key: keyCode,
        code: keyCode,
        modifiers: modifiers.reduce((a, b) => a | b, 0)
      });
      
      return { message: `Key pressed via debugger: ${key}` };
    } catch (error) {
      console.log('Debugger key dispatch failed, falling back to script injection:', error);
    }
  }
  
  // For regular keys or if debugger fails, use the standard approach
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

// Add handler for browser_screenshot (MCP server compatibility)
messageHandlers.set('browser_screenshot', async () => {
  try {
    // Ensure we have an active tab
    if (!activeTabId) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        activeTabId = tab.id;
      }
    }
    
    console.log('Taking screenshot of tab:', activeTabId);
    const dataUrl = await chrome.tabs.captureVisibleTab();
    console.log('Data URL length:', dataUrl ? dataUrl.length : 0);
    
    const base64 = dataUrl.split(',')[1];
    console.log('Base64 length:', base64 ? base64.length : 0);
    
    if (!base64) {
      console.error('Screenshot captured but no base64 data found');
      console.error('Data URL was:', dataUrl ? dataUrl.substring(0, 100) : 'undefined');
      return { error: 'Screenshot captured but no data found' };
    }
    
    // Log first 100 chars to verify data exists
    console.log('Screenshot base64 preview:', base64.substring(0, 100));
    
    return { data: base64 };
  } catch (error) {
    console.error('Screenshot failed:', error);
    return { error: `Screenshot failed: ${error.message}` };
  }
});

messageHandlers.set('page.navigate', async ({ url }) => {
  await chrome.tabs.update(activeTabId, { url });
  // Wait for navigation to complete
  await waitForTabComplete(activeTabId);
  return {};
});

// Add handlers for browser_* message types (MCP server compatibility)
messageHandlers.set('browser_navigate', async ({ url }) => {
  // Get active tab if not set
  if (!activeTabId) {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab) {
      activeTabId = activeTab.id;
    } else {
      // Create a new tab if no active tab
      const newTab = await chrome.tabs.create({ url });
      activeTabId = newTab.id;
      await waitForTabComplete(activeTabId);
      return {};
    }
  }
  
  await chrome.tabs.update(activeTabId, { url });
  // Wait for navigation to complete
  await waitForTabComplete(activeTabId);
  return {};
});

// Helper function to wait for tab to finish loading
async function waitForTabComplete(tabId, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error(`Tab load timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeoutId);
        resolve();
      }
    };
    
    // Check if already complete
    chrome.tabs.get(tabId, (tab) => {
      if (tab.status === 'complete') {
        clearTimeout(timeoutId);
        resolve();
      } else {
        chrome.tabs.onUpdated.addListener(listener);
      }
    });
  });
}

messageHandlers.set('page.goBack', async () => {
  if (!activeTabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = tab?.id;
  }
  
  if (!activeTabId) {
    throw new Error('No active tab');
  }
  
  try {
    await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      func: () => window.history.back()
    });
    
    // Wait for navigation to complete
    await waitForTabComplete(activeTabId);
  } catch (error) {
    // Fallback to debugger API for CSP-restricted sites
    if (error.message.includes('Cannot access')) {
      try {
        await chrome.debugger.attach({ tabId: activeTabId }, "1.3");
        await chrome.debugger.sendCommand({ tabId: activeTabId }, "Page.navigateBack", {});
        await waitForTabComplete(activeTabId);
        await chrome.debugger.detach({ tabId: activeTabId });
      } catch (debuggerError) {
        throw new Error(`Navigation failed: ${error.message}. Debugger fallback also failed: ${debuggerError.message}`);
      }
    } else {
      throw error;
    }
  }
  
  return {};
});

messageHandlers.set('browser_go_back', async () => {
  // Delegate to the same handler
  return await messageHandlers.get('page.goBack')();
});

messageHandlers.set('page.goForward', async () => {
  if (!activeTabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = tab?.id;
  }
  
  if (!activeTabId) {
    throw new Error('No active tab');
  }
  
  try {
    await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      func: () => window.history.forward()
    });
    
    // Wait for navigation to complete
    await waitForTabComplete(activeTabId);
  } catch (error) {
    // Fallback to debugger API for CSP-restricted sites
    if (error.message.includes('Cannot access')) {
      try {
        await chrome.debugger.attach({ tabId: activeTabId }, "1.3");
        await chrome.debugger.sendCommand({ tabId: activeTabId }, "Page.navigateForward", {});
        await waitForTabComplete(activeTabId);
        await chrome.debugger.detach({ tabId: activeTabId });
      } catch (debuggerError) {
        throw new Error(`Navigation failed: ${error.message}. Debugger fallback also failed: ${debuggerError.message}`);
      }
    } else {
      throw error;
    }
  }
  
  return {};
});

messageHandlers.set('browser_go_forward', async () => {
  // Delegate to the same handler
  return await messageHandlers.get('page.goForward')();
});

messageHandlers.set('page.wait', async ({ time }) => {
  await new Promise(resolve => setTimeout(resolve, time * 1000));
  return {};
});

messageHandlers.set('browser_wait', async ({ time }) => {
  await new Promise(resolve => setTimeout(resolve, time * 1000));
  return {};
});

// Debugger handler instance - track attached tabs to prevent concurrency issues
const debuggerHandler = {
  attached: false,
  tabId: null,
  attachedTabs: new Set(), // Track which tabs have debugger attached
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
  // Check if already attached to this tab
  if (debuggerHandler.attachedTabs.has(activeTabId)) {
    return { success: true, message: 'Debugger already attached to this tab' };
  }
  
  // Clean up any previous attachment
  if (debuggerHandler.attached && debuggerHandler.tabId !== activeTabId) {
    try {
      await chrome.debugger.detach({ tabId: debuggerHandler.tabId });
      debuggerHandler.attachedTabs.delete(debuggerHandler.tabId);
    } catch (e) {
      console.warn('Failed to detach previous debugger:', e);
    }
  }

  debuggerHandler.tabId = activeTabId;
  
  return new Promise((resolve) => {
    chrome.debugger.attach({ tabId: activeTabId }, "1.3", async () => {
      if (chrome.runtime.lastError) {
        resolve({ error: chrome.runtime.lastError.message });
        return;
      }
      
      debuggerHandler.attached = true;
      debuggerHandler.attachedTabs.add(activeTabId);
      
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
        debuggerHandler.attachedTabs.delete(activeTabId);
        resolve({ error: error.message });
      }
    });
  });
});

messageHandlers.set('debugger.detach', async () => {
  if (!debuggerHandler.attached || !debuggerHandler.tabId) {
    return { success: false, error: "Debugger not attached" };
  }

  const tabToDetach = debuggerHandler.tabId;
  
  return new Promise((resolve) => {
    chrome.debugger.detach({ tabId: tabToDetach }, () => {
      debuggerHandler.attached = false;
      debuggerHandler.attachedTabs.delete(tabToDetach);
      debuggerHandler.tabId = null;
      
      // Keep only last 100 entries to prevent memory leaks
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

// Token estimation helper
function estimateTokens(text) {
  // Rough estimate: ~4 chars per token
  return Math.ceil((text || '').length / 4);
}

// Capture ultra-minimal scaffold view
function captureScaffoldSnapshot() {
  const landmarks = [];
  const MAX_REGIONS = 15; // Limit number of regions
  
  // Find major landmarks only
  const selectors = [
    'header, [role="banner"]',
    'nav, [role="navigation"]', 
    'main, [role="main"]',
    'footer, [role="contentinfo"]'
  ];
  
  selectors.forEach(selector => {
    if (landmarks.length >= MAX_REGIONS) return;
    
    const elements = document.querySelectorAll(selector);
    for (let i = 0; i < Math.min(elements.length, 2); i++) { // Max 2 of each type
      const element = elements[i];
      if (landmarks.length >= MAX_REGIONS) break;
      if (element.dataset.scaffoldSeen) continue;
      
      element.dataset.scaffoldSeen = 'true';
      
      // Count interactive elements
      const interactive = element.querySelectorAll('a, button, input, select, textarea');
      
      // Get very brief preview (first 3 items only)
      const preview = Array.from(interactive)
        .slice(0, 3)
        .map(el => {
          const text = el.textContent || el.value || el.placeholder || '';
          return text.trim().substring(0, 15);
        })
        .filter(Boolean)
        .join(', ');
      
      // Check visibility
      const rect = element.getBoundingClientRect();
      const visible = rect.top < window.innerHeight && rect.bottom > 0;
      
      landmarks.push({
        ref: window.__elementTracker.getElementId(element),
        type: element.tagName.toLowerCase(),
        role: element.getAttribute('role') || element.tagName.toLowerCase(),
        interactiveCount: interactive.length,
        preview: preview ? preview.substring(0, 50) : '',
        visible: visible
      });
    }
  });
  
  // Clean up markers
  document.querySelectorAll('[data-scaffold-seen]').forEach(el => {
    delete el.dataset.scaffoldSeen;
  });
  
  // Build ULTRA-COMPACT output
  let output = `Page: ${document.title?.substring(0, 60) || 'Untitled'}\n`;
  output += `URL: ${window.location.href}\n`;
  output += `[Scaffold: ${landmarks.length} regions]\n\n`;
  
  landmarks.forEach(landmark => {
    output += `${landmark.type} [ref=${landmark.ref}]`;
    if (landmark.role !== landmark.type) {
      output += ` role="${landmark.role}"`;
    }
    if (!landmark.visible) {
      output += ` [hidden]`;
    }
    if (landmark.interactiveCount > 0) {
      output += ` (${landmark.interactiveCount} items)`;
    }
    if (landmark.preview) {
      output += ` "${landmark.preview}"`;
    }
    output += `\n`;
  });
  
  // Add main interactive elements summary
  const allInputs = document.querySelectorAll('input[type="search"], input[type="text"], button[type="submit"]');
  if (allInputs.length > 0) {
    output += `\n[Key Elements]\n`;
    Array.from(allInputs).slice(0, 5).forEach(el => {
      const ref = window.__elementTracker.getElementId(el);
      const label = el.placeholder || el.value || el.textContent || el.type;
      output += `${el.tagName.toLowerCase()} [ref=${ref}] "${label?.substring(0, 30)}"\n`;
    });
  }
  
  return output;
}

// Expand specific region with token budget
function expandRegion(refId, options = {}) {
  const maxTokens = options.maxTokens || 5000;
  const depth = options.depth || 2;
  const filter = options.filter || 'all'; // all, interactive, text
  
  const element = window.__elementTracker.getElementById(refId);
  if (!element) {
    return `Error: Element with ref ${refId} not found`;
  }
  
  let output = `Expanding region [ref=${refId}]:\n\n`;
  let tokenCount = estimateTokens(output);
  const tokenBudget = maxTokens;
  
  function traverse(el, currentDepth, indent = '') {
    if (currentDepth > depth || tokenCount > tokenBudget) {
      return;
    }
    
    // Skip if not matching filter
    if (filter === 'interactive') {
      const isInteractive = el.matches('a, button, input, select, textarea, [role="button"], [onclick]');
      if (!isInteractive && el.querySelectorAll('a, button, input, select, textarea').length === 0) {
        return;
      }
    }
    
    const role = el.getAttribute('role') || el.tagName.toLowerCase();
    const text = el.textContent?.trim().substring(0, 100) || '';
    const elementRef = window.__elementTracker.getElementId(el);
    
    let line = `${indent}${role} [ref=${elementRef}]`;
    
    // Add specific attributes for interactive elements
    if (el.tagName === 'A') {
      line += ` {href: "${el.href}"}`;
    } else if (el.tagName === 'INPUT') {
      line += ` {type: ${el.type}, value: "${el.value?.substring(0, 50) || ''}"}`;
    } else if (el.tagName === 'BUTTON') {
      line += ` "${text}"`;
    }
    
    line += '\n';
    
    // Check if adding this would exceed budget
    const lineTokens = estimateTokens(line);
    if (tokenCount + lineTokens > tokenBudget) {
      output += indent + '[... truncated due to token limit ...]\n';
      tokenCount = tokenBudget + 1;
      return;
    }
    
    output += line;
    tokenCount += lineTokens;
    
    // Traverse children
    if (currentDepth < depth) {
      const children = Array.from(el.children);
      for (const child of children) {
        traverse(child, currentDepth + 1, indent + '  ');
        if (tokenCount > tokenBudget) break;
      }
    }
  }
  
  traverse(element, 0);
  
  output += `\n[Tokens used: ~${tokenCount}/${maxTokens}]\n`;
  return output;
}

// Query elements by various criteria
function queryElements(options = {}) {
  const { selector = '*', containing = '', nearRef = null, limit = 20 } = options;
  
  try {
    let elements = Array.from(document.querySelectorAll(selector));
    
    // Filter by text content
    if (containing) {
      const searchText = containing.toLowerCase();
      elements = elements.filter(el => {
        const text = (el.textContent || el.value || el.placeholder || '').toLowerCase();
        return text.includes(searchText);
      });
    }
    
    // Sort by proximity to reference element
    if (nearRef) {
      const refElement = window.__elementTracker.getElementById(nearRef);
      if (refElement) {
        const refRect = refElement.getBoundingClientRect();
        const refX = refRect.left + refRect.width / 2;
        const refY = refRect.top + refRect.height / 2;
        
        elements.sort((a, b) => {
          const aRect = a.getBoundingClientRect();
          const aX = aRect.left + aRect.width / 2;
          const aY = aRect.top + aRect.height / 2;
          const aDist = Math.sqrt(Math.pow(aX - refX, 2) + Math.pow(aY - refY, 2));
          
          const bRect = b.getBoundingClientRect();
          const bX = bRect.left + bRect.width / 2;
          const bY = bRect.top + bRect.height / 2;
          const bDist = Math.sqrt(Math.pow(bX - refX, 2) + Math.pow(bY - refY, 2));
          
          return aDist - bDist;
        });
      }
    }
    
    // Limit results
    elements = elements.slice(0, limit);
    
    // Format output
    let output = `Found ${elements.length} elements:\n\n`;
  
    elements.forEach(el => {
      const ref = window.__elementTracker.getElementId(el);
      const role = el.tagName.toLowerCase();
      const text = (el.textContent || el.value || '').trim().substring(0, 100);
      
      output += `${role} [ref=${ref}]`;
      if (text) {
        output += ` "${text}"`;
      }
      if (el.href) {
        output += ` {href: "${el.href}"}`;
      }
      output += '\n';
    });
    
    return output || 'No elements found';
  } catch (error) {
    console.error('Error in queryElements:', error);
    return `Error querying elements: ${error.message}`;
  }
}

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
  // Enhanced key press with modifier support
  const keyEvent = { key, bubbles: true, cancelable: true };
  
  // Parse modifiers from key string (e.g., "Ctrl+Shift+I")
  const parts = key.split('+');
  if (parts.length > 1) {
    const actualKey = parts[parts.length - 1];
    keyEvent.key = actualKey;
    keyEvent.ctrlKey = parts.includes('Ctrl') || parts.includes('Control');
    keyEvent.shiftKey = parts.includes('Shift');
    keyEvent.altKey = parts.includes('Alt');
    keyEvent.metaKey = parts.includes('Meta') || parts.includes('Cmd');
  }
  
  // Dispatch to both document and activeElement for maximum compatibility
  const targets = [document, document.activeElement].filter(Boolean);
  targets.forEach(target => {
    target.dispatchEvent(new KeyboardEvent('keydown', keyEvent));
    target.dispatchEvent(new KeyboardEvent('keypress', keyEvent));
    target.dispatchEvent(new KeyboardEvent('keyup', keyEvent));
  });
}

function getConsoleLogs() {
  // This would need to be injected earlier to capture logs
  return window.__consoleLogs || [];
}

// Initialize with disconnected icon
updateIcon(false);

// Initialize connection
connectToMCP();

// Chrome service worker keepalive
// Service workers in Chrome get killed after 30 seconds of inactivity
// This keeps it alive by setting an alarm
chrome.alarms.create('keepAlive', { periodInMinutes: 0.25 }); // Every 15 seconds

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    // Check WebSocket connection
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.log('WebSocket disconnected, attempting reconnect...');
      connectToMCP();
    }
  }
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'getStatus') {
    sendResponse({ connected: ws && ws.readyState === WebSocket.OPEN });
    return true;
  } else if (request.type === 'connect') {
    connectToMCP();
    // Wait a bit for connection to establish
    setTimeout(() => {
      sendResponse({ connected: ws && ws.readyState === WebSocket.OPEN });
    }, 500);
    return true; // Keep the message channel open for async response
  }
});

// Code execution handler
messageHandlers.set('js.execute', async ({ code, timeout = 5000, unsafe = null }) => {
  console.log(`[js.execute] Starting execution with timeout=${timeout}ms`);
  
  if (!activeTabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = tab?.id;
  }
  
  if (!activeTabId) {
    throw new Error('No active tab');
  }
  
  // Check if code executor is injected
  const [checkResult] = await chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    func: () => typeof window.__codeExecutorReady !== 'undefined'
  });
  
  if (!checkResult.result) {
    // Inject code executor (use safe version for CSP compliance)
    await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      files: ['code-executor-safe.js']
    });
    
    // Wait a bit for initialization
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // Generate execution ID
  const executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  return new Promise((resolve, reject) => {
    // Set timeout for execution - add small buffer for message round-trip
    const timeoutId = setTimeout(() => {
      // Try to abort execution
      chrome.tabs.sendMessage(activeTabId, {
        type: 'execute.abort',
        executionId: executionId
      }, () => {
        // Ignore abort response
      });
      reject(new Error(`Code execution timeout after ${timeout}ms`));
    }, timeout + 100); // Small buffer for message handling
    
    // Determine unsafe mode: explicit parameter > config > default (false)
    const useUnsafeMode = unsafe !== null ? unsafe : extensionConfig.unsafeMode;
    
    if (useUnsafeMode) {
      console.warn('⚠️ Executing code in UNSAFE mode');
    }
    
    // Execute code
    chrome.tabs.sendMessage(activeTabId, {
      type: 'execute.code',
      code: code,
      timeout: timeout,
      executionId: executionId,
      unsafe: useUnsafeMode
    }, response => {
      clearTimeout(timeoutId);
      
      if (chrome.runtime.lastError) {
        // Check if it's because script isn't injected
        console.error(`[js.execute] Chrome runtime error:`, chrome.runtime.lastError);
        if (chrome.runtime.lastError.message.includes('receiving end does not exist')) {
          reject(new Error('Code executor not available. Page may not support script injection or content security policy may be blocking execution.'));
        } else {
          reject(new Error(`Communication error: ${chrome.runtime.lastError.message}`));
        }
      } else if (response && response.success) {
        console.log(`[js.execute] Success response received`);
        resolve({ result: response.result });
      } else if (response && response.error) {
        console.log(`[js.execute] Error response: ${response.error}`);
        reject(new Error(response.error));
      } else {
        console.error(`[js.execute] Invalid response:`, response);
        reject(new Error('Code execution failed: No valid response received'));
      }
    });
  });
});

// New message handlers for scaffold features
messageHandlers.set('dom.expand', async ({ ref, maxTokens = 5000, depth = 2, filter = 'all' }) => {
  if (!activeTabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = tab?.id;
  }
  
  if (!activeTabId) {
    throw new Error('No active tab');
  }
  
  // Ensure scripts are injected
  const [checkResult] = await chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    func: () => typeof window.__elementTracker !== 'undefined'
  });
  
  if (!checkResult.result) {
    await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      files: ['element-tracker.js', 'element-validator.js']
    });
  }
  
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    func: expandRegion,
    args: [ref, { maxTokens, depth, filter }]
  });
  
  return { expansion: result.result };
});

messageHandlers.set('dom.query', async ({ selector = '*', containing = '', nearRef = null, limit = 20 }) => {
  if (!activeTabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = tab?.id;
  }
  
  if (!activeTabId) {
    throw new Error('No active tab');
  }
  
  // Ensure scripts are injected
  const [checkResult] = await chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    func: () => typeof window.__elementTracker !== 'undefined'
  });
  
  if (!checkResult.result) {
    await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      files: ['element-tracker.js', 'element-validator.js']
    });
  }
  
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    func: queryElements,
    args: [{ selector, containing, nearRef, limit }]
  });
  
  return { results: result.result };
});

// Handle settings updates from options page
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'settings.updated') {
    extensionConfig = { ...extensionConfig, ...message.settings };
    console.log('Settings updated:', extensionConfig);
    
    // Store in local storage
    chrome.storage.local.set(message.settings);
    
    // Reconnect if server URL changed
    if (message.settings.serverUrl && message.settings.serverUrl !== extensionConfig.serverUrl) {
      if (ws) {
        ws.close();
      }
      connectToMCP();
    }
  }
});

// Handle extension icon click
chrome.action.onClicked.addListener((tab) => {
  activeTabId = tab.id;
  connectToMCP();
});

// Initialize on install/update
chrome.runtime.onInstalled.addListener((details) => {
  console.log('Extension installed/updated:', details.reason);
  
  // Set default icon
  updateIcon(false);
  
  // Initialize connection
  connectToMCP();
  
  // Set up periodic health check alarm (every minute)
  chrome.alarms.create('healthCheck', { periodInMinutes: 1 });
  
  // Get active tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length > 0) {
      activeTabId = tabs[0].id;
    }
  });
});

// Initialize on browser startup
chrome.runtime.onStartup.addListener(() => {
  console.log('Browser started - initializing extension');
  connectToMCP();
  
  // Get active tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length > 0) {
      activeTabId = tabs[0].id;
    }
  });
});

// Reconnect on tab activation
chrome.tabs.onActivated.addListener((activeInfo) => {
  activeTabId = activeInfo.tabId;
  
  // Ensure we're connected
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    connectToMCP();
  }
});

// Keep connection alive on idle (if API available)
if (chrome.idle && chrome.idle.onStateChanged) {
  chrome.idle.onStateChanged.addListener((state) => {
    if (state === 'active') {
      // User is active, ensure connection
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        connectToMCP();
      }
    }
  });
}

// Periodic health check
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'healthCheck') {
    // Check WebSocket connection health
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.log('Health check: Connection lost, reconnecting...');
      connectToMCP();
    } else {
      console.log('Health check: Connection healthy');
    }
  }
});

// Initialize immediately when script loads
connectToMCP();

// Get initial active tab
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs.length > 0) {
    activeTabId = tabs[0].id;
  }
});