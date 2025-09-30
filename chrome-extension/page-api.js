// MCP Browser Automation API
// This script is injected into pages to provide DOM manipulation helpers
// without violating CSP (no eval, no new Function)

if (!window.__mcpApiInstalled) {
  window.__mcpApiInstalled = true;

  const delay = ms => new Promise(r => setTimeout(r, ms));

  window.__mcpApi = {
    /**
     * Scroll the page with support for steps and delays
     * @param {Object} opts - Options: { to, steps, delayMs, smooth }
     */
    async scroll(opts) {
      const { to = 'bottom', steps = 1, delayMs = 500, smooth = true } = opts;
      const behavior = smooth ? 'smooth' : 'auto';

      for (let i = 0; i < steps; i++) {
        if (typeof to === 'number') {
          window.scrollTo({ top: to, behavior });
        } else if (to === 'top') {
          window.scrollTo({ top: 0, behavior });
        } else if (to === 'bottom') {
          window.scrollTo({ top: document.body.scrollHeight, behavior });
        } else {
          const el = document.querySelector(to);
          if (el) el.scrollIntoView({ behavior });
        }
        if (i < steps - 1) await delay(delayMs);
      }
      return true;
    },

    /**
     * Set input value and optionally press Enter
     * @param {string} sel - CSS selector
     * @param {string} value - Value to set
     * @param {Object} opts - Options: { pressEnter }
     */
    setInput(sel, value, opts = {}) {
      const { pressEnter = false } = opts;
      const el = document.querySelector(sel);
      if (!el) return false;

      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));

      if (pressEnter) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
      }
      return true;
    },

    /**
     * Query elements and extract attributes
     * @param {string} selector - CSS selector
     * @param {Object} opts - Options: { attrs, limit, includeHidden }
     */
    query(selector, opts = {}) {
      const { attrs = ['textContent', 'href', 'value'], limit = 100, includeHidden = false } = opts;

      let elements = Array.from(document.querySelectorAll(selector));

      if (!includeHidden) {
        elements = elements.filter(el => {
          return el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
        });
      }

      elements = elements.slice(0, limit);

      return elements.map(el => {
        const result = {};
        attrs.forEach(attr => {
          if (attr === 'textContent') {
            result[attr] = el.textContent.trim();
          } else {
            result[attr] = el.getAttribute(attr) || el[attr] || null;
          }
        });
        return result;
      });
    },

    /**
     * Get inner HTML of element
     * @param {string} sel - CSS selector
     */
    getHTML(sel) {
      const el = document.querySelector(sel);
      return el ? el.innerHTML : null;
    },

    /**
     * Get outer HTML of element
     * @param {string} sel - CSS selector
     */
    getOuterHTML(sel) {
      const el = document.querySelector(sel);
      return el ? el.outerHTML : null;
    },

    /**
     * Wait for element to appear
     * @param {string} sel - CSS selector
     * @param {Object} opts - Options: { timeoutMs, visible, intervalMs }
     */
    waitFor(sel, opts = {}) {
      const { timeoutMs = 10000, visible = false, intervalMs = 100 } = opts;

      return new Promise((resolve) => {
        const startTime = performance.now();

        const checkElement = () => {
          const el = document.querySelector(sel);
          const exists = el && (!visible ||
            (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0));

          if (exists) {
            clearInterval(intervalId);
            resolve(el);
          } else if (performance.now() - startTime > timeoutMs) {
            clearInterval(intervalId);
            resolve(null);
          }
        };

        const intervalId = setInterval(checkElement, intervalMs);
        checkElement(); // Check immediately
      });
    },

    /**
     * Fill form fields
     * @param {string} formSel - Form selector
     * @param {Object} fields - Field name/id to value mapping
     */
    fillForm(formSel, fields) {
      const form = document.querySelector(formSel);
      if (!form) return false;

      let filledCount = 0;

      Object.entries(fields).forEach(([name, value]) => {
        // Try multiple strategies to find the field
        let field = form.querySelector(`[name="${name}"]`) ||
                    form.querySelector(`#${name}`) ||
                    form.querySelector(`[id*="${name}"]`) ||
                    form.querySelector(`[name*="${name}"]`);

        // Try by label text
        if (!field) {
          const labels = Array.from(form.querySelectorAll('label'));
          const label = labels.find(l =>
            l.textContent.toLowerCase().includes(name.toLowerCase())
          );
          if (label && label.htmlFor) {
            field = form.querySelector(`#${label.htmlFor}`);
          }
        }

        if (field) {
          if (field.type === 'checkbox' || field.type === 'radio') {
            field.checked = !!value;
          } else if (field.tagName === 'SELECT') {
            field.value = value;
          } else {
            field.value = value;
          }

          field.dispatchEvent(new Event('input', { bubbles: true }));
          field.dispatchEvent(new Event('change', { bubbles: true }));
          filledCount++;
        }
      });

      return filledCount > 0;
    },

    /**
     * Extract links with filtering
     * @param {string} containerSel - Container selector
     * @param {Object} opts - Options: { hrefContains, textContains, exclude, unique, limit }
     */
    extractLinks(containerSel, opts = {}) {
      const {
        hrefContains = null,
        textContains = null,
        exclude = [],
        unique = true,
        limit = 100
      } = opts;

      const container = document.querySelector(containerSel || 'body');
      if (!container) return { links: [], error: 'Container not found' };

      let links = Array.from(container.querySelectorAll('a[href]'));

      // Apply filters
      if (hrefContains) {
        links = links.filter(a => a.href.includes(hrefContains));
      }
      if (textContains) {
        links = links.filter(a => a.textContent.toLowerCase().includes(textContains.toLowerCase()));
      }

      // Apply exclusions
      if (exclude.length > 0) {
        links = links.filter(a => !exclude.some(pattern => a.href.includes(pattern)));
      }

      // Extract data
      let results = links.slice(0, limit).map(a => ({
        href: a.href,
        text: a.textContent.trim(),
        title: a.title || '',
        target: a.target || '_self'
      }));

      // Make unique if requested
      if (unique) {
        const seen = new Set();
        results = results.filter(link => {
          if (seen.has(link.href)) return false;
          seen.add(link.href);
          return true;
        });
      }

      return { links: results, count: results.length };
    },

    /**
     * Schema-based extraction
     * @param {string} containerSel - Container selector
     * @param {Object} schema - Field extraction schema
     * @param {number} limit - Max containers to process
     */
    extractSchema(containerSel, schema, limit = 100) {
      const containers = Array.from(document.querySelectorAll(containerSel)).slice(0, limit);

      const results = containers.map(container => {
        const item = {};

        Object.entries(schema).forEach(([fieldName, config]) => {
          const selector = config.selector || fieldName;
          const attr = config.attr || 'textContent';
          const multiple = config.multiple || false;

          if (multiple) {
            const elements = container.querySelectorAll(selector);
            item[fieldName] = Array.from(elements).map(el => {
              if (attr === 'textContent') {
                return el.textContent.trim();
              } else {
                return el.getAttribute(attr) || el[attr];
              }
            });
          } else {
            const element = container.querySelector(selector);
            if (element) {
              if (attr === 'textContent') {
                item[fieldName] = element.textContent.trim();
              } else {
                item[fieldName] = element.getAttribute(attr) || element[attr];
              }
            } else {
              item[fieldName] = null;
            }
          }
        });

        return item;
      });

      return { data: results, count: results.length };
    },

    /**
     * Get element text content
     * @param {string} sel - CSS selector
     */
    getText(sel) {
      const el = document.querySelector(sel);
      return el ? el.textContent.trim() : null;
    },

    /**
     * Check if element exists
     * @param {string} sel - CSS selector
     */
    exists(sel) {
      return !!document.querySelector(sel);
    },

    /**
     * Dismiss overlays (legacy support)
     * @param {Array} additionalSelectors - Additional selectors to try
     */
    dismissOverlays(additionalSelectors = []) {
      const commonSelectors = [
        '[aria-label*="close" i]',
        '[aria-label*="dismiss" i]',
        'button[class*="close" i]',
        'button[class*="dismiss" i]',
        '.modal-close',
        '.popup-close',
        '.overlay-close'
      ];

      const allSelectors = [...commonSelectors, ...additionalSelectors];
      let dismissed = 0;

      allSelectors.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          if (el.offsetWidth > 0 || el.offsetHeight > 0) {
            el.click();
            dismissed++;
          }
        });
      });

      return dismissed;
    },

    /**
     * Execute arbitrary user code in ISOLATED world without CSP violations
     * Uses ES module blob import - no eval() or new Function()
     * @param {string} code - User's JavaScript code
     * @param {Array} args - Optional arguments to pass
     */
    exec(code, args = []) {
      // Wrap user code in an ES module that exports async function
      const moduleSrc = `
        const api = window.__mcpApi;
        export default async (..._args) => {
          ${code}
        };
      `;

      // Create blob URL, import module, execute, cleanup
      const blob = new Blob([moduleSrc], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);

      return import(url)
        .then(m => m.default(...args))
        .finally(() => URL.revokeObjectURL(url));
    }
  };

  console.log('[MCP API] Installed page API with', Object.keys(window.__mcpApi).length, 'methods');
}