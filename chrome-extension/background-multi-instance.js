// Multi-Instance Background Service Worker
// Supports multiple Claude Desktop connections simultaneously

// Import multi-instance manager
importScripts('multi-instance-manager.js');

// Global variables
let activeTabId = null;
let messageHandlers = new Map();
let multiInstanceManager = null;

// Configuration
let extensionConfig = {
  unsafeMode: false,
  multiInstance: true  // Enable multi-instance mode
};

// Initialize multi-instance manager
function initializeMultiInstance() {
  multiInstanceManager = new MultiInstanceManager();

  // Make message handlers available to the manager
  multiInstanceManager.messageHandlers = messageHandlers;

  console.log('[Background] Multi-instance mode initialized');
}

// Load configuration from storage
chrome.storage.local.get(['unsafeMode', 'multiInstance'], (result) => {
  if (result.unsafeMode !== undefined) {
    extensionConfig.unsafeMode = result.unsafeMode;
    console.log('Loaded unsafe mode setting:', extensionConfig.unsafeMode);
  }
  if (result.multiInstance !== undefined) {
    extensionConfig.multiInstance = result.multiInstance;
  }

  // Initialize based on mode
  if (extensionConfig.multiInstance) {
    initializeMultiInstance();
  } else {
    // Fall back to legacy single-instance mode
    console.log('[Background] Running in legacy single-instance mode');
    importScripts('background-legacy.js');
  }
});

// Tab management handlers
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
  return { success: true, tabId };
});

messageHandlers.set('tabs.new', async (payload) => {
  const { url } = payload;
  const tab = await chrome.tabs.create({ url: url || 'about:blank' });
  activeTabId = tab.id;
  return { success: true, tabId: tab.id };
});

messageHandlers.set('tabs.close', async (payload) => {
  const { tabId } = payload;
  await chrome.tabs.remove(tabId);
  return { success: true };
});

// Navigation handler
messageHandlers.set('navigate', async (payload) => {
  const { url, action, tabId } = payload;
  const targetTabId = tabId || activeTabId;

  if (!targetTabId) {
    throw new Error('No active tab');
  }

  if (action === 'goto' && url) {
    await chrome.tabs.update(targetTabId, { url });
  } else if (action === 'back') {
    await chrome.tabs.goBack(targetTabId);
  } else if (action === 'forward') {
    await chrome.tabs.goForward(targetTabId);
  } else if (action === 'refresh') {
    await chrome.tabs.reload(targetTabId);
  }

  return { success: true };
});

// Screenshot handler
messageHandlers.set('screenshot', async (payload) => {
  const { tabId, format = 'png', quality = 100, fullPage = false } = payload;
  const targetTabId = tabId || activeTabId;

  if (!targetTabId) {
    throw new Error('No active tab');
  }

  const options = {
    format,
    quality: format === 'jpeg' ? quality : undefined
  };

  let dataUrl;
  if (fullPage) {
    // For full page, we need to use chrome.debugger
    // This is handled in screenshot-handler.js
    const result = await chrome.runtime.sendMessage({
      type: 'captureFullPage',
      tabId: targetTabId,
      options
    });
    dataUrl = result.dataUrl;
  } else {
    dataUrl = await chrome.tabs.captureVisibleTab(null, options);
  }

  return { dataUrl };
});

// Content script injection for snapshots
messageHandlers.set('snapshot', async (payload) => {
  const { tabId, level = 'minimal' } = payload;
  const targetTabId = tabId || activeTabId;

  if (!targetTabId) {
    throw new Error('No active tab');
  }

  // Execute content script to get snapshot
  const results = await chrome.scripting.executeScript({
    target: { tabId: targetTabId },
    func: (level) => {
      // This function runs in the page context
      function getAccessibilityTree(rootElement = document.body, level = 'minimal') {
        const tree = [];
        const walker = document.createTreeWalker(
          rootElement,
          NodeFilter.SHOW_ELEMENT,
          {
            acceptNode: (node) => {
              // Filter based on level
              if (level === 'minimal') {
                // Only interactive elements
                const interactive = ['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'LABEL'];
                const hasRole = node.getAttribute('role');
                const isInteractive = interactive.includes(node.tagName) ||
                                     node.onclick ||
                                     node.getAttribute('tabindex') !== null ||
                                     hasRole;
                return isInteractive ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
              }
              return NodeFilter.FILTER_ACCEPT;
            }
          }
        );

        let node;
        while (node = walker.nextNode()) {
          const rect = node.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;

          const item = {
            tag: node.tagName.toLowerCase(),
            text: node.textContent?.trim().substring(0, 100),
            bounds: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height
            },
            attributes: {}
          };

          // Add relevant attributes
          ['id', 'class', 'href', 'src', 'alt', 'title', 'placeholder', 'value', 'type', 'role', 'aria-label'].forEach(attr => {
            const value = node.getAttribute(attr);
            if (value) item.attributes[attr] = value;
          });

          // Generate a reference for clicking
          if (node.id) {
            item.ref = `#${node.id}`;
          } else if (node.className) {
            item.ref = `.${node.className.split(' ')[0]}`;
          } else {
            item.ref = node.tagName.toLowerCase();
          }

          tree.push(item);
        }

        return tree;
      }

      return getAccessibilityTree(document.body, level);
    },
    args: [level]
  });

  return { snapshot: results[0].result };
});

