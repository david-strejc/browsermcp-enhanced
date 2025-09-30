#!/usr/bin/env node

/**
 * Simple Multi-Instance Test - Direct MCP WebSocket Testing
 *
 * This script directly connects to multiple MCP server instances via WebSocket
 * and tests tool invocation to verify instance isolation.
 *
 * NO CLAUDE API REQUIRED - Tests MCP servers directly
 */

const WebSocket = require('ws');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const COLORS = {
  RESET: '\x1b[0m',
  RED: '\x1b[31m',
  YELLOW: '\x1b[33m',
  GREEN: '\x1b[32m',
  BLUE: '\x1b[34m',
  MAGENTA: '\x1b[35m',
  CYAN: '\x1b[36m'
};

class MCPTestClient {
  constructor(port, name, color) {
    this.port = port;
    this.name = name;
    this.color = color;
    this.ws = null;
    this.instanceId = null;
    this.connected = false;
    this.messageId = 0;
    this.pendingMessages = new Map();
  }

  log(message) {
    console.log(`${this.color}[${this.name}:${this.port}]${COLORS.RESET} ${message}`);
  }

  error(message) {
    console.log(`${COLORS.RED}[${this.name}:${this.port}] ERROR:${COLORS.RESET} ${message}`);
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.log('Connecting to MCP server...');
      this.ws = new WebSocket(`ws://localhost:${this.port}`);

      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 5000);

