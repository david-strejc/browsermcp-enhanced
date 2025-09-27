// WebSocket connection to MCP server
let ws = null;
let activeTabId = null;
let messageHandlers = new Map();
let reconnectTimer = null;
let keepAliveTimer = null;
let lastPopupDetection = null; // Store last popup detection result

// Configuration
let extensionConfig = {
  unsafeMode: false,  // Default to safe mode
  serverUrl: 'ws://localhost:8765'
};

// Load configuration from storage
chrome.storage.local.get(['unsafeMode', 'serverUrl'], (result) => {
  if (result.unsafeMode !== undefined) {
    extensionConfig.unsafeMode = result.unsafeMode;
    console.log('Loaded unsafe mode setting:', extensionConfig.unsafeMode);
  }
  if (result.serverUrl) {
    extensionConfig.serverUrl = result.serverUrl;
  }
});

// Update extension icon based on connection status
function updateIcon(connected) {
  const iconPath = connected ? {
    "16": "icon-16-connected.png",
    "48": "icon-48-connected.png",
    "128": "icon-128-connected.png"
  } : {
    "16": "icon-16-disconnected.png",
    "48": "icon-48-disconnected.png", 
    "128": "icon-128-disconnected.png"
  };
  
  // Update the icon
  chrome.action.setIcon({ path: iconPath });
  
  // Also update badge text for additional clarity
  chrome.action.setBadgeText({ text: connected ? '' : '!' });
  chrome.action.setBadgeBackgroundColor({ color: connected ? '#4CAF50' : '#f44336' });
}

// Connect to MCP server
function connectToMCP() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log('Already connected to MCP server');
    return;
  }
  
  // Close existing connection if in connecting state
  if (ws && ws.readyState === WebSocket.CONNECTING) {
    console.log('Connection in progress, skipping...');
    return;
  }
  
  // Clear any existing reconnect timer
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  
  console.log('Connecting to MCP server at:', extensionConfig.serverUrl || 'ws://localhost:8765');
  ws = new WebSocket(extensionConfig.serverUrl || 'ws://localhost:8765');
  
  ws.onopen = () => {
    console.log('Connected to MCP server');
    updateIcon(true);
    
    // Start keepalive ping every 30 seconds
    if (keepAliveTimer) clearInterval(keepAliveTimer);
    keepAliveTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
      }
    }, 30000);
  };
  
  ws.onmessage = async (event) => {
    let messageId = null;
    try {
      const message = JSON.parse(event.data);
      messageId = message.id;
      console.log('Received message:', message);
      
      // Handle ping messages
      if (message.type === 'ping') {
        ws.send(JSON.stringify({
          id: message.id,
          type: 'pong',
          timestamp: Date.now()
        }));
        return;
      }
      
      if (messageHandlers.has(message.type)) {
        const handler = messageHandlers.get(message.type);
        const response = await handler(message.payload || {});
        
        ws.send(JSON.stringify({
          id: message.id,
          type: message.type,
          payload: response
        }));
      } else {
        console.warn(`Unknown message type: ${message.type}`);
        ws.send(JSON.stringify({
          id: message.id,
          type: message.type,
          error: `Unknown message type: ${message.type}`
        }));
      }
    } catch (error) {
      console.error('Error handling message:', error, error.stack);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          id: messageId,
          error: error.message
        }));
      }
    }
  };
  
  ws.onclose = () => {
    console.log('Disconnected from MCP server, will reconnect in 2 seconds...');
    updateIcon(false);
    
    // Clear keepalive
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
    
    // Reconnect after 2 seconds (more aggressive)
    reconnectTimer = setTimeout(connectToMCP, 2000);
  };
  
  ws.onerror = (event) => {
    console.error('WebSocket error:', event);
    updateIcon(false);
  };
}

// Tab management handlers
messageHandlers.set('tabs.list', async () => {
  const tabs = await chrome.tabs.query({});
  return {
    tabs: tabs.map(tab => ({
      id: String(tab.id),
      url: tab.url || '',
      title: tab.title || '',
      index: tab.index,
      active: tab.active
    }))
  };
});

messageHandlers.set('tabs.select', async ({ index }) => {
  const tabs = await chrome.tabs.query({ index });
  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    activeTabId = tabs[0].id;
    return { success: true };
  }
  return { success: false };
});

messageHandlers.set('tabs.new', async ({ url, detectPopups }) => {
  console.log('[tabs.new] Creating tab with URL:', url, 'detectPopups:', detectPopups);
  const tab = await chrome.tabs.create({ url: url || 'about:blank' });
  activeTabId = tab.id;
  
  let popupInfo = {};
  
  // If URL provided and popup detection enabled, wait and detect
  if (url && detectPopups) {
    console.log('[tabs.new] Waiting for tab to complete...');
    await waitForTabComplete(tab.id);
    console.log('[tabs.new] Tab complete, waiting 1s for popups...');
    // Wait a bit for popups to appear (they often load after page complete)
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log('[tabs.new] Calling detectPopupsInTab...');
    popupInfo = await detectPopupsInTab(tab.id);
    console.log('[tabs.new] Popup info received:', popupInfo);
    lastPopupDetection = popupInfo; // Store for later use
  }
  
  return { 
    tabId: String(tab.id), 
    index: tab.index,
    ...popupInfo
  };
});

messageHandlers.set('tabs.close', async ({ index }) => {
  if (index !== undefined) {
    const tabs = await chrome.tabs.query({ index });
    if (tabs.length > 0) {
      await chrome.tabs.remove(tabs[0].id);
      return { success: true };
    }
  } else if (activeTabId) {
    await chrome.tabs.remove(activeTabId);
    return { success: true };
  }
  return { success: false };
});

