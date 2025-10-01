// Background script for Unified Mode (single-listener architecture)
// SIMPLE APPROACH: Reuse MultiInstanceManager with single instance

(function() {
  'use strict';

  const TAG = '[UnifiedMode]';
  const log = (...args) => console.log(TAG, new Date().toISOString(), ...args);
  const warn = (...args) => console.warn(TAG, new Date().toISOString(), ...args);
  const error = (...args) => console.error(TAG, new Date().toISOString(), ...args);

  // Unified Mode Controller
  const UnifiedMode = {
    connectionManager: null,
    multiInstanceDelegate: null,

    async init() {
      log('Initializing Unified Mode...');

      // Create unified connection manager
      if (typeof self.UnifiedConnectionManager !== 'undefined') {
        this.connectionManager = new self.UnifiedConnectionManager();
        log('Created unified connection manager');

        // Wait for initialization (loads instance ID)
        await this.connectionManager.initialize();
        log('Connection manager initialized with instance ID:', this.connectionManager.getInstanceId());
      } else {
        error('UnifiedConnectionManager not found!');
        return;
      }

      // SMART APPROACH: Delegate to MultiInstanceManager
      // MultiInstanceManager already has ALL the handlers and logic
      // We just need to create a single instance within it
      if (typeof self.MultiInstanceManager !== 'undefined') {
        this.multiInstanceDelegate = new self.MultiInstanceManager();
        log('Created MultiInstanceManager delegate');

        // Register our WebSocket connection as an instance
        const instanceId = this.connectionManager.getInstanceId();
        const port = this.connectionManager.SERVER_PORT;

        // Create instance entry in the delegate
        this.multiInstanceDelegate.instances.set(instanceId, {
          ws: null, // Will be set when WebSocket connects
          port: port,
          activeTabId: null,
          tabs: new Set()
        });

        log('Registered unified instance in delegate:', instanceId);

        // Setup message routing between unified WebSocket and delegate
        this.setupMessageRouting(instanceId);
      } else {
        error('MultiInstanceManager not found! Cannot delegate.');
        return;
      }

      log('Unified Mode initialized successfully');
    },

    deinit() {
      log('Deinitializing Unified Mode...');

      if (this.connectionManager) {
        this.connectionManager.close();
        this.connectionManager = null;
      }

      if (this.multiInstanceDelegate) {
        this.multiInstanceDelegate.cleanup();
        this.multiInstanceDelegate = null;
      }

      log('Unified Mode deinitialized');
    },

    setupMessageRouting(instanceId) {
      // Route messages FROM server TO delegate
      this.connectionManager.onMessage('*', (msg) => {
        this.handleServerMessage(msg, instanceId);
      });

      log('Message routing configured for instance:', instanceId);
    },

    async handleServerMessage(msg, instanceId) {
      if (!this.multiInstanceDelegate) {
        error('No delegate available to handle message');
        return;
      }

      const messageType = msg.type;
      log('Routing message to delegate:', messageType);

      // Get the handler from delegate's messageHandlers
      const handler = this.multiInstanceDelegate.messageHandlers?.get(messageType);

      if (!handler) {
        warn('No handler found for message type:', messageType);
        // Send error response back to server
        this.sendResponse(msg.id, {
          success: false,
          error: `No handler for message type: ${messageType}`
        });
        return;
      }

      try {
        // Execute handler with payload and instanceId
        const result = await handler(msg.payload || msg, instanceId);

        // Send success response back to server
        this.sendResponse(msg.id, {
          success: true,
          ...result
        });

      } catch (err) {
        error('Handler execution failed:', err);

        // Send error response back to server
        this.sendResponse(msg.id, {
          success: false,
          error: err.message || String(err)
        });
      }
    },

    sendResponse(messageId, response) {
      if (!this.connectionManager || !this.connectionManager.isConnected()) {
        warn('Cannot send response - not connected');
        return;
      }

      // Send response message back through WebSocket
      this.connectionManager.send({
        type: 'response',
        id: messageId,
        data: response
      });

      log('Response sent for message:', messageId);
    }
  };

  // Export as global for background.js to use
  self.UnifiedMode = UnifiedMode;

  log('Unified Mode controller defined (delegating to MultiInstanceManager)');

})();
