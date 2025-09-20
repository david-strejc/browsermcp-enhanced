// Firefox WebExtension API compatibility layer
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

// WebSocket connection to MCP server
let ws = null;
let activeTabId = null;
let messageHandlers = new Map();
let reconnectTimer = null;
let keepAliveTimer = null;
let lastPopupDetection = null;

// Configuration
let extensionConfig = {
  unsafeMode: false,
  serverUrl: 'ws://localhost:8765'
};

// Load configuration from storage
browserAPI.storage.local.get(['unsafeMode', 'serverUrl']).then((result) => {
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
  browserAPI.browserAction.setIcon({ path: iconPath });

  // Update badge text for additional clarity
  browserAPI.browserAction.setBadgeText({ text: connected ? '' : '!' });
  browserAPI.browserAction.setBadgeBackgroundColor({ color: connected ? '#4CAF50' : '#f44336' });
}

// Connect to MCP server
function connectToMCP() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log('Already connected to MCP server');
    return;
  }

  if (ws && ws.readyState === WebSocket.CONNECTING) {
    console.log('Connection in progress, skipping...');
    return;
  }

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  console.log('Connecting to MCP server at:', extensionConfig.serverUrl);
  ws = new WebSocket(extensionConfig.serverUrl);

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

        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            id: message.id,
            type: message.type,
            payload: response
          }));
        }
      } else {
        console.warn('No handler for message type:', message.type);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            id: message.id,
            type: message.type,
            error: `No handler for message type: ${message.type}`
          }));
        }
      }
    } catch (error) {
      console.error('Error handling message:', error);
      if (ws && ws.readyState === WebSocket.OPEN && messageId) {
        ws.send(JSON.stringify({
          id: messageId,
          error: error.message
        }));
      }
    }
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    updateIcon(false);
  };

  ws.onclose = () => {
    console.log('Disconnected from MCP server');
    updateIcon(false);

    // Clear keepalive timer
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }

    // Schedule reconnection
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      console.log('Attempting to reconnect...');
      connectToMCP();
    }, 2000);
  };
}

// Register message handlers
function registerHandler(type, handler) {
  messageHandlers.set(type, handler);
}

// Navigation handler with popup detection support
async function handleNavigate(payload) {
  try {
    const { url } = payload;

    // Store popup detection before navigation
    if (activeTabId) {
      try {
        const response = await browserAPI.tabs.sendMessage(activeTabId, {
          action: 'detectPopups'
        });
        lastPopupDetection = response;
      } catch (error) {
        console.log('Could not detect popups before navigation:', error);
        lastPopupDetection = null;
      }
    }

    if (activeTabId) {
      await browserAPI.tabs.update(activeTabId, { url });
      return { success: true, tabId: activeTabId };
    } else {
      const tab = await browserAPI.tabs.create({ url });
      activeTabId = tab.id;
      return { success: true, tabId: tab.id };
    }
  } catch (error) {
    console.error('Navigation error:', error);
    return { success: false, error: error.message };
  }
}

// Go back handler with proper API detection
async function handleGoBack() {
  try {
    if (activeTabId) {
      // Check if tabs.goBack exists (Firefox 96+)
      if (typeof browserAPI.tabs.goBack === 'function') {
        await browserAPI.tabs.goBack(activeTabId);
      } else {
        // Fallback for Firefox < 96
        await browserAPI.tabs.executeScript(activeTabId, {
          code: 'window.history.back();'
        });
      }
      return { success: true };
    }
    return { success: false, error: 'No active tab' };
  } catch (error) {
    console.error('Go back error:', error);
    return { success: false, error: error.message };
  }
}

// Go forward handler with proper API detection
async function handleGoForward() {
  try {
    if (activeTabId) {
      // Check if tabs.goForward exists (Firefox 96+)
      if (typeof browserAPI.tabs.goForward === 'function') {
        await browserAPI.tabs.goForward(activeTabId);
      } else {
        // Fallback for Firefox < 96
        await browserAPI.tabs.executeScript(activeTabId, {
          code: 'window.history.forward();'
        });
      }
      return { success: true };
    }
    return { success: false, error: 'No active tab' };
  } catch (error) {
    console.error('Go forward error:', error);
    return { success: false, error: error.message };
  }
}

