#!/bin/bash

# BrowserMCP Enhanced Installation Script

echo "Installing BrowserMCP Enhanced..."

# Build the project
echo "Building project..."
npm run build

# Create installation directory
echo "Creating installation directory..."
rm -rf ~/.local/lib/browsermcp-enhanced
mkdir -p ~/.local/lib/browsermcp-enhanced

# Copy files
echo "Copying files..."
cp -r dist ~/.local/lib/browsermcp-enhanced/
cp -r chrome-extension ~/.local/lib/browsermcp-enhanced/
cp package.json ~/.local/lib/browsermcp-enhanced/
cp -r node_modules ~/.local/lib/browsermcp-enhanced/

echo "Installation complete!"
echo ""
echo "To use BrowserMCP Enhanced:"
echo "1. Load the Chrome extension from: ~/.local/lib/browsermcp-enhanced/chrome-extension"
echo "2. Restart Claude to load the new MCP server"
echo ""
echo "The MCP server config is already set in ~/.claude/mcp_servers.json"