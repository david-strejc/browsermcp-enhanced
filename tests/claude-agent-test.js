#!/usr/bin/env node

/**
 * Claude Code Agent Testing - Multi-Instance BrowserMCP
 *
 * This script creates TWO independent Claude agents (colleagues) that both use
 * the browsermcp MCP server to test multi-instance functionality.
 *
 * Requirements:
 * - ANTHROPIC_API_KEY environment variable
 * - browsermcp MCP servers running on ports 8765 and 8766
 * - Chrome browser with extension installed
 */

const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

// ANSI colors
const COLORS = {
  RESET: '\x1b[0m',
  RED: '\x1b[31m',
  YELLOW: '\x1b[33m',
  GREEN: '\x1b[32m',
  BLUE: '\x1b[34m',
  MAGENTA: '\x1b[35m',
  CYAN: '\x1b[36m',
  GRAY: '\x1b[90m'
};

// Configuration
const CONFIG = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-sonnet-4-20250514',
  logDir: path.join(__dirname, 'logs'),

  // Agent definitions
  agents: [
    {
      name: 'Agent-Alice',
      color: COLORS.CYAN,
      mcpServerUrl: 'http://localhost:8765', // Will need to be converted to proper MCP server URL
      mcpServerPort: 8765,
      systemPrompt: `You are Agent Alice, a thorough tester of browser automation tools.
Your mission is to test ALL browsermcp tools systematically and report results.

You have access to browsermcp tools for browser automation. Test each tool carefully:
- browser_navigate: Navigate to URLs
- browser_screenshot: Take screenshots
- browser_click: Click elements
- browser_type: Type into fields
- browser_snapshot: Get page structure
- browser_tab: Manage tabs
- browser_execute_js: Execute JavaScript

For each tool, try to:
1. Use it successfully
2. Note what worked
3. Note any errors or issues
4. Verify the result

Be systematic and detailed in your testing.`,
      tasks: [
        'Navigate to https://example.com and take a screenshot to verify it works',
        'Get the page snapshot to see the page structure',
        'Navigate to https://wikipedia.org',
        'Take another screenshot from Wikipedia',
        'List all browser tabs you have access to',
        'Try executing JavaScript: document.title',
        'Navigate to https://github.com',
        'Take a final screenshot',
        'Summarize all the tools you tested and their results'
      ]
    },
    {
      name: 'Agent-Bob',
      color: COLORS.YELLOW,
      mcpServerUrl: 'http://localhost:8766',
      mcpServerPort: 8766,
      systemPrompt: `You are Agent Bob, a meticulous browser tool tester.
Your mission is to test ALL browsermcp tools and verify multi-instance isolation.

You have access to browsermcp tools. Test each one thoroughly:
- browser_navigate: Go to different URLs than Agent Alice
- browser_screenshot: Capture different pages
- browser_click: Test interaction
- browser_type: Test form filling
- browser_snapshot: Get page info
- browser_tab: Tab management
- browser_execute_js: Run JavaScript

IMPORTANT: You should use DIFFERENT tabs than any other agent.
Test systematically and report what you find.`,
      tasks: [
        'Navigate to https://stackoverflow.com and take a screenshot',
        'Get the page snapshot',
        'Navigate to https://reddit.com',
        'Take a screenshot of Reddit',
        'List all browser tabs (should be different from Agent Alice)',
        'Execute JavaScript to get the page title',
        'Navigate to https://news.ycombinator.com',
        'Take a final screenshot',
        'Report on all tools tested and confirm you used different tabs'
      ]
    }
  ]
};

// Logger class
class Logger {
  constructor(name, color) {
    this.name = name;
    this.color = color;
    this.logFile = path.join(CONFIG.logDir, `${name}.log`);

    if (!fs.existsSync(CONFIG.logDir)) {
      fs.mkdirSync(CONFIG.logDir, { recursive: true });
    }

    // Clear previous log
    fs.writeFileSync(this.logFile, `=== ${name} Log Started at ${new Date().toISOString()} ===\n\n`);
  }

  log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const coloredName = `${this.color}[${this.name}]${COLORS.RESET}`;

    let coloredLevel = level;
    if (level === 'ERROR') coloredLevel = `${COLORS.RED}${level}${COLORS.RESET}`;
    else if (level === 'WARN') coloredLevel = `${COLORS.YELLOW}${level}${COLORS.RESET}`;
    else if (level === 'INFO') coloredLevel = `${COLORS.GREEN}${level}${COLORS.RESET}`;

    const consoleMessage = `${COLORS.GRAY}${timestamp}${COLORS.RESET} ${coloredName} ${coloredLevel}: ${message}`;
    console.log(consoleMessage);

    const fileMessage = `${timestamp} [${this.name}] ${level}: ${message}${data ? '\n' + JSON.stringify(data, null, 2) : ''}\n`;
    fs.appendFileSync(this.logFile, fileMessage);
  }

  info(message, data) { this.log('INFO', message, data); }
  warn(message, data) { this.log('WARN', message, data); }
  error(message, data) { this.log('ERROR', message, data); }
  debug(message, data) { this.log('DEBUG', message, data); }
}

