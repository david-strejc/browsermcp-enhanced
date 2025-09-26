// Multi-Instance Manager for handling multiple Claude Desktop connections
class MultiInstanceManager {
  constructor() {
    // Map of instanceId -> WebSocket connection
    this.instances = new Map();

    // Map of WebSocket -> instanceId (reverse mapping)
    this.socketToInstance = new Map();

    // Tab locks: tabId -> instanceId
    this.tabLocks = new Map();

    // Wait queue: tabId -> [instanceIds]
    this.waitQueues = new Map();

    // Message handlers for each instance
    this.messageHandlers = new Map();

    // Port range to scan
    this.PORT_START = 8765;
    this.PORT_END = 8775;

    // Connection retry settings
    this.RECONNECT_DELAY = 3000;
    this.HEARTBEAT_INTERVAL = 30000;

    // Start port scanning
    this.startPortScanning();
  }

  // Start scanning for MCP servers on different ports
  async startPortScanning() {
    console.log('[MultiInstance] Starting port scanning...');

    // Initial scan
    await this.scanPorts();

    // Periodic rescan
    setInterval(() => this.scanPorts(), 10000); // Every 10 seconds
  }

  async scanPorts() {
    for (let port = this.PORT_START; port <= this.PORT_END; port++) {
      // Check if we already have a connection to this port
      const existingConnection = Array.from(this.instances.values()).find(
        inst => inst.port === port && inst.ws.readyState === WebSocket.OPEN
      );

      if (!existingConnection) {
        this.tryConnect(port);
      }
    }
  }

