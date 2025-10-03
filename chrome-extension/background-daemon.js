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

  // Session → Tabs mapping (per Claude instance)
  const tabForSession = new Map(); // sessionId -> number[]
  const lastFocusedTabForSession = new Map(); // sessionId -> number

  function recordSessionTab(sessionId, tabId) {
    if (typeof tabId !== 'number') return;
    let list = tabForSession.get(sessionId);
    if (!list) {
      list = [];
      tabForSession.set(sessionId, list);
    }
    if (!list.includes(tabId)) {
      list.push(tabId);
    }
    lastFocusedTabForSession.set(sessionId, tabId);
  }

  async function ensureSessionTab(sessionId, preferredTabId) {
    // If an explicit tab is provided and exists, use it
    if (typeof preferredTabId === 'number') {
      try {
        await chrome.tabs.get(preferredTabId);
        recordSessionTab(sessionId, preferredTabId);
        return preferredTabId;
      } catch {
        // fallthrough to create/select
      }
    }

    // Use last focused for this session if still open
    const last = lastFocusedTabForSession.get(sessionId);
    if (typeof last === 'number') {
      try {
        await chrome.tabs.get(last);
        recordSessionTab(sessionId, last);
        return last;
      } catch {
        // fallthrough
      }
    }

    // Create first tab for this session
    const created = await chrome.tabs.create({ url: 'about:blank', active: true });
    recordSessionTab(sessionId, created.id);
    return created.id;
  }

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

    messageHandlers.set('js.execute', async ({ code, timeout = 5000, unsafe = null, _envelopeTabId }) => {
      if (unsafe && !unsafeModeEnabled) {
        throw new Error('Unsafe mode not enabled');
      }
      const tabId = typeof _envelopeTabId === 'number' ? _envelopeTabId : await getActiveTabId();
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

    messageHandlers.set('browser_tabs_list', async ({ _envelopeTabId, sessionId }) => {
      const tabs = await chrome.tabs.query({});
      // Mark the resolved tab as last-focused for the session if provided
      if (typeof _envelopeTabId === 'number' && sessionId) {
        recordSessionTab(sessionId, _envelopeTabId);
      }
      return { tabs: tabs.map(tab => ({ id: tab.id, index: tab.index, title: tab.title, url: tab.url, active: tab.active })) };
    });

    messageHandlers.set('browser_activate_tab', async ({ tabId, sessionId }) => {
      if (typeof tabId !== 'number') throw new Error('tabId required');
      await chrome.tabs.update(tabId, { active: true });
      recordSessionTab(sessionId, tabId);
      return { success: true, tabId };
    });

    // Basic browser navigation aliases
    messageHandlers.set('browser_go_back', async ({ _envelopeTabId }) => {
      const tabId = typeof _envelopeTabId === 'number' ? _envelopeTabId : await getActiveTabId();
      await chrome.tabs.goBack(tabId).catch(() => {});
      return { tabId };
    });

    messageHandlers.set('browser_go_forward', async ({ _envelopeTabId }) => {
      const tabId = typeof _envelopeTabId === 'number' ? _envelopeTabId : await getActiveTabId();
      await chrome.tabs.goForward(tabId).catch(() => {});
      return { tabId };
    });

    messageHandlers.set('browser_refresh', async ({ _envelopeTabId }) => {
      const tabId = typeof _envelopeTabId === 'number' ? _envelopeTabId : await getActiveTabId();
      await chrome.tabs.reload(tabId);
      await waitForTabComplete(tabId);
      return { tabId };
    });

    // Tabs API used by tools/tabs-unified.ts
    messageHandlers.set('tabs.list', async ({ _envelopeTabId, sessionId }) => {
      const tabs = await chrome.tabs.query({});
      if (typeof _envelopeTabId === 'number' && sessionId) recordSessionTab(sessionId, _envelopeTabId);
      return { tabs: tabs.map(t => ({ id: t.id, index: t.index, title: t.title, url: t.url, active: t.active })) };
    });

    messageHandlers.set('tabs.select', async ({ index, sessionId }) => {
      const tabs = await chrome.tabs.query({});
      const target = tabs.find(t => t.index === index);
      if (!target) throw new Error('Tab index not found');
      await chrome.tabs.update(target.id, { active: true });
      recordSessionTab(sessionId, target.id);
      return { success: true, tabId: target.id };
    });

    messageHandlers.set('tabs.new', async ({ url, sessionId }) => {
      const created = await chrome.tabs.create({ url: url || 'about:blank', active: true });
      await waitForTabComplete(created.id).catch(() => {});
      recordSessionTab(sessionId, created.id);
      return { tabId: created.id, index: created.index };
    });

    messageHandlers.set('tabs.close', async ({ index, sessionId }) => {
      const tabs = await chrome.tabs.query({});
      const target = (typeof index === 'number') ? tabs.find(t => t.index === index) : tabs.find(t => t.active);
      if (!target) return { success: false };
      try { await chrome.tabs.remove(target.id); } catch { return { success: false }; }
      // Remove from session maps
      const list = tabForSession.get(sessionId) || [];
      const i = list.indexOf(target.id);
      if (i >= 0) list.splice(i, 1);
      if (lastFocusedTabForSession.get(sessionId) === target.id) lastFocusedTabForSession.delete(sessionId);
      return { success: true };
    });

    // Snapshot accessibility (minimal support for scaffold/minimal)
    messageHandlers.set('snapshot.accessibility', async ({ level, mode, viewportOnly, _envelopeTabId }) => {
      const tabId = typeof _envelopeTabId === 'number' ? _envelopeTabId : await getActiveTabId();
      // Scaffold mode
      if (mode === 'scaffold') {
        const hasFunc = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => typeof window.captureEnhancedScaffoldSnapshot !== 'undefined'
        });
        if (!hasFunc[0].result) {
          await chrome.scripting.executeScript({ target: { tabId }, files: ['scaffold-enhanced.js'] });
        }
        const res = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => window.captureEnhancedScaffoldSnapshot ? window.captureEnhancedScaffoldSnapshot() : ''
        });
        return { snapshot: res[0].result, tabId };
      }

      // Minimal/default mode
      // Ensure utilities
      await chrome.scripting.executeScript({ target: { tabId }, files: ['accessibility-utils.js'] }).catch(() => {});
      const hasMinimal = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => typeof window.captureEnhancedMinimalSnapshot !== 'undefined'
      });
      if (!hasMinimal[0].result) {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['minimal-enhanced.js'] });
      }
      const res = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => window.captureEnhancedMinimalSnapshot ? window.captureEnhancedMinimalSnapshot({ page: 1 }) : ''
      });
      return { snapshot: res[0].result, tabId };
    });

    // Element tracker helpers
    async function ensureElementTracker(tabId) {
      const check = await chrome.scripting.executeScript({ target: { tabId }, func: () => typeof window.__elementTracker !== 'undefined' });
      if (!check[0].result) {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['element-tracker.js', 'element-validator.js'] });
      }
    }

    messageHandlers.set('dom.click', async ({ ref, _envelopeTabId }) => {
      const tabId = typeof _envelopeTabId === 'number' ? _envelopeTabId : await getActiveTabId();
      await ensureElementTracker(tabId);
      const res = await chrome.scripting.executeScript({
        target: { tabId },
        func: (ref) => {
          const el = window.__elementTracker?.get(ref);
          if (el) { el.click(); return true; }
          return false;
        },
        args: [ref]
      });
      return { success: !!(res && res[0] && res[0].result), tabId };
    });

    messageHandlers.set('dom.hover', async ({ ref, _envelopeTabId }) => {
      const tabId = typeof _envelopeTabId === 'number' ? _envelopeTabId : await getActiveTabId();
      await ensureElementTracker(tabId);
      const res = await chrome.scripting.executeScript({
        target: { tabId },
        func: (ref) => {
          const el = window.__elementTracker?.get(ref);
          if (!el) return false;
          const evt = new MouseEvent('mouseover', { view: window, bubbles: true, cancelable: true });
          el.dispatchEvent(evt);
          return true;
        },
        args: [ref]
      });
      return { success: !!(res && res[0] && res[0].result), tabId };
    });

    messageHandlers.set('dom.type', async ({ ref, text, submit, _envelopeTabId }) => {
      const tabId = typeof _envelopeTabId === 'number' ? _envelopeTabId : await getActiveTabId();
      await ensureElementTracker(tabId);
      const res = await chrome.scripting.executeScript({
        target: { tabId },
        func: (ref, text, submit) => {
          const el = window.__elementTracker?.get(ref);
          if (!el) return false;
          if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return false;
          el.value = text;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          if (submit) {
            const form = el.closest('form');
            if (form) form.submit();
          }
          return true;
        },
        args: [ref, text, !!submit]
      });
      return { success: !!(res && res[0] && res[0].result), tabId };
    });

    messageHandlers.set('dom.select', async ({ ref, values, _envelopeTabId }) => {
      const tabId = typeof _envelopeTabId === 'number' ? _envelopeTabId : await getActiveTabId();
      await ensureElementTracker(tabId);
      const res = await chrome.scripting.executeScript({
        target: { tabId },
        func: (ref, values) => {
          const el = window.__elementTracker?.get(ref);
          if (!el || el.tagName !== 'SELECT') return false;
          Array.from(el.options).forEach(o => { o.selected = false; });
          (values || []).forEach(v => {
            const opt = Array.from(el.options).find(o => o.value === v || o.text === v);
            if (opt) opt.selected = true;
          });
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        },
        args: [ref, values]
      });
      return { success: !!(res && res[0] && res[0].result), tabId };
    });

    // Simple screenshot of visible tab
    messageHandlers.set('screenshot.capture', async ({ _envelopeTabId }) => {
      const tabId = typeof _envelopeTabId === 'number' ? _envelopeTabId : await getActiveTabId();
      const dataUrl = await chrome.tabs.captureVisibleTab(undefined, { format: 'png' });
      return { data: dataUrl, tabId };
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
      // Resolve a target tab for this session if not explicitly provided
      const resolvedTabId = typeof tabId === 'number' ? tabId : await ensureSessionTab(sessionId);
      recordSessionTab(sessionId, resolvedTabId);

      // Pass payload PLUS resolved tab and session context to handler
      const handlerPayload = { ...(payload || msg.payload || {}), _envelopeTabId: resolvedTabId, sessionId };
      const result = await handler(handlerPayload, { sessionId, resolvedTabId });
      if (commandId) {
        // Protocol v2: Echo wireId and sessionId
        connectionManager.send({
          wireId: commandId,
          sessionId,
          originId,
          type: 'response',
          data: result && typeof result === 'object' ? { ...result, tabId: (result.tabId ?? resolvedTabId) } : { tabId: resolvedTabId }
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
