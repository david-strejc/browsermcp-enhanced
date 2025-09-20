// Firefox-compatible safe operations executor (NO remote code execution)
// This file provides predefined safe DOM operations only
(function() {
  'use strict';

  // Skip if already initialized
  if (window.__safeOperationsExecutor) {
    return;
  }

  class SafeOperationsExecutor {
    constructor() {
      // No sandbox or iframe needed - we only execute predefined operations
      this.operations = this.defineOperations();
    }

    // Define all safe operations that can be executed
    defineOperations() {
      return {
        // Query operations (read-only)
        getText: (params) => {
          const element = document.querySelector(params.selector);
          return element ? element.textContent?.trim() : null;
        },

        getValue: (params) => {
          const element = document.querySelector(params.selector);
          return element ? element.value : null;
        },

        getAttribute: (params) => {
          const element = document.querySelector(params.selector);
          return element ? element.getAttribute(params.attribute) : null;
        },

        exists: (params) => {
          return !!document.querySelector(params.selector);
        },

        isVisible: (params) => {
          const element = document.querySelector(params.selector);
          if (!element) return false;

          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);

          return rect.width > 0 &&
                 rect.height > 0 &&
                 style.display !== 'none' &&
                 style.visibility !== 'hidden' &&
                 style.opacity !== '0';
        },

        getPageInfo: () => {
          return {
            title: document.title,
            url: window.location.href,
            domain: window.location.hostname,
            viewport: {
              width: window.innerWidth,
              height: window.innerHeight
            },
            scrollPosition: {
              x: window.scrollX,
              y: window.scrollY
            }
          };
        },

        // Data extraction operations
        extractTable: (params) => {
          const table = document.querySelector(params.selector);
          if (!table) return null;

          const rows = Array.from(table.querySelectorAll('tr'));
          return rows.map(row => {
            const cells = Array.from(row.querySelectorAll('td, th'));
            return cells.map(cell => cell.textContent?.trim());
          });
        },

        extractLinks: (params) => {
          const container = params.selector ?
            document.querySelector(params.selector) : document;
          if (!container) return [];

          const links = Array.from(container.querySelectorAll('a[href]'));
          return links.slice(0, 100).map(link => ({ // Limit to 100 links
            text: link.textContent?.trim(),
            href: link.href,
            target: link.target
          }));
        },

        extractImages: (params) => {
          const container = params.selector ?
            document.querySelector(params.selector) : document;
          if (!container) return [];

          const images = Array.from(container.querySelectorAll('img'));
          return images.slice(0, 50).map(img => ({ // Limit to 50 images
            src: img.src,
            alt: img.alt,
            width: img.naturalWidth,
            height: img.naturalHeight
          }));
        },

        // Navigation operations
        scrollTo: (params) => {
          if (params.selector) {
            const element = document.querySelector(params.selector);
            if (element) {
              element.scrollIntoView({
                behavior: 'smooth',
                block: params.block || 'center'
              });
              return true;
            }
            return false;
          } else if (params.x !== undefined && params.y !== undefined) {
            window.scrollTo({
              left: params.x,
              top: params.y,
              behavior: 'smooth'
            });
            return true;
          }
          return false;
        },

        // Visual operations
        highlight: (params) => {
          const elements = document.querySelectorAll(params.selector);
          elements.forEach(el => {
            el.style.outline = params.style || '2px solid red';
            el.style.outlineOffset = '2px';
          });
          return elements.length;
        },

        getComputedStyle: (params) => {
          const element = document.querySelector(params.selector);
          if (!element) return null;

          const style = window.getComputedStyle(element);
          const properties = params.properties || [
            'display', 'position', 'width', 'height',
            'color', 'backgroundColor', 'fontSize'
          ];

          const result = {};
          properties.forEach(prop => {
            result[prop] = style.getPropertyValue(prop);
          });
          return result;
        },

        // Form operations (read-only)
        getFormData: (params) => {
          const form = document.querySelector(params.selector);
          if (!form || form.tagName !== 'FORM') return null;

          const data = {};
          const inputs = form.querySelectorAll('input, select, textarea');

          inputs.forEach(input => {
            if (input.name) {
              if (input.type === 'checkbox' || input.type === 'radio') {
                if (input.checked) {
                  data[input.name] = input.value;
                }
              } else {
                data[input.name] = input.value;
              }
            }
          });

          return data;
        },

        // Accessibility operations
        getAccessibilityTree: (params) => {
          const root = params.selector ?
            document.querySelector(params.selector) : document.body;
          if (!root) return null;

          const tree = [];
          const walker = document.createTreeWalker(
            root,
            NodeFilter.SHOW_ELEMENT,
            {
              acceptNode: (node) => {
                const role = node.getAttribute('role');
                const ariaLabel = node.getAttribute('aria-label');
                const isInteractive = ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName);

                if (role || ariaLabel || isInteractive) {
                  return NodeFilter.FILTER_ACCEPT;
                }
                return NodeFilter.FILTER_SKIP;
              }
            }
          );

          let node;
          let count = 0;
          while ((node = walker.nextNode()) && count < 100) { // Limit to 100 nodes
            tree.push({
              tag: node.tagName.toLowerCase(),
              role: node.getAttribute('role'),
              ariaLabel: node.getAttribute('aria-label'),
              text: node.textContent?.trim().substring(0, 100)
            });
            count++;
          }

          return tree;
        }
      };
    }

    // Execute a safe operation
    async execute(operation, params = {}) {
      try {
        // Check if operation exists
        if (!this.operations[operation]) {
          return {
            success: false,
            error: `Unknown operation: ${operation}`
          };
        }

        // Execute the operation
        const result = await this.operations[operation](params);

        return {
          success: true,
          result
        };
      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
    }

    // Get list of available operations
    getAvailableOperations() {
      return Object.keys(this.operations);
    }
  }

  // Initialize executor
  window.__safeOperationsExecutor = new SafeOperationsExecutor();

  console.log('Firefox safe operations executor initialized (no remote code execution)');
})();