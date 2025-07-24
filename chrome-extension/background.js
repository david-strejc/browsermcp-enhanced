// WebSocket connection to MCP server
let ws = null;
let activeTabId = null;
let messageHandlers = new Map();

// Connect to MCP server
function connectToMCP() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    return;
  }
  
  ws = new WebSocket('ws://localhost:8765');
  
  ws.onopen = () => {
    console.log('Connected to MCP server');
  };
  
  ws.onmessage = async (event) => {
    try {
      const message = JSON.parse(event.data);
      console.log('Received message:', message);
      
      if (messageHandlers.has(message.type)) {
        const handler = messageHandlers.get(message.type);
        const response = await handler(message.payload);
        
        ws.send(JSON.stringify({
          id: message.id,
          type: message.type,
          payload: response
        }));
      } else {
        ws.send(JSON.stringify({
          id: message.id,
          type: message.type,
          error: `Unknown message type: ${message.type}`
        }));
      }
    } catch (error) {
      console.error('Error handling message:', error);
      ws.send(JSON.stringify({
        id: message.id,
        error: error.message
      }));
    }
  };
  
  ws.onclose = () => {
    console.log('Disconnected from MCP server');
    // Reconnect after 5 seconds
    setTimeout(connectToMCP, 5000);
  };
  
  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
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

