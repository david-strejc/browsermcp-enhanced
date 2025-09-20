/**
 * Simplified Popup Detector - Just detect and report
 * Let Claude handle the dismissal intelligently
 */

class SimplePopupDetector {
  constructor() {
    this.detectedPopups = [];
    console.log('[PopupDetector] Simple detector initialized');
  }
  
  /**
   * Detect popups on the page
   */
  detect() {
    const popups = [];
    
    // Strategy 1: Find fixed position elements with high z-index
    document.querySelectorAll('*').forEach(element => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      
      // Check if it's a potential popup
      if ((style.position === 'fixed' || style.position === 'absolute') &&
          parseInt(style.zIndex) > 1000 &&
          rect.width > window.innerWidth * 0.3 &&
          rect.height > window.innerHeight * 0.2) {
        
        popups.push(this.extractInfo(element));
      }
    });
    
    // Strategy 2: Find elements with popup-like attributes
    const popupSelectors = [
      '[role="dialog"]',
      '[aria-modal="true"]',
      '[class*="modal"]',
      '[class*="popup"]',
      '[class*="consent"]',
      '[class*="cookie"]',
      '[class*="gdpr"]',
      '[class*="overlay"]',
      '[id*="sp_message"]',      // Sourcepoint
      '[id*="onetrust"]',        // OneTrust
      '[class*="cmp"]'           // Generic consent management
    ];
    
    popupSelectors.forEach(selector => {
      try {
        document.querySelectorAll(selector).forEach(element => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          
          // Only add if visible and not already found
          if (rect.width > 0 && rect.height > 0 && 
              !popups.some(p => p.containerSelector === this.getSelector(element))) {
            popups.push(this.extractInfo(element));
          }
        });
      } catch (e) {
        // Ignore selector errors
      }
    });
    
    // Sort by z-index (highest first) and size (largest first)
    popups.sort((a, b) => {
      const zDiff = (parseInt(b.zIndex) || 0) - (parseInt(a.zIndex) || 0);
      if (zDiff !== 0) return zDiff;
      return (b.boundingRect.width * b.boundingRect.height) - 
             (a.boundingRect.width * a.boundingRect.height);
    });
    
    // Return top 3 most likely popups
    return popups.slice(0, 3);
  }
  
  /**
   * Extract info about a popup element
   */
  extractInfo(element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    
    // Check for iframes
    const iframes = element.querySelectorAll('iframe');
    const iframeSelectors = [];
    iframes.forEach(iframe => {
      if (iframe.id) {
        iframeSelectors.push(`#${iframe.id}`);
      } else if (iframe.src) {
        try {
          const hostname = new URL(iframe.src).hostname;
          iframeSelectors.push(`iframe[src*='${hostname}']`);
        } catch (e) {
          iframeSelectors.push('iframe');
        }
      } else {
        iframeSelectors.push('iframe');
      }
    });
    
    // Get visible text
    const visibleText = [];
    const textElements = element.querySelectorAll('h1, h2, h3, h4, h5, h6, p, button, a, span');
    for (let i = 0; i < Math.min(textElements.length, 30); i++) {
      const text = (textElements[i].innerText || textElements[i].textContent || '').trim();
      if (text && text.length < 100 && text.length > 2) {
        visibleText.push(text);
      }
    }
    
    // Remove duplicates and limit
    const uniqueText = [...new Set(visibleText)].slice(0, 15);
    
    return {
      containerSelector: this.getSelector(element),
      boundingRect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      },
      zIndex: style.zIndex || 'auto',
      position: style.position,
      hasIframe: iframes.length > 0,
      iframeSelectors: iframeSelectors,
      visibleText: uniqueText,
      // Add helpful hints for Claude
      hints: {
        hasAcceptButton: uniqueText.some(t => /accept|agree|ok|allow|yes|continue/i.test(t)),
        hasRejectButton: uniqueText.some(t => /reject|decline|no|refuse|skip/i.test(t)),
        hasCloseButton: uniqueText.some(t => /close|x|×|dismiss/i.test(t)),
        looksLikeCookieConsent: uniqueText.some(t => /cookie|consent|privacy|gdpr/i.test(t)),
        isSourcepoint: element.id && element.id.includes('sp_message'),
        isOneTrust: element.id && element.id.includes('onetrust')
      }
    };
  }
  
  /**
   * Get a unique selector for an element
   */
  getSelector(element) {
    if (element.id) {
      return `#${element.id}`;
    }
    
    if (element.className && typeof element.className === 'string') {
      const classes = element.className.split(' ').filter(c => c && !c.includes(':'));
      if (classes.length > 0) {
        return `.${classes[0]}`;
      }
    }
    
    // Fallback to tag name with index
    const tagName = element.tagName.toLowerCase();
    const siblings = Array.from(element.parentNode?.children || []);
    const index = siblings.indexOf(element);
    return `${tagName}:nth-child(${index + 1})`;
  }
}

// Create instance and listen for messages
const detector = new SimplePopupDetector();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'detectPopups') {
    console.log('[PopupDetector] Detecting popups...');
    const popups = detector.detect();
    
    const response = {
      schema: 1,
      timestamp: Date.now(),
      popupsDetected: popups.length > 0,
      popups: popups
    };
    
    console.log('[PopupDetector] Found popups:', response);
    sendResponse(response);
    return true;
  }
});

console.log('[PopupDetector] Simple detector ready');