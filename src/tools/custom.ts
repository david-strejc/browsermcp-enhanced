import { zodToJsonSchema } from "zod-to-json-schema";
import * as fs from "fs";
import * as path from "path";
import sharp from "sharp";

import { GetConsoleLogsTool, ScreenshotTool } from "../types/tool";

import { Tool } from "./tool";
import { loadScreenshotConfig } from "../config/screenshot";

// Configuration for screenshot audit saving
const SCREENSHOT_CONFIG = {
  // Set to true to enable audit saving
  enableAuditSave: process.env.MCP_SCREENSHOT_AUDIT === 'true' || true,  // Default to true
  // Directory for audit saves
  auditDir: process.env.MCP_SCREENSHOT_DIR || '/tmp/claude_images',
  // Max files to keep (0 = unlimited)
  maxFiles: parseInt(process.env.MCP_SCREENSHOT_MAX || '100') || 100,
};

export const getConsoleLogs: Tool = {
  schema: {
    name: GetConsoleLogsTool.shape.name.value,
    description: GetConsoleLogsTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetConsoleLogsTool.shape.arguments),
  },
  handle: async (context, params) => {
    // Parse parameters with GetConsoleLogsTool schema
    const input = GetConsoleLogsTool.shape.arguments.parse(params || {});

    const response = await context.sendSocketMessage(
      "console.get",
      {
        filter: input.filter,
        type: input.type,
        limit: input.limit
      },
    );

    // Check if we have enhanced response from debugger
    if (response.debuggerAttached) {
      let output = "";

      // Add status information
      if (response.capturedFromStart) {
        output += "=== CONSOLE LOGS (Full history from page load) ===\n";
      } else {
        output += "=== CONSOLE LOGS ===\n";
        if (response.warning) {
          output += `⚠️  ${response.warning}\n`;
        }
      }

      // Show filter info if applicable
      if (response.totalCount !== undefined && response.filteredCount !== undefined) {
        output += `📊 Showing ${response.filteredCount} of ${response.totalCount} total logs`;
        if (input.filter) output += ` (filter: "${input.filter}")`;
        if (input.type) output += ` (type: ${input.type})`;
        if (input.limit) output += ` (limit: ${input.limit})`;
        output += "\n\n";
      } else {
        output += "\n";
      }

      // Format logs with better structure
      if (response.logs && response.logs.length > 0) {
        // Separate buffered and live logs if available
        const bufferedLogs = response.logs.filter(log => log.buffered);
        const liveLogs = response.logs.filter(log => !log.buffered);

        if (bufferedLogs.length > 0) {
          output += "--- Early Console Activity (before debugger) ---\n";
          bufferedLogs.forEach(log => {
            output += `[${log.type?.toUpperCase() || 'LOG'}] ${log.timestamp}: ${log.message || (log.args && log.args.join(' ')) || JSON.stringify(log)}\n`;
            if (log.url && log.line) {
              output += `  at ${log.url}:${log.line}\n`;
            }
            if (log.stack) {
              output += `  Stack: ${log.stack}\n`;
            }
          });
          output += "\n";
        }

        if (liveLogs.length > 0) {
          if (bufferedLogs.length > 0) {
            output += "--- Console Activity (after debugger) ---\n";
          }
          liveLogs.forEach(log => {
            output += `[${log.type?.toUpperCase() || 'LOG'}] ${log.timestamp}: ${log.message || (log.args && log.args.join(' ')) || JSON.stringify(log)}\n`;
            if (log.url && log.line) {
              output += `  at ${log.url}:${log.line}\n`;
            }
            if (log.stack) {
              output += `  Stack: ${log.stack}\n`;
            }
          });
        }
      } else {
        output += "No console logs captured.";
      }

      return {
        content: [{ type: "text", text: output }],
      };
    }

    // Fallback to simple JSON formatting for old response format
    const text: string = response.logs
      .map((log) => JSON.stringify(log))
      .join("\n");
    return {
      content: [{ type: "text", text: text || "No console logs captured." }],
    };
  },
};

