# WebSocket Server & Port Allocation (`src/ws.ts`)

## Purpose
Provides the TCP-level listener used by the browser extension to communicate with the MCP server. It collaborates with `PortRegistryManager` to dynamically allocate non-conflicting ports and exports the active registry instance for diagnostics.

## Port Selection Strategy
- Accepts an optional `requestedPort` for backward compatibility; if free, the server binds to it immediately.
- Otherwise instantiates a new `PortRegistryManager` and calls `allocatePort()` to obtain an available port/instance pair within the 8765–8775 range.
- Logs allocation details (`[WebSocket] Server started on port ...`) so external tooling can discover the bound endpoint.

## Instance Identity
- Returns both the `WebSocketServer` object and a generated `instanceId`. The ID is propagated to `Context` so every outgoing message includes it, enabling the Chrome extension to multiplex multiple Claude instances safely.

## Registry Exposure
- Maintains a module-level `portRegistry` reference so other modules (e.g., CLI diagnostics) can query `getPortRegistry()` for current allocation state or perform heartbeats/releases when needed.

## Error Considerations
- If no ports are available within the range, `PortRegistryManager.allocatePort` throws—callers must surface this as a startup failure.
- In legacy mode (explicit `requestedPort`), the helper double-checks the port is unused via `isPortInUse` to avoid collisions with stale processes.

## Teardown Expectations
- Callers are responsible for invoking `server.close()` and `PortRegistryManager.releasePort()` (handled indirectly via `Context.close()` and server overrides in `src/server.ts`) to free the entry in `/tmp/browsermcp-ports.json` and the OS-level port binding.
