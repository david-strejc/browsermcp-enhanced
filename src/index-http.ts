#!/usr/bin/env node
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer as createHttpServer } from "node:http";
import { program } from "commander";
import { randomUUID } from "node:crypto";

import type { Resource } from "./resources/resource";
import { createServerWithTools } from "./server";
import { enableHotReload } from "./hot-reload";
import { browser_navigate } from "./tools/navigation-unified";
import { pressKey, wait } from "./tools/common";
import * as custom from "./tools/custom";
import * as snapshot from "./tools/snapshot";
import { browser_tab } from "./tools/tabs-unified";
import { browser_debugger } from "./tools/debugger-unified";
import { executeJS } from "./tools/code-execution";
import { fileUploadTools } from "./tools/file-upload";
import { browser_save_hint, browser_get_hints } from "./hints/index";
import type { Tool } from "./tools/tool";

import {
  browserScroll,
  browserQuery,
  browserFillForm
} from "./tools/safe-mode-enhanced";

import packageJSON from "../package.json";

const commonTools: Tool[] = [pressKey, wait];
const customTools: Tool[] = [custom.getConsoleLogs, custom.screenshot];
const tabTools: Tool[] = [browser_tab];
const scaffoldTools: Tool[] = [];
const codeExecutionTools: Tool[] = [executeJS];
const hintTools: Tool[] = [browser_save_hint, browser_get_hints];
const helperTools: Tool[] = [];
const safeModeEnhancedTools: Tool[] = [browserScroll, browserQuery, browserFillForm];
const batchOperationTools: Tool[] = [];
const stabilityTools: Tool[] = [];

const snapshotTools: Tool[] = [
  browser_navigate,
  snapshot.snapshot,
  snapshot.click,
  snapshot.hover,
  snapshot.type,
  snapshot.selectOption,
  ...commonTools,
  ...customTools,
  ...tabTools,
  browser_debugger,
  ...scaffoldTools,
  ...codeExecutionTools,
  ...fileUploadTools,
  ...hintTools,
  ...helperTools,
  ...safeModeEnhancedTools,
  ...batchOperationTools,
  ...stabilityTools,
];

const resources: Resource[] = [];

async function createServer(): Promise<Server> {
  return createServerWithTools({
    name: "browsermcp-enhanced",
    version: packageJSON.version,
    tools: snapshotTools,
    resources,
  });
}

program
  .version("Version " + packageJSON.version)
  .name(packageJSON.name + "-http")
  .option("-p, --port <number>", "HTTP port to listen on", "3000")
  .action(async (options) => {
    const mcpServer = await createServer();
    const port = parseInt(options.port, 10);

    // Enable hot reload in development mode
    if (process.env.NODE_ENV === 'development' || process.env.HOT_RELOAD === 'true') {
      console.error('[BrowserMCP HTTP] Hot reload enabled - edit any .ts file to trigger rebuild and respawn');
      const watchPath = process.env.HOT_RELOAD_WATCH_PATH || '/home/david/Work/Programming/browsermcp-enhanced/src';
      console.error(`[BrowserMCP HTTP] Watching: ${watchPath}`);
      enableHotReload({
        verbose: true,
        debounceMs: 500,
        watchPath: watchPath
      });
    }

    // Create a single transport for the server (STATELESS mode for hot-reload compatibility)
    // Stateless mode: no session validation, survives server restarts
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,  // Stateless mode - no session IDs
    });

    // Connect transport to MCP server once
    await mcpServer.connect(transport);

    // Create HTTP server that uses the single transport
    const httpServer = createHttpServer(async (req, res) => {
      // Handle all HTTP requests through the single transport
      await transport.handleRequest(req, res);
    });

    httpServer.listen(port, () => {
      console.error(`[BrowserMCP HTTP] Server listening on http://localhost:${port}/mcp`);
      console.error(`[BrowserMCP HTTP] Version: ${packageJSON.version}`);
      console.error(`[BrowserMCP HTTP] Ready for Claude Desktop connections`);
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.error('[BrowserMCP HTTP] Shutting down...');
      httpServer.close();
      await mcpServer.close();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.error('[BrowserMCP HTTP] Shutting down...');
      httpServer.close();
      await mcpServer.close();
      process.exit(0);
    });
  });

program.parse(process.argv);