  tryConnect(port) {
    const url = `ws://localhost:${port}`;
    const ws = new WebSocket(url);

    // Timeout for connection attempt
    const timeout = setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    }, 5000);

    ws.onopen = () => {
      clearTimeout(timeout);
      console.log(`[MultiInstance] Connected to port ${port}, requesting instance ID...`);

      // Request instance ID
      ws.send(JSON.stringify({
        type: 'hello',
        wants: 'instanceId'
      }));
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        // Handle hello acknowledgment
        if (message.type === 'helloAck' && message.instanceId) {
          this.registerInstance(message.instanceId, ws, port);
          return;
        }

        // Handle regular messages (after registration)
        const instanceId = this.socketToInstance.get(ws);
        if (instanceId) {
          this.handleInstanceMessage(instanceId, message);
        }
      } catch (err) {
        console.error(`[MultiInstance] Error handling message:`, err);
      }
    };

    ws.onerror = (error) => {
      clearTimeout(timeout);
      // Silent fail - port might not have a server
    };

    ws.onclose = () => {
      clearTimeout(timeout);
      const instanceId = this.socketToInstance.get(ws);
      if (instanceId) {
        this.unregisterInstance(instanceId);

        // Try to reconnect after delay
        setTimeout(() => this.tryConnect(port), this.RECONNECT_DELAY);
      }
    };
  }

  registerInstance(instanceId, ws, port) {
    console.log(`[MultiInstance] Registered instance ${instanceId} on port ${port}`);

    // Store instance info
    this.instances.set(instanceId, {
      ws: ws,
      port: port,
      connectedAt: Date.now(),
      lastActivity: Date.now()
    });

    this.socketToInstance.set(ws, instanceId);

    // Set up heartbeat
    const heartbeatInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
      } else {
        clearInterval(heartbeatInterval);
      }
    }, this.HEARTBEAT_INTERVAL);

    // Update UI
    this.updateConnectionStatus();
  }

  unregisterInstance(instanceId) {
    console.log(`[MultiInstance] Unregistered instance ${instanceId}`);

    const instance = this.instances.get(instanceId);
    if (instance) {
      this.socketToInstance.delete(instance.ws);
      this.instances.delete(instanceId);

      // Release all tab locks held by this instance
      this.releaseAllLocks(instanceId);

      // Update UI
      this.updateConnectionStatus();
    }
  }

  // Tab lock management
  acquireLock(tabId, instanceId) {
    const currentLock = this.tabLocks.get(tabId);

    // Already has the lock
    if (currentLock === instanceId) {
      return { success: true, immediate: true };
    }

    // Tab is free
    if (!currentLock) {
      this.tabLocks.set(tabId, instanceId);
      console.log(`[MultiInstance] Instance ${instanceId} acquired lock on tab ${tabId}`);
      return { success: true, immediate: true };
    }

    // Tab is locked by another instance - add to wait queue
    if (!this.waitQueues.has(tabId)) {
      this.waitQueues.set(tabId, []);
    }

    const queue = this.waitQueues.get(tabId);
    if (!queue.includes(instanceId)) {
      queue.push(instanceId);
      console.log(`[MultiInstance] Instance ${instanceId} queued for tab ${tabId} (position ${queue.length})`);
    }

    return { success: false, immediate: false, queuePosition: queue.length };
  }

  releaseLock(tabId, instanceId) {
    const currentLock = this.tabLocks.get(tabId);

    if (currentLock !== instanceId) {
      return false;
    }

    console.log(`[MultiInstance] Instance ${instanceId} released lock on tab ${tabId}`);

    // Check if there's a waiting instance
    const queue = this.waitQueues.get(tabId);
    if (queue && queue.length > 0) {
      const nextInstanceId = queue.shift();
      this.tabLocks.set(tabId, nextInstanceId);

      console.log(`[MultiInstance] Lock on tab ${tabId} transferred to instance ${nextInstanceId}`);

      // Notify the instance it now has the lock
      this.sendToInstance(nextInstanceId, {
        type: 'lockGranted',
        tabId: tabId
      });

      return true;
    }

    // No waiting instances - release the lock completely
    this.tabLocks.delete(tabId);
    return true;
  }

  releaseAllLocks(instanceId) {
    // Release all tab locks held by this instance
    for (const [tabId, lockHolder] of this.tabLocks.entries()) {
      if (lockHolder === instanceId) {
        this.releaseLock(tabId, instanceId);
      }
    }

    // Remove from all wait queues
    for (const [tabId, queue] of this.waitQueues.entries()) {
      const index = queue.indexOf(instanceId);
      if (index > -1) {
        queue.splice(index, 1);
      }
    }
  }

  // Message handling
  handleInstanceMessage(instanceId, message) {
    const instance = this.instances.get(instanceId);
    if (!instance) return;

    instance.lastActivity = Date.now();

    // Check if message requires tab lock
    if (this.requiresTabLock(message)) {
      const tabId = message.tabId || activeTabId; // Use global activeTabId if not specified

      if (!tabId) {
        this.sendToInstance(instanceId, {
          id: message.id,
          type: 'error',
          error: 'No active tab'
        });
        return;
      }

      const lockResult = this.acquireLock(tabId, instanceId);

      if (!lockResult.success) {
        this.sendToInstance(instanceId, {
          id: message.id,
          type: 'busy',
          error: `Tab ${tabId} is locked by another instance`,
          queuePosition: lockResult.queuePosition
        });
        return;
      }
    }

    // Process the message based on type
    this.processMessage(instanceId, message);
  }

  requiresTabLock(message) {
    // Messages that require exclusive tab access
    const lockedOperations = [
      'click',
      'type',
      'navigate',
      'screenshot',
      'execute_js',
      'debugger_attach',
      'debugger_command',
      'select_option',
      'hover',
      'press_key'
    ];

    return lockedOperations.includes(message.type);
  }

  processMessage(instanceId, message) {
    // Route to appropriate handler
    if (messageHandlers.has(message.type)) {
      const handler = messageHandlers.get(message.type);

      // Wrap handler to ensure response goes back to correct instance
      const wrappedHandler = async (payload) => {
        try {
          const response = await handler(payload);
          this.sendToInstance(instanceId, {
            id: message.id,
            type: 'response',
            ...response
          });
        } catch (error) {
          this.sendToInstance(instanceId, {
            id: message.id,
            type: 'error',
            error: error.message
          });
        }
      };

      wrappedHandler(message.payload || {});
    } else {
      this.sendToInstance(instanceId, {
        id: message.id,
        type: 'error',
        error: `Unknown message type: ${message.type}`
      });
    }
  }

  sendToInstance(instanceId, message) {
    const instance = this.instances.get(instanceId);
    if (instance && instance.ws.readyState === WebSocket.OPEN) {
      instance.ws.send(JSON.stringify(message));
    }
  }

  // Broadcast to all instances
  broadcast(message) {
    for (const [instanceId, instance] of this.instances) {
      if (instance.ws.readyState === WebSocket.OPEN) {
        instance.ws.send(JSON.stringify(message));
      }
    }
  }

  // UI updates
  updateConnectionStatus() {
    const connectedCount = this.instances.size;
    const icon = connectedCount > 0 ? 'connected' : 'disconnected';

    chrome.action.setIcon({
      path: {
        "16": `icon-16-${icon}.png`,
        "48": `icon-48-${icon}.png`,
        "128": `icon-128-${icon}.png`
      }
    });

    // Update badge with connection count
    if (connectedCount > 1) {
      chrome.action.setBadgeText({ text: connectedCount.toString() });
      chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
    } else if (connectedCount === 1) {
      chrome.action.setBadgeText({ text: '' });
    } else {
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#f44336' });
    }
  }

  // Get status for debugging
  getStatus() {
    return {
      instances: Array.from(this.instances.entries()).map(([id, inst]) => ({
        id: id,
        port: inst.port,
        connected: inst.ws.readyState === WebSocket.OPEN,
        connectedAt: new Date(inst.connectedAt).toISOString(),
        lastActivity: new Date(inst.lastActivity).toISOString()
      })),
      tabLocks: Array.from(this.tabLocks.entries()),
      waitQueues: Array.from(this.waitQueues.entries())
    };
  }
}

// Export for use in background.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MultiInstanceManager;
}