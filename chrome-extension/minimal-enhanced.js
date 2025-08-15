// Enhanced minimal mode with Component Boundary Scoring Algorithm
// Generic solution for associating interactive elements with their content across ALL websites

console.log('[minimal-enhanced.js] Script loaded at', new Date().toISOString());

function captureEnhancedMinimalSnapshot(options = {}) {
  console.log('[minimal-enhanced.js] captureEnhancedMinimalSnapshot called with options:', options);
  const startTime = performance.now();
  const MAX_EXECUTION_TIME = 100; // ms budget
  const MAX_DEPTH = 8; // Max levels to ascend for container search
  const MAX_TEXT_LENGTH = 100; // Truncate long text
  const VIEWPORT_BUFFER = 1.2; // Include 20% outside viewport
  
  // Reset hash cache for each capture
  let hashCache = new WeakMap();
  
  // Pagination options
  const page = options.page || 1;
  const pageHeight = options.pageHeight || window.innerHeight;
  const pageMode = options.pageMode || 'viewport';
  
  let actualPageHeight = pageHeight;
  if (pageMode === 'fullhd') {
    actualPageHeight = 1080;
  } else if (pageMode === 'viewport') {
    actualPageHeight = window.innerHeight;
  }
  
  const pageTop = (page - 1) * actualPageHeight;
  const pageBottom = page * actualPageHeight;
  
  console.log(`[minimal-enhanced.js] Page ${page}: top=${pageTop}, bottom=${pageBottom}, height=${actualPageHeight}`);
  
  // Helper: Check if element is truly visible
  function isVisible(element) {
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    
    if (style.pointerEvents === 'none') {
      return false;
    }
    
    const rect = element.getBoundingClientRect();
    if (rect.width > 0.5 && rect.height > 0.5) {
      return true;
    }
    
    const isInteractive = element.matches('a, button, input, select, textarea, [onclick], [role="button"], [role="link"], [data-action], [data-buy]');
    if (!isInteractive) {
      return false;
    }
    
    const children = [...(element.children || []), ...(element.shadowRoot?.children || [])];
    
    if (children.length > 0) {
      return children.some(child => {
        const childRect = child.getBoundingClientRect();
        return childRect.width > 0.5 && childRect.height > 0.5;
      });
    }
    
    return false;
  }
  
  // Helper: Check if element is in current page
  function isInPage(element, buffer = VIEWPORT_BUFFER) {
    const style = window.getComputedStyle(element);
    if (style.position === 'fixed' || style.position === 'sticky') return true;
    
    const rect = element.getBoundingClientRect();
    const elementTop = window.scrollY + rect.top;
    const elementBottom = window.scrollY + rect.bottom;
    const bufferPx = actualPageHeight * (buffer - 1);
    
    return (
      elementBottom >= pageTop - bufferPx &&
      elementTop <= pageBottom + bufferPx &&
      rect.right >= 0 &&
      rect.left <= window.innerWidth
    );
  }
  
  // Helper: Get all interactive elements
  function getInteractiveElements() {
    const selectors = [
      'a[href]',
      'button',
      'input',
      'textarea', 
      'select',
      '[role="button"]',
      '[role="link"]',
      '[role="checkbox"]',
      '[role="radio"]',
      '[role="menuitem"]',
      '[role="tab"]',
      '[role="combobox"]',
      '[role="textbox"]',
      '[tabindex]:not([tabindex="-1"])',
      '[contenteditable="true"]',
      'summary',
      'details',
      '[onclick]',
      '[aria-haspopup]',
      '[aria-expanded]',
      '[data-action]',
      '[data-buy]',
      '[data-click]',
      '[data-link]',
      '.btn',
      '.button'
    ];
    
    const elements = new Set();
    
    selectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        if (isVisible(el) && isInPage(el)) {
          elements.add(el);
        }
      });
    });
    
    // Check shadow DOMs
    function findInShadow(root) {
      root.querySelectorAll('*').forEach(el => {
        if (el.shadowRoot) {
          selectors.forEach(selector => {
            el.shadowRoot.querySelectorAll(selector).forEach(shadowEl => {
              if (isVisible(shadowEl) && isInPage(shadowEl)) {
                elements.add(shadowEl);
              }
            });
          });
          findInShadow(el.shadowRoot);
        }
      });
    }
    findInShadow(document);
    
    return Array.from(elements);
  }
  
  // Helper: Get accessible name
  function getAccessibleName(element) {
    if (element.getAttribute('aria-labelledby')) {
      const ids = element.getAttribute('aria-labelledby').split(' ');
      return ids.map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ');
    }
    if (element.getAttribute('aria-label')) {
      return element.getAttribute('aria-label');
    }
    if (element.labels && element.labels.length > 0) {
      return element.labels[0].textContent?.trim();
    }
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
      return element.placeholder || element.value || '';
    }
    if (element.tagName.match(/^(BUTTON|A)$/)) {
      return element.textContent?.trim() || '';
    }
    return element.textContent?.trim() || '';
  }
  
  // Helper: Create structural hash with caching
  function getStructuralHash(element, options = {}) {
    const { includeContent = true, maxDepth = 2, maxChildren = 3 } = options;
    
    // Check cache first
    if (hashCache.has(element)) {
      const cached = hashCache.get(element);
      const optionsKey = JSON.stringify(options);
      if (cached[optionsKey]) {
        return cached[optionsKey];
      }
    }
    
    const parts = [];
    
    function traverse(el, depth = 0) {
      if (depth > maxDepth) return;
      
      parts.push(el.tagName);
      
      ['role', 'type', 'name', 'aria-label'].forEach(attr => {
        if (el.hasAttribute(attr)) {
          parts.push(`@${attr}`);
        }
      });
      
      if (depth === 0 && includeContent) {
        const accName = getAccessibleName(el).toLowerCase().replace(/[^a-z0-9]/g, '');
        if (accName) {
          parts.push(`#${accName.slice(0, 12)}`);
        }
      }
      
      if (el.children.length > 0 && depth < maxDepth) {
        parts.push('[');
        Array.from(el.children).slice(0, maxChildren).forEach(child => {
          traverse(child, depth + 1);
        });
        parts.push(']');
      }
    }
    
    traverse(element);
    const hash = parts.join('');
    
    // Store in cache
    const existing = hashCache.get(element) || {};
    existing[JSON.stringify(options)] = hash;
    hashCache.set(element, existing);
    
    return hash;
  }
  
  // NEW: Calculate boundary score for a candidate container
  function calculateBoundaryScore(candidate, originalElement, depth) {
    let score = 0;
    const tagName = candidate.tagName.toLowerCase();
    const classList = candidate.classList;
    
    // 1. High-confidence pattern matching
    if (tagName === 'tr' && candidate.closest('table')) score += 50;
    if (tagName === 'form' || tagName === 'fieldset') score += 40;
    if (tagName === 'article' || classList.contains('post') || classList.contains('tweet')) score += 40;
    if (classList.contains('card') || classList.contains('panel') || classList.contains('modal-content')) score += 35;
    if (classList.contains('product') || classList.contains('item')) score += 30;
    
    // 2. Semantic tags
    const tagScores = { 'li': 35, 'section': 25, 'dialog': 25, 'details': 20, 'figure': 15 };
    score += tagScores[tagName] || 0;
    
    // 3. ARIA roles
    const role = candidate.getAttribute('role');
    const roleScores = { 
      'article': 40, 'listitem': 35, 'row': 35, 'form': 30, 
      'region': 25, 'dialog': 25, 'group': 15, 'menuitem': 20 
    };
    if (role) score += roleScores[role] || 0;
    
    // 4. Data attributes (modern web apps)
    if (candidate.dataset.component || candidate.dataset.testid || candidate.dataset.item) score += 25;
    if (candidate.hasAttribute('itemscope')) score += 30;
    
    // 5. Sibling similarity (critical for lists)
    const parent = candidate.parentElement;
    if (parent && parent.children.length > 1 && parent.children.length < 100) {
      const structuralHash = getStructuralHash(candidate, { includeContent: false });
      let similarSiblings = 0;
      for (const child of parent.children) {
        if (child !== candidate && getStructuralHash(child, { includeContent: false }) === structuralHash) {
          similarSiblings++;
        }
      }
      if (similarSiblings >= 1) {
        score += 30 * (1 + Math.min(similarSiblings / 10, 1));
      }
    }
    
    // 6. Visual separation
    const style = window.getComputedStyle(candidate);
    if (parseFloat(style.borderTopWidth) > 0 || parseFloat(style.borderLeftWidth) > 0 || style.boxShadow !== 'none') {
      score += 10;
    }
    if (style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)') {
      const parentStyle = candidate.parentElement ? window.getComputedStyle(candidate.parentElement) : null;
      if (!parentStyle || style.backgroundColor !== parentStyle.backgroundColor) {
        score += 5;
      }
    }
    
    // 7. Penalties
    const rect = candidate.getBoundingClientRect();
    const viewportArea = window.innerWidth * window.innerHeight;
    if ((rect.width * rect.height) / viewportArea > 0.8) score -= 50; // Too large
    score -= depth * 5; // Prefer closer ancestors
    if (tagName === 'div' && score < 10) score -= 10; // Generic div penalty
    
    return score;
  }
  
  // NEW: Find the best semantic container for an element
  function findSemanticContainer(element, maxDepth = MAX_DEPTH) {
    let candidates = [];
    let current = element.parentElement;
    let depth = 0;
    
    while (current && current.tagName !== 'BODY' && depth < maxDepth) {
      const score = calculateBoundaryScore(current, element, depth);
      candidates.push({ element: current, score });
      current = current.parentElement;
      depth++;
    }
    
    if (candidates.length === 0) return null;
    
    // Find the candidate with the highest score
    const bestCandidate = candidates.reduce((best, current) => {
      return current.score > best.score ? current : best;
    }, { element: null, score: -Infinity });
    
    // Confidence threshold
    return bestCandidate.score > 10 ? bestCandidate.element : null;
  }
  
  // NEW: Extract key content from a component
  function extractComponentContent(container) {
    const content = new Set();
    
    // Find headings, images, and significant text
    container.querySelectorAll('h1, h2, h3, h4, h5, h6, img[alt], p, span, div, td, th').forEach(el => {
      // Stop at nested components
      if (el.closest('[data-component-root]') && el.closest('[data-component-root]') !== container) {
        return;
      }
      
      // Check if visible and not interactive
      if (isVisible(el) && !el.matches('a, button, input, select, textarea, [role="button"]')) {
        const text = el.textContent?.trim() || '';
        
        // Add if it has meaningful content
        if ((el.tagName === 'IMG' && el.alt) || 
            (text.length > 10 && text.length < 300) ||
            el.tagName.match(/^H[1-6]$/)) {
          content.add(el);
        }
      }
    });
    
    return Array.from(content).slice(0, 5); // Limit to 5 content items per component
  }
  
  // Helper: Serialize element
  function serializeElement(element) {
    const tag = element.tagName.toLowerCase();
    const ref = window.__elementTracker ? window.__elementTracker.getElementId(element) : null;
    
    let text = getAccessibleName(element);
    const isHeading = tag.match(/^h[1-6]$/);
    const maxLen = isHeading ? 150 : MAX_TEXT_LENGTH;
    
    if (text.length > maxLen) {
      text = text.substring(0, maxLen - 3) + '...';
    }
    
    const attrs = [];
    
    const role = element.getAttribute('role') || 
                 (element.tagName === 'BUTTON' ? 'button' : '') ||
                 (element.tagName === 'A' && element.href ? 'link' : '');
    if (role) attrs.push(`role:${role}`);
    
    if (element.type) attrs.push(`type:${element.type}`);
    if (element.href) attrs.push('href');
    if (element.disabled) attrs.push('disabled');
    if (element.checked) attrs.push('checked');
    if (element.required) attrs.push('required');
    
    let result = tag;
    if (ref) result += ` [ref=${ref}]`;
    if (text) result += ` "${text}"`;
    if (attrs.length > 0) result += ` {${attrs.join(', ')}}`;
    
    return result;
  }
  
  // NEW: Serialize a component with its content and actions
  function serializeComponent(component) {
    let output = `Component: ${serializeElement(component.container)}\n`;
    
    if (component.content.length > 0) {
      output += `  Content:\n`;
      component.content.forEach(node => {
        output += `    - ${serializeElement(node)}\n`;
      });
    }
    
    if (component.actions.length > 0) {
      output += `  Actions:\n`;
      component.actions.forEach(action => {
        output += `    - ${serializeElement(action)}\n`;
      });
    }
    
    return output;
  }
  
  // MAIN CAPTURE LOGIC - Component-centric approach
  const allInteractive = getInteractiveElements();
  const components = new Map();
  const processedActions = new Set();
  
  // Component identification phase
  allInteractive.forEach(element => {
    if (processedActions.has(element)) return;
    
    const container = findSemanticContainer(element);
    if (container) {
      // Mark this container as a component root
      container.setAttribute('data-component-root', 'true');
      
      if (!components.has(container)) {
        components.set(container, { 
          container, 
          actions: [], 
          content: [] 
        });
      }
      
      const component = components.get(container);
      
      // Find all actions within this container
      const actionsInContainer = Array.from(
        container.querySelectorAll('a, button, input, select, textarea, [role="button"], [role="link"]')
      ).filter(action => isVisible(action) && isInPage(action) && !processedActions.has(action));
      
      actionsInContainer.forEach(action => {
        component.actions.push(action);
        processedActions.add(action);
      });
      
      // Ensure the original element is included
      if (!processedActions.has(element)) {
        component.actions.push(element);
        processedActions.add(element);
      }
    }
  });
  
  // Content extraction phase
  components.forEach(component => {
    component.content = extractComponentContent(component.container);
  });
  
  // Handle orphaned actions (not in any component)
  const orphanedActions = allInteractive.filter(el => !processedActions.has(el));
  
  // Calculate total pages
  const documentHeight = Math.max(
    document.body.scrollHeight,
    document.body.offsetHeight,
    document.documentElement.clientHeight,
    document.documentElement.scrollHeight,
    document.documentElement.offsetHeight
  );
  const totalPages = Math.ceil(documentHeight / actualPageHeight);
  
  // Build output
  let output = `Page: ${document.title || 'Untitled'}\n`;
  output += `URL: ${window.location.href}\n`;
  output += `[Component-Based Minimal - Page ${page}/${totalPages}]\n`;
  output += `[${allInteractive.length} interactive elements, ${components.size} components]\n`;
  output += `[Page height: ${actualPageHeight}px, Mode: ${pageMode}]\n\n`;
  
  if (components.size > 0) {
    output += `[Found ${components.size} Components]\n\n`;
    let componentIndex = 1;
    components.forEach(component => {
      output += `=== Component ${componentIndex} ===\n`;
      output += serializeComponent(component);
      output += '\n';
      componentIndex++;
    });
  }
  
  if (orphanedActions.length > 0) {
    output += `[Found ${orphanedActions.length} Orphaned Interactive Elements]\n`;
    orphanedActions.forEach(element => {
      output += `  ${serializeElement(element)}\n`;
    });
    output += '\n';
  }
  
  // Clean up attribute markers
  document.querySelectorAll('[data-component-root]').forEach(el => {
    el.removeAttribute('data-component-root');
  });
  
  // Performance info
  const executionTime = performance.now() - startTime;
  output += `[Execution: ${executionTime.toFixed(1)}ms]\n`;
  
  // Pagination hints
  if (totalPages > 1) {
    output += `\n[Pagination: Page ${page} of ${totalPages}]`;
    if (page > 1) {
      output += `\n[Previous page: Use options {page: ${page - 1}}]`;
    }
    if (page < totalPages) {
      output += `\n[Next page: Use options {page: ${page + 1}}]`;
    }
    output += `\n[Change page size: Use options {pageMode: 'fullhd'} or {pageHeight: 800}]`;
  }
  
  return output;
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { captureEnhancedMinimalSnapshot };
}