// Background script for Unified Mode (single-listener architecture)
// Uses unified-connection-manager.js for single-port WebSocket connection

(function() {
  'use strict';

  const TAG = '[UnifiedMode]';
  const log = (...args) => console.log(TAG, new Date().toISOString(), ...args);
  const warn = (...args) => console.warn(TAG, new Date().toISOString(), ...args);
  const error = (...args) => console.error(TAG, new Date().toISOString(), ...args);

  // Unified Mode Controller
  const UnifiedMode = {
    connectionManager: null,

    init() {
      log('Initializing Unified Mode...');

      // Create unified connection manager (defined in unified-connection-manager.js)
      if (typeof window !== 'undefined' && window.unifiedConnectionManager) {
        this.connectionManager = window.unifiedConnectionManager;
        log('Using existing unified connection manager');
      } else if (typeof UnifiedConnectionManager !== 'undefined') {
        this.connectionManager = new UnifiedConnectionManager();
        log('Created new unified connection manager');
      } else {
        error('UnifiedConnectionManager not found! Make sure unified-connection-manager.js is loaded.');
        return;
      }

      // Setup message handlers
      this.setupMessageHandlers();

      log('Unified Mode initialized successfully');
      log('Instance ID:', this.connectionManager.getInstanceId());
    },

    deinit() {
      log('Deinitializing Unified Mode...');

      if (this.connectionManager) {
        this.connectionManager.close();
        this.connectionManager = null;
      }

      log('Unified Mode deinitialized');
    },

    setupMessageHandlers() {
      // Handle messages from content scripts, popup, etc.
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        this.handleMessage(message, sender, sendResponse);
        return true; // Keep channel open for async responses
      });

      // Handle messages from WebSocket server
      if (this.connectionManager) {
        this.connectionManager.onMessage('*', (msg) => {
          this.handleServerMessage(msg);
        });
      }
    },

    handleMessage(message, sender, sendResponse) {
      log('Received message:', message.type);

      switch (message.type) {
        case 'get-connection-status':
          sendResponse({
            connected: this.connectionManager?.isConnected() || false,
            instanceId: this.connectionManager?.getInstanceId() || null
          });
          break;

        case 'send-to-server':
          if (this.connectionManager && this.connectionManager.isConnected()) {
            this.connectionManager.send(message.data);
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'Not connected to server' });
          }
          break;

        default:
          // Forward unknown messages to connection manager
          if (this.connectionManager) {
            this.connectionManager.send(message);
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'Connection manager not initialized' });
          }
      }
    },

    handleServerMessage(msg) {
      // Forward server messages to content scripts, popup, etc.
      log('Server message:', msg.type);

      // Broadcast to all tabs (or specific handling based on message type)
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((tab) => {
          chrome.tabs.sendMessage(tab.id, {
            type: 'server-message',
            data: msg
          }).catch(() => {
            // Ignore errors for tabs without content scripts
          });
        });
      });
    }
  };

  // Export as global for background.js to use
  self.UnifiedMode = UnifiedMode;

  log('Unified Mode controller defined');

})();
