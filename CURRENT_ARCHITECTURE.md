# BrowserMCP Enhanced — Multi-Instance Architecture (Protocol v2)

## Overview

BrowserMCP Enhanced supports **unlimited concurrent Claude instances** controlling a single browser through a unified, session-multiplexed architecture. The system preserves session isolation while sharing browser resources efficiently.

**Core Principle:** ONE WebSocket connection, MANY Claude sessions multiplexed over it.

### Critical Identifiers

1. **MCP Session ID** (`sessionId`) — Unique UUID per Claude instance, created by MCP HTTP server, preserved end-to-end
2. **Wire ID** (`wireId`) — Daemon-generated UUID per command, prevents message ID collisions
3. **Origin ID** (`originId`) — Optional caller-supplied ID (for backward compatibility)
4. **Tab ID** (`tabId`) — Browser tab identifier, owned by exactly one session

---

## Architecture Components

### 1. Claude Desktop (Unmodified)
- **File:** `/usr/bin/claude` (minified, no modification needed)
- **MCP SDK:** `StreamableHTTPServerTransport`
- **Behavior:**
  - First request: No session header → MCP server generates UUID
  - Subsequent requests: Sends `mcp-session-id: <uuid>` header
  - Each Claude instance maintains its own session ID throughout conversation

### 2. MCP HTTP/SSE Server
- **Entry:** `dist/index-http.js` (source: `src/index-http.ts`)
- **Port:** 3000 (default)
- **Key Code:**
  ```typescript
  // Line 106-107: Read session from headers
  sessionIdFromHeaders(req): req.headers["mcp-session-id"] ?? req.headers["x-instance-id"]

  // Line 341-344: Create new session if none exists
  if (!session) {
    sessionId = randomUUID();  // Each Claude gets unique UUID
    session = await createSession(sessionId);
  }

  // Line 144-148: Session-specific context
  const context = new Context();
  context.instanceId = sessionId;  // SESSION ID = INSTANCE ID
  context.toolbox = toolbox;
  ```

- **Responsibilities:**
  - Create unique `sessionId` per Claude instance (line 342)
  - Route requests to correct session via `sessions: Map<SessionId, SessionState>` (line 157)
  - Forward daemon messages to session-specific transport (line 171-174)
  - Maintain per-session `Context` with current `tabId` (line 167)

### 3. WebSocket Daemon (REFACTORED for v2)
- **Entry:** `dist/daemon/websocket-daemon.js` (source: `src/daemon/websocket-daemon.ts`)
- **Port:** 8765 (WebSocket) + HTTP `/commands`, `/health`
- **NEW Data Structures:**
  ```typescript
  interface SessionRecord {
    sessionId: string;           // MCP session ID (from X-Instance-ID header)
    socket: WebSocket;           // THE SINGLE shared WebSocket
    pendingCmds: Map<wireId, {  // Per-session pending (NO collisions)
      originId: string,
      resolve: Function,
      reject: Function,
      timeout: NodeJS.Timeout
    }>;
    tabIds: number[];           // Tabs owned by this session
    currentTabId?: number;      // Last-focused tab
    busy: boolean;              // FIFO queue lock
    commandQueue: Command[];    // FIFO command queue
  }

  const sessions = Map<sessionId, SessionRecord>;
  const tabOwner = Map<tabId, sessionId>;  // Global tab ownership
  ```

- **Protocol v2 Envelope:** (ALL messages)
  ```json
  {
    "wireId": "uuid-v4",           // Daemon-generated, globally unique
    "originId": "123",             // Optional: caller's ID
    "sessionId": "7f2d...",        // MCP session ID (ALWAYS present)
    "type": "command|response|event",
    "name": "browser_navigate|click|console|...",
    "payload": { ... },
    "tabId": 42                    // Optional: target tab
  }
  ```

