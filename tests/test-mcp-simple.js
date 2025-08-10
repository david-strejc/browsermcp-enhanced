#!/usr/bin/env node

/**
 * Simple MCP Server Test
 * Tests basic browser MCP operations directly through the MCP protocol
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Color output
const red = (text) => `\x1b[31m${text}\x1b[0m`;
const green = (text) => `\x1b[32m${text}\x1b[0m`;
const yellow = (text) => `\x1b[33m${text}\x1b[0m`;
const blue = (text) => `\x1b[34m${text}\x1b[0m`;
const cyan = (text) => `\x1b[36m${text}\x1b[0m`;

// Test counter
let testNumber = 0;
let passed = 0;
let failed = 0;

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest(name, testFn) {
  testNumber++;
  process.stdout.write(`${cyan(`[Test ${testNumber}]`)} ${name}... `);
  const startTime = Date.now();
  
  try {
    const result = await testFn();
    const duration = Date.now() - startTime;
    console.log(green(`✓ (${duration}ms)`));
    if (result) {
      console.log(yellow(`  Result: ${JSON.stringify(result, null, 2)}`));
    }
    passed++;
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.log(red(`✗ (${duration}ms)`));
    console.log(red(`  Error: ${error.message}`));
    if (error.stack) {
      console.log(red(`  Stack: ${error.stack.split('\n').slice(1, 3).join('\n')}`));
    }
    failed++;
    throw error;
  }
}

async function main() {
  console.log(blue('\n════════════════════════════════════════════'));
  console.log(blue(' MCP Browser Server - Simple Test Suite'));
  console.log(blue('════════════════════════════════════════════\n'));

  // Start MCP server
  console.log(yellow('Starting MCP server...'));
  const serverPath = join(__dirname, '..', 'dist', 'index.js');
  const serverProcess = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, DEBUG: '*' }
  });

  // Log server output for debugging
  serverProcess.stderr.on('data', (data) => {
    console.log(cyan(`[Server Error] ${data.toString()}`));
  });

  // Create MCP client
  const transport = new StdioClientTransport({
    stdin: serverProcess.stdout,
    stdout: serverProcess.stdin,
  });

  const client = new Client({
    name: 'test-client',
    version: '1.0.0',
  }, {
    capabilities: {}
  });

  try {
    // Connect to server
    console.log(yellow('Connecting to MCP server...'));
    await client.connect(transport);
    console.log(green('Connected!\n'));

    // List available tools
    await runTest('List available tools', async () => {
      const result = await client.listTools();
      console.log(cyan(`  Found ${result.tools.length} tools`));
      
      // Show first few tools
      const toolNames = result.tools.slice(0, 5).map(t => t.name);
      console.log(cyan(`  Sample tools: ${toolNames.join(', ')}`));
      
      // Check if browser_execute_js exists
      const hasExecuteJs = result.tools.some(t => t.name === 'browser_execute_js');
      if (!hasExecuteJs) {
        throw new Error('browser_execute_js tool not found!');
      }
      
      return { totalTools: result.tools.length };
    });

    console.log(yellow('\n⚠️  Please ensure Chrome extension is connected before continuing...'));
    console.log(yellow('   1. Open Chrome'));
    console.log(yellow('   2. Click the Browser MCP extension icon'));
    console.log(yellow('   3. Click "Connect"\n'));
    await wait(3000);

    // Test 1: Navigate to a simple page
    await runTest('Navigate to example.com', async () => {
      const result = await client.callTool('browser_navigate', {
        url: 'https://example.com'
      });
      return result;
    });

    // Wait for navigation
    await wait(2000);

    // Test 2: Take a screenshot (simple operation)
    await runTest('Take screenshot', async () => {
      const result = await client.callTool('browser_screenshot', {});
      const hasData = result.content?.[0]?.type === 'image' && result.content[0].data;
      if (!hasData) {
        throw new Error('No screenshot data received');
      }
      return { imageSize: result.content[0].data.length };
    });

    // Test 3: Get page snapshot (should work without JS execution)
    await runTest('Get page snapshot', async () => {
      const result = await client.callTool('browser_snapshot', {
        level: 'minimal'
      });
      const text = result.content?.[0]?.text;
      if (!text) {
        throw new Error('No snapshot text received');
      }
      return { snapshotLength: text.length };
    });

    // Test 4: Simple JavaScript - just return a string
    await runTest('Execute JS: return simple string', async () => {
      const result = await client.callTool('browser_execute_js', {
        code: 'return "hello";',
        timeout: 1000
      });
      const text = result.content?.[0]?.text;
      if (text !== '"hello"' && text !== 'hello') {
        throw new Error(`Expected "hello", got: ${text}`);
      }
      return { result: text };
    });

    // Test 5: Simple math operation
    await runTest('Execute JS: simple math', async () => {
      const result = await client.callTool('browser_execute_js', {
        code: 'return 2 + 2;',
        timeout: 1000
      });
      const text = result.content?.[0]?.text;
      if (text !== '4' && text !== 4) {
        throw new Error(`Expected 4, got: ${text}`);
      }
      return { result: text };
    });

    // Test 6: Get document title using safe API
    await runTest('Execute JS: get page title (safe API)', async () => {
      const result = await client.callTool('browser_execute_js', {
        code: 'return api.getPageInfo().title;',
        timeout: 1000
      });
      const text = result.content?.[0]?.text;
      if (!text) {
        throw new Error('No title received');
      }
      return { title: text };
    });

    // Test 7: Get document title using unsafe mode
    await runTest('Execute JS: get page title (unsafe mode)', async () => {
      const result = await client.callTool('browser_execute_js', {
        code: 'return document.title;',
        timeout: 1000,
        unsafe: true
      });
      const text = result.content?.[0]?.text;
      if (!text) {
        throw new Error('No title received');
      }
      return { title: text };
    });

    // Test 8: Check element existence
    await runTest('Execute JS: check body exists', async () => {
      const result = await client.callTool('browser_execute_js', {
        code: 'return api.exists("body");',
        timeout: 1000
      });
      const text = result.content?.[0]?.text;
      if (text !== 'true' && text !== true) {
        throw new Error(`Expected true, got: ${text}`);
      }
      return { exists: text };
    });

    // Test 9: Get text content
    await runTest('Execute JS: get h1 text', async () => {
      const result = await client.callTool('browser_execute_js', {
        code: 'return api.getText("h1");',
        timeout: 1000
      });
      const text = result.content?.[0]?.text;
      return { h1Text: text };
    });

    // Test 10: Count elements
    await runTest('Execute JS: count divs', async () => {
      const result = await client.callTool('browser_execute_js', {
        code: 'return api.count("div");',
        timeout: 1000
      });
      const text = result.content?.[0]?.text;
      const count = parseInt(text);
      if (isNaN(count) || count < 0) {
        throw new Error(`Invalid count: ${text}`);
      }
      return { divCount: count };
    });

    // Test 11: Very short timeout (should still work for quick operations)
    await runTest('Execute JS: ultra-fast timeout (100ms)', async () => {
      const result = await client.callTool('browser_execute_js', {
        code: 'return "fast";',
        timeout: 100
      });
      const text = result.content?.[0]?.text;
      if (text !== '"fast"' && text !== 'fast') {
        throw new Error(`Expected "fast", got: ${text}`);
      }
      return { result: text };
    });

    // Test 12: Timeout test (should fail)
    await runTest('Execute JS: should timeout', async () => {
      try {
        await client.callTool('browser_execute_js', {
          code: 'await api.wait(500); return "should not reach";',
          timeout: 100
        });
        throw new Error('Should have timed out');
      } catch (error) {
        if (error.message.includes('timeout') || error.message.includes('Timeout')) {
          return { timedOut: true };
        }
        throw error;
      }
    });

    // Test 13: Common operation
    await runTest('Common operation: extract all text', async () => {
      const result = await client.callTool('browser_common_operation', {
        operation: 'extract_all_text'
      });
      const text = result.content?.[0]?.text;
      if (!text) {
        throw new Error('No text extracted');
      }
      const parsed = JSON.parse(text);
      return { 
        totalElements: parsed.totalElements,
        totalChars: parsed.totalChars 
      };
    });

  } catch (error) {
    console.error(red(`\nFatal error: ${error.message}`));
    if (error.stack) {
      console.error(red(error.stack));
    }
  } finally {
    // Print summary
    console.log(blue('\n════════════════════════════════════════════'));
    console.log(blue(' Test Summary'));
    console.log(blue('════════════════════════════════════════════\n'));
    
    console.log(`Total tests: ${passed + failed}`);
    console.log(green(`Passed: ${passed}`));
    if (failed > 0) {
      console.log(red(`Failed: ${failed}`));
    }
    
    // Cleanup
    console.log(yellow('\nCleaning up...'));
    await client.close();
    serverProcess.kill();
    
    process.exit(failed > 0 ? 1 : 0);
  }
}

main().catch(error => {
  console.error(red('Unhandled error:'), error);
  process.exit(1);
});