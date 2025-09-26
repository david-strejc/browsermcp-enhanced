// Missing handlers to be added to background-multi-instance.js
// These are ported from background-legacy.js

function addMissingHandlers(messageHandlers, activeTabId) {

  // Helper function for captureAccessibilitySnapshot
  function captureAccessibilitySnapshot(options) {
    console.log('[PAGE] captureAccessibilitySnapshot called with options:', options);

    // Get existing element tracker or create one
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
          // Skip invisible elements
          const style = window.getComputedStyle(node);
          if (style.display === 'none' || style.visibility === 'hidden') {
            return NodeFilter.FILTER_REJECT;
          }
          // Skip script and style elements
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

      // Generate ref for element tracking
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
  messageHandlers.set('snapshot.accessibility', function(options = {}) {
    console.log('[snapshot.accessibility] Handler called with options:', JSON.stringify(options));

    return ensureActiveTab().then(function(tabId) {
      activeTabId = tabId;

      // Check if scripts are already injected
      return chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        func: () => typeof window.__elementTracker !== 'undefined'
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
        if (options.mode === 'scaffold') {
          return chrome.scripting.executeScript({
            target: { tabId: activeTabId },
            func: () => typeof window.captureEnhancedScaffoldSnapshot !== 'undefined'
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
              func: () => window.captureEnhancedScaffoldSnapshot()
            });
          }).then(function(result) {
            return { snapshot: result[0].result };
          });
        }

        // Handle minimal mode
        if (options.level === 'minimal') {
          console.log('[snapshot.accessibility] Minimal mode detected');

          // First ensure element tracker is injected
          return chrome.scripting.executeScript({
            target: { tabId: activeTabId },
            func: () => typeof window.__elementTracker !== 'undefined'
          }).then(function(checkTracker) {

            if (!checkTracker[0].result) {
              return chrome.scripting.executeScript({
                target: { tabId: activeTabId },
                files: ['element-tracker.js']
              });
            }
          }).then(function() {
            // Check for enhanced minimal function
            return chrome.scripting.executeScript({
              target: { tabId: activeTabId },
              func: () => typeof window.captureEnhancedMinimalSnapshot !== 'undefined'
            });
          }).then(function(checkMinimal) {

            if (!checkMinimal[0].result) {
              // Inject accessibility utilities first
              return chrome.scripting.executeScript({
                target: { tabId: activeTabId },
                files: ['accessibility-utils.js']
              }).then(function() {
                // Then inject minimal-enhanced
                return chrome.scripting.executeScript({
                  target: { tabId: activeTabId },
                  files: ['minimal-enhanced.js']
                });
              });
            }
          }).then(function() {
            const paginationOptions = {
              page: options.page || 1,
              pageHeight: options.pageHeight,
              pageMode: options.pageMode || 'viewport'
            };

            return chrome.scripting.executeScript({
              target: { tabId: activeTabId },
              func: (paginationOpts) => {
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
        console.log('[snapshot.accessibility] Standard capture mode');
        return chrome.scripting.executeScript({
          target: { tabId: activeTabId },
          func: captureAccessibilitySnapshot,
          args: [options]
        }).then(function(result) {
          return { snapshot: result[0].result };
        });
      });
    });
  });

  // snapshot.query handler
  messageHandlers.set('snapshot.query', function({ selector, all }) {
    return ensureActiveTab().then(function(tabId) {
      activeTabId = tabId;

      return chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        func: (selector, all) => {
          const elements = all ?
            Array.from(document.querySelectorAll(selector)) :
            [document.querySelector(selector)].filter(Boolean);

          return elements.map(el => {
            const rect = el.getBoundingClientRect();
            return {
              tagName: el.tagName,
              text: el.textContent.trim().substring(0, 100),
              bounds: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height
              },
              attributes: Object.fromEntries(
                Array.from(el.attributes).map(attr => [attr.name, attr.value])
              )
            };
          });
        },
        args: [selector, all]
      }).then(function(result) {
        return { elements: result[0].result };
      });
    });
  });

  // dom.click handler
  messageHandlers.set('dom.click', function({ ref }) {
    return ensureActiveTab().then(function(tabId) {
      activeTabId = tabId;

      // Inject scripts if needed
      return chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        func: () => typeof window.__elementTracker !== 'undefined'
      }).then(function(checkResult) {
        if (!checkResult[0].result) {
          return chrome.scripting.executeScript({
            target: { tabId: activeTabId },
            files: ['element-tracker.js', 'element-validator.js']
          });
        }
      }).then(function() {
        return chrome.scripting.executeScript({
          target: { tabId: activeTabId },
          func: (ref) => {
            const element = window.__elementTracker?.get(ref);
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
  });

  // dom.hover handler
  messageHandlers.set('dom.hover', function({ ref }) {
    return ensureActiveTab().then(function(tabId) {
      activeTabId = tabId;

      return chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        func: () => typeof window.__elementTracker !== 'undefined'
      }).then(function(checkResult) {
        if (!checkResult[0].result) {
          return chrome.scripting.executeScript({
            target: { tabId: activeTabId },
            files: ['element-tracker.js', 'element-validator.js']
          });
        }
      }).then(function() {
        return chrome.scripting.executeScript({
          target: { tabId: activeTabId },
          func: (ref) => {
            const element = window.__elementTracker?.get(ref);
            if (element) {
              const event = new MouseEvent('mouseover', {
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
  });

  // dom.type handler
  messageHandlers.set('dom.type', function({ ref, text, submit }) {
    return ensureActiveTab().then(function(tabId) {
      activeTabId = tabId;

      return chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        func: () => typeof window.__elementTracker !== 'undefined'
      }).then(function(checkResult) {
        if (!checkResult[0].result) {
          return chrome.scripting.executeScript({
            target: { tabId: activeTabId },
            files: ['element-tracker.js', 'element-validator.js']
          });
        }
      }).then(function() {
        return chrome.scripting.executeScript({
          target: { tabId: activeTabId },
          func: (ref, text, submit) => {
            const element = window.__elementTracker?.get(ref);
            if (element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA')) {
              element.value = text;
              element.dispatchEvent(new Event('input', { bubbles: true }));
              element.dispatchEvent(new Event('change', { bubbles: true }));

              if (submit) {
                const form = element.closest('form');
                if (form) {
                  form.submit();
                } else {
                  element.dispatchEvent(new KeyboardEvent('keypress', {
                    key: 'Enter',
                    keyCode: 13,
                    bubbles: true
                  }));
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
  });

  // dom.select handler
  messageHandlers.set('dom.select', function({ ref, values }) {
    return ensureActiveTab().then(function(tabId) {
      activeTabId = tabId;

      return chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        func: (ref, values) => {
          const element = window.__elementTracker?.get(ref);
          if (element && element.tagName === 'SELECT') {
            // Clear previous selections
            Array.from(element.options).forEach(option => {
              option.selected = false;
            });

            // Set new selections
            values.forEach(value => {
              const option = Array.from(element.options).find(opt =>
                opt.value === value || opt.text === value
              );
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
      }).then(function(result) {
        return { success: result[0].result };
      });
    });
  });

  // keyboard.press handler
  messageHandlers.set('keyboard.press', function({ key }) {
    return ensureActiveTab().then(function(tabId) {
      activeTabId = tabId;

      return chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        func: (key) => {
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

  // browser_press_key handler (alias for keyboard.press)
  messageHandlers.set('browser_press_key', function({ key }) {
    return messageHandlers.get('keyboard.press')({ key });
  });

  // page.wait handler
  messageHandlers.set('page.wait', function({ time }) {
    return new Promise(function(resolve) {
      setTimeout(function() {
        resolve({ success: true });
      }, time || 1000);
    });
  });

  // browser_wait handler (alias for page.wait)
  messageHandlers.set('browser_wait', function({ time }) {
    return messageHandlers.get('page.wait')({ time });
  });

  // console.get handler
  messageHandlers.set('console.get', function({ filter, limit, type }) {
    return ensureActiveTab().then(function(tabId) {
      activeTabId = tabId;

      return chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        func: () => {
          // Get console logs if they've been captured
          return window.__consoleLogs || [];
        }
      }).then(function(result) {
        let logs = result[0].result || [];

        // Apply filters
        if (type) {
          logs = logs.filter(log => log.type === type);
        }
        if (filter) {
          logs = logs.filter(log =>
            log.message.toLowerCase().includes(filter.toLowerCase())
          );
        }
        if (limit) {
          logs = logs.slice(0, limit);
        }

        return { logs };
      });
    });
  });

  // js.execute handler
  messageHandlers.set('js.execute', function({ code, unsafe }) {
    return ensureActiveTab().then(function(tabId) {
      activeTabId = tabId;

      if (unsafe && !extensionConfig.unsafeMode) {
        return Promise.reject(new Error('Unsafe mode not enabled'));
      }

      return chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        func: new Function('return ' + code),
        world: unsafe ? 'MAIN' : 'ISOLATED'
      }).then(function(result) {
        return { result: result[0].result };
      });
    });
  });

  // dom.expand handler
  messageHandlers.set('dom.expand', function({ ref }) {
    return ensureActiveTab().then(function(tabId) {
      activeTabId = tabId;

      return chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        func: (ref) => {
          const element = window.__elementTracker?.get(ref);
          if (element) {
            // Try common expansion patterns
            if (element.hasAttribute('aria-expanded')) {
              element.setAttribute('aria-expanded', 'true');
            }
            element.click();
            return true;
          }
          return false;
        },
        args: [ref]
      }).then(function(result) {
        return { success: result[0].result };
      });
    });
  });

  // dom.query handler
  messageHandlers.set('dom.query', function({ selector, attributes, limit }) {
    return ensureActiveTab().then(function(tabId) {
      activeTabId = tabId;

      return chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        func: (selector, attributes, limit) => {
          const elements = Array.from(document.querySelectorAll(selector));
          const limitedElements = limit ? elements.slice(0, limit) : elements;

          return limitedElements.map(el => {
            const result = {};

            // Get requested attributes
            if (attributes && attributes.length > 0) {
              attributes.forEach(attr => {
                if (attr === 'textContent') {
                  result.textContent = el.textContent;
                } else if (attr === 'innerHTML') {
                  result.innerHTML = el.innerHTML;
                } else {
                  result[attr] = el.getAttribute(attr);
                }
              });
            } else {
              // Default: return common attributes
              result.textContent = el.textContent.trim().substring(0, 200);
              result.href = el.getAttribute('href');
              result.src = el.getAttribute('src');
              result.id = el.id;
              result.className = el.className;
            }

            return result;
          });
        },
        args: [selector, attributes, limit]
      }).then(function(result) {
        return { elements: result[0].result };
      });
    });
  });

  // Helper function to ensure active tab
  function ensureActiveTab() {
    if (activeTabId) {
      return Promise.resolve(activeTabId);
    }

    return new Promise(function(resolve, reject) {
      chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (tabs && tabs[0]) {
          activeTabId = tabs[0].id;
          resolve(activeTabId);
        } else {
          reject(new Error('No active tab'));
        }
      });
    });
  }

  console.log('[Multi-Instance] Added missing handlers: snapshot.accessibility, snapshot.query, dom.*, keyboard.*, page.*, console.*, js.*');
}

// Export for use in background-multi-instance.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = addMissingHandlers;
}