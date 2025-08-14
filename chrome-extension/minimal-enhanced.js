// Enhanced minimal mode with generic optimizations
// Based on universal principles that work across all websites

console.log('[minimal-enhanced.js] Script loaded at', new Date().toISOString());

function captureEnhancedMinimalSnapshot() {
  console.log('[minimal-enhanced.js] captureEnhancedMinimalSnapshot called');
  const startTime = performance.now();
  const MAX_EXECUTION_TIME = 100; // ms budget
  const MAX_DEPTH = 4; // Max levels to ascend for local window
  const MAX_BRANCHING = 3; // Stop ascending if parent has more children
  const VIEWPORT_BUFFER = 1.2; // Include 20% outside viewport
  const MAX_TEXT_LENGTH = 100; // Truncate long text
  
  // Helper: Check if element is truly visible
  function isVisible(element) {
    // Check computed styles
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (style.opacity === '0') return false;
    
    // Check dimensions
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    
    // Element is visible
    return true;
  }
  
  // Helper: Check if element is in viewport (with buffer)
  function isInViewport(element, buffer = VIEWPORT_BUFFER) {
    // Always include fixed position elements
    const style = window.getComputedStyle(element);
    if (style.position === 'fixed' || style.position === 'sticky') return true;
    
    const rect = element.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const bufferPx = viewportHeight * (buffer - 1);
    
    return (
      rect.bottom >= -bufferPx &&
      rect.top <= viewportHeight + bufferPx &&
      rect.right >= 0 &&
      rect.left <= viewportWidth
    );
  }
  
  // Helper: Get all interactive elements
  function getInteractiveElements() {
    // Comprehensive interactive selectors
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
      '[aria-expanded]'
    ];
    
    const elements = new Set();
    
    // Query all interactive elements
    selectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        if (isVisible(el) && isInViewport(el)) {
          elements.add(el);
        }
      });
    });
    
    // Also check shadow DOMs recursively
    function findInShadow(root) {
      root.querySelectorAll('*').forEach(el => {
        if (el.shadowRoot) {
          selectors.forEach(selector => {
            el.shadowRoot.querySelectorAll(selector).forEach(shadowEl => {
              if (isVisible(shadowEl) && isInViewport(shadowEl)) {
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
  
  // Helper: Get associated labels and ARIA elements
  function getAssociatedElements(element) {
    const associated = new Set();
    
    // Check for label[for="id"]
    if (element.id) {
      const label = document.querySelector(`label[for="${element.id}"]`);
      if (label && isVisible(label)) associated.add(label);
    }
    
    // Check for parent label
    const parentLabel = element.closest('label');
    if (parentLabel && isVisible(parentLabel)) associated.add(parentLabel);
    
    // Check for aria-labelledby
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      labelledBy.split(' ').forEach(id => {
        const el = document.getElementById(id);
        if (el && isVisible(el)) associated.add(el);
      });
    }
    
    // Check for aria-describedby
    const describedBy = element.getAttribute('aria-describedby');
    if (describedBy) {
      describedBy.split(' ').forEach(id => {
        const el = document.getElementById(id);
        if (el && isVisible(el)) associated.add(el);
      });
    }
    
    return Array.from(associated);
  }
  
  // Helper: Build local window for an element
  function buildLocalWindow(element, maxDepth = MAX_DEPTH, maxBranching = MAX_BRANCHING) {
    const nodes = new Set();
    nodes.add(element);
    
    let current = element;
    let depth = 0;
    
    // Ascend until we hit limits or body
    while (current.parentElement && depth < maxDepth) {
      const parent = current.parentElement;
      
      // Stop if parent has too many children (branching point)
      if (parent.children.length > maxBranching) {
        // But still include the parent as context
        nodes.add(parent);
        break;
      }
      
      // Stop at semantic boundaries
      if (parent.tagName.match(/^(MAIN|ARTICLE|SECTION|NAV|ASIDE|HEADER|FOOTER|FORM)$/)) {
        nodes.add(parent);
        break;
      }
      
      // Add parent and its children (siblings of current)
      nodes.add(parent);
      Array.from(parent.children).forEach(child => {
        if (isVisible(child)) {
          nodes.add(child);
        }
      });
      
      current = parent;
      depth++;
    }
    
    return nodes;
  }
  
  // Helper: Create structural hash for deduplication
  function getStructuralHash(element) {
    // Create a hash based on tag structure and attributes
    const parts = [];
    
    function traverse(el, depth = 0) {
      if (depth > 2) return; // Only hash 2 levels deep
      
      parts.push(el.tagName);
      
      // Include semantic attributes in hash
      ['role', 'type', 'name', 'aria-label'].forEach(attr => {
        if (el.hasAttribute(attr)) {
          parts.push(`@${attr}`);
        }
      });
      
      // Include child structure
      if (el.children.length > 0 && depth < 2) {
        parts.push('[');
        Array.from(el.children).slice(0, 3).forEach(child => {
          traverse(child, depth + 1);
        });
        parts.push(']');
      }
    }
    
    traverse(element);
    return parts.join('');
  }
  
  // Helper: Compact element serialization
  function serializeElement(element) {
    const tag = element.tagName.toLowerCase();
    const ref = window.__elementTracker ? window.__elementTracker.getElementId(element) : null;
    
    // Get meaningful text
    let text = '';
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
      text = element.value || element.placeholder || '';
    } else {
      text = element.textContent?.trim() || element.getAttribute('aria-label') || '';
    }
    
    // Truncate long text
    if (text.length > MAX_TEXT_LENGTH) {
      text = text.substring(0, MAX_TEXT_LENGTH - 3) + '...';
    }
    
    // Build compact representation
    const attrs = [];
    
    // Include key attributes
    if (element.type) attrs.push(`type:${element.type}`);
    if (element.role) attrs.push(`role:${element.role}`);
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
  
  // Main capture logic
  const allInteractive = getInteractiveElements();
  const nodesToKeep = new Set();
  const structuralHashes = new Map();
  
  // Build local windows for all interactive elements
  allInteractive.forEach(element => {
    // Get local window
    const localWindow = buildLocalWindow(element);
    localWindow.forEach(node => nodesToKeep.add(node));
    
    // Get associated labels/ARIA elements
    const associated = getAssociatedElements(element);
    associated.forEach(node => nodesToKeep.add(node));
  });
  
  // Group nodes by structural similarity
  const nodeGroups = new Map();
  const processedNodes = new Set();
  
  nodesToKeep.forEach(node => {
    if (processedNodes.has(node)) return;
    
    const hash = getStructuralHash(node);
    if (!nodeGroups.has(hash)) {
      nodeGroups.set(hash, []);
    }
    nodeGroups.get(hash).push(node);
    processedNodes.add(node);
  });
  
  // Build output
  let output = `Page: ${document.title || 'Untitled'}\n`;
  output += `URL: ${window.location.href}\n`;
  output += `[Enhanced Minimal: ${allInteractive.length} interactive elements found]\n\n`;
  
  // Find major landmarks
  const landmarks = ['header', 'nav', 'main', 'article', 'aside', 'footer'].map(tag => {
    return document.querySelector(tag) || document.querySelector(`[role="${tag}"]`);
  }).filter(Boolean);
  
  // Output by regions/landmarks
  landmarks.forEach(landmark => {
    if (!nodesToKeep.has(landmark) && !Array.from(nodesToKeep).some(n => landmark.contains(n))) {
      return; // Skip if no interactive elements in this landmark
    }
    
    const landmarkTag = landmark.tagName.toLowerCase();
    const landmarkRef = window.__elementTracker ? window.__elementTracker.getElementId(landmark) : null;
    
    output += `${landmarkTag}`;
    if (landmarkRef) output += ` [ref=${landmarkRef}]`;
    output += '\n';
    
    // Find nodes in this landmark
    const landmarkNodes = Array.from(nodesToKeep).filter(n => landmark.contains(n) && n !== landmark);
    const groupedInLandmark = new Map();
    
    // Group similar elements
    landmarkNodes.forEach(node => {
      const hash = getStructuralHash(node);
      if (!groupedInLandmark.has(hash)) {
        groupedInLandmark.set(hash, []);
      }
      groupedInLandmark.get(hash).push(node);
    });
    
    // Output groups
    groupedInLandmark.forEach((nodes, hash) => {
      if (nodes.length > 5) {
        // Show first 3 and summarize rest
        nodes.slice(0, 3).forEach(node => {
          output += `  ${serializeElement(node)}\n`;
        });
        output += `  ... (${nodes.length - 3} more similar elements)\n`;
      } else {
        // Show all if few
        nodes.forEach(node => {
          output += `  ${serializeElement(node)}\n`;
        });
      }
    });
    
    output += '\n';
  });
  
  // Add orphaned interactive elements (not in any landmark)
  const orphaned = Array.from(nodesToKeep).filter(node => {
    return !landmarks.some(landmark => landmark && landmark.contains(node));
  });
  
  if (orphaned.length > 0) {
    output += 'content\n';
    const grouped = new Map();
    
    orphaned.forEach(node => {
      const hash = getStructuralHash(node);
      if (!grouped.has(hash)) {
        grouped.set(hash, []);
      }
      grouped.get(hash).push(node);
    });
    
    grouped.forEach((nodes, hash) => {
      if (nodes.length > 5) {
        nodes.slice(0, 3).forEach(node => {
          output += `  ${serializeElement(node)}\n`;
        });
        output += `  ... (${nodes.length - 3} more similar elements)\n`;
      } else {
        nodes.forEach(node => {
          output += `  ${serializeElement(node)}\n`;
        });
      }
    });
  }
  
  // Performance info
  const executionTime = performance.now() - startTime;
  output += `\n[Execution: ${executionTime.toFixed(1)}ms, ${nodesToKeep.size} nodes kept]\n`;
  
  return output;
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { captureEnhancedMinimalSnapshot };
}