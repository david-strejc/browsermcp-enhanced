#!/usr/bin/env node
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";

interface PendingRequest {
  originId?: string;
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timeout: NodeJS.Timeout;
}

interface Command {
  wireId: string;
  originId?: string;
  sessionId: string;
  type: string;
  name: string;
  payload: any;
  tabId?: string;
}

interface SessionRecord {
  sessionId: string;
  socket: WebSocket;
  pendingCmds: Map<string, PendingRequest>; // wireId → promise
  tabIds: string[];
  currentTabId?: string;
  busy: boolean;
  commandQueue: Command[];
  lastSeen: number;
}

// Global tab ownership tracking
const tabOwner = new Map<string, string>(); // tabId → sessionId

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
  let envelope: any;
  try {
    envelope = JSON.parse(rawData.toString());
  } catch (err) {
    warn(`Invalid JSON from session ${session.sessionId}:`, err);
    return;
  }

  session.lastSeen = Date.now();

  // Protocol v2: Extract fields from envelope
  const { wireId, sessionId, originId, type, data, payload, name } = envelope;

  // Handle response to command
  if (type === "response" && wireId) {
    // CRITICAL: Look up pending in the CORRECT session (use sessionId from envelope, not extension's session)
    const targetSession = sessionId ? sessions.get(sessionId) : session;
    const pending = targetSession?.pendingCmds.get(wireId);

    if (pending) {
      clearTimeout(pending.timeout);
      targetSession.pendingCmds.delete(wireId);
      // Learn and persist tab ownership/current tab from response
      try {
        const tabFromResponse = (data && (data.tabId ?? (data.payload && data.payload.tabId)))
          ?? envelope.tabId
          ?? (payload && (payload.tabId ?? payload.targetTabId));
        if (tabFromResponse != null && targetSession) {
          const tabKey = String(tabFromResponse);
          const owner = tabOwner.get(tabKey);
          if (!owner) {
            tabOwner.set(tabKey, targetSession.sessionId);
          }
          if (!targetSession.tabIds.includes(tabKey)) {
            targetSession.tabIds.push(tabKey);
          }
          targetSession.currentTabId = tabKey;
        }
      } catch {}

      pending.resolve(data ?? payload ?? envelope);
      return;
    } else {
      warn(`Received response for unknown wireId: ${wireId} in session ${sessionId || session.sessionId}`);
    }
  }

  // Handle legacy hello/ping for backward compatibility
  if (type === "hello") {
    session.socket.send(JSON.stringify({
      type: "helloAck",
      instanceId: session.sessionId,
      timestamp: Date.now(),
    }));
    return;
  }

  if (type === "ping") {
    session.socket.send(JSON.stringify({
      type: "pong",
      id: envelope.id,
      timestamp: Date.now(),
    }));
    return;
  }

  if (type === "connected") {
    return; // informational
  }

  // Handle unsolicited events (console, errors, etc.)
  if (type === "event") {
    const tabId = envelope.tabId ?? payload?.tabId;
    forwardToMcp(session.sessionId, tabId, {
      messageId: wireId ?? `daemon-${Date.now()}`,
      type: "event",
      name: name ?? "unknown",
      payload: payload ?? {},
      tabId,
      original: envelope,
    });
    return;
  }

  // Unknown message type
  warn(`Unknown message type from extension: ${type}`, envelope);
}

// Process next command in queue for a session
async function processQueue(session: SessionRecord) {
  if (session.busy || session.commandQueue.length === 0) {
    return;
  }

  const command = session.commandQueue.shift()!;
  session.busy = true;

  try {
    await executeCommand(session, command);
  } catch (err) {
    errorLog(`Failed to execute queued command:`, err);
  } finally {
    session.busy = false;
    processQueue(session); // Process next command
  }
}

// Execute a single command
async function executeCommand(session: SessionRecord, command: Command): Promise<any> {
  const { wireId, originId, sessionId, type, name, payload, tabId } = command;

  const timeoutMs = Number(payload.timeoutMs ?? COMMAND_TIMEOUT_MS);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      session.pendingCmds.delete(wireId);
      reject(new Error("Timed out waiting for extension response"));
    }, timeoutMs);

    session.pendingCmds.set(wireId, {
      originId,
      resolve,
      reject,
      timeout,
    });

    // Build Protocol v2 envelope
    const envelope = {
      wireId,
      originId,
      sessionId,
      type: "command",
      name,
      payload,
      ...(tabId ? { tabId } : {}),
    };

    try {
      session.socket.send(JSON.stringify(envelope));
    } catch (err) {
      const pending = session.pendingCmds.get(wireId);
      if (pending) {
        clearTimeout(pending.timeout);
        session.pendingCmds.delete(wireId);
      }
      reject(err);
    }
  });
}

