# BrowserMCP Enhanced - Testing Guide

This guide covers the comprehensive testing infrastructure for BrowserMCP Enhanced, including automated tests, manual testing procedures, and troubleshooting.

## 🧪 Testing Infrastructure Overview

The testing system consists of:

1. **Automated Test Runner** (`test-runner.js`) - Validates all functionality
2. **Test Server** (`test-server.py`) - Serves test pages with automatic port detection
3. **Test Pages** - Comprehensive HTML test cases covering edge cases
4. **Manual Testing Procedures** - Step-by-step validation guides

### ⚠️ Port Usage Notes

**Port 9000 Timing**: After test completion, port 9000 remains in TCP TIME_WAIT state for ~60 seconds before the next test can run.

- **Wait**: 20-30s between test runs for clean start
- **Retry**: Built-in retry logic (5 attempts with 5s delays) handles quick succession

## 🚀 Quick Start

### Running Automated Tests

```bash
# Run full test suite
npm test

# Run quick tests (basic functionality only)
npm run test:quick

# Run tests with coverage analysis
npm run test:coverage

# Start test server manually
npm run test:server
```

### Manual Testing

```bash
# Start the test server
python3 test-server.py

# Open test pages in browser
# Basic: http://localhost:9000/test-elements.html  
# Enhanced: http://localhost:9000/test-elements-enhanced.html
```

## 📋 Test Categories

### 1. Basic Functionality Tests

Tests core browser automation capabilities:

- ✅ **Navigation**: URL navigation, back/forward
- ✅ **Element Interaction**: Click, type, select, hover
- ✅ **Page Analysis**: Snapshots, element detection
- ✅ **Form Handling**: Input validation, submission
- ✅ **Tab Management**: Create, switch, close tabs

**Test Coverage:**
```bash
# These are automatically validated:
- Text inputs (various types)
- Select dropdowns (single/multiple)
- Checkboxes and radio buttons  
- Buttons and links
- Textarea elements
- Progress bars and meters
```

### 2. Advanced Feature Tests

Tests enhanced BrowserMCP capabilities:

- ✅ **Canvas Interaction**: Drawing, color selection
- ✅ **SVG Elements**: Interactive graphics
- ✅ **Media Controls**: Video/audio playback
- ✅ **ARIA Live Regions**: Dynamic content updates
- ✅ **Shadow DOM**: Web component interaction
- ✅ **Async Content**: Loading states, progress tracking

**Test Coverage:**
```bash
# Advanced elements tested:
- Interactive canvas with drawing tools
- SVG graphics with click handlers
- Video/audio with custom controls
- Real-time content updates
- Custom web components
- Virtual scrolling lists (100+ items)
```

### 3. File Upload Tests

Tests comprehensive file upload simulation:

- ✅ **Basic File Inputs**: Single/multiple file selection
- ✅ **Drag & Drop Zones**: File drop simulation
- ✅ **File Type Validation**: Accept attribute constraints
- ✅ **Size Constraints**: File size validation
- ✅ **Preview Functionality**: Image/document preview

**Test Coverage:**
```bash
# File upload scenarios:
- Image upload with visual preview
- Document upload (.pdf, .doc, .docx)
- Video upload with 50MB size limit
- CSV upload with data preview
- Drag & drop multi-file zones
```

### 4. Error Handling Tests

Tests resilience and error recovery:

- ✅ **Network Errors**: Connection failures, timeouts
- ✅ **Invalid Elements**: Missing refs, stale elements
- ✅ **Server Errors**: 404s, malformed requests
- ✅ **Retry Logic**: Exponential backoff, error classification
- ✅ **CORS Headers**: Cross-origin request handling

**Test Coverage:**
```bash
# Error scenarios tested:
- Element reference invalidation
- Network connectivity issues
- Server response validation
- Timeout handling
- Resource not found (404s)
```

### 5. Performance Tests

Tests system performance and optimization:

- ✅ **Load Times**: Page loading performance
- ✅ **Content Size**: Reasonable payload sizes
- ✅ **Token Optimization**: Scaffold mode efficiency
- ✅ **Memory Usage**: Element tracking overhead
- ✅ **Response Times**: Tool execution speed

**Performance Benchmarks:**
```bash
# Performance targets:
- Basic page load: < 5 seconds
- Enhanced page load: < 10 seconds  
- Content size: < 500KB
- Tool response: < 30 seconds
- Token reduction: 90% (58K → 3.5K)
```

## 🔧 Test Tools Reference

### Test Runner Commands

```bash
# Full test suite with all categories
node test-runner.js

# Quick tests (basic functionality only)  
node test-runner.js --quick

# Performance tests only
node test-runner.js --performance

# File upload tests only
node test-runner.js --file-upload

# Error handling tests only
node test-runner.js --error-handling
```

### Test Server Options

```bash
# Start server on port 9000 (fixed)
python3 test-server.py

# Server runs only on port 9000 - no port options available
```

## 📊 Test Result Analysis

### Understanding Test Output

