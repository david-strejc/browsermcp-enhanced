# Multi-Instance Manager (`chrome-extension/multi-instance-manager.js`)

## Role
Manages WebSocket connections between the Chrome extension and multiple concurrent MCP server instances. It centralizes connection lifecycle, dynamic port discovery, tab lock coordination, and message dispatching across instances.

## Connection Management
- Scans the default port range (8765–8775) or dynamically discovered ports provided by the servers.
- `tryConnect(port)` establishes WebSocket connections with timeout guards, handles handshake messages to obtain `instanceId`, and registers the instance in `this.instances` along with reverse mapping `socketToInstance`.
- Implements adaptive backoff using `trackPortFailure` with exponential delays up to 60 seconds to avoid spinning on unreachable ports.

## Instance Tracking
- Each registered instance stores WebSocket reference, port number, activity timestamps, tab ownership set, and a timer for refreshing the server’s port list.
- Heartbeat pings (`START_HEARTBEAT`) send `ping` messages every 30 seconds to keep connections alive and update `lastActivity`.
- Badge indicators reflect the number of active connections for quick visual feedback in the browser toolbar.

## Port Discovery Loop
- `startPortScanning` periodically invokes `scanPorts`, attempting new connections for ports not already represented by active sockets.
- Listens for `portListResponse` messages; `updateKnownPorts` sanitizes and stores dynamic port sets, extending the scan range just beyond the maximum known port to pick up new allocations.

## Messaging Pipeline
- `handleInstanceMessage(instanceId, message)` dispatches incoming payloads to the background controller’s handler map (`messageHandlers`).
- Provides compatibility shims translating legacy message types (`browser_navigate`, `browser_go_back`, etc.) into the unified handler keys when necessary.
- For requests carrying `id`, replies mirror MCP semantics (`{ id, type, payload }` or `{ id, error }`).

## Tab Lock Coordination
- Maintains `tabLocks` and `waitQueues` to ensure exclusive control of tabs per instance:
  - `acquireTabLock(tabId, instanceId)` resolves immediately when free, otherwise queues the request with a 30s timeout.
  - `releaseTabLock(tabId, instanceId)` hands the lock to the next queued instance to avoid starvation.
- `cleanup()` and disconnection handlers release locks and close owned tabs to prevent zombie state when instances disappear.

## Failure Handling
- On `onclose`, the manager removes instance metadata, clears port list timers, releases tab ownership, and schedules reconnection using the base retry delay.
- WebSocket errors update the failure map so subsequent `scanPorts` iterations obey the backoff schedule.

## Extension Integration
- Exposed globally as `self.MultiInstanceManager` for consumption by `background-multi-instance.js`.
- Supports future enhancements via placeholder methods (`handleNewConnection`) while ensuring current functionality is isolated from Chrome runtime connection events.
