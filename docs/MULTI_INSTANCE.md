# Multi-Instance Support Documentation

## Overview

The BrowserMCP Enhanced multi-instance feature allows multiple Claude Desktop windows to connect and operate simultaneously without conflicts. Each instance gets its own dedicated port and manages browser tabs independently through an intelligent locking mechanism.

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────┐
│                   Chrome Browser                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │           Chrome Extension                      │    │
│  │  ┌──────────────────────────────────────┐      │    │
│  │  │    Multi-Instance Manager            │      │    │
│  │  │  - Port scanning (8765-8775)         │      │    │
│  │  │  - Connection management             │      │    │
│  │  │  - Tab locking & queueing            │      │    │
│  │  └──────────────────────────────────────┘      │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
                            │
                    WebSocket Connections
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ MCP Server 1 │   │ MCP Server 2 │   │ MCP Server 3 │
│  Port: 8765  │   │  Port: 8766  │   │  Port: 8767  │
│  Instance: A │   │  Instance: B │   │  Instance: C │
└──────────────┘   └──────────────┘   └──────────────┘
        │                   │                   │
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│   Claude 1   │   │   Claude 2   │   │   Claude 3   │
└──────────────┘   └──────────────┘   └──────────────┘
```

### Key Components

#### 1. Port Registry Manager (`src/utils/port-registry.ts`)

Manages port allocation and instance tracking through a file-based registry.

**Features:**
- **Port Range:** 8765-8775 (11 available ports)
- **Registry File:** `/tmp/browsermcp-ports.json`
- **Lock File:** `/tmp/browsermcp-ports.json.lock`
- **Heartbeat Interval:** 30 seconds
- **Stale Threshold:** 60 seconds

**Registry Entry Structure:**
```typescript
{
  port: number,
  instanceId: string,
  pid: number,
  createdAt: number,
  lastHeartbeat: number
}
```

#### 2. Multi-Instance Manager (`chrome-extension/multi-instance-manager.js`)

Handles multiple WebSocket connections from the browser extension side.

**Features:**
- Automatic port scanning every 10 seconds
- Tab locking mechanism to prevent conflicts
- Wait queue for tab access
- Connection health monitoring
- Automatic reconnection on failure

**Core Methods:**
- `scanPorts()`: Discovers active MCP servers
- `tryConnect(port)`: Establishes WebSocket connection
- `registerInstance()`: Registers new instance connection
- `acquireTabLock()`: Manages tab control
- `releaseTabLock()`: Releases tab control

#### 3. Background Script Loader (`chrome-extension/background.js`)

Dynamic loader that switches between single and multi-instance modes.

**Modes:**
- **Single-Instance:** Loads `background-legacy.js` (default, backwards compatible)
- **Multi-Instance:** Loads `background-multi-instance.js` (new feature)

#### 4. Server Enhancements (`src/server.ts`, `src/ws.ts`)

MCP server modifications to support instance identification.

**Hello Protocol:**
```javascript
// Client sends:
{ type: 'hello', wants: 'instanceId' }

