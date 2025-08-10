/**
 * Popup Detector - Intelligent popup/modal detection and extraction
 * Provides full visibility of popups to AI for informed decision making
 */

class PopupDetector {
  constructor() {
    this.observer = null;
    this.detectedPopups = [];
    this.elementRefs = new Map(); // ref -> WeakRef(element)
    this.navigationStartTime = 0;
    this.maxTimeout = 5000; // 5 seconds max wait
    this.checkIntervals = [200, 400, 800, 1600]; // Progressive backoff
    this.currentCheckIndex = 0;
    this.checkTimer = null;
    this.resolveCallback = null;
    
    // Known CMP indicators
    this.cmpIndicators = [
      'onetrust', 'cookieyes', 'cookiebot', 'quantcast', 'didomi',
      'trustarc', 'usercentrics', 'cookiefirst', 'termly', 'iubenda',
      'cookiescript', 'osano', 'consentmanager', 'cookiehub'
    ];
    
    // Multi-language accept/reject terms
    this.acceptTerms = [
      'accept', 'agree', 'ok', 'yes', 'allow', 'continue', 'got it', 'i understand',
      'rozumím', 'souhlasím', 'přijmout', 'akzeptieren', 'zustimmen', 'accepter',
      'acceptar', 'accetto', 'принять', '同意', '承認', '확인'
    ];
    
    this.rejectTerms = [
      'reject', 'decline', 'no', 'deny', 'refuse', 'disagree',
      'odmítnout', 'nesouhlasím', 'ablehnen', 'refuser', 'rechazar',
      'rifiuta', 'отклонить', '拒否', '거부'
    ];
    
    this.customizeTerms = [
      'customize', 'manage', 'preferences', 'settings', 'options',
      'přizpůsobit', 'nastavení', 'anpassen', 'personnaliser', 'personalizar'
    ];
  }
  
  /**
   * Start detection after navigation
   */
  async detectAfterNavigation() {
    this.navigationStartTime = Date.now();
    this.detectedPopups = [];
    this.elementRefs.clear();
    this.currentCheckIndex = 0;
    
    return new Promise((resolve) => {
      this.resolveCallback = resolve;
      
      // Initial check
      this.checkForPopups();
      
      // Set up mutation observer
      this.startObserver();
      
      // Progressive checking
      this.scheduleNextCheck();
      
      // Timeout safety
      setTimeout(() => {
        this.complete();
      }, this.maxTimeout);
    });
  }
  
  /**
   * Check for popups using multiple heuristics
   */
  checkForPopups() {
    const popups = [];
    
    // 1. Check for aria-modal or dialog roles
    const dialogs = document.querySelectorAll('[aria-modal="true"], [role="dialog"], [role="alertdialog"]');
    dialogs.forEach(dialog => {
      if (this.isBlockingElement(dialog)) {
        popups.push(this.extractPopupInfo(dialog, 'aria_dialog'));
      }
    });
    
    // 2. Check for high z-index overlays
    const candidates = document.querySelectorAll('div, section, aside');
    const sorted = Array.from(candidates)
      .filter(el => {
        const style = window.getComputedStyle(el);
        return (style.position === 'fixed' || style.position === 'sticky') &&
               parseInt(style.zIndex) > 999;
      })
      .sort((a, b) => {
        const aZ = parseInt(window.getComputedStyle(a).zIndex) || 0;
        const bZ = parseInt(window.getComputedStyle(b).zIndex) || 0;
        return bZ - aZ;
      });
    
    sorted.forEach(el => {
      if (this.isBlockingElement(el) && !popups.some(p => p.element === el)) {
        popups.push(this.extractPopupInfo(el, 'overlay'));
      }
    });
    
    // 3. Check for known CMP markers
    this.cmpIndicators.forEach(cmp => {
      const cmpElements = document.querySelectorAll(
        `[id*="${cmp}"], [class*="${cmp}"], [data-*="${cmp}"]`
      );
      cmpElements.forEach(el => {
        const root = this.findModalRoot(el);
        if (root && this.isBlockingElement(root) && !popups.some(p => p.element === root)) {
          popups.push(this.extractPopupInfo(root, `cmp_${cmp}`));
        }
      });
    });
    
    // 4. Check if body has overflow hidden (modal indicator)
    const bodyOverflow = window.getComputedStyle(document.body).overflow;
    const htmlOverflow = window.getComputedStyle(document.documentElement).overflow;
    if ((bodyOverflow === 'hidden' || htmlOverflow === 'hidden') && popups.length === 0) {
      // Look for the most likely modal
      const modal = this.findLikelyModal();
      if (modal) {
        popups.push(this.extractPopupInfo(modal, 'overflow_hidden'));
      }
    }
    
    // Store new popups
    if (popups.length > 0) {
      this.detectedPopups = popups;
      
      // Check if we should stop waiting
      if (this.hasSignificantPopup(popups)) {
        this.complete();
      }
    }
    
    return popups;
  }
  
