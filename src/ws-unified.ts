/**
 * Unified WebSocket Server - Single Listener, Multiple Connections
 *
 * Industry-standard pattern: One TCP port, one connection per Claude instance
 * Session ID passed via URI: ws://localhost:8765/session/<instanceId>
 *
 * Benefits:
 * - No port scanning needed
 * - Scales to unlimited instances
 * - Simple firewall rules (single port)
 * - Maintains per-instance isolation
 * - Automatic lifecycle detection via WS close
 */

import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { randomUUID } from 'crypto';
import { Context } from './context';

export interface UnifiedWSServerConfig {
  port?: number;
  onConnection?: (instanceId: string, ws: WebSocket, context: Context) => void;
  onDisconnection?: (instanceId: string) => void;
}

export interface SessionInfo {
  instanceId: string;
  context: Context;
  ws: WebSocket;
  connectedAt: number;
  lastPong: number;
}

/**
 * Unified WebSocket Server
 * Manages multiple Claude instances on a single port
 */
export class UnifiedWSServer {
  private wss: WebSocketServer;
  private sessions = new Map<string, SessionInfo>();
  private socketToSession = new WeakMap<WebSocket, string>();
  private port: number;
  private config: UnifiedWSServerConfig;

  constructor(config: UnifiedWSServerConfig = {}) {
    this.port = config.port || 8765;
    this.config = config;

    this.wss = new WebSocketServer({
      port: this.port,
      // Handle WebSocket upgrade manually to extract session ID
      noServer: false
    });

    this.setupServer();
    console.error(`[UnifiedWS] Server listening on port ${this.port}`);
  }