// Existing handlers
messageHandlers.set('snapshot.accessibility', async (options = {}) => {
  console.log('[snapshot.accessibility] === HANDLER CALLED ===');
  console.log('[snapshot.accessibility] Received options:', JSON.stringify(options));
  console.log('[snapshot.accessibility] options.level =', options.level);
  console.log('[snapshot.accessibility] options.mode =', options.mode);
  console.log('[snapshot.accessibility] Type of options.level:', typeof options.level);
  console.log('[snapshot.accessibility] Checking if minimal:', options.level === 'minimal');
  
  if (!activeTabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = tab?.id;
  }
  
  if (!activeTabId) {
    throw new Error('No active tab');
  }
  
  // Check if scripts are already injected by testing for __elementTracker
  const [checkResult] = await chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    func: () => typeof window.__elementTracker !== 'undefined'
  });
  
  // Only inject if not already present
  if (!checkResult.result) {
    await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      files: ['element-tracker.js', 'element-validator.js']
    });
  }
  
  // Check for scaffold mode
  console.log('[snapshot.accessibility] Checking scaffold mode:', options.mode === 'scaffold');
  if (options.mode === 'scaffold') {
    // First inject the enhanced scaffold script if needed
    const [checkEnhanced] = await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      func: () => typeof window.captureEnhancedScaffoldSnapshot !== 'undefined'
    });
    
    if (!checkEnhanced.result) {
      await chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        files: ['scaffold-enhanced.js']
      });
    }
    
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      func: () => window.captureEnhancedScaffoldSnapshot()
    });
    
    // Add popup info if available
    let finalOutput = result.result;
    if (lastPopupDetection && lastPopupDetection.popupsDetected) {
      // Just append simple popup info
      const popup = lastPopupDetection.popups[0];
      if (popup) {
        finalOutput += `\n\n[POPUP: ${popup.containerSelector}]`;
        finalOutput += `\n[USE browser_execute_js TO CLICK ACCEPT/AGREE SO IT WON'T APPEAR AGAIN]`;
      }
      
      // Clear after using
      lastPopupDetection = null;
    }
    
    return { snapshot: finalOutput };
  }
  
  // Check for enhanced minimal mode
  if (options.level === 'minimal') {
    console.log('[snapshot.accessibility] === MINIMAL MODE DETECTED ===');
    console.log('[snapshot.accessibility] Options received:', JSON.stringify(options));
    console.log('[snapshot.accessibility] Will use enhanced minimal mode');
    
    // CRITICAL: Inject element tracker FIRST (needed for refs)
    const [checkTracker] = await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      func: () => typeof window.__elementTracker !== 'undefined'
    });
    
    if (!checkTracker.result) {
      console.log('[snapshot.accessibility] Injecting element-tracker.js...');
      await chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        files: ['element-tracker.js']
      });
      console.log('[snapshot.accessibility] Successfully injected element-tracker.js');
    }
    
    // NOW inject enhanced minimal script
    const [checkMinimal] = await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      func: () => {
        console.log('[PAGE] Checking for captureEnhancedMinimalSnapshot function...');
        const exists = typeof window.captureEnhancedMinimalSnapshot !== 'undefined';
        console.log('[PAGE] Enhanced minimal function exists?', exists);
        return exists;
      }
    });
    
    console.log('[snapshot.accessibility] Enhanced minimal already injected?', checkMinimal.result);
    
    if (!checkMinimal.result) {
      console.log('[snapshot.accessibility] Injecting accessibility utilities and minimal-enhanced.js...');
      try {
        // First inject accessibility utilities
        await chrome.scripting.executeScript({
          target: { tabId: activeTabId },
          files: ['accessibility-utils.js']
        });
        console.log('[snapshot.accessibility] Successfully injected accessibility-utils.js');
        
        // Then inject minimal-enhanced which uses the utilities
        await chrome.scripting.executeScript({
          target: { tabId: activeTabId },
          files: ['minimal-enhanced.js']
        });
        console.log('[snapshot.accessibility] Successfully injected minimal-enhanced.js');
      } catch (error) {
        console.error('[snapshot.accessibility] Failed to inject scripts:', error);
        throw error;
      }
    }
    
    console.log('[snapshot.accessibility] Calling captureEnhancedMinimalSnapshot...');
    // Extract pagination options from the main options
    const paginationOptions = {
      page: options.page || 1,
      pageHeight: options.pageHeight,
      pageMode: options.pageMode || 'viewport'
    };
    console.log('[snapshot.accessibility] Pagination options:', paginationOptions);
    
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      func: (paginationOpts) => {
        console.log('[PAGE] About to call captureEnhancedMinimalSnapshot with options:', paginationOpts);
        if (typeof window.captureEnhancedMinimalSnapshot === 'function') {
          const snapshot = window.captureEnhancedMinimalSnapshot(paginationOpts);
          console.log('[PAGE] Enhanced minimal snapshot length:', snapshot ? snapshot.length : 'null');
          return snapshot;
        } else {
          console.error('[PAGE] captureEnhancedMinimalSnapshot is not a function!');
          return 'ERROR: Enhanced minimal function not found';
        }
      },
      args: [paginationOptions]
    });
    
    console.log('[snapshot.accessibility] Enhanced minimal result received, length:', result.result ? result.result.length : 'null');
    console.log('[snapshot.accessibility] === RETURNING ENHANCED MINIMAL RESULT ===');
    return { snapshot: result.result };
  }
  
  console.log('[snapshot.accessibility] === USING STANDARD CAPTURE (NOT MINIMAL) ===');
  console.log('[snapshot.accessibility] Options for standard capture:', JSON.stringify(options));
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    func: captureAccessibilitySnapshot,
    args: [options]
  });
  
  return { snapshot: result.result };
});

messageHandlers.set('snapshot.query', async ({ selector, all }) => {
  if (!activeTabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = tab?.id;
  }
  
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    func: queryElements,
    args: [selector, all]
  });
  
  return result.result;
});

messageHandlers.set('dom.click', async ({ ref, detectPopups = true }) => {
  // Check if scripts are already injected by testing for __elementTracker
  const [checkResult] = await chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    func: () => typeof window.__elementTracker !== 'undefined'
  });
  
  // Only inject if not already present
  if (!checkResult.result) {
    await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      files: ['element-tracker.js', 'element-validator.js']
    });
  }
  
  // Inject click detection script
  try {
    await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      files: ['click-detection.js']
    });
  } catch (e) {
    // Ignore if already injected
  }
  
  // Analyze if trusted click is needed
  const [analysis] = await chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    func: (ref) => {
      if (typeof analyzeClickRequirements === 'function') {
        return analyzeClickRequirements(ref);
      }
      return { requires: false };
    },
    args: [ref]
  });
  
  console.log('[dom.click] Click analysis for', ref, ':', analysis.result);
  
  // Use trusted click if needed (for OAuth, popups, etc.)
  if (analysis.result?.requires) {
    console.log('[dom.click] Using trusted click. Reasons:', analysis.result.reasons);
    
    // Get element coordinates
    const [coordsResult] = await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      func: (ref) => {
        const validation = window.__elementValidator?.validateElement(ref);
        if (!validation?.valid) {
          return { error: validation?.error || 'Element not found' };
        }
        
        const element = validation.element;
        const rect = element.getBoundingClientRect();
        
        // Scroll into view if needed
        if (rect.top < 0 || rect.bottom > window.innerHeight) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const newRect = element.getBoundingClientRect();
          return {
            x: Math.round(newRect.left + newRect.width / 2),
            y: Math.round(newRect.top + newRect.height / 2),
            scrolled: true
          };
        }
        
        return {
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
          scrolled: false
        };
      },
      args: [ref]
    });
    
    if (coordsResult.result.error) {
      throw new Error(coordsResult.result.error);
    }
    
    const coords = coordsResult.result;
    
    // Wait for scroll if needed
    if (coords.scrolled) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Use Chrome Debugger API for trusted click
    let wasAttached = false;
    try {
      await chrome.debugger.attach({ tabId: activeTabId }, "1.3");
    } catch (error) {
      if (error.message.includes('Another debugger')) {
        wasAttached = true;
      } else {
        console.error('[dom.click] Failed to attach debugger:', error);
        // Fall back to standard click
        await chrome.scripting.executeScript({
          target: { tabId: activeTabId },
          func: clickElement,
          args: [ref]
        });
        return {};
      }
    }
    
    try {
      // Input domain doesn't need explicit enabling in Chrome
      // Directly send mouse events for trusted click
      await chrome.debugger.sendCommand({ tabId: activeTabId }, "Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: coords.x,
        y: coords.y
      });
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      await chrome.debugger.sendCommand({ tabId: activeTabId }, "Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: coords.x,
        y: coords.y,
        button: "left",
        buttons: 1,
        clickCount: 1
      });
      
      await new Promise(resolve => setTimeout(resolve, 30));
      
      await chrome.debugger.sendCommand({ tabId: activeTabId }, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: coords.x,
        y: coords.y,
        button: "left",
        buttons: 0,
        clickCount: 1
      });
      
      console.log('[dom.click] Trusted click completed');
      
    } finally {
      if (!wasAttached) {
        try {
          await chrome.debugger.detach({ tabId: activeTabId });
        } catch (e) {
          console.log('[dom.click] Error detaching debugger:', e);
        }
      }
    }
  } else {
    // Use standard click
    console.log('[dom.click] Using standard click');
    await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      func: clickElement,
      args: [ref]
    });
  }
  
  // Wait a bit for any popups to appear
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Detect popups if enabled
  if (detectPopups) {
    const popupInfo = await detectPopupsInTab(activeTabId);
    return popupInfo;
  }
  
  return {};
});

messageHandlers.set('dom.hover', async ({ ref }) => {
  await chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    func: hoverElement,
    args: [ref]
  });
  return {};
});

messageHandlers.set('dom.type', async ({ ref, text, submit }) => {
  // Check if scripts are already injected by testing for __elementTracker
  const [checkResult] = await chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    func: () => typeof window.__elementTracker !== 'undefined'
  });
  
  // Only inject if not already present
  if (!checkResult.result) {
    await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      files: ['element-tracker.js', 'element-validator.js']
    });
  }
  
  await chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    func: typeInElement,
    args: [ref, text, submit]
  });
  return {};
});

messageHandlers.set('dom.select', async ({ ref, values }) => {
  await chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    func: selectOptions,
    args: [ref, values]
  });
  return {};
});

messageHandlers.set('keyboard.press', async ({ key }) => {
  await chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    func: pressKey,
    args: [key]
  });
  return {};
});