async function handleCommandRequest(req: any, res: any, sessionId: string, tabId: string | undefined) {
  let session = sessions.get(sessionId);

  // Protocol v2: Session aliasing - if session doesn't exist, create it from existing connection
  if (!session || session.socket.readyState !== WebSocket.OPEN) {
    // Find ANY connected extension
    const connectedSessions = Array.from(sessions.values()).filter(
      s => s.socket.readyState === WebSocket.OPEN
    );

    if (connectedSessions.length > 0) {
      // Reuse the WebSocket connection, create new session record
      const existingSession = connectedSessions[0];
      log(`Creating new session ${sessionId} from existing connection ${existingSession.sessionId}`);

      session = {
        sessionId,
        socket: existingSession.socket, // REUSE same WebSocket!
        pendingCmds: new Map(),
        tabIds: [],
        currentTabId: undefined,
        busy: false,
        commandQueue: [],
        lastSeen: Date.now(),
      };

      sessions.set(sessionId, session);

      // TODO: Send message to extension to open new tab for this session
      log(`Session ${sessionId} registered, will use shared WebSocket`);
    } else {
      warn(`Command received for unknown session ${sessionId} and no extension connected`);
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No extension connected" }));
      return;
    }
  }

  // Tab ownership validation and auto-tab creation
  let useExplicitTab = true; // Track if we should use explicit tabId

  if (tabId) {
    const owner = tabOwner.get(tabId);
    if (owner && owner !== sessionId) {
      // Tab owned by another session - if this is a NEW session with no tabs, create new tab
      if (session.tabIds.length === 0) {
        log(`Tab ${tabId} owned by ${owner}, session ${sessionId} will create new tab`);
        tabId = undefined; // Clear tabId
        useExplicitTab = false; // Don't use currentTabId fallback
      } else {
        warn(`Tab ${tabId} is owned by session ${owner}, not ${sessionId}`);
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Tab owned by another session" }));
        return;
      }
    }

    // Claim tab ownership if not set
    if (tabId && !owner) {
      tabOwner.set(tabId, sessionId);
      if (!session.tabIds.includes(tabId)) {
        session.tabIds.push(tabId);
      }
      session.currentTabId = tabId;
    }
  }

  log(`Command for session ${sessionId} received at daemon (incoming tab: ${tabId ?? 'auto'})`);

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

  const originId = command.id ?? command.messageId;
  const messageType = command.type;

  if (originId === undefined || !messageType) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing id or type" }));
    return;
  }

  // Generate globally unique wireId
  const wireId = randomUUID();

  // Build command for queue - only use currentTabId fallback if we haven't explicitly cleared it
  const cmd: Command = {
    wireId,
    originId: String(originId),
    sessionId,
    type: "command",
    name: messageType,
    payload: command.payload ?? {},
    tabId: useExplicitTab ? (tabId ?? session.currentTabId) : tabId,
  };
  log(`Routing command`, { sessionId, name: messageType, wireId, selectedTab: cmd.tabId ?? 'auto', currentTab: session.currentTabId });

  // FIFO queue: if busy, enqueue; otherwise execute immediately
  if (session.busy) {
    session.commandQueue.push(cmd);
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "queued", wireId }));
    return;
  }

  session.busy = true;

  try {
    const result = await executeCommand(session, cmd);
    log(`Command resolved`, { sessionId, wireId, tabLearned: (result && (result as any).tabId) || session.currentTabId });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, payload: result }));
  } catch (err) {
    res.writeHead(504, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: (err as Error).message }));
  } finally {
    session.busy = false;
    processQueue(session); // Process next command if any
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
    existing.pendingCmds.forEach(({ reject, timeout }) => {
      clearTimeout(timeout);
      reject(new Error("Connection replaced"));
    });
    existing.socket.terminate();

    // Clean up tab ownership
    existing.tabIds.forEach(tabId => {
      const owner = tabOwner.get(tabId);
      if (owner === sessionId) {
        tabOwner.delete(tabId);
      }
    });
  }

  const record: SessionRecord = {
    sessionId,
    socket,
    pendingCmds: new Map(),
    tabIds: [],
    currentTabId: undefined,
    busy: false,
    commandQueue: [],
    lastSeen: Date.now(),
  };

  sessions.set(sessionId, record);

  socket.on("message", (data) => handleExtensionMessage(record, data));

  socket.on("close", () => {
    log(`Extension disconnected for session ${sessionId}`);

    // CRITICAL: Remove ALL sessions using this WebSocket (session aliasing!)
    const sessionsToDelete: string[] = [];
    sessions.forEach((session, sid) => {
      if (session.socket === socket) {
        sessionsToDelete.push(sid);
      }
    });

    sessionsToDelete.forEach(sid => {
      const session = sessions.get(sid);
      if (session) {
        log(`Cleaning up session ${sid} due to WebSocket close`);
        sessions.delete(sid);

        // Reject pending commands
        session.pendingCmds.forEach(({ reject, timeout }) => {
          clearTimeout(timeout);
          reject(new Error("Extension disconnected"));
        });

        // Clean up tab ownership
        session.tabIds.forEach(tabId => {
          const owner = tabOwner.get(tabId);
          if (owner === sid) {
            tabOwner.delete(tabId);
          }
        });
      }
    });
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
    session.pendingCmds.forEach(({ reject, timeout }) => {
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
  tabOwner.clear();

  httpServer.close(() => {
    log("Daemon stopped");
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