// Click handler
messageHandlers.set('click', async (payload) => {
  const { ref, tabId } = payload;
  const targetTabId = tabId || activeTabId;

  if (!targetTabId) {
    throw new Error('No active tab');
  }

  // Execute click in content script
  const results = await chrome.scripting.executeScript({
    target: { tabId: targetTabId },
    func: (selector) => {
      const element = document.querySelector(selector);
      if (!element) {
        throw new Error(`Element not found: ${selector}`);
      }
      element.click();
      return true;
    },
    args: [ref]
  });

  return { success: results[0].result };
});

// Type handler
messageHandlers.set('type', async (payload) => {
  const { text, ref, tabId, pressEnter = false } = payload;
  const targetTabId = tabId || activeTabId;

  if (!targetTabId) {
    throw new Error('No active tab');
  }

  // Execute typing in content script
  const results = await chrome.scripting.executeScript({
    target: { tabId: targetTabId },
    func: (selector, text, pressEnter) => {
      const element = selector ? document.querySelector(selector) : document.activeElement;
      if (!element) {
        throw new Error(`Element not found: ${selector}`);
      }

      // Focus and type
      element.focus();
      element.value = text;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));

      if (pressEnter) {
        element.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13 }));
      }

      return true;
    },
    args: [ref, text, pressEnter]
  });

  return { success: results[0].result };
});

// Execute JavaScript handler
messageHandlers.set('execute_js', async (payload) => {
  const { code, tabId, unsafe = false } = payload;
  const targetTabId = tabId || activeTabId;

  if (!targetTabId) {
    throw new Error('No active tab');
  }

  if (!unsafe && !extensionConfig.unsafeMode) {
    throw new Error('Unsafe mode is disabled. Enable it in extension settings to execute arbitrary JavaScript.');
  }

  // Execute code in content script
  const results = await chrome.scripting.executeScript({
    target: { tabId: targetTabId },
    func: (codeToExecute) => {
      // Create a function from the code string and execute it
      try {
        const fn = new Function(codeToExecute);
        return fn();
      } catch (error) {
        throw new Error(`Execution error: ${error.message}`);
      }
    },
    args: [code]
  });

  return { result: results[0].result };
});

// Debugger management (handled by debugger-state-manager.js)
importScripts('debugger-state-manager.js');

const debuggerManager = new DebuggerStateManager();

messageHandlers.set('debugger_attach', async (payload) => {
  const { tabId, domains = ['Console', 'Network', 'Runtime', 'Performance'] } = payload;
  const targetTabId = tabId || activeTabId;

  if (!targetTabId) {
    throw new Error('No active tab');
  }

  const result = await debuggerManager.attachDebugger(targetTabId, domains);
  return result;
});

messageHandlers.set('debugger_detach', async (payload) => {
  const { tabId } = payload;
  const targetTabId = tabId || activeTabId;

  if (!targetTabId) {
    throw new Error('No active tab');
  }

  const result = await debuggerManager.detachDebugger(targetTabId);
  return result;
});

messageHandlers.set('debugger_get_data', async (payload) => {
  const { tabId, type = 'all', filter, limit = 50 } = payload;
  const targetTabId = tabId || activeTabId;

  if (!targetTabId) {
    throw new Error('No active tab');
  }

  const data = await debuggerManager.getDebugData(targetTabId, type, filter, limit);
  return data;
});

// Status endpoint for debugging
messageHandlers.set('status', async () => {
  if (multiInstanceManager) {
    return multiInstanceManager.getStatus();
  }
  return { mode: 'legacy', connected: false };
});

// Listen for tab changes
chrome.tabs.onActivated.addListener((activeInfo) => {
  activeTabId = activeInfo.tabId;
  console.log('Active tab changed:', activeTabId);

  // Notify all connected instances
  if (multiInstanceManager) {
    multiInstanceManager.broadcast({
      type: 'tabChanged',
      tabId: activeTabId
    });
  }
});

// Extension icon click handler
chrome.action.onClicked.addListener((tab) => {
  activeTabId = tab.id;
  console.log('Extension icon clicked, active tab:', activeTabId);

  // Send connection status
  if (multiInstanceManager) {
    const status = multiInstanceManager.getStatus();
    console.log('Multi-instance status:', status);
  }
});

console.log('[Background] Multi-instance background service worker loaded');