// Server responds:
{
  type: 'helloAck',
  instanceId: 'uuid-here',
  port: 8765
}
```

## Usage

### Enabling Multi-Instance Mode

1. **Via Extension Popup:**
   - Click the BrowserMCP extension icon
   - Toggle "Multi-Instance Mode" switch
   - Extension will reload automatically

2. **Via Chrome Storage (programmatic):**
   ```javascript
   chrome.storage.local.set({ multiInstance: true });
   ```

3. **Via Configuration:**
   ```bash
   ./scripts/deploy --config
   # Select option to enable multi-instance
   ```

### Running Multiple Claude Desktop Instances

1. **Start First Instance:**
   ```bash
   # Claude Desktop will start normally
   # MCP server allocates port 8765
   ```

2. **Start Additional Instances:**
   ```bash
   # Each new Claude Desktop instance:
   # - Automatically gets next available port (8766, 8767, etc.)
   # - Registers with port registry
   # - Chrome extension discovers it automatically
   ```

3. **Verify Connections:**
   - Click extension popup
   - View "Active Instances" list
   - Each instance shows port and connection status

### Tab Locking Mechanism

When multiple instances try to control the same tab:

1. **First instance** acquires lock immediately
2. **Other instances** enter wait queue
3. When lock is released, next instance in queue gets control
4. Lock timeout: 30 seconds (prevents deadlocks)

**Example Flow:**
```
Instance A requests Tab 1 → Lock acquired
Instance B requests Tab 1 → Added to queue
Instance C requests Tab 1 → Added to queue
Instance A releases Tab 1 → Instance B gets lock
Instance B releases Tab 1 → Instance C gets lock
```

## API Reference

### Port Registry API

```typescript
class PortRegistryManager {
  // Allocate a port for this instance
  async allocatePort(): Promise<{ port: number; instanceId: string }>

  // Release the allocated port
  async releasePort(): Promise<void>

  // Get instance ID
  getInstanceId(): string

  // Get allocated port
  getPort(): number | null

  // Static: Get all active instances
  static async getActiveInstances(): Promise<PortRegistryEntry[]>
}
```

### Multi-Instance Manager API

```javascript
class MultiInstanceManager {
  // Start port scanning
  startPortScanning()

  // Try to connect to a specific port
  tryConnect(port)

  // Register a new instance
  registerInstance(instanceId, ws, port)

  // Acquire lock for a tab
  async acquireTabLock(tabId, instanceId)

  // Release lock for a tab
  releaseTabLock(tabId, instanceId)

  // Send message to specific instance
  sendToInstance(instanceId, message)

  // Broadcast to all instances
  broadcastToAll(message)
}
```

### Message Protocol

**Instance Registration:**
```javascript
// Extension → Server
{ type: 'hello', wants: 'instanceId' }

// Server → Extension
{ type: 'helloAck', instanceId: 'uuid', port: 8765 }
```

**Tab Lock Request:**
```javascript
// Extension internal
{
  type: 'lockRequest',
  tabId: 123,
  instanceId: 'uuid',
  timestamp: Date.now()
}
```

**Command Routing:**
```javascript
// With instance targeting
{
  type: 'command',
  instanceId: 'uuid',
  tabId: 123,
  command: 'snapshot',
  params: {}
}
```

## Configuration

### Environment Variables

```bash
# Set specific instance ID (optional)
export MCP_INSTANCE_ID="custom-id"

# Override port range (not recommended)
export MCP_PORT_START=9000
export MCP_PORT_END=9010
```

### Chrome Extension Settings

```javascript
// Storage keys
{
  multiInstance: boolean,      // Enable/disable multi-instance
  debugMode: boolean,          // Enable debug logging
  unsafeMode: boolean,        // Allow unsafe operations
  portScanInterval: number,   // Port scan interval (ms)
  lockTimeout: number         // Tab lock timeout (ms)
}
```

## Troubleshooting

### Common Issues

#### 1. Port Already in Use
**Symptom:** MCP server fails to start
```
Error: No available ports in range 8765-8775
```

**Solutions:**
- Check for stale processes: `ps aux | grep browsermcp`
- Clear port registry: `rm /tmp/browsermcp-ports.json`
- Manually check ports: `netstat -tlnp | grep 876`

#### 2. Extension Not Detecting Instances
**Symptom:** Extension shows no connections despite servers running

**Solutions:**
- Verify multi-instance mode is enabled
- Check browser console for errors (F12)
- Reload extension in `chrome://extensions`
- Ensure ports 8765-8775 are not blocked by firewall

#### 3. Tab Lock Conflicts
**Symptom:** Commands fail with "tab locked" errors

**Solutions:**
- Wait for lock timeout (30 seconds)
- Check extension popup for lock owner
- Force release: Reload the controlling tab
- Restart extension if locks are stuck

