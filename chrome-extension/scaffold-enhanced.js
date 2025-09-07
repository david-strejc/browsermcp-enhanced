// Enhanced scaffold mode with intelligent clustering and deduplication
// Based on o3 model recommendations
// v1.1.0 - Added autofill detection

// Add CSS animation for autofill detection
(function() {
  if (!document.getElementById('bmcp-autofill-styles')) {
    const style = document.createElement('style');
    style.id = 'bmcp-autofill-styles';
    style.textContent = `
      @keyframes bmcp-autofill { from {} to {} }
      input:-webkit-autofill,
      textarea:-webkit-autofill,
      select:-webkit-autofill {
        animation: bmcp-autofill 0s 1;
      }
    `;
    document.head.appendChild(style);
    
    // Listen for autofill animation
    document.addEventListener('animationstart', e => {
      if (e.animationName === 'bmcp-autofill') {
        e.target.dataset.bmcpAutofilled = 'true';
      }
    });
  }
})();

function captureEnhancedScaffoldSnapshot() {
  const startTime = performance.now();
  const MAX_EXECUTION_TIME = 50; // ms budget
  const DEDUPE_THRESHOLD = 5; // Min elements to trigger deduplication
  const MAX_ELEMENTS = 100; // Safety limit for output
  
  // Helper: Detect if element is autofilled and its type
  function getAutofillInfo(el) {
    if (!/^(INPUT|TEXTAREA|SELECT)$/i.test(el.tagName)) return null;
    
    let isAutofilled = false;
    
    // Standard spec + webkit pseudo-classes
    try {
      if (el.matches(':autofill') || el.matches(':-webkit-autofill')) isAutofilled = true;
    } catch(e) {
      // Pseudo-class might not be supported
    }
    
    // Check dataset set by animation listener
    if (el.dataset.bmcpAutofilled === 'true') isAutofilled = true;
    
    // Fallback heuristic: typical autofill background color
    const cs = window.getComputedStyle(el);
    if (el.value && cs.backgroundColor === 'rgb(232, 240, 254)') isAutofilled = true;
    
    if (!isAutofilled) return null;
    
    // Detect what type of field was autofilled based on autocomplete attribute or heuristics
    const autocomplete = el.getAttribute('autocomplete') || '';
    const name = (el.name || '').toLowerCase();
    const id = (el.id || '').toLowerCase();
    const placeholder = (el.placeholder || '').toLowerCase();
    const type = el.type || '';
    
    // Categorize autofill type
    let autofillType = 'unknown';
    
    // Check autocomplete attribute first (most reliable)
    if (autocomplete) {
      if (autocomplete.includes('email')) autofillType = 'email';
      else if (autocomplete.includes('tel')) autofillType = 'phone';
      else if (autocomplete.includes('cc-')) autofillType = 'credit-card';
      else if (autocomplete.includes('address') || autocomplete.includes('postal')) autofillType = 'address';
      else if (autocomplete.includes('name')) autofillType = 'name';
      else if (autocomplete.includes('username')) autofillType = 'username';
      else if (autocomplete.includes('password')) autofillType = 'password';
      else if (autocomplete.includes('bday')) autofillType = 'birthday';
      else if (autocomplete.includes('url')) autofillType = 'website';
    }
    // Fallback to field attributes
    else if (type === 'password') autofillType = 'password';
    else if (type === 'email') autofillType = 'email';
    else if (type === 'tel') autofillType = 'phone';
    else if (type === 'url') autofillType = 'website';
    // Check name/id/placeholder for hints
    else if (name.includes('email') || id.includes('email')) autofillType = 'email';
    else if (name.includes('phone') || name.includes('tel') || id.includes('phone')) autofillType = 'phone';
    else if (name.includes('address') || name.includes('street') || name.includes('city')) autofillType = 'address';
    else if (name.includes('zip') || name.includes('postal')) autofillType = 'postal-code';
    else if (name.includes('card') || name.includes('cc')) autofillType = 'credit-card';
    else if (name.includes('cvv') || name.includes('cvc') || name.includes('security')) autofillType = 'card-security';
    else if (name.includes('user') || name.includes('login') || name.includes('account')) autofillType = 'username';
    else if (name.includes('name') && !name.includes('user')) autofillType = 'name';
    else if (name.includes('company') || name.includes('organization')) autofillType = 'organization';
    else if (name.includes('country')) autofillType = 'country';
    else if (name.includes('state') || name.includes('province')) autofillType = 'state';
    
    return {
      isAutofilled: true,
      type: autofillType,
      autocompleteAttr: autocomplete
    };
  }
  
  // Helper: Detect if element is autofilled (simplified wrapper)
  function isAutofilled(el) {
    const info = getAutofillInfo(el);
    return info ? info.isAutofilled : false;
  }
  
  // Helper: Check if element is visible
  function isVisible(element) {
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (style.opacity === '0') return false;
    
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    
    // Check if in viewport (with buffer)
    const buffer = window.innerHeight * 0.5;
    return rect.bottom >= -buffer && rect.top <= window.innerHeight + buffer;
  }
  
  // Helper: Get element text (prioritized)
  function getElementText(element) {
    // Priority: aria-label > visible text > placeholder > value > title
    return (
      element.getAttribute('aria-label') ||
      element.textContent?.trim() ||
      element.placeholder ||
      (element.value && element.type !== 'password' ? element.value : '') ||
      element.title ||
      ''
    ).substring(0, 60);
  }
  
  // Helper: Create element fingerprint for clustering
  function getElementFingerprint(element) {
    const text = getElementText(element);
    const normalizedText = text.toLowerCase()
      .replace(/\d+/g, '#')  // Replace numbers with #
      .replace(/\s+/g, ' ')  // Normalize whitespace
      .trim();
    
    // Walk up to find container pattern
    let containerSignature = '';
    let parent = element.parentElement;
    let depth = 0;
    while (parent && depth < 3 && parent !== document.body) {
      const siblings = Array.from(parent.parentElement?.children || []);
      const similarSiblings = siblings.filter(sib => 
        sib.tagName === parent.tagName && 
        sib.className === parent.className
      ).length;
      
      if (similarSiblings >= DEDUPE_THRESHOLD) {
        containerSignature = `${parent.tagName}.${parent.className}@${depth}`;
        break;
      }
      parent = parent.parentElement;
      depth++;
    }
    
    const autofillInfo = getAutofillInfo(element);
    
    return {
      text: text,
      normalizedText: normalizedText,
      tag: element.tagName.toLowerCase(),
      type: element.type || '',
      role: element.getAttribute('role') || '',
      containerSignature: containerSignature,
      classList: Array.from(element.classList).sort().join(' '),
      isInForm: !!element.closest('form'),
      formId: element.closest('form')?.id || null,
      navId: element.closest('nav, [role="navigation"]')?.id || null,
      isAutofilled: autofillInfo ? autofillInfo.isAutofilled : false,
      autofillType: autofillInfo ? autofillInfo.type : null
    };
  }
  
  // Phase 1: Collect all interactive elements
  const interactiveSelectors = [
    'button',
    '[role="button"]',
    'a[href]',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    '[role="menuitem"]',
    '[role="tab"]',
    '[role="link"]',
    '[onclick]',
    '[contenteditable="true"]'
  ];
  
  const allElements = [];
  const seen = new Set();
  
  for (const selector of interactiveSelectors) {
    if (performance.now() - startTime > MAX_EXECUTION_TIME) break;
    
    const elements = document.querySelectorAll(selector);
    for (const element of elements) {
      if (seen.has(element)) continue;
      if (!isVisible(element)) continue;
      
      seen.add(element);
      const fingerprint = getElementFingerprint(element);
      
      allElements.push({
        element: element,
        ref: window.__elementTracker.getElementId(element),
        fingerprint: fingerprint
      });
      
      if (allElements.length >= MAX_ELEMENTS * 3) break; // Collect more for clustering
    }
  }
  
  // Phase 2: Smart clustering and deduplication
  const clusters = new Map();
  const formElements = [];
  const navElements = [];
  const uniqueElements = [];
  
  for (const item of allElements) {
    const fp = item.fingerprint;
    
    // Special handling for form elements - keep all
    if (fp.isInForm) {
      formElements.push(item);
      continue;
    }
    
    // Special handling for navigation - keep first level only
    if (fp.navId) {
      const navDepth = item.element.closest('nav')?.contains(item.element.parentElement?.closest('nav')) ? 2 : 1;
      if (navDepth === 1) {
        navElements.push(item);
      }
      continue;
    }
    
    // Cluster by container signature + normalized text pattern
    const clusterKey = fp.containerSignature + '::' + fp.normalizedText.substring(0, 20);
    
    if (fp.containerSignature && clusters.has(clusterKey)) {
      clusters.get(clusterKey).push(item);
    } else if (fp.containerSignature) {
      clusters.set(clusterKey, [item]);
    } else {
      // No container pattern, keep as unique
      uniqueElements.push(item);
    }
  }
  
  // Phase 3: Select representatives from clusters
  const representatives = [];
  
  for (const [key, items] of clusters.entries()) {
    if (items.length >= DEDUPE_THRESHOLD) {
      // Keep first item as representative
      const rep = items[0];
      rep.clusterSize = items.length;
      representatives.push(rep);
    } else {
      // Keep all if below threshold
      uniqueElements.push(...items);
    }
  }
  
  // Phase 4: Build regions for output
  const regions = [];
  
  // Find major landmarks
  const landmarks = {
    header: document.querySelector('header, [role="banner"]'),
    nav: document.querySelector('nav, [role="navigation"]'),
    main: document.querySelector('main, [role="main"], #content, .content'),
    footer: document.querySelector('footer, [role="contentinfo"]')
  };
  
  for (const [type, element] of Object.entries(landmarks)) {
    if (!element) continue;
    
    const rect = element.getBoundingClientRect();
    const visible = rect.top < window.innerHeight && rect.bottom > 0;
    
    // Count contained elements
    const containedReps = representatives.filter(r => element.contains(r.element));
    const containedUnique = uniqueElements.filter(r => element.contains(r.element));
    const containedForm = formElements.filter(r => element.contains(r.element));
    const containedNav = navElements.filter(r => element.contains(r.element));
    
    regions.push({
      type: type,
      ref: window.__elementTracker.getElementId(element),
      visible: visible,
      elements: [
        ...containedReps.slice(0, 10),
        ...containedUnique.slice(0, 10),
        ...containedForm,
        ...containedNav.slice(0, 10)
      ].slice(0, 20) // Limit per region
    });
  }
  
  // Add orphaned elements (not in any landmark)
  const orphaned = [
    ...representatives,
    ...uniqueElements,
    ...formElements,
    ...navElements
  ].filter(item => !Object.values(landmarks).some(l => l?.contains(item.element)));
  
  if (orphaned.length > 0) {
    regions.push({
      type: 'content',
      ref: 'body',
      visible: true,
      elements: orphaned.slice(0, 20)
    });
  }
  
  // Phase 5: Format output
  let output = `Page: ${document.title?.substring(0, 60) || 'Untitled'}\n`;
  output += `URL: ${window.location.href}\n`;
  output += `[Enhanced Scaffold: ${regions.length} regions, ${allElements.length} elements found]\n\n`;
  
  // Add any detected forms
  const forms = document.querySelectorAll('form');
  if (forms.length > 0) {
    output += `[${forms.length} form(s) detected - all form elements preserved]\n\n`;
  }
  
  // Output regions
  regions.forEach(region => {
    if (region.elements.length === 0) return;
    
    output += `${region.type} [ref=${region.ref}]`;
    if (!region.visible) output += ' (below fold)';
    output += '\n';
    
    // Group elements by type for cleaner output
    const byType = {};
    region.elements.forEach(item => {
      const type = item.fingerprint.tag + (item.fingerprint.type ? `:${item.fingerprint.type}` : '');
      if (!byType[type]) byType[type] = [];
      byType[type].push(item);
    });
    
    // Output grouped elements
    for (const [type, items] of Object.entries(byType)) {
      items.slice(0, 5).forEach(item => {
        const text = getElementText(item.element);
        output += `  ${type} [ref=${item.ref}] "${text}"`;
        
        if (item.clusterSize) {
          output += ` (×${item.clusterSize} similar)`;
        }
        if (item.fingerprint.isInForm) {
          output += ' [form]';
        }
        if (item.fingerprint.isAutofilled) {
          const afType = item.fingerprint.autofillType;
          if (afType && afType !== 'unknown') {
            output += ` [AUTOFILLED:${afType}]`;
          } else {
            output += ' [AUTOFILLED]';
          }
        }
        output += '\n';
      });
    }
    output += '\n';
  });
  
  // Add key elements section for quick access
  const keyElements = [];
  const autofilledFields = [];
  
  // Collect autofilled fields with their types
  allElements.forEach(item => {
    if (item.fingerprint.isAutofilled) {
      autofilledFields.push({
        type: item.fingerprint.autofillType || 'unknown',
        ref: item.ref
      });
    }
  });
  
  // Search boxes
  const searchInputs = document.querySelectorAll('input[type="search"], input[placeholder*="search" i], input[aria-label*="search" i]');
  searchInputs.forEach(el => {
    if (isVisible(el)) {
      keyElements.push({
        ref: window.__elementTracker.getElementId(el),
        type: 'search',
        text: el.placeholder || 'Search'
      });
    }
  });
  
  // Primary buttons (submit, buy, add to cart, etc)
  const primaryButtons = document.querySelectorAll('button[type="submit"], button[class*="primary"], button[class*="buy"], button[class*="cart"], a[class*="buy"], a[class*="cart"]');
  const seenButtonTexts = new Set();
  primaryButtons.forEach(el => {
    if (isVisible(el)) {
      const text = getElementText(el).toLowerCase();
      if (!seenButtonTexts.has(text)) {
        seenButtonTexts.add(text);
        keyElements.push({
          ref: window.__elementTracker.getElementId(el),
          type: 'button',
          text: getElementText(el)
        });
      }
    }
  });
  
  if (keyElements.length > 0) {
    output += '[Key Elements]\n';
    keyElements.slice(0, 10).forEach(item => {
      output += `${item.type} [ref=${item.ref}] "${item.text}"\n`;
    });
  }
  
  // Add autofill summary if any fields are autofilled
  if (autofilledFields.length > 0) {
    output += `\n📝 Autofilled Fields Detected:\n`;
    
    // Group by type
    const autofillByType = {};
    autofilledFields.forEach(field => {
      if (!autofillByType[field.type]) autofillByType[field.type] = 0;
      autofillByType[field.type]++;
    });
    
    // Show summary
    Object.entries(autofillByType).forEach(([type, count]) => {
      const icon = {
        'username': '👤',
        'password': '🔐',
        'email': '📧',
        'phone': '📱',
        'address': '🏠',
        'credit-card': '💳',
        'name': '📝',
        'postal-code': '📮',
        'organization': '🏢',
        'unknown': '❓'
      }[type] || '📋';
      
      output += `  ${icon} ${count} ${type} field(s)\n`;
    });
    
    output += `\n💡 Tip: Fields marked [AUTOFILLED] contain saved data. `;
    
    // Provide context-specific advice
    if (autofillByType['username'] || autofillByType['password']) {
      output += `You can click Login/Submit directly without typing credentials.\n`;
    } else if (autofillByType['credit-card']) {
      output += `Credit card info is pre-filled. Review and submit payment.\n`;
    } else if (autofillByType['address']) {
      output += `Address information is pre-filled. Review and continue.\n`;
    } else {
      output += `Review the pre-filled data and proceed.\n`;
    }
  }
  
  // Performance metrics (in dev mode)
  const executionTime = performance.now() - startTime;
  if (window.__DEBUG_SCAFFOLD) {
    output += `\n[Debug: ${executionTime.toFixed(1)}ms, ${allElements.length} collected, ${clusters.size} clusters]\n`;
  }
  
  return output;
}

// Export for use in background.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { captureEnhancedScaffoldSnapshot };
}