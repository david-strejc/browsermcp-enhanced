# MCP Server Assembly (`src/server.ts`)

## Overview
`createServerWithTools` wires together the Model Context Protocol server, the runtime `Context`, and the WebSocket bridge to the browser extension. It centralizes tool registration, resource exposure, request handling, and lifecycle cleanup for the Node-based MCP entry point.

## Startup Sequence
1. Instantiate `Context` and populate its toolbox map with every tool keyed by schema name.
2. Create an MCP `Server` with the provided `name` and `version`, advertising empty capabilities for tools/resources (actual schemas supplied during handlers).
3. Call `createWebSocketServer()` to allocate a TCP port and generate an `instanceId`, then persist both onto the `Context` for later handshake responses.
4. When the WebSocket server accepts a connection, assign the socket to `context.ws` (supporting multi-instance clients) and listen for handshake messages (`hello`, `portListRequest`).

## Request Handling
- **ListTools**: returns every tool schema in the provided `tools` array.
- **ListResources**: enumerates resource schemas, mirroring the `resources` array (empty by default in this repo).
- **CallTool**:
  - Locates the requested tool by name.
  - Executes `tool.handle(context, args)`, passing the shared `Context` instance.
  - Normalizes the result into an MCP `ToolResult`, adding error text when the tool returned falsy/legacy shapes.
  - Catches thrown errors and returns them as `isError` responses.
- **ReadResource**: finds the resource by URI and streams its contents via `resource.read(context, uri)`.

## Multi-Instance Coordination
- Each WebSocket connection represents a Claude Desktop instance. Connections are left open simultaneously; the latest socket assignment overwrites `context.ws` but existing sockets still operate because the extension routes replies using `instanceId`.
- Handshake handling supports dynamic port discovery by responding to `hello` and `portListRequest` messages using `PortRegistryManager`.

## Shutdown Flow
- Overrides `server.close` to ensure the WebSocket server and the shared `Context` both close when the MCP server shuts down, preventing orphaned ports or lingering sockets.

## Error Normalization Strategy
- Tool responses are normalized to guarantee textual feedback even when tools return custom objects or `undefined`.
- Standardizes failure paths so the frontend always receives a deterministic `content` array with explanatory text and `isError` flag.

## Extension Integration
- Relies on the Chrome extension’s background scripts to dial into the allocated port and complete the handshake; `context.instanceId` is included in every subsequent message to preserve routing across multiple desktops.
- `PortRegistryManager.getActiveInstances()` powers the dynamic list of active ports requested by the extension for discovery and reconnection logic.
