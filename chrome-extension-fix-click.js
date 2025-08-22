// Enhanced click simulation function to handle all types of click events
// This replaces the simple element.click() with a comprehensive event simulation

function simulateClick(element) {
  // Get element position for realistic coordinates
  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  
  // Common event properties
  const eventInit = {
    view: window,
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    screenX: x + window.screenX,
    screenY: y + window.screenY,
    button: 0,
    buttons: 1,
    relatedTarget: null,
    region: null,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false
  };
  
  // Strategy 1: Full event simulation sequence
  try {
    // Focus the element if focusable
    if (element.focus && (element.tabIndex >= 0 || 
        ['INPUT', 'TEXTAREA', 'BUTTON', 'A', 'SELECT'].includes(element.tagName))) {
      element.focus();
    }
    
    // Dispatch pointer events (modern browsers)
    element.dispatchEvent(new PointerEvent('pointerdown', {
      ...eventInit,
      pointerId: 1,
      width: 1,
      height: 1,
      pressure: 0.5,
      pointerType: 'mouse',
      isPrimary: true
    }));
    
    // Dispatch mouse events
    element.dispatchEvent(new MouseEvent('mousedown', eventInit));
    element.dispatchEvent(new MouseEvent('mouseup', eventInit));
    element.dispatchEvent(new MouseEvent('click', eventInit));
    
    element.dispatchEvent(new PointerEvent('pointerup', {
      ...eventInit,
      pointerId: 1,
      width: 1,
      height: 1,
      pressure: 0,
      pointerType: 'mouse',
      isPrimary: true
    }));
  } catch (e) {
    console.warn('Event simulation error:', e);
  }
  
  // Strategy 2: Handle special cases
  
  // Handle javascript: hrefs
  if (element.tagName === 'A' && element.href && element.href.startsWith('javascript:')) {
    try {
      // Extract and execute the JavaScript code
      const jsCode = element.href.substring(11); // Remove 'javascript:'
      
      // Create a function in the page context
      const func = new Function(jsCode);
      
      // Execute in the context of the element
      func.call(element);
      
      console.log('Executed javascript: href:', jsCode);
      return true;
    } catch (e) {
      console.warn('Failed to execute javascript: href:', e);
    }
  }
  
  // Handle onclick attribute
  if (element.onclick) {
    try {
      element.onclick.call(element, new MouseEvent('click', eventInit));
    } catch (e) {
      console.warn('onclick handler error:', e);
    }
  }
  
  // Handle forms
  if (element.type === 'submit' || 
      (element.tagName === 'BUTTON' && element.form) ||
      (element.tagName === 'INPUT' && element.form && element.type === 'submit')) {
    const form = element.form;
    if (form) {
      try {
        // Try to submit the form
        if (form.requestSubmit) {
          form.requestSubmit(element);
        } else {
          form.submit();
        }
      } catch (e) {
        console.warn('Form submission error:', e);
      }
    }
  }
  
  // Handle checkboxes and radio buttons
  if (element.type === 'checkbox' || element.type === 'radio') {
    element.checked = !element.checked;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }
  
  // Handle regular links
  if (element.tagName === 'A' && element.href && !element.href.startsWith('javascript:')) {
    // Check for target="_blank"
    if (element.target === '_blank') {
      window.open(element.href, '_blank');
    } else if (element.target) {
      window.open(element.href, element.target);
    } else {
      // For navigation in same window, let the click event handle it
      // But as a fallback, navigate directly
      setTimeout(() => {
        if (window.location.href === element.href) return; // Already navigated
        window.location.href = element.href;
      }, 100);
    }
  }
  
  // Strategy 3: Native click as final fallback
  try {
    // Temporarily enable pointer events if disabled
    const originalPointerEvents = element.style.pointerEvents;
    if (element.style.pointerEvents === 'none') {
      element.style.pointerEvents = 'auto';
      element.click();
      element.style.pointerEvents = originalPointerEvents;
    } else {
      element.click();
    }
  } catch (e) {
    console.warn('Native click fallback error:', e);
  }
  
  return true;
}

// Replace the clickElement function
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
        simulateClick(element); // Use enhanced click simulation
        resolve(true);
      }, 300);
    });
  }
  
  simulateClick(element); // Use enhanced click simulation
  return true;
}