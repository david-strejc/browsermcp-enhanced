# BrowserMCP Enhanced - Unsafe Mode Documentation

## ⚠️ Security Warning

Unsafe mode provides **FULL ACCESS** to the browser context, including:
- All cookies and local storage
- Network requests (fetch, XHR)
- Chrome extension APIs
- Complete DOM manipulation
- Access to sensitive data

**Only enable unsafe mode if you fully trust the code source!**

## Configuration Methods

### 1. Chrome Extension Options (User Control)

1. Click the extension icon in Chrome
2. Right-click and select "Options"
3. Toggle "Enable Unsafe Mode"
4. Save settings

The extension will show warnings when unsafe mode is active.

### 2. MCP Server Configuration (System-wide)

Edit `~/.claude/mcp_servers.json`:

```json
{
  "mcpServers": {
    "browsermcp": {
      "command": "node",
      "args": ["/home/david/.local/lib/browsermcp-enhanced/dist/index.js"],
      "env": {
        "BROWSERMCP_ENHANCED": "true",
        "BROWSERMCP_UNSAFE_MODE": "true"  // Set to "true" for unsafe mode
      }
    }
  }
}
```

**Priority Order:**
1. Explicit tool parameter (`unsafe: true`)
2. Chrome extension setting
3. Environment variable
4. Default (safe mode)

### 3. Per-Execution Control (Tool Parameter)

When using the tool, you can override the default:

```javascript
// Force safe mode even if unsafe is configured
browser_execute_js({ 
  code: "...", 
  unsafe: false 
})

// Force unsafe mode (if allowed by config)
browser_execute_js({ 
  code: "...", 
  unsafe: true 
})
```

## Mode Comparison

### Safe Mode (Default)
```javascript
// Limited API - sandboxed functions only
return api.getText('h1');
return api.click('#button');
return api.extractLinks();
```

**Available:**
- Sandboxed API methods
- Limited DOM interaction
- No network access
- No cookie access
- No Chrome APIs

### Unsafe Mode
```javascript
// Full browser access
return document.cookie;
return await fetch('https://api.example.com/data').then(r => r.json());
chrome.runtime.sendMessage({...});
window.localStorage.setItem('key', 'value');
```

**Available:**
- Full `window` object
- Complete `document` access
- `fetch` and `XMLHttpRequest`
- `chrome.*` APIs (if available)
- All browser features

## Security Best Practices

### When to Use Safe Mode
- General web scraping
- UI automation
- Data extraction
- Testing
- Most automation tasks

### When Unsafe Mode Might Be Needed
- Debugging complex issues
- Accessing authenticated APIs
- Working with browser extensions
- Advanced automation requiring full control
- Development/testing environments

### Security Checklist
- [ ] Is unsafe mode absolutely necessary?
- [ ] Do you trust the code source?
- [ ] Are you on a secure, isolated environment?
- [ ] Have you reviewed the code being executed?
- [ ] Is logging enabled for audit trails?

## Visual Indicators

The extension provides clear visual feedback:

- **Options Page**: Shows "SAFE" or "UNSAFE" badge
- **Console Logs**: Warnings when executing in unsafe mode
- **Extension Icon**: Different colors for different states

## Logging and Auditing

When enabled in options:
- All code executions are logged
- Timestamps and mode are recorded
- Can require confirmation for unsafe executions

## Examples

### Safe Mode Example (Default)
```javascript
// Extract all email addresses from the page
const emails = api.$$('a[href^="mailto:"]').map(a => 
  a.href.replace('mailto:', '')
);
return { found: emails.length, emails: emails };
```

### Unsafe Mode Example (When Needed)
```javascript
// Access authenticated API using page cookies
const response = await fetch('/api/user/profile', {
  credentials: 'include',
  headers: {
    'X-CSRF-Token': document.querySelector('[name="csrf-token"]').content
  }
});
return await response.json();
```

## Troubleshooting

### "Unsafe mode not working"
1. Check Chrome extension options
2. Verify MCP server configuration
3. Restart Claude after config changes
4. Check console for security warnings

### "Code works in unsafe but not safe mode"
- Review which APIs you're using
- Migrate to sandboxed API equivalents
- Consider if unsafe mode is truly needed

## Reverting to Safe Mode

To disable unsafe mode completely:

1. **Extension**: Options → Uncheck "Enable Unsafe Mode"
2. **MCP Config**: Set `BROWSERMCP_UNSAFE_MODE: "false"`
3. **Restart**: Reload extension and restart Claude

## Support

For security concerns or questions about unsafe mode, please open an issue on the GitHub repository with the `security` label.