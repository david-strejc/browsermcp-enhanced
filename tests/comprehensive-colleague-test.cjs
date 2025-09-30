#!/usr/bin/env node

/**
 * Comprehensive Multi-Instance Test with Two "Colleague" Agents
 *
 * This script creates TWO independent test agents that systematically test
 * ALL browsermcp tools while running in parallel to verify multi-instance isolation.
 *
 * Each "colleague" has a comprehensive test plan and reports results.
 */

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const COLORS = {
  RESET: '\x1b[0m',
  RED: '\x1b[31m',
  YELLOW: '\x1b[33m',
  GREEN: '\x1b[32m',
  BLUE: '\x1b[34m',
  MAGENTA: '\x1b[35m',
  CYAN: '\x1b[36m',
  GRAY: '\x1b[90m',
  BOLD: '\x1b[1m'
};

// Test configuration
const CONFIG = {
  logDir: path.join(__dirname, 'logs'),
  testTimeout: 300000, // 5 minutes total
  toolTimeout: 30000    // 30 seconds per tool
};

// ALL browsermcp tools to test
const BROWSERMCP_TOOLS = [
  'browser_navigate',
  'browser_screenshot',
  'browser_snapshot',
  'browser_click',
  'browser_hover',
  'browser_type',
  'browser_select_option',
  'browser_press_key',
  'browser_wait',
  'browser_scroll',
  'browser_tab',
  'browser_execute_js',
  'browser_extract_html',
  'browser_fill_form',
  'browser_debugger',
  'browser_detect_file_inputs'
];

// Logger class
class Logger {
  constructor(name, color) {
    this.name = name;
    this.color = color;
    this.logFile = path.join(CONFIG.logDir, `${name}.log`);

    if (!fs.existsSync(CONFIG.logDir)) {
      fs.mkdirSync(CONFIG.logDir, { recursive: true });
    }

    fs.writeFileSync(this.logFile, `\n${'='.repeat(80)}\n${name} - Test Log\nStarted: ${new Date().toISOString()}\n${'='.repeat(80)}\n\n`);
  }

  log(level, message, data = null) {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    const coloredName = `${this.color}${COLORS.BOLD}[${this.name}]${COLORS.RESET}`;

    let coloredLevel = level;
    if (level === 'ERROR') coloredLevel = `${COLORS.RED}${COLORS.BOLD}${level}${COLORS.RESET}`;
    else if (level === 'WARN') coloredLevel = `${COLORS.YELLOW}${level}${COLORS.RESET}`;
    else if (level === 'INFO') coloredLevel = `${COLORS.GREEN}${level}${COLORS.RESET}`;
    else if (level === 'DEBUG') coloredLevel = `${COLORS.GRAY}${level}${COLORS.RESET}`;
    else if (level === 'SUCCESS') coloredLevel = `${COLORS.GREEN}${COLORS.BOLD}✓ ${level}${COLORS.RESET}`;

    const consoleMessage = `${COLORS.GRAY}${timestamp}${COLORS.RESET} ${coloredName} ${coloredLevel}: ${message}`;
    console.log(consoleMessage);

    const fileMessage = `${new Date().toISOString()} [${this.name}] ${level}: ${message}${data ? '\n' + JSON.stringify(data, null, 2) : ''}\n`;
    fs.appendFileSync(this.logFile, fileMessage);
  }

  info(msg, data) { this.log('INFO', msg, data); }
  warn(msg, data) { this.log('WARN', msg, data); }
  error(msg, data) { this.log('ERROR', msg, data); }
  debug(msg, data) { this.log('DEBUG', msg, data); }
  success(msg, data) { this.log('SUCCESS', msg, data); }
}

