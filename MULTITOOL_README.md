# BrowserMCP Multitool 🎯

## Overview

The **browser_multitool** is an intelligent wrapper that combines multiple browser operations into single, efficient calls. It automatically detects patterns, handles errors gracefully, and saves 70-90% of tokens compared to individual tool calls.

## Why Use Multitool?

### Traditional Approach (Many Tokens)
```javascript
// 5 separate tool calls = ~500 tokens
await browser_navigate({ url: "https://example.com" });
await browser_snapshot();
await browser_type({ ref: "username_field", text: "john@example.com" });
await browser_type({ ref: "password_field", text: "mypassword" });
await browser_click({ ref: "submit_button" });
```

### Multitool Approach (Few Tokens)
```javascript
// 1 tool call = ~100 tokens
await browser_multitool({
  username: "john@example.com",
  password: "mypassword"
});
```

## Key Features

- **🤖 Smart Pattern Detection**: Automatically identifies the operation type from parameters
- **🔍 Intelligent Field Matching**: Finds form fields by label, placeholder, name, or type
- **♻️ Built-in Error Recovery**: Automatic retries and graceful degradation
- **⏱️ Optimized Execution**: Faster than sequential individual tool calls
- **📊 Structured Results**: Clear success/error reporting with detailed action logs

## Available Patterns

### 1. Form Fill (`form_fill`)
Fill and submit any form with smart field detection.

```javascript
{
  "fields": {
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "555-1234",
    "message": "Hello world"
  },
  "submitButton": "send",
  "skipMissingFields": true,
  "waitBetween": 0.5
}
```

### 2. Login (`login`)
Complete authentication flows with username/password.

```javascript
{
  "username": "user@example.com",
  "password": "securePassword123",
  "rememberMe": true
}
```

### 3. Search (`search`)
Perform searches and wait for results.

```javascript
{
  "query": "machine learning tutorials",
  "waitForResults": 3,
  "resultSelector": ".search-result"
}
```

### 4. Navigation Sequence (`navigation_sequence`)
Execute multi-step navigation flows.

```javascript
{
  "steps": [
    {"type": "navigate", "url": "https://example.com"},
    {"type": "click", "ref": "menu_btn"},
    {"type": "wait", "duration": 2},
    {"type": "click", "ref": "products_link"}
  ]
}
```

### 5. Dismiss Modals (`dismiss_modals`)
Close popups, cookie banners, and overlays.

```javascript
{
  "dismissTexts": ["Accept", "OK", "Close"],
  "escapeKey": true
}
```

### 6. Infinite Scroll (`infinite_scroll`)
Scroll through content to find specific text.

```javascript
{
  "targetText": "Terms of Service",
  "maxScrolls": 10,
  "scrollDelay": 1
}
```

### 7. Data Extraction (`extract_data`)
Extract structured data from pages.

```javascript
{
  "selectors": {
    "title": "h1",
    "price": ".product-price",
    "description": ".product-desc",
    "reviews": ".review-count"
  }
}
```

## Smart Features

### Auto-Detection
The tool automatically detects which pattern to use:
- Has `username` + `password` → **login**
- Has `query` → **search**
- Has `fields` object → **form_fill**
- Has `steps` array → **navigation_sequence**
- Has `selectors` → **extract_data**

### Field Matching Algorithm
The tool scores potential matches based on:
1. **Exact ID match** (highest score)
2. **Name attribute match**
3. **Placeholder text**
4. **Label association**
5. **ARIA labels**
6. **Type hints** (email, password, search)

### Error Recovery
- **maxRetries**: Retry failed operations (default: 1)
- **skipMissingFields**: Continue if some fields aren't found
- **stopOnError**: Stop immediately on first error
- **rollbackOnError**: Restore previous state on failure

## Common Parameters

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `pattern` | string | Force specific pattern (auto-detected if not set) | `"auto"` |
| `maxRetries` | number | Maximum retry attempts | `1` |
| `waitBetween` | number | Seconds to wait between actions | `0` |
| `skipMissingFields` | boolean | Continue if fields not found | `false` |
| `stopOnError` | boolean | Stop on first error | `true` |
| `checkpoints` | boolean | Save state at checkpoints | `false` |

## Response Format

```javascript
{
  "status": "success" | "partial" | "error",
  "pattern": "detected_pattern",
  "actionsTaken": [
    "type:username",
    "type:password", 
    "click:submit"
  ],
  "errors": [
    {"code": "field_not_found", "detail": "phone"}
  ],
  "nextHint": "2fa_required",
  "content": [/* snapshot data */]
}
```