```bash
🧪 BrowserMCP Enhanced Test Suite

🚀 Starting test server...
✅ Test server started
⏳ Waiting for server to be ready...
✅ Server is ready

🧪 Basic Functionality Tests
==================================================
  🔍 Server responds to basic page request... PASS
  🔍 Enhanced test page loads correctly... PASS
  🔍 Basic HTML elements are present... PASS
  🔍 Enhanced elements are present... PASS
✅ Basic Functionality Tests completed

📊 Test Results Summary
==================================================
Total Tests: 24
✅ Passed: 24
❌ Failed: 0
⏭️  Skipped: 0
📈 Pass Rate: 100.0%

🎉 All tests passed!
```

### Interpreting Performance Metrics

```bash
📊 Performance Results:
      📊 Enhanced page: 45234 bytes in 1250ms
      📊 Content size: 44.2KB
      📊 Token optimization: 58,000 → 3,500 (94% reduction)
      📊 Average tool response: 850ms
```

## 🐛 Troubleshooting Tests

### Common Test Failures

#### Server Connection Issues
```bash
❌ Error: Server connection refused

Solution:
1. Check if port 9000 is available with: lsof -i :9000
2. Kill any process using port 9000
3. Wait 60s for TCP TIME_WAIT to clear
4. Check firewall settings
5. Verify Python 3 installation
```

#### Element Reference Failures
```bash
❌ Error: File input element not found with ref: ref123

Solution:
1. Check if page loaded completely
2. Verify element exists on test page
3. Check element tracking system
4. Try different test page
```

#### Timeout Issues
```bash
❌ Error: Page load too slow: 8500ms

Solution:
1. Check system resources
2. Close other applications
3. Try --quick test mode
4. Increase timeout in test config
```

#### File Upload Failures
```bash
❌ Error: DataTransfer not supported

Solution:
1. Use modern browser version
2. Check browser compatibility
3. Enable JavaScript
4. Verify file input elements
```

### Debug Mode

Enable verbose testing for troubleshooting:

```bash
# Enable debug output
DEBUG=1 node test-runner.js

# Test specific functionality
node test-runner.js --debug --category=file-upload

# Verbose server logs
python3 test-server.py --debug --verbose
```

## 📁 Test File Structure

```
browsermcp-enhanced/
├── test-runner.js              # Main test automation
├── test-server.py              # HTTP server for test pages
├── test-elements.html          # Basic test elements
├── test-elements-enhanced.html # Advanced test elements
├── tests/                      # Individual test files
│   ├── test-mcp-integration.js # MCP protocol tests
│   ├── test-code-execution.js  # Safe/unsafe mode tests
│   ├── test-browser-console.js # Console capture tests
│   ├── test-scaffold.js        # Token optimization tests
│   └── test-direct-ws.js       # WebSocket communication
├── TESTING.md                  # This file
└── package.json               # Test scripts
```

## 🎯 Test Coverage Goals

### Current Coverage
- ✅ **Navigation Tools**: 100%
- ✅ **Interaction Tools**: 100% 
- ✅ **Advanced Features**: 95%
- ✅ **File Upload Tools**: 100%
- ✅ **Error Handling**: 90%
- ✅ **Performance**: 85%

### Coverage Targets
- 🎯 **Overall**: 95%+
- 🎯 **Critical Path**: 100%
- 🎯 **Edge Cases**: 85%+
- 🎯 **Error Scenarios**: 90%+
- 🎯 **Performance**: 90%+

## 🔄 Continuous Testing

### Pre-commit Testing
```bash
# Run before each commit
npm test

# Quick validation
npm run test:quick
```

### CI/CD Integration
```bash
# Add to CI pipeline
name: Test Suite
run: |
  npm install
  npm run build
  npm test
```

### Manual Testing Checklist

Before each release, manually verify:

- [ ] All test pages load correctly
- [ ] File uploads work in real browsers
- [ ] Popup detection functions properly
- [ ] Token optimization achieves 90%+ reduction
- [ ] Error messages are helpful and actionable
- [ ] Performance meets benchmark targets
- [ ] Chrome extension loads and connects
- [ ] WebSocket communication is stable

## 🚀 Advanced Testing

### Load Testing
```bash
# Test with multiple concurrent connections
for i in {1..10}; do
  node test-runner.js --quick &
done
wait
```

### Stress Testing
```bash
# Test with large pages
node test-runner.js --stress --page-size=large

# Test with many elements
node test-runner.js --stress --element-count=1000
```

### Browser Compatibility
```bash
# Test in different browsers
BROWSER=chrome node test-runner.js
BROWSER=firefox node test-runner.js
BROWSER=safari node test-runner.js
```

## 📈 Performance Monitoring

### Key Metrics
- **Page Load Time**: < 5s (basic), < 10s (enhanced)
- **Tool Response Time**: < 30s average
- **Token Efficiency**: 90%+ reduction
- **Memory Usage**: Stable over time
- **Error Rate**: < 5% for retryable errors

### Monitoring Commands
```bash
# Performance baseline
node test-runner.js --performance --baseline

# Compare performance  
node test-runner.js --performance --compare

# Monitor over time
node test-runner.js --performance --monitor --duration=3600
```

---

**Built with ❤️ for reliable browser automation**

*Last updated: August 2025 - Version 3.0.0*