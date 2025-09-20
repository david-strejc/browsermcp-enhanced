# Full-Page Screenshot Configuration Guide

## 🎉 New Feature: Full-Page Screenshots

Browser MCP now supports capturing **entire page height** screenshots, not just the visible viewport!

## How to Use

### Basic Full-Page Capture
```javascript
// In Claude Code or MCP client:
browser_screenshot captureMode="fullpage"
```

### With Custom Settings
```javascript
browser_screenshot captureMode="fullpage" fullPageScrollDelay=300 fullPageMaxHeight=15000
```

## Configuration Options

### Screenshot Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `captureMode` | `viewport`\|`fullpage`\|`region` | `viewport` | Capture mode |
| `fullPageScrollDelay` | number (100-2000) | 500 | Milliseconds to wait between scrolls |
| `fullPageMaxHeight` | number (1000-30000) | 20000 | Maximum height in pixels |
| `autoFullPage` | boolean | false | Auto-enable for Claude Code requests |

### Quality Settings

| Quality Preset | Resolution | Use Case |
|----------------|------------|----------|
| `high` | Original | Detailed analysis |
| `high-medium` | 1920px | Full HD captures |
| `medium-plus` | 1440px | Balance quality/size |
| `medium` | 1024px | Standard captures |
| `low` | 800px | Codex CLI/limited context |
| `ultra-low` | 512px | Minimal file size |

## Environment Configuration

### Enable Auto Full-Page for Claude Code
```bash
export BROWSER_MCP_CLAUDE_AUTO_FULLPAGE=true
```

### Configure Max Height
```bash
export BROWSER_MCP_FULLPAGE_MAX_HEIGHT=25000
```

### Configure Scroll Delay
```bash
export BROWSER_MCP_FULLPAGE_SCROLL_DELAY=750
```

## Examples

### 1. Capture Full Article Page
```javascript
browser_screenshot captureMode="fullpage" quality="medium" format="jpeg"
```

### 2. High-Quality Documentation Screenshot
```javascript
browser_screenshot captureMode="fullpage" quality="high" format="png"
```

### 3. Optimized for Codex CLI
```javascript
browser_screenshot captureMode="fullpage" quality="low" maxWidth=800 jpegQuality=60
```

### 4. Custom Region
```javascript
browser_screenshot captureMode="region" region={x: 100, y: 200, width: 800, height: 600}
```

## Implementation Details

### How Full-Page Capture Works
1. **Measure**: Calculates total page height
2. **Scroll**: Captures viewport-sized screenshots while scrolling
3. **Stitch**: Combines screenshots (currently returns last viewport)
4. **Restore**: Returns to original scroll position

### Current Limitations
- **Stitching**: Currently returns the last viewport instead of stitched image (TODO)
- **Infinite Scroll**: Limited by `fullPageMaxHeight` to prevent issues
- **Dynamic Content**: May miss content that loads on scroll

## Configuration File

Create `~/.browsermcp/config.json`:
```json
{
  "screenshot": {
    "claudeCode": {
      "autoFullPage": true,
      "defaultQuality": "medium-plus",
      "defaultFormat": "jpeg",
      "defaultJpegQuality": 85,
      "fullPageMaxHeight": 20000,
      "fullPageScrollDelay": 500
    },
    "defaults": {
      "quality": "medium",
      "format": "jpeg",
      "jpegQuality": 80,
      "captureMode": "viewport"
    }
  }
}
```

## Troubleshooting

### Screenshot Too Large
- Reduce `fullPageMaxHeight`
- Use lower quality preset
- Enable JPEG with lower quality

### Missing Dynamic Content
- Increase `fullPageScrollDelay`
- Use viewport mode for specific sections
- Consider multiple targeted captures

### Performance Issues
- Reduce `fullPageMaxHeight`
- Use `viewport` mode when full page not needed
- Lower quality settings for faster processing

## Future Enhancements
- [ ] Proper image stitching for seamless full-page captures
- [ ] Smart infinite scroll detection
- [ ] Lazy-loaded content detection
- [ ] Parallel viewport captures
- [ ] PDF export option