// Click handler
async function handleClick(payload) {
  try {
    const { ref, element } = payload;

    if (!activeTabId) {
      return { success: false, error: 'No active tab' };
    }

    // Check if element needs special handling (OAuth, popup, etc)
    const checkResult = await browserAPI.tabs.sendMessage(activeTabId, {
      action: 'checkClickType',
      ref
    });

    if (checkResult && checkResult.needsTrustedClick) {
      // Firefox doesn't have Chrome's debugger API, use alternative approach
      // Try context menu click or native event simulation
      return await handleTrustedClickFirefox(activeTabId, ref, element, checkResult);
    }

    // Regular click
    const result = await browserAPI.tabs.sendMessage(activeTabId, {
      action: 'click',
      ref,
      element
    });

    return result;
  } catch (error) {
    console.error('Click error:', error);
    return { success: false, error: error.message };
  }
}

// Firefox-specific trusted click handler
async function handleTrustedClickFirefox(tabId, ref, element, checkResult) {
  try {
    // Strategy 1: Use native messaging or privileged content script
    // Strategy 2: Open in new tab for OAuth flows
    if (checkResult.isOAuth || checkResult.opensNewWindow) {
      const urlResult = await browserAPI.tabs.sendMessage(tabId, {
        action: 'getElementUrl',
        ref
      });

      if (urlResult && urlResult.url) {
        const newTab = await browserAPI.tabs.create({
          url: urlResult.url,
          active: true
        });
        return {
          success: true,
          tabId: newTab.id,
          message: 'Opened in new tab for secure interaction'
        };
      }
    }

    // Strategy 3: Simulate trusted event through content script
    const result = await browserAPI.tabs.sendMessage(tabId, {
      action: 'trustedClick',
      ref,
      element
    });

    return result;
  } catch (error) {
    // Fallback to regular click
    return await browserAPI.tabs.sendMessage(tabId, {
      action: 'click',
      ref,
      element
    });
  }
}

// Type text handler
async function handleType(payload) {
  try {
    const { ref, element, text, submit = false } = payload;

    if (!activeTabId) {
      return { success: false, error: 'No active tab' };
    }

    const result = await browserAPI.tabs.sendMessage(activeTabId, {
      action: 'type',
      ref,
      element,
      text,
      submit
    });

    return result;
  } catch (error) {
    console.error('Type error:', error);
    return { success: false, error: error.message };
  }
}

// Hover handler
async function handleHover(payload) {
  try {
    const { ref, element } = payload;

    if (!activeTabId) {
      return { success: false, error: 'No active tab' };
    }

    const result = await browserAPI.tabs.sendMessage(activeTabId, {
      action: 'hover',
      ref,
      element
    });

    return result;
  } catch (error) {
    console.error('Hover error:', error);
    return { success: false, error: error.message };
  }
}

// Select option handler
async function handleSelectOption(payload) {
  try {
    const { ref, element, values } = payload;

    if (!activeTabId) {
      return { success: false, error: 'No active tab' };
    }

    const result = await browserAPI.tabs.sendMessage(activeTabId, {
      action: 'selectOption',
      ref,
      element,
      values
    });

    return result;
  } catch (error) {
    console.error('Select option error:', error);
    return { success: false, error: error.message };
  }
}

// Press key handler
async function handlePressKey(payload) {
  try {
    const { key } = payload;

    if (!activeTabId) {
      return { success: false, error: 'No active tab' };
    }

    const result = await browserAPI.tabs.sendMessage(activeTabId, {
      action: 'pressKey',
      key
    });

    return result;
  } catch (error) {
    console.error('Press key error:', error);
    return { success: false, error: error.message };
  }
}

// Wait handler
async function handleWait(payload) {
  try {
    const { time } = payload;
    await new Promise(resolve => setTimeout(resolve, time * 1000));
    return { success: true };
  } catch (error) {
    console.error('Wait error:', error);
    return { success: false, error: error.message };
  }
}