// Add handler for browser_press_key (MCP server compatibility)
messageHandlers.set('browser_press_key', async ({ key }) => {
  // Handle special browser-level keys
  if (key === 'F12' || key === 'f12') {
    // Use Chrome Debugger API to simulate DevTools opening
    // Note: We can't actually open DevTools, but we can attach debugger which shows a bar
    if (!debuggerStateManager.isAttached(activeTabId)) {
      try {
        await debuggerStateManager.ensureAttached(activeTabId, ["runtime", "console"]);
        return { message: "Debugger attached (DevTools simulation). Chrome shows debugging bar." };
      } catch (error) {
        return { error: `Could not attach debugger: ${error.message}` };
      }
    } else {
      // If already attached, detach
      await debuggerStateManager.ensureDetached(activeTabId);
      return { message: "Debugger detached" };
    }
  }

  // Try to use debugger Input API for more powerful key simulation if debugger is attached
  if (debuggerStateManager.isAttached(activeTabId)) {
    try {
      // Parse key for debugger API
      let keyCode = key;
      const modifiers = [];
      
      if (key.includes('+')) {
        const parts = key.split('+');
        keyCode = parts[parts.length - 1];
        if (parts.includes('Ctrl') || parts.includes('Control')) modifiers.push(1); // Ctrl
        if (parts.includes('Shift')) modifiers.push(2); // Shift
        if (parts.includes('Alt')) modifiers.push(4); // Alt
        if (parts.includes('Meta') || parts.includes('Cmd')) modifiers.push(8); // Meta
      }
      
      // Use Input.dispatchKeyEvent for more powerful key simulation
      await chrome.debugger.sendCommand({ tabId: activeTabId }, "Input.dispatchKeyEvent", {
        type: "keyDown",
        key: keyCode,
        code: keyCode,
        modifiers: modifiers.reduce((a, b) => a | b, 0)
      });
      
      await chrome.debugger.sendCommand({ tabId: activeTabId }, "Input.dispatchKeyEvent", {
        type: "keyUp",
        key: keyCode,
        code: keyCode,
        modifiers: modifiers.reduce((a, b) => a | b, 0)
      });
      
      return { message: `Key pressed via debugger: ${key}` };
    } catch (error) {
      console.log('Debugger key dispatch failed, falling back to script injection:', error);
    }
  }
  
  // For regular keys or if debugger fails, use the standard approach
  await chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    func: pressKey,
    args: [key]
  });
  return {};
});

messageHandlers.set('console.get', async ({ filter = null, type = null, limit = 1000 } = {}) => {
  // Ensure we have an active tab
  if (!activeTabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = tab?.id;
  }

  if (!activeTabId) {
    return { logs: [], error: "No active tab" };
  }

  // Bootstrap debugger if not already attached (this enables early capture)
  if (globalThis.__debuggerStateManager) {
    try {
      await globalThis.__debuggerStateManager.bootstrapDebugger(activeTabId);

      // Get console data from debugger
      const data = globalThis.__debuggerStateManager.getTabData(activeTabId);

      // Format console logs for response
      const logs = data.console.map(log => ({
        type: log.type,
        timestamp: log.timestamp,
        message: log.args ? log.args.join(' ') : '',
        args: log.args,
        stack: log.stackTrace,
        buffered: log.buffered || false
      }));

      // Also include errors as console errors
      const errorLogs = data.errors.map(err => ({
        type: 'error',
        timestamp: err.timestamp,
        message: err.message,
        args: [err.message],
        stack: err.stack,
        buffered: err.buffered || false,
        url: err.url,
        line: err.line
      }));

      // Combine and sort by timestamp
      let allLogs = [...logs, ...errorLogs].sort((a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );

      // Apply filters
      if (type) {
        // Filter by log type (log, error, warn, info, debug)
        allLogs = allLogs.filter(log => log.type === type);
      }

      if (filter) {
        // Filter by text content (case-insensitive)
        const filterLower = filter.toLowerCase();
        allLogs = allLogs.filter(log => {
          const message = log.message || '';
          const argsStr = log.args ? log.args.join(' ') : '';
          const combined = `${message} ${argsStr}`.toLowerCase();
          return combined.includes(filterLower);
        });
      }

      // Apply limit
      if (limit && limit > 0) {
        allLogs = allLogs.slice(-limit); // Get last N logs
      }

      return {
        logs: allLogs,
        debuggerAttached: true,
        capturedFromStart: true,
        totalCount: logs.length + errorLogs.length,
        filteredCount: allLogs.length
      };
    } catch (error) {
      console.error('[console.get] Failed to bootstrap debugger:', error);
      // Fall back to injected script method
    }
  }

  // Fallback: Try to get logs from injected script (won't have early logs)
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      func: getConsoleLogs
    });
    return {
      logs: result.result || [],
      debuggerAttached: false,
      capturedFromStart: false,
      warning: "Early console logs may be missing. Debugger not available."
    };
  } catch (error) {
    return {
      logs: [],
      error: "Failed to get console logs: " + error.message
    };
  }
});

