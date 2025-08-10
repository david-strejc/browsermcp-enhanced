#!/usr/bin/env node

/**
 * Direct WebSocket Test
 * Tests the Chrome extension directly without MCP server
 */

import { WebSocket } from 'ws';

const WS_PORT = 8765;

// Color output
const red = (text) => `\x1b[31m${text}\x1b[0m`;
const green = (text) => `\x1b[32m${text}\x1b[0m`;
const yellow = (text) => `\x1b[33m${text}\x1b[0m`;
const blue = (text) => `\x1b[34m${text}\x1b[0m`;
const cyan = (text) => `\x1b[36m${text}\x1b[0m`;

async function connectToServer() {
  return new Promise((resolve, reject) => {
    console.log(yellow(`Connecting to ws://localhost:${WS_PORT}...`));
    const ws = new WebSocket(`ws://localhost:${WS_PORT}`);
    
    const timeout = setTimeout(() => {
      reject(new Error('Connection timeout after 5 seconds'));
    }, 5000);
    
    ws.on('open', () => {
      clearTimeout(timeout);
      console.log(green('✓ Connected to WebSocket'));
      resolve(ws);
    });
    
    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`WebSocket error: ${err.message}`));
    });
  });
}

async function sendAndWait(ws, type, payload = {}, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).substr(2, 9);
    const message = JSON.stringify({ id, type, payload });
    
    console.log(cyan(`\n→ Sending: ${type}`));
    console.log(cyan(`  Payload: ${JSON.stringify(payload)}`));
    
    const startTime = Date.now();
    
    const timeout = setTimeout(() => {
      const duration = Date.now() - startTime;
      console.log(red(`✗ Timeout after ${duration}ms`));
      reject(new Error(`Timeout waiting for ${type} after ${timeoutMs}ms`));
    }, timeoutMs);
    
    const handler = (data) => {
      try {
        const response = JSON.parse(data.toString());
        if (response.id === id) {
          const duration = Date.now() - startTime;
          clearTimeout(timeout);
          ws.removeListener('message', handler);
          
          console.log(green(`← Response received in ${duration}ms`));
          
          if (response.error) {
            console.log(red(`  Error: ${response.error}`));
            reject(new Error(response.error));
          } else {
            console.log(green(`  Success: ${JSON.stringify(response.payload || response).substring(0, 200)}`));
            resolve(response.payload || response);
          }
        }
      } catch (e) {
        console.error(red(`Parse error: ${e.message}`));
      }
    };
    
    ws.on('message', handler);
    
    console.log(blue(`  Sending message...`));
    ws.send(message);
  });
}

async function main() {
  console.log(blue('\n════════════════════════════════════════════'));
  console.log(blue(' Direct WebSocket Test'));
  console.log(blue('════════════════════════════════════════════\n'));
  
  console.log(yellow('Prerequisites:'));
  console.log(yellow('1. Chrome browser is open'));
  console.log(yellow('2. Browser MCP extension is installed'));
  console.log(yellow('3. Extension is connected (click icon → Connect)'));
  console.log(yellow('\nPress Ctrl+C to exit\n'));
  
  let ws;
  
  try {
    // Connect to WebSocket
    ws = await connectToServer();
    
    // Add error handler
    ws.on('error', (error) => {
      console.error(red(`WebSocket error: ${error.message}`));
    });
    
    ws.on('close', () => {
      console.log(yellow('WebSocket connection closed'));
    });
    
    // Wait a bit for extension to be ready
    console.log(yellow('\nWaiting for extension to be ready...'));
    await new Promise(r => setTimeout(r, 1000));
    
    // Test 1: Navigate
    console.log(blue('\n═══ Test 1: Navigate to example.com ═══'));
    await sendAndWait(ws, 'browser_navigate', { 
      url: 'https://example.com' 
    });
    
    // Wait for page load
    await new Promise(r => setTimeout(r, 2000));
    
    // Test 2: Take screenshot
    console.log(blue('\n═══ Test 2: Take screenshot ═══'));
    const screenshot = await sendAndWait(ws, 'browser_screenshot', {});
    console.log(green(`  Screenshot data length: ${screenshot.data?.length || 0}`));
    
    // Test 3: Simple JS execution - return string
    console.log(blue('\n═══ Test 3: Execute JS - return string ═══'));
    await sendAndWait(ws, 'js.execute', {
      code: 'return "hello world";',
      timeout: 1000
    });
    
    // Test 4: Simple JS execution - return number
    console.log(blue('\n═══ Test 4: Execute JS - simple math ═══'));
    await sendAndWait(ws, 'js.execute', {
      code: 'return 42;',
      timeout: 1000
    });
    
    // Test 5: Get page info using safe API
    console.log(blue('\n═══ Test 5: Execute JS - getPageInfo ═══'));
    await sendAndWait(ws, 'js.execute', {
      code: 'return api.getPageInfo();',
      timeout: 1000
    });
    
    // Test 6: Check element exists
    console.log(blue('\n═══ Test 6: Execute JS - check body exists ═══'));
    await sendAndWait(ws, 'js.execute', {
      code: 'return api.exists("body");',
      timeout: 1000
    });
    
    // Test 7: Get text from h1
    console.log(blue('\n═══ Test 7: Execute JS - get h1 text ═══'));
    await sendAndWait(ws, 'js.execute', {
      code: 'return api.getText("h1");',
      timeout: 1000
    });
    
    // Test 8: Count elements
    console.log(blue('\n═══ Test 8: Execute JS - count divs ═══'));
    await sendAndWait(ws, 'js.execute', {
      code: 'return api.count("div");',
      timeout: 1000
    });
    
    // Test 9: Ultra-fast timeout
    console.log(blue('\n═══ Test 9: Execute JS - 100ms timeout ═══'));
    await sendAndWait(ws, 'js.execute', {
      code: 'return "fast";',
      timeout: 100
    });
    
    // Test 10: Test timeout (should fail)
    console.log(blue('\n═══ Test 10: Execute JS - should timeout ═══'));
    try {
      await sendAndWait(ws, 'js.execute', {
        code: 'await api.wait(500); return "should not reach";',
        timeout: 100
      });
      console.log(red('ERROR: Should have timed out!'));
    } catch (error) {
      if (error.message.includes('timeout') || error.message.includes('Timeout')) {
        console.log(green('✓ Correctly timed out'));
      } else {
        console.log(red(`Unexpected error: ${error.message}`));
      }
    }
    
    // Test 11: Unsafe mode - get document.title
    console.log(blue('\n═══ Test 11: Execute JS - unsafe mode ═══'));
    await sendAndWait(ws, 'js.execute', {
      code: 'return document.title;',
      timeout: 1000,
      unsafe: true
    });
    
    // Test 12: No timeout specified (use default)
    console.log(blue('\n═══ Test 12: Execute JS - default timeout ═══'));
    await sendAndWait(ws, 'js.execute', {
      code: 'return "default timeout";'
      // No timeout specified
    });
    
    console.log(green('\n✓ All tests completed successfully!\n'));
    
  } catch (error) {
    console.error(red(`\n✗ Test failed: ${error.message}`));
    console.error(red(error.stack));
  } finally {
    if (ws) {
      console.log(yellow('\nClosing connection...'));
      ws.close();
    }
  }
}

main().catch(error => {
  console.error(red('Fatal error:'), error);
  process.exit(1);
});