  private setupServer(): void {
    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      const instanceId = this.extractInstanceId(req);

      if (!instanceId) {
        console.error('[UnifiedWS] No instance ID provided, rejecting connection');
        ws.close(4000, 'Missing instance ID');
        return;
      }

      // Check for duplicate connections (same instanceId already connected)
      const existing = this.sessions.get(instanceId);
      if (existing && existing.ws.readyState === WebSocket.OPEN) {
        console.error(`[UnifiedWS] Duplicate connection for instance ${instanceId}, closing old connection`);
        existing.ws.close();
      }

      this.handleNewConnection(instanceId, ws);
    });

    this.wss.on('error', (error) => {
      console.error('[UnifiedWS] Server error:', error);
    });
  }

  /**
   * Extract instance ID from WebSocket upgrade request
   * Supports multiple formats:
   * - URI path: /session/<instanceId>
   * - Query param: ?instanceId=<uuid>
   * - Sub-protocol: Sec-WebSocket-Protocol: mcp.v1,instance.<uuid>
   */
  private extractInstanceId(req: IncomingMessage): string | null {
    // Method 1: URI path (/session/<instanceId>)
    const urlMatch = req.url?.match(/^\/session\/([a-f0-9-]+)/i);
    if (urlMatch) {
      return urlMatch[1];
    }

    // Method 2: Query parameter (?instanceId=<uuid>)
    const urlObj = new URL(req.url || '', `http://${req.headers.host}`);
    const queryId = urlObj.searchParams.get('instanceId');
    if (queryId) {
      return queryId;
    }

    // Method 3: Sub-protocol (Sec-WebSocket-Protocol: instance.<uuid>)
    const protocols = req.headers['sec-websocket-protocol'];
    if (protocols) {
      const protocolList = protocols.split(',').map(p => p.trim());
      for (const proto of protocolList) {
        const match = proto.match(/^instance\.([a-f0-9-]+)$/i);
        if (match) {
          return match[1];
        }
      }
    }

    // Method 4: X-MCP-Instance header (fallback)
    const headerId = req.headers['x-mcp-instance'];
    if (typeof headerId === 'string') {
      return headerId;
    }

    return null;
  }

  private handleNewConnection(instanceId: string, ws: WebSocket): void {
    const now = Date.now();

    // Create or reuse context
    const existing = this.sessions.get(instanceId);
    const context = existing?.context || new Context();
    context.instanceId = instanceId;
    context.port = this.port;
    context.ws = ws;

    const session: SessionInfo = {
      instanceId,
      context,
      ws,
      connectedAt: now,
      lastPong: now
    };

    this.sessions.set(instanceId, session);
    this.socketToSession.set(ws, instanceId);

    console.error(`[UnifiedWS] Instance ${instanceId} connected (total: ${this.sessions.size})`);

    // Setup heartbeat monitoring (ping/pong every 30s, timeout after 90s)
    this.setupHeartbeat(session);

    // Setup message handlers
    ws.on('message', (data: Buffer) => {
      this.handleMessage(session, data);
    });

    ws.on('close', () => {
      this.handleDisconnection(instanceId);
    });

    ws.on('error', (error) => {
      console.error(`[UnifiedWS] WebSocket error for ${instanceId}:`, error);
    });

    // Notify callback
    if (this.config.onConnection) {
      this.config.onConnection(instanceId, ws, context);
    }

    // Send connection acknowledgment
    this.sendToSession(instanceId, {
      type: 'connected',
      instanceId,
      port: this.port,
      timestamp: now
    });
  }

  private setupHeartbeat(session: SessionInfo): void {
    let isAlive = true;

    const pingInterval = setInterval(() => {
      if (session.ws.readyState !== WebSocket.OPEN) {
        clearInterval(pingInterval);
        return;
      }

      // Check if last pong was more than 90s ago
      const timeSinceLastPong = Date.now() - session.lastPong;
      if (timeSinceLastPong > 90000) {
        console.error(`[UnifiedWS] Instance ${session.instanceId} stale (${Math.round(timeSinceLastPong / 1000)}s), terminating`);
        clearInterval(pingInterval);
        session.ws.terminate();
        return;
      }

      if (!isAlive) {
        console.error(`[UnifiedWS] Instance ${session.instanceId} not responding, terminating`);
        clearInterval(pingInterval);
        session.ws.terminate();
        return;
      }

      isAlive = false;
      session.ws.ping();
    }, 30000); // Check every 30 seconds

    session.ws.on('pong', () => {
      isAlive = true;
      session.lastPong = Date.now();
    });

    // Cleanup on close
    session.ws.once('close', () => {
      clearInterval(pingInterval);
    });
  }

  private handleMessage(session: SessionInfo, data: Buffer): void {
    try {
      const msg = JSON.parse(data.toString());

      // Handle protocol messages
      if (msg.type === 'hello' && msg.wants === 'instanceId') {
        this.sendToSession(session.instanceId, {
          type: 'helloAck',
          instanceId: session.instanceId,
          port: this.port
        });
      } else if (msg.type === 'ping') {
        this.sendToSession(session.instanceId, { type: 'pong' });
      }
      // Other messages are handled by tool message handlers
    } catch (err) {
      console.error(`[UnifiedWS] Message parse error for ${session.instanceId}:`, err);
    }
  }

  private handleDisconnection(instanceId: string): void {
    const session = this.sessions.get(instanceId);
    if (!session) return;

    console.error(`[UnifiedWS] Instance ${instanceId} disconnected`);

    // Clear context WebSocket reference
    session.context.ws = undefined;

    // Remove session
    this.sessions.delete(instanceId);

    console.error(`[UnifiedWS] Active instances: ${this.sessions.size}`);

    // Notify callback
    if (this.config.onDisconnection) {
      this.config.onDisconnection(instanceId);
    }
  }

  /**
   * Send message to specific session
   */
  sendToSession(instanceId: string, message: any): boolean {
    const session = this.sessions.get(instanceId);
    if (!session || session.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      session.ws.send(JSON.stringify(message));
      return true;
    } catch (err) {
      console.error(`[UnifiedWS] Failed to send to ${instanceId}:`, err);
      return false;
    }
  }

  /**
   * Get context for instance ID
   */
  getContext(instanceId: string): Context | null {
    return this.sessions.get(instanceId)?.context || null;
  }

  /**
   * Get all active instance IDs
   */
  getActiveInstances(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Get instance count
   */
  getInstanceCount(): number {
    return this.sessions.size;
  }

  /**
   * Check if instance is connected
   */
  isInstanceConnected(instanceId: string): boolean {
    const session = this.sessions.get(instanceId);
    return !!session && session.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Close server and all connections
   */
  async close(): Promise<void> {
    console.error('[UnifiedWS] Shutting down...');

    // Close all client connections
    for (const [instanceId, session] of this.sessions) {
      try {
        session.ws.close();
      } catch (err) {
        console.error(`[UnifiedWS] Error closing ${instanceId}:`, err);
      }
    }

    // Close server
    return new Promise((resolve) => {
      this.wss.close(() => {
        console.error('[UnifiedWS] Server closed');
        resolve();
      });
    });
  }
}

/**
 * Factory function for backwards compatibility
 */
export async function createUnifiedWebSocketServer(
  config: UnifiedWSServerConfig = {}
): Promise<UnifiedWSServer> {
  return new UnifiedWSServer(config);
}
