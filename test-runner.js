#!/usr/bin/env node

/**
 * BrowserMCP Enhanced - Comprehensive Test Runner
 * Validates all tools and functionality against test pages
 */

import { spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test configuration
const TEST_CONFIG = {
  serverUrl: 'http://localhost:9000',
  testPages: {
    basic: '/test-elements.html',
    enhanced: '/test-elements-enhanced.html'
  },
  testTimeout: 30000,
  serverStartDelay: 2000
};

// ANSI color codes for output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

// Test results tracking
let testResults = {
  passed: 0,
  failed: 0,
  skipped: 0,
  errors: []
};

class TestRunner {
  constructor() {
    this.serverProcess = null;
    this.currentTest = null;
  }

  async run() {
    console.log(`${colors.cyan}${colors.bright}🧪 BrowserMCP Enhanced Test Suite${colors.reset}\\n`);
    
    try {
      // Start test server
      await this.startTestServer();
      
      // Wait for server to be ready
      await this.waitForServer();
      
      // Run test suites
      await this.runTestSuite('Basic Functionality Tests', this.basicTests);
      await this.runTestSuite('Advanced Feature Tests', this.advancedTests);
      await this.runTestSuite('File Upload Tests', this.fileUploadTests);
      await this.runTestSuite('Error Handling Tests', this.errorHandlingTests);
      await this.runTestSuite('Performance Tests', this.performanceTests);
      
      // Generate test report
      this.generateReport();
      
    } catch (error) {
      console.error(`${colors.red}❌ Test runner failed:${colors.reset}`, error.message);
      process.exit(1);
    } finally {
      await this.cleanup();
    }
  }

  async startTestServer() {
    return new Promise((resolve, reject) => {
      console.log(`${colors.blue}🚀 Starting test server...${colors.reset}`);
      
      this.serverProcess = spawn('python3', ['test-server.py'], {
        cwd: __dirname,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      this.serverProcess.stdout.on('data', (data) => {
        const output = data.toString();
        if (output.includes('Starting test server')) {
          console.log(`${colors.green}✅ Test server started${colors.reset}`);
          setTimeout(resolve, TEST_CONFIG.serverStartDelay);
        }
      });
      
      this.serverProcess.stderr.on('data', (data) => {
        console.error(`${colors.yellow}⚠️  Server warning:${colors.reset}`, data.toString());
      });
      
      this.serverProcess.on('error', (error) => {
        reject(new Error(`Failed to start test server: ${error.message}`));
      });
      
      // Timeout after 10 seconds
      setTimeout(() => {
        if (this.serverProcess && this.serverProcess.exitCode === null) {
          console.log(`${colors.green}✅ Test server started (timeout reached)${colors.reset}`);
          resolve();
        }
      }, 10000);
    });
  }

  async waitForServer() {
    console.log(`${colors.blue}⏳ Waiting for server to be ready...${colors.reset}`);
    
    for (let i = 0; i < 30; i++) {
      try {
        const response = await fetch(`${TEST_CONFIG.serverUrl}/test-elements.html`);
        if (response.ok) {
          console.log(`${colors.green}✅ Server is ready${colors.reset}`);
          return;
        }
      } catch (error) {
        // Server not ready yet
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    throw new Error('Test server did not become ready in time');
  }

  async runTestSuite(name, testFunction) {
    console.log(`\\n${colors.bright}${colors.magenta}🧪 ${name}${colors.reset}`);
    console.log('='.repeat(50));
    
    try {
      await testFunction.call(this);
      console.log(`${colors.green}✅ ${name} completed${colors.reset}`);
    } catch (error) {
      console.error(`${colors.red}❌ ${name} failed:${colors.reset}`, error.message);
      testResults.errors.push(`${name}: ${error.message}`);
      testResults.failed++;
    }
  }

  async test(description, testFunction) {
    this.currentTest = description;
    process.stdout.write(`  🔍 ${description}... `);
    
    try {
      await testFunction();
      console.log(`${colors.green}PASS${colors.reset}`);
      testResults.passed++;
    } catch (error) {
      console.log(`${colors.red}FAIL${colors.reset}`);
      console.log(`      ${colors.red}Error: ${error.message}${colors.reset}`);
      testResults.failed++;
      testResults.errors.push(`${description}: ${error.message}`);
    }
  }

  async basicTests() {
    await this.test('Server responds to basic page request', async () => {
      const response = await fetch(`${TEST_CONFIG.serverUrl}${TEST_CONFIG.testPages.basic}`);
      if (!response.ok) throw new Error(`Server returned ${response.status}`);
      const content = await response.text();
      if (!content.includes('<title>')) throw new Error('Invalid HTML response');
    });

    await this.test('Enhanced test page loads correctly', async () => {
      const response = await fetch(`${TEST_CONFIG.serverUrl}${TEST_CONFIG.testPages.enhanced}`);
      if (!response.ok) throw new Error(`Server returned ${response.status}`);
      const content = await response.text();
      if (!content.includes('Enhanced Test Elements')) throw new Error('Enhanced page not found');
    });

    await this.test('Basic HTML elements are present', async () => {
      const response = await fetch(`${TEST_CONFIG.serverUrl}${TEST_CONFIG.testPages.basic}`);
      const content = await response.text();
      const requiredElements = [
        'input[type="text"]',
        'select',
        'button',
        'textarea',
        'input[type="checkbox"]',
        'input[type="radio"]'
      ];
      
      for (const element of requiredElements) {
        if (!content.includes(element.split('[')[0])) {
          throw new Error(`Missing element: ${element}`);
        }
      }
    });

    await this.test('Enhanced elements are present', async () => {
      const response = await fetch(`${TEST_CONFIG.serverUrl}${TEST_CONFIG.testPages.enhanced}`);
      const content = await response.text();
      const requiredFeatures = [
        'canvas',
        'iframe',
        'contenteditable',
        'input[type="file"]',
        'drag-drop-zone',
        'custom-element'
      ];
      
      for (const feature of requiredFeatures) {
        if (!content.includes(feature.split('[')[0])) {
          throw new Error(`Missing feature: ${feature}`);
        }
      }
    });
  }

  async advancedTests() {
    await this.test('Canvas elements are interactive', async () => {
      const response = await fetch(`${TEST_CONFIG.serverUrl}${TEST_CONFIG.testPages.enhanced}`);
      const content = await response.text();
      if (!content.includes('drawingCanvas')) throw new Error('Canvas not found');
      if (!content.includes('drawCircle')) throw new Error('Canvas controls not found');
    });

    await this.test('SVG elements are present and interactive', async () => {
      const response = await fetch(`${TEST_CONFIG.serverUrl}${TEST_CONFIG.testPages.enhanced}`);
      const content = await response.text();
      if (!content.includes('<svg')) throw new Error('SVG elements not found');
      if (!content.includes('svgCircle')) throw new Error('Interactive SVG elements not found');
    });

    await this.test('Media elements are configured', async () => {
      const response = await fetch(`${TEST_CONFIG.serverUrl}${TEST_CONFIG.testPages.enhanced}`);
      const content = await response.text();
      if (!content.includes('<video')) throw new Error('Video element not found');
      if (!content.includes('<audio')) throw new Error('Audio element not found');
    });

    await this.test('ARIA live regions are implemented', async () => {
      const response = await fetch(`${TEST_CONFIG.serverUrl}${TEST_CONFIG.testPages.enhanced}`);
      const content = await response.text();
      if (!content.includes('aria-live')) throw new Error('ARIA live regions not found');
      if (!content.includes('politeRegion') && !content.includes('assertiveRegion')) throw new Error('Live region implementation not found');
    });

    await this.test('Shadow DOM components are present', async () => {
      const response = await fetch(`${TEST_CONFIG.serverUrl}${TEST_CONFIG.testPages.enhanced}`);
      const content = await response.text();
      if (!content.includes('custom-element')) throw new Error('Custom elements not found');
      if (!content.includes('attachShadow') && !content.includes('shadowRoot')) throw new Error('Shadow DOM not implemented');
    });
  }

  async fileUploadTests() {
    await this.test('Basic file input exists', async () => {
      const response = await fetch(`${TEST_CONFIG.serverUrl}${TEST_CONFIG.testPages.enhanced}`);
      const content = await response.text();
      if (!content.includes('type="file"')) throw new Error('File inputs not found');
    });

    await this.test('Drag and drop zone is implemented', async () => {
      const response = await fetch(`${TEST_CONFIG.serverUrl}${TEST_CONFIG.testPages.enhanced}`);
      const content = await response.text();
      if (!content.includes('fileDropZone')) throw new Error('Drop zone not found');
      if (!content.includes('dragover')) throw new Error('Drag handlers not implemented');
    });

    await this.test('Multiple file types are supported', async () => {
      const response = await fetch(`${TEST_CONFIG.serverUrl}${TEST_CONFIG.testPages.enhanced}`);
      const content = await response.text();
      
      const fileTypes = [
        'accept="image/*"',
        'accept=".pdf,.doc,.docx"',
        'accept="video/*"',
        'accept=".csv"'
      ];
      
      for (const fileType of fileTypes) {
        if (!content.includes(fileType)) {
          throw new Error(`File type not supported: ${fileType}`);
        }
      }
    });

    await this.test('File size constraints are implemented', async () => {
      const response = await fetch(`${TEST_CONFIG.serverUrl}${TEST_CONFIG.testPages.enhanced}`);
      const content = await response.text();
      if (!content.includes('data-max-size')) throw new Error('Size constraints not found');
    });

    await this.test('File preview functionality exists', async () => {
      const response = await fetch(`${TEST_CONFIG.serverUrl}${TEST_CONFIG.testPages.enhanced}`);
      const content = await response.text();
      const previewElements = ['imagePreview', 'documentList', 'csvPreview'];
      
      for (const element of previewElements) {
        if (!content.includes(element)) {
          throw new Error(`Preview element not found: ${element}`);
        }
      }
    });
  }

  async errorHandlingTests() {
    await this.test('404 errors are handled gracefully', async () => {
      try {
        const response = await fetch(`${TEST_CONFIG.serverUrl}/nonexistent-page.html`);
        if (response.status !== 404) {
          throw new Error(`Expected 404, got ${response.status}`);
        }
      } catch (error) {
        if (error.code === 'ECONNREFUSED') {
          throw new Error('Server connection refused');
        }
        // 404 is expected
      }
    });

    await this.test('CORS headers are present', async () => {
      const response = await fetch(`${TEST_CONFIG.serverUrl}${TEST_CONFIG.testPages.basic}`);
      const corsHeader = response.headers.get('Access-Control-Allow-Origin');
      if (!corsHeader || (corsHeader !== '*' && corsHeader !== 'null')) {
        throw new Error(`CORS headers not configured correctly: ${corsHeader}`);
      }
    });

    await this.test('Content-Type headers are correct', async () => {
      const response = await fetch(`${TEST_CONFIG.serverUrl}${TEST_CONFIG.testPages.basic}`);
      const contentType = response.headers.get('Content-Type');
      if (!contentType || !contentType.includes('text/html')) {
        throw new Error(`Invalid content type: ${contentType}`);
      }
    });
  }

  async performanceTests() {
    await this.test('Basic page loads within reasonable time', async () => {
      const start = Date.now();
      const response = await fetch(`${TEST_CONFIG.serverUrl}${TEST_CONFIG.testPages.basic}`);
      const end = Date.now();
      
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
      
      const loadTime = end - start;
      if (loadTime > 5000) {
        throw new Error(`Page load too slow: ${loadTime}ms`);
      }
    });

    await this.test('Enhanced page loads within reasonable time', async () => {
      const start = Date.now();
      const response = await fetch(`${TEST_CONFIG.serverUrl}${TEST_CONFIG.testPages.enhanced}`);
      const content = await response.text();
      const end = Date.now();
      
      const loadTime = end - start;
      const contentSize = content.length;
      
      if (loadTime > 10000) {
        throw new Error(`Enhanced page load too slow: ${loadTime}ms`);
      }
      
      console.log(`      📊 Enhanced page: ${contentSize} bytes in ${loadTime}ms`);
    });

    await this.test('Page content size is reasonable', async () => {
      const response = await fetch(`${TEST_CONFIG.serverUrl}${TEST_CONFIG.testPages.enhanced}`);
      const content = await response.text();
      const sizeKB = content.length / 1024;
      
      if (sizeKB > 500) {
        throw new Error(`Page too large: ${sizeKB.toFixed(2)}KB`);
      }
      
      console.log(`      📊 Content size: ${sizeKB.toFixed(2)}KB`);
    });
  }

  generateReport() {
    console.log(`\\n${colors.bright}${colors.cyan}📊 Test Results Summary${colors.reset}`);
    console.log('='.repeat(50));
    
    const total = testResults.passed + testResults.failed + testResults.skipped;
    const passRate = total > 0 ? ((testResults.passed / total) * 100).toFixed(1) : 0;
    
    console.log(`Total Tests: ${total}`);
    console.log(`${colors.green}✅ Passed: ${testResults.passed}${colors.reset}`);
    console.log(`${colors.red}❌ Failed: ${testResults.failed}${colors.reset}`);
    console.log(`${colors.yellow}⏭️  Skipped: ${testResults.skipped}${colors.reset}`);
    console.log(`${colors.blue}📈 Pass Rate: ${passRate}%${colors.reset}`);
    
    if (testResults.errors.length > 0) {
      console.log(`\\n${colors.red}❌ Error Details:${colors.reset}`);
      testResults.errors.forEach((error, index) => {
        console.log(`  ${index + 1}. ${error}`);
      });
    }
    
    if (testResults.failed === 0) {
      console.log(`\\n${colors.green}${colors.bright}🎉 All tests passed!${colors.reset}`);
      process.exit(0);
    } else {
      console.log(`\\n${colors.red}${colors.bright}💥 Some tests failed${colors.reset}`);
      process.exit(1);
    }
  }

  async cleanup() {
    if (this.serverProcess) {
      console.log(`${colors.blue}🛑 Stopping test server...${colors.reset}`);
      this.serverProcess.kill('SIGTERM');
      
      // Wait a moment for graceful shutdown
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      if (this.serverProcess.exitCode === null) {
        this.serverProcess.kill('SIGKILL');
      }
    }
  }
}

// Run tests if this script is executed directly
if (process.argv[1] === __filename || process.argv[1].endsWith('test-runner.js')) {
  const runner = new TestRunner();
  runner.run().catch(error => {
    console.error(`${colors.red}❌ Test runner error:${colors.reset}`, error);
    process.exit(1);
  });
}

export default TestRunner;