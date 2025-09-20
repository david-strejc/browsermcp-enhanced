// Minimal Firefox content script - loads other scripts only when needed
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

// Track if full scripts are loaded
let scriptsLoaded = false;
let loadingScripts = false;

// Minimal console capture (only errors by default)
const originalError = console.error;
window.__consoleLogs = [];
const MAX_CONSOLE_LOGS = 50; // Small buffer

console.error = function(...args) {
  window.__consoleLogs.push({
    type: 'error',
    args,
    timestamp: Date.now()
  });
  if (window.__consoleLogs.length > MAX_CONSOLE_LOGS) {
    window.__consoleLogs = window.__consoleLogs.slice(-MAX_CONSOLE_LOGS);
  }
  originalError.apply(console, args);
};

// Load full scripts when needed
async function loadFullScripts() {
  if (scriptsLoaded || loadingScripts) {
    return Promise.resolve();
  }

  loadingScripts = true;

  return new Promise((resolve, reject) => {
    const scripts = [
      'element-tracker.js',
      'element-validator.js',
      'popup-detector-simple.js',
      'code-executor-rpc.js',
      'click-detection.js',
      'content.js'
    ];

    let loaded = 0;

    scripts.forEach(script => {
      const scriptElement = document.createElement('script');
      scriptElement.src = browserAPI.runtime.getURL(script);
      scriptElement.onload = () => {
        loaded++;
        if (loaded === scripts.length) {
          scriptsLoaded = true;
          loadingScripts = false;
          console.log('BrowserMCP Enhanced: All scripts loaded');
          resolve();
        }
      };
      scriptElement.onerror = (error) => {
        console.error(`Failed to load script: ${script}`, error);
        loadingScripts = false;
        reject(error);
      };
      document.head.appendChild(scriptElement);
    });
  });
}

// Minimal message listener
browserAPI.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Handle immediate responses for simple queries
  if (request.action === 'ping') {
    sendResponse({ success: true, minimal: true });
    return false;
  }

  if (request.action === 'getConsoleLogs' && !scriptsLoaded) {
    // Return minimal console logs without loading full scripts
    sendResponse({
      success: true,
      logs: window.__consoleLogs.map(log => ({
        type: log.type,
        timestamp: log.timestamp,
        args: log.args.map(arg => {
          try {
            if (typeof arg === 'object') {
              return JSON.stringify(arg);
            }
            return String(arg);
          } catch {
            return String(arg);
          }
        })
      }))
    });
    return false;
  }

  // For all other actions, load full scripts if needed
  (async () => {
    try {
      // Check if we need to load scripts
      if (!scriptsLoaded) {
        await loadFullScripts();
      }

      // Forward message to full content script
      if (window.__handleMessage) {
        // Full content script is loaded and has registered its handler
        window.__handleMessage(request, sender, sendResponse);
      } else {
        // Scripts loaded but handler not ready, wait a bit
        setTimeout(() => {
          if (window.__handleMessage) {
            window.__handleMessage(request, sender, sendResponse);
          } else {
            sendResponse({
              success: false,
              error: 'Full content script not ready'
            });
          }
        }, 100);
      }
    } catch (error) {
      console.error('Error loading scripts:', error);
      sendResponse({
        success: false,
        error: `Failed to load scripts: ${error.message}`
      });
    }
  })();

  // Return true to indicate async response
  return true;
});

// Add cleanup on page unload
window.addEventListener('unload', () => {
  // Clear console logs to free memory
  window.__consoleLogs = [];

  // Clear any other cached data
  if (window.__elementTracker) {
    window.__elementTracker.reset();
  }
});

console.log('BrowserMCP Enhanced: Minimal content script loaded');