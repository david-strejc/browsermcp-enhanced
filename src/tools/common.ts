import { zodToJsonSchema } from "zod-to-json-schema";

import {
  GoBackTool,
  GoForwardTool,
  NavigateTool,
  PressKeyTool,
  WaitTool,
} from "../types/tool";
import { z } from "zod";
import { captureAriaSnapshot } from "../utils/aria-snapshot";

import type { Tool, ToolFactory } from "./tool";

// Enhanced NavigateTool with optional snapshot
const NavigateToolEnhanced = z.object({
  name: z.literal("browser_navigate"),
  arguments: z.object({
    url: z.string().describe("The URL to navigate to"),
    snapshot: z.boolean().optional().describe("Whether to capture a snapshot after navigation (default: true)"),
  }),
});

export const navigate: ToolFactory = (defaultSnapshot = true) => ({
  schema: {
    name: NavigateToolEnhanced.shape.name.value,
    description: "Navigate to a URL with optional snapshot",
    inputSchema: zodToJsonSchema(NavigateToolEnhanced.shape.arguments),
  },
  handle: async (context, params) => {
    const { url, snapshot = defaultSnapshot } = NavigateToolEnhanced.shape.arguments.parse(params);
    const response = await context.sendSocketMessage("browser_navigate", { url, detectPopups: true });

    // Simply report popup detection
    let popupInfo = '';
    if (response && response.popupsDetected && response.popups && response.popups.length > 0) {
      const popup = response.popups[0];
      popupInfo = `\n\n[POPUP DETECTED: ${popup.containerSelector}]\n`;
      popupInfo += `[YOU MUST USE browser_execute_js TO CLICK ACCEPT/AGREE SO THE POPUP WON'T APPEAR AGAIN]`;
    }

    if (snapshot) {
      const snapshotResult = await captureAriaSnapshot(context);
      // Append popup info to snapshot text
      if (popupInfo && snapshotResult.content[0].type === 'text') {
        snapshotResult.content[0].text += popupInfo;
      }
      return snapshotResult;
    }

    return {
      content: [
        {
          type: "text",
          text: `Navigated to ${url}${popupInfo}`,
        },
      ],
    };
  },
});

export const goBack: ToolFactory = (snapshot) => ({
  schema: {
    name: GoBackTool.shape.name.value,
    description: GoBackTool.shape.description.value,
    inputSchema: zodToJsonSchema(GoBackTool.shape.arguments),
  },
  handle: async (context) => {
    await context.sendSocketMessage("browser_go_back", {});
    if (snapshot) {
      return captureAriaSnapshot(context);
    }
    return {
      content: [
        {
          type: "text",
          text: "Navigated back",
        },
      ],
    };
  },
});

export const goForward: ToolFactory = (snapshot) => ({
  schema: {
    name: GoForwardTool.shape.name.value,
    description: GoForwardTool.shape.description.value,
    inputSchema: zodToJsonSchema(GoForwardTool.shape.arguments),
  },
  handle: async (context) => {
    await context.sendSocketMessage("browser_go_forward", {});
    if (snapshot) {
      return captureAriaSnapshot(context);
    }
    return {
      content: [
        {
          type: "text",
          text: "Navigated forward",
        },
      ],
    };
  },
});

export const wait: Tool = {
  schema: {
    name: WaitTool.shape.name.value,
    description: WaitTool.shape.description.value,
    inputSchema: zodToJsonSchema(WaitTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { time } = WaitTool.shape.arguments.parse(params);
    await context.sendSocketMessage("browser_wait", { time });
    return {
      content: [
        {
          type: "text",
          text: `Waited for ${time} seconds`,
        },
      ],
    };
  },
};

export const pressKey: Tool = {
  schema: {
    name: PressKeyTool.shape.name.value,
    description: PressKeyTool.shape.description.value,
    inputSchema: zodToJsonSchema(PressKeyTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { key } = PressKeyTool.shape.arguments.parse(params);
    await context.sendSocketMessage("browser_press_key", { key });
    return {
      content: [
        {
          type: "text",
          text: `Pressed key ${key}`,
        },
      ],
    };
  },
};
