# CLI Entry Point & Tool Assembly (`src/index.ts`)

## CLI Responsibilities
- Serves as the executable entry point (`#!/usr/bin/env node`) for launching the MCP server over stdio transport.
- Uses `commander` to expose a simple CLI that prints version information and starts the server when invoked without subcommands.

## Server Construction
- Imports `createServerWithTools` and orchestrates tool registration by building curated arrays representing functional categories (navigation, snapshots, debugger, form filling, file uploads, hints, etc.).
- Aggregates the tool arrays into `snapshotTools`, which ultimately forms the list passed to `createServerWithTools({ tools, resources })`.
- Keeps resource support empty by default (`const resources: Resource[] = []`) but retains the hook for future expansion.

## Tool Composition Strategy
- Emphasizes unified tools (`navigation-unified`, `tabs-unified`, `debugger-unified`, `safe-mode-enhanced`) replacing earlier, more fragmented tool sets.
- Maintains placeholders for optional tool families (batch operations, stability testing) to simplify re-enabling them later by uncommenting array spreads.
- Shares the `Context` instance so each tool gains access to the WebSocket messaging layer and the toolbox for cross-tool invocation.

## Lifecycle Management
- `setupExitWatchdog` listens for stdin `close` events (typical when Claude Desktop disconnects) and triggers `server.close()` followed by forced process exit after a 15-second grace period.
- Creates `StdioServerTransport` and binds it to the server, enabling bidirectional JSON-RPC messaging with the host application.

## Version & Metadata
- Derives the server name/version directly from `package.json`, ensuring deployments stay consistent with release tags and the `./scripts/deploy` flow.

## Extension Interplay
- While the entry point itself does not speak to the Chrome extension, its tool selection dictates which message handlers the extension must support. The inclusion of safe-mode and snapshot tools ensures the background script’s handler registrations remain aligned with server expectations.