- **Key Behaviors:**
  - **Session Routing (FIXED):**
    ```typescript
    // Line 120-140: NO FALLBACK - exact session match only
    async function handleCommandRequest(req, res, sessionId, tabId) {
      const session = sessions.get(sessionId);  // Must exist
      if (!session || session.socket.readyState !== OPEN) {
        res.writeHead(404, "Session not connected");
        return;
      }
      // Generate wireId, enqueue command...
    }
    ```

  - **Tab Ownership Validation:**
    ```typescript
    const owner = tabOwner.get(tabId);
    if (owner && owner !== sessionId) {
      res.writeHead(409, "Tab owned by another session");
      return;
    }
    ```

  - **FIFO Per-Session Queue:**
    ```typescript
    if (session.busy) {
      session.commandQueue.push(command);
      return;
    }
    session.busy = true;
    await executeCommand(command);
    session.busy = false;
    processQueue(session);  // Next command
    ```

### 4. Chrome Extension (REFACTORED for v2)
- **Service Worker:** `chrome-extension/background.js`
- **Connection Manager:** `chrome-extension/unified-connection-manager.js`
- **NEW Data Structures:**
  ```javascript
  // ONE WebSocket, MANY sessions
  const ws = new WebSocket('ws://localhost:8765/session/<extensionId>');
  const tabForSession = Map<sessionId, tabId[]>;  // Session → Tabs
  ```

- **Message Handling:**
  ```javascript
  ws.onmessage = (evt) => {
    const envelope = JSON.parse(evt.data);
    const { wireId, sessionId, type, name, payload, tabId } = envelope;

    if (type === 'command') {
      // Execute command in session's tab
      const targetTab = tabId || getSessionTab(sessionId);
      executeInTab(targetTab, name, payload).then(result => {
        ws.send(JSON.stringify({
          wireId,           // ECHO back
          sessionId,        // ECHO back
          originId: payload.originId,
          type: 'response',
          data: result
        }));
      });
    }
  };
  ```

- **Tab Management:**
  ```javascript
  function getSessionTab(sessionId) {
    let tabs = tabForSession.get(sessionId);
    if (!tabs || tabs.length === 0) {
      // Create first tab for session
      chrome.tabs.create({}, (tab) => {
        tabForSession.set(sessionId, [tab.id]);
        tabOwner.set(tab.id, sessionId);
      });
    }
    return tabs[tabs.length - 1];  // Last-focused
  }
  ```

---

## Complete Data Flow Diagram

```
┌─────────────────┐
│ Claude Desktop 1│ sessionId: 7f2d...
└────────┬────────┘
         │ HTTP POST /mcp
         │ Header: mcp-session-id: 7f2d...
         ▼
┌─────────────────────────────────────────┐
│     MCP HTTP Server (port 3000)         │
│  sessions.get("7f2d...") → SessionState │
│  context.instanceId = "7f2d..."         │
└─────────────────┬───────────────────────┘
                  │ POST /commands
                  │ X-Instance-ID: 7f2d...
                  ▼
┌─────────────────────────────────────────────────┐
│   WebSocket Daemon (port 8765)                  │
│                                                  │
│   sessions.get("7f2d...") → {                   │
│     socket: ws (THE SINGLE WebSocket)           │
│     pendingCmds: Map<wireId, Promise>           │
│     tabIds: [42],                               │
│     currentTabId: 42,                           │
│     busy: false,                                │
│     commandQueue: []                            │
│   }                                             │
│                                                  │
│   Generate wireId = uuid()                      │
│   Check: tabOwner[42] === "7f2d..." ✓          │
│                                                  │
│   Envelope = {                                  │
│     wireId: "abc-123...",                       │
│     originId: "1",                              │
│     sessionId: "7f2d...",                       │
│     type: "command",                            │
│     name: "browser_navigate",                   │
│     payload: { url: "..." },                    │
│     tabId: 42                                   │
│   }                                             │
└─────────────────┬───────────────────────────────┘
                  │ WebSocket (multiplexed)
                  ▼
┌─────────────────────────────────────────────────┐
│   Chrome Extension                               │
│   (ONE WebSocket, receives ALL sessions)         │
│                                                  │
│   Parse envelope → sessionId: "7f2d..."         │
│   tabForSession.get("7f2d...") → [42]           │
│   Execute in Tab 42                             │
│                                                  │
│   chrome.tabs.update(42, { url: "..." })        │
│                                                  │
│   Send Response:                                │
│   {                                             │
│     wireId: "abc-123...",  // ECHOED           │
│     sessionId: "7f2d...",  // ECHOED           │
│     originId: "1",                              │
│     type: "response",                           │
│     data: { success: true, tabId: 42 }         │
│   }                                             │
└─────────────────┬───────────────────────────────┘
                  │ WebSocket
                  ▼
┌─────────────────────────────────────────────────┐
│   Daemon: Resolve pendingCmds["abc-123..."]    │
│   Return to MCP session "7f2d..."               │
└─────────────────┬───────────────────────────────┘
                  │ HTTP Response
                  ▼
┌─────────────────────────────────────────────────┐
│   MCP Server: sessions.get("7f2d...")          │
│   Update context.currentTabId = 42              │
│   Return to Claude 1                            │
└─────────────────────────────────────────────────┘


┌─────────────────┐
│ Claude Desktop 2│ sessionId: a3b1... (DIFFERENT)
└────────┬────────┘
         │ Same flow, DIFFERENT sessionId
         │ DIFFERENT tab (43), NO interference
         ▼
     [Parallel execution, isolated by sessionId]
```

