/**
 * Enhanced click handler that automatically detects when trusted clicks are needed
 * and uses the appropriate method (standard click vs Chrome Debugger API)
 */

// Import or define the trusted click function
async function performTrustedClick(tabId, ref) {
  console.log('[EnhancedClick] Using trusted click for ref:', ref);
  
  // Get element coordinates
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
  
  // Attach debugger if needed
  let wasAttached = false;
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
  } catch (error) {
    if (error.message.includes('Another debugger')) {
      wasAttached = true;
    } else {
      throw error;
    }
  }
  
  try {
    // Enable Input domain
    await chrome.debugger.sendCommand({ tabId }, "Input.enable", {});
    
    // Send mouse events
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: coords.x,
      y: coords.y
    });
    
    await new Promise(resolve => setTimeout(resolve, 50));
    
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: coords.x,
      y: coords.y,
      button: "left",
      buttons: 1,
      clickCount: 1
    });
    
    await new Promise(resolve => setTimeout(resolve, 30));
    
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: coords.x,
      y: coords.y,
      button: "left",
      buttons: 0,
      clickCount: 1
    });
    
    return { success: true, method: 'trusted' };
    
  } finally {
    if (!wasAttached) {
      try {
        await chrome.debugger.detach({ tabId });
      } catch (e) {
        console.log('[EnhancedClick] Error detaching debugger:', e);
      }
    }
  }
}

// Standard click function
async function performStandardClick(tabId, ref) {
  console.log('[EnhancedClick] Using standard click for ref:', ref);
  
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (ref) => {
      const validation = window.__elementValidator?.validateElement(ref);
      if (!validation?.valid) {
        throw new Error(validation?.error || 'Element not found');
      }
      
      const element = validation.element;
      
      if (!window.__elementValidator.canInteract(element)) {
        throw new Error(`Element ${ref} is not interactable`);
      }
      
      if (!window.__elementValidator.isVisible(element)) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return new Promise(resolve => {
          setTimeout(() => {
            element.click();
            resolve(true);
          }, 300);
        });
      }
      
      element.click();
      return true;
    },
    args: [ref]
  });
  
  return { success: true, method: 'standard' };
}

// Main enhanced click handler
async function enhancedClick(tabId, ref, options = {}) {
  const { forceTrusted = false, autoDetect = true } = options;
  
  // Always use trusted click if forced
  if (forceTrusted) {
    return await performTrustedClick(tabId, ref);
  }
  
  // Auto-detect if we should use trusted click
  if (autoDetect) {
    // First, inject detection script if needed
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['click-detection.js']
    }).catch(() => {}); // Ignore if already injected
    
    // Analyze the element
    const [analysis] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (ref) => {
        if (typeof analyzeClickRequirements === 'function') {
          return analyzeClickRequirements(ref);
        }
        return { requires: false, error: 'Detection not available' };
      },
      args: [ref]
    });
    
    console.log('[EnhancedClick] Detection analysis:', analysis.result);
    
    // Use trusted click if detection suggests it
    if (analysis.result?.requires) {
      console.log('[EnhancedClick] Trusted click required. Reasons:', analysis.result.reasons);
      return await performTrustedClick(tabId, ref);
    }
  }
  
  // Default to standard click
  return await performStandardClick(tabId, ref);
}

// Export for use in background.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { enhancedClick, performTrustedClick, performStandardClick };
}