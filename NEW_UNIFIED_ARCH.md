# New Unified Architecture - Complete Design

## Overview

A complete redesign of the browser MCP architecture using a **single shared WebSocket server daemon** managed by systemd, serving multiple Claude Desktop instances.

---

## Architecture Components

```
┌─────────────────────────────────────────────────────────────────┐
│                    Claude Desktop (Multiple Instances)           │
│                                                                   │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐                   │
│  │ Claude #1 │  │ Claude #2 │  │ Claude #3 │                   │
│  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘                   │
│        │              │              │                            │
│    HTTP/SSE      HTTP/SSE      HTTP/SSE                         │
│        │              │              │                            │
└────────┼──────────────┼──────────────┼────────────────────────────┘
         │              │              │
         ▼              ▼              ▼
    ┌────────────────────────────────────────────────────────────┐
    │   MCP HTTP/SSE Server - SINGLE PROCESS (port 3000)         │
    │                                                             │
    │   Socket-based instance detection:                         │
    │   - TCP Socket A → Instance ID: abc → Tab ID: 1            │
    │   - TCP Socket B → Instance ID: def → Tab ID: 2            │
    │   - TCP Socket C → Instance ID: ghi → Tab ID: 3            │
    │                                                             │
    │   Tab Management:                                          │
    │   instanceTabMap: { abc→1, def→2, ghi→3 }                 │
    │   tabOwnerMap:    { 1→abc, 2→def, 3→ghi }                 │
    │   Tab locks managed server-side                            │
    └────────────────────┬───────────────────────────────────────┘
                         │
                         │ HTTP POST to /ws-message
                         │ Headers: X-Instance-ID, X-Tab-ID
                         │
                         ▼
         ┌────────────────────────────────────────────────┐
         │  WebSocket Daemon (systemd service)            │
         │  Port 8765 (single listener)                   │
         │                                                 │
         │  Routes messages by tab ID:                    │
         │  - Receives from MCP with tabId                │
         │  - Forwards to extension with tabId            │
         │  - Returns responses to MCP                    │
         │                                                 │
         │  Single WebSocket to extension                 │
         └────────────────────┬───────────────────────────┘
                              │
                              │ WebSocket (port 8765)
                              │ Single connection
                              │
                              ▼
                   ┌──────────────────────────┐
                   │  Chrome Browser Window   │
                   │  (ONE window)            │
                   │                          │
                   │  Extension connected:    │
                   │  ws://localhost:8765     │
                   │                          │
                   │  ┌─────────────────────┐ │
                   │  │ Tab 1: google.com   │ │ ← Claude #1 (abc)
                   │  ├─────────────────────┤ │
                   │  │ Tab 2: github.com   │ │ ← Claude #2 (def)
                   │  ├─────────────────────┤ │
                   │  │ Tab 3: stackoverflow│ │ ← Claude #3 (ghi)
                   │  └─────────────────────┘ │
                   └──────────────────────────┘
```

---

## Component Details

### 1. WebSocket Daemon (NEW)

**File:** `src/daemon/websocket-daemon.ts`

**Purpose:**
- Single WebSocket server listening on port 8765
- Runs as systemd service (always running)
- Routes messages between browser extensions and MCP instances
- Manages session lifecycle

**Key Features:**
- Accepts WebSocket connections: `ws://localhost:8765/session/<instanceId>`
- Maintains Unix socket connections to MCP instances
- Routes messages based on session ID in URI
- No MCP business logic - pure routing layer

**Message Flow:**
```
Browser Extension → WebSocket (port 8765)
                  ↓
        WebSocket Daemon (route by instanceId)
                  ↓
        Unix Socket (/tmp/browsermcp-<instanceId>.sock)
                  ↓
        MCP Server Instance (has all handlers)
```

