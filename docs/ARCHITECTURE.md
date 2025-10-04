# LaskoBOT Architecture (Protocol v2)

## Components
- MCP HTTP server (port 3000): One process handles many Claude instances (sessions). Passes envelopes to the daemon.
- WebSocket daemon (port 8765): Single endpoint multiplexing all sessions. Delivers envelopes to the browser extension and resolves wireIds on responses.
- Browser extensions (Chrome/Firefox): One WebSocket per browser; many MCP sessions. Per‑session tab routing/ownership.

## Envelope
All messages flow as Protocol v2 envelopes:
- Command (daemon → extension):
  `{ wireId, sessionId, type:'command', name, payload, tabId? }`
- Response (extension → daemon):
  `{ wireId, sessionId, type:'response', data:{ …, tabId } }`
- Event (extension → daemon):
  `{ type:'event', sessionId, name, payload }`

## Session → Tab Ownership
- Each `sessionId` owns its tab(s). Extensions update `tabId` on every response.
- Daemon enforces ownership and learns `currentTabId` per session.

## Flow
1) Claude → MCP `/mcp` with `mcp-session-id` header (unique per Claude instance)
2) MCP → Daemon `/commands` with `X-Instance-ID: <sessionId>`
3) Daemon → Extension (WS) v2 envelope
4) Extension resolves tab (create if needed) and executes handler
5) Extension → Daemon response with tabId + optional event
6) Daemon resolves wireId and forwards logs/events to MCP

