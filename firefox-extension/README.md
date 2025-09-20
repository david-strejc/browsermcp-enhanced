# BrowserMCP Enhanced Firefox Extension

A Firefox port of the BrowserMCP Enhanced Chrome extension, providing browser automation capabilities through MCP (Model Context Protocol) server integration.

## Features

### Core Functionality
- **WebSocket MCP Integration**: Connects to MCP server at `ws://localhost:8765`
- **DOM Automation**: Click, type, hover, select, and interact with web elements
- **Navigation Control**: Navigate URLs, go back/forward in history
- **Tab Management**: Create, close, switch between tabs
- **Screenshot Capture**: Capture visible tab as JPEG
- **Console Log Capture**: Track and retrieve console logs from pages
- **Accessibility Snapshots**: Generate structured page representations

### Advanced Features
- **Element Tracking System**: Stable element references using WeakMap/WeakRef
- **Smart Click Detection**: Identifies OAuth/popup triggers for special handling
- **Popup Detection**: Automatically detects and categorizes popups/modals
- **Code Execution**: Safe sandboxed JavaScript execution with RPC
- **Common Operations**: Hide popups, remove ads, extract data, etc.

### Firefox-Specific Adaptations
- **Manifest V2**: Uses Firefox's WebExtension manifest format
- **Background Script**: Traditional persistent background page (not service worker)
- **Browser API**: Compatible with both `browser.*` and `chrome.*` namespaces
- **Trusted Clicks**: Alternative implementation without Chrome Debugger API

## Installation

### Prerequisites
1. Firefox Browser (version 78.0 or higher)
2. MCP server running at `ws://localhost:8765`

### Steps
1. Open Firefox and navigate to `about:debugging`
2. Click "This Firefox" in the left sidebar
3. Click "Load Temporary Add-on"
4. Navigate to the `firefox-extension` directory
5. Select the `manifest.json` file
6. The extension icon will appear in the toolbar

### Permanent Installation (Developer)
1. Package the extension:
   ```bash
   cd firefox-extension
   zip -r ../browsermcp-firefox.xpi *
   ```
