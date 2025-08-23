/**
 * Detection system for identifying when trusted clicks are needed
 * Analyzes elements and their context to determine if they might trigger popups or require user activation
 */

function requiresTrustedClick(ref) {
  const validation = window.__elementValidator?.validateElement(ref);
  if (!validation?.valid) {
    return { requires: false, reason: 'Element not found' };
  }
  
  const element = validation.element;
  const tagName = element.tagName.toLowerCase();
  const reasons = [];
  
  // 1. Check for OAuth/authentication patterns in data attributes
  const dataAttrs = Array.from(element.attributes)
    .filter(attr => attr.name.startsWith('data-'))
    .map(attr => ({ name: attr.name, value: attr.value }));
  
  const oauthPatterns = ['oauth', 'auth', 'login', 'connect', 'authorize', 'sso', 'signin', 'popup'];
  for (const attr of dataAttrs) {
    const combined = (attr.name + attr.value).toLowerCase();
    if (oauthPatterns.some(pattern => combined.includes(pattern))) {
      reasons.push(`OAuth pattern in ${attr.name}: ${attr.value}`);
    }
  }
  
  // 2. Check button/link text content
  const textContent = element.textContent.toLowerCase().trim();
  const popupTriggerWords = [
    'connect', 'authorize', 'login', 'sign in', 'oauth', 'authenticate',
    'link account', 'grant access', 'allow', 'připojit', 'prihlasit',
    'facebook', 'google', 'twitter', 'microsoft', 'github', 'linkedin'
  ];
  
  if (popupTriggerWords.some(word => textContent.includes(word))) {
    reasons.push(`Popup trigger word in text: "${element.textContent.trim()}"`);
  }
  
  // 3. Check for window.open in onclick handlers
  const onclickStr = element.onclick ? element.onclick.toString() : '';
  if (onclickStr.includes('window.open') || onclickStr.includes('popup')) {
    reasons.push('window.open detected in onclick handler');
  }
  
  // 4. Check href for JavaScript that might open popups
  if (element.href) {
    const href = element.href.toLowerCase();
    if (href.startsWith('javascript:') && 
        (href.includes('window.open') || href.includes('popup'))) {
      reasons.push('Popup JavaScript in href');
    }
  }
  
  // 5. Check for target="_blank" with rel="opener" (might be popup-like)
  if (element.target === '_blank' && !element.rel?.includes('noopener')) {
    reasons.push('Target blank with opener relationship');
  }
  
  // 6. Check parent form for OAuth/popup indicators
  const form = element.closest('form');
  if (form) {
    const formAction = form.action?.toLowerCase() || '';
    const formClass = form.className?.toLowerCase() || '';
    const formId = form.id?.toLowerCase() || '';
    
    if ([formAction, formClass, formId].some(str => 
        oauthPatterns.some(pattern => str.includes(pattern)))) {
      reasons.push('Parent form has OAuth/popup indicators');
    }
  }
  
  // 7. Check for framework-specific popup triggers (React, Angular, Vue)
  const frameworkAttrs = ['ng-click', 'v-on:click', '@click', 'onclick'];
  for (const attr of frameworkAttrs) {
    const handler = element.getAttribute(attr);
    if (handler && (handler.includes('open') || handler.includes('popup') || 
        handler.includes('auth') || handler.includes('connect'))) {
      reasons.push(`Framework handler suggests popup: ${attr}="${handler}"`);
    }
  }
  
  // 8. Check for social media / third-party service buttons
  const classList = element.className?.toLowerCase() || '';
  const socialPatterns = [
    'facebook', 'google', 'twitter', 'linkedin', 'github', 'microsoft',
    'apple', 'amazon', 'oauth', 'sso', 'social', 'external'
  ];
  
  if (socialPatterns.some(pattern => classList.includes(pattern))) {
    reasons.push(`Social/external service class: ${element.className}`);
  }
  
  // 9. Check for file upload triggers (often need user activation)
  if (element.querySelector('input[type="file"]') || 
      element.closest('label')?.querySelector('input[type="file"]')) {
    reasons.push('File upload trigger detected');
  }
  
  // 10. Check for payment/Stripe/checkout patterns
  const paymentPatterns = ['stripe', 'payment', 'checkout', 'pay', 'purchase'];
  if (paymentPatterns.some(pattern => 
      textContent.includes(pattern) || classList.includes(pattern))) {
    reasons.push('Payment/checkout pattern detected');
  }
  
  // 11. Check if inside a modal/dialog (might need special handling)
  const inModal = element.closest('[role="dialog"], .modal, .popup, .dialog');
  if (inModal) {
    reasons.push('Element is inside a modal/dialog');
  }
  
  // 12. Check for download triggers
  if (element.download || element.href?.includes('download')) {
    reasons.push('Download trigger detected');
  }
  
  // Determine if trusted click is needed
  const requires = reasons.length > 0;
  
  // Calculate confidence score (0-1)
  const confidence = Math.min(1, reasons.length * 0.25);
  
  return {
    requires,
    confidence,
    reasons,
    element: {
      tagName,
      id: element.id,
      className: element.className,
      text: element.textContent.trim().substring(0, 50)
    }
  };
}

// Function to be called from background script
async function analyzeClickRequirements(ref) {
  try {
    const analysis = requiresTrustedClick(ref);
    console.log('[ClickDetection] Analysis for', ref, ':', analysis);
    return analysis;
  } catch (error) {
    console.error('[ClickDetection] Error analyzing:', error);
    return {
      requires: false,
      error: error.message
    };
  }
}

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { requiresTrustedClick, analyzeClickRequirements };
}