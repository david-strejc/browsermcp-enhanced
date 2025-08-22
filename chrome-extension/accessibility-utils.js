// W3C-compliant Accessible Name Computation and Form Association Utilities
// Based on W3C Accessible Name and Description Computation 1.2

/**
 * Compute accessible name following W3C standards
 * https://www.w3.org/TR/accname-1.2/
 */
function computeAccessibleName(element, visitedNodes = new Set()) {
  if (!element || visitedNodes.has(element)) return '';
  visitedNodes.add(element);
  
  // Step 1: Check if element is hidden (skip if aria-hidden or display:none)
  if (element.getAttribute('aria-hidden') === 'true') return '';
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') {
    // Exception: aria-labelledby can reference hidden elements
    if (!Array.from(visitedNodes).some(node => 
      node.getAttribute('aria-labelledby')?.includes(element.id)
    )) {
      return '';
    }
  }
  
  // Step 2: aria-labelledby (highest priority)
  if (element.getAttribute('aria-labelledby')) {
    const ids = element.getAttribute('aria-labelledby').split(/\s+/);
    const texts = ids.map(id => {
      const ref = document.getElementById(id);
      return ref ? computeAccessibleName(ref, new Set(visitedNodes)) : '';
    }).filter(Boolean);
    if (texts.length > 0) return texts.join(' ');
  }
  
  // Step 3: aria-label
  if (element.getAttribute('aria-label')) {
    return element.getAttribute('aria-label');
  }
  
  // Step 4: Native HTML labeling
  if (element.tagName === 'INPUT' || element.tagName === 'SELECT' || element.tagName === 'TEXTAREA') {
    // 4a: Check for associated label element
    const label = findAssociatedLabel(element);
    if (label) {
      return computeAccessibleName(label, new Set(visitedNodes));
    }
    
    // 4b: Placeholder as fallback
    if (element.placeholder) {
      return element.placeholder;
    }
    
    // 4c: For specific input types, use value
    if (element.type === 'submit' || element.type === 'reset' || element.type === 'button') {
      return element.value || '';
    }
  }
  
  // Step 5: For elements with text content
  if (element.tagName === 'BUTTON' || element.tagName === 'A' || element.tagName === 'LABEL') {
    // Get text content, but exclude nested interactive elements
    return getTextContent(element, visitedNodes);
  }
  
  // Step 6: Title attribute as last resort
  if (element.title) {
    return element.title;
  }
  
  // Step 7: For other elements, recursively compute from children
  if (!['INPUT', 'TEXTAREA', 'SELECT', 'IMG'].includes(element.tagName)) {
    return getTextContent(element, visitedNodes);
  }
  
  return '';
}

/**
 * Find associated label for a form control
 * Handles multiple patterns beyond standard for/id
 */
function findAssociatedLabel(input) {
  // Pattern 1: Standard for/id association
  if (input.id && input.labels && input.labels.length > 0) {
    return input.labels[0];
  }
  
  // Pattern 2: Implicit label (input is child of label)
  const parentLabel = input.closest('label');
  if (parentLabel) {
    return parentLabel;
  }
  
  // Pattern 3: aria-labelledby pointing to a label
  if (input.getAttribute('aria-labelledby')) {
    const labelId = input.getAttribute('aria-labelledby').split(/\s+/)[0];
    const label = document.getElementById(labelId);
    if (label) return label;
  }
  
  // Pattern 4: data-name matching pattern
  const dataName = input.getAttribute('data-name') || input.name;
  if (dataName) {
    // Look for label with matching text in common ancestor containers
    const containers = [
      input.parentElement,
      input.parentElement?.parentElement,
      input.closest('.form-group'),
      input.closest('.field'),
      input.closest('.row'),
      input.closest('fieldset')
    ].filter(Boolean);
    
    for (const container of containers) {
      // Check for label with matching content
      const labels = container.querySelectorAll('label');
      for (const label of labels) {
        const labelText = label.textContent.toLowerCase().trim();
        const inputName = dataName.toLowerCase().replace(/[-_]/g, ' ');
        if (labelText === inputName || labelText.includes(inputName)) {
          return label;
        }
      }
      
      // Check for any label in the container (sibling pattern)
      const siblingLabel = container.querySelector('label.control-label') || 
                          container.querySelector('label');
      if (siblingLabel && !siblingLabel.querySelector('input, select, textarea')) {
        return siblingLabel;
      }
    }
  }
  
  // Pattern 5: Previous sibling label
  let prevSibling = input.previousElementSibling;
  while (prevSibling) {
    if (prevSibling.tagName === 'LABEL') {
      return prevSibling;
    }
    // Check if previous sibling contains a label
    const nestedLabel = prevSibling.querySelector('label');
    if (nestedLabel) return nestedLabel;
    prevSibling = prevSibling.previousElementSibling;
  }
  
  // Pattern 6: ARIA described-by as fallback
  if (input.getAttribute('aria-describedby')) {
    const describedById = input.getAttribute('aria-describedby').split(/\s+/)[0];
    const element = document.getElementById(describedById);
    if (element) return element;
  }
  
  return null;
}

/**
 * Get text content excluding nested interactive elements
 */
function getTextContent(element, visitedNodes = new Set()) {
  let text = '';
  
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      // Skip nested interactive elements
      if (!['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName)) {
        // Recursively get text from non-interactive children
        if (!visitedNodes.has(node)) {
          text += ' ' + computeAccessibleName(node, new Set(visitedNodes));
        }
      }
    }
  }
  
  return text.trim().replace(/\s+/g, ' ');
}

