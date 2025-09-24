<div align="center">
  <img src="https://wpdistro.cz/laskobot-mascot.jpg" alt="Láskobot Mascot" width="600"/>
</div>

# BrowserMCP Enhanced 🚀

<div align="center">

  **v1.5.0 - Codename: Láskobot**

  [![Version](https://img.shields.io/badge/version-1.5.0-blue.svg)](https://github.com/david-strejc/browsermcp-enhanced/releases)
  [![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
  [![MCP](https://img.shields.io/badge/MCP-Compatible-purple.svg)](https://modelcontextprotocol.io)
</div>

Enhanced MCP server for browser automation with simplified tools, advanced JavaScript execution, and comprehensive debugging capabilities.

## ✨ Features

### 🔒 Dual-Mode JavaScript Execution
- **Safe Mode (Default)**: Secure, sandboxed execution with RPC architecture
- **Unsafe Mode**: Direct DOM access for advanced automation scenarios
- Clear API separation with async/await patterns

### 🎯 Smart Element Detection
- Component-based capture for accurate selection
- Accessibility-aware element identification
- Automatic trusted click handling for OAuth/popups
- Advanced validation and tracking

### 🛠️ Developer-Friendly APIs
```javascript
// Safe Mode - Controlled DOM access
await api.getText('h1')
await api.click('#submit')
await api.setValue('input', 'text')
await api.exists('.element')
await api.getPageInfo()

// Unsafe Mode - Full browser access
(function(){ return document.title })()
```

### 📊 Advanced Debugging
- Console log capture
- Network request monitoring
- Performance metrics
- Error tracking with stack traces

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- Chrome/Chrome Canary
- Claude Desktop with MCP support

### Installation

#### Option 1: Quick Deploy Script
```bash
git clone https://github.com/david-strejc/browsermcp-enhanced.git
cd browsermcp-enhanced
./scripts/deploy
```

#### Option 2: Manual Installation

1. **Clone and build:**
```bash
git clone https://github.com/david-strejc/browsermcp-enhanced.git
cd browsermcp-enhanced
npm install
npm run build
```

2. **Install Chrome Extension:**
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `chrome-extension` folder

3. **Configure Claude Desktop:**

Add to `~/.claude/mcp_servers.json`:
```json
{
  "mcp-server-browsermcp-enhanced": {
    "command": "node",
    "args": ["/path/to/browsermcp-enhanced/dist/index.js"],
    "env": {
      "BROWSER_MCP_ALLOWED_ORIGINS": "*"
    }
  }
}
```

4. **Restart Claude Desktop**

## 📖 Usage

### Basic Navigation
```javascript
// Navigate to a URL
await browser_navigate({ url: "https://example.com" })

// Take a snapshot
await browser_snapshot()

// Click an element
await browser_click({ ref: "button-1", element: "Submit button" })
```

### JavaScript Execution

#### Safe Mode (Default)
```javascript
// Get text content
const result = await browser_execute_js({
  code: "return await api.getText('h1')"
})

// Check element existence
const exists = await browser_execute_js({
  code: "return await api.exists('#login-form')"
})

// Complex operations
const data = await browser_execute_js({
  code: `
    const title = await api.getText('h1');
    const hasForm = await api.exists('form');
    return { title, hasForm };
  `
})
```

#### Unsafe Mode (Advanced)
```javascript
// Direct DOM access (requires IIFE wrapper)
const result = await browser_execute_js({
  code: "(function(){ return document.title })()",
  unsafe: true
})

// Access framework internals
const vueData = await browser_execute_js({
  code: "(function(){ return document.querySelector('#app').__vue__.$data })()",
  unsafe: true
})
```

### Form Automation
```javascript
// Multi-step form filling
await browser_multitool({
  intent: "form_fill",
  snapshot: snapshotData,
  fields: {
    "username": "john.doe",
    "email": "john@example.com",
    "message": "Hello world"
  }
})
```

### Debugging
```javascript
// Attach debugger
await browser_debugger_attach({ domains: ["console", "network"] })

// Get console logs
const logs = await browser_debugger_get_data({ type: "console" })

// Monitor network
const requests = await browser_debugger_get_data({ type: "network" })
```

## 🔧 Advanced Configuration

### Environment Variables
```bash
# Allow all origins (development)
BROWSER_MCP_ALLOWED_ORIGINS="*"

# Specific origins (production)
BROWSER_MCP_ALLOWED_ORIGINS="https://example.com,https://app.example.com"

# Custom WebSocket port
BROWSER_MCP_PORT=8765
```

### Chrome Extension Options
1. Open extension popup
2. Configure:
   - Auto-reconnect intervals
   - Debug logging
   - Performance monitoring

## 📚 API Reference

### Core Tools
- `browser_navigate` - Navigate to URL
- `browser_snapshot` - Capture page state
- `browser_click` - Click elements
- `browser_type` - Type text
- `browser_execute_js` - Execute JavaScript

### Advanced Tools
- `browser_multitool` - Pattern-based automation
- `browser_debugger_*` - Debugging utilities
- `browser_tab_*` - Tab management

## 🧪 Testing

```bash
# Run tests
npm test

# Quick test
npm run test:quick

# With coverage
npm run test:coverage
```

## 🛠️ Development

```bash
# Watch mode
npm run watch

# Type checking
npm run typecheck

# Inspector
npm run inspector
```

## 📝 Changelog

See [CHANGELOG.md](CHANGELOG.md) for detailed version history.

### v1.0.0 (Latest)
- 🚀 First production-ready release
- ✅ RPC-based safe mode execution
- ✅ Sandboxed iframe isolation
- ✅ Comprehensive testing suite
- ✅ Full documentation

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Model Context Protocol](https://modelcontextprotocol.io) team for the MCP specification
- [Playwright](https://playwright.dev) for browser automation inspiration
- Claude and the o3 model for architectural guidance
- All contributors and testers

## 🐛 Known Issues

- WebSocket reconnection may require Chrome restart
- Some sites with strict CSP may require unsafe mode
- Safari and Firefox support coming in v2.0.0

## 📞 Support

- [Issues](https://github.com/david-strejc/browsermcp-enhanced/issues)
- [Discussions](https://github.com/david-strejc/browsermcp-enhanced/discussions)
- [Release Notes](https://github.com/david-strejc/browsermcp-enhanced/releases)

---

**Made with ❤️ by the BrowserMCP Enhanced Contributors**