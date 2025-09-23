import { zodToJsonSchema } from "zod-to-json-schema";
import { ErrorRecovery } from "../utils/error-recovery";

import {
  ClickTool,
  DragTool,
  HoverTool,
  SelectOptionTool,
  SnapshotTool,
  TypeTool,
} from "../types/tool";

import type { Context } from "../context";
import { captureAriaSnapshot } from "../utils/aria-snapshot";

import type { Tool } from "./tool";

export const snapshot: Tool = {
  schema: {
    name: SnapshotTool.shape.name.value,
    description: SnapshotTool.shape.description.value,
    inputSchema: zodToJsonSchema(SnapshotTool.shape.arguments),
  },
  handle: async (context: Context, params) => {
    const validatedParams = SnapshotTool.shape.arguments.parse(params || {});
    
    // Check for scaffold mode in either level or mode parameter
    const isScaffold = validatedParams.level === 'scaffold' || validatedParams.mode === 'scaffold';
    
    return await captureAriaSnapshot(context, "", {
      level: isScaffold ? 'scaffold' : validatedParams.level,
      viewportOnly: validatedParams.viewportOnly,
      mode: validatedParams.mode
    });
  },
};

export const click: Tool = {
  schema: {
    name: ClickTool.shape.name.value,
    description: ClickTool.shape.description.value,
    inputSchema: zodToJsonSchema(ClickTool.shape.arguments),
  },
  handle: async (context: Context, params) => {
    try {
      const validatedParams = ClickTool.shape.arguments.parse(params);
      
      // Use enhanced context messaging with error context
      const response = await context.sendWithContext(
        "dom.click",
        { ref: validatedParams.ref, detectPopups: true },
        `clicking element "${validatedParams.element}" with ref ${validatedParams.ref}`
      );
      
      const snapshot = await captureAriaSnapshot(context);
      
      // Check if popups were detected after click
      let popupInfo = '';
      if (response && response.popupsDetected) {
        popupInfo = '\n\n🔔 POPUP DETECTED AFTER CLICK!\n';
        response.popups.forEach((popup: any, index: number) => {
          popupInfo += `\nPopup ${index + 1}: ${popup.type}\n`;
          popupInfo += `Text: ${popup.text?.slice(0, 200)}...\n`;
          popupInfo += `\nInteractive elements:\n`;
          popup.elements?.forEach((el: any) => {
            popupInfo += `- [${el.ref}] ${el.type}: "${el.text}" (${el.category})\n`;
          });
        });
        popupInfo += '\nTo interact with popup, use browser_click with the ref ID.';
      }
      
      return {
        content: [
          {
            type: "text",
            text: `✅ Clicked "${validatedParams.element}"${popupInfo}`,
          },
          ...snapshot.content,
        ],
      };
    } catch (error) {
      return ErrorRecovery.handleToolError(
        error as Error,
        'browser_click',
        params ? `element "${(params as any).element}" with ref ${(params as any).ref}` : undefined
      );
    }
  },
};

export const drag: Tool = {
  schema: {
    name: DragTool.shape.name.value,
    description: DragTool.shape.description.value,
    inputSchema: zodToJsonSchema(DragTool.shape.arguments),
  },
  handle: async (context: Context, params) => {
    const validatedParams = DragTool.shape.arguments.parse(params);
    await context.sendSocketMessage("dom.drag", { 
      ref: validatedParams.ref, 
      targetRef: validatedParams.targetRef 
    });
    const snapshot = await captureAriaSnapshot(context);
    return {
      content: [
        {
          type: "text",
          text: `Dragged element "${validatedParams.ref}" to "${validatedParams.targetRef}"`,
        },
        ...snapshot.content,
      ],
    };
  },
};

export const hover: Tool = {
  schema: {
    name: HoverTool.shape.name.value,
    description: HoverTool.shape.description.value,
    inputSchema: zodToJsonSchema(HoverTool.shape.arguments),
  },
  handle: async (context: Context, params) => {
    const validatedParams = HoverTool.shape.arguments.parse(params);
    await context.sendSocketMessage("dom.hover", { ref: validatedParams.ref });
    const snapshot = await captureAriaSnapshot(context);
    return {
      content: [
        {
          type: "text",
          text: `Hovered over "${validatedParams.element}"`,
        },
        ...snapshot.content,
      ],
    };
  },
};

export const type: Tool = {
  schema: {
    name: TypeTool.shape.name.value,
    description: TypeTool.shape.description.value,
    inputSchema: zodToJsonSchema(TypeTool.shape.arguments),
  },
  handle: async (context: Context, params) => {
    const validatedParams = TypeTool.shape.arguments.parse(params);

    // Handle both ref and selector inputs
    if (!validatedParams.ref && !validatedParams.selector) {
      throw new Error("Either 'ref' or 'selector' must be provided");
    }

    // Determine if we should press Enter (support both submit and pressEnter)
    const shouldPressEnter = validatedParams.submit || validatedParams.pressEnter || false;

    // If selector provided, use safe-mode API
    if (validatedParams.selector && !validatedParams.ref) {
      const code = `
        return await api.setInput('${validatedParams.selector}', '${validatedParams.text}', { pressEnter: ${shouldPressEnter} });
      `;

      try {
        const response = await context.sendSocketMessage("js.execute", {
          code: code,
          timeout: 5000,
          unsafe: false
        }, { timeoutMs: 5500 });

        const result = response.result;
        return {
          content: [{
            type: "text",
            text: result ? `Typed "${validatedParams.text}" into selector "${validatedParams.selector}"${shouldPressEnter ? ' and pressed Enter' : ''}` : 'Failed to type - element not found or not an input'
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text",
            text: `Error typing into selector: ${error.message}`
          }]
        };
      }
    }

    // Use ref-based typing for backward compatibility
    await context.sendSocketMessage("dom.type", {
      ref: validatedParams.ref,
      text: validatedParams.text,
      submit: shouldPressEnter
    });
    const snapshot = await captureAriaSnapshot(context);
    return {
      content: [
        {
          type: "text",
          text: `Typed "${validatedParams.text}" into "${validatedParams.element || validatedParams.ref}"${shouldPressEnter ? ' and pressed Enter' : ''}`,
        },
        ...snapshot.content,
      ],
    };
  },
};

export const selectOption: Tool = {
  schema: {
    name: SelectOptionTool.shape.name.value,
    description: SelectOptionTool.shape.description.value,
    inputSchema: zodToJsonSchema(SelectOptionTool.shape.arguments),
  },
  handle: async (context: Context, params) => {
    const validatedParams = SelectOptionTool.shape.arguments.parse(params);
    await context.sendSocketMessage("dom.select", { 
      ref: validatedParams.ref, 
      values: validatedParams.values 
    });
    const snapshot = await captureAriaSnapshot(context);
    return {
      content: [
        {
          type: "text",
          text: `Selected option in "${validatedParams.element}"`,
        },
        ...snapshot.content,
      ],
    };
  },
};