  /**
   * Check if element is blocking interactions
   */
  isBlockingElement(element) {
    if (!element) return false;
    
    const rect = element.getBoundingClientRect();
    const viewportArea = window.innerWidth * window.innerHeight;
    const elementArea = rect.width * rect.height;
    
    // Check if covers >70% of viewport
    if (elementArea / viewportArea > 0.7) {
      return true;
    }
    
    // Check if blocks center point
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    const topElement = document.elementFromPoint(centerX, centerY);
    
    if (topElement && (element.contains(topElement) || element === topElement)) {
      return true;
    }
    
    return false;
  }
  
  /**
   * Find the modal root from a child element
   */
  findModalRoot(element) {
    let current = element;
    let modalRoot = null;
    
    while (current && current !== document.body) {
      const style = window.getComputedStyle(current);
      if ((style.position === 'fixed' || style.position === 'sticky') && 
          this.isBlockingElement(current)) {
        modalRoot = current;
      }
      current = current.parentElement;
    }
    
    return modalRoot || element;
  }
  
  /**
   * Find likely modal when body has overflow:hidden
   */
  findLikelyModal() {
    const candidates = document.querySelectorAll('div[style*="position"], div[class*="modal"], div[class*="popup"], div[class*="overlay"]');
    
    for (const candidate of candidates) {
      if (this.isBlockingElement(candidate)) {
        return candidate;
      }
    }
    
    return null;
  }
  
