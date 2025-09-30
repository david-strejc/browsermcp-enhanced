# Port Registry (`src/utils/port-registry.ts`)

## Goal
Ensures multiple MCP server instances can coexist by coordinating exclusive access to a small TCP port range and maintaining liveness metadata for discovery.

## Data Model
- Registry persisted at `/tmp/browsermcp-ports.json` with schema `{ instances: PortRegistryEntry[] }`.
- Each `PortRegistryEntry` tracks `port`, `instanceId`, `pid`, `createdAt`, and `lastHeartbeat` timestamps.
- File-level lock (`/tmp/browsermcp-ports.json.lock`) prevents concurrent writers from corrupting the registry.

## Allocation Flow
1. Acquire filesystem lock, forcibly clearing stale locks older than 5s.
2. Load registry, evict stale instances (process dead or heartbeat older than 60s).
3. Iterate the configured range (8765–8775), skipping entries already registered or detected as in use via `isPortInUse`.
4. Persist the new entry, start a 30s heartbeat timer updating `lastHeartbeat`, and log diagnostic messages (`[PortRegistry] Allocated port ...`).

## Heartbeat & Release
- `startHeartbeat` periodically refreshes `lastHeartbeat` while the process is alive.
- `releasePort` removes the entry, cancels heartbeat, and logs the release; invoked when the MCP server shuts down gracefully.

## Static Introspection
- `PortRegistryManager.getActiveInstances()` acquires the lock, cleans stale entries, rewrites the registry, and returns the current instance list—used by the Chrome extension to display active ports.

## Crash Resilience
- Heartbeat-based pruning ensures orphaned entries vanish roughly one minute after processes die without cleanup.
- Process-level exit/SIGINT/SIGTERM handlers instantiate a fresh manager and call `releasePort()` to free the allocation opportunistically.

## Instance Identity
- Default `instanceId` includes PID, random hex, and timestamp; honors `process.env.MCP_INSTANCE_ID` when externally supplied for deterministic behavior.

## Locking Guarantees
- All read/modify/write paths wrap registry access within `acquireLock`/`releaseLock` to avoid race conditions between multiple Node processes contending for the same port range.