messageHandlers.set('tabs.new', async ({ url }) => {
  const tab = await chrome.tabs.create({ url: url || 'about:blank' });
  activeTabId = tab.id;
  return { 
    tabId: String(tab.id), 
    index: tab.index 
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
messageHandlers.set('snapshot.accessibility', async () => {
  if (!activeTabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = tab?.id;
  }
  
  if (!activeTabId) {
    throw new Error('No active tab');
  }
  
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    func: captureAccessibilitySnapshot
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

messageHandlers.set('dom.click', async ({ ref }) => {
  await chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    func: clickElement,
    args: [ref]
  });
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

messageHandlers.set('console.get', async () => {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    func: getConsoleLogs
  });
  return { logs: result.result || [] };
});

messageHandlers.set('screenshot.capture', async () => {
  const dataUrl = await chrome.tabs.captureVisibleTab();
  const base64 = dataUrl.split(',')[1];
  return { data: base64 };
});

messageHandlers.set('page.navigate', async ({ url }) => {
  await chrome.tabs.update(activeTabId, { url });
  return {};
});

messageHandlers.set('page.goBack', async () => {
  await chrome.tabs.goBack(activeTabId);
  return {};
});

messageHandlers.set('page.goForward', async () => {
  await chrome.tabs.goForward(activeTabId);
  return {};
});

messageHandlers.set('page.wait', async ({ time }) => {
  await new Promise(resolve => setTimeout(resolve, time * 1000));
  return {};
});

// Functions to inject into page
function captureAccessibilitySnapshot() {
  // Enhanced implementation with stable element IDs
  function traverse(element, depth = 0) {
    // Skip hidden elements
    if (!element.offsetParent && element.tagName !== 'BODY') {
      return '';
    }
    
    const role = element.getAttribute('role') || element.tagName.toLowerCase();
    const name = element.getAttribute('aria-label') || 
                 element.getAttribute('alt') || 
                 element.textContent?.trim().substring(0, 100) || '';
    
    // Get stable element ID
    const elementId = window.__elementTracker.getElementId(element);
    
    // Format: role "name" [ref=123]
    let result = '  '.repeat(depth) + `${role} "${name}" [ref=${elementId}]`;
    
    // Add interactive elements' additional attributes
    if (['button', 'a', 'input', 'select', 'textarea'].includes(element.tagName.toLowerCase())) {
      const attrs = [];
      if (element.type) attrs.push(`type="${element.type}"`);
      if (element.href) attrs.push(`href="${element.href}"`);
      if (element.value && element.tagName !== 'TEXTAREA') attrs.push(`value="${element.value}"`);
      if (attrs.length > 0) {
        result += ` {${attrs.join(', ')}}`;
      }
    }
    
    // Traverse children
    if (element.children.length > 0) {
      for (const child of element.children) {
        const childResult = traverse(child, depth + 1);
        if (childResult) {
          result += '\n' + childResult;
        }
      }
    }
    
    return result;
  }
  
  return traverse(document.body);
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
  // Support both old format (selector[index]) and new format ([ref=123])
  
  // Check if it's new ref format
  const refMatch = ref.match(/\[ref=(ref\d+)\]/);
  if (refMatch) {
    const elementId = refMatch[1];
    const element = window.__elementTracker.getElementById(elementId);
    if (element) {
      element.click();
      return true;
    } else {
      throw new Error(`Element with ref ${elementId} not found`);
    }
  }
  
  // Fallback to old selector[index] format
  const selectorMatch = ref.match(/(.+)\[(\d+)\]/);
  if (selectorMatch) {
    const [, selector, index] = selectorMatch;
    const element = document.querySelectorAll(selector)[parseInt(index)];
    if (element) {
      element.click();
      return true;
    }
  }
  
  throw new Error(`Invalid element reference: ${ref}`);
}

function hoverElement(ref) {
  let element = null;
  
  // Check if it's new ref format
  const refMatch = ref.match(/\[ref=(ref\d+)\]/);
  if (refMatch) {
    element = window.__elementTracker.getElementById(refMatch[1]);
  } else {
    // Fallback to old selector[index] format
    const selectorMatch = ref.match(/(.+)\[(\d+)\]/);
    if (selectorMatch) {
      const [, selector, index] = selectorMatch;
      element = document.querySelectorAll(selector)[parseInt(index)];
    }
  }
  
  if (element) {
    const event = new MouseEvent('mouseover', {
      view: window,
      bubbles: true,
      cancelable: true
    });
    element.dispatchEvent(event);
    return true;
  }
  
  throw new Error(`Element not found: ${ref}`);
}

function typeInElement(ref, text, submit) {
  let element = null;
  
  // Check if it's new ref format
  const refMatch = ref.match(/\[ref=(ref\d+)\]/);
  if (refMatch) {
    element = window.__elementTracker.getElementById(refMatch[1]);
  } else {
    // Fallback to old selector[index] format
    const selectorMatch = ref.match(/(.+)\[(\d+)\]/);
    if (selectorMatch) {
      const [, selector, index] = selectorMatch;
      element = document.querySelectorAll(selector)[parseInt(index)];
    }
  }
  
  if (element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA')) {
    element.focus();
    element.value = text;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    
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
  
  throw new Error(`Input element not found or not editable: ${ref}`);
}

function selectOptions(ref, values) {
  let element = null;
  
  // Check if it's new ref format
  const refMatch = ref.match(/\[ref=(ref\d+)\]/);
  if (refMatch) {
    element = window.__elementTracker.getElementById(refMatch[1]);
  } else {
    // Fallback to old selector[index] format
    const selectorMatch = ref.match(/(.+)\[(\d+)\]/);
    if (selectorMatch) {
      const [, selector, index] = selectorMatch;
      element = document.querySelectorAll(selector)[parseInt(index)];
    }
  }
  
  if (element && element.tagName === 'SELECT') {
    for (const option of element.options) {
      option.selected = values.includes(option.value);
    }
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  
  throw new Error(`Select element not found: ${ref}`);
}

function pressKey(key) {
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key }));
  document.activeElement.dispatchEvent(new KeyboardEvent('keypress', { key }));
  document.activeElement.dispatchEvent(new KeyboardEvent('keyup', { key }));
}

function getConsoleLogs() {
  // This would need to be injected earlier to capture logs
  return window.__consoleLogs || [];
}

// Initialize connection
connectToMCP();

// Handle extension icon click
chrome.action.onClicked.addListener((tab) => {
  activeTabId = tab.id;
  connectToMCP();
});