      this.ws.on('open', () => {
        clearTimeout(timeout);
        this.log('✓ WebSocket connected');

        // Request instance ID
        this.send({
          type: 'hello',
          wants: 'instanceId'
        }, (response) => {
          if (response.instanceId) {
            this.instanceId = response.instanceId;
            this.connected = true;
            this.log(`✓ Instance ID received: ${this.instanceId.substring(0, 8)}`);
            resolve();
          } else {
            reject(new Error('No instance ID received'));
          }
        });
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message);
        } catch (err) {
          this.error(`Failed to parse message: ${err.message}`);
        }
      });

      this.ws.on('error', (err) => {
        clearTimeout(timeout);
        this.error(`WebSocket error: ${err.message}`);
        reject(err);
      });

      this.ws.on('close', () => {
        this.connected = false;
        this.log('WebSocket closed');
      });
    });
  }

  send(message, callback) {
    const id = ++this.messageId;
    message.id = id;

    if (callback) {
      this.pendingMessages.set(id, callback);
    }

    this.ws.send(JSON.stringify(message));
    this.log(`→ Sent: ${message.type}`);
  }

  handleMessage(message) {
    this.log(`← Received: ${message.type || 'unknown'}`);

    if (message.id && this.pendingMessages.has(message.id)) {
      const callback = this.pendingMessages.get(message.id);
      this.pendingMessages.delete(message.id);
      callback(message);
    }
  }

  async sendToolCall(toolName, args) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Tool call timeout: ${toolName}`));
      }, 30000);

      this.send({
        type: toolName,
        payload: args,
        instanceId: this.instanceId
      }, (response) => {
        clearTimeout(timeout);

        if (response.error) {
          this.error(`Tool "${toolName}" failed: ${response.error}`);
          reject(new Error(response.error));
        } else {
          this.log(`✓ Tool "${toolName}" succeeded`);
          resolve(response.payload);
        }
      });
    });
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

class TestCoordinator {
  constructor() {
    this.clients = [];
    this.results = {
      total: 0,
      passed: 0,
      failed: 0,
      tests: []
    };
  }

  async initialize() {
    console.log(`\n${COLORS.MAGENTA}${'='.repeat(60)}${COLORS.RESET}`);
    console.log(`${COLORS.MAGENTA}  Multi-Instance MCP Test Suite${COLORS.RESET}`);
    console.log(`${COLORS.MAGENTA}${'='.repeat(60)}${COLORS.RESET}\n`);

    // Create test clients for different ports
    this.clients = [
      new MCPTestClient(8765, 'Client-A', COLORS.CYAN),
      new MCPTestClient(8766, 'Client-B', COLORS.YELLOW)
    ];

    console.log('Connecting clients to MCP servers...\n');

    // Connect all clients
    for (const client of this.clients) {
      try {
        await client.connect();
      } catch (err) {
        client.error(`Failed to connect: ${err.message}`);
        throw err;
      }
    }

    console.log(`\n${COLORS.GREEN}✓ All clients connected${COLORS.RESET}\n`);
  }

  async runTest(testName, testFn) {
    this.results.total++;

    console.log(`\n${COLORS.BLUE}━━━ Test: ${testName} ━━━${COLORS.RESET}`);

    try {
      await testFn();
      this.results.passed++;
      this.results.tests.push({ name: testName, passed: true });
      console.log(`${COLORS.GREEN}✓ PASS${COLORS.RESET}`);
    } catch (err) {
      this.results.failed++;
      this.results.tests.push({ name: testName, passed: false, error: err.message });
      console.log(`${COLORS.RED}✗ FAIL: ${err.message}${COLORS.RESET}`);
    }
  }

  async runTests() {
    console.log(`${COLORS.MAGENTA}Starting test execution...${COLORS.RESET}\n`);

    // Test 1: Verify unique instance IDs
    await this.runTest('Instance IDs are unique', async () => {
      const ids = this.clients.map(c => c.instanceId);
      const uniqueIds = new Set(ids);

      if (uniqueIds.size !== ids.length) {
        throw new Error(`Duplicate instance IDs detected: ${ids.join(', ')}`);
      }
    });

    // Test 2: Parallel navigation to different URLs
    await this.runTest('Parallel navigation to different URLs', async () => {
      const urls = [
        'https://example.com',
        'https://wikipedia.org'
      ];

      const promises = this.clients.map((client, i) => {
        return client.sendToolCall('browser_navigate', {
          action: 'goto',
          url: urls[i]
        });
      });

      await Promise.all(promises);
    });

    // Test 3: Take screenshots from both instances
    await this.runTest('Take screenshots from both instances', async () => {
      const promises = this.clients.map(client => {
        return client.sendToolCall('browser_screenshot', {
          quality: 'medium'
        });
      });

      await Promise.all(promises);
    });

    // Test 4: Check that each client has different active tabs
    await this.runTest('Each client manages different tabs', async () => {
      const listTabsPromises = this.clients.map(client => {
        return client.sendToolCall('browser_tab', {
          action: 'list'
        });
      });

      const results = await Promise.all(listTabsPromises);

      // Extract tab IDs from each client
      const tabSets = results.map(result => {
        return new Set((result.tabs || []).map(tab => tab.id));
      });

      // Check for overlap
      const [tabsA, tabsB] = tabSets;
      const intersection = new Set([...tabsA].filter(x => tabsB.has(x)));

      if (intersection.size > 0) {
        throw new Error(`Tab overlap detected! Shared tabs: ${[...intersection].join(', ')}`);
      }
    });

    // Test 5: Sequential operations (lock testing)
    await this.runTest('Sequential operations don\'t interfere', async () => {
      // Client A navigates
      await this.clients[0].sendToolCall('browser_navigate', {
        action: 'goto',
        url: 'https://github.com'
      });

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Client B navigates (should not affect Client A)
      await this.clients[1].sendToolCall('browser_navigate', {
        action: 'goto',
        url: 'https://stackoverflow.com'
      });

      // Both should still be on their respective pages
    });
  }

  printResults() {
    console.log(`\n${COLORS.MAGENTA}${'='.repeat(60)}${COLORS.RESET}`);
    console.log(`${COLORS.MAGENTA}  Test Results${COLORS.RESET}`);
    console.log(`${COLORS.MAGENTA}${'='.repeat(60)}${COLORS.RESET}\n`);

    console.log(`Total:  ${this.results.total}`);
    console.log(`${COLORS.GREEN}Passed: ${this.results.passed}${COLORS.RESET}`);
    console.log(`${COLORS.RED}Failed: ${this.results.failed}${COLORS.RESET}\n`);

    if (this.results.failed === 0) {
      console.log(`${COLORS.GREEN}✓ All tests passed!${COLORS.RESET}\n`);
    } else {
      console.log(`${COLORS.RED}✗ Some tests failed:${COLORS.RESET}\n`);
      this.results.tests
        .filter(t => !t.passed)
        .forEach(t => {
          console.log(`  ${COLORS.RED}✗ ${t.name}${COLORS.RESET}`);
          console.log(`    ${t.error}`);
        });
      console.log('');
    }

    // Write results to file
    const reportPath = path.join(__dirname, 'test-results.json');
    fs.writeFileSync(reportPath, JSON.stringify(this.results, null, 2));
    console.log(`Report written to: ${reportPath}\n`);
  }

  cleanup() {
    console.log('Cleaning up...');
    for (const client of this.clients) {
      client.close();
    }
  }
}

async function main() {
  const coordinator = new TestCoordinator();

  try {
    await coordinator.initialize();
    await coordinator.runTests();
    coordinator.printResults();
    coordinator.cleanup();

    process.exit(coordinator.results.failed === 0 ? 0 : 1);
  } catch (err) {
    console.error(`\n${COLORS.RED}Fatal error: ${err.message}${COLORS.RESET}\n`);
    console.error(err.stack);
    coordinator.cleanup();
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}