// Helper function to capture full page by scrolling (with infinite scroll detection)
async function captureFullPage(tabId, options = {}) {
  const {
    format = 'jpeg',
    quality = 90,
    scrollDelay = 500,
    maxHeight = 20000,
    maxScreenshots = 20,  // Maximum viewports to capture
    quietMs = 800,        // Wait for DOM to settle
    growTolerance = 150   // Pixels to consider as growth
  } = options;

  try {
    // First, detect if page has infinite scroll with multiple attempts
    const [infiniteCheck] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (growTolerance) => {
        // Better infinite scroll detection with multiple attempts
        async function detectInfinite(attempts = 3, deltaTolerance = 300) {
          let prev = document.body.scrollHeight;

          for (let i = 0; i < attempts; i++) {
            // Scroll to 80-90% of current height, not all the way down
            window.scrollTo(0, prev - window.innerHeight * 0.2);
            await new Promise(r => setTimeout(r, 800));

            const curr = document.body.scrollHeight;
            if (curr - prev > deltaTolerance) {
              return true; // likely infinite
            }
            prev = curr;
          }
          return false; // did not grow enough across several tries
        }

        const isInfinite = await detectInfinite(3, growTolerance);
        const initialHeight = document.body.scrollHeight;

        // Scroll back to top
        window.scrollTo(0, 0);

        return {
          isInfinite: isInfinite,
          initialHeight: initialHeight
        };
      },
      args: [growTolerance]
    });

    const isInfiniteScroll = infiniteCheck.result.isInfinite;
    console.log('Infinite scroll detected:', isInfiniteScroll);

    // Get initial page dimensions
    const [pageInfo] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const body = document.body;
        const html = document.documentElement;
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;

        // Hide fixed/sticky elements to avoid duplicates
        const fixedElements = Array.from(document.querySelectorAll('*')).filter(el => {
          const style = getComputedStyle(el);
          return (style.position === 'fixed' || style.position === 'sticky') &&
                 parseInt(style.height, 10) < 200;
        });

        // Store original display values and hide elements
        fixedElements.forEach(el => {
          el.dataset.__originalDisplay = el.style.display || '';
          el.style.display = 'none';
        });

        // Save current scroll position
        const originalScrollY = window.scrollY;
        const originalScrollX = window.scrollX;

        return {
          viewportHeight,
          viewportWidth,
          originalScrollY,
          originalScrollX,
          fixedElementCount: fixedElements.length
        };
      }
    });

    const { viewportHeight, viewportWidth, originalScrollY } = pageInfo.result;
    const screenshots = [];
    let currentOffset = 0;
    let capturedScreens = 0;
    let totalCapturedHeight = 0;

    console.log(`Full page capture started. Infinite scroll: ${isInfiniteScroll}`);

    // Capture loop with smart stopping conditions
    let reachedEnd = false;
    while (capturedScreens < maxScreenshots && totalCapturedHeight < maxHeight && !reachedEnd) {
      // ALWAYS capture visible area FIRST (before checking stop conditions)
      const dataUrl = await chrome.tabs.captureVisibleTab(null, {
        format: format === 'webp' ? 'png' : format,
        quality: format === 'jpeg' ? quality : undefined
      });

      screenshots.push({
        dataUrl,
        offsetY: currentOffset
      });

      capturedScreens++;
      totalCapturedHeight += viewportHeight;

      // Check if we're near/at the bottom BEFORE scrolling further
      const [bottomCheck] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 2;
          return nearBottom;
        }
      });

      if (bottomCheck.result) {
        // We're at the bottom
        if (isInfiniteScroll) {
          // For infinite scroll, wait to see if more content loads
          const [growthCheck] = await chrome.scripting.executeScript({
            target: { tabId },
            func: async (timeout, tolerance) => {
              const before = document.body.scrollHeight;
              await new Promise(r => setTimeout(r, timeout));
              return document.body.scrollHeight - before > tolerance;
            },
            args: [1200, growTolerance]
          });

          if (!growthCheck.result) {
            console.log('No more content on infinite scroll, stopping');
            reachedEnd = true;
          }
        } else {
          // Regular site, we're done
          console.log('Reached end of regular page');
          reachedEnd = true;
        }
      }

      if (!reachedEnd) {
        // Scroll down for next capture
        currentOffset += viewportHeight;
        const [scrollResult] = await chrome.scripting.executeScript({
          target: { tabId },
          func: (scrollAmount) => {
            window.scrollBy(0, scrollAmount);

          },
          args: [viewportHeight]
        });

        // Brief wait for smooth scrolling
        await new Promise(resolve => setTimeout(resolve, scrollDelay));
      }
    }

    console.log(`Captured ${screenshots.length} screenshots, total height: ${totalCapturedHeight}px`);

    // Final defensive capture to ensure we got the footer
    if (!reachedEnd && screenshots.length < maxScreenshots) {
      console.log('Adding final defensive capture for footer');
      const finalDataUrl = await chrome.tabs.captureVisibleTab(null, {
        format: format === 'webp' ? 'png' : format,
        quality: format === 'jpeg' ? quality : undefined
      });

      screenshots.push({
        dataUrl: finalDataUrl,
        offsetY: currentOffset
      });
    }

    // Restore original scroll position and unhide fixed elements
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (scrollY) => {
        window.scrollTo(0, scrollY);

        // Restore fixed/sticky elements
        document.querySelectorAll('[data-__original-display]').forEach(el => {
          el.style.display = el.dataset.__originalDisplay;
          delete el.dataset.__originalDisplay;
        });
      },
      args: [originalScrollY]
    });

    // If only one screenshot, return it directly
    if (screenshots.length === 1) {
      return screenshots[0].dataUrl;
    }

    // Stitch screenshots together using offscreen document
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Stitch multiple screenshots for full page capture'
    });

    // Send screenshots to offscreen for stitching
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.onMessage.addListener(function listener(msg) {
        if (msg.type === 'fullpage-stitched') {
          chrome.runtime.onMessage.removeListener(listener);
          chrome.offscreen.closeDocument();
          resolve(msg.data);
        } else if (msg.type === 'stitch-error') {
          chrome.runtime.onMessage.removeListener(listener);
          chrome.offscreen.closeDocument();
          reject(new Error(msg.error));
        }
      });

      chrome.runtime.sendMessage({
        type: 'stitch-screenshots',
        data: {
          screenshots,
          totalHeight: totalCapturedHeight,
          viewportWidth: viewportWidth,
          viewportHeight,
          format,
          quality
        }
      });
    });

    return response.dataUrl;

  } catch (error) {
    console.error('Full page capture failed:', error);
    // Fall back to viewport capture
    return await chrome.tabs.captureVisibleTab(null, {
      format: format === 'webp' ? 'png' : format,
      quality: format === 'jpeg' ? quality : undefined
    });
  }
}

messageHandlers.set('screenshot.capture', async () => {
  // Capture as JPEG for smaller file size (better compression)
  // Quality 90 provides good balance between size and quality
  const dataUrl = await chrome.tabs.captureVisibleTab(null, { 
    format: 'jpeg',
    quality: 90 
  });
  const base64 = dataUrl.split(',')[1];
  return { data: base64, mimeType: 'image/jpeg' };
});

// Add handler for browser_screenshot (MCP server compatibility)
messageHandlers.set('browser_screenshot', async (params = {}) => {
  try {
    // Ensure we have an active tab
    if (!activeTabId) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        activeTabId = tab.id;
      }
    }

    console.log('Taking screenshot of tab:', activeTabId, 'with params:', params);

    // Parse parameters with defaults
    const {
      format = 'jpeg',
      quality = 80,  // JPEG quality (1-100)
      captureMode = 'viewport',
      maxWidth,
      maxHeight,
      scaleFactor,
      region,
      grayscale = false,
      blur = 0,
      removeBackground = false,
      optimize = true,
      targetSizeKB
    } = params;

    let dataUrl;
    let originalSizeKB = 0;

    // Capture based on mode
    if (captureMode === 'fullpage') {
      // Full page capture with scrolling
      console.log('Starting full page capture with scrolling');
      dataUrl = await captureFullPage(activeTabId, {
        format: format === 'webp' ? 'png' : format,
        quality: format === 'jpeg' ? quality : undefined,
        scrollDelay: params.fullPageScrollDelay || 500,
        maxHeight: params.fullPageMaxHeight || 20000,
        maxScreenshots: 20,  // Max 20 viewports for infinite scroll
        quietMs: 800,        // Wait for DOM to settle
        growTolerance: 150   // Pixels to consider as growth
      });
    } else if (captureMode === 'region' && region) {
      // Region capture would need content script coordination
      // For now, capture viewport and note for future implementation
      console.warn('Region capture not yet implemented, using viewport');
      dataUrl = await chrome.tabs.captureVisibleTab(null, {
        format: format === 'webp' ? 'png' : format,
        quality: format === 'jpeg' ? quality : undefined
      });
    } else {
      // Viewport capture (default)
      dataUrl = await chrome.tabs.captureVisibleTab(null, {
        format: format === 'webp' ? 'png' : format,
        quality: format === 'jpeg' ? quality : undefined
      });
    }

    console.log('Initial capture - Data URL length:', dataUrl ? dataUrl.length : 0);

    // Process the image if resizing or other modifications are needed
    if (maxWidth || maxHeight || scaleFactor || targetSizeKB || (grayscale && format === 'jpeg')) {
      try {
        // Create offscreen document for image processing
        await chrome.offscreen.createDocument({
          url: 'offscreen.html',
          reasons: ['BLOBS'],
          justification: 'Process and resize screenshot images'
        }).catch(() => {
          // Document might already exist, that's fine
          console.log('Offscreen document already exists');
        });

        // Send image for processing
        const processedResult = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Image processing timeout'));
          }, 10000);

          const listener = (message) => {
            if (message.type === 'image-processed') {
              clearTimeout(timeout);
              chrome.runtime.onMessage.removeListener(listener);
              resolve(message.data);
            } else if (message.type === 'image-error') {
              clearTimeout(timeout);
              chrome.runtime.onMessage.removeListener(listener);
              reject(new Error(message.error));
            }
          };

          chrome.runtime.onMessage.addListener(listener);

          // Send to offscreen document
          chrome.runtime.sendMessage({
            type: 'process-image',
            data: {
              dataUrl,
              format,
              quality,
              maxWidth,
              maxHeight,
              scaleFactor,
              grayscale,
              targetSizeKB
            }
          });
        });

        originalSizeKB = Math.round(dataUrl.length * 0.75 / 1024);
        dataUrl = processedResult.dataUrl;
        console.log(`Image processed: ${processedResult.width}x${processedResult.height}, ` +
                    `original: ${processedResult.originalWidth}x${processedResult.originalHeight}, ` +
                    `size: ${processedResult.sizeKB}KB (was ${originalSizeKB}KB)`);

      } catch (error) {
        console.error('Image processing failed:', error);
        console.warn('Falling back to original image');
        // Continue with original image if processing fails
      }
    }

    // Extract base64 and MIME type from data URL
    const [header, base64] = dataUrl.split(',');
    const mimeType = header.match(/data:([^;]+)/)?.[1] || `image/${format}`;
    const finalSizeKB = Math.round(base64.length * 0.75 / 1024);

    console.log(`Screenshot complete - Format: ${format}, Size: ${finalSizeKB}KB, Quality: ${quality}`);

    if (!base64) {
      console.error('Screenshot captured but no base64 data found');
      return { error: 'Screenshot captured but no data found' };
    }

    return {
      data: base64,
      mimeType: mimeType,
      originalSizeKB: originalSizeKB || finalSizeKB
    };
  } catch (error) {
    console.error('Screenshot failed:', error);
    return { error: `Screenshot failed: ${error.message}` };
  }
});

