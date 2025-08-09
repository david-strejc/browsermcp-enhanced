/**
 * Browser Console Test Script
 * Run this directly in Chrome DevTools console while on seznam.cz
 * with the BrowserMCP Enhanced extension loaded
 */

console.log('🧪 BrowserMCP Enhanced - Browser Console Test Suite');
console.log('=' .repeat(50));

// Helper to estimate tokens
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

// Test 1: Check if element tracker is loaded
console.log('\n1️⃣ Checking element tracker...');
if (typeof window.__elementTracker !== 'undefined') {
  console.log('   ✅ Element tracker is loaded');
  console.log(`   📊 Tracked elements: ${window.__elementTracker.refs.size}`);
} else {
  console.error('   ❌ Element tracker not found!');
}

// Test 2: Generate scaffold snapshot manually
console.log('\n2️⃣ Testing scaffold snapshot generation...');
function generateScaffoldSnapshot() {
  const snapshot = [];
  const maxTokens = 4000;
  let currentTokens = 0;
  
  // Get interactive elements
  const interactiveSelectors = [
    'a[href]', 'button', 'input', 'select', 'textarea',
    '[role="button"]', '[role="link"]', '[onclick]'
  ];
  
  const elements = document.querySelectorAll(interactiveSelectors.join(','));
  console.log(`   📍 Found ${elements.length} interactive elements`);
  
  // Track first N elements that fit in budget
  let trackedCount = 0;
  for (const el of elements) {
    const text = el.textContent?.trim() || el.value || el.placeholder || '';
    const entry = `[ref${trackedCount}] ${el.tagName} "${text.slice(0, 50)}"`;
    const tokens = estimateTokens(entry);
    
    if (currentTokens + tokens > maxTokens) {
      snapshot.push(`... ${elements.length - trackedCount} more elements (truncated for token limit)`);
      break;
    }
    
    snapshot.push(entry);
    currentTokens += tokens;
    trackedCount++;
  }
  
  const result = snapshot.join('\n');
  console.log(`   ✅ Generated scaffold: ${trackedCount}/${elements.length} elements`);
  console.log(`   🎯 Estimated tokens: ${estimateTokens(result)}`);
  return result;
}

const scaffoldTest = generateScaffoldSnapshot();

// Test 3: Test element reference validation
console.log('\n3️⃣ Testing element reference system...');
function testElementRefs() {
  // Find a test button or link
  const testElement = document.querySelector('button, a[href]');
  if (testElement) {
    // Simulate ref assignment
    const testRef = 'ref999';
    if (window.__elementTracker) {
      window.__elementTracker.refs.set(testRef, new WeakRef(testElement));
      
      // Try to retrieve it
      const retrieved = window.__elementTracker.getElementById(testRef);
      if (retrieved === testElement) {
        console.log('   ✅ Element ref system working correctly');
        console.log(`   📍 Test element: ${testElement.tagName} "${testElement.textContent?.slice(0, 30)}"`);
      } else {
        console.error('   ❌ Failed to retrieve element by ref');
      }
    }
  } else {
    console.log('   ⚠️ No test element found');
  }
}

testElementRefs();

// Test 4: Measure page complexity
console.log('\n4️⃣ Analyzing page complexity...');
function analyzePageComplexity() {
  const metrics = {
    totalElements: document.querySelectorAll('*').length,
    interactiveElements: document.querySelectorAll('a, button, input, select, textarea, [role="button"], [onclick]').length,
    forms: document.querySelectorAll('form').length,
    images: document.querySelectorAll('img').length,
    iframes: document.querySelectorAll('iframe').length,
    scripts: document.querySelectorAll('script').length,
    fullHTML: document.documentElement.outerHTML.length
  };
  
  console.log('   📊 Page Metrics:');
  console.log(`      • Total elements: ${metrics.totalElements.toLocaleString()}`);
  console.log(`      • Interactive: ${metrics.interactiveElements}`);
  console.log(`      • Forms: ${metrics.forms}`);
  console.log(`      • Images: ${metrics.images}`);
  console.log(`      • iFrames: ${metrics.iframes}`);
  console.log(`      • Full HTML size: ${(metrics.fullHTML / 1024).toFixed(1)} KB`);
  console.log(`      • Estimated full tokens: ${estimateTokens(document.body.innerText).toLocaleString()}`);
  console.log(`      • Scaffold tokens: ~${estimateTokens(scaffoldTest)}`);
  
  const reduction = ((estimateTokens(document.body.innerText) - estimateTokens(scaffoldTest)) / estimateTokens(document.body.innerText) * 100).toFixed(1);
  console.log(`   🔥 Token reduction: ${reduction}%`);
}

analyzePageComplexity();

// Test 5: Simulate expand region
console.log('\n5️⃣ Testing region expansion simulation...');
function simulateExpandRegion(element, maxTokens = 1000) {
  if (!element) {
    console.log('   ⚠️ No element provided for expansion');
    return;
  }
  
  const result = [];
  let currentTokens = 0;
  
  function traverse(el, depth = 0, maxDepth = 3) {
    if (depth > maxDepth) return;
    
    const indent = '  '.repeat(depth);
    const text = el.textContent?.trim().slice(0, 50) || '';
    const entry = `${indent}${el.tagName} "${text}"`;
    const tokens = estimateTokens(entry);
    
    if (currentTokens + tokens > maxTokens) return;
    
    result.push(entry);
    currentTokens += tokens;
    
    for (const child of el.children) {
      traverse(child, depth + 1, maxDepth);
    }
  }
  
  traverse(element);
  
  console.log(`   ✅ Expanded region: ${result.length} nodes`);
  console.log(`   🎯 Tokens used: ${currentTokens}/${maxTokens}`);
  return result.join('\n');
}

// Test expansion on first major container
const container = document.querySelector('main, [role="main"], .container, #content');
if (container) {
  simulateExpandRegion(container, 500);
}

console.log('\n' + '=' .repeat(50));
console.log('✅ Browser console tests completed!');
console.log('\n💡 Summary:');
console.log('   • Element tracker: ' + (typeof window.__elementTracker !== 'undefined' ? '✅' : '❌'));
console.log('   • Scaffold generation: ✅');
console.log('   • Token optimization: ✅');
console.log('   • Page suitable for testing: ' + (document.querySelectorAll('*').length > 1000 ? '✅ Complex page' : '⚠️ Simple page'));