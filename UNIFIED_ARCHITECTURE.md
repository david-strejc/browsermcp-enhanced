# Unified WebSocket Architecture

## Overview

This document describes the **Unified WebSocket Architecture** - a refactored design that consolidates multi-instance support into a single-listener pattern.

## Architecture Summary

### Before (Multi-Listener)
- **11 separate WebSocket servers** on ports 8765-8775
- Chrome extension **scans all ports** to find active servers
- Each Claude instance gets **dedicated port**
- Port scanning adds complexity and doesn't scale well

### After (Unified Single-Listener)
- **ONE WebSocket server** on port 8765
- **ONE connection per Claude instance** on that port
- Instance ID passed via **URI path**: `ws://localhost:8765/session/<instanceId>`
- **No port scanning needed**
- **Unlimited instances** supported
- **Industry-standard pattern** (matches Selenium, Playwright, Chrome DevTools)

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    Claude Desktop (Multiple Instances)            │
│                                                                   │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐                    │
│  │ Claude #1 │  │ Claude #2 │  │ Claude #3 │  ...               │
│  │           │  │           │  │           │                     │
│  │ Instance  │  │ Instance  │  │ Instance  │                     │
│  │ ID: abc   │  │ ID: def   │  │ ID: ghi   │                     │
│  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘                    │
│        │              │              │                            │
│    stdio          stdio          stdio                           │
│        │              │              │                            │
└────────┼──────────────┼──────────────┼────────────────────────────┘
         │              │              │
         │              │              │
         └──────────────┴──────────────┘
                        │
                        ▼
         ┌──────────────────────────────┐
         │   Unified MCP Server Process │
         │   (Single Node.js Process)   │
         │                              │
         │  ┌────────────────────────┐  │
         │  │ Unified WebSocket      │  │
         │  │ Server (Port 8765)     │  │
         │  │                        │  │
         │  │ Sessions Map:          │  │
         │  │  abc → Context #1      │  │
         │  │  def → Context #2      │  │
         │  │  ghi → Context #3      │  │
         │  └────────┬───────────────┘  │
         │           │                   │
         └───────────┼───────────────────┘
                     │
                     │ WebSocket connections
                     │ ws://localhost:8765/session/<id>
                     │
         ┌───────────┴───────────────────┐
         │                               │
         ▼                               ▼
┌────────────────┐              ┌────────────────┐
│ Chrome Window  │              │ Chrome Window  │
│                │              │                │
│ Extension:     │              │ Extension:     │
│ ws://8765/     │              │ ws://8765/     │
│   session/abc  │              │   session/def  │
│                │              │                │
│ Tabs: 1, 2, 3  │              │ Tabs: 4, 5     │
└────────────────┘              └────────────────┘
```

## Key Components

### 1. UnifiedWSServer (`src/ws-unified.ts`)

**Responsibilities:**
- Listen on single port (8765)
- Accept WebSocket connections with instance ID in URI
- Maintain session map: `instanceId → SessionInfo`
- Per-connection heartbeat monitoring
- Automatic lifecycle detection via WebSocket close

**Key Features:**
- **Multiple Instance ID formats supported:**
  - URI path: `/session/<instanceId>`
  - Query param: `?instanceId=<uuid>`
  - Sub-protocol: `Sec-WebSocket-Protocol: instance.<uuid>`
  - Header: `X-MCP-Instance: <uuid>`

- **Heartbeat monitoring:**
  - Ping every 30 seconds
  - Timeout after 90 seconds of no pong
  - Automatic connection cleanup

- **Session management:**
  - `sessions: Map<instanceId, SessionInfo>`
  - `socketToSession: WeakMap<WebSocket, instanceId>`
  - Per-session Context with toolbox

### 2. UnifiedConnectionManager (`chrome-extension/unified-connection-manager.js`)

**Responsibilities:**
- Generate unique instance ID (UUID v4)
- Connect to single port: `ws://localhost:8765/session/<instanceId>`
- Maintain persistent connection with auto-reconnect
- Handle heartbeat ping/pong
- Manage local tab locks

**Key Features:**
- **No port scanning** - connects to known port
- **Instance ID persistence** - stored in localStorage
- **Exponential backoff** - reconnect delays: 3s → 6s → 12s → 30s max
- **Connection badge** - shows ✓ (green) when connected, ✗ (red) when disconnected

### 3. Unified Index (`src/index-unified.ts`)

**Responsibilities:**
- Start unified WebSocket server
- Create MCP server instance
- Connect via stdio to Claude Desktop
- Manage context lifecycle

**Key Features:**
- Instance ID from environment: `MCP_INSTANCE_ID`
- Context map: `instanceId → Context`
- Shared toolbox across all instances
- Hot-reload support

## Message Flow

### Connection Handshake

```
Extension                    Unified Server
    │                              │
    │  Connect to /session/abc123  │
    ├──────────────────────────────>│
    │                              │ Create/get context
    │                              │ Setup heartbeat
    │                              │ Register session
    │                              │
    │  { type: 'connected' }       │
    │<──────────────────────────────┤
    │                              │
    │  { type: 'hello',            │
    │    wants: 'instanceId' }     │
    ├──────────────────────────────>│
    │                              │
    │  { type: 'helloAck',         │
    │    instanceId: 'abc123' }    │
    │<──────────────────────────────┤
    │                              │
```

### Tool Execution

