#!/usr/bin/env node
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timeout: NodeJS.Timeout;
}

interface SessionRecord {
  sessionId: string;
  socket: WebSocket;
  pending: Map<string, PendingRequest>;
  lastSeen: number;
}

const DAEMON_PORT = parseInt(process.env.BROWSER_MCP_DAEMON_PORT || "8765", 10);
const MCP_HTTP_URL = process.env.BROWSER_MCP_HTTP_URL || "http://127.0.0.1:3000";
const COMMAND_TIMEOUT_MS = parseInt(process.env.BROWSER_MCP_COMMAND_TIMEOUT || "45000", 10);

const sessions = new Map<string, SessionRecord>();

function log(...args: any[]) {
  console.log("[BrowserMCP Daemon]", new Date().toISOString(), ...args);
}

function warn(...args: any[]) {
  console.warn("[BrowserMCP Daemon]", new Date().toISOString(), ...args);
}

function errorLog(...args: any[]) {
  console.error("[BrowserMCP Daemon]", new Date().toISOString(), ...args);
}

function extractSessionIdFromPath(pathname: string | undefined): string | null {
  if (!pathname) return null;
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length >= 2 && parts[0] === "session") {
    return decodeURIComponent(parts[1]);
  }
  return null;
}

async function forwardToMcp(sessionId: string, tabId: string | undefined, message: any) {
  try {
    const response = await fetch(`${MCP_HTTP_URL.replace(/\/$/, "")}/ws-message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Instance-ID": sessionId,
        ...(tabId ? { "X-Tab-ID": tabId } : {}),
      },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      const text = await response.text();
      warn(`MCP server responded with ${response.status}: ${text}`);
    }
  } catch (err) {
    errorLog("Failed to forward message to MCP server:", err);
  }
}

function handleExtensionMessage(session: SessionRecord, rawData: WebSocket.RawData) {
  let message: any;
  try {
    message = JSON.parse(rawData.toString());
  } catch (err) {
    warn(`Invalid JSON from session ${session.sessionId}:`, err);
    return;
  }

  session.lastSeen = Date.now();

  if (message?.type === "response" && message?.id !== undefined) {
    const key = String(message.id);
    const pending = session.pending.get(key);
    if (pending) {
      clearTimeout(pending.timeout);
      session.pending.delete(key);
      pending.resolve(message.data ?? message.payload ?? message);
      return;
    }
  }

  if (message?.type === "hello") {
    session.socket.send(JSON.stringify({
      type: "helloAck",
      instanceId: session.sessionId,
      timestamp: Date.now(),
    }));
    return;
  }

  if (message?.type === "ping") {
    session.socket.send(JSON.stringify({
      type: "pong",
      id: message.id,
      timestamp: Date.now(),
    }));
    return;
  }

  if (message?.type === "connected") {
    return; // informational
  }

  const tabId = message?.tabId ?? message?.payload?.tabId;
  forwardToMcp(session.sessionId, tabId, {
    messageId: message.messageId ?? message.id ?? `daemon-${Date.now()}`,
    type: message.type,
    payload: message.payload ?? {},
    tabId,
    original: message,
  });
}

async function handleCommandRequest(req: any, res: any, sessionId: string, tabId: string | undefined) {
  const session = sessions.get(sessionId);
  if (!session || session.socket.readyState !== WebSocket.OPEN) {
    warn(`Command received for missing session ${sessionId}`);
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Instance not connected" }));
    return;
  }

  log(`Command ${sessionId} received at daemon (${tabId ?? 'no-tab'})`);

  let body = "";
  for await (const chunk of req) {
    body += chunk.toString();
  }

  let command: any;
  try {
    command = body ? JSON.parse(body) : {};
  } catch (err) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON payload" }));
    return;
  }

  if (!command || typeof command !== "object") {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid command payload" }));
    return;
  }

  const messageId = command.id ?? command.messageId;
  const messageType = command.type;

  if (messageId === undefined || !messageType) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing id or type" }));
    return;
  }

  const timeoutMs = Number(command.timeoutMs ?? COMMAND_TIMEOUT_MS);

  const pendingKey = String(messageId);

  const pendingPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      session.pending.delete(pendingKey);
      reject(new Error("Timed out waiting for extension response"));
    }, timeoutMs);

    session.pending.set(pendingKey, {
      resolve,
      reject,
      timeout,
    });
  });

  try {
    const payloadToSend = {
      id: messageId,
      type: messageType,
      payload: command.payload ?? {},
      ...(tabId ? { tabId } : {}),
    };

    session.socket.send(JSON.stringify(payloadToSend));
  } catch (err) {
    const pending = session.pending.get(pendingKey);
    if (pending) {
      clearTimeout(pending.timeout);
      session.pending.delete(pendingKey);
    }
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Failed to send command: ${(err as Error).message}` }));
    return;
  }

  try {
    const result = await pendingPromise;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, payload: result }));
  } catch (err) {
    res.writeHead(504, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}

const httpServer = createServer(async (req, res) => {
  const { method } = req;
  const url = req.url ? new URL(req.url, `http://${req.headers.host || "localhost"}`) : null;

  if (!url) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid URL" }));
    return;
  }

  if (method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", sessions: sessions.size }));
    return;
  }

  if (method === "POST" && url.pathname === "/commands") {
    const sessionId = (req.headers["x-instance-id"] as string | undefined) || undefined;
    if (!sessionId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing X-Instance-ID header" }));
      return;
    }

    const tabId = req.headers["x-tab-id"] as string | undefined;
    await handleCommandRequest(req, res, sessionId, tabId);
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not Found" }));
});

const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (socket, request) => {
  const url = request.url ? new URL(request.url, `ws://${request.headers.host || "localhost"}`) : null;
  const sessionId = extractSessionIdFromPath(url?.pathname || undefined);

  if (!sessionId) {
    socket.close(1008, "Missing session ID");
    return;
  }

  log(`Extension connected for session ${sessionId}`);

  const existing = sessions.get(sessionId);
  if (existing) {
    existing.pending.forEach(({ reject, timeout }) => {
      clearTimeout(timeout);
      reject(new Error("Connection replaced"));
    });
    existing.socket.terminate();
  }

  const record: SessionRecord = {
    sessionId,
    socket,
    pending: new Map(),
    lastSeen: Date.now(),
  };

  sessions.set(sessionId, record);

  socket.on("message", (data) => handleExtensionMessage(record, data));

  socket.on("close", () => {
    log(`Extension disconnected for session ${sessionId}`);
    const current = sessions.get(sessionId);
    if (current && current.socket === socket) {
      sessions.delete(sessionId);
      current.pending.forEach(({ reject, timeout }) => {
        clearTimeout(timeout);
        reject(new Error("Extension disconnected"));
      });
    }
  });

  socket.on("error", (err) => {
    errorLog(`WebSocket error for session ${sessionId}:`, err);
  });

  socket.send(JSON.stringify({
    type: "connected",
    instanceId: sessionId,
    timestamp: Date.now(),
  }));
});

httpServer.on("upgrade", (request, socket, head) => {
  const url = request.url ? new URL(request.url, `ws://${request.headers.host || "localhost"}`) : null;
  const pathname = url?.pathname || "";

  if (pathname.startsWith("/session/")) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

httpServer.listen(DAEMON_PORT, () => {
  log(`WebSocket daemon listening on ws://localhost:${DAEMON_PORT}`);
  log(`Forwarding MCP HTTP traffic to ${MCP_HTTP_URL}`);
});

function shutdown() {
  log("Shutting down daemon...");

  sessions.forEach((session) => {
    session.pending.forEach(({ reject, timeout }) => {
      clearTimeout(timeout);
      reject(new Error("Daemon shutting down"));
    });
    try {
      session.socket.close(1001, "Daemon shutting down");
    } catch (err) {
      // ignore
    }
  });
  sessions.clear();

  httpServer.close(() => {
    log("Daemon stopped");
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
