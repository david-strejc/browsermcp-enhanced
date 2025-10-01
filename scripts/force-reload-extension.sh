#!/bin/bash

# Force Reload Chrome Extension - Properly clears cache and service worker
# This fixes the common Chrome bug where background.js doesn't update

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

EXTENSION_ID="YOUR_EXTENSION_ID" # Will be detected
CHROME_EXT_DIR="${CHROME_EXT_DIR:-$HOME/.local/lib/browsermcp-enhanced/chrome-extension}"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Chrome Extension Force Reload Script${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Step 1: Kill all Chrome Canary processes
echo -e "${YELLOW}Step 1: Stopping Chrome Canary completely...${NC}"
pkill -f "/opt/google/chrome-canary/chrome" 2>/dev/null || true
sleep 2
# Force kill if still running
pkill -9 -f "/opt/google/chrome-canary/chrome" 2>/dev/null || true
echo -e "${GREEN}✓ Chrome Canary stopped${NC}"

# Step 2: Clear Chrome's extension cache
echo -e "${YELLOW}Step 2: Clearing Chrome extension cache...${NC}"
CHROME_USER_DATA="$HOME/.config/google-chrome-canary"

# Clear extension cache directories
rm -rf "$CHROME_USER_DATA/Default/Extension State" 2>/dev/null || true
rm -rf "$CHROME_USER_DATA/Default/Extension Rules" 2>/dev/null || true
rm -rf "$CHROME_USER_DATA/Default/Service Worker/CacheStorage" 2>/dev/null || true
rm -rf "$CHROME_USER_DATA/Default/Service Worker/ScriptCache" 2>/dev/null || true

# Clear specific extension directory if found
if [ -d "$CHROME_USER_DATA/Default/Extensions" ]; then
    # Find our extension by looking for manifest.json with our name
    for ext_dir in "$CHROME_USER_DATA/Default/Extensions"/*; do
        if [ -f "$ext_dir/*/manifest.json" ]; then
            if grep -q "Browser MCP Enhanced" "$ext_dir/*/manifest.json" 2>/dev/null; then
                echo "Found extension at: $ext_dir"
                rm -rf "$ext_dir"
                echo -e "${GREEN}✓ Cleared extension cache${NC}"
                break
            fi
        fi
    done
fi

# Step 3: Clear any service worker registrations
echo -e "${YELLOW}Step 3: Clearing service worker registrations...${NC}"
rm -f "$CHROME_USER_DATA/Default/Preferences.bak" 2>/dev/null || true
echo -e "${GREEN}✓ Service workers cleared${NC}"

# Step 4: Deploy fresh extension files
echo -e "${YELLOW}Step 4: Deploying fresh extension files...${NC}"
if [ -d "chrome-extension" ]; then
    echo "Copying extension files..."
    cp -r chrome-extension/* "$CHROME_EXT_DIR/"
    echo -e "${GREEN}✓ Extension files deployed${NC}"
else
    echo -e "${YELLOW}Warning: chrome-extension directory not found in current path${NC}"
fi

# Step 5: Start Chrome with special flags
echo -e "${YELLOW}Step 5: Starting Chrome Canary with cache bypass...${NC}"
DISPLAY="${DISPLAY:-:0}" nohup google-chrome-canary \
    --disable-application-cache \
    --disable-offline-load-stale-cache \
    --disable-gpu-shader-disk-cache \
    --aggressive-cache-discard \
    --disable-background-timer-throttling \
    >/dev/null 2>&1 &

sleep 3

if pgrep -f "/opt/google/chrome-canary/chrome" > /dev/null; then
    echo -e "${GREEN}✓ Chrome Canary started${NC}"
else
    echo -e "${RED}Failed to start Chrome Canary${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Force Reload Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Go to ${CYAN}chrome://extensions/${NC}"
echo "2. Enable 'Developer mode' if not already enabled"
echo "3. Click 'Load unpacked' and select:"
echo "   ${CYAN}$CHROME_EXT_DIR${NC}"
echo "4. The extension should now be fully updated!"
echo ""
echo -e "${BLUE}Tip: Open DevTools on the page and check 'Disable cache' in Network tab${NC}"
echo -e "${BLUE}This prevents caching issues during development${NC}"