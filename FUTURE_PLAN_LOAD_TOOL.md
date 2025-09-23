# Future Plan: Browser Script Load Tool

## Overview
A new MCP tool `browser_load_script` that loads and executes pre-prepared JavaScript files/scripts in either safe or unsafe mode, extending the current `browser_execute_js` architecture.

## Current Architecture Analysis

### Existing Execution Modes
1. **Safe Mode (default)**: Uses sandboxed API (`MCPSafeAPI`) with limited DOM access
   - Read-only queries: `api.$()`, `api.$$()`, `api.getText()`, `api.exists()`
   - Safe manipulations: `api.click()`, `api.setValue()`, `api.hide()`, `api.show()`
   - Data extraction: `api.extractTable()`, `api.extractLinks()`
   - No direct access to `document`, `window`, or `eval`

2. **Unsafe Mode**: Full DOM access with IIFE wrapper requirement
   - Direct access to `document`, `window`, global scope
   - Must wrap code in `(function(){...})()`
   - Controlled by `unsafe: true` parameter or env var `BROWSERMCP_UNSAFE_MODE`

### Existing Script Storage
- `browser_common_operation` tool already stores pre-built scripts:
  - `hide_popups`, `remove_ads`, `extract_all_text`
  - `extract_all_links`, `scroll_to_bottom`, etc.
- Scripts are hardcoded in `src/tools/code-execution.ts`

## Proposed Load Tool Design

### Tool Schema
```typescript
browser_load_script: {
  name: "browser_load_script",
  description: "Load and execute pre-prepared scripts from files or library",
  arguments: {
    source: {
      type: "string",
      enum: ["file", "library", "inline"],
      description: "Source of the script"
    },
    path: {
      type: "string",
      description: "File path or library script name"
    },
    script: {
      type: "string",
      description: "Inline script (when source='inline')"
    },
    mode: {
      type: "string",
      enum: ["safe", "unsafe", "auto"],
      default: "auto",
      description: "Execution mode"
    },
    params: {
      type: "object",
      description: "Parameters to pass to the script"
    },
    timeout: {
      type: "number",
      default: 5000,
      description: "Execution timeout in ms"
    }
  }
}
```

### Script Library Structure
```
/scripts/
├── safe/           # Safe mode scripts
│   ├── forms/
│   │   ├── auto-fill.js
│   │   └── validate.js
│   ├── extraction/
│   │   ├── tables.js
│   │   └── links.js
│   └── navigation/
│       ├── scroll.js
│       └── pagination.js
├── unsafe/         # Unsafe mode scripts
│   ├── auth/
│   │   ├── oauth-flow.js
│   │   └── token-extract.js
│   ├── automation/
│   │   └── complex-flow.js
│   └── scraping/
│       └── dynamic-content.js
└── manifest.json   # Script metadata & descriptions
```

### Script Format Requirements

#### Safe Mode Scripts
```javascript
// scripts/safe/forms/auto-fill.js
/**
 * @description Auto-fill form with provided data
 * @param {Object} data - Field values to fill
 * @returns {Object} Result with filled fields
 */
async function execute(api, params) {
  const filled = [];
  for (const [field, value] of Object.entries(params.data || {})) {
    if (await api.setValue(`[name="${field}"]`, value)) {
      filled.push(field);
    }
  }
  return { filled, count: filled.length };
}
```

#### Unsafe Mode Scripts
```javascript
// scripts/unsafe/auth/oauth-flow.js
/**
 * @description Handle OAuth authentication flow
 * @param {Object} config - OAuth configuration
 * @returns {Object} Auth tokens
 */
(function(params) {
  const config = params.config || {};
  // Direct DOM/window access
  const authWindow = window.open(config.authUrl);
  // ... OAuth flow logic
  return { token: extractedToken };
})(SCRIPT_PARAMS);
```

### Implementation Features

#### 1. Script Discovery & Metadata
- `browser_list_scripts`: List available scripts with descriptions
- Categorization by use case (forms, extraction, navigation, auth)
- Script documentation with examples

#### 2. Parameter Injection
- Safe mode: Pass params to `execute()` function
- Unsafe mode: Replace `SCRIPT_PARAMS` placeholder
- Type validation based on manifest

#### 3. Mode Auto-Detection
```javascript
function detectMode(scriptContent) {
  // Check for unsafe patterns
  const unsafePatterns = [
    /window\./,
    /document\./,
    /eval\(/,
    /Function\(/,
    /\.cookie/,
    /localStorage/
  ];

  return unsafePatterns.some(p => p.test(scriptContent))
    ? 'unsafe' : 'safe';
}
```

#### 4. Security Controls
- Script validation before execution
- Whitelist of allowed file paths
- Content Security Policy compliance
- Audit logging for unsafe executions

#### 5. Error Handling
```javascript
try {
  const result = await loadAndExecute(script, mode, params);
  return { success: true, result };
} catch (error) {
  return {
    success: false,
    error: error.message,
    hint: getErrorHint(error, script, mode)
  };
}
```

### Usage Examples

#### Load from Library
```javascript
// Load safe script from library
await browser_load_script({
  source: "library",
  path: "forms/auto-fill",
  mode: "safe",
  params: {
    data: {
      username: "user@example.com",
      password: "****"
    }
  }
});
```

#### Load from File
```javascript
// Load custom script from file
await browser_load_script({
  source: "file",
  path: "./automation/checkout-flow.js",
  mode: "auto", // Auto-detect based on content
  params: {
    items: ["item1", "item2"],
    shipping: "express"
  }
});
```

#### Inline Script
```javascript
// Execute inline script
await browser_load_script({
  source: "inline",
  script: "return await api.getText('h1');",
  mode: "safe"
});
```

### Migration Path

1. **Phase 1**: Implement basic load tool with file/inline support
2. **Phase 2**: Extract existing `browser_common_operation` scripts to library
3. **Phase 3**: Add script discovery and metadata
4. **Phase 4**: Community script repository integration

### Benefits

1. **Reusability**: Scripts can be shared and versioned
2. **Maintainability**: Centralized script management
3. **Safety**: Clear separation of safe/unsafe scripts
4. **Extensibility**: Easy to add new scripts without code changes
5. **Debugging**: Better error messages with script context
6. **Documentation**: Scripts self-document with JSDoc

### Technical Considerations

1. **File Access**: Need to handle file reading in MCP server context
2. **Caching**: Cache loaded scripts to improve performance
3. **Hot Reload**: Watch script files for development
4. **Testing**: Automated testing framework for scripts
5. **Versioning**: Handle script version compatibility

### Security Considerations

1. **Path Traversal**: Validate file paths to prevent access outside allowed dirs
2. **Code Injection**: Sanitize parameters before injection
3. **Execution Context**: Ensure proper isolation between scripts
4. **Audit Trail**: Log all script executions with parameters
5. **Permission Model**: Optional per-script permission requirements

## Next Steps

1. Create proof-of-concept with basic file loading
2. Design script library structure and manifest format
3. Implement mode auto-detection logic
4. Extract and refactor existing common operations
5. Add comprehensive error handling and hints
6. Create documentation and examples
7. Implement security controls and validation
8. Add testing framework for scripts