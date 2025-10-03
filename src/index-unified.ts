#!/usr/bin/env node

/**
 * Unified MCP Server - Single Listener Architecture
 *
 * Industry-standard pattern:
 * - One TCP port (8765)
 * - One WebSocket connection per Claude instance
 * - Session ID in URI: ws://localhost:8765/session/<instanceId>
 *
 * Benefits:
 * - No port scanning
 * - Unlimited instances
 * - Simple firewall rules
 * - Per-instance isolation maintained
 * - Automatic lifecycle detection
 */

// Removed commander - not needed for stdio mode
import { UnifiedWSServer, createUnifiedWebSocketServer } from './ws-unified';
import { Context } from './context';
import { createServerWithTools } from './server';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import pkg from '../package.json';
import { enableHotReload } from './hot-reload';

// Import all tools
import { pressKey, wait } from './tools/common';
import * as custom from './tools/custom';
import * as snapshot from './tools/snapshot';
import { browser_tab } from './tools/tabs-unified';
import { executeJS } from './tools/code-execution';
import { browser_save_hint, browser_get_hints } from './hints/index';
import { browserScroll, browserQuery, browserFillForm } from './tools/safe-mode-enhanced';
import { browser_navigate } from './tools/navigation-unified';
import { browser_debugger } from './tools/debugger-unified';
import { fileUploadTools } from './tools/file-upload';
import type { Tool } from './tools/tool';

const { getConsoleLogs, screenshot } = custom;
const { snapshot: snapshotTool, click, hover, type, selectOption } = snapshot;

const commonTools = [pressKey, wait];
const customTools = [getConsoleLogs, screenshot];
const tabTools = [browser_tab];
const scaffoldTools: Tool[] = [];
const codeExecutionTools = [executeJS];
const hintTools = [browser_save_hint, browser_get_hints];
const helperTools: Tool[] = [];
const safeModeEnhancedTools = [browserScroll, browserQuery, browserFillForm];
const batchOperationTools: Tool[] = [];
const stabilityTools: Tool[] = [];

const snapshotTools = [
  browser_navigate,
  snapshotTool,
  click,
  hover,
  type,
  selectOption,
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

const resources: any[] = [];

// Build shared toolbox
const toolbox: Record<string, Tool> = {};
for (const tool of snapshotTools) {
  toolbox[tool.schema.name] = tool;
}

// Global WebSocket server
let wsServer: UnifiedWSServer | null = null;

// Track contexts by instance ID
const contextById = new Map<string, Context>();

/**
 * Get or create context for instance ID
 */
function getOrCreateContext(instanceId: string): Context {
  let ctx = contextById.get(instanceId);
  if (!ctx) {
    ctx = new Context();
    ctx.instanceId = instanceId;
    ctx.toolbox = toolbox;
    contextById.set(instanceId, ctx);
    console.error(`[UnifiedMCP] Created context for instance ${instanceId}`);
  }
  return ctx;
}

/**
 * Setup WebSocket server
 */
async function setupWebSocketServer(port: number): Promise<void> {
  wsServer = await createUnifiedWebSocketServer({
    port,
    onConnection: (instanceId, ws, context) => {
      console.error(`[UnifiedMCP] Instance ${instanceId} connected`);

      // Ensure context has toolbox
      context.toolbox = toolbox;

      // Update context map
      contextById.set(instanceId, context);
    },
    onDisconnection: (instanceId) => {
      console.error(`[UnifiedMCP] Instance ${instanceId} disconnected`);

      // Keep context alive (don't delete) in case of reconnection
      // Context will be cleaned up when no longer needed
    }
  });

  console.error(`[UnifiedMCP] WebSocket server ready on port ${port}`);
  console.error(`[UnifiedMCP] Extension should connect to: ws://localhost:${port}/session/<instanceId>`);
}

/**
 * Create MCP server
 */
async function createMCPServer() {
  // Get instance ID from environment variable (set by Claude Desktop)
  const instanceId = process.env.MCP_INSTANCE_ID || 'default';

  console.error(`[UnifiedMCP] Starting MCP server for instance: ${instanceId}`);

  // Get or create context for this instance
  const context = getOrCreateContext(instanceId);

  // Create MCP server
  const server = await createServerWithTools({
    name: 'browsermcp-enhanced-unified',
    version: pkg.version,
    tools: snapshotTools,
    resources,
    skipWebSocket: true, // We manage WebSocket ourselves
    context // Pass context to server
  });

  return { server, context, instanceId };
}

// Main entry point - run directly (no CLI parsing needed for stdio)
(async () => {
  const port = parseInt(process.env.BROWSER_MCP_WS_PORT || '8765', 10);

  // Enable hot reload if requested
  if (process.env.HOT_RELOAD === 'true') {
    console.error('[UnifiedMCP] Hot reload enabled');
    const watchPath = process.env.HOT_RELOAD_WATCH_PATH || '/home/david/Work/Programming/browsermcp-enhanced/src';
    console.error(`[UnifiedMCP] Watching: ${watchPath}`);
    enableHotReload({
      verbose: true,
      debounceMs: 500,
      watchPath: watchPath
    });
  }

  // Setup WebSocket server (single listener for all instances)
  await setupWebSocketServer(port);

  // Create MCP server (this instance's stdio transport)
  const { server, context, instanceId } = await createMCPServer();

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`[UnifiedMCP] MCP server connected via stdio`);
  console.error(`[UnifiedMCP] Instance ID: ${instanceId}`);
  console.error(`[UnifiedMCP] Browser extension should connect to: ws://localhost:${port}/session/${instanceId}`);
  console.error(`[UnifiedMCP] Version: ${pkg.version}`);
  console.error(`[UnifiedMCP] Ready!`);

  // Graceful shutdown
  const shutdown = async () => {
    console.error('[UnifiedMCP] Shutting down...');

    if (wsServer) {
      await wsServer.close();
    }

    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Periodic stats (debug)
  setInterval(() => {
    if (wsServer) {
      const count = wsServer.getInstanceCount();
      const instances = wsServer.getActiveInstances();
      console.error(`[UnifiedMCP] Active instances: ${count} - ${instances.join(', ')}`);
    }
  }, 60000); // Every minute
})();
