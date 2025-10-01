#!/usr/bin/env node
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { program } from "commander";

// Removed import of appConfig - will use local constant

import type { Resource } from "./resources/resource";
import { createServerWithTools } from "./server";
import { enableHotReload } from "./hot-reload";
// import * as common from "./tools/common";  // Using unified navigation instead
import { browser_navigate } from "./tools/navigation-unified";
import { pressKey, wait } from "./tools/common";
import * as custom from "./tools/custom";
import * as snapshot from "./tools/snapshot";
// import * as tabs from "./tools/tabs";  // Using unified tab tool instead
import { browser_tab } from "./tools/tabs-unified";
// import { debuggerTools } from "./tools/debugger";  // Using unified debugger tool instead
import { browser_debugger } from "./tools/debugger-unified";
import { executeJS } from "./tools/code-execution";
// import { commonOperations } from "./tools/code-execution";  // Commented out commonOperations
import { fileUploadTools } from "./tools/file-upload";
// Commented out orchestration tools for simplification
// import { browser_multitool_v3 } from "./tools/multitool-v3";
// import { browser_execute_plan } from "./tools/execute-plan";
import { browser_save_hint, browser_get_hints } from "./hints/index";
import type { Tool } from "./tools/tool";

// Consolidated enhanced tools
import {
  browserScroll,
  browserQuery,  // Universal HTML extraction tool (attrs, links, schema, inner/outer HTML)
  browserFillForm
} from "./tools/safe-mode-enhanced";

// Removed browserFetchHead and browserWaitForReady tools

import packageJSON from "../package.json";

function setupExitWatchdog(server: Server) {
  process.stdin.on("close", async () => {
    setTimeout(() => process.exit(0), 15000);
    await server.close();
    process.exit(0);
  });
}

const commonTools: Tool[] = [pressKey, wait];

const customTools: Tool[] = [custom.getConsoleLogs, custom.screenshot];

const tabTools: Tool[] = [
  browser_tab,  // Unified tab tool with actions: list, select, new, close
];

const scaffoldTools: Tool[] = [];

const codeExecutionTools: Tool[] = [
  executeJS,
  // commonOperations,  // Commented out common operation tool
];

const hintTools: Tool[] = [
  browser_save_hint,
  browser_get_hints,
];

const helperTools: Tool[] = [];

// Consolidated enhanced tools
const safeModeEnhancedTools: Tool[] = [
  browserScroll,
  browserQuery,  // Universal HTML/query tool (attrs, links, schema, HTML)
  browserFillForm,
];

// Removed batch operation and stability tools
const batchOperationTools: Tool[] = [];
const stabilityTools: Tool[] = [];

const snapshotTools: Tool[] = [
  // browser_multitool_v3,  // Commented out: recipe generator multitool
  // browser_execute_plan,  // Commented out: plan executor
  browser_navigate,  // Unified navigation: goto, back, forward, refresh
  snapshot.snapshot,
  snapshot.click,
  snapshot.hover,
  snapshot.type,
  snapshot.selectOption,
  ...commonTools,
  ...customTools,
  ...tabTools,
  browser_debugger,  // Unified debugger tool with actions: attach, detach, get_data
  ...scaffoldTools,
  ...codeExecutionTools,
  ...fileUploadTools,
  ...hintTools,
  ...helperTools,
  ...safeModeEnhancedTools,  // Add new safe-mode tools
  ...batchOperationTools,     // Add batch operation tools
  ...stabilityTools,          // Add stability tools
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

/**
 * Note: Tools must be defined *before* calling `createServer` because only declarations are hoisted, not the initializations
 */
program
  .version("Version " + packageJSON.version)
  .name(packageJSON.name)
  .action(async () => {
    const server = await createServer();
    setupExitWatchdog(server);

    // Enable hot reload in development mode
    if (process.env.NODE_ENV === 'development' || process.env.HOT_RELOAD === 'true') {
      console.error('[BrowserMCP] Hot reload enabled - edit any .ts file to trigger rebuild and respawn');
      const watchPath = process.env.HOT_RELOAD_WATCH_PATH || process.cwd() + '/src';
      console.error(`[BrowserMCP] Watching: ${watchPath}`);
      enableHotReload({
        verbose: true,
        debounceMs: 500,
        watchPath: watchPath
      });
    }

    const transport = new StdioServerTransport();
    await server.connect(transport);
  });
program.parse(process.argv);
