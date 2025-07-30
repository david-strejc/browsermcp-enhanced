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
    SIZE=$(wc -c < "$file")
    printf "   ✅ %-25s (%d bytes)\n" "$file" "$SIZE"
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
echo "4. Checking content scripts..."
CONTENT_SCRIPTS=$(grep -c "content.js" manifest.json)
if [ $CONTENT_SCRIPTS -gt 0 ]; then
  echo "   ✅ Content scripts properly configured"
else
  echo "   ❌ Content scripts not found in manifest!"
fi

echo
echo "5. Checking for common issues..."
# Check for placeholder icons
for icon in icon-16.png icon-48.png icon-128.png; do
  if [ -f "$icon" ]; then
    if file "$icon" | grep -q "text"; then
      echo "   ⚠️  $icon is a text placeholder (not an actual image)"
    else
      echo "   ✅ $icon is a valid image"
    fi
  else
    echo "   ⚠️  $icon is missing (will use default icon)"
  fi
done

echo
echo "✅ Extension appears ready for installation!"
echo
echo "To install:"
echo "1. Open chrome://extensions/"
echo "2. Enable Developer mode"
echo "3. Click 'Load unpacked'"
echo "4. Select: $(pwd)"
echo
echo "To test connection:"
echo "1. Start MCP server: npm run inspector"
echo "2. Click extension icon in Chrome"
echo "3. Click 'Connect' button"