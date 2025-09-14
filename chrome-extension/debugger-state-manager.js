// Robust Debugger State Manager
// Implements proper state synchronization and prevents attach/detach race conditions

class DebuggerStateManager {
  constructor() {
    // State enum
    this.STATES = {
      DETACHED: 'DETACHED',
      ATTACHING: 'ATTACHING',
      ATTACHED: 'ATTACHED',
      DETACHING: 'DETACHING',
      ERROR: 'ERROR'
    };

    // Per-tab state tracking (single source of truth)
    this.tabStates = new Map(); // tabId -> state
    this.tabQueues = new Map(); // tabId -> Promise queue for serialization
    this.tabData = new Map(); // tabId -> collected debug data

    // Configuration
    this.maxEntries = 1000;
    this.maxRetries = 3;
    this.retryDelay = 250;

    // Setup Chrome event listeners for state synchronization
    this.setupEventListeners();
  }

  setupEventListeners() {
    // Listen for debugger events that indicate state changes
    chrome.debugger.onDetach.addListener((source, reason) => {
      console.log(`[DebuggerState] Detached from tab ${source.tabId}, reason: ${reason}`);
      this.setTabState(source.tabId, this.STATES.DETACHED);
      this.cleanupTabData(source.tabId);
    });

    // Listen for tab events
    chrome.tabs.onRemoved.addListener((tabId) => {
      console.log(`[DebuggerState] Tab ${tabId} removed`);
      this.setTabState(tabId, this.STATES.DETACHED);
      this.cleanupTabData(tabId);
      this.tabQueues.delete(tabId);
    });

    // Listen for debugger events for data collection
    chrome.debugger.onEvent.addListener((source, method, params) => {
      this.handleDebuggerEvent(source.tabId, method, params);
    });
  }

  // Get or create queue for tab (ensures serialization)
  getQueue(tabId) {
    if (!this.tabQueues.has(tabId)) {
      this.tabQueues.set(tabId, Promise.resolve());
    }
    return this.tabQueues.get(tabId);
  }

  // Queue an operation for a tab (prevents race conditions)
  async queueOperation(tabId, operation) {
    const queue = this.getQueue(tabId);
    const newQueue = queue.then(operation).catch(err => {
      console.error(`[DebuggerState] Operation failed for tab ${tabId}:`, err);
      throw err;
    });
    this.tabQueues.set(tabId, newQueue);
    return newQueue;
  }

  // Get current state for a tab
  getTabState(tabId) {
    return this.tabStates.get(tabId) || this.STATES.DETACHED;
  }

  // Set state for a tab
  setTabState(tabId, state) {
    console.log(`[DebuggerState] Tab ${tabId}: ${this.getTabState(tabId)} -> ${state}`);
    this.tabStates.set(tabId, state);
  }

  // Initialize data storage for a tab
  initTabData(tabId) {
    if (!this.tabData.has(tabId)) {
      this.tabData.set(tabId, {
        console: [],
        network: [],
        errors: [],
        performance: {}
      });
    }
  }

  // Get data for a tab
  getTabData(tabId) {
    return this.tabData.get(tabId) || {
      console: [],
      network: [],
      errors: [],
      performance: {}
    };
  }

  // Cleanup data for a tab (keep last 100 entries)
  cleanupTabData(tabId) {
    const data = this.getTabData(tabId);
    data.console = data.console.slice(-100);
    data.network = data.network.slice(-100);
    data.errors = data.errors.slice(-100);
  }

