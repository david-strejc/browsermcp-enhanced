#!/usr/bin/env node

/**
 * End-to-End JavaScript Execution Tests
 * Tests the complete flow from MCP server -> Chrome Extension -> Page execution
 */

import { WebSocket } from 'ws';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TEST_TIMEOUT = 500; // 500ms timeout for fast machine
const WS_PORT = 8765;

// Test results
let passed = 0;
let failed = 0;
const results = [];

// Color output
const red = (text) => `\x1b[31m${text}\x1b[0m`;
const green = (text) => `\x1b[32m${text}\x1b[0m`;
const yellow = (text) => `\x1b[33m${text}\x1b[0m`;
const blue = (text) => `\x1b[34m${text}\x1b[0m`;

// Helper to wait
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Connect to WebSocket server
async function connectToServer() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${WS_PORT}`);
    
    ws.on('open', () => {
      console.log(green('✓ Connected to WebSocket server'));
      resolve(ws);
    });
    
    ws.on('error', (err) => {
      reject(new Error(`WebSocket connection failed: ${err.message}`));
    });
  });
}

// Send message and wait for response
async function sendMessage(ws, type, payload, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).substr(2, 9);
    const message = JSON.stringify({ id, type, payload });
    
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout waiting for response to ${type} after ${timeoutMs}ms`));
    }, timeoutMs);
    
    const handler = (data) => {
      try {
        const response = JSON.parse(data.toString());
        if (response.id === id) {
          clearTimeout(timeout);
          ws.removeListener('message', handler);
          
          if (response.error) {
            reject(new Error(response.error));
          } else {
            resolve(response.payload || response);
          }
        }
      } catch (e) {
        // Ignore parsing errors
      }
    };
    
    ws.on('message', handler);
    ws.send(message);
  });
}

// Test runner
async function runTest(ws, name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  const startTime = Date.now();
  
  try {
    await testFn();
    const duration = Date.now() - startTime;
    console.log(green(`✓ (${duration}ms)`));
    passed++;
    results.push({ name, status: 'passed', duration });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.log(red(`✗ (${duration}ms)`));
    console.log(red(`  Error: ${error.message}`));
    failed++;
    results.push({ name, status: 'failed', error: error.message, duration });
  }
}

