# WebSocket Message Sender (`src/messaging/ws/sender.ts`)

## Purpose
Implements the low-level request/response protocol between the MCP server and the browser extension. It enriches outgoing messages with retry, timeout, and structured error semantics so higher-level tools can issue reliable commands without managing socket intricacies.

## Public API
- `createSocketMessageSender<TMap>(ws, instanceId?)` → returns `{ sendSocketMessage }` which dispatches typed messages and awaits responses.
- `BrowserMCPError` → specialized error class carrying `code`, `retryable` flag, and optional `details` payload used across the project.

## Message Flow
1. `sendSocketMessage` assembles retry/backoff parameters (defaults: 30s timeout, 2 retries, exponential backoff up to 5s).
2. Each attempt delegates to `sendSingleMessage`, which assigns an incrementing message ID, serializes the payload (including `instanceId` when provided), and writes to the socket.
3. The promise resolves when the extension echoes a response with matching `id`; extension errors bubble up as `BrowserMCPError` with retry classification.
4. Timeouts, send failures, or socket errors trigger retries unless the error was marked non-retryable.

## Error Classification
- `classifyErrorAsRetryable` inspects extension error strings for keywords to determine retry suitability (e.g., network/timeout → retryable, invalid selector → non-retryable).
- All terminal errors are wrapped as `BrowserMCPError` with codes such as `MESSAGE_TIMEOUT`, `SEND_ERROR`, `WEBSOCKET_ERROR`, or `MAX_RETRIES_EXCEEDED` for consistent diagnosis upstream.

## Timeout Handling
- `setTimeout` guards each in-flight message; expiry removes listeners and rejects with retryable `MESSAGE_TIMEOUT`.
- Listener cleanup ensures no memory leaks when responses arrive late or when the socket encounters an error mid-flight.

## Retry Strategy
- Retry loop uses exponential backoff: `baseDelayMs * multiplier^attempt` clamped to `maxDelayMs`.
- Non-retryable errors (e.g., user-facing validation failures) propagate immediately without consuming remaining attempts.

## Integration Points
- Consumed primarily by `Context.sendSocketMessage` to normalize tool interactions.
- The Chrome extension must mirror the `{ id, payload, error }` response contract; missing IDs lead to warnings but otherwise no hard failure.
- Rich error metadata is preserved so server-level handlers can log the originating message type and retry history.

## Implementation Notes
- Module-level `messageId` counter keeps IDs unique within the process; no persistence across restarts is required.
- All outbound messages include `instanceId` whenever available, aligning with the multi-instance routing handled in the extension.
