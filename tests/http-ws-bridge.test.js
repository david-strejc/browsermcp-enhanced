#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { setTimeout as wait } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const red = (text) => `\x1b[31m${text}\x1b[0m`;
const green = (text) => `\x1b[32m${text}\x1b[0m`;
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
      // ignore and retry
    }
    await wait(150);
  }
  throw new Error(`Server on port ${port} did not become ready within ${timeoutMs}ms`);
}

async function createSession(port) {
  const url = `http://127.0.0.1:${port}/mcp`;
  const transport = new StreamableHTTPClientTransport(url);
  const client = new Client({ name: 'ws-bridge-test', version: '0.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return { client, transport };
}

async function run() {
  const port = 3600 + Math.floor(Math.random() * 200);
  const serverPath = join(__dirname, '..', 'dist', 'index-http.js');

  const server = spawn('node', [serverPath, '--port', String(port)], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      BROWSER_MCP_ENABLE_DEBUG: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const serverLogs = [];
  server.stderr.on('data', (chunk) => serverLogs.push(chunk.toString()));

  try {
    await waitForServer(port);

    const { client, transport } = await createSession(port);
    assert.ok(transport.sessionId, 'session ID should be negotiated');

    const response = await fetch(`http://127.0.0.1:${port}/ws-message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Instance-ID': transport.sessionId,
        'X-Tab-ID': 'test-tab'
      },
      body: JSON.stringify({
        messageId: 'msg-1',
        type: 'mock_request',
        payload: { ping: true }
      })
    });

    // Expected future behaviour: request accepted for processing
    assert.equal(response.status, 202, 'bridge should accept daemon message');
    const body = await response.json();
    assert.equal(body.status, 'accepted');
    assert.equal(body.messageId, 'msg-1');

    const debugRes = await fetch(`http://127.0.0.1:${port}/debug/session/${transport.sessionId}`);
    assert.equal(debugRes.status, 200, 'debug endpoint should return 200');
    const debugData = await debugRes.json();
    assert.equal(debugData.currentTabId, 'test-tab');
    assert.equal(debugData.daemonQueueLength, 0);

    await client.close();
    try {
      await transport.terminateSession?.();
    } catch (error) {
      if (error?.name !== 'AbortError') throw error;
    }

    console.log(green('HTTP bridge test passed.'));
  } catch (error) {
    console.error(red(`HTTP bridge test failed: ${error.stack || error}`));
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
