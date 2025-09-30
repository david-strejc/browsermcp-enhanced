import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod";
import { captureAriaSnapshot } from "../utils/aria-snapshot";
import type { Tool } from "./tool";
import type { Context } from "../context";

// Unified navigation schema
const NavigationSchema = z.object({
  action: z.enum(['goto', 'back', 'forward', 'refresh']).default('goto')
    .describe("Navigation action: goto URL, go back, go forward, or refresh"),
  url: z.string().optional().describe("URL to navigate to (required for 'goto' action)"),
  snapshot: z.boolean().optional().default(true)
    .describe("Whether to capture a snapshot after navigation"),
});

/**
 * Unified browser navigation tool
 * Combines navigate, back, forward, and refresh into single tool
 */
export const browser_navigate: Tool = {
  schema: {
    name: "browser_navigate",
    description: "Navigate browser: goto URL, back, forward, or refresh page",
    inputSchema: zodToJsonSchema(NavigationSchema),
  },
  handle: async (context: Context, params) => {
    const { action, url, snapshot } = NavigationSchema.parse(params || { action: 'goto' });

    let navigationResult: string = '';
    let popupInfo = '';

    switch (action) {
      case 'goto': {
        if (!url) {
          return {
            content: [{
              type: "text",
              text: "Error: URL required for goto action"
            }]
          };
        }

        const response = await context.sendSocketMessage("browser_navigate", { url, detectPopups: true });
        navigationResult = `Navigated to ${url}`;

        // Check for popup detection
        if (response && response.popupsDetected && response.popups && response.popups.length > 0) {
          const popup = response.popups[0];
          popupInfo = `\n\n[POPUP DETECTED: ${popup.containerSelector}]\n`;
          popupInfo += `[USE browser_execute_js TO CLICK ACCEPT/AGREE SO THE POPUP WON'T APPEAR AGAIN]`;
        }
        break;
      }

      case 'back': {
        await context.sendSocketMessage("browser_go_back", {});
        navigationResult = "Navigated back";
        break;
      }

      case 'forward': {
        await context.sendSocketMessage("browser_go_forward", {});
        navigationResult = "Navigated forward";
        break;
      }

      case 'refresh': {
        await context.sendSocketMessage("browser_refresh", {});
        navigationResult = "Page refreshed";
        break;
      }

      default:
        return {
          content: [{
            type: "text",
            text: `Unknown navigation action: ${action}`
          }]
        };
    }

    // Capture snapshot if requested (use scaffold mode for compact output)
    if (snapshot) {
      const snapshotResult = await captureAriaSnapshot(context, "", { mode: 'scaffold' });
      // Append popup info to snapshot text if present
      if (popupInfo && snapshotResult.content[0].type === 'text') {
        snapshotResult.content[0].text = navigationResult + popupInfo + '\n\n' + snapshotResult.content[0].text;
      } else if (snapshotResult.content[0].type === 'text') {
        snapshotResult.content[0].text = navigationResult + '\n\n' + snapshotResult.content[0].text;
      }
      return snapshotResult;
    }

    return {
      content: [{
        type: "text",
        text: navigationResult + popupInfo,
      }],
    };
  },
};

// Legacy exports pointing to unified tool for backward compatibility
export const navigate = browser_navigate;
export const goBack = browser_navigate;
export const goForward = browser_navigate;