---

## Session Lifecycle

### Session Creation (First Request)
1. Claude sends HTTP POST to `/mcp` (no session header)
2. MCP server: `sessionId = randomUUID()` (line 342 in index-http.ts)
3. Creates `SessionState` with unique transport (line 191-213)
4. Returns session ID to Claude via response header
5. Claude includes `mcp-session-id` header on ALL subsequent requests

### Command Execution Flow
1. **Claude → MCP:** Tool call with `mcp-session-id` header
2. **MCP → Daemon:** POST `/commands` with `X-Instance-ID: <sessionId>`
3. **Daemon:**
   - Lookup: `session = sessions.get(sessionId)`
   - Generate: `wireId = uuid()`
   - Validate: Tab ownership (409 if owned by different session)
   - Enqueue: Add to session's FIFO queue if busy
   - Send: Envelope via WebSocket
4. **Extension:**
   - Parse envelope, extract `sessionId`
   - Get tab: `tabForSession.get(sessionId)` or create new
   - Execute command
   - Reply with SAME `wireId` + `sessionId`
5. **Daemon:**
   - Match: `pendingCmds.get(wireId)`
   - Resolve promise
   - POST to MCP: `/ws-message` with `X-Instance-ID: <sessionId>`
6. **MCP → Claude:** Return result via session-specific transport

### Tab Assignment
- **Default (no tabId specified):**
  - Use `sessions[sessionId].currentTabId` (last-focused)
  - If none: Create new tab, add to `sessions[sessionId].tabIds[]`

- **Explicit tabId:**
  - Validate: `tabOwner[tabId] === sessionId` (409 if not)
  - Update: `sessions[sessionId].currentTabId = tabId`

- **Tab Creation:**
  ```typescript
  // Daemon sends to extension
  { type: "createTab", sessionId: "7f2d..." }

  // Extension creates and replies
  chrome.tabs.create({}, (tab) => {
    tabForSession.get("7f2d...").push(tab.id);
    reply({ tabId: tab.id });
  });

  // Daemon updates
  tabOwner.set(tabId, sessionId);
  sessions[sessionId].tabIds.push(tabId);
  ```

### Session Cleanup
- **Graceful disconnect:** Close all `sessions[sessionId].tabIds` immediately
- **Unexpected disconnect:**
  - Mark session "orphaned"
  - Start 5-minute grace period
  - If reconnect: Re-attach session to new socket
  - If timeout: Close tabs, delete session

---

## Key Implementation Files

### Daemon Changes (src/daemon/websocket-daemon.ts)
- **Line 22:** `sessions = Map<sessionId, SessionRecord>`
- **Line 120-140:** Session routing with NO fallback
- **Line 177-188:** Generate `wireId`, build envelope
- **Line 242-259:** WebSocket connection uses extension's persistent ID
- **Line 284:** Extension message handler extracts `sessionId` from envelope

