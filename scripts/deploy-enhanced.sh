#!/bin/bash

# Browser MCP Enhanced - Robust Deployment Script v2.0
# This script handles the complete deployment with version verification and rollback capability

set -e  # Exit on error
set -u  # Exit on undefined variable

# ========== CONFIGURATION ==========
# These can be overridden with environment variables
MCP_SERVER_DIR="${MCP_SERVER_DIR:-/home/david/.local/lib/browsermcp-enhanced}"
CHROME_EXT_DIR="${CHROME_EXT_DIR:-$MCP_SERVER_DIR/chrome-extension}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/.local/backups/browsermcp-enhanced}"
CURRENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPTS_DIR="$CURRENT_DIR/scripts"
CONFIG_FILE="$HOME/.browsermcp-deploy.conf"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# ========== HELPER FUNCTIONS ==========

# Load configuration if exists
load_config() {
    if [ -f "$CONFIG_FILE" ]; then
        echo -e "${CYAN}Loading configuration from $CONFIG_FILE${NC}"
        source "$CONFIG_FILE"
    fi
}

# Save configuration
save_config() {
    cat > "$CONFIG_FILE" << EOF
# Browser MCP Enhanced Deployment Configuration
# Generated on $(date)
MCP_SERVER_DIR="$MCP_SERVER_DIR"
CHROME_EXT_DIR="$CHROME_EXT_DIR"
BACKUP_DIR="$BACKUP_DIR"
LAST_DEPLOY_VERSION="$NEW_VERSION"
LAST_DEPLOY_DATE="$(date +%Y-%m-%d_%H:%M:%S)"
EOF
    echo -e "${GREEN}Configuration saved to $CONFIG_FILE${NC}"
}