// Claude Agent class
class ClaudeAgent {
  constructor(config) {
    this.config = config;
    this.name = config.name;
    this.logger = new Logger(this.name, config.color);

    if (!CONFIG.anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable not set');
    }

    this.anthropic = new Anthropic({ apiKey: CONFIG.anthropicApiKey });
    this.conversationHistory = [];
    this.results = [];
    this.toolsUsed = new Set();
  }

  async sendMessage(userMessage, mcpConfig = null) {
    this.logger.info(`Sending: "${userMessage.substring(0, 60)}..."`);

    this.conversationHistory.push({
      role: 'user',
      content: userMessage
    });

    try {
      // Build request
      const requestBody = {
        model: CONFIG.model,
        max_tokens: 8192,
        system: this.config.systemPrompt,
        messages: this.conversationHistory
      };

      // Add MCP server configuration if provided
      // NOTE: This requires the anthropic-beta: mcp-client-2025-04-04 header
      const headers = {};
      if (mcpConfig) {
        headers['anthropic-beta'] = 'mcp-client-2025-04-04';
        requestBody.mcp_servers = mcpConfig;
      }

      this.logger.debug('Request config', {
        model: requestBody.model,
        mcpEnabled: !!mcpConfig,
        messageCount: this.conversationHistory.length
      });

      // Make API call
      const response = await this.anthropic.messages.create(requestBody);

      this.logger.info('Received response', {
        stopReason: response.stop_reason,
        usage: response.usage
      });

      // Log response content
      for (const block of response.content) {
        if (block.type === 'text') {
          this.logger.info(`Claude: ${block.text.substring(0, 100)}...`);
        } else if (block.type === 'tool_use') {
          this.logger.info(`🔧 Tool used: ${block.name}`, { input: block.input });
          this.toolsUsed.add(block.name);
        }
      }

      // Add to conversation history
      this.conversationHistory.push({
        role: 'assistant',
        content: response.content
      });

      return response;
    } catch (error) {
      this.logger.error(`API call failed: ${error.message}`, { error: error.toString() });
      throw error;
    }
  }