#### 4. Stale Registry Entries
**Symptom:** Port registry shows instances that aren't running

**Solutions:**
```bash
# Clear registry
rm /tmp/browsermcp-ports.json
rm /tmp/browsermcp-ports.json.lock

# Or use cleanup script
node -e "
const { PortRegistryManager } = require('./dist/utils/port-registry');
PortRegistryManager.getActiveInstances().then(console.log);
"
```

### Debug Commands

**Check Active Instances:**
```bash
cat /tmp/browsermcp-ports.json | jq
```

**Monitor Port Activity:**
```bash
watch -n 1 'netstat -tlnp | grep 876'
```

**View Extension Logs:**
```javascript
// In browser console
chrome.storage.local.get(null, console.log);
```

**Force Cleanup:**
```bash
# Kill all MCP processes
pkill -f browsermcp

# Remove registry
rm -f /tmp/browsermcp-ports*

# Restart Claude Desktop
```

## Performance Considerations

### Resource Usage

- **Per Instance:** ~50-100MB RAM
- **Port Scanning:** Minimal CPU (every 10s)
- **WebSocket Overhead:** ~1-2KB per message
- **Registry File:** < 10KB

### Scaling Limits

- **Maximum Instances:** 11 (port range limit)
- **Recommended Max:** 5-6 for optimal performance
- **Tab Locks:** No practical limit
- **Message Throughput:** ~1000 msg/sec per instance

### Optimization Tips

1. **Reduce Port Scan Interval:**
   ```javascript
   // For stable setups (less frequent scanning)
   this.SCAN_INTERVAL = 30000; // 30 seconds
   ```

2. **Increase Heartbeat Interval:**
   ```javascript
   // For low-activity instances
   this.HEARTBEAT_INTERVAL = 60000; // 1 minute
   ```

3. **Limit Registry Retention:**
   ```javascript
   // Clean entries older than 5 minutes
   const STALE_THRESHOLD = 300000;
   ```

## Security Notes

### Port Binding
- Ports bind to `localhost` only (not exposed externally)
- No authentication between extension and server (localhost trust)
- Each instance has unique UUID for identification

### File System
- Registry file in `/tmp` (world-readable)
- Lock file prevents race conditions
- PIDs validated to prevent spoofing

### Browser Extension
- Extension requires explicit user permission
- Tab access controlled by browser security model
- No cross-origin requests allowed

## Migration Guide

### From Single to Multi-Instance

1. **Backup Current Setup:**
   ```bash
   cp -r ~/.local/lib/browsermcp-enhanced ~/.local/lib/browsermcp-enhanced.backup
   ```

2. **Update Installation:**
   ```bash
   ./scripts/deploy
   ```

3. **Enable Multi-Instance:**
   - Open extension popup
   - Toggle multi-instance mode
   - Verify with test connection

4. **Rollback if Needed:**
   ```bash
   ./scripts/deploy --rollback
   ```

### Backwards Compatibility

- Single-instance mode remains default
- No breaking changes to existing API
- Legacy background script preserved
- Settings migrate automatically

## Future Enhancements

### Planned Features
- [ ] Dynamic port range configuration
- [ ] Instance priority/weighting
- [ ] Tab group management
- [ ] Cross-instance communication
- [ ] Load balancing for commands
- [ ] Persistent instance naming
- [ ] WebSocket compression
- [ ] Enhanced debugging tools

### Known Limitations
- Fixed port range (8765-8775)
- No instance-to-instance messaging
- Tab locks are first-come-first-served
- No automatic load distribution
- Registry requires file system access

## Support

For issues or questions:
- GitHub Issues: [browsermcp-enhanced/issues](https://github.com/david-strejc/browsermcp-enhanced/issues)
- Documentation: [/docs](https://github.com/david-strejc/browsermcp-enhanced/tree/main/docs)
- Extension Logs: Chrome DevTools → Console → Filter: "MultiInstance"