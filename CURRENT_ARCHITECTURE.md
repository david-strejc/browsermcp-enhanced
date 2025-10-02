# BrowserMCP Enhanced — Current Architecture (Unified, Single-Daemon)

## Overview

This document captures the current, unified architecture of BrowserMCP Enhanced. The system has been refactored to a single-daemon, single-HTTP-server design with per-session routing and no legacy multi‑instance port scanning. The stack preserves two critical identifiers end‑to‑end:

- MCP Session ID — The canonical identifier returned during MCP initialization (exposed as an HTTP response header and reused by clients on subsequent requests).
- Tab ID — The browser tab context associated with a given Claude session and command stream.

The system consists of three cooperating components:

- MCP HTTP/SSE Server (single process) — Receives MCP requests from Claude via Streamable HTTP, manages sessions, tools, and per‑session state.
- WebSocket Daemon (single process) — Maintains one WebSocket per browser window/extension, correlates daemon commands with extension responses, and forwards unsolicited extension events back to the MCP server.
- Chrome Extension (single controller) — Connects a single WebSocket to the daemon and implements message handlers for navigation, JS execution, and other browser operations.

All traffic is local (localhost) by default.

---

## Components

### MCP HTTP/SSE Server

- Entry: `dist/index-http.js` (source: `src/index-http.ts`)
- Transport: `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk` (SSE + HTTP).
- Responsibilities:
  - Create and manage per‑session transports.
  - Route each HTTP/SSE request to the correct `InstanceRegistry` record by MCP Session ID.
  - Expose `/ws-message` for daemon → server event delivery.
  - Maintain session state (`Context`) including the current `tabId` and per‑session toolbox.
  - Emit MCP logging notifications for daemon events.

Key server files:
- `src/index-http.ts` — Per‑session transport creation, routing, headers, `/ws-message`, `/debug/session/:id`.
- `src/instance-registry.ts` — Simple in‑memory registry mapping `sessionId → { context, createdAt }`.
- `src/server.ts` — MCP server with capabilities enabled (tools, resources, logging) and tool dispatch to the active `Context`.

### WebSocket Daemon

- Entry: `dist/daemon/websocket-daemon.js` (source: `src/daemon/websocket-daemon.ts`)
- Exposes:
  - WS: `ws://localhost:<port>/session/<sessionId>` — one socket per browser window/extension.
  - HTTP: `POST /commands` — blocks until the extension replies to a WS message; `X-Instance-ID` and optional `X-Tab-ID` headers identify session and tab context.
  - HTTP: `GET /health` — readiness.
- Responsibilities:
  - Maintain a single WebSocket to the extension for each session.
  - Forward inbound HTTP commands to the extension with an `id` and `type`.
  - Resolve pending requests when the extension sends `type: "response", id: …` messages.
  - Forward unsolicited extension messages to the MCP server via `POST /ws-message`.

### Chrome Extension (Unified Controller)

- Service Worker: `chrome-extension/background.js`
  - Loads `unified-connection-manager.js` and `background-daemon.js`.
- `unified-connection-manager.js` — Persistent single WebSocket to daemon (`ws://localhost:8765/session/<instanceId>`).
- `background-daemon.js` — Clean message handlers (e.g., `browser_navigate`, `js.execute`, `browser_wait`, tab selection) with no legacy multi‑instance logic.
  - Uses `chrome.tabs.*` and `chrome.scripting.executeScript` to perform actions.

---

## Identifiers and Preservation

### MCP Session ID (Claude Instance)

- Creation:
  - First `initialize` request to `/mcp` returns a fresh `mcp-session-id` in the response header.
  - The MCP client (Claude CLI) uses this header on all subsequent requests.
  - The server enforces this: non‑initialize requests without a valid session header are rejected (400/404), and unknown session IDs return 404.

- Routing:
  - The server creates a dedicated `StreamableHTTPServerTransport` per session (identified by the returned session ID).
  - `InstanceRegistry` maps `sessionId → Context` and tracks lifetimes.

- Daemon Headers:
  - Daemon uses `X-Instance-ID: <sessionId>` for both `/commands` and `/ws-message` to correlate with the correct server session.

### Tab ID (Browser Context)

- Command Responses:
  - After a daemon command completes, `Context.sendSocketMessage` inspects the daemon JSON response; if a `tabId` is present, it persists to `Context.currentTabId` for subsequent commands.

- Event Bridge:
  - For unsolicited extension messages delivered to `/ws-message`, the server extracts `X-Tab-ID` or `payload.tabId` and updates `Context.currentTabId` accordingly.

- Propagation:
  - Future daemon commands include `X-Tab-ID` so the extension keeps operating in the correct tab context.

---

## Message Flows

### 1) Session Initialization (Claude → MCP HTTP)

1. Claude sends `initialize` to `POST /mcp`.
2. Server creates `sessionId` (UUID), spins up a per‑session transport, and returns `mcp-session-id: <sessionId>`.
3. Claude uses the session header on all subsequent requests.

### 2) Tool Call via Daemon (Claude → Server → Daemon → Extension)

