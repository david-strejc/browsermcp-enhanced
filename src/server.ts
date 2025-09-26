import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

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
  const context = new Context();

  // Build toolbox for inter-tool invocation
  const toolbox: Record<string, Tool> = {};
  for (const tool of tools) {
    toolbox[tool.schema.name] = tool;
  }
  context.toolbox = toolbox;

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
  context.instanceId = instanceId;
  context.port = port;

  wss.on("connection", (websocket) => {
    // Multi-instance support: each connection gets its own context
    // Don't close existing connections - allow multiple Claude instances
    context.ws = websocket;

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

    try {
      const raw = await tool.handle(context, request.params.arguments) as any;

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

    const contents = await resource.read(context, request.params.uri);
    return { contents };
  });

  const originalClose = server.close.bind(server);
  server.close = async () => {
    await originalClose();
    await wss.close();
    await context.close();
  };

  return server;
}
