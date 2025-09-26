import { WebSocketServer } from "ws";

import { mcpConfig } from "./config/mcp.config";
import { wait } from "./utils/wait";
import { PortRegistryManager } from "./utils/port-registry";

import { isPortInUse, killProcessOnPort } from "./utils/port";

let portRegistry: PortRegistryManager | null = null;

export async function createWebSocketServer(
  requestedPort?: number,
): Promise<{ server: WebSocketServer; port: number; instanceId: string }> {
  // Try to use requested port first (for backwards compatibility)
  if (requestedPort) {
    if (!(await isPortInUse(requestedPort))) {
      const server = new WebSocketServer({ port: requestedPort });
      return {
        server,
        port: requestedPort,
        instanceId: process.env.MCP_INSTANCE_ID || 'legacy'
      };
    }
  }

  // Use port registry for dynamic allocation
  portRegistry = new PortRegistryManager();
  const { port, instanceId } = await portRegistry.allocatePort();

  const server = new WebSocketServer({ port });

  console.log(`[WebSocket] Server started on port ${port} with instance ID ${instanceId}`);

  return { server, port, instanceId };
}

export function getPortRegistry(): PortRegistryManager | null {
  return portRegistry;
}
