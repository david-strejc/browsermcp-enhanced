# Codex MCP Image Handling Fix

## Problem
In `/tmp/codex/codex-rs/core/src/codex.rs`, the function `convert_call_tool_result_to_function_call_output_payload` (lines 3228-3261) converts ALL MCP content to JSON strings, destroying image structure.

## Current Code (BROKEN)
```rust
fn convert_call_tool_result_to_function_call_output_payload(
    call_tool_result: &CallToolResult,
) -> FunctionCallOutputPayload {
    // ...
    let content = if let Some(structured_content) = structured_content {
        serialized_structured_content
    } else {
        // THIS IS THE PROBLEM - converts everything to JSON string!
        match serde_json::to_string(&content) {
            Ok(serialized_content) => serialized_content,
            Err(err) => {
                is_success = false;
                err.to_string()
            }
        }
    };

    FunctionCallOutputPayload {
        content,  // This only supports String, not images!
        success: Some(is_success),
    }
}
```

## Root Cause
MCP returns images as:
```json
{
  "content": [
    {
      "type": "image",
      "data": "base64string",
      "mimeType": "image/jpeg"
    }
  ]
}
```

But Codex converts this to a STRING: `"[{\"type\":\"image\",...}]"` instead of treating it as an actual image!

## The Fix
We need to detect image content in MCP results and route them through Codex's existing image support system (`ContentItem::InputImage`) instead of stringifying them.

## Files Involved
- `/tmp/codex/codex-rs/core/src/codex.rs` - Contains the broken conversion
- `/tmp/codex/codex-rs/mcp-types/src/lib.rs` - Has proper ImageContent type
- `/tmp/codex/codex-rs/protocol/src/models.rs` - Has ContentItem::InputImage support

The infrastructure EXISTS for images, but MCP results bypass it entirely!
