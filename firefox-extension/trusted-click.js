/**
 * Trusted Click Implementation using Chrome Debugger API
 * This simulates real user clicks that can trigger popups and pass isTrusted checks
 */

async function performTrustedClick(tabId, ref) {
  console.log('[TrustedClick] Starting trusted click for ref:', ref);
  
  // First get element coordinates using injected script
  const [coordsResult] = await chrome.scripting.executeScript({
    target: { tabId },
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
        // Get new position after scroll
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
  console.log('[TrustedClick] Element coordinates:', coords);
  
  // Wait for scroll if needed
  if (coords.scrolled) {
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // Check if debugger is already attached
  let wasAttached = false;
  try {
    // Try to attach debugger
    await chrome.debugger.attach({ tabId }, "1.3");
    console.log('[TrustedClick] Debugger attached');
  } catch (error) {
    if (error.message.includes('Another debugger')) {
      wasAttached = true;
      console.log('[TrustedClick] Debugger already attached');
    } else {
      throw error;
    }
  }
  
  try {
    // Enable Input domain for mouse events
    await chrome.debugger.sendCommand({ tabId }, "Input.enable", {});
    
    // Send mouse move to position
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: coords.x,
      y: coords.y,
      button: "none",
      clickCount: 0
    });
    
    // Small delay to simulate human behavior
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Send mouse down
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: coords.x,
      y: coords.y,
      button: "left",
      buttons: 1,
      clickCount: 1,
      modifiers: 0
    });
    
    // Small delay for button press
    await new Promise(resolve => setTimeout(resolve, 30));
    
    // Send mouse up
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: coords.x,
      y: coords.y,
      button: "left",
      buttons: 0,
      clickCount: 1,
      modifiers: 0
    });
    
    console.log('[TrustedClick] Mouse events sent successfully');
    
    // Wait a bit for any popups to appear
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Check if a popup was opened
    const windows = await chrome.windows.getAll({ populate: true });
    const popups = windows.filter(w => w.type === 'popup');
    
    if (popups.length > 0) {
      console.log('[TrustedClick] Popup detected:', popups[0].id);
      return {
        success: true,
        popupOpened: true,
        popupWindowId: popups[0].id
      };
    }
    
    return { success: true, popupOpened: false };
    
  } finally {
    // Only detach if we attached it
    if (!wasAttached) {
      try {
        await chrome.debugger.detach({ tabId });
        console.log('[TrustedClick] Debugger detached');
      } catch (e) {
        console.log('[TrustedClick] Error detaching debugger:', e);
      }
    }
  }
}

// Export for use in background.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { performTrustedClick };
}