// Element tracking system for stable references
(function() {
  // Global element tracking
  window.__elementTracker = {
    // WeakMap to store element -> ID mapping
    elementToId: new WeakMap(),
    // Map to store ID -> WeakRef(element) mapping for reverse lookup
    idToElement: new Map(),
    // Counter for generating unique IDs
    nextId: 1,
    
    // Get or create stable ID for element
    getElementId(element) {
      // Check if element already has ID
      if (this.elementToId.has(element)) {
        return this.elementToId.get(element);
      }
      
      // Generate new ID
      const id = `ref${this.nextId++}`;
      
      // Store bidirectional mapping
      this.elementToId.set(element, id);
      this.idToElement.set(id, new WeakRef(element));
      
      return id;
    },
    
    // Get element by ID
    getElementById(id) {
      const weakRef = this.idToElement.get(id);
      if (!weakRef) return null;
      
      const element = weakRef.deref();
      if (!element) {
        // Element was garbage collected, remove from map
        this.idToElement.delete(id);
        return null;
      }
      
      return element;
    },
    
    // Clean up garbage collected elements periodically
    cleanup() {
      const idsToDelete = [];
      
      for (const [id, weakRef] of this.idToElement.entries()) {
        if (!weakRef.deref()) {
          idsToDelete.push(id);
        }
      }
      
      idsToDelete.forEach(id => this.idToElement.delete(id));
    },
    
    // Reset all tracking (useful for page navigation)
    reset() {
      this.elementToId = new WeakMap();
      this.idToElement = new Map();
      this.nextId = 1;
    }
  };
  
  // Clean up periodically (every 30 seconds)
  setInterval(() => {
    window.__elementTracker.cleanup();
  }, 30000);
  
  // Reset on page navigation
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      window.__elementTracker.reset();
    }
  }).observe(document, { subtree: true, childList: true });
  
  // Also reset on popstate (back/forward navigation)
  window.addEventListener('popstate', () => {
    window.__elementTracker.reset();
  });
  
  console.log('Element tracker initialized');
})();