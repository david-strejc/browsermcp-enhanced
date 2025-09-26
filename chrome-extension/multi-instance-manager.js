// Multi-Instance Manager for handling multiple Claude Desktop connections

(function() {
  var TAG = '[MultiMgr]';
  var log = function() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift(TAG, new Date().toISOString());
    console.log.apply(console, args);
  };
  var warn = function() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift(TAG, new Date().toISOString());
    console.warn.apply(console, args);
  };
  var error = function() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift(TAG, new Date().toISOString());
    console.error.apply(console, args);
  };

  // Constructor function (ES5 style)
  function MultiInstanceManager() {
    // Map of instanceId -> WebSocket connection
    this.instances = new Map();

    // Map of WebSocket -> instanceId (reverse mapping)
    this.socketToInstance = new Map();

    // Track connection failures per port for adaptive backoff
    this.portFailures = new Map();

    // Tab locks: tabId -> instanceId
    this.tabLocks = new Map();

    // Wait queue: tabId -> [instanceIds]
    this.waitQueues = new Map();

    // Message handlers for each instance
    this.messageHandlers = new Map();

    // Dynamically discovered ports
    this.dynamicPorts = null;

    // Port range to scan
    this.PORT_START = 8765;
    this.PORT_END = 8775;

    // Connection retry settings
    this.RECONNECT_DELAY = 3000;
    this.HEARTBEAT_INTERVAL = 30000;
    this.MAX_FAILURE_BACKOFF = 60000;
    this.PORT_LIST_REFRESH_INTERVAL = 15000;

    // Start port scanning
    this.startPortScanning();
  }

  // Start scanning for MCP servers on different ports
  MultiInstanceManager.prototype.startPortScanning = function() {
    log('Starting port scanning...');

    // Initial scan
    this.scanPorts();

    // Periodic rescan
    var self = this;
    setInterval(function() {
      self.scanPorts();
    }, 10000); // Every 10 seconds
  };

  MultiInstanceManager.prototype.scanPorts = function() {
    var self = this;
    var portsToScan = this.getPortsToScan();
    log('Scanning ports:', portsToScan.join(', '));
    portsToScan.forEach(function(port) {
      // Check if we already have a connection to this port
      var existingConnection = null;
      this.instances.forEach(function(inst) {
        if (inst.port === port && inst.ws.readyState === WebSocket.OPEN) {
          existingConnection = inst;
        }
      });

      if (!existingConnection) {
        var failureInfo = this.portFailures.get(port);
        if (failureInfo) {
          var now = Date.now();
          var elapsed = now - failureInfo.lastAttempt;
          var waitTime = failureInfo.nextRetryDelay;
          if (elapsed < waitTime) {
            return;
          }
        }
        this.tryConnect(port);
      }
    }, this);
  };

  MultiInstanceManager.prototype.tryConnect = function(port) {
    var self = this;
    var failureInfo = this.portFailures.get(port);
    if (failureInfo) {
      failureInfo.lastAttempt = Date.now();
      this.portFailures.set(port, failureInfo);
    }
    var url = 'ws://localhost:' + port;
    var ws = new WebSocket(url);

    // Timeout for connection attempt
    var timeout = setTimeout(function() {
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    }, 5000);

    ws.onopen = function() {
      clearTimeout(timeout);
      self.portFailures.delete(port);
      log('Connected to port ' + port + ', requesting instance ID...');

      // Request instance ID
      ws.send(JSON.stringify({
        type: 'hello',
        wants: 'instanceId'
      }));
    };

    ws.onmessage = function(event) {
      try {
        var message = JSON.parse(event.data);

        if (message.type === 'portListResponse' && Array.isArray(message.ports)) {
          self.updateKnownPorts(message.ports);
          return;
        }

        // Handle hello acknowledgment
        if (message.type === 'helloAck' && message.instanceId) {
          self.registerInstance(message.instanceId, ws, port);
          return;
        }

        // Handle regular messages (after registration)
        var instanceId = self.socketToInstance.get(ws);
        if (instanceId) {
          self.handleInstanceMessage(instanceId, message);
        }
      } catch (err) {
        error('Error handling message:', err);
      }
    };

    ws.onerror = function(err) {
      clearTimeout(timeout);
      self.trackPortFailure(port, err);
    };

    ws.onclose = function() {
      clearTimeout(timeout);
      // Remove from instances if registered
      var instanceId = self.socketToInstance.get(ws);
      if (instanceId) {
        var closingInstance = self.instances.get(instanceId);
        self.instances.delete(instanceId);
        self.socketToInstance.delete(ws);
        log('Instance ' + instanceId + ' disconnected');

        if (closingInstance && closingInstance.portListTimer) {
          clearInterval(closingInstance.portListTimer);
          closingInstance.portListTimer = null;
        }

        // Release any tab locks held by this instance
        self.tabLocks.forEach(function(lockInstanceId, tabId) {
          if (lockInstanceId === instanceId) {
            self.releaseTabLock(tabId, instanceId);
          }
        });

        // Schedule reconnection
        setTimeout(function() {
          self.tryConnect(port);
        }, self.RECONNECT_DELAY);
      } else {
        // Failed before registration - apply backoff
        self.trackPortFailure(port);
      }
    };
  };

  MultiInstanceManager.prototype.registerInstance = function(instanceId, ws, port) {
    log('Registered instance ' + instanceId + ' on port ' + port);

    // Store instance info
    this.instances.set(instanceId, {
      ws: ws,
      port: port,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      portListTimer: null
    });

    // Store reverse mapping
    this.socketToInstance.set(ws, instanceId);

    // Update badge
    this.updateBadge();

    // Start heartbeat for this instance
    this.startHeartbeat(instanceId);

    // Request initial port list and schedule refresh
    this.requestPortList(ws);
    this.startPortListRefresh(instanceId);
  };

  MultiInstanceManager.prototype.startHeartbeat = function(instanceId) {
    var self = this;
    var interval = setInterval(function() {
      var instance = self.instances.get(instanceId);
      if (instance && instance.ws.readyState === WebSocket.OPEN) {
        instance.ws.send(JSON.stringify({ type: 'ping' }));
        instance.lastActivity = Date.now();
      } else {
        clearInterval(interval);
      }
    }, this.HEARTBEAT_INTERVAL);
  };

  MultiInstanceManager.prototype.startPortListRefresh = function(instanceId) {
    var self = this;
    var instance = this.instances.get(instanceId);
    if (!instance) {
      return;
    }

    if (instance.portListTimer) {
      clearInterval(instance.portListTimer);
    }

    instance.portListTimer = setInterval(function() {
      var ref = self.instances.get(instanceId);
      if (!ref || ref.ws.readyState !== WebSocket.OPEN) {
        if (ref && ref.portListTimer) {
          clearInterval(ref.portListTimer);
          ref.portListTimer = null;
        }
        return;
      }
      self.requestPortList(ref.ws);
    }, this.PORT_LIST_REFRESH_INTERVAL);
  };

  MultiInstanceManager.prototype.sendToInstance = function(instanceId, message) {
    var instance = this.instances.get(instanceId);
    if (instance && instance.ws.readyState === WebSocket.OPEN) {
      instance.ws.send(JSON.stringify(message));
      instance.lastActivity = Date.now();
      return true;
    }
    return false;
  };

  MultiInstanceManager.prototype.broadcastToAll = function(message) {
    var sent = 0;
    this.instances.forEach(function(instance, instanceId) {
      if (instance.ws.readyState === WebSocket.OPEN) {
        instance.ws.send(JSON.stringify(message));
        instance.lastActivity = Date.now();
        sent++;
      }
    });
    return sent;
  };

  MultiInstanceManager.prototype.acquireTabLock = function(tabId, instanceId) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var currentLock = self.tabLocks.get(tabId);

      if (!currentLock) {
        // No lock exists, acquire immediately
        self.tabLocks.set(tabId, instanceId);
        log('Instance ' + instanceId + ' acquired lock for tab ' + tabId);
        resolve(true);
        return;
      }

      if (currentLock === instanceId) {
        // Already owns the lock
        resolve(true);
        return;
      }

      // Add to wait queue
      var queue = self.waitQueues.get(tabId) || [];
      queue.push({
        instanceId: instanceId,
        resolve: resolve,
        reject: reject,
        timestamp: Date.now()
      });
      self.waitQueues.set(tabId, queue);

      log('Instance ' + instanceId + ' queued for tab ' + tabId + ' (position: ' + queue.length + ')');

      // Set timeout for lock acquisition with proper cleanup
      var timeoutId = setTimeout(function() {
        var queue = self.waitQueues.get(tabId) || [];
        var index = queue.findIndex(function(item) {
          return item.instanceId === instanceId;
        });

        if (index !== -1) {
          queue.splice(index, 1);
          if (queue.length === 0) {
            self.waitQueues.delete(tabId);
          } else {
            self.waitQueues.set(tabId, queue);
          }
          reject(new Error('Tab lock acquisition timeout'));
        }
      }, 30000); // 30 second timeout

      // Store timeout ID in queue item for cleanup
      queue[queue.length - 1].timeoutId = timeoutId;
    });
  };

  MultiInstanceManager.prototype.releaseTabLock = function(tabId, instanceId) {
    var currentLock = this.tabLocks.get(tabId);

    if (currentLock !== instanceId) {
      return false;
    }

    this.tabLocks.delete(tabId);
    log('Instance ' + instanceId + ' released lock for tab ' + tabId);

    // Process wait queue
    var queue = this.waitQueues.get(tabId);
    if (queue && queue.length > 0) {
      var next = queue.shift();

      // Clear timeout for the next item since it's getting the lock
      if (next.timeoutId) {
        clearTimeout(next.timeoutId);
      }

      if (queue.length === 0) {
        this.waitQueues.delete(tabId);
      } else {
        this.waitQueues.set(tabId, queue);
      }

      // Grant lock to next in queue
      this.tabLocks.set(tabId, next.instanceId);
      log('Instance ' + next.instanceId + ' acquired lock for tab ' + tabId + ' from queue');
      next.resolve(true);
    }

    return true;
  };

  MultiInstanceManager.prototype.updateBadge = function() {
    var connectedCount = 0;
    this.instances.forEach(function(instance) {
      if (instance.ws.readyState === WebSocket.OPEN) {
        connectedCount++;
      }
    });

    if (chrome.action) {
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
  };

  MultiInstanceManager.prototype.updateKnownPorts = function(portList) {
    if (!Array.isArray(portList) || portList.length === 0) {
      this.dynamicPorts = null;
      warn('Received empty port list, reverting to default range');
      return;
    }

    var sanitized = new Set();
    portList.forEach(function(port) {
      var parsed = parseInt(port, 10);
      if (!isNaN(parsed) && parsed >= this.PORT_START && parsed <= this.PORT_END) {
        sanitized.add(parsed);
      }
    }, this);

    if (sanitized.size > 0) {
      this.dynamicPorts = sanitized;
      log('Updated dynamic port list:', Array.from(sanitized).sort().join(', '));
    }
  };

  MultiInstanceManager.prototype.getStatus = function() {
    var instancesArray = [];
    this.instances.forEach(function(inst, id) {
      instancesArray.push({
        id: id,
        port: inst.port,
        connected: inst.ws.readyState === WebSocket.OPEN,
        connectedAt: new Date(inst.connectedAt).toISOString(),
        lastActivity: new Date(inst.lastActivity).toISOString()
      });
    });

    var tabLocksArray = [];
    this.tabLocks.forEach(function(instanceId, tabId) {
      tabLocksArray.push([tabId, instanceId]);
    });

    var waitQueuesArray = [];
    this.waitQueues.forEach(function(queue, tabId) {
      var serializedQueue = queue.map(function(item) {
        return {
          instanceId: item.instanceId,
          timestamp: item.timestamp
        };
      });
      waitQueuesArray.push([tabId, serializedQueue]);
    });

    return {
      instances: instancesArray,
      tabLocks: tabLocksArray,
      waitQueues: waitQueuesArray
    };
  };

  MultiInstanceManager.prototype.getPortsToScan = function() {
    if (this.dynamicPorts && this.dynamicPorts.size > 0) {
      var ports = Array.from(this.dynamicPorts).sort();
      var maxPort = ports[ports.length - 1];
      if (typeof maxPort === 'number' && maxPort < this.PORT_END) {
        ports.push(maxPort + 1);
      }
      return ports;
    }

    var defaultPorts = [];
    for (var port = this.PORT_START; port <= this.PORT_END; port++) {
      defaultPorts.push(port);
    }
    return defaultPorts;
  };

  MultiInstanceManager.prototype.trackPortFailure = function(port, err) {
    var existing = this.portFailures.get(port) || {
      failCount: 0,
      nextRetryDelay: this.RECONNECT_DELAY
    };

    var failCount = existing.failCount + 1;
    var backoff = Math.min(
      this.RECONNECT_DELAY * Math.pow(2, failCount - 1),
      this.MAX_FAILURE_BACKOFF
    );

    this.portFailures.set(port, {
      failCount: failCount,
      lastAttempt: Date.now(),
      nextRetryDelay: backoff,
      lastError: err && err.message ? err.message : null
    });

    if (failCount === 1) {
      warn('Port ' + port + ' not accepting connections yet');
    }
  };

  MultiInstanceManager.prototype.requestPortList = function(ws) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      ws.send(JSON.stringify({ type: 'portListRequest' }));
    } catch (err) {
      warn('Failed to request port list:', err);
    }
  };

  // Add cleanup method
  MultiInstanceManager.prototype.cleanup = function() {
    log('Cleaning up multi-instance manager...');
    // Close all WebSocket connections
    var self = this;
    this.instances.forEach(function(instance, id) {
      if (instance.ws.readyState === WebSocket.OPEN) {
        instance.ws.close();
      }
      if (instance.portListTimer) {
        clearInterval(instance.portListTimer);
      }
    });
    this.instances.clear();
    this.socketToInstance.clear();
    this.tabLocks.clear();
    this.waitQueues.clear();
    this.dynamicPorts = null;
  };

  // Add method to handle new connections
  MultiInstanceManager.prototype.handleNewConnection = function(port) {
    log('Handling new connection from port:', port.name);
    // Implementation for handling chrome.runtime.connect ports
  };

  // Add method to handle instance messages
  MultiInstanceManager.prototype.handleInstanceMessage = function(instanceId, message) {
    var instance = this.instances.get(instanceId);
    if (!instance || instance.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    if (!message || typeof message !== 'object') {
      warn('Received malformed message from instance ' + instanceId);
      return false;
    }

    // Heartbeat / ping handling
    if (message.type === 'ping' && message.id) {
      instance.ws.send(JSON.stringify({
        id: message.id,
        type: 'pong',
        timestamp: Date.now()
      }));
      return true;
    }

    var handlerKey = message.type;
    var payload = message.payload || {};

    if (!this.messageHandlers || !this.messageHandlers.has(handlerKey)) {
      switch (handlerKey) {
        case 'browser_navigate':
          handlerKey = 'navigate';
          payload = {
            action: 'goto',
            url: payload.url,
            tabId: payload.tabId
          };
          break;
        case 'browser_go_back':
          handlerKey = 'navigate';
          payload = { action: 'back', tabId: payload.tabId };
          break;
        case 'browser_go_forward':
          handlerKey = 'navigate';
          payload = { action: 'forward', tabId: payload.tabId };
          break;
        case 'browser_refresh':
          handlerKey = 'navigate';
          payload = { action: 'refresh', tabId: payload.tabId };
          break;
        case 'browser_tab':
          handlerKey = 'tabs.' + (payload && payload.action ? payload.action : 'list');
          break;
        case 'snapshot.accessibility':
          // Keep the same handler key - it's registered in messageHandlers
          handlerKey = 'snapshot.accessibility';
          break;
        case 'js.execute':
          handlerKey = 'js.execute';
          break;
        case 'dom.click':
        case 'dom.hover':
        case 'dom.type':
        case 'dom.select':
        case 'dom.expand':
        case 'dom.query':
        case 'keyboard.press':
        case 'browser_press_key':
        case 'page.wait':
        case 'browser_wait':
        case 'console.get':
        case 'snapshot.query':
        case 'debugger.attach':
        case 'debugger.detach':
        case 'debugger.getData':
        case 'browser_screenshot':
        case 'screenshot.capture':
        case 'browser_click_popup':
          // All these handlers are registered with same name
          handlerKey = message.type;
          break;
      }
    }

    var handler = this.messageHandlers && this.messageHandlers.get(handlerKey);
    if (!handler) {
      warn('No handler for message type ' + message.type + ' from instance ' + instanceId);
      console.log('[DEBUG] Looking for handler key:', handlerKey);
      console.log('[DEBUG] Available handlers:', this.messageHandlers ? Array.from(this.messageHandlers.keys()) : 'No handlers');
      console.log('[DEBUG] Original message type:', message.type);
      if (message.id) {
        instance.ws.send(JSON.stringify({
          id: message.id,
          error: 'Unknown message type: ' + message.type
        }));
      }
      return false;
    }

    instance.lastActivity = Date.now();

    try {
      Promise.resolve(handler(payload, instanceId))
        .then(function(result) {
          if (message.id) {
            instance.ws.send(JSON.stringify({
              id: message.id,
              type: message.type,
              payload: result || {}
            }));
          }
        })
        .catch(function(err) {
          error('Handler error for instance ' + instanceId + ' message ' + message.type + ':', err);
          if (message.id) {
            instance.ws.send(JSON.stringify({
              id: message.id,
              error: err && err.message ? err.message : String(err)
            }));
          }
        });
    } catch (err) {
      error('Synchronous handler error for instance ' + instanceId + ':', err);
      if (message.id) {
        instance.ws.send(JSON.stringify({
          id: message.id,
          error: err && err.message ? err.message : String(err)
        }));
      }
      return false;
    }

    return true;
  };

  // Export to global scope for use in background.js
  self.MultiInstanceManager = MultiInstanceManager;

  log('Multi-instance manager script loaded');
})();
