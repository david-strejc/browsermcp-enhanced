# Context Management (`src/context.ts`)

## Overview
`Context` encapsulates the runtime state shared across MCP tools while brokering all messaging between the server process and the browser extensions. It stores the active WebSocket connection, tracks the active browser tab per instance, and exposes helper APIs that tools use to communicate with the extension safely.

## Key Responsibilities
- Owns the lifecycle of a single WebSocket connection to the browser extension and exposes `ws` getter/setter with retry-aware error semantics.
- Maintains per-instance metadata such as `instanceId`, allocated TCP `port`, active tab identifier, and in-memory toolbox registry for cross-tool calls.
- Provides `sendSocketMessage` and `sendWithContext` helpers that wrap `createSocketMessageSender` with standardized retry, timeout, and contextual error reporting.
- Surfaces diagnostics via `getConnectionInfo()` for telemetry, error bubble-up, and documentation of current connection state.
- Supplies `callTool` so tools can invoke one another through the shared toolbox map without direct circular imports.

## Lifecycle
1. `createServerWithTools` instantiates `Context`, populates `toolbox`, and assigns an instance-specific WebSocket when a new extension connection is accepted.
2. The `ws` setter attaches listeners to reset the connection when the socket closes or errors.
3. `Context.close()` is invoked during server shutdown to gracefully dispose the socket.
4. Tools access `context.ws` or `context.sendSocketMessage` during request handling; connection state is guarded to prevent usage after disconnect.

## Messaging Flow
- `sendSocketMessage` → delegates to `createSocketMessageSender`, passing along the current `WebSocket` instance and `instanceId` for routing.
- Enhanced retry logic merges default configuration (2 retries, exponential backoff) with per-call overrides supplied via `ContextSendOptions`.
- Errors from the sender are normalized to `BrowserMCPError` instances with rich `details` metadata including message type, connection diagnostics, and optional `errorContext` strings passed by callers.

## Error Handling
- When no socket is available, the `ws` getter throws a `BrowserMCPError` tagged `NO_CONNECTION` prompting the user to connect via the extension UI.
- Socket failures, timeouts, and retry exhaustion are wrapped with contextual metadata to aid debugging and permit automated retry decisions upstream.
- Handling for `mcpConfig.errors.noConnectedTab` converts extension-side tab selection failures into retryable `NO_CONNECTED_TAB` errors.

## Toolbox Integration
- `toolbox` is a simple `Record<string, Tool>` populated during server startup, keyed by tool schema names.
- `callTool(name, args)` is a convenience for compound tools that wish to reuse behaviors from sibling tools without duplicating logic; errors propagate as `BrowserMCPError` instances when tools are missing.

## Diagnostics & Telemetry
- `getConnectionInfo()` returns the latest attempt count, tab identifier, last handshake timestamp, and socket ready state, which downstream components embed into errors or logs.
- Consumers typically pass `options.errorContext` while sending messages so failures can be correlated with higher-level tool operations.

## Usage Guidelines
- Always access the socket through `context.sendSocketMessage` or `context.sendWithContext` to benefit from retry/backoff behavior.
- Tools performing multi-step automation should snapshot `context.getConnectionInfo()` for richer error surfaces when surfacing issues to Claude or the user.
- Prefer `sendWithContext` when performing actions tied to specific UI workflows so the server log includes human-readable steps.
