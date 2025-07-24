# BrowserMCP Enhanced - Tab Management Edition

This is an enhanced version of BrowserMCP that adds tab management capabilities from Playwright-MCP.

## New Features Added

### Tab Management Tools
- **browser_tab_list** - List all open browser tabs
- **browser_tab_select** - Select a tab by index
- **browser_tab_new** - Open a new tab with optional URL
- **browser_tab_close** - Close a tab by index or current tab

## Installation & Testing

### 1. Install MCP Server
```bash
cd browsermcp-enhanced
npm install
npm run build
```

### 2. Install Chrome Extension
1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" in the top right
3. Click "Load unpacked"
4. Select the `chrome-extension` folder from this project

### 3. Test the Setup
1. Start the MCP server:
   ```bash
   npm run inspector
   ```

2. Click the BrowserMCP Enhanced extension icon in Chrome
3. Click "Connect" in the popup
4. The MCP Inspector should show the connection

### 4. Test Tab Management
In the MCP Inspector, try these commands:

```javascript
// List all tabs
await client.callTool("browser_tab_list", {});

// Open a new tab
await client.callTool("browser_tab_new", { url: "https://example.com" });

// Select a tab by index
await client.callTool("browser_tab_select", { index: 0 });

// Close current tab
await client.callTool("browser_tab_close", {});
```

## Implementation Details

### Backend Changes
- Added new message types to `SocketMessageMap` for tab operations
- Created `tabs.ts` with all tab management tools
- Extended `Context` class to track tabs
- Fixed import paths to remove workspace dependencies

### Chrome Extension
- Added `tabs` permission in manifest
- Implemented WebSocket message handlers for all tab operations
- Maintains active tab tracking
- Supports all existing BrowserMCP functionality

## Next Steps

To add more features from Playwright-MCP:

1. **JavaScript Execution** - Add `browser_evaluate` tool
2. **Dialog Handling** - Add `browser_handle_dialog` tool  
3. **Network Monitoring** - Add `browser_network_requests` tool
4. **File Operations** - Add upload/download support

Each feature requires:
- New message types in `messages.ts`
- Tool implementation in backend
- Handler implementation in extension