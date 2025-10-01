// Offscreen WebSocket Manager
// Manages offscreen document lifecycle and WebSocket connections through it

(() => {
  const TAG = '[OffscreenWSManager]';
  const log = (...args) => console.log(TAG, new Date().toISOString(), ...args);
  const warn = (...args) => console.warn(TAG, new Date().toISOString(), ...args);
  const error = (...args) => console.error(TAG, new Date().toISOString(), ...args);

  class OffscreenWebSocketManager {
    constructor() {
      this.messageCallbacks = new Map();
      this.setupMessageListener();
    }

    async ensureOffscreenDocument() {
      // Try to check if offscreen document already exists (Chrome 116+)
      if (chrome.runtime.getContexts) {
        try {
          const existingContexts = await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT'],
            documentUrls: [chrome.runtime.getURL('offscreen.html')]
          });

          if (existingContexts.length > 0) {
            log('Offscreen document already exists');
            // Test if it's responsive by sending a test message
            try {
              await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Test message timeout')), 1000);
                chrome.runtime.sendMessage({ type: 'ws-ping-test' }, (response) => {
                  clearTimeout(timeout);
                  if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                  } else {
                    resolve(response);
                  }
                });
              });
              log('Offscreen document is responsive');
              return;
            } catch (testErr) {
              warn('Offscreen document exists but not responsive, recreating:', testErr.message);
              // Close existing and recreate
              await chrome.offscreen.closeDocument();
              log('Closed unresponsive offscreen document');
            }
          }
        } catch (err) {
          warn('getContexts not available or failed:', err);
        }
      }

      // Try to create offscreen document
      try {
        log('Creating offscreen document...');
        await chrome.offscreen.createDocument({
          url: 'offscreen.html',
          reasons: ['DOM_PARSER'], // Required reason
          justification: 'Maintain persistent WebSocket connections for MCP server'
        });
        log('Offscreen document created');
        // Wait a bit for script to load
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (err) {
        // Document already exists - try to close and recreate
        if (err.message && err.message.includes('Only a single offscreen')) {
          log('Offscreen document already exists, closing and recreating...');
          try {
            await chrome.offscreen.closeDocument();
            await new Promise(resolve => setTimeout(resolve, 100));
            await chrome.offscreen.createDocument({
              url: 'offscreen.html',
              reasons: ['DOM_PARSER'],
              justification: 'Maintain persistent WebSocket connections for MCP server'
            });
            log('Offscreen document recreated');
            await new Promise(resolve => setTimeout(resolve, 100));
          } catch (recreateErr) {
            error('Failed to recreate offscreen document:', recreateErr);
            throw recreateErr;
          }
          return;
        }
        // Other errors should be thrown
        throw err;
      }
    }

    setupMessageListener() {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        // Handle messages from offscreen document
        if (message.type && message.type.startsWith('ws-')) {
          const callbacks = this.messageCallbacks.get(message.type);
          if (callbacks) {
            callbacks.forEach(callback => {
              try {
                callback(message);
              } catch (err) {
                error('Error in message callback:', err);
              }
            });
          }
        }
      });
    }

    onMessage(type, callback) {
      if (!this.messageCallbacks.has(type)) {
        this.messageCallbacks.set(type, []);
      }
      this.messageCallbacks.get(type).push(callback);
    }

    async connect(wsPort, instanceId) {
      await this.ensureOffscreenDocument();

      log(`Connecting WebSocket via offscreen: port=${wsPort}, instance=${instanceId}`);

      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'ws-connect',
          wsPort: wsPort,
          instanceId: instanceId
        }, (response) => {
          if (chrome.runtime.lastError) {
            error('Error connecting:', chrome.runtime.lastError.message || JSON.stringify(chrome.runtime.lastError));
            reject(chrome.runtime.lastError);
          } else if (response && response.success) {
            log('Connect message sent successfully');
            resolve();
          } else {
            error('Failed to connect - no response or success=false, response:', JSON.stringify(response));
            reject(new Error('Failed to connect'));
          }
        });
      });
    }

    async send(message) {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'ws-send',
          message: message
        }, (response) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else if (response && response.success) {
            resolve();
          } else {
            reject(new Error(response?.error || 'Failed to send'));
          }
        });
      });
    }

    async disconnect() {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'ws-disconnect'
        }, (response) => {
          if (chrome.runtime.lastError) {
            error('Error disconnecting:', chrome.runtime.lastError);
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      });
    }
  }

  // Export to global scope
  self.OffscreenWebSocketManager = OffscreenWebSocketManager;
  log('OffscreenWebSocketManager loaded');
})();
