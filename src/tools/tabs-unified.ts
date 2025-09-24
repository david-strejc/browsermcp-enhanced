import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Tool } from "./tool";

// Unified tab management schema
const TabActionSchema = z.object({
  action: z.enum(['list', 'select', 'new', 'close']).describe("Tab action to perform"),
  index: z.number().optional().describe("Tab index for select/close operations"),
  url: z.string().optional().describe("URL for new tab (optional)"),
});

/**
 * Unified browser tab management tool
 * Combines all tab operations into a single tool with action parameter
 */
export const browser_tab: Tool = {
  schema: {
    name: "browser_tab",
    description: "Manage browser tabs: list, select, new, or close tabs with single tool",
    inputSchema: zodToJsonSchema(TabActionSchema),
  },
  handle: async (context, params) => {
    const { action, index, url } = TabActionSchema.parse(params || { action: 'list' });

    switch (action) {
      case 'list': {
        const response = await context.sendSocketMessage("tabs.list", {});
        const tabsText = response.tabs.map((tab: any, idx: number) =>
          `[${tab.index}] ${tab.active ? '(Active) ' : ''}${tab.title} - ${tab.url}`
        ).join('\n');

        return {
          content: [{
            type: "text",
            text: tabsText || "No tabs open"
          }]
        };
      }

      case 'select': {
        if (index === undefined) {
          return {
            content: [{
              type: "text",
              text: "Error: index parameter required for select action"
            }]
          };
        }

        await context.sendSocketMessage("tabs.select", { index });

        // Get SCAFFOLD snapshot of newly selected tab
        const snapshot = await context.sendSocketMessage("snapshot.accessibility", { mode: 'scaffold' });
        return {
          content: [{
            type: "text",
            text: `Tab ${index} selected\n\n${snapshot.snapshot}`
          }]
        };
      }

      case 'new': {
        const response = await context.sendSocketMessage("tabs.new", {
          url,
          detectPopups: true
        });

        let content = `New tab opened at index ${response.index}`;

        // Check if popups were detected
        if (response && response.popupsDetected) {
          content += '\n\n🔔 POPUP DETECTED!\n';
          response.popups.forEach((popup: any, idx: number) => {
            content += `\nPopup ${idx + 1}: ${popup.type}\n`;
            content += `Text: ${popup.text?.slice(0, 200)}...\n`;
            content += `\nInteractive elements:\n`;
            popup.elements?.forEach((el: any) => {
              content += `- [${el.ref}] ${el.type}: "${el.text}" (${el.category})\n`;
              if (el.checked !== undefined) {
                content += `  Checked: ${el.checked}\n`;
              }
            });
          });
          content += `\nTo interact with popup, use browser_click with the ref ID.`;
        }

        // Get SCAFFOLD snapshot if URL was provided
        if (url) {
          // Wait a bit for page to load
          await new Promise(resolve => setTimeout(resolve, 1000));
          const snapResponse = await context.sendSocketMessage("snapshot.accessibility", { mode: 'scaffold' });
          content += "\n\n" + snapResponse.snapshot;
        }

        return {
          content: [{
            type: "text",
            text: content
          }]
        };
      }

      case 'close': {
        const response = await context.sendSocketMessage("tabs.close", { index });

        let content = response.success ? "Tab closed successfully" : "Failed to close tab";

        // Get SCAFFOLD snapshot of current tab after closing
        try {
          const snapResponse = await context.sendSocketMessage("snapshot.accessibility", { mode: 'scaffold' });
          content += "\n\n" + snapResponse.snapshot;
        } catch (e) {
          // Might fail if we closed the last tab
          content += "\n\nNo active tabs remaining";
        }

        return {
          content: [{
            type: "text",
            text: content
          }]
        };
      }

      default:
        return {
          content: [{
            type: "text",
            text: `Unknown action: ${action}`
          }]
        };
    }
  },
};

// Export old tools as deprecated references to unified tool
export const browser_tab_list = browser_tab;
export const browser_tab_select = browser_tab;
export const browser_tab_new = browser_tab;
export const browser_tab_close = browser_tab;