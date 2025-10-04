#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';
import process from 'node:process';
import { WebSocket } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const green = (text) => `\x1b[32m${text}\x1b[0m`;
const red = (text) => `\x1b[31m${text}\x1b[0m`;
const cyan = (text) => `\x1b[36m${text}\x1b[0m`;

async function waitForHealth(url, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.ok) {
        return true;
      }
    } catch (err) {
      // ignore and retry
    }
    await wait(150);
  }
  throw new Error(`Daemon at ${url} did not become ready in ${timeoutMs}ms`);
}

async function connectStub(url) {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(url);

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
        if (msg.type === 'connected' || msg.type === 'helloAck') {
          ws.off('message', handleMessage);
          ws.off('error', handleError);
          resolve(ws);
        }
      } catch (err) {
        // ignore parse errors during handshake
      }
    };

    ws.once('error', handleError);
    ws.once('open', handleOpen);
    ws.on('message', handleMessage);
  });
}

async function run() {
  const daemonPort = 4600 + Math.floor(Math.random() * 100);
  const daemonPath = join(__dirname, '..', 'dist', 'daemon', 'websocket-daemon.js');

  const daemon = spawn('node', [daemonPath], {
    env: {
      ...process.env,
      BROWSER_MCP_DAEMON_PORT: String(daemonPort),
      BROWSER_MCP_HTTP_URL: 'http://127.0.0.1:1' // unused in this test
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const daemonLogs = [];
  daemon.stderr.on('data', (chunk) => daemonLogs.push(chunk.toString()));
  daemon.stdout.on('data', (chunk) => daemonLogs.push(chunk.toString()));

  const cleanup = () => daemon.kill();

  try {
    await waitForHealth(`http://127.0.0.1:${daemonPort}/health`);

    const sessionId = 'test-session';
    const extensionSocket = await connectStub(`ws://127.0.0.1:${daemonPort}/session/${sessionId}`);

    const commandPromise = new Promise((resolve) => {
      extensionSocket.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'ping') {
          extensionSocket.send(JSON.stringify({ type: 'pong', id: msg.id }));
          return;
        }
        if (msg.id) {
          extensionSocket.send(JSON.stringify({
            type: 'response',
            id: msg.id,
            data: { ok: true, echo: msg.payload }
          }));
        }
      });
      resolve(null);
    });

    await commandPromise;

    const response = await fetch(`http://127.0.0.1:${daemonPort}/commands`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Instance-ID': sessionId
      },
      body: JSON.stringify({
        id: 1,
        type: 'test.command',
        payload: { value: 42 }
      })
    });

    assert.equal(response.status, 200, 'daemon should return 200 for connected session');
    const data = await response.json();
    assert.equal(data.success, true, 'daemon should mark command as success');
    assert.deepEqual(data.payload, { ok: true, echo: { value: 42 } }, 'daemon should echo payload');

    extensionSocket.close();
    console.log(green('Unified daemon command test passed.'));
  } catch (err) {
    console.error(red(`Unified daemon command test failed: ${err.stack || err}`));
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