  // Idempotent attach operation
  async ensureAttached(tabId, domains = ["console", "network", "performance", "runtime"]) {
    return this.queueOperation(tabId, async () => {
      const currentState = this.getTabState(tabId);

      // If already attached, return success
      if (currentState === this.STATES.ATTACHED) {
        console.log(`[DebuggerState] Tab ${tabId} already attached`);
        return { success: true, alreadyAttached: true };
      }

      // If currently attaching, wait for completion
      if (currentState === this.STATES.ATTACHING) {
        console.log(`[DebuggerState] Tab ${tabId} is attaching, waiting...`);
        await this.waitForState(tabId, this.STATES.ATTACHED, 5000);
        return { success: true, alreadyAttached: true };
      }

      // If detaching, wait for it to complete first
      if (currentState === this.STATES.DETACHING) {
        console.log(`[DebuggerState] Tab ${tabId} is detaching, waiting...`);
        await this.waitForState(tabId, this.STATES.DETACHED, 5000);
      }

      // Now attach with retry logic
      let lastError = null;
      for (let attempt = 0; attempt < this.maxRetries; attempt++) {
        try {
          this.setTabState(tabId, this.STATES.ATTACHING);

          // Attach debugger
          await new Promise((resolve, reject) => {
            chrome.debugger.attach({ tabId }, "1.3", () => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve();
              }
            });
          });

          // CRITICAL FIX: Set state to ATTACHED immediately after chrome.debugger.attach succeeds
          // This allows sendCommand() to work in the domain enabling phase below
          this.setTabState(tabId, this.STATES.ATTACHED);

          // Initialize data storage
          this.initTabData(tabId);

          // Enable domains - now sendCommand() will work because state is ATTACHED
          for (const domain of domains) {
            if (domain === "console" || domain === "runtime") {
              await this.sendCommand(tabId, "Runtime.enable", {});
            }
            if (domain === "network") {
              await this.sendCommand(tabId, "Network.enable", {});
            }
            if (domain === "performance") {
              await this.sendCommand(tabId, "Performance.enable", {});
            }
          }

          // Always enable Log domain for errors
          await this.sendCommand(tabId, "Log.enable", {});
          console.log(`[DebuggerState] Successfully attached to tab ${tabId}`);
          return { success: true };

        } catch (error) {
          lastError = error;
          console.warn(`[DebuggerState] Attach attempt ${attempt + 1} failed:`, error.message);

          // Check if already attached (common race condition)
          if (error.message.includes('Another debugger') || error.message.includes('already attached')) {
            this.setTabState(tabId, this.STATES.ATTACHED);
            return { success: true, alreadyAttached: true };
          }

          this.setTabState(tabId, this.STATES.ERROR);

          if (attempt < this.maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, this.retryDelay * Math.pow(2, attempt)));
          }
        }
      }

      // All retries failed
      this.setTabState(tabId, this.STATES.DETACHED);
      throw lastError || new Error('Failed to attach debugger after retries');
    });
  }

  // Idempotent detach operation
  async ensureDetached(tabId) {
    return this.queueOperation(tabId, async () => {
      const currentState = this.getTabState(tabId);

      // If already detached, return success
      if (currentState === this.STATES.DETACHED) {
        console.log(`[DebuggerState] Tab ${tabId} already detached`);
        return { success: true, alreadyDetached: true };
      }

      // If currently detaching, wait for completion
      if (currentState === this.STATES.DETACHING) {
        console.log(`[DebuggerState] Tab ${tabId} is detaching, waiting...`);
        await this.waitForState(tabId, this.STATES.DETACHED, 5000);
        return { success: true, alreadyDetached: true };
      }

      // If attaching, wait for it to complete first
      if (currentState === this.STATES.ATTACHING) {
        console.log(`[DebuggerState] Tab ${tabId} is attaching, waiting to complete before detach...`);
        await this.waitForState(tabId, this.STATES.ATTACHED, 5000);
      }

      // Now detach
      try {
        this.setTabState(tabId, this.STATES.DETACHING);

        await new Promise((resolve, reject) => {
          chrome.debugger.detach({ tabId }, () => {
            if (chrome.runtime.lastError) {
              // Ignore "not attached" errors
              if (chrome.runtime.lastError.message.includes('not attached')) {
                resolve();
              } else {
                reject(new Error(chrome.runtime.lastError.message));
              }
            } else {
              resolve();
            }
          });
        });

        this.setTabState(tabId, this.STATES.DETACHED);
        this.cleanupTabData(tabId);
        console.log(`[DebuggerState] Successfully detached from tab ${tabId}`);
        return { success: true };

      } catch (error) {
        console.error(`[DebuggerState] Detach failed:`, error);
        this.setTabState(tabId, this.STATES.ERROR);
        throw error;
      }
    });
  }

  // Check if debugger is attached to a tab
  isAttached(tabId) {
    return this.getTabState(tabId) === this.STATES.ATTACHED;
  }

  // Send command to debugger (with state check)
  async sendCommand(tabId, method, params = {}) {
    if (!this.isAttached(tabId)) {
      throw new Error(`Debugger not attached to tab ${tabId}`);
    }

    return new Promise((resolve, reject) => {
      chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(result);
        }
      });
    });
  }

  // Wait for a specific state
  async waitForState(tabId, targetState, timeout = 5000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      if (this.getTabState(tabId) === targetState) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Timeout waiting for tab ${tabId} to reach state ${targetState}`);
  }

  // Handle debugger events for data collection
  handleDebuggerEvent(tabId, method, params) {
    const data = this.getTabData(tabId);
    if (!data) return;

    switch (method) {
      case "Runtime.consoleAPICalled":
        this.handleConsoleLog(tabId, params);
        break;
      case "Network.requestWillBeSent":
        this.handleNetworkRequest(tabId, params);
        break;
      case "Network.responseReceived":
        this.handleNetworkResponse(tabId, params);
        break;
      case "Runtime.exceptionThrown":
        this.handleException(tabId, params);
        break;
      case "Log.entryAdded":
        this.handleLogEntry(tabId, params);
        break;
    }
  }

  handleConsoleLog(tabId, params) {
    const data = this.getTabData(tabId);
    const logEntry = {
      type: params.type,
      timestamp: new Date().toISOString(),
      args: params.args.map(arg => this.parseRemoteObject(arg)),
      stackTrace: params.stackTrace ? this.formatStackTrace(params.stackTrace) : null
    };

    data.console.push(logEntry);
    if (data.console.length > this.maxEntries) {
      data.console = data.console.slice(-this.maxEntries);
    }
  }

  handleNetworkRequest(tabId, params) {
    const data = this.getTabData(tabId);
    const request = {
      id: params.requestId,
      url: params.request.url,
      method: params.request.method,
      type: params.type,
      timestamp: params.timestamp
    };

    data.network.push(request);
    if (data.network.length > this.maxEntries) {
      data.network = data.network.slice(-this.maxEntries);
    }
  }

  handleNetworkResponse(tabId, params) {
    const data = this.getTabData(tabId);
    const request = data.network.find(r => r.id === params.requestId);
    if (request) {
      request.status = params.response.status;
      request.statusText = params.response.statusText;
      request.size = params.response.encodedDataLength;
      request.time = (params.timestamp - request.timestamp) * 1000;
    }
  }

  handleException(tabId, params) {
    const data = this.getTabData(tabId);
    const error = {
      timestamp: new Date().toISOString(),
      message: params.exceptionDetails.text,
      url: params.exceptionDetails.url,
      line: params.exceptionDetails.lineNumber,
      column: params.exceptionDetails.columnNumber,
      stack: params.exceptionDetails.stackTrace ?
        this.formatStackTrace(params.exceptionDetails.stackTrace) : null
    };

    data.errors.push(error);
    if (data.errors.length > this.maxEntries) {
      data.errors = data.errors.slice(-this.maxEntries);
    }
  }

  handleLogEntry(tabId, params) {
    if (params.entry.level === "error") {
      const data = this.getTabData(tabId);
      const error = {
        timestamp: new Date().toISOString(),
        message: params.entry.text,
        url: params.entry.url,
        line: params.entry.lineNumber,
        source: params.entry.source
      };

      data.errors.push(error);
      if (data.errors.length > this.maxEntries) {
        data.errors = data.errors.slice(-this.maxEntries);
      }
    }
  }

  parseRemoteObject(obj) {
    if (obj.type === "string") return obj.value;
    if (obj.type === "number") return obj.value;
    if (obj.type === "boolean") return obj.value;
    if (obj.type === "undefined") return undefined;
    if (obj.type === "object" && obj.subtype === "null") return null;

    if (obj.preview) {
      return obj.preview.description || obj.className || obj.type;
    }

    return obj.description || obj.type;
  }

  formatStackTrace(stackTrace) {
    if (!stackTrace.callFrames) return null;

    return stackTrace.callFrames
      .map(frame => `${frame.functionName || '<anonymous>'} (${frame.url}:${frame.lineNumber}:${frame.columnNumber})`)
      .join('\n    ');
  }

  // Get data for a specific tab and type
  async getData(tabId, type, limit = 50, filter = null) {
    // Ensure debugger is attached before getting data
    if (!this.isAttached(tabId)) {
      return { error: "Debugger not attached to this tab" };
    }

    const data = this.getTabData(tabId);
    let result = [];

    switch (type) {
      case "console":
        result = data.console;
        break;
      case "network":
        result = data.network;
        break;
      case "errors":
        result = data.errors;
        break;
      case "performance":
        // Get fresh performance metrics
        try {
          const metrics = await this.sendCommand(tabId, "Performance.getMetrics", {});
          const perfData = {};
          metrics.metrics.forEach(metric => {
            perfData[metric.name] = metric.value;
          });
          data.performance = perfData;
          return { data: perfData };
        } catch (error) {
          console.error("Failed to get performance metrics:", error);
          return { data: {} };
        }
    }

    // Apply filter
    if (filter && result.length > 0) {
      result = result.filter(item =>
        JSON.stringify(item).toLowerCase().includes(filter.toLowerCase())
      );
    }

    // Apply limit
    return { data: result.slice(-limit) };
  }
}

// Create global instance
// In service worker, use globalThis instead of window
globalThis.__debuggerStateManager = new DebuggerStateManager();