#!/usr/bin/env node
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { program } from "commander";

// Removed import of appConfig - will use local constant

import type { Resource } from "./resources/resource";
import { createServerWithTools } from "./server";
import * as common from "./tools/common";
import * as custom from "./tools/custom";
import * as snapshot from "./tools/snapshot";
import * as tabs from "./tools/tabs";
import { debuggerTools } from "./tools/debugger";
import { executeJS, commonOperations } from "./tools/code-execution";
import { fileUploadTools } from "./tools/file-upload";
// import { browserMultitool } from "./tools/multitool"; // Old version disabled
import { browser_multitool_v3 } from "./tools/multitool-v3";
import { browser_execute_plan } from "./tools/execute-plan";
import { browser_save_hint, browser_get_hints } from "./hints/index";
import type { Tool } from "./tools/tool";

import packageJSON from "../package.json";

function setupExitWatchdog(server: Server) {
  process.stdin.on("close", async () => {
    setTimeout(() => process.exit(0), 15000);
    await server.close();
    process.exit(0);
  });
}

const commonTools: Tool[] = [common.pressKey, common.wait];

const customTools: Tool[] = [custom.getConsoleLogs, custom.screenshot];

const tabTools: Tool[] = [
  tabs.browser_tab_list,
  tabs.browser_tab_select,
  tabs.browser_tab_new,
  tabs.browser_tab_close,
];

const scaffoldTools: Tool[] = [];

const codeExecutionTools: Tool[] = [
  executeJS,
  commonOperations,
];

const hintTools: Tool[] = [
  browser_save_hint,
  browser_get_hints,
];

const helperTools: Tool[] = [];

const snapshotTools: Tool[] = [
  browser_multitool_v3,  // New recipe generator multitool
  browser_execute_plan,  // Plan executor
  common.navigate(true),
  common.goBack(true),
  common.goForward(true),
  snapshot.snapshot,
  snapshot.click,
  snapshot.hover,
  snapshot.type,
  snapshot.selectOption,
  ...commonTools,
  ...customTools,
  ...tabTools,
  ...debuggerTools,
  ...scaffoldTools,
  ...codeExecutionTools,
  ...fileUploadTools,
  ...hintTools,
  ...helperTools,
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

    const transport = new StdioServerTransport();
    await server.connect(transport);
  });
program.parse(process.argv);
