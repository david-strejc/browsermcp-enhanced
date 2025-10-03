(function() {
  'use strict';

  const TAG = '[UnifiedDaemon]';
  const log = (...args) => console.log(TAG, new Date().toISOString(), ...args);
  const warn = (...args) => console.warn(TAG, new Date().toISOString(), ...args);
  const error = (...args) => console.error(TAG, new Date().toISOString(), ...args);

  const messageHandlers = new Map();
  let connectionManager = null;
  let unsafeModeEnabled = false;
  let activeTabId = null;

  async function getActiveTabId() {
    if (typeof activeTabId === 'number') {
      try {
        await chrome.tabs.get(activeTabId);
        return activeTabId;
      } catch {
        activeTabId = null;
      }
    }

    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (activeTab) {
      activeTabId = activeTab.id;
      return activeTabId;
    }

    const created = await chrome.tabs.create({ url: 'about:blank', active: true });
    activeTabId = created.id;
    return activeTabId;
  }

  async function waitForTabComplete(tabId) {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        chrome.webNavigation.onCompleted.removeListener(listener);
        resolve();
      }, 10000);

      const listener = (details) => {
        if (details.tabId === tabId) {
          clearTimeout(timeout);
          chrome.webNavigation.onCompleted.removeListener(listener);
          resolve();
        }
      };

      chrome.webNavigation.onCompleted.addListener(listener, { tabId });
    });
  }

  function registerHandlers() {
    messageHandlers.set('browser_navigate', async ({ action = 'goto', url, snapshot = false, _envelopeTabId }) => {
      // Use envelope tabId if provided, otherwise get active tab
      const tabId = _envelopeTabId !== undefined ? _envelopeTabId : await getActiveTabId();

      switch (action) {
        case 'goto': {
          if (!url) {
            throw new Error('browser_navigate requires url');
          }
          // If tabId is undefined/null, create new tab
          if (tabId === undefined || tabId === null) {
            const newTab = await chrome.tabs.create({ url, active: true });
            await waitForTabComplete(newTab.id);
            return { url, tabId: newTab.id };
          }

          await chrome.tabs.update(tabId, { url, active: true });
          await waitForTabComplete(tabId);
          return { url, tabId };
        }
        case 'back':
          await chrome.tabs.goBack(tabId).catch(() => {});
          return { tabId };
        case 'forward':
          await chrome.tabs.goForward(tabId).catch(() => {});
          return { tabId };
        case 'refresh':
          await chrome.tabs.reload(tabId);
          await waitForTabComplete(tabId);
          return { tabId };
        default:
          throw new Error(`Unknown navigation action: ${action}`);
      }
    });

    messageHandlers.set('js.execute', async ({ code, timeout = 5000, unsafe = null }) => {
      if (unsafe && !unsafeModeEnabled) {
        throw new Error('Unsafe mode not enabled');
      }
      const tabId = await getActiveTabId();
      const world = unsafe ? 'MAIN' : 'ISOLATED';
      const execResults = await chrome.scripting.executeScript({
        target: { tabId },
        world,
        func: new Function('return ' + code)
      });
      const value = execResults && execResults[0] ? execResults[0].result : undefined;
      return { result: value };
    });

    messageHandlers.set('browser_wait', async ({ time = 1000 }) => {
      await new Promise((resolve) => setTimeout(resolve, time));
      return { success: true };
    });

    messageHandlers.set('browser_tabs_list', async () => {
      const tabs = await chrome.tabs.query({});
      return { tabs: tabs.map(tab => ({ id: tab.id, title: tab.title, url: tab.url, active: tab.active })) };
    });

    messageHandlers.set('browser_activate_tab', async ({ tabId }) => {
      if (typeof tabId !== 'number') throw new Error('tabId required');
      await chrome.tabs.update(tabId, { active: true });
      activeTabId = tabId;
      return { success: true };
    });
  }

  async function handleMessage(msg) {
    if (!msg || typeof msg !== 'object') return;

    // Protocol v2: Extract envelope fields (including tabId!)
    const { wireId, sessionId, originId, type, name, payload, tabId } = msg;

    // Handle legacy format (id field) or Protocol v2 (wireId)
    const commandId = wireId || msg.id;
    const commandType = name || msg.type;

    const handler = messageHandlers.get(commandType);
    if (!handler) {
      if (commandId) {
        connectionManager.send({
          wireId: commandId,
          sessionId,
          originId,
          type: 'response',
          error: `Unhandled message type: ${commandType}`
        });
      }
      return;
    }

    try {
      // Pass both payload AND tabId to handler
      const handlerPayload = { ...(payload || msg.payload || {}), _envelopeTabId: tabId };
      const result = await handler(handlerPayload);
      if (commandId) {
        // Protocol v2: Echo wireId and sessionId
        connectionManager.send({
          wireId: commandId,
          sessionId,
          originId,
          type: 'response',
          data: result
        });
      }
    } catch (err) {
      error('Handler failed:', err);
      if (commandId) {
        connectionManager.send({
          wireId: commandId,
          sessionId,
          originId,
          type: 'response',
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
  }

  const Controller = {
    async init() {
      if (connectionManager) {
        log('Already initialized, skipping...');
        return;
      }
      log('Initializing daemon mode...');
      registerHandlers();
      connectionManager = new self.UnifiedConnectionManager();
      connectionManager.onMessage('*', handleMessage);
      await connectionManager.initialize();
      log('Connection manager initialized');
    },
    deinit() {
      log('Deinitializing daemon mode...');
      if (connectionManager) {
        connectionManager.close();
        connectionManager = null;
      }
      messageHandlers.clear();
    },
    onUnsafeModeChanged(enabled) {
      unsafeModeEnabled = !!enabled;
      log('Unsafe mode updated:', unsafeModeEnabled);
    }
  };

  self.UnifiedDaemonMode = Controller;
})();