## Real-World Examples

### E-commerce Checkout
```javascript
await browser_multitool({
  pattern: "form_fill",
  fields: {
    "shipping_name": "John Doe",
    "shipping_address": "123 Main St",
    "shipping_city": "New York",
    "shipping_state": "NY",
    "shipping_zip": "10001",
    "card_number": "4111111111111111",
    "card_expiry": "12/25",
    "card_cvv": "123"
  },
  submitButton: "place_order",
  waitBetween: 1
});
```

### GitHub Login
```javascript
await browser_multitool({
  username: "your-username",
  password: "your-password"
});
// Auto-detects login pattern!
```

### Google Search
```javascript
await browser_multitool({
  query: "BrowserMCP automation",
  waitForResults: 3
});
// Auto-detects search pattern!
```

### Complex Registration
```javascript
await browser_multitool({
  fields: {
    "firstName": "Jane",
    "lastName": "Smith",
    "email": "jane@example.com",
    "confirmEmail": "jane@example.com",
    "password": "SecurePass123!",
    "confirmPassword": "SecurePass123!",
    "birthDate": "01/15/1990",
    "agreeTerms": "true"
  },
  submitButton: "register",
  maxRetries: 3,
  skipMissingFields: false
});
```

## Tips for AI Agents

1. **Let auto-detection work**: Don't specify `pattern` unless necessary
2. **Use semantic field names**: The tool understands variations like email/username
3. **Enable retries for flaky pages**: Set `maxRetries: 3`
4. **Add delays for slow sites**: Use `waitBetween: 1`
5. **Handle optional fields**: Set `skipMissingFields: true`
6. **Check return status**: Look for `partial` status indicating some fields failed

## Performance Metrics

| Operation | Individual Tools | Multitool | Savings |
|-----------|-----------------|-----------|---------|
| Simple Login | 5 calls, ~500 tokens | 1 call, ~100 tokens | 80% |
| Complex Form | 15 calls, ~1500 tokens | 1 call, ~300 tokens | 80% |
| Navigation Flow | 8 calls, ~800 tokens | 1 call, ~200 tokens | 75% |
| Data Extraction | 10 calls, ~1000 tokens | 1 call, ~150 tokens | 85% |

## Troubleshooting

### Field Not Found
- Check if field names match actual HTML attributes
- Try alternative names (e.g., "email" vs "username")
- Enable `skipMissingFields` for optional fields

### Pattern Not Detected
- Explicitly set `pattern` parameter
- Ensure parameters match pattern requirements

### Slow Execution
- Increase `waitBetween` for slow-loading pages
- Add explicit wait steps in navigation sequences

### Authentication Failures
- Check for 2FA requirements (look for `nextHint`)
- Verify credentials are correct
- Some sites may require additional steps

## Advanced Usage

### Multi-Step Workflows
For complex workflows with conditions:

```javascript
{
  "pattern": "multi_step_workflow",
  "workflow": {
    "stages": [
      {
        "name": "Login",
        "actions": [/* login actions */],
        "verify": {"selector": ".user-menu"}
      },
      {
        "name": "Navigate",
        "actions": [/* navigation */],
        "condition": {"type": "element_exists", "selector": ".products"}
      },
      {
        "name": "Purchase",
        "actions": [/* purchase flow */],
        "required": true
      }
    ]
  },
  "checkpoints": true,
  "rollbackOnError": true
}
```

### Rate-Limited Operations
For APIs with rate limits:

```javascript
{
  "pattern": "rate_limited",
  "actions": [/* array of actions */],
  "requestsPerWindow": 2,
  "windowSize": 5000,
  "retryAfter": 4000
}
```

## Integration

The multitool is automatically available when BrowserMCP is installed. It appears as `browser_multitool` in the tools list and should be preferred over individual browser tools for supported operations.

## Contributing

To add new patterns or improve existing ones:

1. Implement the pattern in `/src/tools/multitool.ts`
2. Add pattern detection logic
3. Create test cases in `/src/multitool-tests.ts`
4. Update this documentation

## Support

For issues or questions:
- Check the examples in this document
- Review test cases in `multitool-tests.ts`
- Open an issue on GitHub

---

**Remember**: The multitool is designed to make browser automation simpler, faster, and more reliable. When in doubt, try the multitool first!