messageHandlers.set('page.navigate', async ({ url }) => {
  await chrome.tabs.update(activeTabId, { url });
  // Wait for navigation to complete
  await waitForTabComplete(activeTabId);
  return {};
});

// Add handlers for browser_* message types (MCP server compatibility)
messageHandlers.set('browser_navigate', async ({ url, detectPopups = true, captureEarlyErrors = false }) => {
  // If captureEarlyErrors is true, attach debugger BEFORE navigation
  if (captureEarlyErrors && globalThis.__debuggerStateManager) {
    console.log('[browser_navigate] Enabling early error capture mode');

    // Get or create tab
    if (!activeTabId) {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab) {
        activeTabId = activeTab.id;
      } else {
        // Create a new tab if no active tab
        const newTab = await chrome.tabs.create({ url: 'about:blank' });
        activeTabId = newTab.id;
      }
    }

    // Attach debugger before navigation to capture early errors
    try {
      await globalThis.__debuggerStateManager.ensureAttached(activeTabId, ["console", "runtime", "network"]);
      console.log('[browser_navigate] Debugger attached, navigating with early capture enabled');
    } catch (e) {
      console.warn('[browser_navigate] Could not attach debugger for early capture:', e.message);
    }

    // Now navigate with debugger already attached
    await chrome.tabs.update(activeTabId, { url });
    await waitForTabComplete(activeTabId);

    // Detect popups if enabled
    if (detectPopups) {
      const popupResult = await detectPopupsInTab(activeTabId);
      return { popupDetectionResult: popupResult };
    }

    return {};
  }

  // Normal navigation without early error capture
  // Get active tab if not set
  if (!activeTabId) {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab) {
      activeTabId = activeTab.id;
    } else {
      // Create a new tab if no active tab
      const newTab = await chrome.tabs.create({ url });
      activeTabId = newTab.id;
      await waitForTabComplete(activeTabId);

      // Detect popups if enabled
      if (detectPopups) {
        // Wait a bit for popups to appear (they often load after page complete)
        await new Promise(resolve => setTimeout(resolve, 1000));
        const popupInfo = await detectPopupsInTab(activeTabId);
        lastPopupDetection = popupInfo; // Store for later use
        return popupInfo;
      }
      return {};
    }
  }
  
  await chrome.tabs.update(activeTabId, { url });
  // Wait for navigation to complete
  await waitForTabComplete(activeTabId);
  
  // Detect popups if enabled
  if (detectPopups) {
    console.log('[browser_navigate] Waiting for popups to appear...');
    // Wait a bit for popups to appear (they often load after page complete)
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log('[browser_navigate] Calling detectPopupsInTab...');
    const popupInfo = await detectPopupsInTab(activeTabId);
    console.log('[browser_navigate] Popup info received:', popupInfo);
    lastPopupDetection = popupInfo; // Store for later use
    return popupInfo;
  }
  
  return {};
});

// Helper function to detect popups in a tab
async function detectPopupsInTab(tabId) {
  console.log('[detectPopupsInTab] Starting popup detection for tab:', tabId);
  
  try {
    // First try to send message to content script
    const response = await chrome.tabs.sendMessage(tabId, { type: 'detectPopups' });
    console.log('[detectPopupsInTab] Got response from content script:', response);
    return response || {};
  } catch (error) {
    console.log('[detectPopupsInTab] Content script not loaded, error:', error.message);
    console.log('[detectPopupsInTab] Injecting scripts...');
    
    // Inject required content scripts if not loaded
    try {
      // Inject simple popup detector
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['popup-detector-simple.js']
      });
      console.log('[detectPopupsInTab] Injected popup-detector-simple.js');
      
      // Also inject other required scripts
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['element-tracker.js', 'element-validator.js', 'code-executor-rpc.js', 'content.js']
      });
      console.log('[detectPopupsInTab] Injected all other scripts');
      
      // Wait a bit for scripts to initialize
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Now try again
      try {
        const response = await chrome.tabs.sendMessage(tabId, { type: 'detectPopups' });
        console.log('[detectPopupsInTab] Got response after injection:', response);
        return response || {};
      } catch (retryError) {
        console.error('[detectPopupsInTab] Failed after injecting scripts:', retryError);
        return { error: 'Failed to detect popups after injection', details: retryError.message };
      }
    } catch (injectError) {
      console.error('[detectPopupsInTab] Failed to inject content scripts:', injectError);
      return { error: 'Failed to inject content scripts', details: injectError.message };
    }
  }
}