// Screenshot handler with Firefox compatibility
async function handleScreenshot() {
  try {
    if (!activeTabId) {
      return { success: false, error: 'No active tab' };
    }

    // Handle both promise and callback styles for older Firefox
    return new Promise((resolve) => {
      const options = { format: 'jpeg', quality: 90 };

      // Try promise-based API first (Firefox 89+)
      if (browserAPI.tabs.captureVisibleTab.length === 2) {
        browserAPI.tabs.captureVisibleTab(null, options).then(
          dataUrl => resolve({ success: true, screenshot: dataUrl }),
          error => resolve({ success: false, error: error.message })
        );
      } else {
        // Fallback to callback for older Firefox
        browserAPI.tabs.captureVisibleTab(null, options, (dataUrl) => {
          if (browserAPI.runtime.lastError) {
            resolve({ success: false, error: browserAPI.runtime.lastError.message });
          } else {
            resolve({ success: true, screenshot: dataUrl });
          }
        });
      }
    });
  } catch (error) {
    console.error('Screenshot error:', error);
    return { success: false, error: error.message };
  }
}

// Get console logs handler
async function handleGetConsoleLogs() {
  try {
    if (!activeTabId) {
      return { success: false, error: 'No active tab' };
    }

    const result = await browserAPI.tabs.sendMessage(activeTabId, {
      action: 'getConsoleLogs'
    });

    return result;
  } catch (error) {
    console.error('Get console logs error:', error);
    return { success: false, error: error.message };
  }
}

// Accessibility snapshot handler
async function handleSnapshot(payload) {
  try {
    const { viewportOnly = true, fullPage = false, mode = 'normal' } = payload;

    if (!activeTabId) {
      return { success: false, error: 'No active tab' };
    }

    // Inject necessary scripts if not already injected
    await injectSnapshotScripts(activeTabId);

    const result = await browserAPI.tabs.sendMessage(activeTabId, {
      action: 'snapshot',
      viewportOnly,
      fullPage,
      mode
    });

    return result;
  } catch (error) {
    console.error('Snapshot error:', error);
    return { success: false, error: error.message };
  }
}

// Inject snapshot scripts
async function injectSnapshotScripts(tabId) {
  try {
    const scripts = [
      'accessibility-utils.js',
      'minimal-enhanced.js',
      'scaffold-enhanced.js'
    ];

    for (const script of scripts) {
      await browserAPI.tabs.executeScript(tabId, {
        file: script,
        allFrames: false
      });
    }
  } catch (error) {
    console.log('Script injection error (may be already injected):', error);
  }
}

// Execute predefined safe operations only (no arbitrary code execution)
async function handleExecuteJS(payload) {
  try {
    const { operation, params = {} } = payload;

    if (!activeTabId) {
      return { success: false, error: 'No active tab' };
    }

    // Only allow predefined safe operations
    const safeOperations = [
      'getText', 'getValue', 'getAttribute', 'exists', 'isVisible',
      'getPageInfo', 'extractTable', 'extractLinks', 'extractImages',
      'scrollTo', 'highlight', 'getComputedStyle'
    ];

    if (!safeOperations.includes(operation)) {
      return {
        success: false,
        error: `Operation '${operation}' not allowed. Only predefined safe operations are permitted.`
      };
    }

    // Execute safe operation through content script
    const result = await browserAPI.tabs.sendMessage(activeTabId, {
      action: 'executeSafeOperation',
      operation,
      params
    });

    return result;
  } catch (error) {
    console.error('Execute safe operation error:', error);
    return { success: false, error: error.message };
  }
}

// Common operation handler
async function handleCommonOperation(payload) {
  try {
    const { operation, options = {} } = payload;

    if (!activeTabId) {
      return { success: false, error: 'No active tab' };
    }

    const result = await browserAPI.tabs.sendMessage(activeTabId, {
      action: 'commonOperation',
      operation,
      options
    });

    return result;
  } catch (error) {
    console.error('Common operation error:', error);
    return { success: false, error: error.message };
  }
}

// Tab management handlers
async function handleTabList() {
  try {
    const tabs = await browserAPI.tabs.query({});
    return {
      success: true,
      tabs: tabs.map(tab => ({
        id: tab.id,
        title: tab.title,
        url: tab.url,
        active: tab.active,
        index: tab.index
      }))
    };
  } catch (error) {
    console.error('Tab list error:', error);
    return { success: false, error: error.message };
  }
}

