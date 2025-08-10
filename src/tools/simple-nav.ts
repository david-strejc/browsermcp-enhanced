import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod";
import type { Tool } from "./tool";
import type { Context } from "../context";

// Simple navigation tool without snapshot
const SimpleNavigateTool = z.object({
  name: z.literal("browser_navigate_simple"),
  arguments: z.object({
    url: z.string().describe("The URL to navigate to"),
  }),
});

export const navigateSimple: Tool = {
  schema: {
    name: "browser_navigate_simple",
    description: "Navigate to a URL (simple version without snapshot)",
    inputSchema: zodToJsonSchema(SimpleNavigateTool.shape.arguments),
  },
  handle: async (context: Context, params) => {
    const { url } = SimpleNavigateTool.shape.arguments.parse(params);
    await context.sendSocketMessage("browser_navigate", { url });
    
    return {
      content: [
        {
          type: "text",
          text: `Navigated to ${url}`,
        },
      ],
    };
  },
};