// Helper function to manage audit directory files
function cleanupOldFiles(dir: string, maxFiles: number) {
  if (maxFiles <= 0) return; // No limit
  
  try {
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.png'))
      .map(f => ({
        name: f,
        path: path.join(dir, f),
        time: fs.statSync(path.join(dir, f)).mtime.getTime()
      }))
      .sort((a, b) => b.time - a.time); // Newest first
    
    // Remove oldest files if we exceed the limit
    if (files.length >= maxFiles) {
      const toDelete = files.slice(maxFiles - 1); // Keep room for new file
      toDelete.forEach(f => {
        try {
          fs.unlinkSync(f.path);
        } catch (e) {
          // Ignore deletion errors
        }
      });
    }
  } catch (e) {
    // Ignore cleanup errors
  }
}

export const screenshot: Tool = {
  schema: {
    name: ScreenshotTool.shape.name.value,
    description: ScreenshotTool.shape.description.value,
    inputSchema: zodToJsonSchema(ScreenshotTool.shape.arguments),
  },
  handle: async (context, params) => {
    // Load configuration
    const config = loadScreenshotConfig();

    // Parse parameters with defaults
    const args = ScreenshotTool.shape.arguments.parse(params || {});

    // Check if this is a Claude Code request and apply auto full-page if configured
    const isClaudeCode = context.clientInfo?.name?.includes('Claude') ||
                        context.clientInfo?.name?.includes('claude');

    if (isClaudeCode && config.claudeCode.autoFullPage && !params?.captureMode) {
      console.log('Auto-enabling full page mode for Claude Code request');
      args.captureMode = 'fullpage';
      // Apply Claude-specific defaults if not specified
      if (!params?.quality) args.quality = config.claudeCode.defaultQuality;
      if (!params?.format) args.format = config.claudeCode.defaultFormat;
      if (!params?.jpegQuality && args.format === 'jpeg') {
        args.jpegQuality = config.claudeCode.defaultJpegQuality;
      }
      if (!params?.fullPageMaxHeight) {
        args.fullPageMaxHeight = config.claudeCode.fullPageMaxHeight;
      }
      if (!params?.fullPageScrollDelay) {
        args.fullPageScrollDelay = config.claudeCode.fullPageScrollDelay;
      }
    }

    // Determine quality settings based on preset
    let effectiveMaxWidth = args.maxWidth;
    let effectiveJpegQuality = args.jpegQuality;

    if (!effectiveMaxWidth) {
      switch (args.quality) {
        case 'high':
          effectiveMaxWidth = 4096; // No real limit
          break;
        case 'high-medium':
          effectiveMaxWidth = 1920; // Full HD width
          break;
        case 'medium-plus':
          effectiveMaxWidth = 1440; // Between Full HD and standard
          break;
        case 'medium':
          effectiveMaxWidth = 1024;
          break;
        case 'low':
          effectiveMaxWidth = 800;
          break;
        case 'ultra-low':
          effectiveMaxWidth = 512;
          break;
      }
    }

    if (!effectiveJpegQuality && args.format === 'jpeg') {
      switch (args.quality) {
        case 'high':
          effectiveJpegQuality = 95;
          break;
        case 'high-medium':
          effectiveJpegQuality = 90;
          break;
        case 'medium-plus':
          effectiveJpegQuality = 85;
          break;
        case 'medium':
          effectiveJpegQuality = 80;
          break;
        case 'low':
          effectiveJpegQuality = 60;
          break;
        case 'ultra-low':
          effectiveJpegQuality = 40;
          break;
      }
    }

    // Build screenshot options to send to extension
    const screenshotOptions = {
      captureMode: args.captureMode,
      format: args.format,
      quality: effectiveJpegQuality,
      maxWidth: effectiveMaxWidth,
      maxHeight: args.maxHeight,
      scaleFactor: args.scaleFactor,
      region: args.region,
      grayscale: args.grayscale,
      blur: args.blur,
      removeBackground: args.removeBackground,
      optimize: args.optimize,
      targetSizeKB: args.targetSizeKB,
      fullPageScrollDelay: args.fullPageScrollDelay,
      fullPageMaxHeight: args.fullPageMaxHeight,
    };

    // Send screenshot request with options
    const response = await context.sendSocketMessage(
      "browser_screenshot",
      screenshotOptions,
    );

    // Check if we got base64 data
    if (!response.data) {
      return {
        content: [
          {
            type: "text",
            text: "Screenshot failed: No data received",
          },
        ],
      };
    }

    // Use the MIME type based on format
    const mimeType = `image/${args.format}`;

    // Ensure the base64 data is clean (no data URL prefix)
    let imageData = response.data;
    if (imageData.startsWith('data:')) {
      // Extract just the base64 portion if it's a data URL
      const parts = imageData.split(',');
      imageData = parts[1] || imageData;
    }

    let auditInfo = "";
    let compressionInfo = "";

    // Calculate compression info
    const originalSizeKB = response.originalSizeKB || 0;
    const finalSizeKB = Math.round((imageData.length * 0.75) / 1024); // Base64 to bytes approximation
    if (originalSizeKB > 0) {
      const compressionRatio = Math.round((1 - finalSizeKB / originalSizeKB) * 100);
      compressionInfo = `[Compression: ${originalSizeKB}KB → ${finalSizeKB}KB (${compressionRatio}% reduction)]`;
    }

    // Optionally save for audit purposes
    if (SCREENSHOT_CONFIG.enableAuditSave) {
      try {
        // Create audit directory if it doesn't exist
        if (!fs.existsSync(SCREENSHOT_CONFIG.auditDir)) {
          fs.mkdirSync(SCREENSHOT_CONFIG.auditDir, { recursive: true });
        }

        // Cleanup old files if needed
        cleanupOldFiles(SCREENSHOT_CONFIG.auditDir, SCREENSHOT_CONFIG.maxFiles);

        // Generate filename with timestamp and quality info
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const qualityInfo = args.quality !== 'medium' ? `-${args.quality}` : '';
        const extension = args.format === 'jpeg' ? 'jpg' : args.format;
        const filename = `screenshot-${timestamp}${qualityInfo}.${extension}`;
        const filepath = path.join(SCREENSHOT_CONFIG.auditDir, filename);

        // Save the screenshot (use cleaned data if we extracted it from data URL)
        let buffer = Buffer.from(imageData, 'base64');

        // Process the image if needed (resize, compress, etc.)
        if (args.quality !== 'high' || effectiveMaxWidth || args.maxHeight || args.scaleFactor || args.targetSizeKB || args.grayscale) {
          try {
            console.log(`Processing image with sharp: quality=${args.quality}, maxWidth=${effectiveMaxWidth}`);

            let sharpInstance = sharp(buffer);

            // Get image metadata
            const metadata = await sharpInstance.metadata();
            console.log(`Original image: ${metadata.width}x${metadata.height}, format: ${metadata.format}`);

            // First, handle Full HD viewport cropping if enabled
            if (args.maintainFullHD && metadata.width && metadata.height) {
              const targetWidth = args.viewportWidth || 1920;
              const targetHeight = args.viewportHeight || 1080;

              // If image is larger than target viewport, crop from top-left
              if (metadata.width > targetWidth || metadata.height > targetHeight) {
                // Crop from top-left corner (0, 0)
                const left = 0;
                const top = 0;
                const width = Math.min(targetWidth, metadata.width);
                const height = Math.min(targetHeight, metadata.height);

                sharpInstance = sharpInstance.extract({
                  left: left,
                  top: top,
                  width: width,
                  height: height
                });

                console.log(`Cropped to Full HD viewport from top-left: ${width}x${height} from ${metadata.width}x${metadata.height}`);

                // Update metadata for subsequent operations
                metadata.width = width;
                metadata.height = height;
              }
            }

            // Then resize if needed
            if (effectiveMaxWidth || args.maxHeight) {
              const resizeOptions: any = {};
              if (effectiveMaxWidth) resizeOptions.width = effectiveMaxWidth;
              if (args.maxHeight) resizeOptions.height = args.maxHeight;
              resizeOptions.fit = 'inside'; // Maintain aspect ratio
              resizeOptions.withoutEnlargement = true; // Don't upscale

              sharpInstance = sharpInstance.resize(resizeOptions);
              console.log(`Resizing to: width=${effectiveMaxWidth}, height=${args.maxHeight}`);
            }

            // Apply scale factor
            if (args.scaleFactor && args.scaleFactor < 1) {
              const newWidth = Math.round(metadata.width! * args.scaleFactor);
              const newHeight = Math.round(metadata.height! * args.scaleFactor);
              sharpInstance = sharpInstance.resize(newWidth, newHeight);
              console.log(`Scaling to ${args.scaleFactor * 100}%: ${newWidth}x${newHeight}`);
            }

            // Convert to grayscale if requested
            if (args.grayscale) {
              sharpInstance = sharpInstance.grayscale();
              console.log('Converting to grayscale');
            }

            // Apply blur if requested
            if (args.blur && args.blur > 0) {
              sharpInstance = sharpInstance.blur(args.blur);
              console.log(`Applying blur: ${args.blur}`);
            }

            // Convert to the desired format with quality settings
            if (args.format === 'jpeg') {
              sharpInstance = sharpInstance.jpeg({
                quality: effectiveJpegQuality || 80,
                progressive: true,
                mozjpeg: true // Use mozjpeg encoder for better compression
              });
            } else if (args.format === 'png') {
              sharpInstance = sharpInstance.png({
                quality: 100,
                compressionLevel: 9 // Max compression
              });
            } else if (args.format === 'webp') {
              sharpInstance = sharpInstance.webp({
                quality: effectiveJpegQuality || 80
              });
            }

            // Process the image
            buffer = await sharpInstance.toBuffer();

            // If target size is specified, try to meet it
            if (args.targetSizeKB && buffer.length / 1024 > args.targetSizeKB) {
              let currentQuality = effectiveJpegQuality || 80;
              let attempts = 0;
              const maxAttempts = 5;

              while (buffer.length / 1024 > args.targetSizeKB && attempts < maxAttempts && currentQuality > 10) {
                currentQuality = Math.max(10, currentQuality - 15);
                buffer = await sharp(buffer)
                  .jpeg({ quality: currentQuality, progressive: true, mozjpeg: true })
                  .toBuffer();
                attempts++;
                console.log(`Attempt ${attempts}: quality=${currentQuality}, size=${Math.round(buffer.length / 1024)}KB`);
              }
            }

            // Update imageData with the processed image
            imageData = buffer.toString('base64');
            console.log(`Image processed: final size=${Math.round(buffer.length / 1024)}KB`);

          } catch (error) {
            console.error('Sharp image processing failed:', error);
            // Keep original buffer if processing fails
          }
        }

        fs.writeFileSync(filepath, buffer);

        // Add audit info to be included in response
        const stats = fs.statSync(filepath);
        const fileSizeKB = Math.round(stats.size / 1024);
        auditInfo = `\n[Audit: Saved to ${filepath} (${fileSizeKB}KB)]`;
      } catch (e) {
        // Don't fail the screenshot if audit save fails
        auditInfo = `\n[Audit save failed: ${e.message}]`;
      }
    }

    const content = [
      {
        type: "image" as const,
        data: imageData, // base64 string
        mimeType: mimeType,
      }
    ];

    // Add compression and audit info as a separate text block if present
    const infoText = [compressionInfo, auditInfo].filter(Boolean).join('\n');
    if (infoText) {
      content.push({
        type: "text",
        text: infoText,
      });
    }

    return { content };
  },
};
