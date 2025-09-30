#!/usr/bin/env node
/**
 * Port Allocation Stress Test
 * Tests concurrent port allocation to verify async I/O migration
 */

import { PortRegistryManager } from '../src/utils/port-registry.ts';
import fs from 'fs/promises';

const REGISTRY_FILE = '/tmp/browsermcp-ports.json';
const NUM_INSTANCES = 10;

console.log('🚀 Port Allocation Stress Test');
console.log(`Testing ${NUM_INSTANCES} concurrent allocations...\n`);

async function testConcurrentAllocations() {
  const startTime = Date.now();

  // Create multiple managers concurrently
  const managers = Array.from({ length: NUM_INSTANCES }, () => new PortRegistryManager());

  // Allocate ports concurrently
  console.log('⏳ Allocating ports concurrently...');
  const allocations = await Promise.all(
    managers.map(async (manager, i) => {
      try {
        const result = await manager.allocatePort();
        console.log(`✓ Instance ${i}: Allocated port ${result.port}`);
        return { success: true, manager, ...result };
      } catch (err) {
        console.error(`✗ Instance ${i}: Failed - ${err.message}`);
        return { success: false, manager, error: err.message };
      }
    })
  );

  const allocTime = Date.now() - startTime;
  console.log(`\n⏱️  Allocation completed in ${allocTime}ms\n`);

  // Check results
  const successful = allocations.filter(a => a.success);
  const failed = allocations.filter(a => !a.success);

  console.log(`✅ Successful: ${successful.length}/${NUM_INSTANCES}`);
  console.log(`❌ Failed: ${failed.length}/${NUM_INSTANCES}\n`);

  // Verify unique ports
  const ports = successful.map(a => a.port);
  const uniquePorts = new Set(ports);
  if (ports.length !== uniquePorts.size) {
    console.error('❌ ERROR: Duplicate ports allocated!');
    console.error('Ports:', ports);
    return false;
  }
  console.log('✓ All ports are unique\n');

  // Read registry file
  try {
    const registryData = await fs.readFile(REGISTRY_FILE, 'utf-8');
    const registry = JSON.parse(registryData);
    console.log(`📋 Registry contains ${registry.instances.length} instances`);
    console.log('Ports in registry:', registry.instances.map(i => i.port).sort((a,b) => a-b).join(', '));
  } catch (err) {
    console.error('❌ Failed to read registry:', err.message);
    return false;
  }

  // Wait 2 seconds for heartbeats
  console.log('\n⏳ Waiting 2s for heartbeats...');
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Cleanup - release ports
  console.log('\n🧹 Releasing ports...');
  const releaseTime = Date.now();
  await Promise.all(
    successful.map(async ({ manager }, i) => {
      try {
        await manager.releasePort();
        console.log(`✓ Instance ${i}: Released`);
      } catch (err) {
        console.error(`✗ Instance ${i}: Release failed - ${err.message}`);
      }
    })
  );
  const releaseElapsed = Date.now() - releaseTime;
  console.log(`⏱️  Cleanup completed in ${releaseElapsed}ms\n`);

  // Verify cleanup
  try {
    const registryData = await fs.readFile(REGISTRY_FILE, 'utf-8');
    const registry = JSON.parse(registryData);
    console.log(`📋 Registry after cleanup: ${registry.instances.length} instances remaining`);
    if (registry.instances.length === 0) {
      console.log('✅ All instances cleaned up successfully\n');
    } else {
      console.warn('⚠️  Some instances remain:', registry.instances.map(i => i.port));
    }
  } catch (err) {
    console.error('❌ Failed to verify cleanup:', err.message);
  }

  // Final results
  console.log('\n' + '='.repeat(60));
  console.log('STRESS TEST RESULTS');
  console.log('='.repeat(60));
  console.log(`Total time: ${Date.now() - startTime}ms`);
  console.log(`Allocation time: ${allocTime}ms (avg: ${(allocTime / NUM_INSTANCES).toFixed(1)}ms per instance)`);
  console.log(`Cleanup time: ${releaseElapsed}ms`);
  console.log(`Success rate: ${successful.length}/${NUM_INSTANCES} (${(successful.length/NUM_INSTANCES*100).toFixed(1)}%)`);

  if (successful.length === NUM_INSTANCES && uniquePorts.size === NUM_INSTANCES) {
    console.log('\n✅ STRESS TEST PASSED\n');
    return true;
  } else {
    console.log('\n❌ STRESS TEST FAILED\n');
    return false;
  }
}

// Run test
testConcurrentAllocations()
  .then(success => process.exit(success ? 0 : 1))
  .catch(err => {
    console.error('💥 Test crashed:', err);
    process.exit(1);
  });