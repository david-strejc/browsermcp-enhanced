#!/usr/bin/env node

/**
 * Test MCP Server Startup
 * Simple test to verify the MCP server starts and has the expected tools
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

async function main() {
  console.log(blue('\n════════════════════════════════════════════'));
  console.log(blue(' MCP Server Startup Test'));
  console.log(blue('════════════════════════════════════════════\n'));

  // Start MCP server
  console.log(yellow('Starting MCP server...'));
  const serverPath = join(__dirname, '..', 'dist', 'index.js');
  console.log(yellow(`Server path: ${serverPath}`));
  
  const serverProcess = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  // Capture server stderr for debugging
  let serverErrors = '';
  serverProcess.stderr.on('data', (data) => {
    serverErrors += data.toString();
    console.log(red(`[Server Error] ${data.toString()}`));
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
    // Connect with timeout
    console.log(yellow('Connecting to MCP server...'));
    const connectPromise = client.connect(transport);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Connection timeout after 5 seconds')), 5000)
    );
    
    await Promise.race([connectPromise, timeoutPromise]);
    console.log(green('✓ Connected successfully!\n'));

    // List tools
    console.log(yellow('Listing available tools...'));
    const result = await client.listTools();
    console.log(green(`✓ Found ${result.tools.length} tools\n`));

    // Check for critical tools
    const criticalTools = [
      'browser_navigate',
      'browser_execute_js',
      'browser_screenshot',
      'browser_snapshot',
      'browser_common_operation'
    ];

    console.log(blue('Checking for critical tools:'));
    for (const toolName of criticalTools) {
      const tool = result.tools.find(t => t.name === toolName);
      if (tool) {
        console.log(green(`  ✓ ${toolName}`));
      } else {
        console.log(red(`  ✗ ${toolName} - NOT FOUND!`));
      }
    }

    // List all tools
    console.log(blue('\nAll available tools:'));
    result.tools.forEach(tool => {
      console.log(`  • ${tool.name}`);
    });

    // Test calling a simple tool (that doesn't need browser)
    console.log(yellow('\nTesting tool call (will fail without browser connection)...'));
    try {
      await client.callTool('browser_navigate', { url: 'https://example.com' });
      console.log(green('✓ Tool call succeeded (unexpected)'));
    } catch (error) {
      if (error.message.includes('No connection to browser')) {
        console.log(green('✓ Expected error: No browser connection'));
      } else {
        console.log(red(`✗ Unexpected error: ${error.message}`));
      }
    }

    console.log(green('\n✓ Server startup test completed successfully!'));

  } catch (error) {
    console.error(red(`\n✗ Test failed: ${error.message}`));
    if (serverErrors) {
      console.error(red('\nServer errors:'));
      console.error(red(serverErrors));
    }
    process.exit(1);
  } finally {
    // Cleanup
    console.log(yellow('\nCleaning up...'));
    await client.close();
    serverProcess.kill();
  }
}

main().catch(error => {
  console.error(red('Fatal error:'), error);
  process.exit(1);
});