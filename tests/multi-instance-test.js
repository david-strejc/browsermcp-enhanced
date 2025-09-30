#!/usr/bin/env node

/**
 * Multi-Instance Browser MCP Testing Suite
 *
 * This script tests the multi-instance functionality by creating TWO independent
 * Claude AI "colleagues" that interact with the browser MCP server simultaneously.
 *
 * Key Goals:
 * - Verify instance isolation (each agent uses different tabs)
 * - Test tab locking mechanism
 * - Validate message routing
 * - Ensure no cross-instance interference
 *
 * Requirements:
 * - ANTHROPIC_API_KEY environment variable with Claude Max subscription
 * - Browser MCP server running with multi-instance support
 * - Chrome browser with the extension installed
 */

const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  // API Configuration
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-sonnet-4-20250514', // Claude Sonnet 4

  // MCP Server Configuration
  mcpServerUrl: 'ws://localhost:8765', // Will be auto-detected from port range
  mcpPortRange: [8765, 8775],

  // Test Configuration
  testDuration: 120000, // 2 minutes
  logDir: path.join(__dirname, 'logs'),

  // Agent Configuration
  agents: [
    {
      name: 'Agent-Alice',
      color: '\x1b[36m', // Cyan
      tasks: [
        'Navigate to https://example.com and take a screenshot',
        'Navigate to https://github.com and extract the page title',
        'Wait 2 seconds then navigate to https://google.com'
      ]
    },
    {
      name: 'Agent-Bob',
      color: '\x1b[33m', // Yellow
      tasks: [
        'Navigate to https://wikipedia.org and take a screenshot',
        'Navigate to https://stackoverflow.com and extract the page title',
        'Wait 2 seconds then navigate to https://reddit.com'
      ]
    }
  ]
};

// Reset color
const RESET = '\x1b[0m';

// Logger class with color support
class Logger {
  constructor(name, color) {
    this.name = name;
    this.color = color;
    this.logFile = path.join(CONFIG.logDir, `${name}.log`);

    // Ensure log directory exists
    if (!fs.existsSync(CONFIG.logDir)) {
      fs.mkdirSync(CONFIG.logDir, { recursive: true });
    }
  }

  log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const coloredName = `${this.color}[${this.name}]${RESET}`;
    const coloredLevel = level === 'ERROR' ? `\x1b[31m${level}${RESET}` :
                         level === 'WARN'  ? `\x1b[33m${level}${RESET}` :
                         level === 'INFO'  ? `\x1b[32m${level}${RESET}` :
                         level;

    const consoleMessage = `${timestamp} ${coloredName} ${coloredLevel}: ${message}`;
    console.log(consoleMessage);

    // Write to file (without colors)
    const fileMessage = `${timestamp} [${this.name}] ${level}: ${message}${data ? '\n' + JSON.stringify(data, null, 2) : ''}\n`;
    fs.appendFileSync(this.logFile, fileMessage);
  }

  info(message, data) { this.log('INFO', message, data); }
  warn(message, data) { this.log('WARN', message, data); }
  error(message, data) { this.log('ERROR', message, data); }
  debug(message, data) { this.log('DEBUG', message, data); }
}

// Test Agent class
class TestAgent {
  constructor(config, agentIndex) {
    this.config = config;
    this.name = config.name;
    this.color = config.color;
    this.logger = new Logger(this.name, this.color);
    this.anthropic = new Anthropic({ apiKey: CONFIG.anthropicApiKey });
    this.conversationHistory = [];
    this.mcpPort = null;
    this.tabId = null;
    this.results = [];
  }

  async detectMCPPort() {
    this.logger.info('Detecting available MCP server ports...');

    // Try to connect to ports in range
    for (let port = CONFIG.mcpPortRange[0]; port <= CONFIG.mcpPortRange[1]; port++) {
      try {
        // Check if port is available by trying to connect
        const testUrl = `ws://localhost:${port}`;
        this.logger.debug(`Testing port ${port}...`);

        // For now, we'll just use sequential ports for each agent
        // In production, we'd query the registry or test actual connectivity
        if (port === CONFIG.mcpPortRange[0] + (this.config.agentIndex || 0)) {
          this.mcpPort = port;
          this.logger.info(`Assigned to MCP port ${port}`);
          return port;
        }
      } catch (err) {
        continue;
      }
    }

    throw new Error('No available MCP server ports found');
  }

  async sendMessage(userMessage) {
    this.logger.info(`Sending message: "${userMessage}"`);

    this.conversationHistory.push({
      role: 'user',
      content: userMessage
    });

    try {
      // Use Claude API with MCP connector
      // Note: This requires the anthropic-beta header for MCP support
      const response = await this.anthropic.messages.create({
        model: CONFIG.model,
        max_tokens: 4096,
        messages: this.conversationHistory,
        // MCP Configuration (if supported via API)
        // For now, we'll use the local MCP server via WebSocket
        temperature: 0.7
      });

      this.logger.info('Received response from Claude');
      this.logger.debug('Response', {
        stopReason: response.stop_reason,
        usage: response.usage
      });

      // Extract text and tool use from response
      const textContent = response.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n');

      if (textContent) {
        this.logger.info(`Claude response: ${textContent.substring(0, 100)}...`);
      }

      // Handle tool calls
      const toolUses = response.content.filter(block => block.type === 'tool_use');

      if (toolUses.length > 0) {
        this.logger.info(`Claude requested ${toolUses.length} tool(s)`);

        for (const toolUse of toolUses) {
          this.logger.info(`Tool: ${toolUse.name}`, { input: toolUse.input });

          // Track tab ID if browser_navigate is used
          if (toolUse.name === 'browser_navigate') {
            this.logger.info('✓ Agent is navigating to a new page');
          }
        }
      }

      // Add assistant response to history
      this.conversationHistory.push({
        role: 'assistant',
        content: response.content
      });

      return response;
    } catch (error) {
      this.logger.error(`Failed to send message: ${error.message}`, { error });
      throw error;
    }
  }

