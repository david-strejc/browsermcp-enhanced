import { WebSocketServer } from "ws";

import { mcpConfig } from "./config/mcp.config";
import { wait } from "./utils/wait";

import { isPortInUse, killProcessOnPort } from "./utils/port";

export async function createWebSocketServer(
  port: number = mcpConfig.defaultWsPort,
): Promise<WebSocketServer> {
  killProcessOnPort(port);
  // Wait until the port is free
  while (await isPortInUse(port)) {
    await wait(100);
  }
  return new WebSocketServer({ port });
}
