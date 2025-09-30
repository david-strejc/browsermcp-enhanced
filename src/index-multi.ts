#!/usr/bin/env node

/**
 * Multi-Instance MCP Server
 * Creates WebSocket servers on ports 8765-8775 for each Claude Desktop instance
 */

import { program } from 'commander';
import { WebSocketServer } from 'ws';
import { PortRegistryManager } from './utils/port-registry';
import { Context } from './context';
import { createServerWithTools } from './server';
import pkg from '../package.json';

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

const { getConsoleLogs, screenshot } = custom;
const { snapshot: snapshotTool, click, hover, type, selectOption } = snapshot;

const commonTools = [pressKey, wait];
const customTools = [getConsoleLogs, screenshot];
const tabTools = [browser_tab];
const scaffoldTools: any[] = [];
const codeExecutionTools = [executeJS];
const hintTools = [browser_save_hint, browser_get_hints];
const helperTools: any[] = [];
const safeModeEnhancedTools = [browserScroll, browserQuery, browserFillForm];
const batchOperationTools: any[] = [];
const stabilityTools: any[] = [];

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

// Build toolbox
const toolbox: Record<string, any> = {};
for (const tool of snapshotTools) {
  toolbox[tool.schema.name] = tool;
}

interface InstanceRecord {
  instanceId: string;
  port: number;
  wss: WebSocketServer;
  context: Context;
}

const instances: Map<string, InstanceRecord> = new Map();

async function createMultiInstanceServer() {
  return createServerWithTools({
    name: 'browsermcp-enhanced-multi',
    version: pkg.version,
    tools: snapshotTools,
    resources,
    skipWebSocket: true, // We manage WebSocket ourselves
  });
}

async function startWebSocketServer(port: number, instanceId: string): Promise<WebSocketServer> {
  const wss = new WebSocketServer({ port });

  console.error(`[Multi] WebSocket server listening on port ${port} for instance ${instanceId}`);

  wss.on('connection', (ws) => {
    const inst = instances.get(instanceId);
    if (!inst) {
      console.error(`[Multi] Connection received but instance ${instanceId} not found`);
      ws.close();
      return;
    }

    inst.context.ws = ws;
    console.error(`[Multi] Browser connected for instance ${instanceId} on port ${port}`);

    // Setup heartbeat monitoring
    let isAlive = true;
    let lastPongTime = Date.now();

    const pingInterval = setInterval(() => {
      if (ws.readyState !== 1) {
        clearInterval(pingInterval);
        return;
      }

      // Check if last pong was more than 90s ago
      const timeSinceLastPong = Date.now() - lastPongTime;
      if (timeSinceLastPong > 90000) {
        console.error(`[Multi] WebSocket stale for ${instanceId} (${Math.round(timeSinceLastPong / 1000)}s), terminating`);
        clearInterval(pingInterval);
        ws.terminate();
        return;
      }

      if (!isAlive) {
        console.error(`[Multi] WebSocket not responding for ${instanceId}, terminating`);
        clearInterval(pingInterval);
        ws.terminate();
        return;
      }

      isAlive = false;
      ws.ping();
    }, 30000); // 30 second ping interval

    ws.on('pong', () => {
      isAlive = true;
      lastPongTime = Date.now();
    });

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'hello' && msg.wants === 'instanceId') {
          // Extension wants to know our instance ID
          ws.send(JSON.stringify({
            type: 'helloAck',
            instanceId: inst.instanceId,
            port: inst.port,
          }));
        } else if (msg.type === 'ping') {
          // Extension ping
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (err) {
        console.error(`[Multi] WebSocket message error for ${instanceId}:`, err);
      }
    });

    ws.on('close', () => {
      console.error(`[Multi] WebSocket closed for instance ${instanceId}`);
      clearInterval(pingInterval);
      inst.context.ws = undefined;
    });

    ws.on('error', (err) => {
      console.error(`[Multi] WebSocket error for ${instanceId}:`, err);
      clearInterval(pingInterval);
    });
  });

  return wss;
}

async function createInstance(): Promise<InstanceRecord> {
  const portRegistry = new PortRegistryManager();
  const { port, instanceId } = await portRegistry.allocatePort();

  const context = new Context();
  context.toolbox = toolbox;
  context.instanceId = instanceId;
  context.port = port;

  const wss = await startWebSocketServer(port, instanceId);

  const inst: InstanceRecord = {
    instanceId,
    port,
    wss,
    context,
  };

  instances.set(instanceId, inst);

  console.error(`[Multi] Created instance ${instanceId} on port ${port}`);
  console.error(`[Multi] Total instances: ${instances.size}`);

  return inst;
}

async function cleanupInstance(instanceId: string) {
  const inst = instances.get(instanceId);
  if (!inst) return;

  try {
    inst.wss.clients.forEach((client) => client.close());
    inst.wss.close();
  } catch (err) {
    console.error(`[Multi] Error closing WebSocket server for ${instanceId}:`, err);
  }

  if (inst.context.tabs && inst.context.tabs.size > 0) {
    console.error(`[Multi] Closing ${inst.context.tabs.size} tabs for instance ${instanceId}`);
  }

  instances.delete(instanceId);
  console.error(`[Multi] Cleaned up instance ${instanceId}`);
  console.error(`[Multi] Active instances: ${instances.size}`);
}

program
  .version('Version ' + pkg.version)
  .name(pkg.name + '-multi')
  .option('-i, --instances <number>', 'Number of instances to pre-create', '9')
  .action(async (options) => {
    const mcpServer = await createMultiInstanceServer();
    const numInstances = parseInt(options.instances, 10);

    console.error(`[Multi] Starting multi-instance server v${pkg.version}`);
    console.error(`[Multi] Pre-creating ${numInstances} instances...`);

    // Pre-create instances
    for (let i = 0; i < numInstances; i++) {
      try {
        await createInstance();
      } catch (err) {
        console.error(`[Multi] Failed to create instance ${i + 1}:`, err);
      }
    }

    console.error(`[Multi] ${instances.size} instances ready`);
    console.error(`[Multi] Extension can now connect to ports 8765-8775`);

    // Cleanup on exit
    process.on('SIGINT', async () => {
      console.error('[Multi] Shutting down...');
      for (const [id] of instances) {
        await cleanupInstance(id);
      }
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.error('[Multi] Shutting down...');
      for (const [id] of instances) {
        await cleanupInstance(id);
      }
      process.exit(0);
    });

    // Keep alive
    setInterval(() => {
      console.error(`[Multi] Heartbeat - ${instances.size} instances active`);
    }, 60000);
  });

program.parse();
