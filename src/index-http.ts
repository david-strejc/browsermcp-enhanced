#!/usr/bin/env node
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer as createHttpServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { program } from "commander";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

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
import { Context } from "./context";
import {
  browserScroll,
  browserQuery,
  browserFillForm,
} from "./tools/safe-mode-enhanced";
import { InstanceRegistry } from "./instance-registry";

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

const contextStorage = new AsyncLocalStorage<Context>();

const DEBUG_ENABLED = process.env.BROWSER_MCP_ENABLE_DEBUG === "1";

export function getCurrentContext(): Context | null {
  return contextStorage.getStore() || null;
}

export function setCurrentContext(_context: Context | null): void {
  // Intentionally left blank for backwards compatibility
}

export function getContextForRequest(req: any): Context | null {
  return req.__context || null;
}

type SessionId = string;

function normalizeHeader(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function sessionIdFromHeaders(req: IncomingMessage): SessionId | undefined {
  return normalizeHeader(req.headers["mcp-session-id"])
    ?? normalizeHeader(req.headers["x-instance-id"]);
}

function tabIdFromHeaders(req: IncomingMessage): string | undefined {
  return normalizeHeader(req.headers["x-tab-id"]);
}

function resolveTabId(payload: any, fallback?: string): string | undefined {
  const fromPayload = payload?.tabId
    ?? payload?.tabID
    ?? payload?.tab?.id
    ?? payload?.targetTabId
    ?? payload?.target_tab_id;
  return typeof fromPayload === "string" && fromPayload.length > 0
    ? fromPayload
    : fallback;
}

program
  .version("Version " + packageJSON.version)
  .name(packageJSON.name + "-http")
  .option("-p, --port <number>", "HTTP port to listen on", "3000")
  .action(async (options) => {
    const port = parseInt(options.port, 10);

    if (process.env.NODE_ENV === "development" || process.env.HOT_RELOAD === "true") {
      console.error("[BrowserMCP HTTP] Hot reload enabled");
      const watchPath = process.env.HOT_RELOAD_WATCH_PATH || "/home/david/Work/Programming/browsermcp-enhanced/src";
      console.error(`[BrowserMCP HTTP] Watching: ${watchPath}`);
      enableHotReload({
        verbose: true,
        debounceMs: 500,
        watchPath,
      });
    }

    const instanceRegistry = new InstanceRegistry((sessionId) => {
      const context = new Context();
      context.instanceId = sessionId;
      context.toolbox = toolbox;
      context.configureDaemon(process.env.BROWSER_MCP_DAEMON_URL);
      return context;
    });

    interface SessionState {
      sessionId: SessionId;
      server: Server;
      transport: StreamableHTTPServerTransport;
    }

    const sessions = new Map<SessionId, SessionState>();

    const processDaemonMessages = (record: InstanceRecord) => {
      const messages = record.context.drainDaemonMessages();
      for (const item of messages) {
        const message = item.message;
        if (!message || typeof message !== "object") continue;

        const candidateTabId = resolveTabId(message.payload, item.tabId);
        if (candidateTabId) {
          record.context.currentTabId = candidateTabId;
        }

        // Emit a logging notification to Claude with the raw daemon message
        const session = sessions.get(record.sessionId);
        if (session) {
          try {
            session.server.sendLoggingMessage({
              level: "info",
              logger: "browsermcp-daemon",
              data: {
                type: message.type,
                tabId: record.context.currentTabId,
                payload: message.payload ?? null,
                receivedAt: item.receivedAt,
              },
            });
          } catch (err) {
            console.error('[BrowserMCP HTTP] Failed to send logging notification:', err);
          }
        }
      }
    };

    const createSession = async (sessionId: SessionId): Promise<SessionState> => {
      const server = await createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => sessionId,
        onsessionclosed: async () => {
          console.error(`[BrowserMCP HTTP] Session closed: ${sessionId}`);
          await instanceRegistry.release(sessionId);
          sessions.delete(sessionId);
          await server.close();
          console.error(`[BrowserMCP HTTP] Active sessions: ${sessions.size}`);
        },
      });

      await server.connect(transport);
      transport.onerror = (err) => {
        console.error(`[BrowserMCP HTTP] Transport error for session ${sessionId}:`, err);
      };

      const state: SessionState = { sessionId, server, transport };
      sessions.set(sessionId, state);
      console.error(`[BrowserMCP HTTP] Session initialized: ${sessionId}`);
      console.error(`[BrowserMCP HTTP] Active sessions: ${sessions.size}`);
      return state;
    };

    interface BridgeContext {
      req: IncomingMessage;
      res: ServerResponse;
      sessions: Map<SessionId, SessionState>;
      instanceRegistry: InstanceRegistry;
    }

    const handleDaemonBridge = async ({ req, res, sessions, instanceRegistry }: BridgeContext) => {
      if (req.method !== "POST") {
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Method Not Allowed" }));
        return;
      }

      const sessionId = sessionIdFromHeaders(req);
      if (!sessionId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing X-Instance-ID header" }));
        return;
      }

      const session = sessions.get(sessionId);
      const record = instanceRegistry.get(sessionId);
      if (!session || !record) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unknown MCP session" }));
        return;
      }

      let raw = "";
      try {
        for await (const chunk of req) {
          raw += chunk.toString();
        }
      } catch {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to read request body" }));
        return;
      }

      let message: any;
      try {
        message = raw ? JSON.parse(raw) : {};
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON payload" }));
        return;
      }

      const messageId = message?.messageId;
      if (!messageId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing messageId" }));
        return;
      }

      const tabId = tabIdFromHeaders(req);
      record.context.enqueueDaemonMessage({
        sessionId,
        tabId,
        message,
        receivedAt: Date.now(),
      });

      processDaemonMessages(record);

      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "accepted", messageId }));
    };

    const httpServer = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
      if (!req.url) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing URL" }));
        return;
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid URL" }));
        return;
      }

      if (DEBUG_ENABLED && parsedUrl.pathname.startsWith("/debug/session/")) {
        const sessionId = decodeURIComponent(parsedUrl.pathname.replace("/debug/session/", ""));
        const record = sessionId ? instanceRegistry.get(sessionId) : undefined;

        if (!sessionId || !record) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Session not found" }));
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          sessionId,
          currentTabId: record.context.currentTabId,
          daemonQueueLength: record.context.daemonMessageCount,
        }));
        return;
      }

      if (parsedUrl.pathname === "/ws-message") {
        await handleDaemonBridge({ req, res, sessions, instanceRegistry });
        return;
      }

      if (parsedUrl.pathname !== "/mcp") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not Found" }));
        return;
      }

      let sessionId = sessionIdFromHeaders(req);
      let session: SessionState | undefined = sessionId ? sessions.get(sessionId) : undefined;

      if (sessionId && !session) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unknown MCP session" }));
        return;
      }

      if (!session) {
        sessionId = randomUUID();
        instanceRegistry.ensure(sessionId);
        session = await createSession(sessionId);
      }

      const record = instanceRegistry.ensure(sessionId);
      (req as any).__context = record.context;
      (req as any).__instanceId = record.sessionId;

      await contextStorage.run(record.context, async () => {
        await session!.transport.handleRequest(req, res);
      });

      processDaemonMessages(record);
    });

    httpServer.keepAliveTimeout = 60000;
    httpServer.headersTimeout = 65000;

    httpServer.listen(port, () => {
      console.error(`[BrowserMCP HTTP] Server listening on http://localhost:${port}/mcp`);
      console.error(`[BrowserMCP HTTP] Version: ${packageJSON.version}`);
      console.error("[BrowserMCP HTTP] Session-based multi-instance routing enabled");
    });

    const shutdown = async () => {
      console.error("[BrowserMCP HTTP] Shutting down...");
      httpServer.close();
      await Promise.allSettled(
        Array.from(sessions.values()).map(async ({ server, transport, sessionId }) => {
          try {
            await transport.close();
          } catch (error) {
            console.warn(`[BrowserMCP HTTP] Error closing transport for session ${sessionId}:`, error);
          }
          try {
            await server.close();
          } catch (error) {
            console.warn(`[BrowserMCP HTTP] Error closing server for session ${sessionId}:`, error);
          }
        })
      );
      sessions.clear();
      await instanceRegistry.clear();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });

program.parse(process.argv);
