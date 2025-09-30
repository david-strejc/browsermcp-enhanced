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

  // SECURITY: Allowlist for MAIN world code execution
  // Only these patterns are permitted when unsafe mode is enabled
  const MAIN_WORLD_SAFE_PATTERNS = [
    /^window\.location\.href$/,
    /^window\.location\.\w+$/,
    /^document\.title$/,
    /^document\.readyState$/,
    /^document\.URL$/,
    /^navigator\.userAgent$/,
    /^document\.querySelector\(['"][^'"]*['"]\)$/,
    /^document\.querySelectorAll\(['"][^'"]*['"]\)$/,
    /^document\.getElementById\(['"][^'"]*['"]\)$/
  ];

  // Validate code for MAIN world execution
  function validateMainWorldCode(code) {
    if (!code || typeof code !== 'string') {
      return false;
    }

    var trimmed = code.trim();

    // Check against safe patterns
    for (var i = 0; i < MAIN_WORLD_SAFE_PATTERNS.length; i++) {
      if (MAIN_WORLD_SAFE_PATTERNS[i].test(trimmed)) {
        return true;
      }
    }

    // Reject by default
    warn('Rejected MAIN world code execution:', trimmed);
    return false;
  }

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

    // IMPORTANT: Re-assign after ALL handlers are added (including missing ones)
    // The addMissingHandlersToMultiInstance() is called at END of setupMessageHandlers
    // so we need to reassign after that completes
    multiInstanceManager.messageHandlers = messageHandlers;

    log('Multi-instance manager initialized successfully');
    log('Total handlers registered:', messageHandlers.size);
    log('Manager has handlers Map:', multiInstanceManager.messageHandlers ? 'YES' : 'NO');
    log('Manager handlers size:', multiInstanceManager.messageHandlers ? multiInstanceManager.messageHandlers.size : 0);

    // List some key handlers to verify
    var keyHandlers = ['snapshot.accessibility', 'js.execute', 'dom.click'];
    keyHandlers.forEach(function(key) {
      log('Handler "' + key + '" exists:', messageHandlers.has(key) ? 'YES' : 'NO');
    });
  }

  // Helper functions at module level so they can be accessed from all handlers
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

  // Get the active tab for a specific instance
  function getInstanceActiveTab(instanceId) {
    if (!multiInstanceManager || !instanceId) return activeTabId; // Fallback to global
    var instance = multiInstanceManager.instances.get(instanceId);
    return instance ? instance.activeTabId : activeTabId;
  }

  // Set the active tab for a specific instance
  function setInstanceActiveTab(instanceId, tabId) {
    if (!multiInstanceManager || !instanceId) {
      activeTabId = tabId; // Fallback to global
      return;
    }
    var instance = multiInstanceManager.instances.get(instanceId);
    if (instance) {
      instance.activeTabId = tabId;
      instance.tabs.add(tabId);
    }
    // Always reflect the most recent tab interaction globally so legacy helpers stay in sync
    activeTabId = tabId;
  }

  /************************************************************
   *  ────────────────────────────────────────────────────────
   *  Helper utilities for robust tab isolation
   *  ────────────────────────────────────────────────────────
   ************************************************************/

  /**
   * Returns the instance object, creating an empty shell if needed.
   */
  function getOrCreateInstance(instanceId) {
    if (!multiInstanceManager.instances.has(instanceId)) {
      multiInstanceManager.instances.set(instanceId, {
        ws: null,
        port: null,
        activeTabId: undefined,
        tabs: new Set()
      });
    }
    return multiInstanceManager.instances.get(instanceId);
  }

  /**
   * Records that a tab is owned by – and the active tab of – an instance.
   */
  function markTabForInstance(tabId, instanceId) {
    var inst = getOrCreateInstance(instanceId);
    inst.activeTabId = tabId;
    inst.tabs.add(tabId);
    setInstanceActiveTab(instanceId, tabId);            // existing helper
  }

  /**
   * Predicate: does instanceId still own tabId?
   */
  function instanceOwnsTab(instanceId, tabId) {
    var inst = multiInstanceManager.instances.get(instanceId);
    return !!(inst && inst.tabs.has(tabId));
  }

  /**
   * Clean up tabs when an instance disconnects
   * CRITICAL FIX: Synchronize tab closure with lock release to prevent races
   */
  function cleanupInstanceTabs(instanceId) {
    var inst = multiInstanceManager.instances.get(instanceId);
    if (!inst) return;

    var tabIds = Array.from(inst.tabs);
    var tabsToClose = [];

    // Phase 1: Collect tabs and verify they exist
    tabIds.forEach(function(tabId) {
      chrome.tabs.get(tabId, function(tab) {
        if (!chrome.runtime.lastError && tab) {
          tabsToClose.push(tabId);
        } else {
          // Tab already gone, just release the lock
          log('Tab ' + tabId + ' already closed, releasing lock only');
          multiInstanceManager.releaseTabLock(tabId, instanceId);
        }
      });
    });

    // Phase 2: Close all tabs synchronously (queued operations)
    // This ensures tabs are fully processed before locks are released
    var closePromises = tabsToClose.map(function(tabId) {
      return new Promise(function(resolve) {
        chrome.tabs.remove(tabId, function() {
          if (chrome.runtime.lastError) {
            log('Tab ' + tabId + ' close error:', chrome.runtime.lastError.message);
          }
          // CRITICAL: Release lock AFTER tab removal completes
          multiInstanceManager.releaseTabLock(tabId, instanceId);
          log('Tab ' + tabId + ' closed and lock released for instance ' + instanceId);
          resolve();
        });
      });
    });

    // Phase 3: Wait for all closures to complete before clearing instance data
    Promise.all(closePromises).then(function() {
      inst.tabs.clear();
      inst.activeTabId = null;
      log('Instance ' + instanceId + ' tab cleanup complete');
    }).catch(function(err) {
      error('Tab cleanup error for instance ' + instanceId + ':', err);
      // Even on error, clear instance data to prevent leaks
      inst.tabs.clear();
      inst.activeTabId = null;
    });
  }

  /************************************************************
   *  ────────────────────────────────────────────────────────
   *  ensureActiveTab (COMPLETELY REWRITTEN for tab isolation)
   *  ────────────────────────────────────────────────────────
   ************************************************************/
  function ensureActiveTab(targetUrl, instanceId) {
    return new Promise(function(resolve, reject) {
      var instance = getOrCreateInstance(instanceId);
      var existingId = instance.activeTabId;

      /**
       * Actually create a brand-new tab and lock it.
       */
      function createFreshTab() {
        chrome.tabs.create(
          { url: targetUrl || 'about:blank', active: true },
          function(tab) {
            if (chrome.runtime.lastError || !tab) {
              reject(
                chrome.runtime.lastError ||
                  new Error('Unable to create new tab for instance ' + instanceId)
              );
              return;
            }
            // Acquire lock for the new tab
            multiInstanceManager.acquireTabLock(tab.id, instanceId)
              .then(function() {
                markTabForInstance(tab.id, instanceId);
                log('Created new tab ' + tab.id + ' for instance ' + instanceId);
                resolve(tab.id);
              })
              .catch(function(err) {
                // Failed to acquire lock - shouldn't happen for new tab
                reject(err);
              });
          }
        );
      }

      /* ----------------------------------------------------
       * 1️⃣  If the instance already tracks a tab, reuse it
       *     only if  (a)  the tab still exists
       *     AND     (b)  the lock can be (re)acquired.
       * -------------------------------------------------- */
      if (typeof existingId === 'number' && instanceOwnsTab(instanceId, existingId)) {
        chrome.tabs.get(existingId, function(tabObj) {
          if (chrome.runtime.lastError || !tabObj) {
            // Tab vanished – fall through to fresh creation
            log('Previous tab ' + existingId + ' no longer exists, creating new one');
            return createFreshTab();
          }

          // Try to acquire lock for existing tab
          multiInstanceManager.acquireTabLock(existingId, instanceId)
            .then(function() {
              // Lock OK → safe to reuse
              markTabForInstance(existingId, instanceId);
              log('Reusing existing tab ' + existingId + ' for instance ' + instanceId);
              resolve(existingId);
            })
            .catch(function() {
              // Someone else owns lock → isolate the instance with a new tab
              log('Tab ' + existingId + ' locked by another instance, creating new one');
              createFreshTab();
            });
        });
        return; // Important – don't run the code below.
      }

      /* ----------------------------------------------------
       * 2️⃣  No usable tab -> always create a new one
       * -------------------------------------------------- */
      log('No existing tab for instance ' + instanceId + ', creating new one');
      createFreshTab();
    });
  }

  /**
   * Setup message handlers for browser operations
   */
  function setupMessageHandlers() {

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

    function resolveTabByIndex(index, windowId) {
      return new Promise(function(resolve, reject) {
        chrome.tabs.query(windowId ? { windowId: windowId } : {}, function(tabs) {
          if (handleRuntimeError(reject)) {
            return;
          }
          var target = tabs.find(function(tab) {
            return tab.index === index && (typeof windowId !== 'number' || tab.windowId === windowId);
          });
          if (target) {
            resolve(target);
          } else {
            reject(new Error('No tab found at index ' + index));
          }
        });
      });
    }

    function getTabById(tabId) {
      return new Promise(function(resolve, reject) {
        chrome.tabs.get(tabId, function(tab) {
          if (handleRuntimeError(reject)) {
            return;
          }
          resolve(tab);
        });
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
              index: tab.index,
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

    messageHandlers.set('tabs.select', function (payload, instanceId) {
      var explicitTabId = normalizeTabId(payload && payload.tabId);
      var index = typeof payload !== 'undefined' && typeof payload.index === 'number' ? payload.index : null;
      var windowId = payload && typeof payload.windowId === 'number' ? payload.windowId : undefined;

      var tabPromise;
      if (explicitTabId !== null) {
        tabPromise = getTabById(explicitTabId).then(function(tab) {
          return { tabId: explicitTabId, tab: tab };
        });
      } else if (index !== null) {
        tabPromise = resolveTabByIndex(index, windowId).then(function(tab) {
          return { tabId: tab.id, tab: tab };
        });
      } else {
        return Promise.reject(new Error('tabs.select requires a valid tabId or index'));
      }

      return tabPromise.then(function(result) {
        var tabId = result.tabId;

        var ensureLock = Promise.resolve();
        if (instanceId && multiInstanceManager) {
          ensureLock = multiInstanceManager.acquireTabLock(tabId, instanceId);
        }

        return ensureLock.then(function() {
          return new Promise(function(resolve, reject) {
            chrome.tabs.update(tabId, { active: true }, function(tab) {
              if (handleRuntimeError(reject)) {
                return;
              }
              var selectedTabId = tab && tab.id ? tab.id : tabId;
              setInstanceActiveTab(instanceId, selectedTabId);
              resolve({
                success: true,
                tabId: selectedTabId,
                index: tab && typeof tab.index === 'number' ? tab.index : index
              });
            });
          });
        });
      });
    });

    messageHandlers.set('tabs.new', function (payload, instanceId) {
      var createOptions = { url: (payload && payload.url) || 'about:blank', active: true };
      if (payload && payload.windowId) {
        createOptions.windowId = payload.windowId;
      }
      return new Promise(function (resolve, reject) {
        chrome.tabs.create(createOptions, function (tab) {
          if (handleRuntimeError(reject)) {
            return;
          }
          if (!tab || typeof tab.id !== 'number') {
            reject(new Error('Failed to create tab'));
            return;
          }

          var newTabId = tab.id;
          var finalize = function() {
            setInstanceActiveTab(instanceId, newTabId);
            resolve({ success: true, tabId: newTabId, index: tab.index });
          };

          if (instanceId && multiInstanceManager) {
            multiInstanceManager.acquireTabLock(newTabId, instanceId)
              .then(function() {
                finalize();
              })
              .catch(reject);
          } else {
            finalize();
          }
        });
      });
    });

    messageHandlers.set('tabs.close', function (payload, instanceId) {
      var explicitTabId = normalizeTabId(payload && payload.tabId);
      var index = typeof payload !== 'undefined' && typeof payload.index === 'number' ? payload.index : null;
      var windowId = payload && typeof payload.windowId === 'number' ? payload.windowId : undefined;

      var tabPromise;
      if (explicitTabId !== null) {
        tabPromise = Promise.resolve(explicitTabId);
      } else if (index !== null) {
        tabPromise = resolveTabByIndex(index, windowId).then(function(tab) {
          return tab.id;
        });
      } else if (instanceId) {
        tabPromise = ensureActiveTab(null, instanceId);
      } else {
        tabPromise = Promise.reject(new Error('tabs.close requires a valid tabId or index'));
      }

      return tabPromise.then(function(tabId) {
        return new Promise(function(resolve, reject) {
          chrome.tabs.remove(tabId, function () {
            if (handleRuntimeError(reject)) {
              return;
            }
            if (activeTabId === tabId) {
              activeTabId = null;
            }

            if (multiInstanceManager) {
              multiInstanceManager.instances.forEach(function(instance) {
                if (instance.tabs && instance.tabs.has(tabId)) {
                  instance.tabs.delete(tabId);
                  if (instance.activeTabId === tabId) {
                    instance.activeTabId = null;
                  }
                }
              });

              var ownerId = multiInstanceManager.tabLocks.get(tabId);
              multiInstanceManager.releaseTabLock(tabId, ownerId);
            }

            resolve({ success: true });
          });
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

    /************************************************************
     *  ────────────────────────────────────────────────────────
     *  browser_navigate message handler (with tab locking)
     *  ────────────────────────────────────────────────────────
     ************************************************************/
    messageHandlers.set('browser_navigate', function (payload, instanceId) {
      var targetUrl = payload && payload.url;
      var detectPopups = !payload || payload.detectPopups !== false;
      var snapshot = !payload || payload.snapshot !== false; // Default to true

      if (!targetUrl) {
        return Promise.reject(new Error('browser_navigate requires a url'));
      }

      return ensureActiveTab(targetUrl, instanceId).then(function(tabId) {
        // Double-check we have the lock (defensive programming)
        return multiInstanceManager.acquireTabLock(tabId, instanceId).then(function() {
          return new Promise(function(resolve, reject) {
            chrome.tabs.update(tabId, { url: targetUrl, active: true }, function(tab) {
              if (handleRuntimeError(reject)) {
                return;
              }

              var updatedTabId = tab && typeof tab.id === 'number' ? tab.id : tabId;
              markTabForInstance(updatedTabId, instanceId);

              waitForTabComplete(updatedTabId).then(function() {
                var result = {};

                // First detect popups if enabled
                var popupPromise = detectPopups ?
                  detectPopupsInTab(updatedTabId).catch(function(err) {
                    warn('Popup detection failed:', err);
                    return {};
                  }) : Promise.resolve({});

                popupPromise.then(function(popupResult) {
                  // Then get scaffold snapshot if requested (default)
                  if (snapshot) {
                    var snapshotHandler = messageHandlers.get('snapshot.accessibility');
                    if (snapshotHandler) {
                      return snapshotHandler({ mode: 'scaffold' }, instanceId);
                    }
                    return {};
                  }
                  return {};
                }).then(function(snapshotResult) {
                  // Combine results
                  Object.assign(result, popupResult || {});
                  if (snapshotResult && snapshotResult.snapshot) {
                    result.snapshot = snapshotResult.snapshot;
                  }
                  // Add debug info to response
                  result._debug = {
                    instanceId: instanceId,
                    tabId: updatedTabId,
                    timestamp: new Date().toISOString()
                  };
                  log('Navigation complete for instance ' + instanceId + ' on tab ' + updatedTabId);
                  resolve(result);
                }).catch(function(err) {
                  warn('Navigation completion error:', err);
                  resolve(result);
                });
              }).catch(function(err) {
                warn('waitForTabComplete error:', err);
                resolve({});
              });
            });
          });
        }).catch(function(lockErr) {
          // Could not secure the tab → fallback to a new dedicated tab
          log('Failed to acquire lock for tab ' + tabId + ', creating new tab');
          return new Promise(function(resolve, reject) {
            chrome.tabs.create({ url: targetUrl, active: true }, function(newTab) {
              if (chrome.runtime.lastError || !newTab) {
                reject(
                  chrome.runtime.lastError ||
                    new Error('Unable to create fallback tab for navigate')
                );
                return;
              }
              multiInstanceManager.acquireTabLock(newTab.id, instanceId)
                .then(function() {
                  markTabForInstance(newTab.id, instanceId);
                  waitForTabComplete(newTab.id).then(function() {
                    resolve({
                      ok: true,
                      _debug: {
                        instanceId: instanceId,
                        tabId: newTab.id,
                        timestamp: new Date().toISOString(),
                        fallback: true
                      }
                    });
                  });
                })
                .catch(reject);
            });
          });
        });
      });
    });

    messageHandlers.set('browser_go_back', function (payload, instanceId) {
      return ensureActiveTab(null, instanceId).then(function(tabId) {
        return new Promise(function(resolve, reject) {
          chrome.tabs.goBack(tabId, function () {
            if (handleRuntimeError(reject)) {
              return;
            }
            waitForTabComplete(tabId).then(function() {
              setInstanceActiveTab(instanceId, tabId);
              resolve({});
            }).catch(function() {
              setInstanceActiveTab(instanceId, tabId);
              resolve({});
            });
          });
        });
      });
    });

    messageHandlers.set('browser_go_forward', function (payload, instanceId) {
      return ensureActiveTab(null, instanceId).then(function(tabId) {
        return new Promise(function(resolve, reject) {
          chrome.tabs.goForward(tabId, function () {
            if (handleRuntimeError(reject)) {
              return;
            }
            waitForTabComplete(tabId).then(function() {
              setInstanceActiveTab(instanceId, tabId);
              resolve({});
            }).catch(function() {
              setInstanceActiveTab(instanceId, tabId);
              resolve({});
            });
          });
        });
      });
    });

    messageHandlers.set('browser_refresh', function (payload, instanceId) {
      return ensureActiveTab(null, instanceId).then(function(tabId) {
        return new Promise(function(resolve, reject) {
          chrome.tabs.reload(tabId, {}, function () {
            if (handleRuntimeError(reject)) {
              return;
            }
            waitForTabComplete(tabId).then(function() {
              setInstanceActiveTab(instanceId, tabId);
              resolve({ success: true });
            }).catch(function() {
              setInstanceActiveTab(instanceId, tabId);
              resolve({ success: true });
            });
          });
        });
      });
    });

    messageHandlers.set('navigate', function (payload, instanceId) {
      var action = payload && payload.action;
      var targetTabId = normalizeTabId(payload && payload.tabId);
      var tabPromise;
      if (targetTabId !== null) {
        tabPromise = Promise.resolve(targetTabId);
      } else if (instanceId) {
        tabPromise = ensureActiveTab(null, instanceId);
      } else if (activeTabId !== null) {
        tabPromise = Promise.resolve(activeTabId);
      } else {
        tabPromise = Promise.reject(new Error('navigate requires an active tab'));
      }

      return tabPromise.then(function(resolvedTabId) {
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
            chrome.tabs.update(resolvedTabId, { url: payload.url }, done);
            return;
          }
          if (action === 'back') {
            chrome.tabs.goBack(resolvedTabId, done);
            return;
          }
          if (action === 'forward') {
            chrome.tabs.goForward(resolvedTabId, done);
            return;
          }
          if (action === 'refresh') {
            chrome.tabs.reload(resolvedTabId, {}, done);
            return;
          }
          reject(new Error('navigate action not supported: ' + action));
        });
      });
    });

    messageHandlers.set('screenshot', function (payload, instanceId) {
      var targetTabId = normalizeTabId(payload && payload.tabId);
      var format = (payload && payload.format) || 'png';
      var quality = typeof payload !== 'undefined' && typeof payload.quality === 'number' ? payload.quality : 100;

      var tabPromise;
      if (targetTabId !== null) {
        tabPromise = Promise.resolve(targetTabId);
      } else if (instanceId) {
        tabPromise = ensureActiveTab(null, instanceId);
      } else if (activeTabId !== null) {
        tabPromise = Promise.resolve(activeTabId);
      } else {
        tabPromise = Promise.reject(new Error('screenshot requires an active tab'));
      }

      return tabPromise.then(function(resolvedTabId) {
        return new Promise(function (resolve, reject) {
          chrome.tabs.get(resolvedTabId, function (tab) {
            if (handleRuntimeError(reject)) {
              return;
            }
            if (!tab) {
              reject(new Error('Unable to locate tab ' + resolvedTabId));
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
              setInstanceActiveTab(instanceId, resolvedTabId);
              captureVisible();
            } else {
              chrome.tabs.update(resolvedTabId, { active: true }, function () {
                if (handleRuntimeError(reject)) {
                  return;
                }
                setInstanceActiveTab(instanceId, resolvedTabId);
                captureVisible();
              });
            }
          });
        });
      });
    });
    
    // Helper function for captureAccessibilitySnapshot
    function captureAccessibilitySnapshot(options) {
      console.log('[PAGE] captureAccessibilitySnapshot called with options:', options);

      // Initialize or reset element tracker if it grows too large
      if (!window.__elementTracker || window.__elementTracker.size > 500) {
        if (window.__elementTracker && window.__elementTracker.size > 500) {
          console.log('[PAGE] Resetting element tracker (size:', window.__elementTracker.size,
                      ') to prevent memory leak');
        }
        window.__elementTracker = new Map();
        window.__elementIdCounter = 0;
      }

      const elements = [];
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_ELEMENT,
        {
          acceptNode: function(node) {
            const style = window.getComputedStyle(node);
            if (style.display === 'none' || style.visibility === 'hidden') {
              return NodeFilter.FILTER_REJECT;
            }
            if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
          }
        }
      );

      let node;
      while (node = walker.nextNode()) {
        const rect = node.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;

        let ref = node.getAttribute('data-element-ref');
        if (!ref) {
          ref = 'el_' + (++window.__elementIdCounter);
          node.setAttribute('data-element-ref', ref);
          window.__elementTracker.set(ref, node);
        }

        elements.push({
          ref: ref,
          role: node.getAttribute('role') || node.tagName.toLowerCase(),
          name: node.getAttribute('aria-label') || node.textContent.trim().substring(0, 100),
          bounds: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height
          }
        });
      }

      return elements;
    }

    messageHandlers.set('snapshot.accessibility', function(options, instanceId) {
      log('[snapshot.accessibility] Handler called with options:', JSON.stringify(options || {}));

      return ensureActiveTab(null, instanceId).then(function(tabId) {
        setInstanceActiveTab(instanceId, tabId);

        return chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: function() { return typeof window.__elementTracker !== 'undefined'; }
        }).then(function(checkResult) {
          if (!checkResult[0].result) {
            return chrome.scripting.executeScript({
              target: { tabId: tabId },
              files: ['element-tracker.js', 'element-validator.js']
            });
          }
        }).then(function() {
          if (options && options.mode === 'scaffold') {
            return chrome.scripting.executeScript({
              target: { tabId: tabId },
              func: function() { return typeof window.captureEnhancedScaffoldSnapshot !== 'undefined'; }
            }).then(function(checkEnhanced) {
              if (!checkEnhanced[0].result) {
                return chrome.scripting.executeScript({
                  target: { tabId: tabId },
                  files: ['scaffold-enhanced.js']
                });
              }
            }).then(function() {
              return chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: function() { return window.captureEnhancedScaffoldSnapshot(); }
              });
            }).then(function(result) {
              return { snapshot: result[0].result, tabId: tabId };
            });
          }

          if (options && options.level === 'minimal') {
            log('[snapshot.accessibility] Minimal mode detected');

            return chrome.scripting.executeScript({
              target: { tabId: tabId },
              func: function() { return typeof window.__elementTracker !== 'undefined'; }
            }).then(function(checkTracker) {
              if (!checkTracker[0].result) {
                return chrome.scripting.executeScript({
                  target: { tabId: tabId },
                  files: ['element-tracker.js']
                });
              }
            }).then(function() {
              return chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: function() { return typeof window.captureEnhancedMinimalSnapshot !== 'undefined'; }
              });
            }).then(function(checkMinimal) {
              if (!checkMinimal[0].result) {
                return chrome.scripting.executeScript({
                  target: { tabId: tabId },
                  files: ['accessibility-utils.js']
                }).then(function() {
                  return chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    files: ['minimal-enhanced.js']
                  });
                });
              }
            }).then(function() {
              var paginationOptions = {
                page: (options && options.page) || 1,
                perPage: (options && options.perPage) || 25,
                level: 'minimal'
              };
              return chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: function(opts) { return window.captureEnhancedMinimalSnapshot(opts); },
                args: [paginationOptions]
              });
            }).then(function(result) {
              return { snapshot: result[0].result, tabId: tabId };
            });
          }

          log('[snapshot.accessibility] Standard capture mode');
          return chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: captureAccessibilitySnapshot,
            args: [options || {}]
          }).then(function(result) {
            return { snapshot: result[0].result, tabId: tabId };
          });
        });
      });
    });

    messageHandlers.set('dom.click', function(payload, instanceId) {
      var ref = payload && payload.ref;
      if (!ref) {
        return Promise.reject(new Error('dom.click requires a ref'));
      }
      return ensureActiveTab(null, instanceId).then(function(tabId) {
        setInstanceActiveTab(instanceId, tabId);
        return chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: function(ref) {
            var element = window.__elementTracker && window.__elementTracker.get(ref);
            if (element) {
              element.click();
              return true;
            }
            return false;
          },
          args: [ref]
        });
      }).then(function(result) {
        return { success: result[0].result };
      });
    });

    messageHandlers.set('dom.hover', function(payload, instanceId) {
      var ref = payload && payload.ref;
      if (!ref) {
        return Promise.reject(new Error('dom.hover requires a ref'));
      }
      return ensureActiveTab(null, instanceId).then(function(tabId) {
        setInstanceActiveTab(instanceId, tabId);
        return chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: function(ref) {
            var element = window.__elementTracker && window.__elementTracker.get(ref);
            if (element) {
              var event = new MouseEvent('mouseover', {
                view: window,
                bubbles: true,
                cancelable: true
              });
              element.dispatchEvent(event);
              return true;
            }
            return false;
          },
          args: [ref]
        });
      }).then(function(result) {
        return { success: result[0].result };
      });
    });

    messageHandlers.set('dom.type', function(payload, instanceId) {
      var ref = payload && payload.ref;
      var text = payload && payload.text;
      var submit = payload && payload.submit;
      if (!ref) {
        return Promise.reject(new Error('dom.type requires a ref'));
      }
      return ensureActiveTab(null, instanceId).then(function(tabId) {
        setInstanceActiveTab(instanceId, tabId);
        return chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: function(ref, text, submit) {
            var element = window.__elementTracker && window.__elementTracker.get(ref);
            if (element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA')) {
              element.value = text;
              element.dispatchEvent(new Event('input', { bubbles: true }));
              element.dispatchEvent(new Event('change', { bubbles: true }));
              if (submit) {
                var form = element.closest('form');
                if (form) {
                  form.submit();
                }
              }
              return true;
            }
            return false;
          },
          args: [ref, text, submit]
        });
      }).then(function(result) {
        return { success: result[0].result };
      });
    });

    messageHandlers.set('keyboard.press', function(payload, instanceId) {
      var key = payload && payload.key;
      if (!key) {
        return Promise.reject(new Error('keyboard.press requires a key'));
      }
      return ensureActiveTab(null, instanceId).then(function(tabId) {
        setInstanceActiveTab(instanceId, tabId);
        return chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: function(key) {
            document.dispatchEvent(new KeyboardEvent('keydown', {
              key: key,
              bubbles: true,
              cancelable: true
            }));
            document.dispatchEvent(new KeyboardEvent('keyup', {
              key: key,
              bubbles: true,
              cancelable: true
            }));
          },
          args: [key]
        });
      }).then(function() {
        return { success: true };
      });
    });

    messageHandlers.set('browser_press_key', function(payload, instanceId) {
      return messageHandlers.get('keyboard.press')(payload, instanceId);
    });

    messageHandlers.set('page.wait', function(payload) {
      var time = (payload && payload.time) || 1000;
      return new Promise(function(resolve) {
        setTimeout(function() {
          resolve({ success: true });
        }, time);
      });
    });

    messageHandlers.set('browser_wait', function(payload) {
      return messageHandlers.get('page.wait')(payload);
    });

    /**
     * Ensure the MCP page API is injected into the tab
     */
    function ensurePageApi(tabId) {
      return chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: function() {
          return !!window.__mcpApiInstalled;
        }
      }).then(function(result) {
        var hasApi = result && result[0] && result[0].result;

        if (!hasApi) {
          return chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['page-api.js']
          });
        }
        return Promise.resolve();
      });
    }

    // Cache for isolated world contexts (tabId -> executionContextId)
    var isolatedWorldCache = new Map();
    var CDP_VERSION = '1.3';
    var SAFE_WORLD_NAME = 'mcpSafeWorld';

    /**
     * Execute arbitrary user code without CSP violations using chrome.debugger
     * Works on ALL sites including those with strict CSP (Google, iDNES.cz, etc.)
     * @param {number} tabId - Tab ID
     * @param {string} code - User's JavaScript code
     * @param {Array} args - Optional arguments
     * @param {boolean} unsafe - Use MAIN world or ISOLATED world
     * @param {number} timeout - Execution timeout
     */
    function runUserCode(tabId, code, args, unsafe, timeout) {
      args = args || [];
      unsafe = unsafe || false;
      timeout = timeout || 5000;

      // Attach chrome.debugger once
      return chrome.debugger.attach({ tabId: tabId }, CDP_VERSION)
        .then(function() {
          // Get or create execution context
          if (!unsafe) {
            // SAFE mode - Create/use isolated world context
            var cachedContextId = isolatedWorldCache.get(tabId);
            if (cachedContextId) {
              return Promise.resolve(cachedContextId);
            }

            // Get main frame ID first, then create isolated world
            return chrome.debugger.sendCommand(
              { tabId: tabId },
              'Page.getFrameTree'
            ).then(function(frameTree) {
              var mainFrameId = frameTree.frameTree.frame.id;

              return chrome.debugger.sendCommand(
                { tabId: tabId },
                'Page.createIsolatedWorld',
                {
                  frameId: mainFrameId,
                  worldName: SAFE_WORLD_NAME,
                  grantUniversalAccess: true
                }
              );
            }).then(function(response) {
              var contextId = response.executionContextId;
              isolatedWorldCache.set(tabId, contextId);
              return contextId;
            });
          }

          // UNSAFE mode - Use main world (contextId = undefined)
          return Promise.resolve(undefined);
        })
        .then(function(contextId) {
          // Wrap user code in async IIFE so return/await work
          var expression = '(async (..._args) => { ' + code + ' })(...' + JSON.stringify(args) + ')';

          // Evaluate code
          return chrome.debugger.sendCommand(
            { tabId: tabId },
            'Runtime.evaluate',
            {
              expression: expression,
              contextId: contextId,  // undefined = main world, number = isolated world
              awaitPromise: true,
              returnByValue: true,
              includeCommandLineAPI: true
            }
          );
        })
        .then(function(response) {
          // Always detach debugger
          return chrome.debugger.detach({ tabId: tabId })
            .catch(function() {})
            .then(function() {
              if (response.exceptionDetails) {
                throw new Error('User script error: ' + (response.exceptionDetails.text || 'Unknown error'));
              }
              return response.result ? response.result.value : undefined;
            });
        })
        .catch(function(error) {
          // Try to detach on error
          return chrome.debugger.detach({ tabId: tabId })
            .catch(function() {})
            .then(function() {
              throw error;
            });
        });
    }

    // Safe methods allowed in MAIN world (read-only) - for method-based API
    var MAIN_WORLD_SAFE_METHODS = ['getText', 'exists', 'getHTML', 'getOuterHTML'];

    messageHandlers.set('js.execute', function(payload, instanceId) {
      var code = payload && payload.code;
      var method = payload && payload.method;
      var args = payload && payload.args;
      var unsafe = payload && payload.unsafe;
      var timeout = (payload && payload.timeout) || 5000;

      // Two modes: arbitrary code execution OR method-based API
      if (code && typeof code === 'string') {
        // ARBITRARY CODE EXECUTION - Main feature!
        if (unsafe && !extensionConfig.unsafeMode) {
          return Promise.reject(new Error('Unsafe mode not enabled'));
        }

        return ensureActiveTab(null, instanceId).then(function(tabId) {
          setInstanceActiveTab(instanceId, tabId);
          return runUserCode(tabId, code, args, unsafe, timeout);
        }).then(function(value) {
          return { result: value };
        });
      }

      if (method && typeof method === 'string') {
        // METHOD-BASED API - For pre-defined helpers
        if (!Array.isArray(args)) {
          args = args ? [args] : [];
        }

        if (unsafe && !extensionConfig.unsafeMode) {
          return Promise.reject(new Error('Unsafe mode not enabled'));
        }

        // SECURITY: Validate MAIN world method execution
        if (unsafe && MAIN_WORLD_SAFE_METHODS.indexOf(method) === -1) {
          return Promise.reject(new Error(
            'Method "' + method + '" not allowed in MAIN world. ' +
            'Only read-only methods are permitted: ' + MAIN_WORLD_SAFE_METHODS.join(', ')
          ));
        }

        return ensureActiveTab(null, instanceId).then(function(tabId) {
          setInstanceActiveTab(instanceId, tabId);
          return ensurePageApi(tabId).then(function() {
            return chrome.scripting.executeScript({
              target: { tabId: tabId },
              world: unsafe ? 'MAIN' : 'ISOLATED',
              func: function(m, a) {
                if (!window.__mcpApi || typeof window.__mcpApi[m] !== 'function') {
                  throw new Error('API method not found: ' + m);
                }
                return window.__mcpApi[m].apply(window.__mcpApi, a);
              },
              args: [method, args]
            });
          });
        }).then(function(result) {
          return { result: result && result[0] && result[0].result };
        });
      }

      return Promise.reject(new Error('js.execute requires either "code" or "method"'));
    });

    messageHandlers.set('dom.select', function(payload, instanceId) {
      var ref = payload && payload.ref;
      var values = Array.isArray(payload && payload.values) ? payload.values : [];
      if (!ref) {
        return Promise.reject(new Error('dom.select requires a ref'));
      }

      return ensureActiveTab(null, instanceId).then(function(tabId) {
        setInstanceActiveTab(instanceId, tabId);
        return chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: function(ref, values) {
            var element = window.__elementTracker && window.__elementTracker.get(ref);
            if (element && element.tagName === 'SELECT') {
              Array.from(element.options).forEach(function(option) { option.selected = false; });
              values.forEach(function(value) {
                var option = Array.from(element.options).find(function(opt) {
                  return opt.value === value || opt.text === value;
                });
                if (option) {
                  option.selected = true;
                }
              });
              element.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            }
            return false;
          },
          args: [ref, values]
        });
      }).then(function(result) {
        return { success: result[0].result };
      });
    });

    messageHandlers.set('console.get', function(payload, instanceId) {
      return ensureActiveTab(null, instanceId).then(function(tabId) {
        setInstanceActiveTab(instanceId, tabId);
        return chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: function() {
            return window.__consoleLogs || [];
          }
        });
      }).then(function(result) {
        return { logs: result[0].result || [] };
      });
    });

    messageHandlers.set('snapshot.query', function(payload, instanceId) {
      var selector = payload && payload.selector;
      var all = payload && payload.all;
      if (!selector) {
        return Promise.reject(new Error('snapshot.query requires a selector'));
      }
      return ensureActiveTab(null, instanceId).then(function(tabId) {
        setInstanceActiveTab(instanceId, tabId);
        return chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: function(selector, all) {
            var elements = all ? Array.from(document.querySelectorAll(selector)) : [document.querySelector(selector)].filter(Boolean);
            return elements.map(function(el) {
              var rect = el.getBoundingClientRect();
              return {
                tagName: el.tagName,
                text: el.textContent.trim().substring(0, 100),
                bounds: {
                  x: rect.x,
                  y: rect.y,
                  width: rect.width,
                  height: rect.height
                }
              };
            });
          },
          args: [selector, all]
        });
      }).then(function(result) {
        return { elements: result[0].result };
      });
    });

    messageHandlers.set('debugger.attach', function(payload, instanceId) {
      return ensureActiveTab(null, instanceId).then(function(tabId) {
        setInstanceActiveTab(instanceId, tabId);
        return new Promise(function(resolve, reject) {
          chrome.debugger.attach({ tabId: tabId }, "1.3", function() {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            resolve({ success: true });
          });
        });
      });
    });

    messageHandlers.set('debugger.detach', function(payload, instanceId) {
      return ensureActiveTab(null, instanceId).then(function(tabId) {
        setInstanceActiveTab(instanceId, tabId);
        return new Promise(function(resolve, reject) {
          chrome.debugger.detach({ tabId: tabId }, function() {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            resolve({ success: true });
          });
        });
      });
    });

    messageHandlers.set('debugger.getData', function(payload) {
      return Promise.resolve({
        type: payload && payload.type,
        data: [],
        message: 'Debugger data retrieval not fully implemented yet'
      });
    });

    messageHandlers.set('browser_screenshot', function(payload, instanceId) {
      return messageHandlers.get('screenshot')(payload, instanceId);
    });

    messageHandlers.set('dom.expand', function(payload, instanceId) {
      var ref = payload && payload.ref;
      if (!ref) {
        return Promise.reject(new Error('dom.expand requires a ref'));
      }
      return ensureActiveTab(null, instanceId).then(function(tabId) {
        setInstanceActiveTab(instanceId, tabId);
        return chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: function(ref) {
            var element = window.__elementTracker && window.__elementTracker.get(ref);
            if (element) {
              element.click();
              return true;
            }
            return false;
          },
          args: [ref]
        });
      }).then(function(result) {
        return { success: result[0].result };
      });
    });

    messageHandlers.set('dom.query', function(payload, instanceId) {
      var selector = (payload && payload.selector) || '*';
      var limit = (payload && payload.limit) || 20;
      return ensureActiveTab(null, instanceId).then(function(tabId) {
        setInstanceActiveTab(instanceId, tabId);
        return chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: function(selector, limit) {
            var elements = Array.from(document.querySelectorAll(selector)).slice(0, limit);
            return elements.map(function(el) {
              return {
                textContent: el.textContent.trim().substring(0, 200),
                href: el.getAttribute('href'),
                id: el.id,
                className: el.className
              };
            });
          },
          args: [selector, limit]
        });
      }).then(function(result) {
        return { elements: result[0].result };
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
      handler(message.payload || {}, message.instanceId).then(function(result) {
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
      // Clean up from all instances that might own this tab
      multiInstanceManager.instances.forEach(function(instance, instanceId) {
        if (instance.tabs && instance.tabs.has(tabId)) {
          instance.tabs.delete(tabId);
          if (instance.activeTabId === tabId) {
            instance.activeTabId = null;
          }
          log('Removed tab ' + tabId + ' from instance ' + instanceId);
        }
      });
      // Release any locks for this tab
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
