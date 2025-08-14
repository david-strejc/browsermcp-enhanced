# Browser MCP - Two Components

## 1. MCP Server
📦 **Location:** `/home/david/.local/lib/browsermcp-enhanced/`
- **Running:** Via Claude's MCP integration (configured in `~/.claude/mcp_servers.json`)
- **Entry:** `/home/david/.local/lib/browsermcp-enhanced/dist/index.js`
- **After Updates:** 
  1. Bump version in `package.json`
  2. Build: `npm run build`
  3. Copy: `cp -r dist/* /home/david/.local/lib/browsermcp-enhanced/dist/`
  4. **ASK USER TO RESTART CLAUDE** - Required for new MCP code to load!

## 2. Chrome Extension
🔧 **Location:** `/home/david/.local/lib/browsermcp-enhanced/chrome-extension/`
- **Install:** Load unpacked in `chrome://extensions/`
- **Purpose:** Enables browser automation from MCP server
- **After Updates:** Run `chrome-canary-restart.sh` to restart browser & reload extension

## Test Server
🚀 `python3 -m http.server 8888` (from any test dir)

## Test Sites
- CodeMirror: https://codemirror.net/try/
- Monaco: https://microsoft.github.io/monaco-editor/playground.html
- Codewars: https://www.codewars.com/kata/search