**Systemd Service:**
```ini
[Unit]
Description=BrowserMCP WebSocket Daemon
After=network.target

[Service]
Type=simple
User=david
ExecStart=/usr/bin/node /home/david/.local/lib/browsermcp-enhanced/dist/daemon/websocket-daemon.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

---

### 2. MCP Server Instances

**File:** `src/index-unified-client.ts`

**Purpose:**
- Spawned by Claude Desktop via stdio transport
- Contains all browser automation handlers (30+ handlers)
- Connects to WebSocket daemon via Unix socket
- Each instance has unique ID from `MCP_INSTANCE_ID` env var

**Connection Flow:**
```typescript
1. Claude Desktop spawns: node index-unified-client.js
2. Read MCP_INSTANCE_ID from environment (set by Claude Desktop)
3. Connect to daemon: /tmp/browsermcp-<instanceId>.sock
4. Register with daemon: { type: 'register', instanceId: '...' }
5. Handle messages from daemon: execute handlers, send responses
```

**Key Responsibilities:**
- Execute browser automation commands (navigate, click, snapshot, etc.)
- Manage per-instance state (active tab, tab locks)
- Send responses back through Unix socket → daemon → WebSocket → extension

**NO WebSocket Server Creation:**
- Does NOT create any WebSocket servers
- Does NOT bind to TCP ports
- Only creates Unix socket client connection to daemon

---

### 3. Chrome Extension (Updated)

**File:** `chrome-extension/unified-connection-manager.js`

**Connection:**
- Connects to: `ws://localhost:8765/session/<instanceId>`
- Instance ID: Generated by extension, stored in chrome.storage.local
- Single WebSocket connection per browser window

**Changes Needed:**
- Remove port scanning (only port 8765)
- Include instance ID in WebSocket URI path
- All messages include instance ID in payload

---

## Inter-Process Communication (IPC)

### WebSocket Daemon ↔ MCP Instance

**Transport:** Unix Domain Sockets

**Socket Path:** `/tmp/browsermcp-<instanceId>.sock`

**Protocol:** JSON messages over Unix socket

**Message Format:**
```json
{
  "id": "msg-12345",
  "type": "command" | "response" | "register" | "unregister",
  "instanceId": "abc-123",
  "payload": { ... }
}
```

**Registration Flow:**
```
MCP Instance                    WebSocket Daemon
     │                                │
     │  1. Connect Unix socket        │
     ├───────────────────────────────>│
     │                                │
     │  2. Register message           │
     │  { type: 'register',           │
     │    instanceId: 'abc-123' }     │
     ├───────────────────────────────>│
     │                                │
     │  3. Registration ACK           │
     │<───────────────────────────────┤
     │                                │
     │  4. Ready to receive messages  │
```

---

## Message Routing

### Browser Extension → MCP Instance

```
1. Extension sends WebSocket message to ws://localhost:8765/session/abc-123
   Message: {
     id: "req-001",
     type: "browser_navigate",
     payload: { url: "https://example.com" }
   }

2. Daemon receives WebSocket message
   - Extract session ID from URI: "abc-123"
   - Lookup Unix socket for instance "abc-123"

3. Daemon forwards to Unix socket /tmp/browsermcp-abc-123.sock
   Message: {
     id: "req-001",
     type: "browser_navigate",
     instanceId: "abc-123",
     payload: { url: "https://example.com" }
   }

4. MCP instance executes handler
   - Execute browser_navigate handler
   - Get result: { success: true, url: "https://example.com" }

5. MCP instance sends response to Unix socket
   Message: {
     id: "req-001",
     type: "response",
     instanceId: "abc-123",
     payload: { success: true, ... }
   }

6. Daemon receives Unix socket message
   - Lookup WebSocket connection for "abc-123"

7. Daemon sends to WebSocket
   Message: {
     id: "req-001",
     type: "response",
     payload: { success: true, ... }
   }

8. Extension receives response
```

---

## File Structure

