// Offscreen document for image processing ONLY
// WebSocket connections are now handled in background service worker
console.log('[Offscreen] Image processing worker initialized');

chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
  console.log('[Offscreen] Received message:', request.type);

  if (request.type === 'process-image') {
    try {
      const result = await processImage(request.data);
      chrome.runtime.sendMessage({ type: 'image-processed', data: result });
    } catch (error) {
      chrome.runtime.sendMessage({ type: 'image-error', error: error.message });
    }
  } else if (request.type === 'stitch-screenshots') {
    try {
      const result = await stitchScreenshots(request.data);
      chrome.runtime.sendMessage({ type: 'fullpage-stitched', data: result });
    } catch (error) {
      chrome.runtime.sendMessage({ type: 'stitch-error', error: error.message });
    }
  }

  return true; // Keep message channel open for async responses
});

async function processImage(params) {
  const {
    dataUrl,
    format = 'jpeg',
    quality = 80,
    maxWidth,
    maxHeight,
    scaleFactor,
    grayscale = false,
    targetSizeKB
  } = params;

  // Load image
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = dataUrl;
  });

  // Calculate new dimensions
  let width = img.width;
  let height = img.height;
  const originalWidth = width;
  const originalHeight = height;

  // Apply max width/height constraints
  if (maxWidth && width > maxWidth) {
    height = Math.round((maxWidth / width) * height);
    width = maxWidth;
  }
  if (maxHeight && height > maxHeight) {
    width = Math.round((maxHeight / height) * width);
    height = maxHeight;
  }

  // Apply scale factor
  if (scaleFactor && scaleFactor < 1) {
    width = Math.round(width * scaleFactor);
    height = Math.round(height * scaleFactor);
  }

  // Get canvas and context
  const canvas = document.getElementById('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Apply filters
  if (grayscale) {
    ctx.filter = 'grayscale(100%)';
  }

  // Draw resized image
  ctx.drawImage(img, 0, 0, width, height);

  // Convert to desired format with quality
  let resultDataUrl;

  if (targetSizeKB) {
    // Try different quality levels to meet target size
    let currentQuality = quality;
    let attempts = 0;
    const maxAttempts = 10;

    do {
      resultDataUrl = canvas.toDataURL(`image/${format}`, currentQuality / 100);
      const sizeKB = (resultDataUrl.length * 0.75) / 1024;

      if (sizeKB <= targetSizeKB || attempts >= maxAttempts || currentQuality <= 10) {
        break;
      }

      currentQuality = Math.max(10, currentQuality - 10);
      attempts++;
    } while (true);

    console.log(`Target size achieved with quality ${currentQuality} after ${attempts} attempts`);
  } else {
    resultDataUrl = canvas.toDataURL(`image/${format}`, quality / 100);
  }

  const finalSizeKB = Math.round((resultDataUrl.length * 0.75) / 1024);
  console.log(`Image resized from ${originalWidth}x${originalHeight} to ${width}x${height}, size: ${finalSizeKB}KB`);

  return {
    dataUrl: resultDataUrl,
    width,
    height,
    originalWidth,
    originalHeight,
    sizeKB: finalSizeKB
  };
}

// Function to stitch multiple screenshots together for full-page capture
async function stitchScreenshots(params) {
  const {
    screenshots,
    totalHeight,
    viewportWidth,
    viewportHeight,
    format = 'jpeg',
    quality = 90
  } = params;

  console.log(`Stitching ${screenshots.length} screenshots into ${viewportWidth}x${totalHeight} image`);

  // Create canvas with full page dimensions
  const canvas = document.getElementById('canvas');
  canvas.width = viewportWidth;
  canvas.height = totalHeight;
  const ctx = canvas.getContext('2d');

  // Clear canvas
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, viewportWidth, totalHeight);

  // Load and draw each screenshot at its position
  for (const screenshot of screenshots) {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = screenshot.dataUrl;
    });

    // Draw image at its vertical offset
    // Handle last screenshot that might be shorter
    const drawHeight = Math.min(viewportHeight, totalHeight - screenshot.offsetY);
    ctx.drawImage(img, 0, 0, viewportWidth, drawHeight, 0, screenshot.offsetY, viewportWidth, drawHeight);
  }

  // Convert to desired format
  const resultDataUrl = canvas.toDataURL(`image/${format}`, quality / 100);
  const finalSizeKB = Math.round((resultDataUrl.length * 0.75) / 1024);

  console.log(`Full page stitched: ${viewportWidth}x${totalHeight}, size: ${finalSizeKB}KB`);

  return {
    dataUrl: resultDataUrl,
    width: viewportWidth,
    height: totalHeight,
    sizeKB: finalSizeKB
  };
}
