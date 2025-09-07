import { zodToJsonSchema } from "zod-to-json-schema";
import * as fs from "fs";
import * as path from "path";

import { GetConsoleLogsTool, ScreenshotTool } from "../types/tool";

import { Tool } from "./tool";

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
  handle: async (context, _params) => {
    const response = await context.sendSocketMessage(
      "console.get",
      {},
    );
    const text: string = response.logs
      .map((log) => JSON.stringify(log))
      .join("\n");
    return {
      content: [{ type: "text", text }],
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
  handle: async (context, _params) => {
    const response = await context.sendSocketMessage(
      "browser_screenshot",
      {},
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
    
    // Use the MIME type from the response if available, default to JPEG for better compression
    const mimeType = response.mimeType || "image/jpeg";
    
    // Ensure the base64 data is clean (no data URL prefix)
    let imageData = response.data;
    if (imageData.startsWith('data:')) {
      // Extract just the base64 portion if it's a data URL
      const parts = imageData.split(',');
      imageData = parts[1] || imageData;
    }
    
    let auditInfo = "";
    
    // Optionally save for audit purposes
    if (SCREENSHOT_CONFIG.enableAuditSave) {
      try {
        // Create audit directory if it doesn't exist
        if (!fs.existsSync(SCREENSHOT_CONFIG.auditDir)) {
          fs.mkdirSync(SCREENSHOT_CONFIG.auditDir, { recursive: true });
        }
        
        // Cleanup old files if needed
        cleanupOldFiles(SCREENSHOT_CONFIG.auditDir, SCREENSHOT_CONFIG.maxFiles);
        
        // Generate filename with timestamp (use jpg extension if JPEG)
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const extension = mimeType === 'image/jpeg' ? 'jpg' : 'png';
        const filename = `screenshot-${timestamp}.${extension}`;
        const filepath = path.join(SCREENSHOT_CONFIG.auditDir, filename);
        
        // Save the screenshot (use cleaned data if we extracted it from data URL)
        const buffer = Buffer.from(imageData, 'base64');
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
    
    // Add audit info as a separate text block if present
    if (auditInfo) {
      content.push({
        type: "text",
        text: auditInfo,
      });
    }
    
    return { content };
  },
};
