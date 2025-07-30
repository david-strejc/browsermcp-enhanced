import { Tool } from "./tool.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// Schema for starting debugger session
const DebuggerAttachSchema = z.object({
  domains: z.array(z.enum(["console", "network", "performance", "runtime"])).optional()
    .describe("Which debugging domains to enable. Defaults to all."),
});

// Schema for getting debug data
const DebuggerGetDataSchema = z.object({
  type: z.enum(["console", "network", "performance", "errors"])
    .describe("Type of debug data to retrieve"),
  limit: z.number().optional().default(50)
    .describe("Maximum number of entries to return"),
  filter: z.string().optional()
    .describe("Optional filter string for results"),
});

// Attach debugger tool
export const browser_debugger_attach: Tool = {
  schema: {
    name: "browser_debugger_attach",
    description: "Attach debugger to current tab to enable monitoring of console, network, and performance",
    inputSchema: zodToJsonSchema(DebuggerAttachSchema),
  },
  handle: async (context) => {
    const input = DebuggerAttachSchema.parse(context.params);
    const domains = input.domains || ["console", "network", "performance", "runtime"];
    
    const response = await context.sendSocketMessage("debugger.attach", { domains });
    
    return {
      content: [
        {
          type: "text",
          text: `Debugger attached with domains: ${domains.join(", ")}. Now monitoring browser activity.`,
        },
      ],
    };
  },
};

// Detach debugger tool
export const browser_debugger_detach: Tool = {
  schema: {
    name: "browser_debugger_detach",
    description: "Detach debugger from current tab",
    inputSchema: zodToJsonSchema(z.object({})),
  },
  handle: async (context) => {
    await context.sendSocketMessage("debugger.detach", {});
    
    return {
      content: [
        {
          type: "text",
          text: "Debugger detached. Monitoring stopped.",
        },
      ],
    };
  },
};

// Get debug data tool
export const browser_debugger_get_data: Tool = {
  schema: {
    name: "browser_debugger_get_data",
    description: "Get collected debug data (console logs, network requests, performance metrics, or errors)",
    inputSchema: zodToJsonSchema(DebuggerGetDataSchema),
  },
  handle: async (context) => {
    const input = DebuggerGetDataSchema.parse(context.params);
    
    const response = await context.sendSocketMessage("debugger.getData", {
      type: input.type,
      limit: input.limit,
      filter: input.filter,
    });
    
    // Format the response based on type
    let formattedData = "";
    
    switch (input.type) {
      case "console":
        formattedData = formatConsoleLogs(response.data);
        break;
      case "network":
        formattedData = formatNetworkRequests(response.data);
        break;
      case "performance":
        formattedData = formatPerformanceMetrics(response.data);
        break;
      case "errors":
        formattedData = formatErrors(response.data);
        break;
    }
    
    return {
      content: [
        {
          type: "text",
          text: formattedData,
        },
      ],
    };
  },
};

// Helper functions to format data
function formatConsoleLogs(logs: any[]): string {
  if (!logs || logs.length === 0) return "No console logs captured.";
  
  return logs.map(log => 
    `[${log.type.toUpperCase()}] ${log.timestamp}: ${log.args.map((arg: any) => 
      typeof arg === 'object' ? JSON.stringify(arg) : arg
    ).join(' ')}${log.stackTrace ? '\n  at ' + log.stackTrace : ''}`
  ).join('\n');
}

function formatNetworkRequests(requests: any[]): string {
  if (!requests || requests.length === 0) return "No network requests captured.";
  
  return requests.map(req => 
    `${req.method} ${req.url}\n` +
    `  Status: ${req.status || 'pending'}\n` +
    `  Type: ${req.type}\n` +
    `  Size: ${req.size || 'unknown'}\n` +
    `  Time: ${req.time || 'pending'}ms`
  ).join('\n\n');
}

function formatPerformanceMetrics(metrics: any): string {
  if (!metrics) return "No performance metrics available.";
  
  return Object.entries(metrics).map(([key, value]) => 
    `${key}: ${value}`
  ).join('\n');
}

function formatErrors(errors: any[]): string {
  if (!errors || errors.length === 0) return "No errors captured.";
  
  return errors.map(err => 
    `[ERROR] ${err.timestamp}: ${err.message}\n` +
    `  File: ${err.url}:${err.line}:${err.column}\n` +
    `  Stack: ${err.stack || 'No stack trace'}`
  ).join('\n\n');
}

// Export all debugger tools
export const debuggerTools = [
  browser_debugger_attach,
  browser_debugger_detach,
  browser_debugger_get_data,
];