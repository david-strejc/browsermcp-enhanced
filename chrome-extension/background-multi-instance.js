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

    // Add ALL missing handlers from legacy implementation
    log('Before adding missing handlers, total handlers:', messageHandlers.size);
    addMissingHandlersToMultiInstance();
    log('After adding missing handlers, total handlers:', messageHandlers.size);

    log('Message handlers configured');
  }

  /**
   * Add missing handlers from legacy implementation
   */
  function addMissingHandlersToMultiInstance() {
    // Helper function for captureAccessibilitySnapshot
    function captureAccessibilitySnapshot(options) {
      console.log('[PAGE] captureAccessibilitySnapshot called with options:', options);

      if (!window.__elementTracker) {
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

    // snapshot.accessibility handler
    messageHandlers.set('snapshot.accessibility', function(options) {
      log('[snapshot.accessibility] Handler called with options:', JSON.stringify(options || {}));

      return ensureActiveTab().then(function(tabId) {
        activeTabId = tabId;

        // Check if scripts are already injected
        return chrome.scripting.executeScript({
          target: { tabId: activeTabId },
          func: function() { return typeof window.__elementTracker !== 'undefined'; }
        }).then(function(checkResult) {
          // Inject scripts if not present
          if (!checkResult[0].result) {
            return chrome.scripting.executeScript({
              target: { tabId: activeTabId },
              files: ['element-tracker.js', 'element-validator.js']
            });
          }
        }).then(function() {
          // Handle scaffold mode
          if (options && options.mode === 'scaffold') {
            return chrome.scripting.executeScript({
              target: { tabId: activeTabId },
              func: function() { return typeof window.captureEnhancedScaffoldSnapshot !== 'undefined'; }
            }).then(function(checkEnhanced) {
              if (!checkEnhanced[0].result) {
                return chrome.scripting.executeScript({
                  target: { tabId: activeTabId },
                  files: ['scaffold-enhanced.js']
                });
              }
            }).then(function() {
              return chrome.scripting.executeScript({
                target: { tabId: activeTabId },
                func: function() { return window.captureEnhancedScaffoldSnapshot(); }
              });
            }).then(function(result) {
              return { snapshot: result[0].result };
            });
          }

          // Handle minimal mode
          if (options && options.level === 'minimal') {
            log('[snapshot.accessibility] Minimal mode detected');

            return chrome.scripting.executeScript({
              target: { tabId: activeTabId },
              func: function() { return typeof window.__elementTracker !== 'undefined'; }
            }).then(function(checkTracker) {
              if (!checkTracker[0].result) {
                return chrome.scripting.executeScript({
                  target: { tabId: activeTabId },
                  files: ['element-tracker.js']
                });
              }
            }).then(function() {
              return chrome.scripting.executeScript({
                target: { tabId: activeTabId },
                func: function() { return typeof window.captureEnhancedMinimalSnapshot !== 'undefined'; }
              });
            }).then(function(checkMinimal) {
              if (!checkMinimal[0].result) {
                return chrome.scripting.executeScript({
                  target: { tabId: activeTabId },
                  files: ['accessibility-utils.js']
                }).then(function() {
                  return chrome.scripting.executeScript({
                    target: { tabId: activeTabId },
                    files: ['minimal-enhanced.js']
                  });
                });
              }
            }).then(function() {
              var paginationOptions = {
                page: (options && options.page) || 1,
                pageHeight: options && options.pageHeight,
                pageMode: (options && options.pageMode) || 'viewport'
              };

              return chrome.scripting.executeScript({
                target: { tabId: activeTabId },
                func: function(paginationOpts) {
                  if (typeof window.captureEnhancedMinimalSnapshot === 'function') {
                    return window.captureEnhancedMinimalSnapshot(paginationOpts);
                  }
                  return 'ERROR: Enhanced minimal function not found';
                },
                args: [paginationOptions]
              });
            }).then(function(result) {
              return { snapshot: result[0].result };
            });
          }

          // Standard capture mode
          log('[snapshot.accessibility] Standard capture mode');
          return chrome.scripting.executeScript({
            target: { tabId: activeTabId },
            func: captureAccessibilitySnapshot,
            args: [options || {}]
          }).then(function(result) {
            return { snapshot: result[0].result };
          });
        });
      });
    });

    // Add remaining missing handlers
    log('Adding remaining DOM, keyboard, and utility handlers...');

    // dom.click handler
    messageHandlers.set('dom.click', function(payload) {
      var ref = payload && payload.ref;
      return ensureActiveTab().then(function(tabId) {
        activeTabId = tabId;
        return chrome.scripting.executeScript({
          target: { tabId: activeTabId },
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

    // dom.hover handler
    messageHandlers.set('dom.hover', function(payload) {
      var ref = payload && payload.ref;
      return ensureActiveTab().then(function(tabId) {
        activeTabId = tabId;
        return chrome.scripting.executeScript({
          target: { tabId: activeTabId },
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

    // dom.type handler
    messageHandlers.set('dom.type', function(payload) {
      var ref = payload && payload.ref;
      var text = payload && payload.text;
      var submit = payload && payload.submit;
      return ensureActiveTab().then(function(tabId) {
        activeTabId = tabId;
        return chrome.scripting.executeScript({
          target: { tabId: activeTabId },
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

    // keyboard.press handler
    messageHandlers.set('keyboard.press', function(payload) {
      var key = payload && payload.key;
      return ensureActiveTab().then(function(tabId) {
        activeTabId = tabId;
        return chrome.scripting.executeScript({
          target: { tabId: activeTabId },
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

    // browser_press_key handler (alias)
    messageHandlers.set('browser_press_key', function(payload) {
      return messageHandlers.get('keyboard.press')(payload);
    });

    // page.wait / browser_wait handlers
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

    // js.execute handler
    messageHandlers.set('js.execute', function(payload) {
      var code = payload && payload.code;
      var unsafe = payload && payload.unsafe;

      if (unsafe && !extensionConfig.unsafeMode) {
        return Promise.reject(new Error('Unsafe mode not enabled'));
      }

      return ensureActiveTab().then(function(tabId) {
        activeTabId = tabId;
        return chrome.scripting.executeScript({
          target: { tabId: activeTabId },
          func: new Function('return ' + code),
          world: unsafe ? 'MAIN' : 'ISOLATED'
        });
      }).then(function(result) {
        return { result: result[0].result };
      });
    });

    // ADD REMAINING CRITICAL HANDLERS

    // dom.select handler for dropdowns
    messageHandlers.set('dom.select', function(payload) {
      var ref = payload && payload.ref;
      var values = payload && payload.values;

      return ensureActiveTab().then(function(tabId) {
        activeTabId = tabId;
        return chrome.scripting.executeScript({
          target: { tabId: activeTabId },
          func: function(ref, values) {
            var element = window.__elementTracker && window.__elementTracker.get(ref);
            if (element && element.tagName === 'SELECT') {
              Array.from(element.options).forEach(function(option) {
                option.selected = false;
              });
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

    // console.get handler
    messageHandlers.set('console.get', function(payload) {
      return ensureActiveTab().then(function(tabId) {
        activeTabId = tabId;
        return chrome.scripting.executeScript({
          target: { tabId: activeTabId },
          func: function() {
            return window.__consoleLogs || [];
          }
        });
      }).then(function(result) {
        return { logs: result[0].result || [] };
      });
    });

    // snapshot.query handler
    messageHandlers.set('snapshot.query', function(payload) {
      var selector = payload && payload.selector;
      var all = payload && payload.all;

      return ensureActiveTab().then(function(tabId) {
        activeTabId = tabId;
        return chrome.scripting.executeScript({
          target: { tabId: activeTabId },
          func: function(selector, all) {
            var elements = all ?
              Array.from(document.querySelectorAll(selector)) :
              [document.querySelector(selector)].filter(Boolean);

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

    // debugger.attach handler
    messageHandlers.set('debugger.attach', function(payload) {
      return ensureActiveTab().then(function(tabId) {
        activeTabId = tabId;
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

    // debugger.detach handler
    messageHandlers.set('debugger.detach', function() {
      return ensureActiveTab().then(function(tabId) {
        activeTabId = tabId;
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

    // debugger.getData handler
    messageHandlers.set('debugger.getData', function(payload) {
      return Promise.resolve({
        type: payload && payload.type,
        data: [],
        message: 'Debugger data retrieval not fully implemented yet'
      });
    });

    // browser_screenshot with options
    messageHandlers.set('browser_screenshot', function(payload) {
      return messageHandlers.get('screenshot')(payload);
    });

    // dom.expand handler
    messageHandlers.set('dom.expand', function(payload) {
      var ref = payload && payload.ref;
      return ensureActiveTab().then(function(tabId) {
        activeTabId = tabId;
        return chrome.scripting.executeScript({
          target: { tabId: activeTabId },
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

    // dom.query handler
    messageHandlers.set('dom.query', function(payload) {
      var selector = (payload && payload.selector) || '*';
      var limit = (payload && payload.limit) || 20;

      return ensureActiveTab().then(function(tabId) {
        activeTabId = tabId;
        return chrome.scripting.executeScript({
          target: { tabId: activeTabId },
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

    log('All missing handlers added successfully');

    // Debug: Log all registered handlers
    log('Registered handlers:', Array.from(messageHandlers.keys()));
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
