import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Tool } from "./tool";

const TabListSchema = z.object({});
const TabSelectSchema = z.object({
  index: z.number().describe("The index of the tab to select"),
});
const TabNewSchema = z.object({
  url: z.string().optional().describe("The URL to navigate to in the new tab. If not provided, the new tab will be blank."),
});
const TabCloseSchema = z.object({
  index: z.number().optional().describe("The index of the tab to close. Closes current tab if not provided."),
});

export const browser_tab_list: Tool = {
  schema: {
    name: "browser_tab_list",
    description: "List all open browser tabs",
    inputSchema: zodToJsonSchema(TabListSchema),
  },
  handle: async (context) => {
    const response = await context.sendSocketMessage("tabs.list", {});
    const tabsText = response.tabs.map((tab, idx) => 
      `[${tab.index}] ${tab.active ? '(Active) ' : ''}${tab.title} - ${tab.url}`
    ).join('\n');
    
    return {
      content: [{ 
        type: "text", 
        text: tabsText || "No tabs open" 
      }]
    };
  },
};

export const browser_tab_select: Tool = {
  schema: {
    name: "browser_tab_select",
    description: "Select a tab by index",
    inputSchema: zodToJsonSchema(TabSelectSchema),
  },
  handle: async (context, params) => {
    await context.sendSocketMessage("tabs.select", { index: params!.index });
    
    // Get SCAFFOLD snapshot of newly selected tab
    const snapshot = await context.sendSocketMessage("snapshot.accessibility", { mode: 'scaffold' });
    return { 
      content: [{ 
        type: "text", 
        text: `Tab ${params!.index} selected\n\n${snapshot.snapshot}` 
      }] 
    };
  },
};

export const browser_tab_new: Tool = {
  schema: {
    name: "browser_tab_new",
    description: "Open a new tab",
    inputSchema: zodToJsonSchema(TabNewSchema),
  },
  handle: async (context, params) => {
    const response = await context.sendSocketMessage("tabs.new", { 
      url: params?.url 
    });
    
    let content = `New tab opened at index ${response.index}`;
    
    // Get SCAFFOLD snapshot if URL was provided
    if (params?.url) {
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
  },
};

export const browser_tab_close: Tool = {
  schema: {
    name: "browser_tab_close",
    description: "Close a tab",
    inputSchema: zodToJsonSchema(TabCloseSchema),
  },
  handle: async (context, params) => {
    const response = await context.sendSocketMessage("tabs.close", { 
      index: params?.index 
    });
    
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
  },
};