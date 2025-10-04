/**
 * Unified Connection Manager - Single Port Architecture
 *
 * Simplified connection logic:
 * - Connects to single port (8765)
 * - Generates unique instance ID
 * - Includes instance ID in WebSocket URI
 * - No port scanning needed
 *
 * Pattern: ws://localhost:8765/session/<instanceId>
 */

(function() {
  const TAG = '[UnifiedConn]';
  const log = (...args) => console.log(TAG, new Date().toISOString(), ...args);
  const warn = (...args) => console.warn(TAG, new Date().toISOString(), ...args);
  const error = (...args) => console.error(TAG, new Date().toISOString(), ...args);

  /**
   * Unified Connection Manager
   * Manages single WebSocket connection to unified MCP server
   */
  function UnifiedConnectionManager() {
    // Single WebSocket connection
    this.ws = null;

    // Instance ID (generated once, persisted)
    this.instanceId = null;

    // Connection state
    this.connected = false;
    this.connecting = false;

    // Server configuration
    this.SERVER_HOST = 'localhost';
    this.SERVER_PORT = 8765;

    // Retry settings
    this.RECONNECT_DELAY = 3000;
    this.MAX_RECONNECT_DELAY = 30000;
    this.reconnectAttempts = 0;

    // Message handlers
    this.messageHandlers = new Map();

    // Note: Call initialize() manually after construction for async setup
  }

  /**
   * Initialize connection manager
   */
  UnifiedConnectionManager.prototype.initialize = async function() {
    log('Initializing unified connection manager...');

    // Load or generate instance ID (async)
    await this.loadInstanceId();

    // Start connection
    this.connect();

    this.updateBadge();
  };

  /**
   * Load instance ID from storage or generate new one
   */
  UnifiedConnectionManager.prototype.loadInstanceId = async function() {
    // Try to load from chrome.storage.local (service worker compatible)
    try {
      const result = await chrome.storage.local.get(['browsermcp_instance_id']);
      if (result.browsermcp_instance_id) {
        this.instanceId = result.browsermcp_instance_id;
        log('Loaded instance ID from storage:', this.instanceId);
        return;
      }
    } catch (err) {
      warn('Failed to load instance ID from storage:', err);
    }

    // Generate new instance ID
    this.instanceId = this.generateUUID();
    log('Generated new instance ID:', this.instanceId);

    // Save to storage
    try {
      await chrome.storage.local.set({ browsermcp_instance_id: this.instanceId });
    } catch (err) {
      warn('Failed to save instance ID to storage:', err);
    }
  };

  /**
   * Generate UUID v4
   */
  UnifiedConnectionManager.prototype.generateUUID = function() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };

  /**
   * Connect to unified MCP server
   */
  UnifiedConnectionManager.prototype.connect = function() {
    if (this.connecting || this.isConnected()) {
      return;
    }

    this.connecting = true;

    // Build WebSocket URL with instance ID in path
    const wsUrl = `ws://${this.SERVER_HOST}:${this.SERVER_PORT}/session/${this.instanceId}`;
    log('Connecting to:', wsUrl);

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        log('Connected successfully');
        this.connected = true;
        this.connecting = false;
        this.reconnectAttempts = 0;
        this.updateBadge();

        // Send hello message
        this.send({
          type: 'hello',
          wants: 'instanceId',
          instanceId: this.instanceId
        });
      };

      this.ws.onclose = () => {
        log('Connection closed');
        this.connected = false;
        this.connecting = false;
        this.ws = null;
        this.updateBadge();

        // Schedule reconnect
        this.scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        error('WebSocket error:', err);
        this.connecting = false;
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleMessage(msg);
        } catch (err) {
          error('Failed to parse message:', err);
        }
      };

      // Setup heartbeat
      this.setupHeartbeat();

    } catch (err) {
      error('Failed to create WebSocket:', err);
      this.connecting = false;
      this.scheduleReconnect();
    }
  };

  /**
   * Setup heartbeat ping/pong
   */
  UnifiedConnectionManager.prototype.setupHeartbeat = function() {
    const interval = setInterval(() => {
      if (!this.isConnected()) {
        clearInterval(interval);
        return;
      }

      this.send({ type: 'ping' });
    }, 30000); // Ping every 30 seconds
  };

  /**
   * Schedule reconnect with exponential backoff
   */
  UnifiedConnectionManager.prototype.scheduleReconnect = function() {
    this.reconnectAttempts++;

    const delay = Math.min(
      this.RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts - 1),
      this.MAX_RECONNECT_DELAY
    );

    log(`Scheduling reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connect();
    }, delay);
  };

  /**
   * Handle incoming message
   */
  UnifiedConnectionManager.prototype.handleMessage = function(msg) {
    // Handle protocol messages
    if (msg.type === 'helloAck') {
      log('Received hello acknowledgment:', msg);
      return;
    }

    if (msg.type === 'pong') {
      // Heartbeat response
      return;
    }

    if (msg.type === 'connected') {
      log('Server confirmed connection:', msg);
      return;
    }

    // Dispatch to registered handlers
    // First try specific message type handlers
    const specificHandlers = this.messageHandlers.get(msg.type) || [];
    // Then add wildcard handlers (catch-all)
    const wildcardHandlers = this.messageHandlers.get('*') || [];
    const allHandlers = [...specificHandlers, ...wildcardHandlers];

    for (const handler of allHandlers) {
      try {
        handler(msg);
      } catch (err) {
        error('Message handler error:', err);
      }
    }
  };

  /**
   * Send message to server
   */
  UnifiedConnectionManager.prototype.send = function(msg) {
    if (!this.isConnected()) {
      warn('Cannot send message, not connected');
      return false;
    }

    try {
      // Add instance ID to all messages
      msg.instanceId = msg.instanceId || this.instanceId;
      this.ws.send(JSON.stringify(msg));
      return true;
    } catch (err) {
      error('Failed to send message:', err);
      return false;
    }
  };

  /**
   * Register message handler
   */
  UnifiedConnectionManager.prototype.onMessage = function(type, handler) {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, []);
    }
    this.messageHandlers.get(type).push(handler);
  };

  /**
   * Check if connected
   */
  UnifiedConnectionManager.prototype.isConnected = function() {
    return this.connected && this.ws && this.ws.readyState === WebSocket.OPEN;
  };

  /**
   * Get instance ID
   */
  UnifiedConnectionManager.prototype.getInstanceId = function() {
    return this.instanceId;
  };

  /**
   * Update badge and icon to show connection status
   */
  UnifiedConnectionManager.prototype.updateBadge = function() {
    if (!chrome.action) return;

    if (this.isConnected()) {
      // Update badge
      chrome.action.setBadgeText({ text: '✓' });
      chrome.action.setBadgeBackgroundColor({ color: '#00aa00' });
      chrome.action.setTitle({ title: `Browser MCP Connected\nInstance: ${this.instanceId}` });

      // Update icon to green
      chrome.action.setIcon({
        path: {
          "16": "icon-16-connected.png",
          "48": "icon-48-connected.png",
          "128": "icon-128-connected.png"
        }
      }).catch(err => console.warn('Failed to update icon:', err));
    } else {
      // Update badge
      chrome.action.setBadgeText({ text: '✗' });
      chrome.action.setBadgeBackgroundColor({ color: '#aa0000' });
      chrome.action.setTitle({ title: 'Browser MCP Disconnected' });

      // Update icon to red
      chrome.action.setIcon({
        path: {
          "16": "icon-16-disconnected.png",
          "48": "icon-48-disconnected.png",
          "128": "icon-128-disconnected.png"
        }
      }).catch(err => console.warn('Failed to update icon:', err));
    }
  };

  /**
   * Tab lock management (client-side state)
   */
  UnifiedConnectionManager.prototype.acquireTabLock = function(tabId) {
    const now = Date.now();
    const existing = this.tabLocks.get(tabId);

    // Check if lock is stale (>60s old)
    if (existing && (now - existing) > 60000) {
      warn(`Releasing stale lock for tab ${tabId}`);
      this.tabLocks.delete(tabId);
      this.tabLockTimestamps.delete(tabId);
    }

    // Acquire lock
    this.tabLocks.set(tabId, now);
    this.tabLockTimestamps.set(tabId, now);
    return true;
  };

  UnifiedConnectionManager.prototype.releaseTabLock = function(tabId) {
    this.tabLocks.delete(tabId);
    this.tabLockTimestamps.delete(tabId);
  };

  UnifiedConnectionManager.prototype.hasTabLock = function(tabId) {
    return this.tabLocks.has(tabId);
  };

  /**
   * Close connection
   */
  UnifiedConnectionManager.prototype.close = function() {
    log('Closing connection...');
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.connecting = false;
  };

  // Export as global (use self for service worker compatibility)
  self.UnifiedConnectionManager = UnifiedConnectionManager;

  // Note: Instance creation is handled by background-unified.js
  // Don't auto-create singleton here since service workers need explicit initialization

  log('UnifiedConnectionManager class defined and ready');

})();
