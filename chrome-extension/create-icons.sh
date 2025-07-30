#!/bin/bash
# Create simple SVG icons for the extension

# Create a simple SVG icon
cat > icon.svg << 'EOF'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" fill="#4A90E2"/>
  <text x="64" y="64" text-anchor="middle" dominant-baseline="middle" 
        font-family="Arial, sans-serif" font-size="48" font-weight="bold" fill="white">B</text>
  <text x="64" y="90" text-anchor="middle" 
        font-family="Arial, sans-serif" font-size="16" fill="white">MCP</text>
</svg>
EOF

# Convert SVG to PNG using ImageMagick if available
if command -v convert &> /dev/null; then
  echo "Creating PNG icons..."
  convert -background none -resize 16x16 icon.svg icon-16.png
  convert -background none -resize 48x48 icon.svg icon-48.png
  convert -background none -resize 128x128 icon.svg icon-128.png
  rm icon.svg
  echo "✅ Icons created successfully!"
else
  echo "ImageMagick not found. Creating data URI icons..."
  
  # Create simple colored squares as base64 PNGs
  # 16x16 blue square
  echo -n "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAARklEQVR42mNkYPhfz4AGmBhIBKMGDBpAjQSURi4hVTMjIyM1DEBTM0gNYGRkxJmAqJGAhg0gJgHhSqMkAeEzgJEaLoA6AABRwxAR9Ei2ygAAAABJRU5ErkJggg==" | base64 -d > icon-16.png
  
  # 48x48 blue square
  echo -n "iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAWklEQVR42u3PAQ0AMAgDsIGK+TfDHkbCVpK2bfffAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICXpsPHjAAiUc2ewAAAABJRU5ErkJggg==" | base64 -d > icon-48.png
  
  # 128x128 blue square
  echo -n "iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAAjklEQVR42u3RAQ0AAAgDIIHe30OqZ6DhKklbm+++BQQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBOAWPm8YAAGNtzA0AAAAAElFTkSuQmCC" | base64 -d > icon-128.png
  
  echo "✅ Basic icons created!"
fi

ls -la icon-*.png