  /**
   * Extract popup information
   */
  extractPopupInfo(element, detectionMethod) {
    const popupIndex = this.detectedPopups.length;
    const elements = [];
    let seq = 0;
    
    // Find all interactive elements
    const interactiveSelectors = [
      'button',
      'a[href]',
      '[role="button"]',
      'input[type="checkbox"]',
      'input[type="radio"]',
      'input[type="button"]',
      'input[type="submit"]',
      'select',
      '[tabindex]:not([tabindex="-1"])'
    ];
    
    const interactive = element.querySelectorAll(interactiveSelectors.join(', '));
    
    interactive.forEach(el => {
      // Skip hidden elements
      if (!el.offsetParent && el.tagName !== 'INPUT') return;
      
      const text = this.getElementText(el);
      const ref = this.buildRef(el, popupIndex, seq++);
      
      // Store weak reference
      this.elementRefs.set(ref, new WeakRef(el));
      
      const descriptor = {
        ref,
        type: this.getElementType(el),
        text: text.slice(0, 100),
        category: this.categorizeButton(text)
      };
      
      // Add checkbox/radio state
      if (el.type === 'checkbox' || el.type === 'radio') {
        descriptor.checked = el.checked;
        descriptor.disabled = el.disabled;
      }
      
      // Add aria labels
      if (el.getAttribute('aria-label')) {
        descriptor.ariaLabel = el.getAttribute('aria-label');
      }
      
      // Add bounding box for spatial understanding
      const rect = el.getBoundingClientRect();
      descriptor.bounds = {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
      
      elements.push(descriptor);
    });
    
    // Extract popup text (limited)
    const popupText = element.innerText?.slice(0, 2000) || '';
    
    // Determine popup type
    const popupType = this.detectPopupType(popupText, elements);
    
    return {
      element,
      type: popupType,
      detectionMethod,
      elements,
      text: popupText,
      timestamp: Date.now() - this.navigationStartTime
    };
  }
  
  /**
   * Get element text
   */
  getElementText(element) {
    return (element.innerText || element.value || element.getAttribute('aria-label') || '').trim();
  }
  
  /**
   * Build stable reference for element
   */
  buildRef(element, popupIndex, seq) {
    const tag = element.tagName.toLowerCase();
    const text = this.getElementText(element)
      .slice(0, 30)
      .replace(/[^a-zA-Z0-9]/g, '_')
      .toLowerCase();
    
    return `popup${popupIndex}_${seq}_${tag}_${text}`;
  }
  
  /**
   * Get element type
   */
  getElementType(element) {
    if (element.tagName === 'BUTTON') return 'button';
    if (element.tagName === 'A') return 'link';
    if (element.tagName === 'INPUT') {
      return element.type || 'input';
    }
    if (element.tagName === 'SELECT') return 'select';
    if (element.getAttribute('role') === 'button') return 'button';
    return 'interactive';
  }
  
  /**
   * Categorize button by its text
   */
  categorizeButton(text) {
    const lower = text.toLowerCase();
    
    for (const term of this.acceptTerms) {
      if (lower.includes(term)) return 'accept';
    }
    
    for (const term of this.rejectTerms) {
      if (lower.includes(term)) return 'reject';
    }
    
    for (const term of this.customizeTerms) {
      if (lower.includes(term)) return 'customize';
    }
    
    if (lower.includes('x') || lower.includes('close') || lower.includes('×')) {
      return 'close';
    }
    
    return 'unknown';
  }
  
  /**
   * Detect popup type from content
   */
  detectPopupType(text, elements) {
    const lower = text.toLowerCase();
    
    if (lower.includes('cookie') || lower.includes('gdpr') || lower.includes('consent')) {
      return 'cookie_consent';
    }
    
    if (lower.includes('newsletter') || lower.includes('subscribe') || lower.includes('email')) {
      return 'newsletter';
    }
    
    if (lower.includes('age') || lower.includes('birth') || lower.includes('18')) {
      return 'age_verification';
    }
    
    if (lower.includes('login') || lower.includes('sign in') || lower.includes('password')) {
      return 'login';
    }
    
    if (lower.includes('ad') || lower.includes('advertisement') || lower.includes('sponsor')) {
      return 'advertisement';
    }
    
    return 'generic_modal';
  }
  
  /**
   * Check if we have a significant popup worth reporting
   */
  hasSignificantPopup(popups) {
    return popups.some(p => 
      p.type === 'cookie_consent' || 
      p.elements.length > 0 ||
      p.type === 'login'
    );
  }
  
  /**
   * Start mutation observer
   */
  startObserver() {
    if (this.observer) {
      this.observer.disconnect();
    }
    
    this.observer = new MutationObserver((mutations) => {
      // Check if new nodes might be popups
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          this.checkForPopups();
          break;
        }
      }
    });
    
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class']
    });
  }
  
  /**
   * Schedule next check with backoff
   */
  scheduleNextCheck() {
    if (this.currentCheckIndex < this.checkIntervals.length) {
      const delay = this.checkIntervals[this.currentCheckIndex++];
      
      this.checkTimer = setTimeout(() => {
        this.checkForPopups();
        
        // Continue checking if no significant popup yet
        if (!this.hasSignificantPopup(this.detectedPopups)) {
          this.scheduleNextCheck();
        }
      }, delay);
    }
  }
  
  /**
   * Complete detection
   */
  complete() {
    // Clean up
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    
    if (this.checkTimer) {
      clearTimeout(this.checkTimer);
      this.checkTimer = null;
    }
    
    // Resolve with results
    if (this.resolveCallback) {
      const result = {
        popupsDetected: this.detectedPopups.length > 0,
        popups: this.detectedPopups.map(p => ({
          type: p.type,
          detectionMethod: p.detectionMethod,
          elements: p.elements,
          text: p.text.slice(0, 500), // Limit text
          detectedAfterMs: p.timestamp
        }))
      };
      
      this.resolveCallback(result);
      this.resolveCallback = null;
    }
  }
  
  /**
   * Get element by ref for clicking
   */
  getElementByRef(ref) {
    const weakRef = this.elementRefs.get(ref);
    if (weakRef) {
      const element = weakRef.deref();
      if (element && document.contains(element)) {
        return element;
      }
    }
    return null;
  }
  
  /**
   * Handle click on popup element
   */
  async clickPopupElement(ref) {
    const element = this.getElementByRef(ref);
    if (!element) {
      throw new Error(`Element not found or stale: ${ref}`);
    }
    
    // Simulate realistic click
    const rect = element.getBoundingClientRect();
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    
    // Dispatch mouse events
    const events = ['mouseenter', 'mouseover', 'mousedown', 'mouseup', 'click'];
    
    for (const eventType of events) {
      const event = new MouseEvent(eventType, {
        view: window,
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y
      });
      
      element.dispatchEvent(event);
      
      // Small delay between events
      await new Promise(r => setTimeout(r, 10));
    }
    
    // For checkboxes/radios, also toggle checked state
    if (element.type === 'checkbox' || element.type === 'radio') {
      element.checked = !element.checked;
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
    
    return { clicked: true, ref };
  }
}

// Create singleton instance
window.__popupDetector = new PopupDetector();

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'detectPopups') {
    window.__popupDetector.detectAfterNavigation()
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ error: error.message }));
    return true; // Keep channel open
  }
  
  if (message.type === 'clickPopupElement') {
    window.__popupDetector.clickPopupElement(message.ref)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }
  
  if (message.type === 'refreshPopups') {
    window.__popupDetector.checkForPopups();
    const result = {
      popupsDetected: window.__popupDetector.detectedPopups.length > 0,
      popups: window.__popupDetector.detectedPopups.map(p => ({
        type: p.type,
        elements: p.elements,
        text: p.text.slice(0, 500)
      }))
    };
    sendResponse(result);
  }
});

console.log('[Popup Detector] Initialized');