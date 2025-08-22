#!/usr/bin/env node

/**
 * Test script to verify browser automation fixes
 * Run this after reloading the extension with chrome-canary-restart.sh
 */

console.log('Browser Automation Fix Test Script');
console.log('===================================\n');

console.log('This script verifies that the browser automation system is working correctly.');
console.log('\nTo test the fix:');
console.log('1. First, reload the extension:');
console.log('   $ ./chrome-canary-restart.sh\n');

console.log('2. Then in Claude, run these test commands:\n');

console.log('Test 1: Basic Navigation and Snapshot');
console.log('---------------------------------------');
console.log('a) Navigate to a test page:');
console.log('   Use: browser_navigate with url "https://example.com"');
console.log('b) Take a snapshot:');
console.log('   Use: browser_snapshot');
console.log('c) Verify refs are present (should see [ref=...] tags)\n');

console.log('Test 2: Click Interaction');
console.log('-------------------------');
console.log('a) Find a clickable element in the snapshot');
console.log('b) Click it using its ref:');
console.log('   Use: browser_click with the ref ID');
console.log('c) Take another snapshot');
console.log('d) Verify the click worked (page changed or element state changed)\n');

console.log('Test 3: Form Interaction');
console.log('------------------------');
console.log('a) Navigate to a page with a form');
console.log('b) Type in an input field:');
console.log('   Use: browser_type with ref and text');
console.log('c) Click a checkbox:');
console.log('   Use: browser_click on checkbox ref');
console.log('d) Verify checkbox state changed\n');

console.log('Test 4: Ref Stability');
console.log('---------------------');
console.log('a) Take a snapshot of any page');
console.log('b) Note a ref ID for an element');
console.log('c) Perform several operations (click, type, etc.)');
console.log('d) Take another snapshot');
console.log('e) Verify the same element still has the same ref ID\n');

console.log('Expected Results:');
console.log('-----------------');
console.log('✅ Scripts inject only once per tab (check console logs)');
console.log('✅ Refs remain stable across operations');
console.log('✅ Clicks actually trigger interactions');
console.log('✅ Form elements can be manipulated');
console.log('✅ Navigation clears injection state (new refs after navigation)\n');

console.log('Console Logs to Watch For:');
console.log('--------------------------');
console.log('Good signs:');
console.log('  "[dom.click] Scripts already injected in tab: [id]"');
console.log('  "[BrowserMCP] Click events dispatched successfully"');
console.log('  "[dom.click] Click successful on element: [tagName]"');
console.log('\nBad signs:');
console.log('  "[dom.click] Injecting scripts into tab: [id]" (on every click)');
console.log('  "Element validator not available"');
console.log('  "Click validation failed"\n');

console.log('Specific Test for Original Issue:');
console.log('---------------------------------');
console.log('URL: https://str.deverp.cz/#ExternalAccount/edit/Outlook__67a9898f0e7f8a775');
console.log('1. Navigate to the URL');
console.log('2. Take a snapshot');
console.log('3. Click the first visible checkbox');
console.log('4. Click the "Připojit" button');
console.log('5. OAuth popup should open if everything works correctly\n');

console.log('If tests pass, the browser automation system is fully functional!');