// Colleague Agent class
class ColleagueAgent {
  constructor(name, port, color, testPlan) {
    this.name = name;
    this.port = port;
    this.color = color;
    this.testPlan = testPlan;
    this.logger = new Logger(this.name, this.color);

    this.ws = null;
    this.instanceId = null;
    this.connected = false;
    this.messageId = 0;
    this.pendingMessages = new Map();

    this.results = {
      toolsTested: [],
      toolsPassed: [],
      toolsFailed: [],
      tabsUsed: new Set(),
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      errors: []
    };
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.logger.info('Connecting to MCP server...');
      this.ws = new WebSocket(`ws://localhost:${this.port}`);

      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout after 5 seconds'));
      }, 5000);

      this.ws.on('open', () => {
        clearTimeout(timeout);
        this.logger.success('WebSocket connected');

        // Request instance ID
        this.send({
          type: 'hello',
          wants: 'instanceId'
        }, (response) => {
          // Response can have instanceId directly or in payload
          const instanceId = response.instanceId || (response.payload && response.payload.instanceId);

          if (instanceId) {
            this.instanceId = instanceId;
            this.connected = true;
            this.logger.success(`Instance ID: ${this.instanceId.substring(0, 12)}...`);
            resolve();
          } else {
            this.logger.error('Unexpected response format', response);
            reject(new Error('No instance ID received'));
          }
        });
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message);
        } catch (err) {
          this.logger.error(`Failed to parse message: ${err.message}`);
        }
      });

      this.ws.on('error', (err) => {
        clearTimeout(timeout);
        this.logger.error(`WebSocket error: ${err.message}`);
        reject(err);
      });

      this.ws.on('close', () => {
        this.connected = false;
        this.logger.warn('WebSocket closed');
      });
    });
  }

  send(message, callback) {
    const id = ++this.messageId;
    message.id = id;
    message.instanceId = this.instanceId;

    if (callback) {
      this.pendingMessages.set(id, callback);
    }

    this.ws.send(JSON.stringify(message));
    this.logger.debug(`→ ${message.type}`);
  }

  handleMessage(message) {
    this.logger.debug(`← ${message.type || 'response'}`);

    // Handle special messages by type (like helloAck which has no id field)
    if (message.type === 'helloAck') {
      // Find the hello callback - it's the first message sent (id: 1)
      const helloCallback = this.pendingMessages.get(1);
      if (helloCallback) {
        this.pendingMessages.delete(1);
        helloCallback(message);
        return;
      }
    }

    // Handle normal request/response messages with IDs
    if (message.id && this.pendingMessages.has(message.id)) {
      const callback = this.pendingMessages.get(message.id);
      this.pendingMessages.delete(message.id);
      callback(message);
    }
  }

  async testTool(toolName, args, description) {
    this.logger.info(`\n${COLORS.CYAN}Testing: ${toolName}${COLORS.RESET}`);
    this.logger.info(`  Description: ${description}`);

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.logger.error(`  ✗ Timeout after ${CONFIG.toolTimeout}ms`);
        this.results.toolsFailed.push(toolName);
        this.results.failedTests++;
        this.results.errors.push({ tool: toolName, error: 'Timeout' });
        resolve(false);
      }, CONFIG.toolTimeout);

      this.send({
        type: toolName,
        payload: args
      }, (response) => {
        clearTimeout(timeout);

        if (response.error) {
          this.logger.error(`  ✗ FAILED: ${response.error}`);
          this.results.toolsFailed.push(toolName);
          this.results.failedTests++;
          this.results.errors.push({ tool: toolName, error: response.error });
          resolve(false);
        } else {
          this.logger.success(`  ✓ PASSED`);

          // Log response details
          if (response.payload) {
            if (response.payload.tabId) {
              this.results.tabsUsed.add(response.payload.tabId);
              this.logger.debug(`  Tab ID: ${response.payload.tabId}`);
            }
            if (response.payload.url) {
              this.logger.debug(`  URL: ${response.payload.url}`);
            }
            if (response.payload.screenshot) {
              this.logger.debug(`  Screenshot size: ${response.payload.screenshot.length} bytes`);
            }
          }

          this.results.toolsPassed.push(toolName);
          this.results.passedTests++;
          resolve(true);
        }
      });
    });
  }

  async runTests() {
    this.logger.info(`\n${'='.repeat(70)}`);
    this.logger.info(`${COLORS.BOLD}Starting Test Execution${COLORS.RESET}`);
    this.logger.info(`${'='.repeat(70)}\n`);

    for (const test of this.testPlan) {
      this.results.totalTests++;
      this.results.toolsTested.push(test.tool);

      await this.testTool(test.tool, test.args, test.description);

      // Small delay between tests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Final summary
    this.logger.info(`\n${'='.repeat(70)}`);
    this.logger.info(`${COLORS.BOLD}Test Execution Complete${COLORS.RESET}`);
    this.logger.info(`${'='.repeat(70)}\n`);

    this.logger.info(`Total tests: ${this.results.totalTests}`);
    this.logger.success(`Passed: ${this.results.passedTests}`);
    if (this.results.failedTests > 0) {
      this.logger.error(`Failed: ${this.results.failedTests}`);
    }
    this.logger.info(`Success rate: ${((this.results.passedTests / this.results.totalTests) * 100).toFixed(1)}%`);
    this.logger.info(`Tabs used: ${Array.from(this.results.tabsUsed).join(', ') || 'None'}`);
    this.logger.info('');
  }

  getResults() {
    return {
      agent: this.name,
      port: this.port,
      instanceId: this.instanceId,
      results: this.results,
      successRate: this.results.totalTests > 0
        ? this.results.passedTests / this.results.totalTests
        : 0
    };
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

// Test coordinator
class TestCoordinator {
  constructor() {
    this.logger = new Logger('Coordinator', COLORS.MAGENTA);
    this.colleagues = [];
    this.startTime = null;
  }

  createColleagues() {
    this.logger.info(`\n${'='.repeat(80)}`);
    this.logger.info(`${COLORS.BOLD}${COLORS.MAGENTA}  Comprehensive Multi-Instance BrowserMCP Test${COLORS.RESET}`);
    this.logger.info(`${COLORS.BOLD}${COLORS.MAGENTA}  Two Colleague Agents Testing ALL Tools${COLORS.RESET}`);
    this.logger.info(`${'='.repeat(80)}\n`);

    // Colleague Alice - Tests navigation, screenshots, and basic features
    const aliceTestPlan = [
      {
        tool: 'browser_navigate',
        args: { action: 'goto', url: 'https://example.com' },
        description: 'Navigate to example.com'
      },
      {
        tool: 'browser_screenshot',
        args: { quality: 'medium' },
        description: 'Take screenshot of example.com'
      },
      {
        tool: 'browser_snapshot',
        args: { level: 'minimal' },
        description: 'Get page accessibility tree'
      },
      {
        tool: 'browser_tab',
        args: { action: 'list' },
        description: 'List all browser tabs'
      },
      {
        tool: 'browser_execute_js',
        args: { code: 'return document.title' },
        description: 'Execute JavaScript to get page title'
      },
      {
        tool: 'browser_navigate',
        args: { action: 'goto', url: 'https://wikipedia.org' },
        description: 'Navigate to Wikipedia'
      },
      {
        tool: 'browser_screenshot',
        args: { quality: 'low' },
        description: 'Take low-quality screenshot'
      },
      {
        tool: 'browser_wait',
        args: { time: 1 },
        description: 'Wait for 1 second'
      },
      {
        tool: 'browser_navigate',
        args: { action: 'back' },
        description: 'Navigate back to previous page'
      },
      {
        tool: 'browser_navigate',
        args: { action: 'forward' },
        description: 'Navigate forward'
      },
      {
        tool: 'browser_navigate',
        args: { action: 'refresh' },
        description: 'Refresh current page'
      },
      {
        tool: 'browser_extract_html',
        args: { selector: 'h1', mode: 'simple' },
        description: 'Extract H1 elements from page'
      }
    ];

    // Colleague Bob - Tests interaction, forms, and advanced features
    const bobTestPlan = [
      {
        tool: 'browser_navigate',
        args: { action: 'goto', url: 'https://github.com' },
        description: 'Navigate to GitHub'
      },
      {
        tool: 'browser_screenshot',
        args: { quality: 'medium' },
        description: 'Take screenshot of GitHub'
      },
      {
        tool: 'browser_snapshot',
        args: { level: 'scaffold' },
        description: 'Get compact page snapshot'
      },
      {
        tool: 'browser_tab',
        args: { action: 'list' },
        description: 'List all browser tabs (should be different from Alice)'
      },
      {
        tool: 'browser_execute_js',
        args: { code: 'return window.location.href' },
        description: 'Execute JavaScript to get current URL'
      },
      {
        tool: 'browser_navigate',
        args: { action: 'goto', url: 'https://stackoverflow.com' },
        description: 'Navigate to StackOverflow'
      },
      {
        tool: 'browser_scroll',
        args: { to: 'bottom', steps: 3 },
        description: 'Scroll to bottom of page'
      },
      {
        tool: 'browser_screenshot',
        args: { quality: 'high' },
        description: 'Take high-quality screenshot after scrolling'
      },
      {
        tool: 'browser_navigate',
        args: { action: 'goto', url: 'https://reddit.com' },
        description: 'Navigate to Reddit'
      },
      {
        tool: 'browser_wait',
        args: { time: 2 },
        description: 'Wait for 2 seconds'
      },
      {
        tool: 'browser_extract_html',
        args: { selector: 'a', mode: 'links' },
        description: 'Extract all links from page'
      },
      {
        tool: 'browser_debugger',
        args: { action: 'get_data', type: 'console' },
        description: 'Get console logs from debugger'
      }
    ];

    this.colleagues = [
      new ColleagueAgent('Alice', 8765, COLORS.CYAN, aliceTestPlan),
      new ColleagueAgent('Bob', 8766, COLORS.YELLOW, bobTestPlan)
    ];

    this.logger.info(`✓ Created colleague "Alice" (Port 8765) - ${aliceTestPlan.length} tests`);
    this.logger.info(`✓ Created colleague "Bob" (Port 8766) - ${bobTestPlan.length} tests\n`);
  }

  async connectColleagues() {
    this.logger.info('Connecting colleagues to MCP servers...\n');

    for (const colleague of this.colleagues) {
      try {
        await colleague.connect();
      } catch (err) {
        colleague.logger.error(`Failed to connect: ${err.message}`);
        throw err;
      }
    }

    this.logger.success('All colleagues connected!\n');
  }

  async runTests() {
    this.logger.info(`${'='.repeat(80)}`);
    this.logger.info('Starting Parallel Test Execution');
    this.logger.info(`${'='.repeat(80)}\n`);

    this.startTime = Date.now();

    // Run all colleagues in parallel
    const promises = this.colleagues.map(c => c.runTests());

    try {
      await Promise.all(promises);
    } catch (err) {
      this.logger.error(`Test execution error: ${err.message}`);
    }

    const duration = Date.now() - this.startTime;
    this.logger.info(`\nAll tests completed in ${(duration / 1000).toFixed(2)}s\n`);
  }

  generateReport() {
    this.logger.info(`\n${'='.repeat(80)}`);
    this.logger.info(`${COLORS.BOLD}${COLORS.MAGENTA}COMPREHENSIVE TEST REPORT${COLORS.RESET}`);
    this.logger.info(`${'='.repeat(80)}\n`);

    const results = {
      timestamp: new Date().toISOString(),
      duration: Date.now() - this.startTime,
      colleagues: this.colleagues.map(c => c.getResults())
    };

    // Per-colleague summary
    for (const colleague of results.colleagues) {
      this.logger.info(`${COLORS.BOLD}${colleague.agent}:${COLORS.RESET}`);
      this.logger.info(`  Port: ${colleague.port}`);
      this.logger.info(`  Instance ID: ${colleague.instanceId?.substring(0, 12)}...`);
      this.logger.info(`  Tests Run: ${colleague.results.totalTests}`);
      this.logger.success(`  Passed: ${colleague.results.passedTests}`);
      if (colleague.results.failedTests > 0) {
        this.logger.error(`  Failed: ${colleague.results.failedTests}`);
      }
      this.logger.info(`  Success Rate: ${(colleague.successRate * 100).toFixed(1)}%`);
      this.logger.info(`  Tabs Used: ${Array.from(colleague.results.tabsUsed).join(', ') || 'None'}`);
      this.logger.info(`  Tools Tested: ${colleague.results.toolsTested.length}`);
      this.logger.info('');
    }

    // Write detailed report
    const reportPath = path.join(CONFIG.logDir, 'comprehensive-test-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
    this.logger.info(`✓ Detailed report: ${reportPath}\n`);

    // Validation checks
    this.logger.info(`${'='.repeat(80)}`);
    this.logger.info(`${COLORS.BOLD}VALIDATION CHECKS${COLORS.RESET}`);
    this.logger.info(`${'='.repeat(80)}\n`);

    // Check 1: Different ports
    const ports = results.colleagues.map(c => c.port);
    const uniquePorts = new Set(ports);
    if (uniquePorts.size === ports.length) {
      this.logger.success('✓ Each colleague used different MCP port');
    } else {
      this.logger.error('✗ Colleagues shared MCP ports (ISOLATION BROKEN!)');
    }

    // Check 2: Different instance IDs
    const instances = results.colleagues.map(c => c.instanceId);
    const uniqueInstances = new Set(instances);
    if (uniqueInstances.size === instances.length) {
      this.logger.success('✓ Each colleague has unique instance ID');
    } else {
      this.logger.error('✗ Instance IDs are not unique (ISOLATION BROKEN!)');
    }

    // Check 3: Different tabs
    const tabSets = results.colleagues.map(c => c.results.tabsUsed);
    const allTabs = new Set([...tabSets[0], ...tabSets[1]]);
    if (allTabs.size === tabSets[0].size + tabSets[1].size) {
      this.logger.success('✓ Each colleague used different tabs (NO OVERLAP)');
    } else {
      this.logger.error('✗ Tab overlap detected (ISOLATION BROKEN!)');
      this.logger.error(`  Alice tabs: ${Array.from(tabSets[0]).join(', ')}`);
      this.logger.error(`  Bob tabs: ${Array.from(tabSets[1]).join(', ')}`);
    }

    // Check 4: Both completed tests
    const allWorked = results.colleagues.every(c => c.successRate > 0);
    if (allWorked) {
      this.logger.success('✓ All colleagues completed tests successfully');
    } else {
      this.logger.error('✗ Some colleagues failed all tests');
    }

    // Check 5: Good success rate
    const avgSuccessRate = results.colleagues.reduce((sum, c) => sum + c.successRate, 0) / results.colleagues.length;
    if (avgSuccessRate >= 0.8) {
      this.logger.success(`✓ Good average success rate: ${(avgSuccessRate * 100).toFixed(1)}%`);
    } else if (avgSuccessRate >= 0.5) {
      this.logger.warn(`⚠ Moderate success rate: ${(avgSuccessRate * 100).toFixed(1)}%`);
    } else {
      this.logger.error(`✗ Low success rate: ${(avgSuccessRate * 100).toFixed(1)}%`);
    }

    this.logger.info('');

    return results;
  }

  cleanup() {
    this.logger.info('Cleaning up...');
    for (const colleague of this.colleagues) {
      colleague.close();
    }
  }
}

// Main execution
async function main() {
  const coordinator = new TestCoordinator();

  try {
    coordinator.createColleagues();
    await coordinator.connectColleagues();
    await coordinator.runTests();
    const results = coordinator.generateReport();
    coordinator.cleanup();

    // Exit with appropriate code
    const allPassed = results.colleagues.every(c => c.successRate > 0.7);
    process.exit(allPassed ? 0 : 1);

  } catch (err) {
    console.error(`\n${COLORS.RED}${COLORS.BOLD}Fatal Error: ${err.message}${COLORS.RESET}\n`);
    console.error(err.stack);
    coordinator.cleanup();
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}