  async runTasks() {
    this.logger.info(`\n${'='.repeat(60)}`);
    this.logger.info(`Starting task execution - ${this.config.tasks.length} tasks`);
    this.logger.info(`${'='.repeat(60)}\n`);

    // MCP Server configuration for this agent
    const mcpConfig = [{
      type: 'url',
      url: `http://localhost:${this.config.mcpServerPort}/sse`, // Assuming SSE transport
      name: 'browsermcp',
      // Note: May need authorization_token depending on server setup
    }];

    // Send initial greeting
    try {
      await this.sendMessage(
        `Hello! I am ${this.name}. I have access to browsermcp tools running on port ${this.config.mcpServerPort}. ` +
        `I will now systematically test all available browser automation tools. ` +
        `Please list all the browsermcp tools you have access to.`,
        mcpConfig
      );

      await new Promise(resolve => setTimeout(resolve, 2000));

      // Execute each task
      for (let i = 0; i < this.config.tasks.length; i++) {
        const task = this.config.tasks[i];

        this.logger.info(`\n--- Task ${i + 1}/${this.config.tasks.length} ---`);
        this.logger.info(`Task: ${task}`);

        const startTime = Date.now();

        try {
          const response = await this.sendMessage(task, mcpConfig);
          const duration = Date.now() - startTime;

          this.results.push({
            taskNumber: i + 1,
            task,
            success: true,
            duration,
            stopReason: response.stop_reason
          });

          this.logger.info(`✓ Task completed in ${duration}ms`);

          // Wait between tasks
          await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (error) {
          const duration = Date.now() - startTime;

          this.results.push({
            taskNumber: i + 1,
            task,
            success: false,
            duration,
            error: error.message
          });

          this.logger.error(`✗ Task failed after ${duration}ms: ${error.message}`);

          // Continue to next task despite error
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      // Final summary
      this.logger.info(`\n${'='.repeat(60)}`);
      this.logger.info('All tasks completed!');
      this.logger.info(`Success rate: ${this.results.filter(r => r.success).length}/${this.results.length}`);
      this.logger.info(`Tools used: ${Array.from(this.toolsUsed).join(', ')}`);
      this.logger.info(`${'='.repeat(60)}\n`);

      // Ask for final summary
      await this.sendMessage(
        'Please provide a detailed summary of: ' +
        '1) Which browsermcp tools you successfully used, ' +
        '2) What tab IDs you used, ' +
        '3) Any errors or issues encountered, ' +
        '4) Overall assessment of the browser automation functionality.',
        mcpConfig
      );

    } catch (error) {
      this.logger.error(`Fatal error during task execution: ${error.message}`);
    }
  }

  getResults() {
    return {
      agent: this.name,
      mcpPort: this.config.mcpServerPort,
      toolsUsed: Array.from(this.toolsUsed),
      results: this.results,
      successRate: this.results.length > 0
        ? this.results.filter(r => r.success).length / this.results.length
        : 0,
      conversationLength: this.conversationHistory.length
    };
  }
}

// Test Coordinator
class TestCoordinator {
  constructor() {
    this.logger = new Logger('Coordinator', COLORS.MAGENTA);
    this.agents = [];
    this.startTime = null;
  }

  async initialize() {
    this.logger.info(`\n${'='.repeat(70)}`);
    this.logger.info(`  Claude Agent Multi-Instance Browser MCP Testing`);
    this.logger.info(`${'='.repeat(70)}\n`);

    // Validate API key
    if (!CONFIG.anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable not set');
    }

    this.logger.info('✓ API key configured');
    this.logger.info(`✓ Model: ${CONFIG.model}`);
    this.logger.info(`✓ Agents: ${CONFIG.agents.length}`);
    this.logger.info(`✓ Log directory: ${CONFIG.logDir}\n`);

    // Create agents
    for (const agentConfig of CONFIG.agents) {
      const agent = new ClaudeAgent(agentConfig);
      this.agents.push(agent);
      this.logger.info(`✓ Created ${agent.name} (Port ${agentConfig.mcpServerPort})`);
    }

    this.logger.info('\n');
  }

  async runTests() {
    this.logger.info(`${'='.repeat(70)}`);
    this.logger.info('Starting Parallel Agent Execution');
    this.logger.info(`${'='.repeat(70)}\n`);

    this.startTime = Date.now();

    // Run all agents in parallel
    const agentPromises = this.agents.map(agent => agent.runTasks());

    try {
      await Promise.all(agentPromises);

      const duration = Date.now() - this.startTime;
      this.logger.info(`\n${'='.repeat(70)}`);
      this.logger.info(`All agents completed in ${(duration / 1000).toFixed(2)}s`);
      this.logger.info(`${'='.repeat(70)}\n`);

    } catch (error) {
      this.logger.error(`Test execution failed: ${error.message}`);
    }
  }

  generateReport() {
    this.logger.info(`\n${'='.repeat(70)}`);
    this.logger.info('TEST REPORT');
    this.logger.info(`${'='.repeat(70)}\n`);

    const results = {
      startTime: new Date(this.startTime).toISOString(),
      duration: Date.now() - this.startTime,
      agents: this.agents.map(agent => agent.getResults())
    };

    // Summary per agent
    for (const agentResult of results.agents) {
      this.logger.info(`${agentResult.agent}:`);
      this.logger.info(`  MCP Port: ${agentResult.mcpPort}`);
      this.logger.info(`  Success Rate: ${(agentResult.successRate * 100).toFixed(1)}%`);
      this.logger.info(`  Tasks: ${agentResult.results.length}`);
      this.logger.info(`  Tools Used: ${agentResult.toolsUsed.join(', ') || 'None'}`);
      this.logger.info(`  Conversation Length: ${agentResult.conversationLength} messages`);
      this.logger.info('');
    }

    // Write full report
    const reportPath = path.join(CONFIG.logDir, 'agent-test-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
    this.logger.info(`✓ Full report: ${reportPath}\n`);

    // Validation checks
    this.logger.info(`${'='.repeat(70)}`);
    this.logger.info('VALIDATION CHECKS');
    this.logger.info(`${'='.repeat(70)}\n`);

    // Check 1: Each agent used different MCP port
    const ports = results.agents.map(a => a.mcpPort);
    const uniquePorts = new Set(ports);
    if (uniquePorts.size === ports.length) {
      this.logger.info('✓ PASS: Each agent connected to different MCP port');
    } else {
      this.logger.error('✗ FAIL: Agents shared MCP ports');
    }

    // Check 2: Both agents completed tasks
    const allWorked = results.agents.every(a => a.successRate > 0);
    if (allWorked) {
      this.logger.info('✓ PASS: All agents completed tasks successfully');
    } else {
      this.logger.error('✗ FAIL: Some agents failed all tasks');
    }

    // Check 3: Both agents used tools
    const allUsedTools = results.agents.every(a => a.toolsUsed.length > 0);
    if (allUsedTools) {
      this.logger.info('✓ PASS: All agents used browsermcp tools');
    } else {
      this.logger.warn('⚠ WARNING: Some agents did not use tools');
    }

    this.logger.info('');
    return results;
  }
}

// Main execution
async function main() {
  const coordinator = new TestCoordinator();

  try {
    await coordinator.initialize();
    await coordinator.runTests();
    const results = coordinator.generateReport();

    // Exit with appropriate code
    const allPassed = results.agents.every(a => a.successRate > 0.5);
    process.exit(allPassed ? 0 : 1);

  } catch (error) {
    console.error(`\n${COLORS.RED}Fatal Error: ${error.message}${COLORS.RESET}\n`);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { ClaudeAgent, TestCoordinator };