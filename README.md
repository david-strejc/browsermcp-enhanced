# BrowserMCP Enhanced

[![MCP Server](https://img.shields.io/badge/MCP-Server-blue)](https://github.com/modelcontextprotocol)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-green)](https://developer.chrome.com/docs/extensions/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

🚀 **Advanced browser automation for AI agents** - A powerful Model Context Protocol (MCP) server that enables Claude and other AI assistants to interact with web browsers through a secure, token-optimized interface.

## ✨ Key Features & Improvements

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

### 🎭 Revolutionary Popup Detection
- **Intelligent popup detection** with simplified architecture
- **Smart hints** for AI agents (hasAcceptButton, hasRejectButton, etc.)
- **No auto-dismiss**: Let Claude decide how to handle popups
- **Multi-strategy detection**: Z-index, size, semantic patterns, attributes

### 🔒 Dual-Mode Code Execution
- **Safe Mode** (default): Sandboxed API with 20+ secure methods
- **Unsafe Mode**: Full browser access for advanced users (with warnings)
- **CSP-compliant** execution with comprehensive error handling
- **Configurable** via extension options or environment variables

### 🎛️ Complete Browser Control
- **Tab management** (list, switch, open, close)
- **Network monitoring** and request inspection
- **Console log** capture with real-time streaming
- **Screenshot** generation in high-quality PNG
- **Debugger integration** for advanced analysis

### 🧪 Comprehensive Testing Infrastructure
- **Enhanced test pages** with 15+ challenging element types
- **Advanced test server** with automatic port detection
- **Edge case coverage**: iframes, Shadow DOM, canvas, drag & drop
- **Real-world scenarios**: E-commerce, forms, media, APIs

### 🔧 Developer-Friendly Architecture
- **TypeScript** throughout with full type safety
- **Chrome Extension Manifest V3** compliance
- **WebSocket** for real-time communication
- **Comprehensive error handling** with detailed diagnostics

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

## 🧪 Comprehensive Testing

### Test Infrastructure Setup

1. **Start the test server**:
```bash
# Navigate to the enhanced directory
cd browsermcp-enhanced

# Start the Python test server (automatically finds available port)
python3 test-server.py
# Server will start on http://localhost:9000 (or next available port)
```

2. **Access test pages**:
- **Basic Test Page**: `http://localhost:9000/test-elements.html`
- **Enhanced Test Page**: `http://localhost:9000/test-elements-enhanced.html`

### Test Pages Overview

#### **Basic Test Page** (`test-elements.html`)
Covers fundamental web elements:
- Form inputs (text, email, password, number, date, etc.)
- Select dropdowns (single, multiple, optgroups)
- Checkboxes and radio buttons
- Buttons and links
- Textarea and basic interactions
- Progress bars and meters
- Tables and lists
- Simple drag & drop
- Modal popups
- Tabs and accordions

#### **Enhanced Test Page** (`test-elements-enhanced.html`)
Covers challenging edge cases and advanced elements:

**🖼️ iFrame Testing**:
- Same-origin iframes with interactive content
- Cross-origin iframes (security testing)
- Sandbox iframes with restricted permissions

**🎨 Canvas & Graphics**:
- Interactive drawing canvas with mouse events
- Color picker integration
- SVG elements with click interactions
- Dynamic shape generation

**📹 Media Elements**:
- Video controls (play, pause, volume, mute)
- Audio controls with custom interfaces
- Media event handling

**📁 Advanced File Upload**:
- Drag & drop file zones
- Image preview functionality
- File validation and size checking
- Multiple file selection

**✏️ Rich Text Editing**:
- Contenteditable areas with formatting
- Rich text toolbar (bold, italic, links)
- Content manipulation and extraction

**✅ Form Validation**:
- Real-time validation with ARIA feedback
- Complex validation rules
- Error state handling
- Accessibility features

**♿ ARIA Live Regions**:
- Dynamic content updates
- Screen reader compatibility
- Live announcements
- Status updates

**⏳ Loading States & Async Content**:
- Asynchronous content loading
- Progress tracking
- Loading spinners
- Error handling

**🖱️ Advanced Interactions**:
- Custom context menus
- Right-click event handling
- Virtual scrolling
- Infinite scroll patterns

**🌓 Shadow DOM & Web Components**:
- Custom web components
- Shadow DOM content
- Encapsulated styling
- Component interaction testing

**🌐 Browser API Testing**:
- Notification API
- Fullscreen API
- Geolocation API
- Print media queries

### Testing Procedures

#### **1. Basic Functionality Test**
```bash
# Navigate to basic test page
browser_navigate({ url: "http://localhost:9000/test-elements.html" })

# Take a snapshot to see all elements
browser_snapshot({ level: "full" })

# Test form interactions
browser_type({ ref: "ref1", text: "Test input", submit: false })
browser_select_option({ ref: "ref60", values: ["option2"] })
browser_click({ ref: "ref72" })  # Checkbox

# Take screenshot to verify
browser_screenshot()
```

#### **2. Advanced Element Testing**
```bash
# Navigate to enhanced test page
browser_navigate({ url: "http://localhost:9000/test-elements-enhanced.html" })

# Test canvas interaction
browser_click({ ref: "ref25" })  # Draw Circle button

# Test SVG interaction
browser_click({ ref: "ref32" })  # SVG circle (changes color)

# Test async content
browser_click({ ref: "ref113" })  # Load Async Content
browser_wait({ time: 3 })  # Wait for loading

# Test ARIA live regions
browser_click({ ref: "ref98" })  # Update Live Region
```

#### **3. Popup Detection Testing**
```bash
# Navigate to a site with popups (e.g., news sites)
browser_navigate({ url: "https://www.theguardian.com" })

# The enhanced popup detector will identify popups and provide instructions
# Look for messages like: "[POPUP DETECTED: .popup-container]"
# Follow the instruction to use browser_execute_js to dismiss
```

#### **4. Token Optimization Testing**
```bash
# Test scaffold mode on complex sites
browser_navigate({ url: "https://amazon.com" })
browser_snapshot({ mode: "scaffold" })  # Should be ~3,500 tokens instead of 58,000+

# Expand specific regions as needed
browser_expand_region({ ref: "ref45", maxTokens: 1000, depth: 2 })
```

#### **5. Code Execution Testing**
```bash
# Safe mode (default) - sandboxed API
browser_execute_js({ code: "return api.extractTable('table');" })
browser_execute_js({ code: "return api.count('button');" })
browser_execute_js({ code: "return api.getText('h1');" })

# Unsafe mode (if enabled) - full browser access
browser_execute_js({ code: "return document.title;", unsafe: true })
browser_execute_js({ code: "return window.location.href;", unsafe: true })
```

#### **6. Tab Management Testing**
```bash
# List current tabs
browser_tab_list()

# Open new tab
browser_tab_new({ url: "http://localhost:9000/test-elements.html" })

# Switch between tabs
browser_tab_select({ index: 1 })
browser_tab_select({ index: 0 })

# Close tab
browser_tab_close({ index: 1 })
```

#### **7. Debugging & Console Testing**
```bash
# Get console logs
browser_get_console_logs()

# Attach debugger for network monitoring
browser_debugger_attach({ domains: ["console", "network"] })

# Get debugging data
browser_debugger_get_data({ type: "console" })
browser_debugger_get_data({ type: "network" })

# Detach when done
browser_debugger_detach()
```

### Test Scenarios by Use Case

#### **E-commerce Testing**
- Product search and filtering
- Shopping cart interactions
- Checkout form completion
- Payment method selection
- Order confirmation

#### **Authentication Testing**
- Login form completion
- Social media OAuth flows
- Two-factor authentication
- Password reset flows
- Account creation

#### **Content Management Testing**
- Rich text editing
- File uploads and media
- Form validation
- Dynamic content updates
- User-generated content

#### **Data Extraction Testing**
- Table data extraction
- Product information scraping
- News article content
- Structured data parsing
- API response handling

## 🛠️ Available Tools

### Navigation & Basic Control

| Tool | Description | Enhanced Features |
|------|-------------|-------------------|
| `browser_navigate` | Navigate to a URL | Popup detection, loading state monitoring |
| `browser_go_back` | Go back to the previous page | History validation |
| `browser_go_forward` | Go forward to the next page | Forward availability check |
| `browser_wait` | Wait for specified time in seconds | Smart waiting with callbacks |
| `browser_press_key` | Press a keyboard key | Full keyboard support, modifiers |

### Page Interaction

| Tool | Description | Enhanced Features |
|------|-------------|-------------------|
| `browser_snapshot` | Capture page snapshot | Scaffold mode, token optimization |
| `browser_click` | Click on an element | Smart retry, visibility validation |
| `browser_hover` | Hover over an element | Tooltip detection, event simulation |
| `browser_type` | Type text into an input field | Auto-completion, validation feedback |
| `browser_select_option` | Select option(s) in a dropdown | Multi-select support, validation |

### Advanced Features

| Tool | Description | Enhanced Features |
|------|-------------|-------------------|
| `browser_execute_js` | Execute JavaScript code | Dual-mode execution, 20+ safe API methods |
| `browser_common_operation` | Pre-built operations | Enhanced error handling, more operations |
| `browser_expand_region` | Expand specific region | Token budget control, depth limiting |
| `browser_query_elements` | Query elements by criteria | Proximity search, text matching |
| `browser_screenshot` | Take high-quality screenshot | PNG format, optimized compression |

### Tab Management

| Tool | Description | Enhanced Features |
|------|-------------|-------------------|
| `browser_tab_list` | List all open browser tabs | Enhanced tab information |
| `browser_tab_select` | Select a tab by index | Validation, error handling |
| `browser_tab_new` | Open a new tab | Background/foreground options |
| `browser_tab_close` | Close a tab | Confirmation, undo support |

### Debugger Tools

| Tool | Description | Enhanced Features |
|------|-------------|-------------------|
| `browser_debugger_attach` | Attach debugger to tab | Selective domain monitoring |
| `browser_debugger_detach` | Detach debugger | Clean resource management |
| `browser_debugger_get_data` | Get debugging data | Structured data, filtering |
| `browser_get_console_logs` | Get console logs | Real-time streaming, filtering |

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

### Enhanced Components

1. **MCP Server** (`src/index.ts`)
   - Enhanced tool registration with validation
   - Improved WebSocket connection management
   - Advanced error handling and logging
   - Token optimization algorithms

2. **Chrome Extension**
   - **Background Script** (`background.js`): Enhanced message routing, popup detection
   - **Content Scripts**: Advanced DOM interaction, element tracking
   - **Popup Detector** (`popup-detector-simple.js`): Intelligent popup analysis
   - **Code Executors**: Safe and unsafe mode execution environments

3. **Element Tracking System**
   - `element-tracker.js`: Enhanced WeakMap-based references
   - `element-validator.js`: Comprehensive pre-action validation
   - `code-executor-safe.js`: 20+ sandboxed API methods

## ⚙️ Configuration

### Extension Options

Access via Chrome: Extension icon → Right-click → Options

- **Unsafe Mode**: Toggle between safe (sandboxed) and unsafe (full access) code execution
- **Server URL**: WebSocket server address (default: `ws://localhost:8765`)
- **Logging**: Enable/disable execution logging with detailed diagnostics
- **Confirmation**: Require confirmation for unsafe operations
- **Popup Detection**: Configure popup detection sensitivity

### Environment Variables

Set in `mcp_servers.json`:

| Variable | Description | Default |
|----------|-------------|---------|
| `BROWSERMCP_ENHANCED` | Enable enhanced features | `true` |
| `BROWSERMCP_UNSAFE_MODE` | Default code execution mode | `false` |
| `BROWSERMCP_DEBUG` | Enable debug logging | `false` |
| `BROWSERMCP_TOKEN_LIMIT` | Token limit for responses | `50000` |

## 🔒 Security

### Safe Mode (Default)
- **20+ sandboxed API methods** for common operations
- **No access** to cookies, storage, or network
- **No Chrome extension APIs** access
- **Perfect for general automation** with security guarantees
- **CSP-compliant** execution

### Safe Mode API Methods
```javascript
api.$('selector')              // Query single element
api.$$('selector')             // Query all elements
api.getText('selector')        // Get text content
api.getValue('selector')       // Get input value
api.click('selector')          // Click element
api.extractTable('selector')   // Extract table data
api.extractLinks('selector')   // Extract all links
api.count('selector')          // Count elements
api.exists('selector')         // Check existence
api.hide('selector')           // Hide elements
api.show('selector')           // Show elements
api.scrollTo('selector')       // Scroll to element
api.getPageInfo()             // Page metadata
// ... and 8 more methods
```

### Unsafe Mode
- **Full access** to window, document, fetch, and Chrome APIs
- **Complete browser control** for advanced automation
- **Use only with trusted code** and explicit user consent
- **Requires explicit enabling** in extension options

See [UNSAFE_MODE.md](./UNSAFE_MODE.md) for detailed security documentation.

## 📊 Performance & Token Optimization

### Scaffold Mode Benefits
- **90% token reduction**: 58,000+ → ~3,500 tokens
- **Faster processing**: Reduced AI processing time
- **Better cost efficiency**: Lower token usage costs
- **Improved reliability**: Less context window pressure

### Smart Features
- **Viewport filtering**: Focus on visible content only
- **Progressive disclosure**: Expand regions on demand
- **Intelligent truncation**: Preserve important content
- **Element prioritization**: Interactive elements first

## 🐛 Troubleshooting

### Extension shows "Disconnected"
1. Ensure MCP server is running (restart Claude)
2. Check WebSocket connection on port 8765
3. Verify Chrome extension is loaded and updated
4. Check console logs for connection errors

### "Invalid element reference"
- Page may have reloaded, references are reset
- Element may have been removed from DOM
- Try capturing a fresh snapshot
- Use query_elements for dynamic content

### Token limit issues
- Use scaffold mode for large sites: `browser_snapshot({ mode: "scaffold" })`
- Enable viewport-only snapshots
- Use expand_region for specific areas
- Consider query_elements for targeted searches

### Popup detection not working
1. Check popup detector is enabled in options
2. Verify popup meets detection criteria (size, z-index, etc.)
3. Try navigating to a fresh page
4. Check console for popup detection logs

### Code execution failures
1. Verify safe vs unsafe mode requirements
2. Check API method availability in safe mode
3. Review code for syntax errors
4. Ensure proper error handling

### Test server not starting
1. Check Python 3 installation
2. Verify port 9000 availability
3. Try different port with `python3 test-server.py --port 8080`
4. Check firewall settings

## 🎯 Known Limitations

### Current Restrictions
1. **Cross-origin iframe** content cannot be accessed (browser security)
2. **Closed Shadow DOM** elements are not accessible
3. **Native browser dialogs** (alerts, confirms) cannot be automated
4. **File downloads** require manual user interaction
5. **Other extensions** cannot be controlled directly

### Planned Improvements
- Enhanced file upload simulation
- Better drag & drop coordinate handling
- Shadow DOM piercing for open roots
- Recording mode for user interactions
- Plugin architecture for custom operations

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Update documentation
5. Submit a pull request

### Development Setup
```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Run tests
npm test

# Build for production
npm run build
```

## 📄 License

MIT License - See [LICENSE](./LICENSE) file for details

## 🙏 Acknowledgments

- Original [BrowserMCP](https://github.com/browsermcp/mcp) project
- [Model Context Protocol](https://github.com/modelcontextprotocol) by Anthropic
- Chrome Extension development community
- Testing and feedback contributors

## 🔗 Links

- [GitHub Repository](https://github.com/yourusername/browsermcp-enhanced)
- [Issue Tracker](https://github.com/yourusername/browsermcp-enhanced/issues)
- [MCP Documentation](https://github.com/modelcontextprotocol/docs)
- [Testing Guide](./TESTING.md)
- [Security Documentation](./UNSAFE_MODE.md)

---

**Built with ❤️ for the AI automation community**

*Last updated: August 2025 - Version 3.0.0*