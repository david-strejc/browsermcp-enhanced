#!/bin/bash

# Script to generate PNG icons from SVG for Chrome extension
# Requires ImageMagick (convert command)

echo "🎨 Generating Chrome Extension Icons..."

# Create connected (green) SVG
cat > icon-connected.svg << 'EOF'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <!-- Background circle (green for connected) -->
  <circle cx="64" cy="64" r="60" fill="#4CAF50" stroke="#2c2c2c" stroke-width="3"/>
  
  <!-- Browser window -->
  <rect x="30" y="35" width="68" height="50" rx="4" fill="#ffffff" stroke="#2c2c2c" stroke-width="2.5"/>
  
  <!-- Browser header -->
  <rect x="30" y="35" width="68" height="12" rx="4" fill="#e8e8e8"/>
  
  <!-- Browser buttons -->
  <circle cx="38" cy="41" r="2.5" fill="#ff5252"/>
  <circle cx="45" cy="41" r="2.5" fill="#ffeb3b"/>
  <circle cx="52" cy="41" r="2.5" fill="#69f0ae"/>
  
  <!-- MCP text -->
  <text x="64" y="68" font-family="Arial, sans-serif" font-size="18" font-weight="bold" text-anchor="middle" fill="#2c2c2c">MCP</text>
  
  <!-- Active connection dots -->
  <circle cx="50" cy="78" r="3" fill="#2c2c2c"/>
  <circle cx="64" cy="78" r="3" fill="#2c2c2c"/>
  <circle cx="78" cy="78" r="3" fill="#2c2c2c"/>
</svg>
EOF

# Create disconnected (red) SVG
cat > icon-disconnected.svg << 'EOF'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <!-- Background circle (red for disconnected) -->
  <circle cx="64" cy="64" r="60" fill="#f44336" stroke="#2c2c2c" stroke-width="3"/>
  
  <!-- Browser window -->
  <rect x="30" y="35" width="68" height="50" rx="4" fill="#ffffff" stroke="#2c2c2c" stroke-width="2.5"/>
  
  <!-- Browser header -->
  <rect x="30" y="35" width="68" height="12" rx="4" fill="#e8e8e8"/>
  
  <!-- Browser buttons -->
  <circle cx="38" cy="41" r="2.5" fill="#ff5252"/>
  <circle cx="45" cy="41" r="2.5" fill="#ffeb3b"/>
  <circle cx="52" cy="41" r="2.5" fill="#69f0ae"/>
  
  <!-- MCP text -->
  <text x="64" y="68" font-family="Arial, sans-serif" font-size="18" font-weight="bold" text-anchor="middle" fill="#2c2c2c">MCP</text>
  
  <!-- Inactive connection dots -->
  <circle cx="50" cy="78" r="3" fill="#666666" opacity="0.3"/>
  <circle cx="64" cy="78" r="3" fill="#666666" opacity="0.3"/>
  <circle cx="78" cy="78" r="3" fill="#666666" opacity="0.3"/>
</svg>
EOF

# Check if ImageMagick is installed
if ! command -v convert &> /dev/null; then
    echo "❌ ImageMagick is not installed. Please install it first:"
    echo "   sudo apt-get install imagemagick"
    echo ""
    echo "Or use rsvg-convert (librsvg2-bin):"
    echo "   sudo apt-get install librsvg2-bin"
    exit 1
fi

# Generate PNG files for connected state
echo "✅ Generating connected (green) icons..."
convert -background none icon-connected.svg -resize 16x16 icon-16-connected.png
convert -background none icon-connected.svg -resize 48x48 icon-48-connected.png
convert -background none icon-connected.svg -resize 128x128 icon-128-connected.png

# Generate PNG files for disconnected state  
echo "❌ Generating disconnected (red) icons..."
convert -background none icon-disconnected.svg -resize 16x16 icon-16-disconnected.png
convert -background none icon-disconnected.svg -resize 48x48 icon-48-disconnected.png
convert -background none icon-disconnected.svg -resize 128x128 icon-128-disconnected.png

# Also keep the default icons (disconnected by default)
echo "📦 Creating default icons..."
cp icon-16-disconnected.png icon-16.png
cp icon-48-disconnected.png icon-48.png
cp icon-128-disconnected.png icon-128.png

# Clean up SVG files
rm icon-connected.svg icon-disconnected.svg

echo "✨ Done! Generated the following icons:"
echo "   Connected (green):"
echo "   - icon-16-connected.png"
echo "   - icon-48-connected.png"
echo "   - icon-128-connected.png"
echo ""
echo "   Disconnected (red):"
echo "   - icon-16-disconnected.png"
echo "   - icon-48-disconnected.png"
echo "   - icon-128-disconnected.png"
echo ""
echo "   Default icons:"
echo "   - icon-16.png"
echo "   - icon-48.png"
echo "   - icon-128.png"