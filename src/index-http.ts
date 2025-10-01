#!/usr/bin/env node
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer as createHttpServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { program } from "commander";
import { parse as parseUrl } from "node:url";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { WebSocketServer } from "ws";

import type { Resource } from "./resources/resource";
import { createServerWithTools } from "./server";
import { enableHotReload } from "./hot-reload";
import { browser_navigate } from "./tools/navigation-unified";
import { pressKey, wait } from "./tools/common";
import * as custom from "./tools/custom";
import * as snapshot from "./tools/snapshot";
import { browser_tab } from "./tools/tabs-unified";
import { browser_debugger } from "./tools/debugger-unified";
import { executeJS } from "./tools/code-execution";
import { fileUploadTools } from "./tools/file-upload";
import { browser_save_hint, browser_get_hints } from "./hints/index";
import type { Tool } from "./tools/tool";
import { createWebSocketServer } from "./ws";
import { Context } from "./context";

import {
  browserScroll,
  browserQuery,
  browserFillForm
} from "./tools/safe-mode-enhanced";

import packageJSON from "../package.json";

const commonTools: Tool[] = [pressKey, wait];
const customTools: Tool[] = [custom.getConsoleLogs, custom.screenshot];
const tabTools: Tool[] = [browser_tab];
const scaffoldTools: Tool[] = [];
const codeExecutionTools: Tool[] = [executeJS];
const hintTools: Tool[] = [browser_save_hint, browser_get_hints];
const helperTools: Tool[] = [];
const safeModeEnhancedTools: Tool[] = [browserScroll, browserQuery, browserFillForm];
const batchOperationTools: Tool[] = [];
const stabilityTools: Tool[] = [];

const snapshotTools: Tool[] = [
  browser_navigate,
  snapshot.snapshot,
  snapshot.click,
  snapshot.hover,
  snapshot.type,
  snapshot.selectOption,
  ...commonTools,
  ...customTools,
  ...tabTools,
  browser_debugger,
  ...scaffoldTools,
  ...codeExecutionTools,
  ...fileUploadTools,
  ...hintTools,
  ...helperTools,
  ...safeModeEnhancedTools,
  ...batchOperationTools,
  ...stabilityTools,
];

const resources: Resource[] = [];

// Build shared toolbox
const toolbox: Record<string, Tool> = {};
for (const tool of snapshotTools) {
  toolbox[tool.schema.name] = tool;
}

async function createServer(): Promise<Server> {
  return createServerWithTools({
    name: "browsermcp-enhanced",
    version: packageJSON.version,
    tools: snapshotTools,
    resources,
    skipWebSocket: true,
  });
}

// Per-Claude-instance record (identified by TCP socket)
interface InstanceRecord {
  instanceId: string;
  socket: Socket;
  windowId?: string;
  wss?: WebSocketServer;
  wsPort?: number;
  context: Context;
}

// Browser window waiting to be bound to a Claude instance
interface WindowRecord {
  windowId: string;
  wss: WebSocketServer;
  wsPort: number;
  boundTo?: string;
}

const socketMap = new WeakMap<Socket, InstanceRecord>();
const instanceById = new Map<string, InstanceRecord>();
const unboundWindows: WindowRecord[] = [];

function getRecordForSocket(sock: Socket): InstanceRecord {
  let rec = socketMap.get(sock);
  if (rec) return rec;

  // New Claude instance detected!
  rec = {
    instanceId: randomUUID(),
    socket: sock,
    context: new Context()
  };

  rec.context.toolbox = toolbox;
  rec.context.instanceId = rec.instanceId;

  socketMap.set(sock, rec);
  instanceById.set(rec.instanceId, rec);

  console.error(`[BrowserMCP HTTP] New Claude instance detected: ${rec.instanceId}`);

  sock.once('close', () => {
    console.error(`[BrowserMCP HTTP] Claude instance ${rec.instanceId} disconnected`);
    cleanupInstance(rec.instanceId);
  });

  bindFirstFreeWindow(rec);
  return rec;
}

function bindFirstFreeWindow(inst: InstanceRecord): void {
  if (inst.windowId) return;

  const win = unboundWindows.shift();
  if (!win) {
    console.error(`[BrowserMCP HTTP] Instance ${inst.instanceId} waiting for browser window...`);
    return;
  }

  win.boundTo = inst.instanceId;
  inst.windowId = win.windowId;
  inst.wss = win.wss;
  inst.wsPort = win.wsPort;
  inst.context.port = win.wsPort;

  console.error(`[BrowserMCP HTTP] Bound instance ${inst.instanceId} to browser window ${win.windowId} (port ${win.wsPort})`);

  win.wss.on('connection', (websocket) => {
    inst.context.ws = websocket;
    console.error(`[BrowserMCP HTTP] WebSocket connected for instance ${inst.instanceId}`);

    let isAlive = true;
    let lastPongTime = Date.now();

    // Enable keep-alive ping/pong with 90s timeout
    const pingInterval = setInterval(() => {
      if (websocket.readyState !== 1) { // Not OPEN
        clearInterval(pingInterval);
        return;
      }

      // Check if last pong was more than 90s ago
      const timeSinceLastPong = Date.now() - lastPongTime;
      if (timeSinceLastPong > 90000) {
        console.error(`[BrowserMCP HTTP] WebSocket stale for instance ${inst.instanceId} (${Math.round(timeSinceLastPong / 1000)}s since last pong), terminating`);
        clearInterval(pingInterval);
        websocket.terminate();
        return;
      }

      // Send ping if connection hasn't responded
      if (!isAlive) {
        console.error(`[BrowserMCP HTTP] WebSocket not responding for instance ${inst.instanceId}, terminating`);
        clearInterval(pingInterval);
        websocket.terminate();
        return;
      }

      isAlive = false;
      websocket.ping();
    }, 30000); // Check every 30 seconds

    websocket.on('pong', () => {
      isAlive = true;
      lastPongTime = Date.now();
    });

    websocket.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'hello' && msg.wants === 'instanceId') {
          websocket.send(JSON.stringify({
            type: 'helloAck',
            instanceId: inst.instanceId,
            port: inst.wsPort
          }));
        } else if (msg.type === 'ping') {
          // Handle explicit ping messages from client
          websocket.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (err) {
        console.error('[BrowserMCP HTTP] WebSocket message error:', err);
      }
    });

    websocket.on('close', () => {
      console.error(`[BrowserMCP HTTP] WebSocket closed for instance ${inst.instanceId}`);
      clearInterval(pingInterval);
      inst.context.ws = undefined;
    });

    websocket.on('error', (err) => {
      console.error(`[BrowserMCP HTTP] WebSocket error for instance ${inst.instanceId}:`, err);
      clearInterval(pingInterval);
    });
  });
}

