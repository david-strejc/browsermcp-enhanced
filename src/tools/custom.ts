import { zodToJsonSchema } from "zod-to-json-schema";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { GetConsoleLogsTool, ScreenshotTool } from "../types/tool";

import { Tool } from "./tool";

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
    
    // Create screenshots directory in temp folder
    const screenshotDir = path.join(os.tmpdir(), 'mcp-screenshots');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
    
    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `screenshot-${timestamp}.png`;
    const filepath = path.join(screenshotDir, filename);
    
    // Convert base64 to buffer and save
    const buffer = Buffer.from(response.data, 'base64');
    fs.writeFileSync(filepath, buffer);
    
    // Get file size
    const stats = fs.statSync(filepath);
    const fileSizeKB = Math.round(stats.size / 1024);
    
    // Return the file path and information
    return {
      content: [
        {
          type: "text",
          text: `Screenshot saved successfully!\n` +
                `File: ${filepath}\n` +
                `Size: ${fileSizeKB} KB\n` +
                `Format: PNG\n\n` +
                `To view the screenshot, open the file at the path above.\n` +
                `The file is saved in PNG format for best quality.`,
        },
      ],
    };
  },
};