```
src/
├── daemon/
│   ├── websocket-daemon.ts          # WebSocket server daemon (NEW)
│   ├── unix-socket-server.ts        # Unix socket listener (NEW)
│   └── message-router.ts            # Route messages by instanceId (NEW)
│
├── index-unified-client.ts          # MCP instance (replaces index-unified.ts)
├── unified-ipc-client.ts            # Unix socket client for MCP instance (NEW)
└── tools/
    └── ... (existing 30+ handlers)

chrome-extension/
├── unified-connection-manager.js    # Updated: connect to single port
└── background-unified.js            # Updated: no multi-instance delegation

systemd/
└── browsermcp-daemon.service        # Systemd service file (NEW)
```

---

## Implementation Plan

### Phase 1: WebSocket Daemon

**Create:**
1. `src/daemon/websocket-daemon.ts` - Main daemon process
   - Create WebSocket server on port 8765
   - Accept connections with session ID in URI
   - Maintain session map: `instanceId → WebSocket`

2. `src/daemon/unix-socket-server.ts` - Unix socket listener
   - Listen for MCP instance connections
   - Accept connections on `/tmp/browsermcp-<instanceId>.sock`
   - Maintain instance map: `instanceId → UnixSocket`

3. `src/daemon/message-router.ts` - Message routing logic
   - Route WebSocket messages → Unix socket
   - Route Unix socket messages → WebSocket
   - Handle registration/unregistration

**Build:**
```bash
npm run build:daemon
```

**Test:**
```bash
node dist/daemon/websocket-daemon.js
# Should start and listen on port 8765
```

---

### Phase 2: MCP Client Instance

**Create:**
1. `src/index-unified-client.ts` - MCP instance entry point
   - Read `MCP_INSTANCE_ID` from environment
   - Create stdio transport for Claude Desktop
   - Connect to daemon via Unix socket
   - Register all tool handlers

2. `src/unified-ipc-client.ts` - Unix socket client
   - Connect to `/tmp/browsermcp-<instanceId>.sock`
   - Send registration message
   - Handle incoming messages from daemon
   - Send responses back through socket

**Reuse:**
- All existing handlers from `background-multi-instance.js`
- Context management
- Tool execution logic

---

### Phase 3: Extension Updates

**Update:**
1. `chrome-extension/unified-connection-manager.js`
   - Remove port scanning logic
   - Connect to `ws://localhost:8765/session/<instanceId>`
   - Generate and persist instance ID

2. `chrome-extension/background-unified.js`
   - Remove MultiInstanceManager delegation
   - Use UnifiedConnectionManager directly
   - Forward all messages through WebSocket

---

### Phase 4: Systemd Integration

**Create:**
1. `systemd/browsermcp-daemon.service`
   ```ini
   [Unit]
   Description=BrowserMCP WebSocket Daemon
   After=network.target

   [Service]
   Type=simple
   User=david
   ExecStart=/usr/bin/node /home/david/.local/lib/browsermcp-enhanced/dist/daemon/websocket-daemon.js
   Restart=always
   RestartSec=3
   StandardOutput=journal
   StandardError=journal

   [Install]
   WantedBy=multi-user.target
   ```

2. Installation script
   ```bash
   sudo cp systemd/browsermcp-daemon.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable browsermcp-daemon
   sudo systemctl start browsermcp-daemon
   ```

---

### Phase 5: Claude Desktop Configuration

**Update:** `~/.claude/mcp_servers.json`
```json
{
  "mcpServers": {
    "browsermcp": {
      "command": "node",
      "args": [
        "/home/david/.local/lib/browsermcp-enhanced/dist/index-unified-client.js"
      ],
      "env": {
        "MCP_INSTANCE_ID": "auto-generated-by-claude-desktop"
      }
    }
  }
}
```

Note: Claude Desktop should auto-generate unique instance IDs per process.

---

## Benefits

### 1. True Single Port Architecture
- ✅ Only ONE process listens on port 8765
- ✅ No port conflicts between instances
- ✅ Unlimited Claude Desktop instances

### 2. Clean Separation of Concerns
- **Daemon:** Pure routing layer (no business logic)
- **MCP Instance:** All browser automation logic
- **Extension:** Simple WebSocket client