2. Sign the extension through [addons.mozilla.org](https://addons.mozilla.org)
3. Install the signed XPI file

## Configuration

### Options Page
1. Click the extension icon and select "Options"
2. Configure:
   - **Server URL**: MCP server WebSocket endpoint (default: `ws://localhost:8765`)
   - **Unsafe Mode**: Enable direct JavaScript execution (use with caution)

### Storage Settings
Settings are stored in Firefox's local storage and persist across sessions.

## Architecture

### Component Structure
```
firefox-extension/
├── manifest.json              # Firefox WebExtension manifest
├── background.js              # Main background script
├── content.js                 # Content script for all pages
├── Core Scripts:
│   ├── element-tracker.js    # Element reference management
│   ├── element-validator.js  # Element validation and interaction
│   ├── code-executor-rpc.js  # Safe code execution sandbox
│   └── popup-detector-simple.js # Popup/modal detection
├── Enhanced Features:
│   ├── click-detection.js    # OAuth/popup click analysis
│   ├── minimal-enhanced.js   # Accessibility snapshot generator
│   ├── scaffold-enhanced.js  # Scaffold mode capture
│   └── accessibility-utils.js # Helper utilities
├── UI Components:
│   ├── popup.html/js         # Extension popup
│   └── options.html/js       # Settings page
└── Icons:
    └── icon-*.png            # Extension icons
```

### Communication Flow
```
MCP Server <-WebSocket-> Background Script <-Messages-> Content Scripts <-DOM-> Web Page
```

## API Differences from Chrome Version

### Removed Features (Chrome-specific)
- **Chrome Debugger API**: No access to Chrome DevTools Protocol
- **Trusted Click via CDP**: Uses alternative native event simulation
- **Service Worker**: Uses traditional background page
- **chrome.scripting API**: Uses older `tabs.executeScript` pattern

### Alternative Implementations
1. **Trusted Clicks**:
   - Chrome: Uses debugger API for true trusted events
   - Firefox: Native MouseEvent dispatch or new tab for OAuth

2. **Code Execution**:
   - Chrome: Can use debugger API for CSP bypass
   - Firefox: Sandboxed iframe with RPC only

3. **Navigation**:
   - Chrome: `debugger.sendCommand` for back/forward
   - Firefox: `tabs.goBack()`/`tabs.goForward()` or script injection

## Message Protocol

### Background ↔ Content Script
```javascript
// Request from background
browser.tabs.sendMessage(tabId, {
  action: 'click',
  ref: 'ref123',
  element: 'Submit button'
});

// Response from content
{ success: true }
```

### Available Actions
- `click`, `type`, `hover`, `selectOption`, `pressKey`
- `getConsoleLogs`, `detectPopups`, `snapshot`
- `executeCode`, `commonOperation`
- `checkClickType`, `getElementUrl`, `trustedClick`

## Development

### Testing Locally
1. Make changes to the extension files
2. Go to `about:debugging` → "This Firefox"
3. Click "Reload" next to the extension
4. Test your changes

### Debugging
1. Open Browser Console: `Ctrl+Shift+J`
2. Filter by extension messages
3. Check background script logs
4. Use `console.log()` in content scripts

### Building for Production
```bash
# Validate manifest
npm install -g web-ext
web-ext lint

# Build unsigned package
web-ext build

# Run in Firefox for testing
web-ext run
```

## Limitations

### Firefox-Specific Constraints
1. **No Debugger Protocol**: Cannot perform low-level browser automation
2. **CSP Restrictions**: Cannot bypass Content Security Policy like Chrome
3. **Permission Model**: Some APIs require explicit user interaction
4. **Sandboxing**: Stricter content script isolation

### Workarounds
- OAuth flows open in new tabs instead of trusted clicks
- Code execution limited to safe RPC mode
- Some sites may require manual intervention

## Troubleshooting

### Extension Not Connecting
1. Check MCP server is running at configured URL
2. Verify WebSocket port is not blocked
3. Check browser console for errors
4. Try reconnecting via popup

### Elements Not Found
1. Ensure page is fully loaded
2. Check element tracker is initialized
3. Verify selectors are correct
4. Try refreshing the page

### Code Execution Fails
1. Check for unsafe patterns in code
2. Enable unsafe mode if needed (with caution)
3. Verify sandbox iframe is created
4. Check browser console for errors

## Security Considerations

### Safe Mode (Default)
- Code execution in sandboxed iframe
- Limited DOM access through RPC
- No access to global objects
- Pattern-based safety analysis

### Unsafe Mode (Optional)
- Direct code execution in page context
- Full access to DOM and globals
- Potential security risks
- Only use with trusted code

## Performance

### Optimizations
- Element reference caching with WeakMap
- Execution time budgets (100ms for captures)
- Viewport-based rendering
- Console log limiting (1000 entries max)
- Automatic garbage collection

### Memory Management
- WeakRef for element tracking
- Periodic cleanup of stale references
- Limited message queue size
- Iframe sandbox recycling

## Compatibility

### Supported Firefox Versions
- Minimum: Firefox 78.0 (ESR)
- Recommended: Firefox 115+ (Latest ESR)
- Tested on: Firefox Developer Edition

### Website Compatibility
- Works on most websites
- CSP-protected sites may have limitations
- Some features require user gesture simulation
- OAuth flows handled via new tabs

## Contributing

### Reporting Issues
1. Check existing issues on GitHub
2. Provide Firefox version and OS
3. Include console logs and error messages
4. Describe steps to reproduce

### Development Guidelines
1. Maintain compatibility with both `browser` and `chrome` APIs
2. Test on multiple Firefox versions
3. Follow WebExtension best practices
4. Document Firefox-specific workarounds

## License

Same as the original BrowserMCP Enhanced project.

## Acknowledgments

This Firefox port is based on the BrowserMCP Enhanced Chrome extension, adapting its innovative features for Firefox's WebExtension platform while maintaining core functionality and user experience.

## Version History

### 1.1.0 (Firefox Port)
- Initial Firefox port from Chrome extension
- Adapted manifest to Firefox WebExtension format
- Replaced Chrome-specific APIs with Firefox equivalents
- Implemented alternative trusted click mechanism
- Maintained core automation functionality

## Support

For issues specific to the Firefox version, please mention "Firefox" in your bug reports to help with troubleshooting.