```
Claude Desktop              MCP Server              Extension
      │                          │                       │
      │  CallTool(navigate)      │                       │
      ├──────────────────────────>│                       │
      │                          │ Get context for ID    │
      │                          │ Execute tool          │
      │                          │                       │
      │                          │  WS Message           │
      │                          ├──────────────────────>│
      │                          │                       │ Execute command
      │                          │                       │ in browser
      │                          │  WS Response          │
      │                          │<──────────────────────┤
      │                          │                       │
      │  Tool Result             │                       │
      │<─────────────────────────┤                       │
      │                          │                       │
```

## Migration Guide

### From Multi-Instance Mode

**Old configuration** (`~/.claude/mcp_servers.json`):
```json
{
  "browsermcp-enhanced": {
    "command": "node",
    "args": ["/home/user/.local/lib/browsermcp-enhanced/dist/index-multi.js"]
  }
}
```

**New configuration** (unified mode):
```json
{
  "browsermcp-enhanced": {
    "command": "node",
    "args": ["/home/user/.local/lib/browsermcp-enhanced/dist/index-unified.js"],
    "env": {
      "MCP_INSTANCE_ID": "auto-generated-uuid"
    }
  }
}
```

### Extension Changes

**No changes needed!** The extension will auto-detect the server type:
- If unified server detected → use single-port connection
- If multi-instance detected → fall back to port scanning

### Deployment

Use the standard deployment script:
```bash
./scripts/deploy
```

The script will:
1. Build all modes (including unified)
2. Copy to deployment directory
3. Update Chrome extension
4. Restart Claude Desktop

## Benefits

### 1. Simplicity
- ✅ No port scanning logic
- ✅ Single connection point
- ✅ Clear instance identification

### 2. Scalability
- ✅ Unlimited Claude instances (not limited to 11)
- ✅ No port exhaustion
- ✅ Efficient resource usage

### 3. Reliability
- ✅ Industry-standard pattern
- ✅ Clear lifecycle management
- ✅ Automatic reconnection

### 4. Maintainability
- ✅ Simpler debugging (port 8765 = all instances)
- ✅ Easier to extend
- ✅ Standard WebSocket patterns

### 5. Performance
- ✅ Lower memory footprint (1 server vs 11)
- ✅ Fewer OS resources
- ✅ No port scanning overhead

## Comparison: Multi vs Unified

| Aspect | Multi-Listener | Unified Single-Listener |
|--------|----------------|------------------------|
| **Ports** | 11 ports (8765-8775) | 1 port (8765) |
| **Extension Logic** | Port scanning | Direct connection |
| **Max Instances** | 11 (hardcoded) | Unlimited |
| **Instance ID** | Port number | UUID in URI |
| **Firewall Rules** | 11 rules needed | 1 rule needed |
| **Connection Flow** | Scan → Connect | Connect directly |
| **Memory** | 11 servers | 1 server |
| **Debugging** | Check each port | Check one port |
| **Industry Match** | ❌ Non-standard | ✅ Standard (Selenium/Playwright) |

## Testing

### Test Single Instance
```bash
# Terminal 1: Start unified server
npm run start:unified

# Terminal 2: Check WebSocket server
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: test" \
  http://localhost:8765/session/test-instance-123
```

### Test Multiple Instances
```bash
# Start 3 Claude Desktop instances
# Each will get unique instance ID
# All connect to same port 8765
# Verify in logs: Active instances: 3
```

### Verify No Port Scanning
```bash
# Check Chrome extension console
# Should see: "Connecting to: ws://localhost:8765/session/<uuid>"
# Should NOT see: "Scanning ports: 8765, 8766, 8767..."
```

## Troubleshooting

### Extension not connecting?

1. **Check if server is running:**
   ```bash
   lsof -i :8765
   ```

2. **Check instance ID:**
   - Extension: `localStorage.getItem('browsermcp_instance_id')`
   - Should be valid UUID v4

3. **Check WebSocket URL:**
   - Should be: `ws://localhost:8765/session/<uuid>`
   - NOT: `ws://localhost:8765` (missing session path)

### Multiple instances conflicting?

1. **Check session map:**
   - Server logs should show unique instance IDs
   - `[UnifiedWS] Instance abc123 connected (total: 2)`

2. **Verify different instance IDs:**
   - Each Claude Desktop should have different `MCP_INSTANCE_ID`
   - Extension generates unique ID per browser window

3. **Check tab locks:**
   - Tab locks are now client-side (in extension)
   - Each extension instance manages its own locks

## Future Enhancements

### Planned
- [ ] HTTP mode integration (single port for both HTTP + WebSocket)
- [ ] TLS/SSL support for secure connections
- [ ] Authentication tokens for multi-user scenarios
- [ ] Connection pooling and load balancing

### Ideas
- [ ] WebSocket compression (permessage-deflate)
- [ ] Custom sub-protocols for advanced features
- [ ] Metrics endpoint (Prometheus-style)
- [ ] Admin dashboard (WebSocket connections viewer)

## References

### Industry Patterns
- **Selenium 4:** `ws://localhost:4444/session/<sessionId>`
- **Playwright:** `ws://localhost:9323/playwright/<browserId>`
- **Chrome DevTools:** `ws://localhost:9222/devtools/page/<targetId>`

### Relevant RFCs
- [RFC 6455: WebSocket Protocol](https://tools.ietf.org/html/rfc6455)
- [WebSocket Sub-Protocols](https://www.iana.org/assignments/websocket/websocket.xml)

## Credits

**Architecture Design:** Based on o3 SAGE recommendations and industry best practices

**Implementation:** Refactored from multi-instance architecture with backwards compatibility

**Inspired By:** Selenium WebDriver, Playwright, Chrome DevTools Protocol