### 3. Systemd Integration
- ✅ Daemon starts on boot
- ✅ Auto-restart on crash
- ✅ Centralized logging (journalctl)

### 4. Scalability
- ✅ Scales to 100+ concurrent instances
- ✅ Each instance isolated via Unix socket
- ✅ No hardcoded limits

### 5. Reliability
- ✅ Daemon crash doesn't affect MCP instances
- ✅ MCP instance crash doesn't affect daemon
- ✅ Clean reconnection handling

---

## Testing Plan

### Unit Tests

1. **Daemon:**
   - WebSocket connection handling
   - Unix socket connection handling
   - Message routing by instance ID
   - Session lifecycle (register/unregister)

2. **MCP Client:**
   - Unix socket connection
   - Registration flow
   - Message handler execution
   - Response sending

3. **Extension:**
   - WebSocket connection to single port
   - Instance ID in URI
   - Message sending/receiving

### Integration Tests

1. **Single Instance:**
   - Start daemon
   - Start one MCP instance
   - Connect extension
   - Execute browser automation command
   - Verify response

2. **Multiple Instances:**
   - Start daemon
   - Start 3 MCP instances (different instance IDs)
   - Connect 3 extensions (different session IDs)
   - Execute commands in parallel
   - Verify correct routing to each instance

3. **Failure Scenarios:**
   - Kill daemon → verify auto-restart
   - Kill MCP instance → verify clean disconnection
   - Close extension → verify session cleanup
   - Start MCP before daemon → verify retry logic

### Performance Tests

1. **Throughput:**
   - Measure messages/sec through daemon
   - Target: 1000+ msgs/sec

2. **Latency:**
   - Measure round-trip time (extension → MCP → extension)
   - Target: <10ms

3. **Concurrency:**
   - Test with 10+ concurrent instances
   - Verify no message mixing

---

## Deployment

### Development

```bash
# 1. Build daemon
npm run build:daemon

# 2. Start daemon manually
node dist/daemon/websocket-daemon.js

# 3. Start Claude Desktop (spawns MCP instances)
# 4. Extension auto-connects
```

### Production

```bash
# 1. Build all
npm run build

# 2. Deploy files
./scripts/deploy

# 3. Install systemd service
sudo cp systemd/browsermcp-daemon.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable browsermcp-daemon
sudo systemctl start browsermcp-daemon

# 4. Restart Claude Desktop
# Extension auto-connects to daemon
```

---

## Rollback Strategy

If unified mode fails, revert to multi-instance:

```json
{
  "browsermcp": {
    "command": "node",
    "args": [
      "/home/david/.local/lib/browsermcp-enhanced/dist/index-multi.js"
    ]
  }
}
```

Extension will auto-detect and fall back to port scanning.

---

## Migration from Multi-Instance

### Daemon Not Running

If daemon isn't running:
1. Extension attempts connection to port 8765
2. Gets ERR_CONNECTION_REFUSED
3. Falls back to port scanning (8765-8775)
4. Connects to multi-instance servers

### Gradual Migration

1. Deploy daemon (systemd)
2. Deploy updated extension (supports both modes)
3. Update one Claude instance to unified-client
4. Test thoroughly
5. Update remaining Claude instances
6. Remove multi-instance code

---

## Security Considerations

### Unix Socket Permissions

```bash
# Daemon creates sockets with user-only permissions
chmod 0600 /tmp/browsermcp-*.sock
```

### WebSocket Authentication

- No authentication (localhost only)
- Consider adding token-based auth if exposing outside localhost

### Instance ID Security

- Generate cryptographically secure instance IDs
- Validate instance ID format before routing

---

## Monitoring & Debugging

### Systemd Logs

```bash
# View daemon logs
sudo journalctl -u browsermcp-daemon -f

# View recent errors
sudo journalctl -u browsermcp-daemon --since "1 hour ago" -p err
```

