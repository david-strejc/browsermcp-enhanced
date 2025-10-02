#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { setTimeout as wait } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const green = (text) => `\x1b[32m${text}\x1b[0m`;
const red = (text) => `\x1b[31m${text}\x1b[0m`;
const cyan = (text) => `\x1b[36m${text}\x1b[0m`;

async function waitForServer(port, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'GET',
        headers: { Accept: 'text/event-stream' }
      });
      const readyStatuses = new Set([200, 202, 400, 404, 405]);
      if (readyStatuses.has(res.status)) {
        res.body?.cancel();
        return;
      }
    } catch (err) {
      // ignore until timeout
    }
    await wait(150);
  }
  throw new Error(`Server on port ${port} did not become ready within ${timeoutMs}ms`);
}

async function createClient(port) {
  const url = `http://127.0.0.1:${port}/mcp`;
  const transport = new StreamableHTTPClientTransport(url);
  const client = new Client({
    name: 'session-test-client',
    version: '0.0.0'
  }, {
    capabilities: {}
  });

  await client.connect(transport);
  return { client, transport };
}

async function run() {
  const port = 3400 + Math.floor(Math.random() * 200);
  const serverPath = join(__dirname, '..', 'dist', 'index-http.js');

  const server = spawn('node', [serverPath, '--port', String(port)], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DEBUG: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  server.on('error', (err) => {
    console.error(red(`[Server] spawn error: ${err.message}`));
  });

  const serverLogs = [];
  server.stderr.on('data', (chunk) => {
    serverLogs.push(chunk.toString());
  });

  try {
    await waitForServer(port);

    console.log(cyan('Connecting first client...'));
    const { client: clientA, transport: transportA } = await createClient(port);
    assert.ok(transportA.sessionId, 'First transport should expose a session ID');
    const firstSessionId = transportA.sessionId;

    console.log(cyan('Connecting second client...'));
    const { client: clientB, transport: transportB } = await createClient(port);
    assert.ok(transportB.sessionId, 'Second transport should expose a session ID');
    const secondSessionId = transportB.sessionId;

    assert.notStrictEqual(firstSessionId, secondSessionId, 'Each transport should negotiate a unique session ID');

    // Ensure basic request works without browser attached (listTools)
    const toolsResponse = await clientA.listTools();
    assert.ok(Array.isArray(toolsResponse.tools), 'listTools should return a tools array');

    await clientA.close();
    await clientB.close();
    try {
      await transportA.terminateSession?.();
    } catch (error) {
      if (error?.name !== 'AbortError') throw error;
    }
    try {
      await transportB.terminateSession?.();
    } catch (error) {
      if (error?.name !== 'AbortError') throw error;
    }

    console.log(green('Session ID HTTP test passed.'));
  } catch (error) {
    console.error(red(`Test failed: ${error.stack || error}`));
    if (serverLogs.length) {
      console.error(red('Server logs:'));
      console.error(serverLogs.join(''));
    }
    process.exitCode = 1;
  } finally {
    server.kill();
  }
}

run();
