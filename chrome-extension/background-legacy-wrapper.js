// Legacy Background Controller
// Wraps the existing legacy background script with init/deinit pattern

(() => {
  const TAG = '[BG-Legacy]';
  const log = (...args) => console.log(TAG, new Date().toISOString(), ...args);
  const warn = (...args) => console.warn(TAG, new Date().toISOString(), ...args);
  const error = (...args) => console.error(TAG, new Date().toISOString(), ...args);

  // WebSocket and state variables
  let ws = null;
  let activeTabId = null;
  let messageHandlers = new Map();
  let reconnectTimer = null;
  let keepAliveTimer = null;
  let extensionConfig = {
    unsafeMode: false,
    serverUrl: 'ws://localhost:8765'
  };

  // Store listener references
  const listeners = {
    onMessage: null,
    onConnect: null,
    onInstalled: null,
    onTabsRemoved: null,
    onTabsActivated: null,
    onStorageChanged: null
  };

  /**
   * Update extension icon based on connection status
   */
  function updateIcon(connected) {
    const iconPath = connected ? {
      "16": "icon-16-connected.png",
      "48": "icon-48-connected.png",
      "128": "icon-128-connected.png"
    } : {
      "16": "icon-16.png",
      "48": "icon-48.png",
      "128": "icon-128.png"
    };

    if (chrome.action) {
      chrome.action.setIcon({ path: iconPath }).catch(err => {
        error('Failed to update icon:', err);
      });
    }
  }

  /**
   * Connect to WebSocket server
   */
  function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
      return;
    }

    log('Attempting WebSocket connection to:', extensionConfig.serverUrl);
    ws = new WebSocket(extensionConfig.serverUrl);

    ws.onopen = () => {
      log('WebSocket connected');
      updateIcon(true);

      // Clear reconnect timer
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      // Start keep-alive
      startKeepAlive();
    };

    ws.onclose = () => {
      log('WebSocket disconnected');
      updateIcon(false);
      ws = null;

      // Stop keep-alive
      stopKeepAlive();

      // Schedule reconnection
      scheduleReconnect();
    };

    ws.onerror = (error) => {
      error('WebSocket error:', error);
      updateIcon(false);
    };

    ws.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        log('Received message:', message.type || message);

        if (message.type && messageHandlers.has(message.type)) {
          const handler = messageHandlers.get(message.type);
          const result = await handler(message.payload || {});

          if (message.id) {
            ws.send(JSON.stringify({
              id: message.id,
              type: 'response',
              payload: result
            }));
          }
        }
      } catch (err) {
        error('Message handling error:', err);
      }
    };
  }

  /**
   * Schedule WebSocket reconnection
   */
  function scheduleReconnect() {
    if (reconnectTimer) return;

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectWebSocket();
    }, 3000);
  }

  /**
   * Start keep-alive ping
   */
  function startKeepAlive() {
    stopKeepAlive();
    keepAliveTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  }

  /**
   * Stop keep-alive ping
   */
  function stopKeepAlive() {
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
  }

  /**
   * Setup message handlers
   */
  function setupMessageHandlers() {
    // Tab management
    messageHandlers.set('tabs.list', async () => {
      const tabs = await chrome.tabs.query({});
      return {
        tabs: tabs.map(tab => ({
          id: tab.id,
          url: tab.url,
          title: tab.title,
          active: tab.active
        }))
      };
    });

    messageHandlers.set('tabs.select', async (payload) => {
      const { tabId } = payload;
      await chrome.tabs.update(tabId, { active: true });
      activeTabId = tabId;
      return { success: true };
    });

    // Add more handlers as needed...
    log('Message handlers configured');
  }

  /**
   * Event listeners
   */
  listeners.onMessage = (request, sender, sendResponse) => {
    if (request.type === 'websocket-status') {
      sendResponse({
        connected: ws && ws.readyState === WebSocket.OPEN,
        url: extensionConfig.serverUrl
      });
      return true;
    }

    if (request.type === 'connect-websocket') {
      connectWebSocket();
      sendResponse({ success: true });
      return true;
    }

    // Forward to WebSocket
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(request));
      sendResponse({ success: true });
    } else {
      sendResponse({ error: 'WebSocket not connected' });
    }
    return true;
  };

  listeners.onInstalled = (details) => {
    log('Extension installed/updated:', details);
  };

  listeners.onTabsRemoved = (tabId) => {
    if (tabId === activeTabId) {
      activeTabId = null;
    }
  };

  listeners.onTabsActivated = (activeInfo) => {
    activeTabId = activeInfo.tabId;
  };

  listeners.onStorageChanged = (changes, area) => {
    if (area === 'local') {
      if (changes.unsafeMode) {
        extensionConfig.unsafeMode = changes.unsafeMode.newValue;
        log('Unsafe mode changed:', extensionConfig.unsafeMode);
      }
      if (changes.serverUrl) {
        extensionConfig.serverUrl = changes.serverUrl.newValue;
        log('Server URL changed:', extensionConfig.serverUrl);
        // Reconnect with new URL
        if (ws) {
          ws.close();
        }
        connectWebSocket();
      }
    }
  };

  /**
   * Initialize legacy mode
   */
  function init() {
    log('Initializing legacy mode...');

    // Update config
    extensionConfig.unsafeMode = self.unsafeMode || false;

    // Setup handlers
    setupMessageHandlers();

    // Register listeners
    chrome.runtime.onMessage.addListener(listeners.onMessage);
    chrome.runtime.onInstalled.addListener(listeners.onInstalled);
    chrome.tabs.onRemoved.addListener(listeners.onTabsRemoved);
    chrome.tabs.onActivated.addListener(listeners.onTabsActivated);
    chrome.storage.onChanged.addListener(listeners.onStorageChanged);

    // Start WebSocket connection
    connectWebSocket();

    log('Legacy mode initialized');
  }

  /**
   * Deinitialize legacy mode
   */
  function deinit() {
    log('Deinitializing legacy mode...');

    // Close WebSocket
    if (ws) {
      ws.close();
      ws = null;
    }

    // Clear timers
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    stopKeepAlive();

    // Remove listeners
    chrome.runtime.onMessage.removeListener(listeners.onMessage);
    chrome.runtime.onInstalled.removeListener(listeners.onInstalled);
    chrome.tabs.onRemoved.removeListener(listeners.onTabsRemoved);
    chrome.tabs.onActivated.removeListener(listeners.onTabsActivated);
    chrome.storage.onChanged.removeListener(listeners.onStorageChanged);

    // Clear handlers
    messageHandlers.clear();

    // Reset icon
    updateIcon(false);

    log('Legacy mode deinitialized');
  }

  /**
   * Handle unsafe mode changes
   */
  function onUnsafeModeChanged(enabled) {
    extensionConfig.unsafeMode = enabled;
    log('Unsafe mode changed:', enabled);
  }

  // Export controller interface
  self.LegacyMode = {
    init,
    deinit,
    onUnsafeModeChanged
  };

  log('Legacy controller loaded');
})();