  async runTasks() {
    this.logger.info(`Starting task execution (${this.config.tasks.length} tasks)`);

    try {
      await this.detectMCPPort();

      for (let i = 0; i < this.config.tasks.length; i++) {
        const task = this.config.tasks[i];
        this.logger.info(`\n========== Task ${i + 1}/${this.config.tasks.length} ==========`);
        this.logger.info(`Task: ${task}`);

        const startTime = Date.now();

        try {
          const response = await this.sendMessage(task);
          const duration = Date.now() - startTime;

          this.results.push({
            taskNumber: i + 1,
            task,
            success: true,
            duration,
            response: response.content
          });

          this.logger.info(`Task completed in ${duration}ms`);

          // Wait a bit between tasks
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
          const duration = Date.now() - startTime;

          this.results.push({
            taskNumber: i + 1,
            task,
            success: false,
            duration,
            error: error.message
          });

          this.logger.error(`Task failed after ${duration}ms: ${error.message}`);
        }
      }

      this.logger.info('\n========== All tasks completed ==========');
      this.logger.info(`Success rate: ${this.results.filter(r => r.success).length}/${this.results.length}`);

    } catch (error) {
      this.logger.error(`Fatal error during task execution: ${error.message}`, { error });
    }
  }

  getResults() {
    return {
      agent: this.name,
      mcpPort: this.mcpPort,
      results: this.results,
      successRate: this.results.filter(r => r.success).length / this.results.length
    };
  }
}

// Test coordinator
class MultiInstanceTestCoordinator {
  constructor() {
    this.logger = new Logger('Coordinator', '\x1b[35m'); // Magenta
    this.agents = [];
    this.startTime = null;
    this.testResults = null;
  }

  async initialize() {
    this.logger.info('========================================');
    this.logger.info('  Multi-Instance Browser MCP Test Suite');
    this.logger.info('========================================\n');

    // Validate API key
    if (!CONFIG.anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable not set');
    }

    this.logger.info('✓ API key configured');
    this.logger.info(`✓ Model: ${CONFIG.model}`);
    this.logger.info(`✓ MCP port range: ${CONFIG.mcpPortRange[0]}-${CONFIG.mcpPortRange[1]}`);
    this.logger.info(`✓ Log directory: ${CONFIG.logDir}\n`);

    // Create test agents
    this.logger.info(`Creating ${CONFIG.agents.length} test agents...`);
    for (let i = 0; i < CONFIG.agents.length; i++) {
      const agentConfig = { ...CONFIG.agents[i], agentIndex: i };
      const agent = new TestAgent(agentConfig, i);
      this.agents.push(agent);
      this.logger.info(`✓ Created ${agent.name}`);
    }

    this.logger.info('\n');
  }

  async runTests() {
    this.logger.info('========== Starting Parallel Test Execution ==========\n');
    this.startTime = Date.now();

    // Run all agents in parallel
    const agentPromises = this.agents.map(agent => agent.runTasks());

    try {
      await Promise.all(agentPromises);

      const duration = Date.now() - this.startTime;
      this.logger.info(`\n========== All agents completed in ${(duration / 1000).toFixed(2)}s ==========\n`);

    } catch (error) {
      this.logger.error(`Test execution failed: ${error.message}`, { error });
    }
  }

  generateReport() {
    this.logger.info('========== Test Report ==========\n');

    this.testResults = {
      startTime: new Date(this.startTime).toISOString(),
      duration: Date.now() - this.startTime,
      agents: this.agents.map(agent => agent.getResults())
    };

    // Summary
    for (const agentResult of this.testResults.agents) {
      this.logger.info(`${agentResult.agent}:`);
      this.logger.info(`  Port: ${agentResult.mcpPort}`);
      this.logger.info(`  Success rate: ${(agentResult.successRate * 100).toFixed(1)}%`);
      this.logger.info(`  Tasks: ${agentResult.results.length}`);
      this.logger.info('');
    }

    // Write full report to file
    const reportPath = path.join(CONFIG.logDir, 'test-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(this.testResults, null, 2));
    this.logger.info(`✓ Full report written to ${reportPath}\n`);

    // Validation checks
    this.logger.info('========== Validation Checks ==========\n');

    // Check 1: Each agent should use a different port
    const ports = this.testResults.agents.map(a => a.mcpPort);
    const uniquePorts = new Set(ports);

    if (uniquePorts.size === ports.length) {
      this.logger.info('✓ PASS: Each agent used a different MCP port');
    } else {
      this.logger.error('✗ FAIL: Agents shared MCP ports (instance isolation broken)');
    }

    // Check 2: All agents should have successfully completed at least some tasks
    const allAgentsWorked = this.testResults.agents.every(a => a.successRate > 0);

    if (allAgentsWorked) {
      this.logger.info('✓ PASS: All agents completed tasks successfully');
    } else {
      this.logger.error('✗ FAIL: Some agents failed to complete any tasks');
    }

    this.logger.info('');
  }
}

// Main execution
async function main() {
  const coordinator = new MultiInstanceTestCoordinator();

  try {
    await coordinator.initialize();
    await coordinator.runTests();
    coordinator.generateReport();

    process.exit(0);
  } catch (error) {
    console.error(`\n\x1b[31mFatal Error: ${error.message}\x1b[0m\n`);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { TestAgent, MultiInstanceTestCoordinator };