// Helper function to wait for tab to finish loading
async function waitForTabComplete(tabId, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error(`Tab load timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeoutId);
        resolve();
      }
    };
    
    // Check if already complete
    chrome.tabs.get(tabId, (tab) => {
      if (tab.status === 'complete') {
        clearTimeout(timeoutId);
        resolve();
      } else {
        chrome.tabs.onUpdated.addListener(listener);
      }
    });
  });
}

messageHandlers.set('page.goBack', async () => {
  if (!activeTabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = tab?.id;
  }
  
  if (!activeTabId) {
    throw new Error('No active tab');
  }
  
  try {
    await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      func: () => window.history.back()
    });
    
    // Wait for navigation to complete
    await waitForTabComplete(activeTabId);
  } catch (error) {
    // Fallback to debugger API for CSP-restricted sites
    if (error.message.includes('Cannot access')) {
      try {
        await chrome.debugger.attach({ tabId: activeTabId }, "1.3");
        await chrome.debugger.sendCommand({ tabId: activeTabId }, "Page.navigateBack", {});
        await waitForTabComplete(activeTabId);
        await chrome.debugger.detach({ tabId: activeTabId });
      } catch (debuggerError) {
        throw new Error(`Navigation failed: ${error.message}. Debugger fallback also failed: ${debuggerError.message}`);
      }
    } else {
      throw error;
    }
  }
  
  return {};
});

// Handler for clicking popup elements
messageHandlers.set('browser_click_popup', async ({ ref }) => {
  if (!activeTabId) {
    throw new Error('No active tab');
  }
  
  try {
    const response = await chrome.tabs.sendMessage(activeTabId, {
      type: 'clickPopupElement',
      ref
    });
    return response || { clicked: false };
  } catch (error) {
    console.error('Error clicking popup element:', error);
    return { error: error.message };
  }
});

messageHandlers.set('browser_go_back', async () => {
  // Delegate to the same handler
  return await messageHandlers.get('page.goBack')();
});

messageHandlers.set('page.goForward', async () => {
  if (!activeTabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = tab?.id;
  }
  
  if (!activeTabId) {
    throw new Error('No active tab');
  }
  
  try {
    await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      func: () => window.history.forward()
    });
    
    // Wait for navigation to complete
    await waitForTabComplete(activeTabId);
  } catch (error) {
    // Fallback to debugger API for CSP-restricted sites
    if (error.message.includes('Cannot access')) {
      try {
        await chrome.debugger.attach({ tabId: activeTabId }, "1.3");
        await chrome.debugger.sendCommand({ tabId: activeTabId }, "Page.navigateForward", {});
        await waitForTabComplete(activeTabId);
        await chrome.debugger.detach({ tabId: activeTabId });
      } catch (debuggerError) {
        throw new Error(`Navigation failed: ${error.message}. Debugger fallback also failed: ${debuggerError.message}`);
      }
    } else {
      throw error;
    }
  }
  
  return {};
});

messageHandlers.set('browser_go_forward', async () => {
  // Delegate to the same handler
  return await messageHandlers.get('page.goForward')();
});

messageHandlers.set('page.wait', async ({ time }) => {
  await new Promise(resolve => setTimeout(resolve, time * 1000));
  return {};
});

messageHandlers.set('browser_wait', async ({ time }) => {
  await new Promise(resolve => setTimeout(resolve, time * 1000));
  return {};
});

// Import debugger state manager
importScripts('debugger-state-manager.js');

// Use the global debugger state manager instance
const debuggerStateManager = globalThis.__debuggerStateManager;

// Debugger message handlers using the new state manager
messageHandlers.set('debugger.attach', async ({ domains = ["console", "network", "performance", "runtime"] }) => {
  try {
    const result = await debuggerStateManager.ensureAttached(activeTabId, domains);
    return result;
  } catch (error) {
    console.error('[debugger.attach] Failed:', error);
    return { error: error.message };
  }
});

messageHandlers.set('debugger.detach', async () => {
  try {
    const result = await debuggerStateManager.ensureDetached(activeTabId);
    return result;
  } catch (error) {
    console.error('[debugger.detach] Failed:', error);
    return { error: error.message };
  }
});

messageHandlers.set('debugger.getData', async ({ type, limit = 50, filter }) => {
  try {
    const result = await debuggerStateManager.getData(activeTabId, type, limit, filter);
    return result;
  } catch (error) {
    console.error('[debugger.getData] Failed:', error);
    return { error: error.message };
  }
});

// Note: Debugger event listening is now handled by the debuggerStateManager

// Token estimation helper
function estimateTokens(text) {
  // Rough estimate: ~4 chars per token
  return Math.ceil((text || '').length / 4);
}

// Expand specific region with token budget
function expandRegion(refId, options = {}) {
  const maxTokens = options.maxTokens || 5000;
  const depth = options.depth || 2;
  const filter = options.filter || 'all'; // all, interactive, text
  
  const element = window.__elementTracker.getElementById(refId);
  if (!element) {
    return `Error: Element with ref ${refId} not found`;
  }
  
  let output = `Expanding region [ref=${refId}]:\n\n`;
  let tokenCount = estimateTokens(output);
  const tokenBudget = maxTokens;
  
  function traverse(el, currentDepth, indent = '') {
    if (currentDepth > depth || tokenCount > tokenBudget) {
      return;
    }
    
    // Skip if not matching filter
    if (filter === 'interactive') {
      const isInteractive = el.matches('a, button, input, select, textarea, [role="button"], [onclick]');
      if (!isInteractive && el.querySelectorAll('a, button, input, select, textarea').length === 0) {
        return;
      }
    }
    
    const role = el.getAttribute('role') || el.tagName.toLowerCase();
    const text = el.textContent?.trim().substring(0, 100) || '';
    const elementRef = window.__elementTracker.getElementId(el);
    
    let line = `${indent}${role} [ref=${elementRef}]`;
    
    // Add specific attributes for interactive elements
    if (el.tagName === 'A') {
      line += ` {href: "${el.href}"}`;
    } else if (el.tagName === 'INPUT') {
      line += ` {type: ${el.type}, value: "${el.value?.substring(0, 50) || ''}"}`;
    } else if (el.tagName === 'BUTTON') {
      line += ` "${text}"`;
    }
    
    line += '\n';
    
    // Check if adding this would exceed budget
    const lineTokens = estimateTokens(line);
    if (tokenCount + lineTokens > tokenBudget) {
      output += indent + '[... truncated due to token limit ...]\n';
      tokenCount = tokenBudget + 1;
      return;
    }
    
    output += line;
    tokenCount += lineTokens;
    
    // Traverse children
    if (currentDepth < depth) {
      const children = Array.from(el.children);
      for (const child of children) {
        traverse(child, currentDepth + 1, indent + '  ');
        if (tokenCount > tokenBudget) break;
      }
    }
  }
  
  traverse(element, 0);
  
  output += `\n[Tokens used: ~${tokenCount}/${maxTokens}]\n`;
  return output;
}

// Query elements by various criteria
function queryElements(options = {}) {
  const { selector = '*', containing = '', nearRef = null, limit = 20 } = options;
  
  try {
    let elements = Array.from(document.querySelectorAll(selector));
    
    // Filter by text content
    if (containing) {
      const searchText = containing.toLowerCase();
      elements = elements.filter(el => {
        const text = (el.textContent || el.value || el.placeholder || '').toLowerCase();
        return text.includes(searchText);
      });
    }
    
    // Sort by proximity to reference element
    if (nearRef) {
      const refElement = window.__elementTracker.getElementById(nearRef);
      if (refElement) {
        const refRect = refElement.getBoundingClientRect();
        const refX = refRect.left + refRect.width / 2;
        const refY = refRect.top + refRect.height / 2;
        
        elements.sort((a, b) => {
          const aRect = a.getBoundingClientRect();
          const aX = aRect.left + aRect.width / 2;
          const aY = aRect.top + aRect.height / 2;
          const aDist = Math.sqrt(Math.pow(aX - refX, 2) + Math.pow(aY - refY, 2));
          
          const bRect = b.getBoundingClientRect();
          const bX = bRect.left + bRect.width / 2;
          const bY = bRect.top + bRect.height / 2;
          const bDist = Math.sqrt(Math.pow(bX - refX, 2) + Math.pow(bY - refY, 2));
          
          return aDist - bDist;
        });
      }
    }
    
    // Limit results
    elements = elements.slice(0, limit);
    
    // Format output
    let output = `Found ${elements.length} elements:\n\n`;
  
    elements.forEach(el => {
      const ref = window.__elementTracker.getElementId(el);
      const role = el.tagName.toLowerCase();
      const text = (el.textContent || el.value || '').trim().substring(0, 100);
      
      output += `${role} [ref=${ref}]`;
      if (text) {
        output += ` "${text}"`;
      }
      if (el.href) {
        output += ` {href: "${el.href}"}`;
      }
      output += '\n';
    });
    
    return output || 'No elements found';
  } catch (error) {
    console.error('Error in queryElements:', error);
    return `Error querying elements: ${error.message}`;
  }
}

// Functions to inject into page
function captureAccessibilitySnapshot(options = {}) {
  // Enhanced implementation with stable element IDs and better formatting
  function isVisible(element) {
    if (element === document.body) return true;
    
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (style.opacity === '0') return false;
    
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    
    return true;
  }
  
  function getAccessibleName(element) {
    // Priority order for accessible name
    if (element.getAttribute('aria-label')) {
      return element.getAttribute('aria-label');
    }
    
    if (element.getAttribute('aria-labelledby')) {
      const labelId = element.getAttribute('aria-labelledby');
      const label = document.getElementById(labelId);
      if (label) return label.textContent.trim();
    }
    
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT') {
      const label = element.labels?.[0];
      if (label) return label.textContent.trim();
      if (element.placeholder) return element.placeholder;
    }
    
    if (element.getAttribute('alt')) {
      return element.getAttribute('alt');
    }
    
    if (element.getAttribute('title')) {
      return element.getAttribute('title');
    }
    
    // For buttons and links, use text content
    if (['BUTTON', 'A'].includes(element.tagName)) {
      const text = element.textContent.trim();
      if (text && text.length < 100) return text;
    }
    
    // Default to text content but limit length
    return element.textContent?.trim().substring(0, 60) || '';
  }
  
  function getRole(element) {
    // Use explicit role if available
    if (element.getAttribute('role')) {
      return element.getAttribute('role');
    }
    
    // Map HTML elements to implicit roles
    const tagName = element.tagName.toLowerCase();
    const roleMap = {
      'a': element.href ? 'link' : 'generic',
      'button': 'button',
      'input': element.type === 'submit' || element.type === 'button' ? 'button' : 'textbox',
      'textarea': 'textbox',
      'select': 'combobox',
      'option': 'option',
      'img': 'img',
      'h1': 'heading',
      'h2': 'heading',
      'h3': 'heading',
      'h4': 'heading',
      'h5': 'heading',
      'h6': 'heading',
      'nav': 'navigation',
      'main': 'main',
      'header': 'banner',
      'footer': 'contentinfo',
      'aside': 'complementary',
      'section': 'region',
      'article': 'article',
      'form': 'form',
      'table': 'table',
      'ul': 'list',
      'ol': 'list',
      'li': 'listitem'
    };
    
    return roleMap[tagName] || tagName;
  }
  
  // Check if element should be included based on mode
  // REMOVED obsolete shouldInclude function - minimal mode now handled by minimal-enhanced.js
  
  // Check if element is in viewport (with buffer)
  function isInViewport(element) {
    if (options.viewportOnly) {
      const rect = element.getBoundingClientRect();
      const buffer = window.innerHeight; // Include one viewport height as buffer
      return (
        rect.bottom >= -buffer &&
        rect.top <= window.innerHeight + buffer &&
        rect.right >= 0 &&
        rect.left <= window.innerWidth
      );
    }
    return true;
  }
  
  function traverse(element, depth = 0, isAncestorOfInteractive = false) {
    // Skip invisible elements
    if (!isVisible(element)) {
      return '';
    }
    
    // Skip if not in viewport (when viewportOnly is enabled)
    if (!isInViewport(element)) {
      return '';
    }
    
    // REMOVED obsolete minimal mode check - now handled by minimal-enhanced.js
    // This function now only handles FULL mode
    
    const role = getRole(element);
    const name = getAccessibleName(element);
    const elementId = window.__elementTracker.getElementId(element);
    
    // Format similar to Playwright: role "name" [ref=123]
    let result = '  '.repeat(depth) + `${role}`;
    if (name) {
      result += ` "${name}"`;
    }
    result += ` [ref=${elementId}]`;
    
    // Add state information for interactive elements
    const states = [];
    if (element.disabled) states.push('disabled');
    if (element.checked) states.push('checked');
    if (element.selected) states.push('selected');
    if (element.required) states.push('required');
    if (element.readOnly) states.push('readonly');
    if (states.length > 0) {
      result += ` [${states.join(', ')}]`;
    }
    
    // Add additional context for specific elements
    if (element.tagName === 'INPUT') {
      result += ` {type: ${element.type}`;
      if (element.value && element.type !== 'password') {
        result += `, value: "${element.value.substring(0, 50)}"`;
      }
      result += `}`;
    } else if (element.tagName === 'A' && element.href) {
      result += ` {href: "${element.href}"}`;
    } else if (element.tagName === 'IMG' && element.src) {
      result += ` {src: "${element.src}"}`;
    }
    
    // Skip traversing children for certain elements
    const skipChildren = ['input', 'textarea', 'select', 'img', 'br', 'hr'];
    if (!skipChildren.includes(element.tagName.toLowerCase())) {
      const children = Array.from(element.children);
      for (const child of children) {
        const childResult = traverse(child, depth + 1, isAncestorOfInteractive);
        if (childResult) {
          result += '\n' + childResult;
        }
      }
    }
    
    return result;
  }
  
  // Add page context at the top
  const pageInfo = `Page: ${document.title || 'Untitled'}\nURL: ${window.location.href}\n`;
  
  // This function now only handles FULL mode - minimal mode is handled by minimal-enhanced.js
  const viewportInfo = options.viewportOnly ? '[Viewport filtering enabled]\n' : '';
  
  return pageInfo + viewportInfo + '\n' + traverse(document.body);
}

function queryElements(selector, all) {
  const elements = all ? 
    document.querySelectorAll(selector) : 
    [document.querySelector(selector)].filter(Boolean);
    
  return Array.from(elements).map((el, index) => ({
    ref: `${selector}[${index}]`,
    element: el.tagName.toLowerCase() + (el.textContent ? `: ${el.textContent.substring(0, 50)}` : '')
  }));
}

function clickElement(ref) {
  // Validate element exists and is clickable
  const validation = window.__elementValidator.validateElement(ref);
  if (!validation.valid) {
    throw new Error(`Click validation failed: ${validation.error}`);
  }
  
  const element = validation.element;
  
  // Check if element is interactable
  if (!window.__elementValidator.canInteract(element)) {
    throw new Error(`Element ${ref} is not interactable`);
  }
  
  // Scroll element into view if needed
  if (!window.__elementValidator.isVisible(element)) {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Wait a bit for scroll to complete
    return new Promise(resolve => {
      setTimeout(() => {
        element.click();
        resolve(true);
      }, 300);
    });
  }
  
  element.click();
  return true;
}

function hoverElement(ref) {
  // Validate element exists
  const validation = window.__elementValidator.validateElement(ref);
  if (!validation.valid) {
    throw new Error(`Hover validation failed: ${validation.error}`);
  }
  
  const element = validation.element;
  
  // Scroll element into view if needed
  if (!window.__elementValidator.isVisible(element)) {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  
  const event = new MouseEvent('mouseover', {
    view: window,
    bubbles: true,
    cancelable: true
  });
  element.dispatchEvent(event);
  return true;
}

function typeInElement(ref, text, submit) {
  // Validate element exists and is an input
  const validation = window.__elementValidator.validateElement(ref, {
    tagName: ['INPUT', 'TEXTAREA']
  });
  if (!validation.valid) {
    // Check if it's a contenteditable element
    const generalValidation = window.__elementValidator.validateElement(ref);
    if (generalValidation.valid && generalValidation.element.contentEditable === 'true') {
      const element = generalValidation.element;
      element.focus();
      element.textContent = text;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    throw new Error(`Type validation failed: ${validation.error}`);
  }
  
  const element = validation.element;
  
  // Check if input is not disabled or readonly
  if (element.disabled) {
    throw new Error(`Input element ${ref} is disabled`);
  }
  if (element.readOnly) {
    throw new Error(`Input element ${ref} is readonly`);
  }
  
  // Scroll into view and focus
  if (!window.__elementValidator.isVisible(element)) {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  
  element.focus();
  element.value = text;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  
  if (submit) {
    const form = element.closest('form');
    if (form) {
      form.submit();
    } else {
      element.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter' }));
    }
  }
  return true;
}

function selectOptions(ref, values) {
  // Validate element exists and is a select
  const validation = window.__elementValidator.validateElement(ref, {
    tagName: 'SELECT'
  });
  if (!validation.valid) {
    throw new Error(`Select validation failed: ${validation.error}`);
  }
  
  const element = validation.element;
  
  // Check if select is not disabled
  if (element.disabled) {
    throw new Error(`Select element ${ref} is disabled`);
  }
  
  // Scroll into view if needed
  if (!window.__elementValidator.isVisible(element)) {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  
  // Validate values exist as options
  const validValues = [];
  const invalidValues = [];
  
  for (const value of values) {
    const optionExists = Array.from(element.options).some(opt => opt.value === value);
    if (optionExists) {
      validValues.push(value);
    } else {
      invalidValues.push(value);
    }
  }
  
  if (invalidValues.length > 0) {
    console.warn(`Select options not found: ${invalidValues.join(', ')}`);
  }
  
  if (validValues.length === 0) {
    throw new Error(`None of the provided values exist as options in the select element`);
  }
  
  // Select the valid options
  for (const option of element.options) {
    option.selected = validValues.includes(option.value);
  }
  
  element.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function pressKey(key) {
  // Enhanced key press with modifier support
  const keyEvent = { key, bubbles: true, cancelable: true };
  
  // Parse modifiers from key string (e.g., "Ctrl+Shift+I")
  const parts = key.split('+');
  if (parts.length > 1) {
    const actualKey = parts[parts.length - 1];
    keyEvent.key = actualKey;
    keyEvent.ctrlKey = parts.includes('Ctrl') || parts.includes('Control');
    keyEvent.shiftKey = parts.includes('Shift');
    keyEvent.altKey = parts.includes('Alt');
    keyEvent.metaKey = parts.includes('Meta') || parts.includes('Cmd');
  }
  
  // Dispatch to both document and activeElement for maximum compatibility
  const targets = [document, document.activeElement].filter(Boolean);
  targets.forEach(target => {
    target.dispatchEvent(new KeyboardEvent('keydown', keyEvent));
    target.dispatchEvent(new KeyboardEvent('keypress', keyEvent));
    target.dispatchEvent(new KeyboardEvent('keyup', keyEvent));
  });
}

function getConsoleLogs() {
  // This would need to be injected earlier to capture logs
  return window.__consoleLogs || [];
}

// Initialize with disconnected icon
updateIcon(false);

// Initialize connection
connectToMCP();

// Chrome service worker keepalive
// Service workers in Chrome get killed after 30 seconds of inactivity
// This keeps it alive by setting an alarm
chrome.alarms.create('keepAlive', { periodInMinutes: 0.25 }); // Every 15 seconds

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    // Check WebSocket connection
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.log('WebSocket disconnected, attempting reconnect...');
      connectToMCP();
    }
  }
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Background] Received message from content script:', request.type, 'from tab:', sender.tab?.id);
  
  if (request.type === 'getStatus') {
    sendResponse({ connected: ws && ws.readyState === WebSocket.OPEN });
    return true;
  } else if (request.type === 'connect') {
    connectToMCP();
    // Wait a bit for connection to establish
    setTimeout(() => {
      sendResponse({ connected: ws && ws.readyState === WebSocket.OPEN });
    }, 500);
    return true; // Keep the message channel open for async response
  } else if (request.type === 'POPUP_DETECTOR_READY') {
    console.log('[Background] Popup detector ready on:', request.url);
    sendResponse({ acknowledged: true });
    return true;
  }
});

// Code execution handler
messageHandlers.set('js.execute', async ({ code, timeout = 5000, unsafe = null }) => {
  console.log(`[js.execute] Starting execution with timeout=${timeout}ms`);
  
  if (!activeTabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = tab?.id;
  }
  
  if (!activeTabId) {
    throw new Error('No active tab');
  }
  
  // Check if code executor is injected
  const [checkResult] = await chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    func: () => typeof window.__codeExecutorReady !== 'undefined'
  });
  
  if (!checkResult.result) {
    // Inject code executor (use RPC-based version with proper safe mode)
    await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      files: ['code-executor-rpc.js']
    });
    
    // Wait a bit for initialization
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // Generate execution ID
  const executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  return new Promise(async (resolve, reject) => {
    // Set timeout for execution - add small buffer for message round-trip
    const timeoutId = setTimeout(() => {
      // Try to abort execution
      chrome.tabs.sendMessage(activeTabId, {
        type: 'execute.abort',
        executionId: executionId
      }, () => {
        // Ignore abort response
      });
      reject(new Error(`Code execution timeout after ${timeout}ms`));
    }, timeout + 100); // Small buffer for message handling
    
    // Determine unsafe mode: explicit parameter > config > default (false)
    const useUnsafeMode = unsafe !== null ? unsafe : extensionConfig.unsafeMode;
    
    if (useUnsafeMode) {
      console.warn('⚠️ Executing code in UNSAFE mode - using chrome.debugger API');

      // Check if debugger is already attached via DebuggerStateManager
      const debuggerAlreadyAttached = await globalThis.__debuggerStateManager?.isAttached(activeTabId);
      let shouldDetach = false;

      try {
        // Only attach if not already attached
        if (!debuggerAlreadyAttached) {
          console.log('[execute_js] Attaching debugger for unsafe mode execution');
          await chrome.debugger.attach({ tabId: activeTabId }, "1.0");
          shouldDetach = true;
        } else {
          console.log('[execute_js] Reusing existing debugger connection from DebuggerStateManager');
        }

        try {
          // Execute code using Runtime.evaluate (bypasses CSP completely)
          const result = await chrome.debugger.sendCommand(
            { tabId: activeTabId },
            "Runtime.evaluate",
            {
              expression: code,
              returnByValue: true,
              awaitPromise: true
            }
          );

          if (result.exceptionDetails) {
            throw new Error(`Runtime error: ${result.exceptionDetails.exception.description}`);
          }

          const execResult = { result: result.result.value };
          clearTimeout(timeoutId);
          resolve(execResult);
          return;
        } finally {
          // Only detach if we attached it (not if DebuggerStateManager owns it)
          if (shouldDetach) {
            console.log('[execute_js] Detaching debugger after unsafe mode execution');
            await chrome.debugger.detach({ tabId: activeTabId });
          }
        }
      } catch (error) {
        clearTimeout(timeoutId);
        reject(error);
        return;
      }
    }
    
    // Safe mode - use content script
    chrome.tabs.sendMessage(activeTabId, {
      type: 'execute.code',
      code: code,
      timeout: timeout,
      executionId: executionId,
      unsafe: useUnsafeMode
    }, response => {
      clearTimeout(timeoutId);
      
      if (chrome.runtime.lastError) {
        // Check if it's because script isn't injected
        console.error(`[js.execute] Chrome runtime error:`, chrome.runtime.lastError);
        if (chrome.runtime.lastError.message.includes('receiving end does not exist')) {
          reject(new Error('Code executor not available. Page may not support script injection or content security policy may be blocking execution.'));
        } else {
          reject(new Error(`Communication error: ${chrome.runtime.lastError.message}`));
        }
      } else if (response && response.success) {
        console.log(`[js.execute] Success response received`);
        resolve({ result: response.result });
      } else if (response && response.error) {
        console.log(`[js.execute] Error response: ${response.error}`);
        reject(new Error(response.error));
      } else {
        console.error(`[js.execute] Invalid response:`, response);
        reject(new Error('Code execution failed: No valid response received'));
      }
    });
  });
});

// New message handlers for scaffold features
messageHandlers.set('dom.expand', async ({ ref, maxTokens = 5000, depth = 2, filter = 'all' }) => {
  if (!activeTabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = tab?.id;
  }
  
  if (!activeTabId) {
    throw new Error('No active tab');
  }
  
  // Ensure scripts are injected
  const [checkResult] = await chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    func: () => typeof window.__elementTracker !== 'undefined'
  });
  
  if (!checkResult.result) {
    await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      files: ['element-tracker.js', 'element-validator.js']
    });
  }
  
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    func: expandRegion,
    args: [ref, { maxTokens, depth, filter }]
  });
  
  return { expansion: result.result };
});

messageHandlers.set('dom.query', async ({ selector = '*', containing = '', nearRef = null, limit = 20 }) => {
  if (!activeTabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = tab?.id;
  }
  
  if (!activeTabId) {
    throw new Error('No active tab');
  }
  
  // Ensure scripts are injected
  const [checkResult] = await chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    func: () => typeof window.__elementTracker !== 'undefined'
  });
  
  if (!checkResult.result) {
    await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      files: ['element-tracker.js', 'element-validator.js']
    });
  }
  
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    func: queryElements,
    args: [{ selector, containing, nearRef, limit }]
  });
  
  return { results: result.result };
});

// Handle settings updates from options page
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'settings.updated') {
    extensionConfig = { ...extensionConfig, ...message.settings };
    console.log('Settings updated:', extensionConfig);
    
    // Store in local storage
    chrome.storage.local.set(message.settings);
    
    // Reconnect if server URL changed
    if (message.settings.serverUrl && message.settings.serverUrl !== extensionConfig.serverUrl) {
      if (ws) {
        ws.close();
      }
      connectToMCP();
    }
  }
});

// Handle extension icon click
chrome.action.onClicked.addListener((tab) => {
  activeTabId = tab.id;
  connectToMCP();
});

// Initialize on install/update
chrome.runtime.onInstalled.addListener((details) => {
  console.log('Extension installed/updated:', details.reason);
  
  // Set default icon
  updateIcon(false);
  
  // Initialize connection
  connectToMCP();
  
  // Set up periodic health check alarm (every minute)
  chrome.alarms.create('healthCheck', { periodInMinutes: 1 });
  
  // Get active tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length > 0) {
      activeTabId = tabs[0].id;
    }
  });
});

// Initialize on browser startup
chrome.runtime.onStartup.addListener(() => {
  console.log('Browser started - initializing extension');
  connectToMCP();
  
  // Get active tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length > 0) {
      activeTabId = tabs[0].id;
    }
  });
});

// Reconnect on tab activation
chrome.tabs.onActivated.addListener((activeInfo) => {
  activeTabId = activeInfo.tabId;
  
  // Ensure we're connected
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    connectToMCP();
  }
});

// Keep connection alive on idle (if API available)
if (chrome.idle && chrome.idle.onStateChanged) {
  chrome.idle.onStateChanged.addListener((state) => {
    if (state === 'active') {
      // User is active, ensure connection
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        connectToMCP();
      }
    }
  });
}

// Periodic health check
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'healthCheck') {
    // Check WebSocket connection health
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.log('Health check: Connection lost, reconnecting...');
      connectToMCP();
    } else {
      console.log('Health check: Connection healthy');
    }
  }
});

// Initialize immediately when script loads
connectToMCP();

// Get initial active tab
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs.length > 0) {
    activeTabId = tabs[0].id;
  }
});