### Daemon Status

```bash
# Check if running
systemctl status browsermcp-daemon

# Check port binding
lsof -i :8765

# Check Unix sockets
ls -la /tmp/browsermcp-*.sock
```

### Debug Mode

```bash
# Start daemon with debug logging
DEBUG=browsermcp:* node dist/daemon/websocket-daemon.js
```

---

## Open Questions

1. **Instance ID Generation:**
   - Does Claude Desktop provide MCP_INSTANCE_ID env var?
   - If not, how do we generate stable instance IDs?

2. **Connection Lifecycle:**
   - How to detect when Claude Desktop closes?
   - Should daemon clean up sockets immediately or keep alive for reconnection?

3. **Error Handling:**
   - What happens if Unix socket connection breaks?
   - Should MCP instance retry or exit?

4. **Backwards Compatibility:**
   - Should we maintain multi-instance mode?
   - For how long?

---

## Next Steps

1. ✅ **DONE:** Document architecture (this file)
2. **TODO:** Implement WebSocket daemon
3. **TODO:** Implement MCP unified client
4. **TODO:** Update Chrome extension
5. **TODO:** Create systemd service
6. **TODO:** Write tests
7. **TODO:** Deploy and test with real Claude Desktop
8. **TODO:** Measure performance
9. **TODO:** Production deployment

---

## Estimated Effort

- **Daemon Implementation:** 1-2 days
- **MCP Client Update:** 1 day
- **Extension Update:** 0.5 days
- **Testing:** 1 day
- **Systemd Integration:** 0.5 days
- **Documentation:** 0.5 days

**Total:** ~5 days of focused development

---

## Success Criteria

- ✅ Single WebSocket server on port 8765
- ✅ Supports 10+ concurrent Claude instances
- ✅ No port scanning in extension
- ✅ Round-trip latency <10ms
- ✅ Clean graceful shutdown
- ✅ Auto-restart on failure
- ✅ Backward compatible extension

---

## CORRECTED Architecture Flow

### 1. MCP HTTP/SSE Server (SINGLE PROCESS)

**File:** Based on `src/index-http.ts`

**Purpose:**
- Single HTTP server on port 3000 serving ALL Claude Desktop instances
- Uses HTTP/SSE transport (NOT stdio!)
- Socket-based instance detection (like current index-http.ts)
- Maintains context per TCP socket connection

**Key Points:**
- Runs as: `node dist/index-http-unified.js --port 3000`
- Each Claude Desktop maintains persistent HTTP/SSE connection
- Instance ID derived from TCP socket (WeakMap<Socket, instanceId>)
- Connects to WebSocket daemon to get browser extension messages

**Configuration:**
```json
{
  "mcpServers": {
    "browsermcp": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

---

### 2. WebSocket Daemon (systemd service)

**File:** `src/daemon/websocket-daemon.ts`

**Purpose:**
- WebSocket server on port 8765
- Routes browser extension messages to MCP HTTP server
- Routes MCP responses back to browser extensions

**Communication with MCP:**
- MCP server registers endpoint: `http://localhost:3000/ws-message`
- Daemon POSTs messages to MCP with instance ID
- MCP responds with result
- Daemon forwards to browser extension via WebSocket

**Message Flow:**
```
Browser Extension
    ↓ WebSocket (ws://localhost:8765/session/abc)
WebSocket Daemon
    ↓ HTTP POST (localhost:3000/ws-message)
    ↓ Headers: X-Instance-ID: abc
    ↓ Body: { type: "browser_navigate", payload: {...} }
MCP HTTP Server
    ↓ Execute handler for instance "abc"
    ↓ Return response
WebSocket Daemon
    ↓ WebSocket send
Browser Extension
```

---

### 3. Chrome Extension (unchanged architecture)

Connects to `ws://localhost:8765/session/<instanceId>` as documented.

---

## Simplified Implementation

### Phase 1: Extend index-http.ts