// Test cases
async function runTests() {
  console.log(blue('\n═══════════════════════════════════════════'));
  console.log(blue(' JavaScript Execution E2E Tests'));
  console.log(blue('═══════════════════════════════════════════\n'));
  
  let ws;
  
  try {
    // Connect to WebSocket
    ws = await connectToServer();
    
    // Wait for extension to be ready
    await wait(500);
    
    // Navigate to a test page
    console.log(yellow('\n→ Setting up test environment...\n'));
    await sendMessage(ws, 'browser_navigate', { url: 'https://example.com' });
    await wait(1000); // Wait for page load
    
    console.log(yellow('\n→ Running Safe Mode API Tests...\n'));
    
    // Test 1: Simple return value
    await runTest(ws, 'Simple return value', async () => {
      const result = await sendMessage(ws, 'js.execute', {
        code: 'return 2 + 2;',
        timeout: TEST_TIMEOUT
      });
      if (result.result !== 4) {
        throw new Error(`Expected 4, got ${result.result}`);
      }
    });
    
    // Test 2: DOM query with safe API
    await runTest(ws, 'Safe API - getText', async () => {
      const result = await sendMessage(ws, 'js.execute', {
        code: `return api.getText('h1');`,
        timeout: TEST_TIMEOUT
      });
      if (!result.result || typeof result.result !== 'string') {
        throw new Error(`Expected string, got ${typeof result.result}: ${result.result}`);
      }
    });
    
    // Test 3: Safe API - element existence
    await runTest(ws, 'Safe API - exists', async () => {
      const result = await sendMessage(ws, 'js.execute', {
        code: `return api.exists('body');`,
        timeout: TEST_TIMEOUT
      });
      if (result.result !== true) {
        throw new Error(`Expected true, got ${result.result}`);
      }
    });
    
    // Test 4: Safe API - count elements
    await runTest(ws, 'Safe API - count', async () => {
      const result = await sendMessage(ws, 'js.execute', {
        code: `return api.count('div');`,
        timeout: TEST_TIMEOUT
      });
      if (typeof result.result !== 'number' || result.result < 0) {
        throw new Error(`Expected positive number, got ${result.result}`);
      }
    });
    
    // Test 5: Safe API - getPageInfo
    await runTest(ws, 'Safe API - getPageInfo', async () => {
      const result = await sendMessage(ws, 'js.execute', {
        code: `return api.getPageInfo();`,
        timeout: TEST_TIMEOUT
      });
      if (!result.result || !result.result.url || !result.result.title) {
        throw new Error(`Invalid page info: ${JSON.stringify(result.result)}`);
      }
    });
    
    // Test 6: Async operation with wait
    await runTest(ws, 'Safe API - async wait', async () => {
      const startTime = Date.now();
      const result = await sendMessage(ws, 'js.execute', {
        code: `
          await api.wait(100);
          return 'completed';
        `,
        timeout: TEST_TIMEOUT
      });
      const duration = Date.now() - startTime;
      if (result.result !== 'completed') {
        throw new Error(`Expected 'completed', got ${result.result}`);
      }
      if (duration < 100) {
        throw new Error(`Wait didn't work properly, took only ${duration}ms`);
      }
    });
    
    console.log(yellow('\n→ Running Timeout Tests...\n'));
    
    // Test 7: Quick timeout (should fail)
    await runTest(ws, 'Timeout handling - should timeout', async () => {
      try {
        await sendMessage(ws, 'js.execute', {
          code: `
            await api.wait(1000);
            return 'should not reach';
          `,
          timeout: 100  // 100ms timeout
        });
        throw new Error('Should have timed out');
      } catch (error) {
        if (!error.message.includes('timeout') && !error.message.includes('Timeout')) {
          throw new Error(`Wrong error: ${error.message}`);
        }
        // Expected timeout error
      }
    });
    
    // Test 8: Just under timeout (should succeed)
    await runTest(ws, 'Timeout handling - just in time', async () => {
      const result = await sendMessage(ws, 'js.execute', {
        code: `
          await api.wait(50);
          return 'made it';
        `,
        timeout: 200  // 200ms timeout
      });
      if (result.result !== 'made it') {
        throw new Error(`Expected 'made it', got ${result.result}`);
      }
    });
    
    console.log(yellow('\n→ Running Error Handling Tests...\n'));
    
    // Test 9: Syntax error
    await runTest(ws, 'Syntax error handling', async () => {
      try {
        await sendMessage(ws, 'js.execute', {
          code: `return this is not valid javascript;`,
          timeout: TEST_TIMEOUT
        });
        throw new Error('Should have thrown syntax error');
      } catch (error) {
        if (!error.message.includes('SyntaxError') && !error.message.includes('Unexpected')) {
          throw new Error(`Wrong error type: ${error.message}`);
        }
      }
    });
    
    // Test 10: Runtime error
    await runTest(ws, 'Runtime error handling', async () => {
      try {
        await sendMessage(ws, 'js.execute', {
          code: `return api.nonExistentFunction();`,
          timeout: TEST_TIMEOUT
        });
        throw new Error('Should have thrown runtime error');
      } catch (error) {
        if (!error.message.includes('not a function') && !error.message.includes('undefined')) {
          throw new Error(`Wrong error type: ${error.message}`);
        }
      }
    });
    
    console.log(yellow('\n→ Running Unsafe Mode Tests...\n'));
    
    // Test 11: Unsafe mode - window access
    await runTest(ws, 'Unsafe mode - window access', async () => {
      const result = await sendMessage(ws, 'js.execute', {
        code: `return typeof window;`,
        timeout: TEST_TIMEOUT,
        unsafe: true
      });
      if (result.result !== 'object') {
        throw new Error(`Expected 'object', got ${result.result}`);
      }
    });
    
    // Test 12: Unsafe mode - document access
    await runTest(ws, 'Unsafe mode - document.title', async () => {
      const result = await sendMessage(ws, 'js.execute', {
        code: `return document.title;`,
        timeout: TEST_TIMEOUT,
        unsafe: true
      });
      if (typeof result.result !== 'string') {
        throw new Error(`Expected string title, got ${typeof result.result}: ${result.result}`);
      }
    });
    
    console.log(yellow('\n→ Running Complex Operations...\n'));
    
    // Test 13: Multiple API calls
    await runTest(ws, 'Multiple API calls in sequence', async () => {
      const result = await sendMessage(ws, 'js.execute', {
        code: `
          const count = api.count('div');
          const exists = api.exists('body');
          const info = api.getPageInfo();
          return { count, exists, url: info.url };
        `,
        timeout: TEST_TIMEOUT
      });
      if (!result.result || typeof result.result.count !== 'number' || 
          result.result.exists !== true || !result.result.url) {
        throw new Error(`Invalid result: ${JSON.stringify(result.result)}`);
      }
    });
    
    // Test 14: JSON serialization
    await runTest(ws, 'Complex object serialization', async () => {
      const result = await sendMessage(ws, 'js.execute', {
        code: `
          return {
            string: 'test',
            number: 42,
            boolean: true,
            null: null,
            array: [1, 2, 3],
            nested: { foo: 'bar' }
          };
        `,
        timeout: TEST_TIMEOUT
      });
      if (!result.result || result.result.string !== 'test' || 
          result.result.number !== 42 || result.result.array.length !== 3) {
        throw new Error(`Serialization failed: ${JSON.stringify(result.result)}`);
      }
    });
    
  } catch (error) {
    console.error(red(`\n✗ Test setup failed: ${error.message}`));
    failed++;
  } finally {
    if (ws) {
      ws.close();
    }
  }
  
  // Print summary
  console.log(blue('\n═══════════════════════════════════════════'));
  console.log(blue(' Test Summary'));
  console.log(blue('═══════════════════════════════════════════\n'));
  
  console.log(`Total tests: ${passed + failed}`);
  console.log(green(`Passed: ${passed}`));
  if (failed > 0) {
    console.log(red(`Failed: ${failed}`));
  }
  
  // Print failed tests details
  if (failed > 0) {
    console.log(red('\nFailed tests:'));
    results.filter(r => r.status === 'failed').forEach(r => {
      console.log(red(`  • ${r.name}: ${r.error}`));
    });
  }
  
  // Calculate average duration
  const avgDuration = results
    .filter(r => r.status === 'passed')
    .reduce((sum, r) => sum + r.duration, 0) / (passed || 1);
  
  console.log(`\nAverage test duration: ${avgDuration.toFixed(1)}ms`);
  
  process.exit(failed > 0 ? 1 : 0);
}

// Check if extension is running
async function checkExtension() {
  try {
    const ws = await connectToServer();
    ws.close();
    return true;
  } catch (error) {
    console.log(yellow('⚠️  Chrome extension not detected. Please ensure:'));
    console.log('   1. Chrome extension is installed and enabled');
    console.log('   2. Extension is connected (click extension icon)');
    console.log('   3. WebSocket server is running on port 8765\n');
    return false;
  }
}

// Main
async function main() {
  console.log(blue('JavaScript Execution E2E Test Suite'));
  console.log(blue('===================================\n'));
  
  // Check if extension is available
  if (!await checkExtension()) {
    process.exit(1);
  }
  
  // Run tests
  await runTests();
}

main().catch(console.error);