/**
 * Find all form associations in a container
 * Returns array of {control, label, relationship} objects
 */
function findFormAssociations(container) {
  const associations = [];
  const controls = container.querySelectorAll('input, select, textarea, button');
  
  for (const control of controls) {
    const label = findAssociatedLabel(control);
    if (label) {
      associations.push({
        control,
        label,
        relationship: determineRelationship(control, label),
        accessibleName: computeAccessibleName(control)
      });
    }
  }
  
  return associations;
}

/**
 * Determine the relationship type between control and label
 */
function determineRelationship(control, label) {
  if (control.id && label.getAttribute('for') === control.id) {
    return 'explicit-for';
  }
  if (label.contains(control)) {
    return 'implicit-wrap';
  }
  if (control.getAttribute('aria-labelledby')?.includes(label.id)) {
    return 'aria-labelledby';
  }
  if (control.parentElement === label.parentElement) {
    return 'sibling';
  }
  return 'ancestor';
}

/**
 * Enhanced component boundary detection with ARIA awareness
 */
function findSemanticBoundary(element, maxDepth = 8) {
  let candidates = [];
  let current = element.parentElement;
  let depth = 0;
  
  while (current && current.tagName !== 'BODY' && depth < maxDepth) {
    const score = calculateEnhancedBoundaryScore(current, element, depth);
    candidates.push({ element: current, score, depth });
    current = current.parentElement;
    depth++;
  }
  
  if (candidates.length === 0) return null;
  
  // Sort by score and prefer closer ancestors for ties
  candidates.sort((a, b) => {
    if (Math.abs(a.score - b.score) < 5) {
      return a.depth - b.depth; // Prefer closer when scores are similar
    }
    return b.score - a.score;
  });
  
  const best = candidates[0];
  
  // Minimum score threshold
  if (best.score < 10) return null;
  
  return best.element;
}

/**
 * Enhanced boundary scoring with ARIA and form awareness
 */
function calculateEnhancedBoundaryScore(candidate, originalElement, depth) {
  let score = 0;
  const tagName = candidate.tagName.toLowerCase();
  const classList = candidate.classList;
  const role = candidate.getAttribute('role');
  
  // 1. Semantic HTML5 elements (highest priority)
  const semanticScores = {
    'form': 60, 'fieldset': 55, 'article': 50, 'section': 45,
    'nav': 40, 'aside': 40, 'main': 35, 'header': 35, 'footer': 35,
    'dialog': 50, 'details': 40, 'figure': 30, 'li': 35, 'tr': 40
  };
  score += semanticScores[tagName] || 0;
  
  // 2. ARIA roles (high priority)
  const roleScores = {
    'form': 55, 'group': 45, 'region': 40, 'article': 45,
    'complementary': 35, 'contentinfo': 35, 'dialog': 50,
    'listitem': 40, 'row': 40, 'gridcell': 35, 'navigation': 40
  };
  if (role) score += roleScores[role] || 20;
  
  // 3. ARIA relationships (very high priority for form associations)
  if (candidate.hasAttribute('aria-labelledby') || 
      candidate.hasAttribute('aria-describedby') ||
      candidate.hasAttribute('aria-controls')) {
    score += 30;
  }
  
  // 4. Form associations (critical for our use case)
  const formAssociations = findFormAssociations(candidate);
  if (formAssociations.length > 0) {
    score += 20 + (formAssociations.length * 5);
    // Extra bonus if this contains our original element
    if (formAssociations.some(a => a.control === originalElement)) {
      score += 25;
    }
  }
  
  // 5. Component framework patterns
  const componentClasses = [
    'component', 'widget', 'module', 'card', 'panel', 'box',
    'form-group', 'field-group', 'input-group', 'control-group'
  ];
  for (const cls of componentClasses) {
    if (classList.value.toLowerCase().includes(cls)) {
      score += 25;
      break;
    }
  }
  
  // 6. Data attributes indicating components
  if (candidate.hasAttribute('data-component') ||
      candidate.hasAttribute('data-widget') ||
      candidate.hasAttribute('data-testid') ||
      candidate.hasAttribute('data-qa')) {
    score += 20;
  }
  
  // 7. Microdata/Schema.org
  if (candidate.hasAttribute('itemscope') || 
      candidate.hasAttribute('itemtype')) {
    score += 25;
  }
  
  // 8. Visual boundaries
  const style = window.getComputedStyle(candidate);
  if (style.border !== 'none' || style.boxShadow !== 'none' || style.outline !== 'none') {
    score += 10;
  }
  if (style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)') {
    score += 5;
  }
  
  // 9. Sibling similarity check
  if (candidate.parentElement) {
    const siblings = Array.from(candidate.parentElement.children);
    const similar = siblings.filter(sib => 
      sib !== candidate && 
      sib.tagName === candidate.tagName &&
      sib.className === candidate.className
    );
    if (similar.length > 0) {
      score += 20 + Math.min(similar.length * 5, 30);
    }
  }
  
  // 10. Penalties
  if (tagName === 'div' || tagName === 'span') {
    if (score < 20) score -= 10; // Generic penalty unless other signals
  }
  
  const rect = candidate.getBoundingClientRect();
  const viewportArea = window.innerWidth * window.innerHeight;
  if ((rect.width * rect.height) / viewportArea > 0.7) {
    score -= 30; // Too large
  }
  
  score -= depth * 3; // Prefer closer ancestors
  
  return Math.max(0, score);
}

// Export for use in minimal-enhanced.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    computeAccessibleName,
    findAssociatedLabel,
    findFormAssociations,
    findSemanticBoundary,
    calculateEnhancedBoundaryScore
  };
}