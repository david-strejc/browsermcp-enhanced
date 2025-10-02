import { createSocketMessageSender, BrowserMCPError } from "./messaging/ws/sender";
import { createDaemonMessageSender } from "./messaging/daemon/sender";
import { WebSocket } from "ws";

import { mcpConfig } from "./config/mcp.config";
import { MessagePayload, MessageType, SocketMessageMap } from "./types/messages";
import type { Tool } from "./tools/tool";

const noConnectionMessage = `No connection to browser extension. In order to proceed, you must first connect a tab by clicking the Browser MCP extension icon in the browser toolbar and clicking the 'Connect' button.`;

// Enhanced options interface for context-level message sending
interface ContextSendOptions {
  timeoutMs?: number;
  retry?: {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    backoffMultiplier?: number;
  };
  errorContext?: string; // Additional context for error messages
}

export class Context {
  private _ws: WebSocket | undefined;
  private _tabs: Map<string, any> = new Map();
  private _currentTabId: string | undefined;
  private _connectionAttempts: number = 0;
  private _lastConnectionTime: number | undefined;
  private _toolbox: Record<string, Tool> = {};
  private _daemonMessages: any[] = [];
  private _daemonSender: ReturnType<typeof createDaemonMessageSender<SocketMessageMap>> | null = null;
  private _daemonUrl: string | undefined;
  public instanceId: string = '';
  public port: number = 0;

  get ws(): WebSocket {
    if (!this._ws) {
      throw new BrowserMCPError(
        noConnectionMessage,
        'NO_CONNECTION',
        true // Connection errors are retryable
      );
    }
    return this._ws;
  }

  set ws(ws: WebSocket | undefined) {
    this._ws = ws;
    if (ws) {
      this._lastConnectionTime = Date.now();
      this._connectionAttempts = 0;
    }
  }

  hasWebSocket(): boolean {
    return !!this._ws;
  }

  // Safe getter that doesn't throw
  getWebSocketOrNull(): WebSocket | undefined {
    return this._ws;
  }

  private _originalWsSetter(ws: WebSocket) {
    this._ws = ws;
    this._lastConnectionTime = Date.now();
    this._connectionAttempts = 0;
    
    // Add connection monitoring
    ws.on('close', () => {
      console.warn('[BrowserMCP] WebSocket connection closed');
      this._ws = undefined;
    });
    
    ws.on('error', (error) => {
      console.error('[BrowserMCP] WebSocket error:', error);
    });
  }

  hasWs(): boolean {
    return !!this._ws && this._ws.readyState === WebSocket.OPEN;
  }

  get currentTabId(): string | undefined {
    return this._currentTabId;
  }

  set currentTabId(tabId: string | undefined) {
    this._currentTabId = tabId;
  }

  // Get connection diagnostics
  getConnectionInfo() {
    return {
      connected: this.hasWs(),
      connectionAttempts: this._connectionAttempts,
      lastConnectionTime: this._lastConnectionTime,
      currentTabId: this._currentTabId,
      wsState: this._ws?.readyState
    };
  }

