import { Tool } from "./tool.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// Unified schema for debugger operations
const DebuggerSchema = z.object({
  action: z.enum(["attach", "detach", "get_data"])
    .describe("Debugger action to perform"),

  // For attach action
  domains: z.array(z.enum(["console", "network", "performance", "runtime"])).optional()
    .describe("Which debugging domains to enable (for attach action). Defaults to all."),

  // For get_data action
  type: z.enum(["console", "network", "performance", "errors"]).optional()
    .describe("Type of debug data to retrieve (for get_data action)"),
  limit: z.number().optional().default(50)
    .describe("Maximum number of entries to return (for get_data action)"),
  filter: z.string().optional()
    .describe("Optional filter string for results (for get_data action)"),
});

// Unified browser_debugger tool
export const browser_debugger: Tool = {
  schema: {
    name: "browser_debugger",
    description: "Manage Chrome DevTools debugging: attach/detach session or get debug data",
    inputSchema: zodToJsonSchema(DebuggerSchema),
  },
  handle: async (context, params) => {
    const input = DebuggerSchema.parse(params || {});

    switch (input.action) {
      case "attach": {
        const domains = input.domains || ["console", "network", "performance", "runtime"];
        await context.sendSocketMessage("debugger.attach", { domains });

        return {
          content: [
            {
              type: "text",
              text: `Debugger attached with domains: ${domains.join(", ")}. Now monitoring browser activity.`,
            },
          ],
        };
      }

      case "detach": {
        await context.sendSocketMessage("debugger.detach", {});

        return {
          content: [
            {
              type: "text",
              text: "Debugger detached. Monitoring stopped.",
            },
          ],
        };
      }

      case "get_data": {
        if (!input.type) {
          throw new Error("Type is required for get_data action");
        }

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
      }

      default:
        throw new Error(`Unknown debugger action: ${input.action}`);
    }
  },
};

// Helper functions to format data
function formatConsoleLogs(logs: any[]): string {
  if (!logs || logs.length === 0) return "No console logs captured.";

  // Separate buffered and live logs
  const bufferedLogs = logs.filter(log => log.buffered);
  const liveLogs = logs.filter(log => !log.buffered);

  let output = "";

  if (bufferedLogs.length > 0) {
    output += "=== CONSOLE LOGS FROM BEFORE DEBUGGER ATTACHMENT ===\n";
    output += bufferedLogs.map(log =>
      `[${log.type.toUpperCase()}] ${log.timestamp}: ${log.args.map((arg: any) =>
        typeof arg === 'object' ? JSON.stringify(arg) : arg
      ).join(' ')}${log.stackTrace ? '\n  at ' + log.stackTrace : ''}`
    ).join('\n');

    if (liveLogs.length > 0) {
      output += "\n\n=== CONSOLE LOGS AFTER DEBUGGER ATTACHMENT ===\n";
    }
  }

  if (liveLogs.length > 0) {
    output += liveLogs.map(log =>
      `[${log.type.toUpperCase()}] ${log.timestamp}: ${log.args.map((arg: any) =>
        typeof arg === 'object' ? JSON.stringify(arg) : arg
      ).join(' ')}${log.stackTrace ? '\n  at ' + log.stackTrace : ''}`
    ).join('\n');
  }

  return output;
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

  // Separate buffered and live errors
  const bufferedErrors = errors.filter(err => err.buffered);
  const liveErrors = errors.filter(err => !err.buffered);

  let output = "";

  if (bufferedErrors.length > 0) {
    output += "=== ERRORS THAT OCCURRED BEFORE DEBUGGER ATTACHMENT ===\n";
    output += bufferedErrors.map(err =>
      `[${err.level?.toUpperCase() || 'ERROR'}] ${err.timestamp}: ${err.message}\n` +
      `  File: ${err.url || 'unknown'}:${err.line || '?'}:${err.column || '?'}\n` +
      `  Source: ${err.source || 'unknown'}\n` +
      `  Stack: ${err.stack || 'No stack trace'}`
    ).join('\n\n');

    if (liveErrors.length > 0) {
      output += "\n\n=== ERRORS CAPTURED AFTER DEBUGGER ATTACHMENT ===\n";
    }
  }

  if (liveErrors.length > 0) {
    output += liveErrors.map(err =>
      `[${err.level?.toUpperCase() || 'ERROR'}] ${err.timestamp}: ${err.message}\n` +
      `  File: ${err.url || 'unknown'}:${err.line || '?'}:${err.column || '?'}\n` +
      `  Source: ${err.source || 'unknown'}\n` +
      `  Stack: ${err.stack || 'No stack trace'}`
    ).join('\n\n');
  }

  return output;
}