#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';
import process from 'node:process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { WebSocket } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const green = (text) => `\x1b[32m${text}\x1b[0m`;
const red = (text) => `\x1b[31m${text}\x1b[0m`;
const cyan = (text) => `\x1b[36m${text}\x1b[0m`;

async function waitFor(url, { timeout = 10000, method = 'GET', headers } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(url, { method, headers });
      if (res.ok || res.status === 404 || res.status === 405) {
        return res;
      }
    } catch (err) {
      // ignore
    }
    await wait(150);
  }
  throw new Error(`Timeout waiting for ${url}`);
}

async function connectExtension(sessionId, daemonPort) {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${daemonPort}/session/${sessionId}`);

    const handleError = (err) => {
      ws.off('open', handleOpen);
      ws.off('message', handleMessage);
      reject(err);
    };

    const handleOpen = () => {
      ws.send(JSON.stringify({ type: 'hello', wants: 'instanceId' }));
    };

    const handleMessage = (event) => {
      try {
        const msg = JSON.parse(event.toString());
        if (msg.type === 'helloAck' || msg.type === 'connected') {
          ws.off('message', handleMessage);
          ws.off('error', handleError);
          resolve(ws);
        }
      } catch (err) {
        // ignore
      }
    };

    ws.once('error', handleError);
    ws.once('open', handleOpen);
    ws.on('message', handleMessage);
  });
}

async function run() {
  const httpPort = 4300 + Math.floor(Math.random() * 50);
  const daemonPort = 5300 + Math.floor(Math.random() * 50);

  const serverPath = join(__dirname, '..', 'dist', 'index-http.js');
  const daemonPath = join(__dirname, '..', 'dist', 'daemon', 'websocket-daemon.js');

  const daemon = spawn('node', [daemonPath], {
    env: {
      ...process.env,
      BROWSER_MCP_DAEMON_PORT: String(daemonPort),
      BROWSER_MCP_HTTP_URL: `http://127.0.0.1:${httpPort}`
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const daemonLogs = [];
  daemon.stderr.on('data', (chunk) => daemonLogs.push(chunk.toString()));
  daemon.stdout.on('data', (chunk) => daemonLogs.push(chunk.toString()));

  const server = spawn('node', [serverPath, '--port', String(httpPort)], {
    env: {
      ...process.env,
      BROWSER_MCP_DAEMON_URL: `http://127.0.0.1:${daemonPort}`,
      BROWSER_MCP_ENABLE_DEBUG: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const serverLogs = [];
  server.stderr.on('data', (chunk) => serverLogs.push(chunk.toString()));
  server.stdout.on('data', (chunk) => serverLogs.push(chunk.toString()));

  const cleanup = () => {
    daemon.kill();
    server.kill();
  };

  try {
    await waitFor(`http://127.0.0.1:${httpPort}/`);
    await waitFor(`http://127.0.0.1:${daemonPort}/health`);

    const transport = new StreamableHTTPClientTransport(`http://127.0.0.1:${httpPort}/mcp`);
    const client = new Client({ name: 'daemon-e2e', version: '0.0.0' }, { capabilities: {} });
    await client.connect(transport);
    assert.ok(transport.sessionId, 'session ID should exist');

    const extensionSocket = await connectExtension(transport.sessionId, daemonPort);

    extensionSocket.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'js.execute') {
        extensionSocket.send(JSON.stringify({
          type: 'response',
          id: msg.id,
          data: { result: 'daemon-stub:' + (msg.payload?.code || '') }
        }));
      }
    });

    const result = await client.callTool({
      name: 'browser_execute_js',
      arguments: { code: 'return "pong";', timeout: 500 }
    });

    assert.ok(Array.isArray(result.content), 'tool call should return content');
    const text = result.content[0]?.text || '';
    assert.ok(text.includes('daemon-stub:'), 'response should include stub value');

    // Also exercise navigation via daemon stub
    extensionSocket.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'browser_navigate') {
        extensionSocket.send(JSON.stringify({ type: 'response', id: msg.id, data: { url: msg.payload?.url, tabId: 123 } }));
      }
    });

    const nav = await client.callTool({ name: 'browser_navigate', arguments: { url: 'https://example.com', snapshot: false } });
    const navText = nav.content?.[0]?.text || '';
    assert.ok(navText.includes('Navigated') || navText.length > 0, 'navigation tool should return output');

    const debugRes = await fetch(`http://127.0.0.1:${httpPort}/debug/session/${transport.sessionId}`);
    assert.equal(debugRes.status, 200);
    const debugData = await debugRes.json();
    assert.equal(debugData.daemonQueueLength, 0);

    extensionSocket.close();
    await client.close();

    console.log(green('Unified daemon end-to-end test passed.'));
  } catch (err) {
    console.error(red(`Unified daemon end-to-end test failed: ${err.stack || err}`));
    if (serverLogs.length) {
      console.error(red('Server logs:'));
      console.error(serverLogs.join(''));
    }
    if (daemonLogs.length) {
      console.error(red('Daemon logs:'));
      console.error(daemonLogs.join(''));
    }
    cleanup();
    process.exit(1);
  }

  cleanup();
}

run();
