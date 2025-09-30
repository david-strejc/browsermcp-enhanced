import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Hot-reload test #5: Extension tabs now PRESERVED during hot-reload!
import { Context } from "./context";
import type { Resource } from "./resources/resource";
import type { Tool } from "./tools/tool";
import { createWebSocketServer } from "./ws";
import { PortRegistryManager } from "./utils/port-registry";

type Options = {
  name: string;
  version: string;
  tools: Tool[];
  resources: Resource[];
};

export async function createServerWithTools(options: Options): Promise<Server> {
  const { name, version, tools, resources } = options;

  // Build toolbox for inter-tool invocation (shared across all connections)
  const toolbox: Record<string, Tool> = {};
  for (const tool of tools) {
    toolbox[tool.schema.name] = tool;
  }

  const server = new Server(
    { name, version },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  const { server: wss, port, instanceId } = await createWebSocketServer();

  // CRITICAL FIX: Track current active context
  // Since each MCP server instance (port) handles ONE Claude connection at a time,
  // we track the current active context and replace it when a new connection arrives
  let currentContext: Context | null = null;
  const contextMap = new Map<WebSocket, Context>();

  wss.on("connection", (websocket) => {
    // CRITICAL FIX: Create a NEW context for EACH connection
    // This ensures proper instance isolation - no shared state!
    const connectionContext = new Context();
    connectionContext.ws = websocket;
    connectionContext.instanceId = instanceId;
    connectionContext.port = port;
    connectionContext.toolbox = toolbox;

    // Store context mapping
    contextMap.set(websocket, connectionContext);
    currentContext = connectionContext; // Update current active context

    console.log(`[BrowserMCP] New connection established, context ID: ${instanceId}, contexts active: ${contextMap.size}`);

    // Cleanup on disconnect
    websocket.on('close', () => {
      console.log(`[BrowserMCP] Connection closed, cleaning up context for ${instanceId}`);
      const ctx = contextMap.get(websocket);
      if (ctx) {
        ctx.close().catch((err) => {
          console.warn('[BrowserMCP] Error during context cleanup:', err);
        });
        contextMap.delete(websocket);

        // Clear current context if this was the active one
        if (currentContext === ctx) {
          currentContext = null;
        }
      }
      console.log(`[BrowserMCP] Contexts remaining: ${contextMap.size}`);
    });

    // Send hello handshake with instance ID
    websocket.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'hello' && msg.wants === 'instanceId') {
          websocket.send(JSON.stringify({
            type: 'helloAck',
            instanceId: instanceId,
            port: port
          }));
          return;
        }

        if (msg.type === 'portListRequest') {
          PortRegistryManager.getActiveInstances().then((instances) => {
            websocket.send(JSON.stringify({
              type: 'portListResponse',
              ports: instances.map((entry) => entry.port)
            }));
          }).catch((err) => {
            websocket.send(JSON.stringify({
              type: 'portListResponse',
              ports: [],
              error: err instanceof Error ? err.message : String(err)
            }));
          });
          return;
        }
      } catch (err) {
        // Not a hello message, ignore for this handler
      }
    });
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: tools.map((tool) => tool.schema) };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return { resources: resources.map((resource) => resource.schema) };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find((tool) => tool.schema.name === request.params.name);
    if (!tool) {
      return {
        content: [
          { type: "text", text: `Tool "${request.params.name}" not found` },
        ],
        isError: true,
      };
    }

    // Use current active context for this request
    if (!currentContext) {
      return {
        content: [{ type: "text", text: "No active connection context" }],
        isError: true,
      };
    }

    try {
      const raw = await tool.handle(currentContext, request.params.arguments) as any;

      // If tool already returned proper MCP ToolResult, pass it through
      if (raw && Array.isArray(raw.content)) {
        return raw;
      }

      // Normalize non-MCP shapes
      let text: string;
      let isError = false;

      // Map common ad-hoc error shapes to MCP
      if (raw && raw.success === false && (raw.error || raw.message)) {
        text = String(raw.error || raw.message);
        isError = true;
      } else if (raw === undefined || raw === null) {
        text = 'Tool returned no data';
        isError = true;
      } else if (typeof raw === 'string') {
        text = raw;
      } else {
        try {
          text = JSON.stringify(raw, null, 2);
        } catch {
          text = String(raw);
        }
      }

      return {
        content: [{ type: 'text', text }],
        isError
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: String(error) }],
        isError: true,
      };
    }
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resource = resources.find(
      (resource) => resource.schema.uri === request.params.uri,
    );
    if (!resource) {
      return { contents: [] };
    }

    // Use current active context for this request
    if (!currentContext) {
      return { contents: [] };
    }

    const contents = await resource.read(currentContext, request.params.uri);
    return { contents };
  });

  const originalClose = server.close.bind(server);
  server.close = async () => {
    await originalClose();
    await wss.close();

    // Close all active contexts
    for (const ctx of contextMap.values()) {
      await ctx.close().catch(err => {
        console.warn('[BrowserMCP] Error closing context during server shutdown:', err);
      });
    }
    contextMap.clear();
    currentContext = null;
  };

  return server;
}
