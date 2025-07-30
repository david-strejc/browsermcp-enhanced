# BrowserMCP Enhanced

[![MCP Server](https://img.shields.io/badge/MCP-Server-blue)](https://github.com/modelcontextprotocol)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-green)](https://developer.chrome.com/docs/extensions/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Enhanced Model Context Protocol (MCP) server for browser automation with improved element selection, tab management, and token optimization. Built on top of the original [BrowserMCP](https://github.com/browsermcp/mcp) with significant improvements for AI-powered browser interaction.

## 🚀 Key Enhancements

### 1. **Stable Element Selection**
- **Problem Solved**: AI was often selecting wrong elements due to position-based selectors
- **Solution**: Persistent element IDs using WeakMap (`[ref=123]` instead of `button[2]`)
- **Result**: Elements maintain stable references until page reload

### 2. **Tab Management**
- Full tab control with 4 new tools:
  - `browser_tab_list` - List all open tabs
  - `browser_tab_select` - Switch between tabs
  - `browser_tab_new` - Open new tabs
  - `browser_tab_close` - Close tabs

### 3. **Token Optimization**
- **70-90% reduction** in context size
- Minimal snapshots showing only interactive elements
- Viewport-only filtering by default
- Configurable snapshot levels (minimal/full)

### 4. **Element Validation**
- Pre-action validation ensures elements are:
  - Visible and in viewport
  - Not disabled or hidden
  - Correct element type for action
  - Actually interactable

## 📦 Installation

### Prerequisites
- Node.js 18+
- Chrome browser
- Claude Desktop or VS Code with MCP support

### Quick Install

1. **Install the MCP Server**:
   ```bash
   # Clone the repository
   git clone https://github.com/yourusername/browsermcp-enhanced.git
   cd browsermcp-enhanced
   
   # Install dependencies
   npm install
   
   # Build the server
   npm run build
   
   # Install locally
   npm link
   ```

2. **Configure Claude Desktop**:
   
   Add to `~/.claude/mcp_servers.json`:
   ```json
   {
     "mcpServers": {
       "browsermcp": {
         "command": "npx",
         "args": ["@browsermcp/mcp-enhanced"]
       }
     }
   }
   ```

3. **Install Chrome Extension**:
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `chrome-extension` folder

## 🛠️ Usage

### Basic Browser Control
```typescript
// Navigate to a page
await use_mcp_tool("browsermcp", "browser_navigate", {
  url: "https://example.com"
});

// Take a minimal snapshot (token-optimized)
await use_mcp_tool("browsermcp", "browser_snapshot", {
  level: "minimal",      // Only interactive elements
  viewportOnly: true     // Only visible content
});

// Click using stable element reference
await use_mcp_tool("browsermcp", "browser_click", {
  ref: "ref123",
  element: "Submit button"
});
```

### Tab Management
```typescript
// List all tabs
const tabs = await use_mcp_tool("browsermcp", "browser_tab_list", {});

// Open new tab
await use_mcp_tool("browsermcp", "browser_tab_new", {
  url: "https://google.com"
});

// Switch to tab by index
await use_mcp_tool("browsermcp", "browser_tab_select", {
  index: 2
});
```

### Advanced Features
```typescript
// Full snapshot when needed
await use_mcp_tool("browsermcp", "browser_snapshot", {
  level: "full"  // Complete DOM structure
});

// Type with auto-submit
await use_mcp_tool("browsermcp", "browser_type", {
  ref: "ref45",
  element: "Search input",
  text: "MCP tools",
  submit: true  // Press Enter after typing
});
```

## 🔧 Configuration

### Environment Variables
- `BROWSERMCP_ENHANCED=true` - Enable enhanced features
- `DEBUG=browsermcp:*` - Enable debug logging

### Snapshot Options
| Option | Values | Default | Description |
|--------|--------|---------|-------------|
| `level` | `minimal`, `full` | `minimal` | Amount of DOM to capture |
| `viewportOnly` | `true`, `false` | `true` | Only capture visible elements |

## 🏗️ Architecture

### Components
1. **MCP Server** (`src/`) - Handles MCP protocol and tool definitions
2. **Chrome Extension** (`chrome-extension/`) - Browser automation via Chrome APIs
3. **WebSocket Bridge** - Real-time communication between server and extension

### Element ID System
```javascript
// Element tracking in extension
window.__elementTracker = {
  elementToId: new WeakMap(),  // DOM Element → ID
  idToElement: new Map(),      // ID → WeakRef<Element>
  nextId: 1,
  
  getElementId(element) {
    // Returns stable ID like "ref123"
  }
};
```

## 📊 Performance Improvements

### Token Usage Comparison
| Snapshot Type | Original | Enhanced | Reduction |
|---------------|----------|----------|-----------|
| Simple page | ~5,000 | ~500 | 90% |
| Complex page | ~50,000 | ~5,000 | 90% |
| With tables | ~20,000 | ~1,500 | 92.5% |

### Why It Matters
- Faster AI responses
- Larger context available for other tasks
- Reduced API costs
- Better performance on complex pages

## 🐛 Troubleshooting

### Extension Issues
1. **Elements not found**: Ensure enhanced extension is installed (check version 1.1.0)
2. **Connection failed**: Restart Chrome and Claude Desktop
3. **Wrong elements selected**: Clear cache and reload page

### Server Issues
1. **Tools not appearing**: Restart Claude Desktop after config changes
2. **WebSocket errors**: Check if port 8765 is available
3. **Permission denied**: Ensure Chrome extension has proper permissions

## 🤝 Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Add tests for new features
4. Submit a pull request

### Development Setup
```bash
# Install dev dependencies
npm install

# Run in development mode
npm run dev

# Run tests
npm test

# Build for production
npm run build
```

## 📄 License

MIT License - see [LICENSE](LICENSE) file

## 🙏 Credits

- Based on [BrowserMCP](https://github.com/browsermcp/mcp) 
- Originally adapted from [Playwright MCP](https://github.com/microsoft/playwright-mcp)
- Enhanced by the community

## 📈 Roadmap

- [ ] Screenshot with element bounds overlay
- [ ] Network request monitoring
- [ ] Cookie management
- [ ] Multi-browser support (Firefox, Safari)
- [ ] Recording and replay functionality
- [ ] Visual regression testing

---

**Note**: This is an enhanced version focusing on reliability and efficiency for AI-powered browser automation. For the original version, see [BrowserMCP](https://github.com/browsermcp/mcp).