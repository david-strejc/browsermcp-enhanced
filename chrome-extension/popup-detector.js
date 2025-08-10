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
    console.log('[PopupDetector] detectAfterNavigation() called at', new Date().toISOString());
    console.log('[PopupDetector] Current URL:', window.location.href);
    
    this.navigationStartTime = Date.now();
    this.detectedPopups = [];
    this.elementRefs.clear();
    this.currentCheckIndex = 0;
    this.completed = false; // Reset the completed flag
    
    return new Promise((resolve) => {
      console.log('[PopupDetector] Starting detection promise');
      this.resolveCallback = resolve;
      
      // Initial check
      console.log('[PopupDetector] Running initial checkForPopups()');
      this.checkForPopups();
      
      // Set up mutation observer
      console.log('[PopupDetector] Setting up mutation observer');
      this.startObserver();
      
      // Progressive checking
      console.log('[PopupDetector] Scheduling progressive checks with intervals:', this.checkIntervals);
      this.scheduleNextCheck();
      
      // Timeout safety
      console.log('[PopupDetector] Setting timeout safety at', this.maxTimeout, 'ms');
      setTimeout(() => {
        console.log('[PopupDetector] Timeout reached, completing detection');
        this.complete();
      }, this.maxTimeout);
    });
  }
  
  /**
   * Check for popups using multiple heuristics
   */
  checkForPopups() {
    console.log('[PopupDetector] checkForPopups() called at', Date.now() - this.navigationStartTime, 'ms after navigation');
    const popups = [];
    
    // 1. Check for aria-modal or dialog roles
    const dialogs = document.querySelectorAll('[aria-modal="true"], [role="dialog"], [role="alertdialog"]');
    console.log('[PopupDetector] Found', dialogs.length, 'dialog/modal elements');
    dialogs.forEach(dialog => {
      const isBlocking = this.isBlockingElement(dialog);
      console.log('[PopupDetector] Dialog element:', dialog.className, 'isBlocking:', isBlocking);
      if (isBlocking) {
        popups.push(this.extractPopupInfo(dialog, 'aria_dialog'));
      }
    });
    
    // 2. Check for high z-index overlays
    const candidates = document.querySelectorAll('div, section, aside');
    console.log('[PopupDetector] Checking', candidates.length, 'div/section/aside elements for high z-index');
    const sorted = Array.from(candidates)
      .filter(el => {
        const style = window.getComputedStyle(el);
        const zIndex = parseInt(style.zIndex) || 0;
        const isCandidate = (style.position === 'fixed' || style.position === 'sticky') && zIndex > 999;
        if (zIndex > 999) {
          console.log('[PopupDetector] High z-index element found:', el.id || el.className, 'z-index:', zIndex, 'position:', style.position, 'is candidate:', isCandidate);
        }
        return isCandidate;
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
    
    // 4. Check for consent iframes (common for GDPR/cookie popups)
    const iframes = document.querySelectorAll('iframe');
    console.log('[PopupDetector] Found', iframes.length, 'iframes');
    iframes.forEach(iframe => {
      const src = iframe.src || '';
      const id = iframe.id || '';
      const title = iframe.title || '';
      
      // Check if this looks like a consent/cookie popup iframe
      if (src.includes('consent') || src.includes('privacy') || src.includes('cookie') ||
          src.includes('sourcepoint') || src.includes('onetrust') || 
          id.includes('sp_message') || id.includes('consent') || 
          title.toLowerCase().includes('consent') || title.toLowerCase().includes('cookie')) {
        
        console.log('[PopupDetector] Found consent iframe:', { id, src: src.substring(0, 100), title });
        
        // Check if the iframe's parent container is visible and blocking
        let container = iframe.parentElement;
        while (container && container !== document.body) {
          const style = window.getComputedStyle(container);
          const zIndex = parseInt(style.zIndex) || 0;
          
          if (zIndex > 999) {
            console.log('[PopupDetector] Found high z-index container for iframe:', {
              containerId: container.id,
              containerClass: container.className,
              zIndex: zIndex,
              visible: container.offsetParent !== null
            });
            
            if (!popups.some(p => p.element === container)) {
              popups.push(this.extractPopupInfo(container, 'consent_iframe_container'));
            }
            break;
          }
          container = container.parentElement;
        }
      }
    });
    
    // 5. Check if body has overflow hidden (modal indicator)
    const bodyOverflow = window.getComputedStyle(document.body).overflow;
    const htmlOverflow = window.getComputedStyle(document.documentElement).overflow;
    if ((bodyOverflow === 'hidden' || htmlOverflow === 'hidden') && popups.length === 0) {
      console.log('[PopupDetector] Body/html overflow is hidden, looking for modal');
      // Look for the most likely modal
      const modal = this.findLikelyModal();
      if (modal) {
        popups.push(this.extractPopupInfo(modal, 'overflow_hidden'));
      }
    }
    
    // Store new popups
    console.log('[PopupDetector] Total popups found in this check:', popups.length);
    if (popups.length > 0) {
      console.log('[PopupDetector] Popups detected:', popups.map(p => ({ type: p.type, hasElements: p.elements?.length || 0 })));
      this.detectedPopups = popups;
      
      // Check if we should stop waiting
      const hasSignificant = this.hasSignificantPopup(popups);
      console.log('[PopupDetector] Has significant popup:', hasSignificant);
      if (hasSignificant) {
        console.log('[PopupDetector] Significant popup found, completing early');
        this.complete();
      }
    } else {
      console.log('[PopupDetector] No popups found in this check');
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
    const coverage = elementArea / viewportArea;
    
    // Debug logging
    if (coverage > 0.1) { // Log elements covering more than 10% for debugging
      console.log('[PopupDetector] isBlockingElement check:', {
        element: element.id || element.className?.substring(0, 50),
        coverage: (coverage * 100).toFixed(2) + '%',
        dimensions: `${rect.width}x${rect.height}`,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        visible: element.offsetParent !== null
      });
    }
    
    // Check if covers >70% of viewport
    if (coverage > 0.7) {
      console.log('[PopupDetector] Element IS blocking (>70% coverage)');
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
    
    console.log('[PopupDetector] Extracting popup info from element:', element);
    
    // Find all interactive elements - broaden the search
    const interactiveSelectors = [
      'button',
      'a',
      '[role="button"]',
      '[role="link"]',
      'input[type="checkbox"]',
      'input[type="radio"]',
      'input[type="button"]',
      'input[type="submit"]',
      'select',
      '[tabindex]:not([tabindex="-1"])',
      '[onclick]',
      '[data-action]',
      'div[class*="button"]',
      'div[class*="btn"]',
      'span[class*="button"]',
      'span[class*="btn"]'
    ];
    
    const interactive = element.querySelectorAll(interactiveSelectors.join(', '));
    console.log('[PopupDetector] Found interactive elements:', interactive.length);
    
    interactive.forEach(el => {
      // Check visibility more thoroughly
      const style = window.getComputedStyle(el);
      const isVisible = style.display !== 'none' && 
                       style.visibility !== 'hidden' && 
                       style.opacity !== '0' &&
                       (el.offsetWidth > 0 || el.offsetHeight > 0);
      
      if (!isVisible) {
        console.log('[PopupDetector] Skipping hidden element:', el);
        return;
      }
      
      const text = this.getElementText(el);
      if (!text && !el.getAttribute('aria-label')) {
        console.log('[PopupDetector] Skipping element without text:', el);
        return;
      }
      
      const ref = this.buildRef(el, popupIndex, seq++);
      
      // Store weak reference
      this.elementRefs.set(ref, new WeakRef(el));
      
      const descriptor = {
        ref,
        type: this.getElementType(el),
        text: text.slice(0, 100),
        category: this.categorizeButton(text)
      };
      
      console.log('[PopupDetector] Adding element descriptor:', descriptor);
      
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
    
    // Check for iframes (common in consent management platforms)
    const iframes = element.querySelectorAll('iframe');
    let iframeInfo = null;
    if (iframes.length > 0) {
      console.log('[PopupDetector] Found iframes in popup:', iframes.length);
      iframeInfo = {
        count: iframes.length,
        sources: Array.from(iframes).map(iframe => ({
          src: iframe.src ? new URL(iframe.src).hostname : 'no-src',
          id: iframe.id,
          crossOrigin: iframe.src && !iframe.src.startsWith(window.location.origin)
        }))
      };
      
      // If we have a cross-origin iframe and no buttons, it's likely a consent platform
      if (elements.length === 0 && iframeInfo.sources.some(s => s.crossOrigin)) {
        console.log('[PopupDetector] Cross-origin iframe detected, likely consent platform');
        // Store reference for later use
        this.lastDetectedElement = element;
      }
    }
    
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
      iframeInfo,
      timestamp: Date.now() - this.navigationStartTime
    };
  }
  
  /**
   * Get element text - enhanced version
   */
  getElementText(element) {
    // Try multiple sources for text
    let text = element.innerText || 
               element.textContent || 
               element.value || 
               element.getAttribute('aria-label') || 
               element.getAttribute('title') || 
               element.getAttribute('data-text') || 
               element.getAttribute('data-label') || 
               '';
    
    // For inputs/buttons, also check the value attribute
    if ((element.tagName === 'INPUT' || element.tagName === 'BUTTON') && !text) {
      text = element.getAttribute('value') || '';
    }
    
    // For links, use href as fallback
    if (element.tagName === 'A' && !text) {
      text = element.getAttribute('href') || '';
    }
    
    return text.trim();
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
   * Categorize button by its text - enhanced
   */
  categorizeButton(text) {
    const lower = text.toLowerCase();
    
    // Check for accept terms
    for (const term of this.acceptTerms) {
      if (lower.includes(term)) return 'accept';
    }
    
    // Check for reject terms
    for (const term of this.rejectTerms) {
      if (lower.includes(term)) return 'reject';
    }
    
    // Check for customize terms
    for (const term of this.customizeTerms) {
      if (lower.includes(term)) return 'customize';
    }
    
    // Check for close/dismiss
    if (lower.includes('x') || lower.includes('close') || lower.includes('×') || 
        lower.includes('dismiss') || lower === 'x' || lower === '×') {
      return 'close';
    }
    
    // Check for continue/proceed
    if (lower.includes('continue') || lower.includes('proceed') || lower.includes('next')) {
      return 'continue';
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
    
    // Check for consent management platforms by container ID/class
    if (elements.length === 0) {
      const containerClasses = this.lastDetectedElement?.className || '';
      const containerId = this.lastDetectedElement?.id || '';
      if (containerId.includes('sp_message') || containerId.includes('sourcepoint') ||
          containerClasses.includes('cmp') || containerClasses.includes('consent')) {
        return 'consent_iframe_container';
      }
    }
    
    return 'generic_modal';
  }
  
  /**
   * Check if we have a significant popup worth reporting
   */
  hasSignificantPopup(popups) {
    // Consider ANY detected popup as significant for now
    // We can filter later if needed
    const isSignificant = popups.length > 0;
    
    // Log details
    if (popups.length > 0) {
      console.log('[PopupDetector] Popup significance check:', popups.map(p => ({
        type: p.type,
        elements: p.elements?.length || 0,
        detectionMethod: p.detectionMethod
      })));
    }
    
    return isSignificant;
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
    // Prevent multiple calls to complete
    if (this.completed) {
      console.log('[PopupDetector] complete() already called, skipping');
      return;
    }
    this.completed = true;
    
    console.log('[PopupDetector] complete() called, total time:', Date.now() - this.navigationStartTime, 'ms');
    console.log('[PopupDetector] Final detected popups count:', this.detectedPopups.length);
    
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
      
      console.log('[PopupDetector] Resolving with result:', result);
      this.resolveCallback(result);
      this.resolveCallback = null;
    } else {
      console.log('[PopupDetector] WARNING: No resolveCallback to call!');
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
  
  /**
   * Automatically dismiss popups using common strategies
   */
  async autoDismissPopups() {
    console.log('[PopupDetector] Attempting auto-dismiss of popups');
    const dismissalResults = [];
    
    for (const popup of this.detectedPopups) {
      const result = await this.tryDismissPopup(popup);
      dismissalResults.push(result);
    }
    
    return dismissalResults;
  }
  
  /**
   * Try to dismiss a single popup
   */
  async tryDismissPopup(popup) {
    console.log('[PopupDetector] Trying to dismiss popup:', popup.type);
    
    // Special handling for iframe-based consent platforms
    if (popup.type === 'consent_iframe_container' && popup.iframeInfo) {
      console.log('[PopupDetector] Attempting iframe consent platform dismissal');
      const dismissed = await this.tryDismissIframeConsent(popup);
      if (dismissed.success) {
        return dismissed;
      }
    }
    
    // Strategy 1: Look for accept/agree buttons (most common)
    const acceptButton = popup.elements.find(el => el.category === 'accept');
    if (acceptButton) {
      try {
        await this.clickPopupElement(acceptButton.ref);
        console.log('[PopupDetector] Clicked accept button:', acceptButton.text);
        return { success: true, method: 'accept_button', ref: acceptButton.ref };
      } catch (error) {
        console.error('[PopupDetector] Failed to click accept button:', error);
      }
    }
    
    // Strategy 2: Look for close/dismiss buttons
    const closeButton = popup.elements.find(el => el.category === 'close');
    if (closeButton) {
      try {
        await this.clickPopupElement(closeButton.ref);
        console.log('[PopupDetector] Clicked close button:', closeButton.text);
        return { success: true, method: 'close_button', ref: closeButton.ref };
      } catch (error) {
        console.error('[PopupDetector] Failed to click close button:', error);
      }
    }
    
    // Strategy 3: Try clicking continue/proceed buttons
    const continueButton = popup.elements.find(el => el.category === 'continue');
    if (continueButton) {
      try {
        await this.clickPopupElement(continueButton.ref);
        console.log('[PopupDetector] Clicked continue button:', continueButton.text);
        return { success: true, method: 'continue_button', ref: continueButton.ref };
      } catch (error) {
        console.error('[PopupDetector] Failed to click continue button:', error);
      }
    }
    
    // Strategy 4: Try ESC key (works on many modals)
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27 }));
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Check if popup is still visible
      if (!document.body.contains(popup.element) || !this.isBlockingElement(popup.element)) {
        console.log('[PopupDetector] ESC key dismissed popup');
        return { success: true, method: 'escape_key' };
      }
    } catch (error) {
      console.error('[PopupDetector] ESC key failed:', error);
    }
    
    // Strategy 5: Click overlay/backdrop
    if (popup.element) {
      const backdrop = popup.element.parentElement?.querySelector('[class*="backdrop"], [class*="overlay"]');
      if (backdrop) {
        try {
          backdrop.click();
          await new Promise(resolve => setTimeout(resolve, 100));
          
          if (!document.body.contains(popup.element) || !this.isBlockingElement(popup.element)) {
            console.log('[PopupDetector] Backdrop click dismissed popup');
            return { success: true, method: 'backdrop_click' };
          }
        } catch (error) {
          console.error('[PopupDetector] Backdrop click failed:', error);
        }
      }
    }
    
    // If all strategies fail, return failure with fallback instructions
    return {
      success: false,
      fallbackJavaScript: this.generateFallbackJS(popup),
      elements: popup.elements
    };
  }
  
  /**
   * Try to dismiss iframe-based consent platforms
   */
  async tryDismissIframeConsent(popup) {
    console.log('[PopupDetector] Trying iframe consent dismissal strategies');
    
    // Strategy 1: Try to click at common accept button positions
    // Most consent platforms put accept button in bottom right or center
    const positions = [
      { x: window.innerWidth - 150, y: window.innerHeight - 100 }, // Bottom right
      { x: window.innerWidth / 2, y: window.innerHeight - 100 },   // Bottom center
      { x: window.innerWidth - 150, y: window.innerHeight / 2 },   // Middle right
    ];
    
    for (const pos of positions) {
      console.log(`[PopupDetector] Trying click at position: ${pos.x}, ${pos.y}`);
      
      // Create and dispatch click event at position
      const clickEvent = new MouseEvent('click', {
        view: window,
        bubbles: true,
        cancelable: true,
        clientX: pos.x,
        clientY: pos.y
      });
      
      // Find element at position and click it
      const element = document.elementFromPoint(pos.x, pos.y);
      if (element) {
        console.log('[PopupDetector] Found element at position:', element.tagName, element.id);
        element.dispatchEvent(clickEvent);
        
        // Wait to see if popup disappears
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Check if popup still exists
        if (!document.body.contains(popup.element)) {
          console.log('[PopupDetector] Popup dismissed by position click!');
          return { success: true, method: 'position_click', position: pos };
        }
      }
    }
    
    // Strategy 2: Try to manipulate cookies directly for known platforms
    if (popup.element.id && popup.element.id.includes('sp_message')) {
      console.log('[PopupDetector] Detected Sourcepoint, trying cookie manipulation');
      
      // Set common consent cookies
      try {
        // Sourcepoint uses euconsent-v2 and other cookies
        const consentString = 'CPxqlEAPxqlEAAGABCENDpCgAAAAAAAAADAiQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
        document.cookie = `euconsent-v2=${consentString}; path=/; max-age=31536000`;
        document.cookie = `_sp_v1_consent=1!1:1:1:1; path=/; max-age=31536000`;
        document.cookie = `_sp_enable_dfp_personalized_ads=true; path=/; max-age=31536000`;
        
        // Force reload to apply cookies
        console.log('[PopupDetector] Cookies set, removing popup element');
        popup.element.remove();
        
        // Re-enable scrolling
        document.body.style.overflow = 'auto';
        
        return { success: true, method: 'cookie_manipulation' };
      } catch (error) {
        console.error('[PopupDetector] Cookie manipulation failed:', error);
      }
    }
    
    // Strategy 3: Send message to iframe (might work on same-origin or permissive iframes)
    const iframes = popup.element.querySelectorAll('iframe');
    for (const iframe of iframes) {
      try {
        // Try to post message to iframe
        iframe.contentWindow.postMessage({
          type: 'accept_all',
          action: 'consent',
          consent: true
        }, '*');
        
        console.log('[PopupDetector] Posted consent message to iframe');
        
        // Wait for potential response
        await new Promise(resolve => setTimeout(resolve, 500));
        
        if (!document.body.contains(popup.element)) {
          return { success: true, method: 'iframe_message' };
        }
      } catch (error) {
        console.error('[PopupDetector] Iframe message failed:', error);
      }
    }
    
    return { success: false, method: 'iframe_consent_failed' };
  }
  
  /**
   * Generate fallback JavaScript for manual popup dismissal
   */
  generateFallbackJS(popup) {
    const scripts = [];
    
    // Script 1: Remove by class patterns
    scripts.push(`// Method 1: Remove common popup containers
document.querySelectorAll('[class*="modal"], [class*="popup"], [class*="consent"], [class*="cookie"], [class*="gdpr"], [class*="overlay"], [class*="dialog"]').forEach(el => {
  if (window.getComputedStyle(el).position === 'fixed' || window.getComputedStyle(el).position === 'absolute') {
    el.remove();
  }
});`);
    
    // Script 2: Remove fixed position elements blocking interaction
    scripts.push(`// Method 2: Remove fixed elements covering viewport
document.querySelectorAll('*').forEach(el => {
  const style = window.getComputedStyle(el);
  if (style.position === 'fixed' && style.zIndex > 1000) {
    const rect = el.getBoundingClientRect();
    if (rect.width > window.innerWidth * 0.5 && rect.height > window.innerHeight * 0.5) {
      el.remove();
    }
  }
});`);
    
    // Script 3: Re-enable scrolling
    scripts.push(`// Method 3: Re-enable body scrolling
document.body.style.overflow = 'auto';
document.documentElement.style.overflow = 'auto';
document.body.classList.remove('no-scroll', 'modal-open', 'overflow-hidden');`);
    
    // Script 4: Click first visible accept/agree button
    scripts.push(`// Method 4: Click accept/agree buttons
['accept', 'agree', 'ok', 'got it', 'continue', 'allow', 'yes'].forEach(term => {
  const button = Array.from(document.querySelectorAll('button, [role="button"], a')).find(el => 
    el.innerText.toLowerCase().includes(term) && el.offsetParent !== null
  );
  if (button) button.click();
});`);
    
    // Script 5: Remove specific popup if we have element info
    if (popup.element) {
      const selector = popup.element.id ? `#${popup.element.id}` : 
                      popup.element.className ? `.${popup.element.className.split(' ')[0]}` : '';
      if (selector) {
        scripts.push(`// Method 5: Remove specific detected popup
document.querySelector('${selector}')?.remove();`);
      }
    }
    
    return scripts;
  }
}

// Create singleton instance
window.__popupDetector = new PopupDetector();

// Listen for messages from background script
console.log('[PopupDetector] Setting up message listener...');
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[PopupDetector] Received message:', message);
  
  if (message.type === 'detectPopups') {
    console.log('[PopupDetector] detectPopups message received, starting detection');
    window.__popupDetector.detectAfterNavigation()
      .then(async result => {
        console.log('[PopupDetector] Detection complete, sending response:', result);
        
        // Auto-dismiss if popups were detected
        if (result.popupsDetected && result.popups.length > 0) {
          console.log('[PopupDetector] Auto-dismissing detected popups...');
          const dismissResults = await window.__popupDetector.autoDismissPopups();
          result.autoDismissed = dismissResults;
        }
        
        sendResponse(result);
      })
      .catch(error => {
        console.error('[PopupDetector] Detection error:', error);
        sendResponse({ error: error.message });
      });
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
  
  if (message.type === 'autoDismissPopups') {
    window.__popupDetector.autoDismissPopups()
      .then(results => {
        // Include fallback JavaScript in response
        const fallbackScripts = [];
        results.forEach((result, index) => {
          if (!result.success && result.fallbackJavaScript) {
            fallbackScripts.push(...result.fallbackJavaScript);
          }
        });
        sendResponse({ 
          results, 
          fallbackScripts,
          popupsRemaining: window.__popupDetector.detectedPopups.length 
        });
      })
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }
});

console.log('[Popup Detector] Initialized');

// Test message to background
setTimeout(() => {
  console.log('[PopupDetector] Sending test message to background...');
  chrome.runtime.sendMessage({ type: 'POPUP_DETECTOR_READY', url: window.location.href }, response => {
    console.log('[PopupDetector] Test message response:', response);
  });
}, 100);