1. Add WebSocket message endpoint to existing HTTP server:
```typescript
// src/index-http-unified.ts (extends index-http.ts)

app.post('/ws-message', async (req, res) => {
  const instanceId = req.headers['x-instance-id'];
  const context = getContextByInstanceId(instanceId);
  
  if (!context) {
    return res.status(404).json({ error: 'Instance not found' });
  }
  
  const { type, payload, messageId } = req.body;
  
  // Execute handler
  const result = await executeHandler(context, type, payload);
  
  res.json({ 
    success: true, 
    messageId,
    result 
  });
});
```

2. Maintain instanceId → context mapping
3. Use existing socket-based detection

### Phase 2: WebSocket Daemon

```typescript
// src/daemon/websocket-daemon.ts

const wss = new WebSocketServer({ port: 8765 });
const MCP_URL = 'http://localhost:3000';

wss.on('connection', (ws, req) => {
  const instanceId = extractInstanceId(req.url); // From /session/<id>
  
  ws.on('message', async (data) => {
    const msg = JSON.parse(data);
    
    // Forward to MCP HTTP server
    const response = await fetch(`${MCP_URL}/ws-message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Instance-ID': instanceId
      },
      body: JSON.stringify(msg)
    });
    
    const result = await response.json();
    
    // Send back to extension
    ws.send(JSON.stringify({
      id: msg.id,
      type: 'response',
      payload: result
    }));
  });
});
```

---

## Benefits of HTTP/SSE Approach

1. ✅ **Single MCP process** - No need for multiple processes
2. ✅ **Socket-based instance detection** - Proven pattern from index-http.ts
3. ✅ **Simple daemon** - Just HTTP proxy to MCP
4. ✅ **No Unix sockets** - Use HTTP (simpler)
5. ✅ **Reuse existing code** - Extend index-http.ts, not rewrite

---

## Deployment

### Start MCP HTTP Server
```bash
node dist/index-http-unified.js --port 3000
```

### Start WebSocket Daemon (systemd)
```bash
sudo systemctl start browsermcp-daemon
```

### Claude Desktop Config
```json
{
  "mcpServers": {
    "browsermcp": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

### Extension
Connects to `ws://localhost:8765/session/<instanceId>` automatically.

---

## Migration Path

1. Deploy WebSocket daemon (systemd)
2. Update MCP to index-http-unified.js
3. Update extension (already done)
4. Test end-to-end
5. Switch Claude Desktop to HTTP transport


---

## FINAL CLARIFICATION: Tab Management

### Single Chrome Window Architecture

**Key Insight:**
- ONE Chrome browser window (with extension)
- MULTIPLE tabs within that window
- HTTP MCP server manages: `instanceId → tabId` mapping
- Extension connects ONCE to daemon with window-level instance ID
- Daemon routes messages based on target tab

### Tab Assignment Flow

```
Claude #1 requests "open google.com"
    ↓
MCP HTTP Server (port 3000)
    ↓ Assigns tab: instanceId "abc" → tabId 123
    ↓ Stores mapping: Map<instanceId, tabId>
    ↓
POST to Daemon: /ws-message
    Headers: X-Instance-ID: abc, X-Tab-ID: 123
    Body: { type: "browser_navigate", url: "google.com" }
    ↓
WebSocket Daemon
    ↓ Forward to extension WebSocket
    Message: { tabId: 123, type: "browser_navigate", url: "google.com" }
    ↓
Chrome Extension
    ↓ Execute in tab 123
    chrome.tabs.update(123, { url: "google.com" })
    ↓
Response with result
```

### Tab Lifecycle

**Creation:**
```typescript
// MCP Server
const tabId = await createTab(url);
instanceTabMap.set(instanceId, tabId);
tabOwnerMap.set(tabId, instanceId);
```

**Usage:**
```typescript
// MCP Server receives tool call for instance "abc"
const tabId = instanceTabMap.get("abc");
// Send to daemon with tabId
```

**Deletion:**
```typescript
// Claude instance disconnects (TCP socket closes)
const tabId = instanceTabMap.get(instanceId);
await closeTab(tabId);
instanceTabMap.delete(instanceId);
tabOwnerMap.delete(tabId);
```

### Data Structures

**MCP HTTP Server maintains:**
```typescript
// Instance → Tab mapping
instanceTabMap: Map<instanceId, tabId>

// Tab → Instance mapping (reverse lookup)
tabOwnerMap: Map<tabId, instanceId>

// TCP Socket → Instance mapping (existing)
socketToInstance: WeakMap<Socket, instanceId>
```

### Message Format

**MCP → Daemon:**
```json
{
  "instanceId": "abc-123",
  "tabId": 42,
  "messageId": "msg-001",
  "type": "browser_navigate",
  "payload": {
    "url": "https://example.com"
  }
}
```

**Daemon → Extension:**
```json
{
  "tabId": 42,
  "messageId": "msg-001", 
  "type": "browser_navigate",
  "payload": {
    "url": "https://example.com"
  }
}
```

**Extension → Daemon (response):**
```json
{
  "tabId": 42,
  "messageId": "msg-001",
  "type": "response",
  "success": true,
  "payload": {
    "url": "https://example.com",
    "title": "Example Domain"
  }
}
```

**Daemon → MCP (response):**
```json
{
  "instanceId": "abc-123",
  "messageId": "msg-001",
  "success": true,
  "payload": { ... }
}
```

### Extension Changes

**Current (Multi-Instance):**
- Multiple WebSocket connections (one per port)
- Port scanning
- Instance-based tab locking

**New (Unified):**
- ONE WebSocket connection to port 8765
- Messages include `tabId` field
- Tab operations use chrome.tabs API with explicit tab ID

### Tab Lock Management

**Moved from extension to MCP server:**
```typescript
// MCP Server
class TabLockManager {
  locks: Map<tabId, instanceId> = new Map();
  
  async acquireLock(tabId: number, instanceId: string): Promise<boolean> {
    const currentOwner = this.locks.get(tabId);
    
    if (!currentOwner) {
      // Tab is free
      this.locks.set(tabId, instanceId);
      return true;
    }
    
    if (currentOwner === instanceId) {
      // We already own it
      return true;
    }
    
    // Check if current owner is still connected
    const ownerConnected = instanceById.has(currentOwner);
    if (!ownerConnected) {
      // Stale lock, take it
      this.locks.set(tabId, instanceId);
      return true;
    }
    
    // Tab is locked by another instance
    return false;
  }
  
  releaseLock(tabId: number, instanceId: string) {
    if (this.locks.get(tabId) === instanceId) {
      this.locks.delete(tabId);
    }
  }
}
```

### Benefits

1. ✅ **Single extension connection** - No port scanning
2. ✅ **Centralized tab management** - MCP server has full visibility
3. ✅ **Tab lock coordination** - Server enforces locks, no race conditions
4. ✅ **Clean instance cleanup** - Socket close → auto-release tabs
5. ✅ **Simpler extension** - Just execute commands on tab IDs

### Example: 3 Claude Instances, 1 Browser

```
Claude #1 (Socket A)
  ↓ Instance ID: abc
  ↓ Assigned Tab: 1 (https://google.com)
  
Claude #2 (Socket B)
  ↓ Instance ID: def  
  ↓ Assigned Tab: 2 (https://github.com)
  
Claude #3 (Socket C)
  ↓ Instance ID: ghi
  ↓ Assigned Tab: 3 (https://stackoverflow.com)

MCP Server State:
  instanceTabMap = {
    "abc" → 1,
    "def" → 2,
    "ghi" → 3
  }
  
  tabOwnerMap = {
    1 → "abc",
    2 → "def", 
    3 → "ghi"
  }

Extension WebSocket:
  - Single connection to ws://localhost:8765
  - Receives messages with tabId field
  - Executes: chrome.tabs.update(tabId, ...)
```

