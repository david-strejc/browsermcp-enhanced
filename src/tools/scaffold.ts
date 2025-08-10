import zodToJsonSchema from "zod-to-json-schema";
import { z } from "zod";
import type { Context } from "../context";
import type { Tool } from "./tool";

// Define the tool schemas
const ExpandRegionTool = z.object({
  name: z.literal("browser_expand_region"),
  description: z.literal("Expand a specific region of the page with token budget control"),
  arguments: z.object({
    ref: z.string().describe("The ref ID of the region to expand"),
    maxTokens: z.number().optional().default(5000).describe("Maximum tokens to use"),
    depth: z.number().optional().default(2).describe("How many levels deep to traverse"),
    filter: z.enum(["all", "interactive", "text"]).optional().default("all").describe("Filter elements by type")
  })
});

const QueryElementsTool = z.object({
  name: z.literal("browser_query_elements"),
  description: z.literal("Query elements by selector, text content, or proximity"),
  arguments: z.object({
    selector: z.string().optional().default("*").describe("CSS selector to match"),
    containing: z.string().optional().describe("Text content to search for"),
    nearRef: z.string().optional().describe("Find elements near this ref ID"),
    limit: z.number().optional().default(20).describe("Maximum number of results")
  })
});

// Expand region tool
export const expandRegion: Tool = {
  schema: {
    name: ExpandRegionTool.shape.name.value,
    description: ExpandRegionTool.shape.description.value,
    inputSchema: zodToJsonSchema(ExpandRegionTool.shape.arguments),
  },
  handle: async (context: Context, params) => {
    const validatedParams = ExpandRegionTool.shape.arguments.parse(params || {});
    const response = await context.sendSocketMessage("dom.expand", validatedParams);
    
    // Validate response structure
    if (response && typeof response === 'object' && 'expansion' in response) {
      return {
        content: [
          {
            type: "text",
            text: response.expansion,
          },
        ],
      };
    } else if (typeof response === 'string') {
      // Direct string response (fallback)
      return {
        content: [
          {
            type: "text",
            text: response,
          },
        ],
      };
    } else {
      // Unexpected response format - fail with diagnostic info
      return {
        content: [
          {
            type: "text",
            text: `Error: Unexpected response format from dom.expand. Expected {expansion: string} but got: ${JSON.stringify(response, null, 2)}`,
          },
        ],
        isError: true,
      };
    }
  },
};

// Query elements tool
export const queryElements: Tool = {
  schema: {
    name: QueryElementsTool.shape.name.value,
    description: QueryElementsTool.shape.description.value,
    inputSchema: zodToJsonSchema(QueryElementsTool.shape.arguments),
  },
  handle: async (context: Context, params) => {
    const validatedParams = QueryElementsTool.shape.arguments.parse(params || {});
    const response = await context.sendSocketMessage("dom.query", validatedParams);
    
    // Validate response structure
    if (response && typeof response === 'object' && 'results' in response) {
      return {
        content: [
          {
            type: "text",
            text: response.results,
          },
        ],
      };
    } else if (typeof response === 'string') {
      // Direct string response (fallback)
      return {
        content: [
          {
            type: "text",
            text: response,
          },
        ],
      };
    } else {
      // Unexpected response format - fail with diagnostic info
      return {
        content: [
          {
            type: "text",
            text: `Error: Unexpected response format from dom.query. Expected {results: string} but got: ${JSON.stringify(response, null, 2)}`,
          },
        ],
        isError: true,
      };
    }
  },
};