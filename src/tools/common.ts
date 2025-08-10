import { zodToJsonSchema } from "zod-to-json-schema";

import {
  GoBackTool,
  GoForwardTool,
  NavigateTool,
  PressKeyTool,
  WaitTool,
} from "../types/tool";

import { captureAriaSnapshot } from "../utils/aria-snapshot";

import type { Tool, ToolFactory } from "./tool";

export const navigate: ToolFactory = (snapshot) => ({
  schema: {
    name: NavigateTool.shape.name.value,
    description: NavigateTool.shape.description.value,
    inputSchema: zodToJsonSchema(NavigateTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { url } = NavigateTool.shape.arguments.parse(params);
    const response = await context.sendSocketMessage("browser_navigate", { url, detectPopups: true });
    
    // Check if popups were detected
    let popupInfo = '';
    if (response && response.popupsDetected) {
      popupInfo = `\n\n🔔 POPUP DETECTED!\n`;
      response.popups.forEach((popup: any, index: number) => {
        popupInfo += `\nPopup ${index + 1}: ${popup.type}\n`;
        popupInfo += `Text: ${popup.text?.slice(0, 200)}...\n`;
        popupInfo += `\nInteractive elements:\n`;
        popup.elements?.forEach((el: any) => {
          popupInfo += `- [${el.ref}] ${el.type}: "${el.text}" (${el.category})\n`;
          if (el.checked !== undefined) {
            popupInfo += `  Checked: ${el.checked}\n`;
          }
        });
      });
      popupInfo += `\nTo interact with popup, use browser_click with the ref ID.`;
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