### Extension Changes (chrome-extension/)
- **background.js:50-55:** Single `bootstrap()` on activate only
- **unified-connection-manager.js:113:** Connect with persistent `extensionId`
- **background-daemon.js (NEW):**
  - `tabForSession` map
  - `handleCommand()` with sessionId routing
  - `createTab()` handler
  - Echo `sessionId` in all responses

### MCP Server (src/index-http.ts)
- **Line 106-107:** `sessionIdFromHeaders()` reads from Claude
- **Line 342:** Create unique sessionId per Claude instance
- **Line 145:** `context.instanceId = sessionId` (critical!)
- **Line 230:** Daemon bridge validates sessionId
- **Line 157:** `sessions: Map<SessionId, SessionState>` for isolation

---

## Protocol v2 Message Examples

### Command (Daemon → Extension)
```json
{
  "wireId": "f3a2c1b0-...",
  "originId": "42",
  "sessionId": "7f2d946a-...",
  "type": "command",
  "name": "browser_navigate",
  "payload": { "url": "https://google.com" },
  "tabId": 123
}
```

### Response (Extension → Daemon)
```json
{
  "wireId": "f3a2c1b0-...",
  "originId": "42",
  "sessionId": "7f2d946a-...",
  "type": "response",
  "data": { "success": true, "tabId": 123, "url": "https://google.com" }
}
```

### Unsolicited Event (Extension → Daemon → MCP)
```json
{
  "wireId": "e8d7...",
  "sessionId": "7f2d946a-...",
  "type": "event",
  "name": "console",
  "payload": { "level": "error", "message": "Script error", "tabId": 123 }
}
```

---

## Multi-Instance Guarantees

✅ **Isolation:** Each session has own pending map, tab list, command queue
✅ **No Collisions:** `wireId` globally unique, replaces numeric message IDs
✅ **Correct Routing:** `sessionId` preserved in every message
✅ **Tab Ownership:** 409 error if session tries to access another's tab
✅ **FIFO Ordering:** Per-session queue prevents race conditions
✅ **Scalability:** Unlimited Claude instances, single WebSocket

---

## Migration from v1

### v1 (BROKEN - Current)
```typescript
// Extension generates own ID, daemon falls back to ANY session
session = sessions.get(extensionId) || sessions.values()[0];  // WRONG!
```

### v2 (CORRECT - New)
```typescript
// Daemon uses MCP sessionId, strict validation
session = sessions.get(mcpSessionId);  // Must exist or 404
if (!session) throw "Session not connected";
```

**Breaking Changes:**
- Message format: Add `wireId`, `sessionId` to all frames
- Daemon: Remove fallback routing
- Extension: Echo `sessionId` in responses
- Tab management: Per-session ownership

**Backward Compatibility:** None. Clean break for correctness.

---

## Testing Multi-Instance

### Setup
1. Start MCP HTTP server: `node dist/index-http.js`
2. Start WebSocket daemon: `node dist/daemon/websocket-daemon.js`
3. Load extension in Chrome Canary
4. Open two Claude Desktop instances

### Test Cases
1. **Parallel Navigation:**
   - Claude 1: "Navigate to google.com"
   - Claude 2: "Navigate to github.com"
   - **Expected:** Each gets own tab, no interference

2. **Tab Isolation:**
   - Claude 1: "Click the search button" (tab 42)
   - Claude 2: "Click the search button" (tab 43)
   - **Expected:** Commands execute in correct tabs

3. **Event Routing:**
   - Tab 42 has console error
   - **Expected:** Only Claude 1 sees the error log

4. **Session Reconnect:**
   - Kill Claude 1's session
   - Restart within 5 minutes
   - **Expected:** Tab 42 still owned, state preserved

---

## References

- **o3 Design Consultation:** Continuation ID `e3cc65c0-dae6-4713-9815-a68c35ee4649`
- **MCP SDK:** `@modelcontextprotocol/sdk` StreamableHTTPServerTransport
- **WebSocket:** `ws` library for Node.js
- **Chrome Extension API:** manifest v3, service worker architecture