# Function to check if command was successful
check_status() {
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ $1${NC}"
        return 0
    else
        echo -e "${RED}✗ $1 failed${NC}"
        return 1
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

# Compare semantic versions
version_compare() {
    local ver1=$1
    local ver2=$2
    
    # Remove 'v' prefix if present
    ver1="${ver1#v}"
    ver2="${ver2#v}"
    
    # Split versions into components
    IFS='.' read -ra V1 <<< "$ver1"
    IFS='.' read -ra V2 <<< "$ver2"
    
    # Compare major
    if [ "${V1[0]}" -gt "${V2[0]}" ]; then
        echo "1"
    elif [ "${V1[0]}" -lt "${V2[0]}" ]; then
        echo "-1"
    # Compare minor
    elif [ "${V1[1]:-0}" -gt "${V2[1]:-0}" ]; then
        echo "1"
    elif [ "${V1[1]:-0}" -lt "${V2[1]:-0}" ]; then
        echo "-1"
    # Compare patch
    elif [ "${V1[2]:-0}" -gt "${V2[2]:-0}" ]; then
        echo "1"
    elif [ "${V1[2]:-0}" -lt "${V2[2]:-0}" ]; then
        echo "-1"
    else
        echo "0"
    fi
}

# Get version from package.json
get_version() {
    local file=$1
    if [ -f "$file" ]; then
        grep '"version"' "$file" | sed -E 's/.*"version": "([^"]+)".*/\1/'
    else
        echo "0.0.0"
    fi
}

# Check if Chrome Canary is running
is_chrome_running() {
    pgrep -f "/opt/google/chrome-canary/chrome" > /dev/null 2>&1
}

# Create detailed backup
create_backup() {
    local backup_name="$BACKUP_DIR/backup_$(date +%Y%m%d_%H%M%S)_v${DEPLOYED_VERSION}"
    
    echo -e "${BLUE}Creating backup...${NC}"
    mkdir -p "$BACKUP_DIR"
    
    if [ -d "$MCP_SERVER_DIR" ]; then
        cp -r "$MCP_SERVER_DIR" "$backup_name"
        echo -e "${GREEN}✓ Backup created: $backup_name${NC}"
        
        # Keep only last 5 backups
        local backup_count=$(ls -1 "$BACKUP_DIR" | wc -l)
        if [ "$backup_count" -gt 5 ]; then
            echo "Cleaning old backups (keeping last 5)..."
            ls -1t "$BACKUP_DIR" | tail -n +6 | xargs -I {} rm -rf "$BACKUP_DIR/{}"
        fi
        
        echo "$backup_name"
    else
        echo -e "${YELLOW}No existing installation to backup${NC}"
        echo ""
    fi
}

# Rollback to previous version
rollback() {
    echo -e "${RED}========== ROLLBACK MODE ==========${NC}"
    
    local latest_backup=$(ls -1t "$BACKUP_DIR" 2>/dev/null | head -n 1)
    if [ -z "$latest_backup" ]; then
        echo -e "${RED}No backups found in $BACKUP_DIR${NC}"
        exit 1
    fi
    
    echo -e "${YELLOW}Latest backup: $latest_backup${NC}"
    prompt_continue "Restore from this backup?"
    
    echo "Restoring from backup..."
    rm -rf "$MCP_SERVER_DIR"
    cp -r "$BACKUP_DIR/$latest_backup" "$MCP_SERVER_DIR"
    check_status "Rollback completed"
    
    echo -e "${GREEN}Rollback successful!${NC}"
    echo -e "${YELLOW}Remember to restart Claude Desktop and reload Chrome extension${NC}"
    exit 0
}

# ========== MAIN SCRIPT ==========

echo -e "${BOLD}${BLUE}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${BLUE}║   Browser MCP Enhanced - Smart Deployment   ║${NC}"
echo -e "${BOLD}${BLUE}║              Version 2.0 - Robust            ║${NC}"
echo -e "${BOLD}${BLUE}╚══════════════════════════════════════════════╝${NC}"
echo ""

# Load configuration
load_config

# Parse command line arguments
if [ "${1:-}" = "--rollback" ]; then
    rollback
fi

if [ "${1:-}" = "--config" ]; then
    echo -e "${CYAN}Current Configuration:${NC}"
    echo "  MCP Server: $MCP_SERVER_DIR"
    echo "  Chrome Ext: $CHROME_EXT_DIR"
    echo "  Backup Dir: $BACKUP_DIR"
    exit 0
fi

# Step 1: Environment Check
echo -e "${BOLD}${BLUE}[1/10] Environment Check${NC}"
echo "----------------------------------------"

if [ ! -f "$CURRENT_DIR/package.json" ]; then
    echo -e "${RED}✗ Error: Not in browsermcp-enhanced directory${NC}"
    echo "  Current directory: $CURRENT_DIR"
    exit 1
fi

# Check Node.js and npm
if ! command -v node &> /dev/null; then
    echo -e "${RED}✗ Node.js is not installed${NC}"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo -e "${RED}✗ npm is not installed${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Environment ready${NC}"
echo "  Working directory: $CURRENT_DIR"
echo "  Node version: $(node -v)"
echo "  npm version: $(npm -v)"

# Step 2: Version Analysis
echo ""
echo -e "${BOLD}${BLUE}[2/10] Version Analysis${NC}"
echo "----------------------------------------"

CURRENT_VERSION=$(get_version "$CURRENT_DIR/package.json")
DEPLOYED_VERSION=$(get_version "$MCP_SERVER_DIR/package.json")

echo "  Source version:    ${CYAN}$CURRENT_VERSION${NC}"
echo "  Deployed version:  ${MAGENTA}$DEPLOYED_VERSION${NC}"

# Compare versions
COMPARISON=$(version_compare "$CURRENT_VERSION" "$DEPLOYED_VERSION")
if [ "$COMPARISON" = "1" ]; then
    echo -e "${GREEN}  → Source is newer (ready to deploy)${NC}"
elif [ "$COMPARISON" = "-1" ]; then
    echo -e "${YELLOW}  ⚠ Deployed version is newer than source!${NC}"
    prompt_continue "Deployed version is newer. Continue anyway?"
elif [ "$COMPARISON" = "0" ]; then
    echo -e "${YELLOW}  → Versions are identical${NC}"
fi

# Step 3: Version Bump
echo ""
echo -e "${BOLD}${BLUE}[3/10] Version Management${NC}"
echo "----------------------------------------"
echo "Current version: $CURRENT_VERSION"
echo ""
echo "Select version bump type:"
echo "  ${BOLD}1)${NC} Patch (x.x.${BOLD}X${NC}) - Bug fixes"
echo "  ${BOLD}2)${NC} Minor (x.${BOLD}X${NC}.0) - New features"
echo "  ${BOLD}3)${NC} Major (${BOLD}X${NC}.0.0) - Breaking changes"
echo "  ${BOLD}4)${NC} Keep current version"
echo "  ${BOLD}5)${NC} Custom version"
read -p "Choice (1-5): " version_choice

case $version_choice in
    1)
        npm version patch --no-git-tag-version > /dev/null 2>&1
        NEW_VERSION=$(get_version "$CURRENT_DIR/package.json")
        echo -e "${GREEN}✓ Version bumped to: $NEW_VERSION (patch)${NC}"
        ;;
    2)
        npm version minor --no-git-tag-version > /dev/null 2>&1
        NEW_VERSION=$(get_version "$CURRENT_DIR/package.json")
        echo -e "${GREEN}✓ Version bumped to: $NEW_VERSION (minor)${NC}"
        ;;
    3)
        npm version major --no-git-tag-version > /dev/null 2>&1
        NEW_VERSION=$(get_version "$CURRENT_DIR/package.json")
        echo -e "${GREEN}✓ Version bumped to: $NEW_VERSION (major)${NC}"
        ;;
    4)
        NEW_VERSION=$CURRENT_VERSION
        echo -e "${YELLOW}→ Keeping version: $NEW_VERSION${NC}"
        ;;
    5)
        read -p "Enter custom version: " NEW_VERSION
        # Validate version format
        if [[ ! "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            echo -e "${RED}Invalid version format. Use x.y.z${NC}"
            exit 1
        fi
        # Update package.json
        sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$NEW_VERSION\"/" "$CURRENT_DIR/package.json"
        echo -e "${GREEN}✓ Version set to: $NEW_VERSION${NC}"
        ;;
    *)
        echo -e "${RED}Invalid choice${NC}"
        exit 1
        ;;
esac

# Final version check
FINAL_COMPARISON=$(version_compare "$NEW_VERSION" "$DEPLOYED_VERSION")
if [ "$FINAL_COMPARISON" = "-1" ]; then
    echo -e "${RED}⚠ Warning: New version ($NEW_VERSION) is older than deployed ($DEPLOYED_VERSION)${NC}"
    prompt_continue "Deploy older version?"
elif [ "$FINAL_COMPARISON" = "0" ]; then
    echo -e "${YELLOW}ℹ Deploying same version (force update)${NC}"
fi

# Step 4: Dependencies Check
echo ""
echo -e "${BOLD}${BLUE}[4/10] Dependencies Check${NC}"
echo "----------------------------------------"

if [ ! -d "$CURRENT_DIR/node_modules" ]; then
    echo "Installing dependencies..."
    npm install
    check_status "Dependencies installed"
else
    echo -e "${GREEN}✓ Dependencies already installed${NC}"
fi

# Step 5: Build
echo ""
echo -e "${BOLD}${BLUE}[5/10] Building Project${NC}"
echo "----------------------------------------"

npm run build
check_status "Build completed"

# Check build output
if [ ! -d "$CURRENT_DIR/dist" ]; then
    echo -e "${RED}✗ Build failed - dist directory not found${NC}"
    exit 1
fi

BUILD_SIZE=$(du -sh "$CURRENT_DIR/dist" | cut -f1)
echo -e "${GREEN}✓ Build size: $BUILD_SIZE${NC}"

# Step 6: Backup
echo ""
echo -e "${BOLD}${BLUE}[6/10] Backup${NC}"
echo "----------------------------------------"

BACKUP_PATH=$(create_backup)

# Step 7: Deploy MCP Server
echo ""
echo -e "${BOLD}${BLUE}[7/10] Deploying MCP Server${NC}"
echo "----------------------------------------"

# Create directory structure
mkdir -p "$MCP_SERVER_DIR"
mkdir -p "$MCP_SERVER_DIR/dist"

# Copy files
echo "→ Copying distribution files..."
cp -r "$CURRENT_DIR/dist/"* "$MCP_SERVER_DIR/dist/"
check_status "Distribution files deployed"

echo "→ Copying package files..."
cp "$CURRENT_DIR/package.json" "$MCP_SERVER_DIR/"
cp "$CURRENT_DIR/package-lock.json" "$MCP_SERVER_DIR/" 2>/dev/null || true
check_status "Package files deployed"

# Verify deployment
DEPLOYED_NEW_VERSION=$(get_version "$MCP_SERVER_DIR/package.json")
if [ "$DEPLOYED_NEW_VERSION" != "$NEW_VERSION" ]; then
    echo -e "${RED}✗ Version mismatch after deployment!${NC}"
    echo "  Expected: $NEW_VERSION"
    echo "  Deployed: $DEPLOYED_NEW_VERSION"
    exit 1
fi
echo -e "${GREEN}✓ Version verified: $DEPLOYED_NEW_VERSION${NC}"

# Step 8: Deploy Chrome Extension
echo ""
echo -e "${BOLD}${BLUE}[8/10] Deploying Chrome Extension${NC}"
echo "----------------------------------------"

mkdir -p "$CHROME_EXT_DIR"

echo "→ Copying extension files..."
cp -r "$CURRENT_DIR/chrome-extension/"* "$CHROME_EXT_DIR/"
check_status "Extension files deployed"

# Update manifest version
if [ -f "$CHROME_EXT_DIR/manifest.json" ]; then
    echo "→ Updating manifest version..."
    # Remove .0 suffix for Chrome extension version
    CHROME_VERSION="${NEW_VERSION%.0}"
    sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$CHROME_VERSION\"/" "$CHROME_EXT_DIR/manifest.json"
    check_status "Manifest updated"
else
    echo -e "${YELLOW}⚠ manifest.json not found${NC}"
fi

# Step 9: Chrome Restart
echo ""
echo -e "${BOLD}${BLUE}[9/10] Chrome Management${NC}"
echo "----------------------------------------"

if is_chrome_running; then
    echo -e "${YELLOW}Chrome Canary is running${NC}"
    prompt_continue "Restart Chrome Canary now?"
    
    "$SCRIPTS_DIR/chrome-canary-restart.sh" restart
    check_status "Chrome Canary restarted"
else
    echo -e "${CYAN}Chrome Canary is not running${NC}"
    read -p "Start Chrome Canary? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        "$SCRIPTS_DIR/chrome-canary-restart.sh" start
        check_status "Chrome Canary started"
    fi
fi

# Step 10: Summary
echo ""
echo -e "${BOLD}${BLUE}[10/10] Deployment Summary${NC}"
echo "----------------------------------------"

# Save configuration
save_config

echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║         DEPLOYMENT SUCCESSFUL! 🎉            ║${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BOLD}Version deployed: ${CYAN}$NEW_VERSION${NC}"
echo ""
echo -e "${BOLD}Deployment locations:${NC}"
echo "  → MCP Server: ${BLUE}$MCP_SERVER_DIR${NC}"
echo "  → Chrome Ext: ${BLUE}$CHROME_EXT_DIR${NC}"
echo "  → Backup:     ${BLUE}$BACKUP_PATH${NC}"
echo ""
echo -e "${BOLD}${YELLOW}Next Steps:${NC}"
echo "  1. ${YELLOW}Restart Claude Desktop${NC} to load MCP v$NEW_VERSION"
echo "  2. In Chrome: Go to ${CYAN}chrome://extensions${NC}"
echo "  3. Click '${CYAN}Reload${NC}' on Browser MCP Enhanced"
echo ""

# Git status
if command -v git &> /dev/null && [ -d .git ]; then
    echo -e "${BOLD}Git Status:${NC}"
    git status --short
    echo ""
    
    # Check if version was bumped
    if [ "$NEW_VERSION" != "$CURRENT_VERSION" ]; then
        echo -e "${YELLOW}Tip: Commit your version bump:${NC}"
        echo -e "  ${CYAN}git add -A && git commit -m 'chore: bump version to $NEW_VERSION'${NC}"
    fi
fi

echo ""
echo -e "${GREEN}✨ Deployment completed successfully!${NC}"
echo -e "${CYAN}Run ${BOLD}$0 --rollback${NC}${CYAN} if you need to revert${NC}"