const fs = require('fs');
const { createCanvas, loadImage } = require('canvas');

// SVG template with placeholder for status color
const createSVG = (color) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <!-- Background circle (status indicator) -->
  <circle cx="64" cy="64" r="60" fill="${color}" stroke="#333" stroke-width="2"/>
  
  <!-- Browser window -->
  <rect x="30" y="35" width="68" height="50" rx="4" fill="#fff" stroke="#333" stroke-width="2"/>
  
  <!-- Browser header -->
  <rect x="30" y="35" width="68" height="12" rx="4" fill="#e0e0e0"/>
  
  <!-- Browser buttons -->
  <circle cx="38" cy="41" r="2" fill="#ff5252"/>
  <circle cx="45" cy="41" r="2" fill="#ffeb3b"/>
  <circle cx="52" cy="41" r="2" fill="#4caf50"/>
  
  <!-- MCP text/logo -->
  <text x="64" y="68" font-family="Arial, sans-serif" font-size="16" font-weight="bold" text-anchor="middle" fill="#333">MCP</text>
  
  <!-- Connection indicator dots (only animate when connected) -->
  ${color === '#4CAF50' ? `
  <circle cx="50" cy="78" r="2" fill="#333">
    <animate attributeName="opacity" values="0.3;1;0.3" dur="1.5s" repeatCount="indefinite" begin="0s"/>
  </circle>
  <circle cx="64" cy="78" r="2" fill="#333">
    <animate attributeName="opacity" values="0.3;1;0.3" dur="1.5s" repeatCount="indefinite" begin="0.5s"/>
  </circle>
  <circle cx="78" cy="78" r="2" fill="#333">
    <animate attributeName="opacity" values="0.3;1;0.3" dur="1.5s" repeatCount="indefinite" begin="1s"/>
  </circle>` : `
  <circle cx="50" cy="78" r="2" fill="#666" opacity="0.3"/>
  <circle cx="64" cy="78" r="2" fill="#666" opacity="0.3"/>
  <circle cx="78" cy="78" r="2" fill="#666" opacity="0.3"/>`}
</svg>`;

// Save connected state icons
fs.writeFileSync('icon-connected.svg', createSVG('#4CAF50')); // Green
fs.writeFileSync('icon-disconnected.svg', createSVG('#f44336')); // Red

console.log('Icons generated!');
console.log('- icon-connected.svg (green)');
console.log('- icon-disconnected.svg (red)');
console.log('\nNote: You\'ll need to convert these to PNG using an online converter or image editor.');
console.log('Or install npm packages: npm install canvas');