1. Claude calls a tool (e.g., `browser_navigate`).
2. Server resolves the tool: `Context.sendSocketMessage` either uses the per‑session WebSocket (if present) or the daemon (`POST /commands`).
3. Daemon forwards the JSON to the extension WebSocket channel `/session/<sessionId>`, associates a pending promise with `id`.
4. Extension executes and replies: `{ type: "response", id, data: { …, tabId } }`.
5. Daemon resolves the HTTP `/commands` promise with `{ success: true, payload: … }`.
6. Server returns the tool result to Claude; `Context` persists any `tabId` for the next command.

### 3) Extension Events (Extension → Daemon → Server → Claude Log)

1. Extension sends an unsolicited message (e.g., console snapshot).
2. Daemon `POST /ws-message` with headers `X-Instance-ID` and optional `X-Tab-ID`.
3. Server enqueues and immediately drains the per‑session queue (updating `currentTabId`).
4. Server emits `notifications/message` (MCP logging) with `{ level, logger, data }` for visibility in Claude.

---

## Endpoints and Headers

### MCP HTTP Server

- `POST /mcp` — Streamable HTTP endpoint for MCP requests.
  - Initialization returns `mcp-session-id` in the response header.
  - Subsequent requests must include `mcp-session-id` in request headers.

- `POST /ws-message` — Daemon → server event bridge.
  - Required headers: `X-Instance-ID: <sessionId>`
  - Optional headers: `X-Tab-ID: <tabId>`
  - Body: JSON `{ messageId, type, payload }`
  - Returns 202 Accepted.

- `GET /debug/session/<sessionId>` — Debug only; returns session status (`currentTabId`, queue length). Enabled when `BROWSER_MCP_ENABLE_DEBUG=1`.

### WebSocket Daemon

- WS: `ws://localhost:8765/session/<sessionId>` — One per browser.
- HTTP: `GET /health` — Ready check.
- HTTP: `POST /commands` — Execute extension command.
  - Required headers: `X-Instance-ID: <sessionId>`
  - Optional headers: `X-Tab-ID: <tabId>`
  - Body: JSON `{ id, type, payload }`
  - Responses: `200 OK { success: true, payload }`, `404 Not Found` (no extension socket), or `504` (timeout waiting for extension response).

---

## Configuration

### Claude MCP (HTTP)

`~/.claude/mcp_servers.json`:

```
{
  "mcpServers": {
    "browsermcp": {
      "type": "http",
      "url": "http://127.0.0.1:3000/mcp"
    }
  }
}
```

### Environment Variables

- `BROWSER_MCP_ENABLE_DEBUG=1` — Enables `/debug/session/<id>` endpoint.
- `BROWSER_MCP_DAEMON_URL` — Server → daemon base URL for `/commands`.
- `BROWSER_MCP_DAEMON_PORT` — Daemon listener port (default 8765).
- `BROWSER_MCP_HTTP_URL` — Daemon → MCP server base URL (default `http://127.0.0.1:3000`).

---

## Development and Testing

### Build

```
npm run build
```

### Start (Manual)

```
# MCP HTTP server
BROWSER_MCP_ENABLE_DEBUG=1 node dist/index-http.js --port 3000

# WebSocket daemon
BROWSER_MCP_HTTP_URL=http://127.0.0.1:3000 \
BROWSER_MCP_DAEMON_PORT=8765 \
node dist/daemon/websocket-daemon.js
```

### Tests

- `node tests/session-id-http.test.js` — Verifies unique MCP session IDs per client and session reuse behavior.
- `node tests/http-ws-bridge.test.js` — Asserts `/ws-message` accepts and updates tab state; checks `/debug/session/<id>`.
- `node tests/unified-daemon-integration.test.js` — Validates daemon `/commands` round‑trip with a stub extension.
- `node tests/unified-daemon-e2e.test.js` — Full E2E: MCP → daemon → fake extension → responses (JS exec and navigate), with session/tab propagation.

---

## Security & Failure Modes

- Localhost‑only by default; consider adding token‑based auth for remote use.
- Session enforcement:
  - Unknown `mcp-session-id` → 404; no implicit session recreation for non‑init requests.
- Daemon errors:
  - Extension not connected → 404 on `/commands`.
  - Extension response timeout → 504 on `/commands`.
- Logging:
  - Only emits `notifications/message` with level/info when daemon messages arrive.

---

## Performance Notes

- Streamable HTTP supports SSE with backoff; server is non‑blocking for unrelated sessions.
- The daemon holds a single WebSocket per session, minimizing handshake overhead.
- Per‑session state is in memory; cleanup occurs on session close.

---

## Removed Legacy

- Deleted multi‑instance components:
  - `chrome-extension/multi-instance-manager.js`
  - `chrome-extension/background-multi-instance.js`
  - `chrome-extension/background-unified.js` (legacy wrapper)
- No port scanning. No per‑instance WebSocket servers inside the MCP HTTP server.

---

## Future Work

- Extend daemon controller with more handlers (click, type, select, screenshot) using a minimal selector/ref heuristic.
- Surface unsolicited extension events as MCP notifications beyond logging if needed.
- Optional: explicit auth between daemon and server; configurable allowlist for hosts.

