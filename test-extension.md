# Chrome Extension Installation Test

## Quick Installation Check

1. **Check manifest.json is valid:**
```bash
# Run this command to validate JSON syntax
python3 -m json.tool chrome-extension/manifest.json > /dev/null && echo "✅ Manifest JSON is valid" || echo "❌ Manifest JSON has errors"
```

2. **Check all required files exist:**
```bash
# Run this script to verify all files referenced in manifest exist
cd chrome-extension
for file in background.js element-tracker.js element-validator.js content.js popup.html popup.js; do
  if [ -f "$file" ]; then
    echo "✅ $file exists"
  else
    echo "❌ $file is missing!"
  fi
done
```

## Manual Installation Test

1. Open Chrome and navigate to: `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the folder: `/home/david/Work/Programming/newbrowsermcp/browsermcp-enhanced/chrome-extension`

## Expected Results

If successful, you should see:
- Extension appears in the list as "BrowserMCP Enhanced"
- No errors shown (if errors, click "Errors" button to see details)
- Extension icon appears in toolbar (might be in puzzle piece menu)

## Common Issues & Fixes

### Issue: "Manifest file is missing or unreadable"
**Fix:** Ensure you selected the `chrome-extension` folder, not the parent folder

### Issue: "Cannot load extension with file or directory name _metadata"
**Fix:** Remove any _metadata folders that Chrome might have created

### Issue: Script errors in console
**Fix:** Open Chrome DevTools on any page and check Console for errors from the extension

### Issue: Icons not showing
**Fix:** The placeholder icon files are just text. Chrome will use default icon, but extension still works

## Test WebSocket Connection

After installation:
1. Click the extension icon
2. Click "Connect" in popup
3. Check if status changes to "Connected"

If connection fails:
- Ensure MCP server is running on port 8765
- Check Chrome DevTools → Network → WS tab for WebSocket errors

## Automated Test Script

Create and run this test script:

```bash
#!/bin/bash
cd /home/david/Work/Programming/newbrowsermcp/browsermcp-enhanced

echo "🔍 Testing BrowserMCP Enhanced Extension..."
echo

# Check manifest
echo "1. Checking manifest.json..."
if python3 -m json.tool chrome-extension/manifest.json > /dev/null 2>&1; then
  echo "   ✅ Manifest JSON is valid"
  
  # Extract version
  VERSION=$(grep -o '"version": "[^"]*"' chrome-extension/manifest.json | cut -d'"' -f4)
  echo "   📌 Version: $VERSION"
else
  echo "   ❌ Manifest JSON has syntax errors!"
  exit 1
fi

echo
echo "2. Checking required files..."
cd chrome-extension
MISSING=0
for file in manifest.json background.js element-tracker.js element-validator.js content.js popup.html popup.js; do
  if [ -f "$file" ]; then
    echo "   ✅ $file"
  else
    echo "   ❌ $file is missing!"
    MISSING=$((MISSING + 1))
  fi
done

if [ $MISSING -gt 0 ]; then
  echo
  echo "❌ Extension has $MISSING missing files and cannot be installed!"
  exit 1
fi

echo
echo "3. Checking permissions..."
PERMS=$(grep -A10 '"permissions"' manifest.json | grep '"' | grep -v "permissions" | wc -l)
echo "   📋 Found $PERMS permissions declared"

echo
echo "✅ Extension appears ready for installation!"
echo
echo "To install:"
echo "1. Open chrome://extensions/"
echo "2. Enable Developer mode"
echo "3. Click 'Load unpacked'"
echo "4. Select: $(pwd)"
```

Save this as `test-extension.sh` and run it!