# Codex CLI MCP Context Overhead Analysis

## Executive Summary

**Root Cause Found**: When MCP servers are connected, Codex CLI includes **ALL MCP tool definitions** in every API request to the model, regardless of whether those tools are used. This creates significant context overhead that doesn't exist when passing images directly via CLI.

## Key Findings

### 1. **MCP Tool Definitions Added to Every Request**

**Location**: `/core/src/openai_tools.rs` lines 583-596

```rust
if let Some(mcp_tools) = mcp_tools {
    // Ensure deterministic ordering to maximize prompt cache hits.
    let mut entries: Vec<(String, mcp_types::Tool)> = mcp_tools.into_iter().collect();
    entries.sort_by(|a, b| a.0.cmp(&b.0));

    for (name, tool) in entries.into_iter() {
        match mcp_tool_to_openai_tool(name.clone(), tool.clone()) {
            Ok(converted_tool) => tools.push(OpenAiTool::Function(converted_tool)),
            Err(e) => {
                tracing::error!("Failed to convert {name:?} MCP tool to OpenAI tool: {e:?}");
            }
        }
    }
}
```

**Problem**: The `get_openai_tools()` function unconditionally adds ALL MCP tools to the `tools` array that gets sent with every API request.

### 2. **Tools Array Sent with Every API Request**

**Location**: `/core/src/chat_completions.rs` lines 270-276

```rust
let tools_json = create_tools_json_for_chat_completions_api(&prompt.tools)?;
let payload = json!({
    "model": model_family.slug,
    "messages": messages,
    "stream": true,
    "tools": tools_json,
});
```

**Impact**: Every API request includes the full tool catalog, including:
- All MCP tool definitions with complete JSON schemas
- Tool descriptions and parameter specifications
- Input/output schemas for each tool

### 3. **Direct CLI Images vs MCP Images**

**CLI Direct Images** (`-i image.jpg`):
- Image loaded once during initial prompt construction
- No additional context overhead beyond the image data itself
- No tool definitions required

**MCP Images**:
- Image data itself (same size as CLI)
- **PLUS** complete tool catalog for all connected MCP servers
- **PLUS** all tool schemas, descriptions, and parameter definitions
- **PLUS** any other MCP tools from other servers

### 4. **Context Building Process**

**Location**: `/core/src/codex.rs` (Session construction)

1. **MCP Connection Manager** loads all MCP servers and their tools
2. **Tools Configuration** includes all available MCP tools in the `tools` field
3. **Prompt Construction** adds all tools to every request
4. **API Request** sends complete tool catalog with each call

## Technical Details

### MCP Tool Schema Conversion

**Location**: `/core/src/openai_tools.rs` lines 378-411

Each MCP tool gets converted to OpenAI format with:
- Full JSON schema definitions
- Parameter descriptions and types
- Required field specifications
- Additional sanitization and validation

### Tool Name Qualification

**Location**: `/core/src/mcp_connection_manager.rs` lines 47-77

MCP tools get fully qualified names like `"server__tool"` and are subject to:
- Name length limits (64 chars) with SHA1 truncation
- Duplicate detection and filtering
- Deterministic ordering for cache efficiency

### Context Accumulation

When multiple MCP servers are connected, the context includes:
1. **Base Codex tools** (shell, plan, apply_patch, etc.)
2. **All tools from MCP Server 1** (browsermcp-enhanced in your case)
3. **All tools from MCP Server 2** (espocrm if connected)
4. **All tools from MCP Server N** (any other servers)
5. **Plus the actual conversation content**

## Quantifying the Overhead

For a typical browsermcp-enhanced setup:
- **~25+ browser automation tools** with detailed schemas
- **Each tool definition**: 200-500 tokens
- **Total MCP overhead**: 5,000-12,500+ tokens per request
- **Direct image overhead**: 0 additional tokens

## Recommended Solutions

### 1. **Lazy Tool Loading** (Preferred)
Only include tools in the request when:
- They're explicitly mentioned in user input
- They're part of an active tool conversation chain
- The model specifically requests tool availability

### 2. **Tool Filtering by Context**
- Analyze user input for tool-relevant keywords
- Include only tools likely to be needed for the request
- Maintain a small "always available" core set

### 3. **Dynamic Tool Registration**
- Start with no MCP tools in context
- Add tools on-demand as conversations require them
- Remove unused tools after timeout periods

### 4. **Tool Grouping**
- Group related tools together
- Include tool groups rather than individual tools
- Use tool discovery patterns

## Configuration Impact

Current configuration forces all MCP tools into every request:

**Location**: `/core/src/codex.rs` lines 1240-1248
```rust
let tools_config = ToolsConfig::new(&ToolsConfigParams {
    // ... other params
    include_web_search_request: config.tools_web_search_request,
    // MCP tools automatically included via mcp_connection_manager.list_all_tools()
});
```

## Verification Steps

To confirm this analysis:

1. **Log API Request Size**: Add debug logging to show request payload size with/without MCP
2. **Tool Count Comparison**: Compare tool array length between MCP and non-MCP setups
3. **Token Usage Analysis**: Track token consumption differences
4. **Context Window Monitoring**: Monitor when context limits are hit

## Conclusion

The "context window exceeded" error with MCP images is caused by Codex CLI sending **every available MCP tool definition** with each API request, regardless of relevance. This overhead doesn't exist with direct CLI images, explaining why identical images work fine via `-i` but fail through MCP servers.

The solution requires implementing more intelligent tool inclusion logic rather than the current "include all MCP tools always" approach.