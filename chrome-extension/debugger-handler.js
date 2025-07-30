// Debugger handler for Chrome extension
// Manages chrome.debugger API and collects data

class DebuggerHandler {
  constructor() {
    this.attached = false;
    this.tabId = null;
    this.data = {
      console: [],
      network: [],
      errors: [],
      performance: {}
    };
    this.maxEntries = 1000; // Prevent memory issues
  }

  async attach(tabId, domains) {
    if (this.attached) {
      await this.detach();
    }

    this.tabId = tabId;
    
    // Attach debugger
    await new Promise((resolve, reject) => {
      chrome.debugger.attach({ tabId }, "1.3", () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });

    this.attached = true;

    // Enable requested domains
    if (domains.includes("console") || domains.includes("runtime")) {
      await this.sendCommand("Runtime.enable");
      // Listen for console API calls
      chrome.debugger.onEvent.addListener(this.handleDebuggerEvent.bind(this));
    }

    if (domains.includes("network")) {
      await this.sendCommand("Network.enable");
    }

    if (domains.includes("performance")) {
      await this.sendCommand("Performance.enable");
    }

    // Always enable Log domain for errors
    await this.sendCommand("Log.enable");

    return { success: true };
  }

  async detach() {
    if (!this.attached || !this.tabId) return;

    await new Promise((resolve) => {
      chrome.debugger.detach({ tabId: this.tabId }, () => {
        resolve();
      });
    });

    this.attached = false;
    this.tabId = null;
    
    // Clear old data but keep last 100 entries
    this.data.console = this.data.console.slice(-100);
    this.data.network = this.data.network.slice(-100);
    this.data.errors = this.data.errors.slice(-100);

    return { success: true };
  }

  async sendCommand(method, params = {}) {
    return new Promise((resolve, reject) => {
      chrome.debugger.sendCommand({ tabId: this.tabId }, method, params, (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(result);
        }
      });
    });
  }

  handleDebuggerEvent(source, method, params) {
    // Only handle events for our attached tab
    if (source.tabId !== this.tabId) return;

    switch (method) {
      case "Runtime.consoleAPICalled":
        this.handleConsoleLog(params);
        break;
      
      case "Network.requestWillBeSent":
        this.handleNetworkRequest(params);
        break;
      
      case "Network.responseReceived":
        this.handleNetworkResponse(params);
        break;
      
      case "Network.loadingFailed":
        this.handleNetworkError(params);
        break;
      
      case "Runtime.exceptionThrown":
        this.handleException(params);
        break;
      
      case "Log.entryAdded":
        this.handleLogEntry(params);
        break;
    }
  }

  handleConsoleLog(params) {
    const logEntry = {
      type: params.type,
      timestamp: new Date().toISOString(),
      args: params.args.map(arg => this.parseRemoteObject(arg)),
      stackTrace: params.stackTrace ? this.formatStackTrace(params.stackTrace) : null
    };

    this.data.console.push(logEntry);
    this.trimData("console");
  }

  handleNetworkRequest(params) {
    const request = {
      id: params.requestId,
      url: params.request.url,
      method: params.request.method,
      type: params.type,
      timestamp: params.timestamp,
      initiator: params.initiator,
      headers: params.request.headers
    };

    this.data.network.push(request);
    this.trimData("network");
  }

  handleNetworkResponse(params) {
    // Find the corresponding request and update it
    const request = this.data.network.find(r => r.id === params.requestId);
    if (request) {
      request.status = params.response.status;
      request.statusText = params.response.statusText;
      request.responseHeaders = params.response.headers;
      request.size = params.response.encodedDataLength;
      request.time = (params.timestamp - request.timestamp) * 1000; // Convert to ms
    }
  }

  handleNetworkError(params) {
    const request = this.data.network.find(r => r.id === params.requestId);
    if (request) {
      request.status = "failed";
      request.error = params.errorText;
    }
  }

  handleException(params) {
    const error = {
      timestamp: new Date().toISOString(),
      message: params.exceptionDetails.text,
      url: params.exceptionDetails.url,
      line: params.exceptionDetails.lineNumber,
      column: params.exceptionDetails.columnNumber,
      stack: params.exceptionDetails.stackTrace ? 
        this.formatStackTrace(params.exceptionDetails.stackTrace) : null
    };

    this.data.errors.push(error);
    this.trimData("errors");
  }

  handleLogEntry(params) {
    if (params.entry.level === "error") {
      const error = {
        timestamp: new Date().toISOString(),
        message: params.entry.text,
        url: params.entry.url,
        line: params.entry.lineNumber,
        source: params.entry.source
      };

      this.data.errors.push(error);
      this.trimData("errors");
    }
  }

  async getPerformanceMetrics() {
    if (!this.attached) return {};

    try {
      const metrics = await this.sendCommand("Performance.getMetrics");
      const result = {};
      
      metrics.metrics.forEach(metric => {
        result[metric.name] = metric.value;
      });

      this.data.performance = result;
      return result;
    } catch (error) {
      console.error("Failed to get performance metrics:", error);
      return {};
    }
  }

  getData(type, limit = 50, filter = null) {
    let data = [];

    switch (type) {
      case "console":
        data = this.data.console;
        break;
      case "network":
        data = this.data.network;
        break;
      case "errors":
        data = this.data.errors;
        break;
      case "performance":
        // Get fresh performance metrics
        this.getPerformanceMetrics();
        return this.data.performance;
    }

    // Apply filter if provided
    if (filter && data.length > 0) {
      data = data.filter(item => 
        JSON.stringify(item).toLowerCase().includes(filter.toLowerCase())
      );
    }

    // Apply limit
    return data.slice(-limit);
  }

  parseRemoteObject(obj) {
    if (obj.type === "string") return obj.value;
    if (obj.type === "number") return obj.value;
    if (obj.type === "boolean") return obj.value;
    if (obj.type === "undefined") return undefined;
    if (obj.type === "object" && obj.subtype === "null") return null;
    
    // For complex objects, return a preview
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

  trimData(type) {
    if (this.data[type].length > this.maxEntries) {
      this.data[type] = this.data[type].slice(-this.maxEntries);
    }
  }
}

// Create global instance
window.__debuggerHandler = new DebuggerHandler();