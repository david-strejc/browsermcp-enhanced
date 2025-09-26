// Multi-Instance Background Controller
// Handles multiple Claude Desktop connections simultaneously
// Note: multi-instance-manager.js must be imported in background.js before this file

(() => {
  const TAG = '[BG-Multi]';
  const log = (...args) => console.log(TAG, new Date().toISOString(), ...args);
  const warn = (...args) => console.warn(TAG, new Date().toISOString(), ...args);
  const error = (...args) => console.error(TAG, new Date().toISOString(), ...args);

  // Global variables for this mode
  let multiInstanceManager = null;
  let activeTabId = null;
  let messageHandlers = new Map();

  // Configuration
  let extensionConfig = {
    unsafeMode: false,
    multiInstance: true
  };

  // Store listener references so we can remove them later
  const listeners = {
    onMessage: null,
    onConnect: null,
    onInstalled: null,
    onTabsRemoved: null,
    onTabsActivated: null
  };

  /**
   * Initialize multi-instance manager
   */
  function initializeMultiInstance() {
    log('Initializing multi-instance manager...');
    multiInstanceManager = new self.MultiInstanceManager();

    // Setup message handlers BEFORE assigning them to manager
    setupMessageHandlers();

    // Make message handlers available to the manager
    multiInstanceManager.messageHandlers = messageHandlers;

    log('Multi-instance manager initialized successfully');
  }

  /**
   * Setup message handlers for browser operations
   */
  function setupMessageHandlers() {
    function handleRuntimeError(reject) {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return true;
      }
      return false;
    }

    function normalizeTabId(rawTabId) {
      if (typeof rawTabId === 'number') {
        return rawTabId;
      }
      if (typeof rawTabId === 'string' && rawTabId.length) {
        var parsed = parseInt(rawTabId, 10);
        if (!isNaN(parsed)) {
          return parsed;
        }
      }
      return null;
    }

    function ensureActiveTab(url) {
      return new Promise(function(resolve, reject) {
        if (typeof activeTabId === 'number') {
          resolve(activeTabId);
          return;
        }

        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
          if (handleRuntimeError(reject)) {
            return;
          }

          if (tabs && tabs.length > 0) {
            activeTabId = tabs[0].id;
            resolve(activeTabId);
            return;
          }

          chrome.tabs.create({ url: url || 'about:blank', active: true }, function(tab) {
            if (handleRuntimeError(reject)) {
              return;
            }
            if (tab && typeof tab.id === 'number') {
              activeTabId = tab.id;
              resolve(activeTabId);
            } else {
              reject(new Error('Failed to create tab for navigation'));
            }
          });
        });
      });
    }

    function waitForTabComplete(tabId) {
      return new Promise(function(resolve) {
        var timeout = setTimeout(function() {
          chrome.tabs.onUpdated.removeListener(checkComplete);
          resolve();
        }, 15000);

        function done() {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(checkComplete);
          resolve();
        }

        function checkComplete(updatedTabId, changeInfo) {
          if (updatedTabId === tabId && changeInfo && changeInfo.status === 'complete') {
            done();
          }
        }

        chrome.tabs.get(tabId, function(tab) {
          if (chrome.runtime.lastError) {
            done();
            return;
          }
          if (tab && tab.status === 'complete') {
            done();
            return;
          }
          chrome.tabs.onUpdated.addListener(checkComplete);
        });
      });
    }

    function detectPopupsInTab(tabId) {
      return new Promise(function(resolve) {
        try {
          chrome.tabs.sendMessage(tabId, { type: 'detectPopups' }, function(response) {
            if (chrome.runtime.lastError) {
              resolve({ popupsDetected: false, popups: [] });
              return;
            }
            resolve(response || { popupsDetected: false, popups: [] });
          });
        } catch (sendErr) {
          resolve({ popupsDetected: false, popups: [] });
        }
      });
    }

    messageHandlers.set('tabs.list', function () {
      return new Promise(function (resolve, reject) {
        chrome.tabs.query({}, function (tabs) {
          if (handleRuntimeError(reject)) {
            return;
          }
          var serialized = tabs.map(function (tab) {
            return {
              id: tab.id,
              windowId: tab.windowId,
              url: tab.url,
              title: tab.title,
              active: tab.active,
              status: tab.status
            };
          });
          resolve({ tabs: serialized });
        });
      });
    });

    messageHandlers.set('tabs.select', function (payload) {
      var tabId = normalizeTabId(payload && payload.tabId);
      if (tabId === null) {
        return Promise.reject(new Error('tabs.select requires a valid tabId'));
      }
      return new Promise(function (resolve, reject) {
        chrome.tabs.update(tabId, { active: true }, function (tab) {
          if (handleRuntimeError(reject)) {
            return;
          }
          activeTabId = tab && tab.id ? tab.id : tabId;
          resolve({ success: true, tabId: activeTabId });
        });
      });
    });

    messageHandlers.set('tabs.new', function (payload) {
      var createOptions = { url: (payload && payload.url) || 'about:blank', active: true };
      if (payload && payload.windowId) {
        createOptions.windowId = payload.windowId;
      }
      return new Promise(function (resolve, reject) {
        chrome.tabs.create(createOptions, function (tab) {
          if (handleRuntimeError(reject)) {
            return;
          }
          activeTabId = tab && tab.id ? tab.id : null;
          resolve({ success: true, tabId: activeTabId });
        });
      });
    });

    messageHandlers.set('tabs.close', function (payload) {
      var tabId = normalizeTabId(payload && payload.tabId);
      if (tabId === null) {
        return Promise.reject(new Error('tabs.close requires a valid tabId'));
      }
      return new Promise(function (resolve, reject) {
        chrome.tabs.remove(tabId, function () {
          if (handleRuntimeError(reject)) {
            return;
          }
          if (activeTabId === tabId) {
            activeTabId = null;
          }
          resolve({ success: true });
        });
      });
    });

    messageHandlers.set('status', function () {
      if (!multiInstanceManager) {
        return Promise.resolve({
          instances: [],
          tabLocks: [],
          waitQueues: []
        });
      }
      return Promise.resolve(multiInstanceManager.getStatus());
    });

    // Backwards compatibility with legacy popup queries
    messageHandlers.set('getStatus', function () {
      return messageHandlers.get('status')();
    });

    messageHandlers.set('connect', function (payload) {
      var requestedTabId = normalizeTabId(payload && payload.tabId);
      if (requestedTabId !== null) {
        activeTabId = requestedTabId;
      }

      // No explicit action needed: multi-instance connections are persistent
      var hasConnections = !!(multiInstanceManager && multiInstanceManager.getStatus().instances.some(function (inst) {
        return inst.connected;
      }));

      return Promise.resolve({
        success: hasConnections
      });
    });

    messageHandlers.set('browser_navigate', function (payload) {
      var targetUrl = payload && payload.url;
      var detectPopups = !payload || payload.detectPopups !== false;

      if (!targetUrl) {
        return Promise.reject(new Error('browser_navigate requires a url'));
      }

      return ensureActiveTab(targetUrl).then(function(tabId) {
        return new Promise(function(resolve, reject) {
          chrome.tabs.update(tabId, { url: targetUrl, active: true }, function(tab) {
            if (handleRuntimeError(reject)) {
              return;
            }

            var updatedTabId = tab && typeof tab.id === 'number' ? tab.id : tabId;
            activeTabId = updatedTabId;

            waitForTabComplete(updatedTabId).then(function() {
              if (detectPopups) {
                detectPopupsInTab(updatedTabId).then(function(result) {
                  resolve(result || {});
                }).catch(function(err) {
                  warn('Popup detection failed:', err);
                  resolve({});
                });
              } else {
                resolve({});
              }
            }).catch(function(err) {
              warn('waitForTabComplete error:', err);
              resolve({});
            });
          });
        });
      });
    });

    messageHandlers.set('browser_go_back', function () {
      return ensureActiveTab().then(function(tabId) {
        return new Promise(function(resolve, reject) {
          chrome.tabs.goBack(tabId, function () {
            if (handleRuntimeError(reject)) {
              return;
            }
            waitForTabComplete(tabId).then(function() {
              resolve({});
            }).catch(function() {
              resolve({});
            });
          });
        });
      });
    });

    messageHandlers.set('browser_go_forward', function () {
      return ensureActiveTab().then(function(tabId) {
        return new Promise(function(resolve, reject) {
          chrome.tabs.goForward(tabId, function () {
            if (handleRuntimeError(reject)) {
              return;
            }
            waitForTabComplete(tabId).then(function() {
              resolve({});
            }).catch(function() {
              resolve({});
            });
          });
        });
      });
    });

    messageHandlers.set('browser_refresh', function () {
      return ensureActiveTab().then(function(tabId) {
        return new Promise(function(resolve, reject) {
          chrome.tabs.reload(tabId, {}, function () {
            if (handleRuntimeError(reject)) {
              return;
            }
            waitForTabComplete(tabId).then(function() {
              resolve({ success: true });
            }).catch(function() {
              resolve({ success: true });
            });
          });
        });
      });
    });

    messageHandlers.set('navigate', function (payload) {
      var action = payload && payload.action;
      var targetTabId = normalizeTabId(payload && payload.tabId);
      if (targetTabId === null) {
        targetTabId = activeTabId;
      }
      if (targetTabId === null) {
        return Promise.reject(new Error('navigate requires an active tab'));
      }
      return new Promise(function (resolve, reject) {
        function done() {
          if (handleRuntimeError(reject)) {
            return;
          }
          resolve({ success: true });
        }
        if (action === 'goto') {
          if (!payload || !payload.url) {
            reject(new Error('navigate.goto requires a url'));
            return;
          }
          chrome.tabs.update(targetTabId, { url: payload.url }, done);
          return;
        }
        if (action === 'back') {
          chrome.tabs.goBack(targetTabId, done);
          return;
        }
        if (action === 'forward') {
          chrome.tabs.goForward(targetTabId, done);
          return;
        }
        if (action === 'refresh') {
          chrome.tabs.reload(targetTabId, {}, done);
          return;
        }
        reject(new Error('navigate action not supported: ' + action));
      });
    });

    messageHandlers.set('screenshot', function (payload) {
      var targetTabId = normalizeTabId(payload && payload.tabId);
      var format = (payload && payload.format) || 'png';
      var quality = typeof payload !== 'undefined' && typeof payload.quality === 'number' ? payload.quality : 100;
      if (targetTabId === null) {
        targetTabId = activeTabId;
      }
      if (targetTabId === null) {
        return Promise.reject(new Error('screenshot requires an active tab'));
      }
      return new Promise(function (resolve, reject) {
        chrome.tabs.get(targetTabId, function (tab) {
          if (handleRuntimeError(reject)) {
            return;
          }
          if (!tab) {
            reject(new Error('Unable to locate tab ' + targetTabId));
            return;
          }
          var windowId = tab.windowId;
          function captureVisible() {
            var options = { format: format };
            if (format === 'jpeg') {
              options.quality = Math.max(0, Math.min(quality, 100));
            }
            chrome.tabs.captureVisibleTab(windowId, options, function (dataUrl) {
              if (handleRuntimeError(reject)) {
                return;
              }
              resolve({ dataUrl: dataUrl });
            });
          }
          if (tab.active) {
            captureVisible();
          } else {
            chrome.tabs.update(targetTabId, { active: true }, function () {
              if (handleRuntimeError(reject)) {
                return;
              }
              activeTabId = targetTabId;
              captureVisible();
            });
          }
        });
      });
    });

    log('Message handlers configured');
  }

  /**
   * Event listeners
   */
  listeners.onMessage = function(message, sender, sendResponse) {
    log('Received message:', message.type || message);

    // Handle messages through multi-instance manager if available
    if (multiInstanceManager && message.instanceId) {
      var sent = multiInstanceManager.sendToInstance(message.instanceId, message);
      if (!sent) {
        sendResponse({ error: 'Instance not connected' });
        return false;
      }
      sendResponse({ success: true });
      return false;
    }

    // Handle directly if no instance specified
    if (message.type && messageHandlers.has(message.type)) {
      var handler = messageHandlers.get(message.type);
      handler(message.payload || {}).then(function(result) {
        sendResponse(result);
      }).catch(function(err) {
        error('Message handler error:', err);
        sendResponse({ error: err.message });
      });
      return true; // Keep channel open for async response
    }

    sendResponse({ error: 'Unknown message type' });
    return false;
  };

  listeners.onConnect = (port) => {
    log('New connection on port:', port.name);
    if (multiInstanceManager) {
      multiInstanceManager.handleNewConnection(port);
    }
  };

  listeners.onInstalled = (details) => {
    log('Extension installed/updated:', details);
  };

  listeners.onTabsRemoved = (tabId) => {
    if (tabId === activeTabId) {
      activeTabId = null;
      log('Active tab closed');
    }
    if (multiInstanceManager) {
      multiInstanceManager.releaseTabLock(tabId);
    }
  };

  listeners.onTabsActivated = (activeInfo) => {
    activeTabId = activeInfo.tabId;
    log('Tab activated:', activeTabId);
  };

  /**
   * Initialize function - called when mode is activated
   */
  function init() {
    log('Initializing multi-instance mode...');

    // Update config
    extensionConfig.unsafeMode = self.unsafeMode || false;

    // Initialize manager (which now sets up handlers internally)
    initializeMultiInstance();

    // Register listeners
    chrome.runtime.onMessage.addListener(listeners.onMessage);
    chrome.runtime.onConnect.addListener(listeners.onConnect);
    chrome.runtime.onInstalled.addListener(listeners.onInstalled);
    chrome.tabs.onRemoved.addListener(listeners.onTabsRemoved);
    chrome.tabs.onActivated.addListener(listeners.onTabsActivated);

    log('Multi-instance mode initialized');
  }

  /**
   * Deinitialize function - called when mode is deactivated
   */
  function deinit() {
    log('Deinitializing multi-instance mode...');

    // Remove listeners
    chrome.runtime.onMessage.removeListener(listeners.onMessage);
    chrome.runtime.onConnect.removeListener(listeners.onConnect);
    chrome.runtime.onInstalled.removeListener(listeners.onInstalled);
    chrome.tabs.onRemoved.removeListener(listeners.onTabsRemoved);
    chrome.tabs.onActivated.removeListener(listeners.onTabsActivated);

    // Cleanup manager
    if (multiInstanceManager) {
      multiInstanceManager.cleanup();
      multiInstanceManager = null;
    }

    // Clear handlers
    messageHandlers.clear();

    log('Multi-instance mode deinitialized');
  }

  /**
   * Handle unsafe mode changes
   */
  function onUnsafeModeChanged(enabled) {
    extensionConfig.unsafeMode = enabled;
    log('Unsafe mode changed:', enabled);
  }

  // Export controller interface
  self.MultiInstanceMode = {
    init,
    deinit,
    onUnsafeModeChanged
  };
})();
