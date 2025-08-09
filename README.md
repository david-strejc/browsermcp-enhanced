# BrowserMCP Enhanced

[![MCP Server](https://img.shields.io/badge/MCP-Server-blue)](https://github.com/modelcontextprotocol)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-green)](https://developer.chrome.com/docs/extensions/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

🚀 **Advanced browser automation for AI agents** - A powerful Model Context Protocol (MCP) server that enables Claude and other AI assistants to interact with web browsers through a secure, token-optimized interface.

## ✨ Key Features

### 🎯 Smart Element Selection
- **Persistent element references** using WeakMap-based tracking (`[ref123]` system)
- **Intelligent element validation** before interactions
- **Automatic element visibility checks**
- No more brittle CSS selectors or position-based targeting

### 📊 Token Optimization (90% Reduction!)
- **Scaffold Mode**: Reduces 58,000+ tokens to ~3,500 for complex sites
- **Smart truncation** with continuation markers
- **Viewport-focused** snapshots by default
- **Progressive disclosure** with expand region tool

### 🔒 Dual-Mode Code Execution
- **Safe Mode** (default): Sandboxed API with limited, secure operations
- **Unsafe Mode**: Full browser access for advanced users (with warnings)
- **Configurable** via extension options or environment variables

### 🎛️ Complete Browser Control
- **Tab management** (list, switch, open, close)
- **Network monitoring** and request inspection
- **Console log** capture
- **Screenshot** generation
- **Debugger integration** for advanced analysis

### 🔧 Developer-Friendly
- **TypeScript** throughout
- **Chrome Extension Manifest V3**
- **WebSocket** for real-time communication
- **Comprehensive error handling**

## 📦 Installation

### Prerequisites
- Node.js 18+ and npm
- Chrome or Chromium browser
- Claude Desktop app (or any MCP-compatible client)

### Platform-Specific Instructions

<details>
<summary><b>🐧 Linux / macOS</b></summary>

```bash
# 1. Clone the repository
git clone https://github.com/yourusername/browsermcp-enhanced.git
cd browsermcp-enhanced

# 2. Install dependencies
npm install

# 3. Build the project
npm run build

# 4. Create installation directory
mkdir -p ~/.local/lib/browsermcp-enhanced

# 5. Copy files
cp -r dist ~/.local/lib/browsermcp-enhanced/
cp -r chrome-extension ~/.local/lib/browsermcp-enhanced/
cp package.json ~/.local/lib/browsermcp-enhanced/
cp -r node_modules ~/.local/lib/browsermcp-enhanced/

# 6. Configure MCP server (see Configuration section)
```
</details>

<details>
<summary><b>🪟 Windows</b></summary>

```powershell
# 1. Clone the repository
git clone https://github.com/yourusername/browsermcp-enhanced.git
cd browsermcp-enhanced

# 2. Install dependencies
npm install

# 3. Build the project
npm run build

# 4. Create installation directory
mkdir -Force "$env:LOCALAPPDATA\browsermcp-enhanced"

# 5. Copy files
xcopy /E /Y dist "$env:LOCALAPPDATA\browsermcp-enhanced\dist\"
xcopy /E /Y chrome-extension "$env:LOCALAPPDATA\browsermcp-enhanced\chrome-extension\"
copy package.json "$env:LOCALAPPDATA\browsermcp-enhanced\"
xcopy /E /Y node_modules "$env:LOCALAPPDATA\browsermcp-enhanced\node_modules\"

# 6. Configure MCP server (see Configuration section)
```

**Note**: On Windows, you'll need to adjust paths in the MCP configuration to use Windows-style paths.
</details>

### Chrome Extension Installation

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Select the `chrome-extension` folder:
   - Linux/macOS: `~/.local/lib/browsermcp-enhanced/chrome-extension`
   - Windows: `%LOCALAPPDATA%\browsermcp-enhanced\chrome-extension`
5. The extension icon should appear in your toolbar

### MCP Server Configuration

Add to your Claude Desktop configuration file:

**Linux/macOS**: `~/.claude/mcp_servers.json`
**Windows**: `%APPDATA%\Claude\mcp_servers.json`

```json
{
  "mcpServers": {
    "browsermcp": {
      "command": "node",
      "args": ["/home/user/.local/lib/browsermcp-enhanced/dist/index.js"],
      "env": {
        "BROWSERMCP_ENHANCED": "true",
        "BROWSERMCP_UNSAFE_MODE": "false"
      }
    }
  }
}
```

**Windows users**: Replace the path with:
```json
"args": ["%LOCALAPPDATA%\\browsermcp-enhanced\\dist\\index.js"]
```

## 🛠️ Available Tools

### Navigation & Basic Control

| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate to a URL |
| `browser_go_back` | Go back to the previous page |
| `browser_go_forward` | Go forward to the next page |
| `browser_wait` | Wait for specified time in seconds |
| `browser_press_key` | Press a keyboard key |

### Page Interaction

| Tool | Description |
|------|-------------|
| `browser_snapshot` | Capture page snapshot (supports scaffold mode) |
| `browser_click` | Click on an element |
| `browser_hover` | Hover over an element |
| `browser_type` | Type text into an input field |
| `browser_select_option` | Select option(s) in a dropdown |
| `browser_drag` | Drag element to another element |

### Tab Management

| Tool | Description |
|------|-------------|
| `browser_tab_list` | List all open browser tabs |
| `browser_tab_select` | Select a tab by index |
| `browser_tab_new` | Open a new tab |
| `browser_tab_close` | Close a tab |

### Advanced Features

| Tool | Description |
|------|-------------|
| `browser_execute_js` | Execute JavaScript code (safe/unsafe modes) |
| `browser_common_operation` | Pre-built operations (hide popups, extract data, etc.) |
| `browser_expand_region` | Expand a specific region with token budget |
| `browser_query_elements` | Query elements by selector, text, or proximity |
| `browser_get_console_logs` | Get console logs from the browser |
| `browser_screenshot` | Take a screenshot of the current page |

### Debugger Tools

| Tool | Description |
|------|-------------|
| `browser_debugger_attach` | Attach debugger to tab |
| `browser_debugger_detach` | Detach debugger from tab |
| `browser_debugger_get_data` | Get debugging data (console, network, errors) |

## 🏗️ Architecture

```
┌─────────────┐     WebSocket      ┌──────────────┐     Chrome API    ┌──────────┐
│   Claude    │◄──────────────────►│  MCP Server  │◄─────────────────►│  Chrome  │
│   Desktop   │                    │  (Node.js)   │                   │Extension │
└─────────────┘                    └──────────────┘                   └──────────┘
                                           │                                 │
                                           │                                 ▼
                                           │                          ┌──────────┐
                                           └─────────────────────────►│   Web    │
                                            Message Passing           │   Page   │
                                                                      └──────────┘
```

### Components

1. **MCP Server** (`src/index.ts`)
   - Handles tool registration and Claude communication
   - Manages WebSocket connections to Chrome extension
   - Processes tool requests and responses

2. **Chrome Extension**
   - **Background Script** (`background.js`): WebSocket client, message routing
   - **Content Scripts**: DOM interaction, element tracking
   - **Options Page**: User configuration interface

3. **Element Tracking System**
   - `element-tracker.js`: WeakMap-based persistent references
   - `element-validator.js`: Pre-action validation
   - `code-executor.js`: Sandboxed JavaScript execution

## ⚙️ Configuration

### Extension Options

Access via Chrome: Extension icon → Right-click → Options

- **Unsafe Mode**: Toggle between safe (sandboxed) and unsafe (full access) code execution
- **Server URL**: WebSocket server address (default: `ws://localhost:8765`)
- **Logging**: Enable/disable execution logging
- **Confirmation**: Require confirmation for unsafe operations

### Environment Variables

Set in `mcp_servers.json`:

| Variable | Description | Default |
|----------|-------------|---------|
| `BROWSERMCP_ENHANCED` | Enable enhanced features | `true` |
| `BROWSERMCP_UNSAFE_MODE` | Default code execution mode | `false` |

## 🔒 Security

### Safe Mode (Default)
- Limited API with sandboxed functions
- No access to cookies, storage, or network
- No Chrome extension APIs
- Perfect for general automation

### Unsafe Mode
- Full access to window, document, fetch
- Complete Chrome API access
- Use only with trusted code
- Requires explicit enabling

See [UNSAFE_MODE.md](./UNSAFE_MODE.md) for detailed security documentation.

## 📝 Usage Examples

### Basic Navigation
```javascript
// Navigate to a website
await browser_navigate({ url: "https://example.com" });

// Take a snapshot
await browser_snapshot({ level: "minimal" });

// Click a button
await browser_click({ ref: "ref123", element: "Submit button" });
```

### Scaffold Mode for Large Sites
```javascript
// Get ultra-minimal snapshot (3-4k tokens instead of 58k+)
await browser_snapshot({ mode: "scaffold" });

// Expand specific region
await browser_expand_region({ 
  ref: "ref45", 
  maxTokens: 1000,
  depth: 2 
});
```

### Code Execution
```javascript
// Safe mode (default)
await browser_execute_js({ 
  code: "return api.getText('h1');" 
});

// Unsafe mode (when enabled)
await browser_execute_js({ 
  code: "return document.cookie;",
  unsafe: true 
});
```

### Tab Management
```javascript
// List all tabs
const tabs = await browser_tab_list();

// Open new tab
await browser_tab_new({ url: "https://google.com" });

// Switch to tab
await browser_tab_select({ index: 2 });
```

## 🧪 Testing

Run the test suite:

```bash
# Basic tests
npm test

# Scaffold mode test
node test-scaffold.js

# Code execution test
node test-code-execution.js

# Full test suite
./run-tests.sh
```

## 🐛 Troubleshooting

### Extension shows "Disconnected"
1. Ensure MCP server is running (restart Claude)
2. Check WebSocket connection on port 8765
3. Verify Chrome extension is loaded
4. Check console for errors

### "Invalid element reference"
- Page may have reloaded, references are reset
- Element may have been removed from DOM
- Try capturing a fresh snapshot

### Token limit issues
- Use scaffold mode for large sites
- Enable viewport-only snapshots
- Use query_elements to find specific items

### Unsafe mode not working
1. Check extension options page
2. Verify `BROWSERMCP_UNSAFE_MODE` in config
3. Restart Claude after changes
4. Check console for security warnings

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

MIT License - See [LICENSE](./LICENSE) file for details

## 🙏 Acknowledgments

- Original [BrowserMCP](https://github.com/browsermcp/mcp) project
- [Model Context Protocol](https://github.com/modelcontextprotocol) by Anthropic
- Chrome Extension development community

## 🔗 Links

- [GitHub Repository](https://github.com/yourusername/browsermcp-enhanced)
- [Issue Tracker](https://github.com/yourusername/browsermcp-enhanced/issues)
- [MCP Documentation](https://github.com/modelcontextprotocol/docs)

---

**Built with ❤️ for the AI automation community**