#!/usr/bin/env node

/**
 * Test script for scaffold snapshot functionality
 * Tests token optimization on seznam.cz
 */

import { WebSocket } from 'ws';
import { performance } from 'perf_hooks';

const WS_URL = 'ws://localhost:3000';

class BrowserMCPTester {
  constructor() {
    this.ws = null;
    this.messageId = 0;
    this.pendingResponses = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(WS_URL);
      
      this.ws.on('open', () => {
        console.log('✅ Connected to WebSocket server');
        resolve();
      });

      this.ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.id && this.pendingResponses.has(msg.id)) {
          const { resolve } = this.pendingResponses.get(msg.id);
          this.pendingResponses.delete(msg.id);
          resolve(msg);
        }
      });

      this.ws.on('error', reject);
      
      setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });
  }

  async sendMessage(type, payload) {
    return new Promise((resolve) => {
      const id = ++this.messageId;
      this.pendingResponses.set(id, { resolve });
      
      this.ws.send(JSON.stringify({
        id,
        type,
        payload
      }));
    });
  }

  estimateTokens(text) {
    // Rough estimate: 4 characters ≈ 1 token
    return Math.ceil(text.length / 4);
  }

  async testScaffoldSnapshot() {
    console.log('\n📊 Testing Scaffold Snapshot on seznam.cz...\n');
    
    // Navigate to seznam.cz
    console.log('1️⃣ Navigating to seznam.cz...');
    await this.sendMessage('page.navigate', { url: 'https://www.seznam.cz' });
    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for page load
    
    // Test 1: Regular snapshot (should be huge)
    console.log('\n2️⃣ Capturing REGULAR snapshot...');
    const startRegular = performance.now();
    const regularResponse = await this.sendMessage('snapshot.accessibility', {
      level: 'minimal',
      viewportOnly: false
    });
    const regularTime = performance.now() - startRegular;
    const regularTokens = this.estimateTokens(regularResponse.payload.snapshot);
    
    console.log(`   ⏱️ Time: ${regularTime.toFixed(2)}ms`);
    console.log(`   📝 Length: ${regularResponse.payload.snapshot.length} chars`);
    console.log(`   🎯 Estimated tokens: ${regularTokens.toLocaleString()}`);
    
    // Test 2: Scaffold snapshot (should be much smaller)
    console.log('\n3️⃣ Capturing SCAFFOLD snapshot...');
    const startScaffold = performance.now();
    const scaffoldResponse = await this.sendMessage('snapshot.accessibility', {
      mode: 'scaffold'
    });
    const scaffoldTime = performance.now() - startScaffold;
    const scaffoldTokens = this.estimateTokens(scaffoldResponse.payload.snapshot);
    
    console.log(`   ⏱️ Time: ${scaffoldTime.toFixed(2)}ms`);
    console.log(`   📝 Length: ${scaffoldResponse.payload.snapshot.length} chars`);
    console.log(`   🎯 Estimated tokens: ${scaffoldTokens.toLocaleString()}`);
    
    // Calculate savings
    const reduction = ((regularTokens - scaffoldTokens) / regularTokens * 100).toFixed(1);
    const speedup = (regularTime / scaffoldTime).toFixed(1);
    
    console.log('\n📈 RESULTS:');
    console.log(`   🔥 Token reduction: ${reduction}% (${regularTokens.toLocaleString()} → ${scaffoldTokens.toLocaleString()})`);
    console.log(`   ⚡ Speed improvement: ${speedup}x faster`);
    console.log(`   💰 Saved tokens: ${(regularTokens - scaffoldTokens).toLocaleString()}`);
    
    // Extract some refs from scaffold for testing expand
    const refMatches = scaffoldResponse.payload.snapshot.match(/\[ref\d+\]/g) || [];
    const testRefs = refMatches.slice(0, 3).map(r => r.replace(/[\[\]]/g, ''));
    
    return { scaffoldSnapshot: scaffoldResponse.payload.snapshot, testRefs };
  }

  async testExpandRegion(refs) {
    console.log('\n📍 Testing Expand Region...\n');
    
    if (!refs || refs.length === 0) {
      console.log('   ⚠️ No refs found to test expand');
      return;
    }
    
    for (const ref of refs.slice(0, 2)) {
      console.log(`4️⃣ Expanding region ${ref}...`);
      const startExpand = performance.now();
      
      const expandResponse = await this.sendMessage('dom.expand', {
        ref: ref,
        maxTokens: 1000,
        depth: 2,
        filter: 'interactive'
      });
      
      const expandTime = performance.now() - startExpand;
      const expandTokens = this.estimateTokens(expandResponse.payload.expansion);
      
      console.log(`   ⏱️ Time: ${expandTime.toFixed(2)}ms`);
      console.log(`   📝 Expansion size: ${expandResponse.payload.expansion.length} chars`);
      console.log(`   🎯 Tokens used: ${expandTokens} (budget: 1000)`);
    }
  }

  async testQueryElements() {
    console.log('\n🔍 Testing Query Elements...\n');
    
    // Test 1: Query by selector
    console.log('5️⃣ Querying links...');
    const linksResponse = await this.sendMessage('dom.query', {
      selector: 'a',
      limit: 10
    });
    const linkCount = (linksResponse.payload.results.match(/\[ref\d+\]/g) || []).length;
    console.log(`   ✅ Found ${linkCount} links (limited to 10)`);
    
    // Test 2: Query by text content
    console.log('\n6️⃣ Querying elements containing "Seznam"...');
    const textResponse = await this.sendMessage('dom.query', {
      containing: 'Seznam',
      limit: 5
    });
    const textCount = (textResponse.payload.results.match(/\[ref\d+\]/g) || []).length;
    console.log(`   ✅ Found ${textCount} elements containing "Seznam"`);
    
    // Test 3: Query interactive elements
    console.log('\n7️⃣ Querying input fields...');
    const inputResponse = await this.sendMessage('dom.query', {
      selector: 'input, button',
      limit: 15
    });
    const inputCount = (inputResponse.payload.results.match(/\[ref\d+\]/g) || []).length;
    console.log(`   ✅ Found ${inputCount} interactive elements`);
  }

  async runFullTest() {
    try {
      await this.connect();
      
      console.log('🚀 Starting BrowserMCP Enhanced Scaffold Tests');
      console.log('=' .repeat(50));
      
      // Run scaffold snapshot test
      const { scaffoldSnapshot, testRefs } = await this.testScaffoldSnapshot();
      
      // Run expand region test
      await this.testExpandRegion(testRefs);
      
      // Run query elements test  
      await this.testQueryElements();
      
      console.log('\n' + '=' .repeat(50));
      console.log('✅ All tests completed successfully!');
      
      // Close connection
      this.ws.close();
      
    } catch (error) {
      console.error('\n❌ Test failed:', error.message);
      process.exit(1);
    }
  }
}

// Run tests
const tester = new BrowserMCPTester();
tester.runFullTest();