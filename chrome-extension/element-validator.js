// Element validation functions to ensure correct element selection
window.__elementValidator = {
  // Validate element exists and matches expected properties
  validateElement(ref, expectedProperties = {}) {
    let element = null;
    
    // First try direct ref ID (e.g., "ref13")
    if (ref.startsWith('ref')) {
      element = window.__elementTracker.getElementById(ref);
      if (!element) {
        return {
          valid: false,
          error: `Element with ref ${ref} no longer exists in DOM`
        };
      }
    } else {
      // Try bracket format [ref=ref13]
      const refMatch = ref.match(/\[ref=(ref\d+)\]/);
      if (refMatch) {
        element = window.__elementTracker.getElementById(refMatch[1]);
        if (!element) {
          return {
            valid: false,
            error: `Element with ref ${refMatch[1]} no longer exists in DOM`
          };
        }
      } else {
        // Fallback for old selector format
        const selectorMatch = ref.match(/(.+)\[(\d+)\]/);
        if (selectorMatch) {
          const [, selector, index] = selectorMatch;
          element = document.querySelectorAll(selector)[parseInt(index)];
          if (!element) {
            return {
              valid: false,
              error: `No element found matching selector ${selector} at index ${index}`
            };
          }
        }
      }
    }
    
    if (!element) {
      return {
        valid: false,
        error: `Invalid element reference: ${ref}`
      };
    }
    
    // Validate element is visible
    if (!this.isVisible(element)) {
      return {
        valid: false,
        error: `Element ${ref} is not visible (display:none, visibility:hidden, or zero size)`
      };
    }
    
    // Validate expected properties
    if (expectedProperties.tagName) {
      const expectedTags = Array.isArray(expectedProperties.tagName) 
        ? expectedProperties.tagName 
        : [expectedProperties.tagName];
      
      const elementTag = element.tagName.toUpperCase();
      const validTag = expectedTags.some(tag => tag.toUpperCase() === elementTag);
      
      if (!validTag) {
        return {
          valid: false,
          error: `Expected ${expectedTags.join(' or ')} but found ${element.tagName}`
        };
      }
    }
    
    if (expectedProperties.type) {
      if (element.type !== expectedProperties.type) {
        return {
          valid: false,
          error: `Expected type="${expectedProperties.type}" but found type="${element.type}"`
        };
      }
    }
    
    if (expectedProperties.role) {
      const actualRole = element.getAttribute('role') || this.getImplicitRole(element);
      if (actualRole !== expectedProperties.role) {
        return {
          valid: false,
          error: `Expected role="${expectedProperties.role}" but found role="${actualRole}"`
        };
      }
    }
    
    if (expectedProperties.enabled !== undefined) {
      if (element.disabled === expectedProperties.enabled) {
        return {
          valid: false,
          error: `Element is ${element.disabled ? 'disabled' : 'enabled'} but expected ${expectedProperties.enabled ? 'enabled' : 'disabled'}`
        };
      }
    }
    
    return {
      valid: true,
      element: element
    };
  },
  
  // Check if element is visible
  isVisible(element) {
    if (element === document.body) return true;
    
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (parseFloat(style.opacity) === 0) return false;
    
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    
    // Check if element is in viewport
    const inViewport = (
      rect.top < window.innerHeight &&
      rect.bottom > 0 &&
      rect.left < window.innerWidth &&
      rect.right > 0
    );
    
    return inViewport;
  },
  
  // Get implicit ARIA role for element
  getImplicitRole(element) {
    const tagName = element.tagName.toLowerCase();
    const roleMap = {
      'a': element.href ? 'link' : 'generic',
      'button': 'button',
      'input': element.type === 'submit' || element.type === 'button' ? 'button' : 'textbox',
      'textarea': 'textbox',
      'select': 'combobox',
      'img': 'img',
      'h1': 'heading',
      'h2': 'heading',
      'h3': 'heading',
      'h4': 'heading',
      'h5': 'heading',
      'h6': 'heading',
      'nav': 'navigation',
      'main': 'main',
      'form': 'form'
    };
    
    return roleMap[tagName] || tagName;
  },
  
  // Validate element is interactable
  canInteract(element) {
    // Check if element is focusable
    if (element.tabIndex >= 0) return true;
    
    // Check for interactive elements
    const interactiveTags = ['a', 'button', 'input', 'select', 'textarea'];
    if (interactiveTags.includes(element.tagName.toLowerCase())) {
      return !element.disabled;
    }
    
    // Check for click handlers
    if (element.onclick || element.hasAttribute('onclick')) return true;
    
    // Check for role="button" or similar
    const role = element.getAttribute('role');
    if (['button', 'link', 'menuitem', 'tab'].includes(role)) return true;
    
    return false;
  }
};