function cleanupInstance(instanceId: string): void {
  const inst = instanceById.get(instanceId);
  if (!inst) return;

  if (inst.wss) {
    inst.wss.clients.forEach(client => client.close());
    inst.wss.close();
  }

  if (inst.context.tabs && inst.context.tabs.size > 0) {
    console.error(`[BrowserMCP HTTP] Closing ${inst.context.tabs.size} tabs for instance ${instanceId}`);
  }

  instanceById.delete(instanceId);
  console.error(`[BrowserMCP HTTP] Cleaned up instance ${instanceId}`);
  console.error(`[BrowserMCP HTTP] Active instances: ${instanceById.size}`);
}

const contextStorage = new AsyncLocalStorage<Context>();

export function getCurrentContext(): Context | null {
  return contextStorage.getStore() || null;
}

export function setCurrentContext(context: Context | null): void {
  // This function is kept for backwards compatibility but is now a no-op
  // Context is managed by AsyncLocalStorage.run() instead
}

export function getContextForRequest(req: any): Context | null {
  return req.__context || null;
}

program
  .version("Version " + packageJSON.version)
  .name(packageJSON.name + "-http")
  .option("-p, --port <number>", "HTTP port to listen on", "3000")
  .action(async (options) => {
    const mcpServer = await createServer();
    const port = parseInt(options.port, 10);

    if (process.env.NODE_ENV === 'development' || process.env.HOT_RELOAD === 'true') {
      console.error('[BrowserMCP HTTP] Hot reload enabled');
      const watchPath = process.env.HOT_RELOAD_WATCH_PATH || '/home/david/Work/Programming/browsermcp-enhanced/src';
      console.error(`[BrowserMCP HTTP] Watching: ${watchPath}`);
      enableHotReload({
        verbose: true,
        debounceMs: 500,
        watchPath: watchPath
      });
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    await mcpServer.connect(transport);

    const httpServer = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
      const inst = getRecordForSocket(req.socket!);
      console.error(`[BrowserMCP HTTP] Request on socket, instanceId: ${inst.instanceId}, has context: ${!!inst.context}, has WS: ${inst.context.hasWebSocket()}`);

      (req as any).__context = inst.context;
      (req as any).__instanceId = inst.instanceId;

      const parsedUrl = parseUrl(req.url || '', true);

      if (parsedUrl.pathname === '/allocate') {
        const windowId = parsedUrl.query.wid as string | undefined;

        if (!windowId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'missing wid parameter' }));
          return;
        }

        const existing = unboundWindows.find(w => w.windowId === windowId);
        if (existing) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ port: existing.wsPort }));
          return;
        }

        try {
          console.error(`[BrowserMCP HTTP] New browser window allocation: ${windowId}`);
          const { server: wss, port: wsPort } = await createWebSocketServer();

          const winRec: WindowRecord = {
            windowId,
            wss,
            wsPort
          };

          unboundWindows.push(winRec);
          console.error(`[BrowserMCP HTTP] Browser window ${windowId} allocated port ${wsPort}, waiting for Claude instance...`);

          for (const [id, instRec] of instanceById.entries()) {
            if (!instRec.windowId) {
              bindFirstFreeWindow(instRec);
              break;
            }
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ port: wsPort }));
          return;
        } catch (err) {
          console.error('[BrowserMCP HTTP] Failed to create WebSocket server:', err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to allocate WebSocket server' }));
          return;
        }
      }

      await contextStorage.run(inst.context, async () => {
        await transport.handleRequest(req, res);
      });
    });

    httpServer.keepAliveTimeout = 60000;
    httpServer.headersTimeout = 65000;

    httpServer.listen(port, () => {
      console.error(`[BrowserMCP HTTP] Server listening on http://localhost:${port}/mcp`);
      console.error(`[BrowserMCP HTTP] Allocation endpoint: http://localhost:${port}/allocate?wid=<windowId>`);
      console.error(`[BrowserMCP HTTP] Version: ${packageJSON.version}`);
      console.error(`[BrowserMCP HTTP] Socket-based multi-instance: Each Claude Desktop gets isolated tabs`);
      console.error(`[BrowserMCP HTTP] Keep-alive enabled for persistent socket detection`);
    });

    process.on('SIGINT', async () => {
      console.error('[BrowserMCP HTTP] Shutting down...');
      httpServer.close();
      await mcpServer.close();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.error('[BrowserMCP HTTP] Shutting down...');
      httpServer.close();
      await mcpServer.close();
      process.exit(0);
    });
  });

program.parse(process.argv);
