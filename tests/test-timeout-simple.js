#!/usr/bin/env node

/**
 * Simple Timeout Test
 * Tests JavaScript execution timeout behavior with very short timeouts
 */

import { WebSocket } from 'ws';

const WS_PORT = 8765;

// Color output
const red = (text) => `\x1b[31m${text}\x1b[0m`;
const green = (text) => `\x1b[32m${text}\x1b[0m`;
const yellow = (text) => `\x1b[33m${text}\x1b[0m`;
const blue = (text) => `\x1b[34m${text}\x1b[0m`;

// Connect to WebSocket server
async function connectToServer() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${WS_PORT}`);
    
    const timeout = setTimeout(() => {
      reject(new Error('Connection timeout'));
    }, 5000);
    
    ws.on('open', () => {
      clearTimeout(timeout);
      console.log(green('✓ Connected to WebSocket server'));
      resolve(ws);
    });
    
    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`WebSocket connection failed: ${err.message}`));
    });
  });
}

// Send message and wait for response
async function sendMessage(ws, type, payload, expectedTimeout = false) {
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).substr(2, 9);
    const message = JSON.stringify({ id, type, payload });
    
    console.log(blue(`→ Sending ${type} with timeout=${payload.timeout}ms`));
    const startTime = Date.now();
    
    // Set our own timeout that's slightly longer than expected
    const timeout = setTimeout(() => {
      const duration = Date.now() - startTime;
      if (expectedTimeout) {
        console.log(green(`✓ Correctly timed out after ${duration}ms`));
        resolve({ timedOut: true, duration });
      } else {
        console.log(red(`✗ Unexpected timeout after ${duration}ms`));
        reject(new Error(`Message timeout after ${duration}ms`));
      }
    }, (payload.timeout || 5000) + 2000);
    
    const handler = (data) => {
      try {
        const response = JSON.parse(data.toString());
        if (response.id === id) {
          const duration = Date.now() - startTime;
          clearTimeout(timeout);
          ws.removeListener('message', handler);
          
          console.log(yellow(`← Response received after ${duration}ms`));
          
          if (response.error) {
            if (expectedTimeout && response.error.includes('timeout')) {
              console.log(green(`✓ Got expected timeout error: ${response.error}`));
              resolve({ error: response.error, duration });
            } else {
              console.log(red(`✗ Error: ${response.error}`));
              reject(new Error(response.error));
            }
          } else {
            if (expectedTimeout) {
              console.log(red(`✗ Expected timeout but got success`));
              reject(new Error('Expected timeout but succeeded'));
            } else {
              console.log(green(`✓ Success: ${JSON.stringify(response.payload?.result)}`));
              resolve({ payload: response.payload, duration });
            }
          }
        }
      } catch (e) {
        console.error(red(`Parse error: ${e.message}`));
      }
    };
    
    ws.on('message', handler);
    ws.send(message);
  });
}

async function runTests() {
  let ws;
  
  try {
    console.log(blue('\n═══════════════════════════════════════════'));
    console.log(blue(' JavaScript Execution Timeout Tests'));
    console.log(blue('═══════════════════════════════════════════\n'));
    
    // Connect
    ws = await connectToServer();
    
    // Wait a bit
    await new Promise(r => setTimeout(r, 500));
    
    // Navigate to test page
    console.log(yellow('\n→ Setting up test page...\n'));
    await sendMessage(ws, 'browser_navigate', { url: 'https://example.com' });
    await new Promise(r => setTimeout(r, 2000));
    
    // Test 1: Very fast execution (should succeed)
    console.log(blue('\nTest 1: Fast execution (100ms timeout)'));
    console.log('--------------------------------------');
    const test1 = await sendMessage(ws, 'js.execute', {
      code: 'return "instant";',
      timeout: 100
    }, false);
    console.log(`Duration: ${test1.duration}ms\n`);
    
    // Test 2: Code that takes 50ms with 100ms timeout (should succeed)
    console.log(blue('\nTest 2: 50ms wait with 100ms timeout'));
    console.log('--------------------------------------');
    const test2 = await sendMessage(ws, 'js.execute', {
      code: 'await api.wait(50); return "done";',
      timeout: 100
    }, false);
    console.log(`Duration: ${test2.duration}ms\n`);
    
    // Test 3: Code that takes 200ms with 100ms timeout (should timeout)
    console.log(blue('\nTest 3: 200ms wait with 100ms timeout (should timeout)'));
    console.log('--------------------------------------');
    const test3 = await sendMessage(ws, 'js.execute', {
      code: 'await api.wait(200); return "should not reach";',
      timeout: 100
    }, true);
    console.log(`Duration: ${test3.duration}ms\n`);
    
    // Test 4: Very short timeout (50ms)
    console.log(blue('\nTest 4: Ultra-fast 50ms timeout'));
    console.log('--------------------------------------');
    const test4 = await sendMessage(ws, 'js.execute', {
      code: 'return 42;',
      timeout: 50
    }, false);
    console.log(`Duration: ${test4.duration}ms\n`);
    
    // Test 5: Infinite loop with timeout (should timeout)
    console.log(blue('\nTest 5: Infinite loop with 200ms timeout'));
    console.log('--------------------------------------');
    const test5 = await sendMessage(ws, 'js.execute', {
      code: 'while(true) {} return "never";',
      timeout: 200
    }, true);
    console.log(`Duration: ${test5.duration}ms\n`);
    
    // Test 6: Default timeout (5000ms)
    console.log(blue('\nTest 6: Default timeout test'));
    console.log('--------------------------------------');
    const test6 = await sendMessage(ws, 'js.execute', {
      code: 'return api.getPageInfo();',
      // No timeout specified, should use default
    }, false);
    console.log(`Duration: ${test6.duration}ms\n`);
    
    console.log(green('\n✓ All tests completed successfully!\n'));
    
  } catch (error) {
    console.error(red(`\n✗ Test failed: ${error.message}\n`));
    process.exit(1);
  } finally {
    if (ws) {
      ws.close();
    }
  }
}

// Main
async function main() {
  try {
    await runTests();
  } catch (error) {
    console.error(red(`Fatal error: ${error.message}`));
    process.exit(1);
  }
}

main();