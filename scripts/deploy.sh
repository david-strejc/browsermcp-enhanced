#!/bin/bash

# Browser MCP Enhanced - Deployment Script
# This script handles the complete deployment of both MCP server and Chrome extension

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
MCP_SERVER_DIR="${MCP_SERVER_DIR:-$HOME/.local/lib/browsermcp-enhanced}"
CHROME_EXT_DIR="${CHROME_EXT_DIR:-$MCP_SERVER_DIR/chrome-extension}"
CURRENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPTS_DIR="$CURRENT_DIR/scripts"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Browser MCP Enhanced - Deployment Script${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Function to check if command was successful
check_status() {
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ $1${NC}"
    else
        echo -e "${RED}✗ $1 failed${NC}"
        exit 1
    fi
}

# Function to prompt user
prompt_continue() {
    echo -e "${YELLOW}$1${NC}"
    read -p "Continue? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${RED}Deployment cancelled${NC}"
        exit 1
    fi
}

# Step 1: Check current directory
echo -e "${BLUE}Step 1: Checking environment...${NC}"
if [ ! -f "$CURRENT_DIR/package.json" ]; then
    echo -e "${RED}Error: Not in browsermcp-enhanced directory${NC}"
    exit 1
fi
check_status "Environment check"

# Step 2: Get current version
CURRENT_VERSION=$(grep '"version"' package.json | sed -E 's/.*"version": "([^"]+)".*/\1/')
echo -e "${GREEN}Current version: $CURRENT_VERSION${NC}"

# Step 3: Bump version
echo ""
echo -e "${BLUE}Step 2: Version Management${NC}"
echo "Current version: $CURRENT_VERSION"
echo "Select version bump type:"
echo "  1) Patch (x.x.X) - Bug fixes"
echo "  2) Minor (x.X.0) - New features"
echo "  3) Major (X.0.0) - Breaking changes"
echo "  4) Keep current version"
read -p "Choice (1-4): " version_choice

case $version_choice in
    1)
        npm version patch --no-git-tag-version
        NEW_VERSION=$(grep '"version"' package.json | sed -E 's/.*"version": "([^"]+)".*/\1/')
        echo -e "${GREEN}Version bumped to: $NEW_VERSION${NC}"
        ;;
    2)
        npm version minor --no-git-tag-version
        NEW_VERSION=$(grep '"version"' package.json | sed -E 's/.*"version": "([^"]+)".*/\1/')
        echo -e "${GREEN}Version bumped to: $NEW_VERSION${NC}"
        ;;
    3)
        npm version major --no-git-tag-version
        NEW_VERSION=$(grep '"version"' package.json | sed -E 's/.*"version": "([^"]+)".*/\1/')
        echo -e "${GREEN}Version bumped to: $NEW_VERSION${NC}"
        ;;
    4)
        NEW_VERSION=$CURRENT_VERSION
        echo -e "${YELLOW}Keeping version: $NEW_VERSION${NC}"
        ;;
    *)
        echo -e "${RED}Invalid choice${NC}"
        exit 1
        ;;
esac

# Step 4: Build the project
echo ""
echo -e "${BLUE}Step 3: Building project...${NC}"
npm run build
check_status "Build completed"

# Step 5: Create backup of current deployment
echo ""
echo -e "${BLUE}Step 4: Creating backup...${NC}"
if [ -d "$MCP_SERVER_DIR" ]; then
    BACKUP_DIR="$MCP_SERVER_DIR.backup.$(date +%Y%m%d_%H%M%S)"
    cp -r "$MCP_SERVER_DIR" "$BACKUP_DIR"
    echo -e "${GREEN}Backup created: $BACKUP_DIR${NC}"
else
    echo -e "${YELLOW}No existing installation to backup${NC}"
fi

# Step 6: Deploy MCP Server
echo ""
echo -e "${BLUE}Step 5: Deploying MCP Server...${NC}"

# Create directory if it doesn't exist
mkdir -p "$MCP_SERVER_DIR"

# Copy dist files
echo "Copying dist files..."
cp -r dist/* "$MCP_SERVER_DIR/dist/" 2>/dev/null || cp -r dist "$MCP_SERVER_DIR/"
check_status "Dist files copied"

# Copy package files
echo "Copying package files..."
cp package.json "$MCP_SERVER_DIR/"
cp package-lock.json "$MCP_SERVER_DIR/" 2>/dev/null || true
check_status "Package files copied"

# Step 7: Deploy Chrome Extension
echo ""
echo -e "${BLUE}Step 6: Deploying Chrome Extension...${NC}"

# Create directory if it doesn't exist
mkdir -p "$CHROME_EXT_DIR"

# Copy all chrome extension files
echo "Copying Chrome extension files..."
cp -r chrome-extension/* "$CHROME_EXT_DIR/"
check_status "Chrome extension files copied"

# Step 8: Update manifest version if needed
echo ""
echo -e "${BLUE}Step 7: Updating Chrome extension manifest...${NC}"
if [ -f "$CHROME_EXT_DIR/manifest.json" ]; then
    # Update version in manifest.json to match package.json
    sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"${NEW_VERSION%.0}\"/" "$CHROME_EXT_DIR/manifest.json"
    check_status "Manifest version updated"
else
    echo -e "${YELLOW}Warning: manifest.json not found${NC}"
fi

# Step 9: Restart Chrome to reload extension
echo ""
echo -e "${BLUE}Step 8: Restarting Chrome Canary...${NC}"
prompt_continue "This will close all Chrome Canary windows. Save your work first!"

"$SCRIPTS_DIR/chrome-canary-restart.sh" restart
check_status "Chrome Canary restarted"

# Step 10: Final instructions
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Deployment Complete! Version: $NEW_VERSION${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${YELLOW}IMPORTANT: Manual steps required:${NC}"
echo -e "${YELLOW}1. Restart Claude Desktop to load new MCP server${NC}"
echo -e "${YELLOW}2. In Chrome Canary:${NC}"
echo -e "${YELLOW}   - Go to chrome://extensions${NC}"
echo -e "${YELLOW}   - Click 'Reload' on Browser MCP Enhanced extension${NC}"
echo -e "${YELLOW}   - Or disable/enable the extension${NC}"
echo ""
echo -e "${BLUE}Deployment locations:${NC}"
echo -e "  MCP Server: $MCP_SERVER_DIR"
echo -e "  Chrome Ext: $CHROME_EXT_DIR"
echo ""
echo -e "${GREEN}✓ Deployment successful!${NC}"

# Optional: Show git status
echo ""
echo -e "${BLUE}Git status:${NC}"
git status --short

echo ""
echo -e "${YELLOW}Don't forget to commit your changes if everything works!${NC}"