  async sendSocketMessage<T extends MessageType<SocketMessageMap>>(
    type: T,
    payload: MessagePayload<SocketMessageMap, T>,
    options: ContextSendOptions = {},
  ) {
    const enhancedOptions = {
      timeoutMs: options.timeoutMs || 30000,
      retry: {
        maxRetries: 2,
        baseDelayMs: 1000,
        maxDelayMs: 5000,
        backoffMultiplier: 2,
        ...options.retry
      }
    };

    try {
      if (this.hasWs()) {
        const { sendSocketMessage } = createSocketMessageSender<SocketMessageMap>(
          this.ws,
          this.instanceId
        );
        return await sendSocketMessage(type, payload, enhancedOptions);
      }

      const daemonSender = this.ensureDaemonSender();
      const resp = await daemonSender.sendDaemonMessage(type, payload, {
        timeoutMs: enhancedOptions.timeoutMs,
        retry: enhancedOptions.retry,
        tabId: this._currentTabId,
      });
      // If daemon response includes a tabId, persist it for subsequent commands
      const anyResp: any = resp as any;
      if (anyResp && (anyResp.tabId !== undefined || (anyResp._debug && anyResp._debug.tabId !== undefined))) {
        const tabIdVal = anyResp.tabId ?? anyResp._debug?.tabId;
        this._currentTabId = typeof tabIdVal === 'number' ? String(tabIdVal) : String(tabIdVal);
      }
      return resp;
    } catch (e) {
      // Enhanced error handling with more context
      if (e instanceof BrowserMCPError) {
        // Add context information to the error
        const contextualError = new BrowserMCPError(
          e.message,
          e.code,
          e.retryable,
          {
            ...e.details,
            messageType: String(type),
            connectionInfo: this.getConnectionInfo(),
            errorContext: options.errorContext
          }
        );
        throw contextualError;
      }
      
      if (e instanceof Error && e.message === mcpConfig.errors.noConnectedTab) {
        throw new BrowserMCPError(
          noConnectionMessage,
          'NO_CONNECTED_TAB',
          true,
          {
            messageType: String(type),
            connectionInfo: this.getConnectionInfo(),
            errorContext: options.errorContext
          }
        );
      }
      
      // Wrap unknown errors
      throw new BrowserMCPError(
        `Unexpected error: ${(e as Error).message}`,
        'UNKNOWN_ERROR',
        true,
        {
          originalError: e,
          messageType: String(type),
          connectionInfo: this.getConnectionInfo(),
          errorContext: options.errorContext
        }
      );
    }
  }

  async close() {
    if (!this._ws) {
      return;
    }
    
    try {
      await this._ws.close();
    } catch (error) {
      console.warn('[BrowserMCP] Error closing WebSocket:', error);
    } finally {
      this._ws = undefined;
    }
  }

  // Utility method for tools to use enhanced error context
  async sendWithContext<T extends MessageType<SocketMessageMap>>(
    type: T,
    payload: MessagePayload<SocketMessageMap, T>,
    context: string,
    options: ContextSendOptions = {}
  ) {
    return this.sendSocketMessage(type, payload, {
      ...options,
      errorContext: context
    });
  }

  // Toolbox management for inter-tool invocation
  get toolbox(): Record<string, Tool> {
    return this._toolbox;
  }

  set toolbox(tools: Record<string, Tool>) {
    this._toolbox = tools;
  }

  configureDaemon(daemonUrl?: string) {
    this._daemonUrl = daemonUrl ?? "http://127.0.0.1:8765";
    this._daemonSender = null;
  }

  private ensureDaemonSender() {
    if (!this.instanceId) {
      throw new BrowserMCPError(
        "Instance ID not set before daemon messaging",
        "NO_INSTANCE",
        true
      );
    }

    if (!this._daemonSender) {
      this._daemonSender = createDaemonMessageSender<SocketMessageMap>(
        this.instanceId,
        this._daemonUrl
      );
    }

    return this._daemonSender;
  }

  enqueueDaemonMessage(message: any) {
    this._daemonMessages.push(message);
  }

  drainDaemonMessages(): any[] {
    const messages = [...this._daemonMessages];
    this._daemonMessages.length = 0;
    return messages;
  }

  get daemonMessageCount(): number {
    return this._daemonMessages.length;
  }

  canUseDaemonTransport(): boolean {
    return !!this._daemonUrl;
  }

  // Call another tool from within a tool
  async callTool(name: string, args: any): Promise<any> {
    const tool = this._toolbox[name];
    if (!tool) {
      throw new BrowserMCPError(
        `Tool '${name}' not found in toolbox`,
        'TOOL_NOT_FOUND',
        false
      );
    }
    
    // Call the tool's handler with this context
    return await tool.handle(this, args);
  }
}