async function handleTabSelect(payload) {
  try {
    const { index } = payload;
    const tabs = await browserAPI.tabs.query({ index });

    if (tabs.length > 0) {
      await browserAPI.tabs.update(tabs[0].id, { active: true });
      activeTabId = tabs[0].id;
      return { success: true, tabId: tabs[0].id };
    }

    return { success: false, error: 'Tab not found at index' };
  } catch (error) {
    console.error('Tab select error:', error);
    return { success: false, error: error.message };
  }
}

async function handleTabNew(payload) {
  try {
    const { url } = payload;
    const tab = await browserAPI.tabs.create({
      url: url || 'about:blank',
      active: true
    });
    activeTabId = tab.id;
    return { success: true, tabId: tab.id };
  } catch (error) {
    console.error('Tab new error:', error);
    return { success: false, error: error.message };
  }
}

async function handleTabClose(payload) {
  try {
    const { index } = payload;

    if (index !== undefined) {
      const tabs = await browserAPI.tabs.query({ index });
      if (tabs.length > 0) {
        await browserAPI.tabs.remove(tabs[0].id);
        if (tabs[0].id === activeTabId) {
          activeTabId = null;
        }
      }
    } else if (activeTabId) {
      await browserAPI.tabs.remove(activeTabId);
      activeTabId = null;
    }

    return { success: true };
  } catch (error) {
    console.error('Tab close error:', error);
    return { success: false, error: error.message };
  }
}

// Register all handlers
registerHandler('navigate', handleNavigate);
registerHandler('browser_navigate', handleNavigate);
registerHandler('goBack', handleGoBack);
registerHandler('browser_go_back', handleGoBack);
registerHandler('goForward', handleGoForward);
registerHandler('browser_go_forward', handleGoForward);
registerHandler('click', handleClick);
registerHandler('browser_click', handleClick);
registerHandler('type', handleType);
registerHandler('browser_type', handleType);
registerHandler('hover', handleHover);
registerHandler('browser_hover', handleHover);
registerHandler('selectOption', handleSelectOption);
registerHandler('browser_select_option', handleSelectOption);
registerHandler('pressKey', handlePressKey);
registerHandler('browser_press_key', handlePressKey);
registerHandler('wait', handleWait);
registerHandler('browser_wait', handleWait);
registerHandler('screenshot', handleScreenshot);
registerHandler('browser_screenshot', handleScreenshot);
registerHandler('getConsoleLogs', handleGetConsoleLogs);
registerHandler('browser_get_console_logs', handleGetConsoleLogs);
registerHandler('snapshot', handleSnapshot);
registerHandler('browser_snapshot', handleSnapshot);
registerHandler('executeJS', handleExecuteJS);
registerHandler('browser_execute_js', handleExecuteJS);
registerHandler('commonOperation', handleCommonOperation);
registerHandler('browser_common_operation', handleCommonOperation);
registerHandler('tabList', handleTabList);
registerHandler('browser_tab_list', handleTabList);
registerHandler('tabSelect', handleTabSelect);
registerHandler('browser_tab_select', handleTabSelect);
registerHandler('tabNew', handleTabNew);
registerHandler('browser_tab_new', handleTabNew);
registerHandler('tabClose', handleTabClose);
registerHandler('browser_tab_close', handleTabClose);

// Message listener from content scripts
browserAPI.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getConfig') {
    sendResponse(extensionConfig);
    return true;
  }

  if (request.action === 'updateConfig') {
    extensionConfig = { ...extensionConfig, ...request.config };
    browserAPI.storage.local.set(extensionConfig);
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'getConnectionStatus') {
    sendResponse({
      connected: ws && ws.readyState === WebSocket.OPEN,
      serverUrl: extensionConfig.serverUrl
    });
    return true;
  }

  if (request.action === 'reconnect') {
    connectToMCP();
    sendResponse({ success: true });
    return true;
  }

  return false;
});

// Tab activation listener
browserAPI.tabs.onActivated.addListener((activeInfo) => {
  activeTabId = activeInfo.tabId;
  console.log('Active tab changed:', activeTabId);
});

// Initialize connection on extension load
connectToMCP();

// Keep background script alive (Firefox doesn't need service worker keepalive)
console.log('BrowserMCP Enhanced Firefox background script loaded');