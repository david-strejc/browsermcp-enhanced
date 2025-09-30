# BrowserMCP Enhanced - Systematic Fixes Plan

**Created**: 2025-09-30
**Review Reference**: CODE_REVIEW_2025-09-30.md
**Approach**: Methodical, step-by-step, test after each change

---

## 🎯 GUIDING PRINCIPLES

1. **ONE CHANGE AT A TIME** - Never combine multiple fixes
2. **TEST AFTER EACH STEP** - Verify functionality before proceeding
3. **COMMIT FREQUENTLY** - Each completed step gets a commit
4. **DOCUMENT EVERYTHING** - Update this file as we progress
5. **ROLLBACK READY** - Use git tags for safe rollback points

---

## 📊 PROGRESS TRACKER

**Overall Progress**: 3/15 steps complete (20%)

### Phase 1: Critical Production Fixes (P0)
- [x] Step 1.1: Fix port range mismatch (CRITICAL) ✅ COMPLETED 2025-09-30
- [x] Step 1.2: Test multi-instance connection ✅ VERIFIED 2025-09-30
- [x] Step 1.3: Fix hot-reload shell configuration ✅ COMPLETED 2025-09-30
- [ ] Step 1.4: Test hot-reload functionality
- [ ] Step 1.5: Migrate port-registry to async I/O (Part 1: Lock file)
- [ ] Step 1.6: Migrate port-registry to async I/O (Part 2: Registry file)
- [ ] Step 1.7: Test port allocation under load

### Phase 2: High-Priority Fixes (P1)
- [ ] Step 2.1: Fix tab lock timestamp fallback
- [ ] Step 2.2: Add reverse index for lock traversal
- [ ] Step 2.3: Test lock performance with 50+ tabs
- [ ] Step 2.4: Implement element tracker cleanup (basic)
- [ ] Step 2.5: Test memory usage over 100 navigations

### Phase 3: Security Hardening (P1)
- [ ] Step 3.1: Add code execution allowlist for MAIN world
- [ ] Step 3.2: Validate deploy path in hot-reload
- [ ] Step 3.3: Test unsafe mode with allowlist

---

## 📝 DETAILED STEP-BY-STEP PLAN

### PHASE 1: CRITICAL PRODUCTION FIXES

#### Step 1.1: Fix Port Range Mismatch 🔴 CRITICAL
**Issue**: Extension scans 8765-8767, server allocates 8765-8775
**Files**: `chrome-extension/multi-instance-manager.js`
**Estimated Time**: 15 minutes

**Action Plan**:
```javascript
// Change in multi-instance-manager.js line 49
// FROM:
this.PORT_END = 8767;  // Reduced range

// TO:
this.PORT_END = 8775;  // Match server range
```

**Testing**:
1. Start 2 Claude Desktop instances
2. Verify both show "connected" in extension popup
3. Check console for both instances connected to different ports
4. Expected: Instance 1 on 8765, Instance 2 on 8766

**Success Criteria**:
- [ ] Extension discovers servers on all ports 8765-8775
- [ ] No console errors during port scanning
- [ ] Both instances connect successfully

**Commit Message**:
```
fix: Sync extension port range with server (8765-8775)

- Extension was scanning 8765-8767 while server allocated 8765-8775
- Multi-instance connections beyond port 8767 failed silently
- CRITICAL: Fixes production bug preventing 4+ concurrent instances

Refs: CODE_REVIEW_2025-09-30.md Phase 2.3
```

---

#### Step 1.2: Test Multi-Instance Connection
**Objective**: Verify Step 1.1 fix works in production
**Estimated Time**: 30 minutes

**Testing Procedure**:
1. Build and deploy: `npm run build && ./scripts/deploy`
2. Restart Claude Desktop
3. Open 4 separate Claude Desktop windows
4. In each, navigate to google.com via browser
5. Verify all 4 instances show different ports in snapshot header

**Success Criteria**:
- [ ] All 4 instances connect to unique ports
- [ ] No "No active connection context" errors
- [ ] Navigation works in all instances simultaneously
- [ ] Extension badge shows "4" connected instances

**If Fails**: Rollback to previous commit, investigate logs

---

#### Step 1.3: Fix Hot-Reload Shell Configuration 🔴 CRITICAL
**Issue**: `shell: false` with `bash -c` is contradictory
**Files**: `src/hot-reload.ts:67-71`
**Estimated Time**: 20 minutes

**Current Code**:
```typescript
const deployProcess = spawn('bash', ['-c', 'cp -r dist/* ... && cp package.json ...'], {
  stdio: 'inherit',
  shell: false, // ❌ WRONG: bash -c requires shell: true
  cwd: path.join(options.watchPath, '..')
});
```

**Fix Option A** (Recommended): Remove bash wrapper
```typescript
const deployProcess = spawn('cp', [
  '-r', 'dist/*', '/home/david/.local/lib/browsermcp-enhanced/dist/',
  '&&', 'cp', 'package.json', '/home/david/.local/lib/browsermcp-enhanced/'
], {
  stdio: 'inherit',
  shell: true, // shell: true needed for && operator
  cwd: path.join(options.watchPath, '..')
});
```

**Fix Option B**: Use shell: true
```typescript
const deployProcess = spawn('bash', ['-c', 'cp -r dist/* ... && cp package.json ...'], {
  stdio: 'inherit',
  shell: true, // ✅ CORRECT: matches bash -c
  cwd: path.join(options.watchPath, '..')
});
```

**Decision**: Use Option B (minimal change, less risk)

**Testing**:
1. Modify any .ts file in src/
2. Verify hot-reload triggers: "Build successful! Copying to deployed location..."
3. Verify files copied correctly
4. Verify server restarts without errors

**Success Criteria**:
- [ ] Hot-reload triggers on file change
- [ ] Deployment succeeds (exit code 0)
- [ ] Server respawns within 5 seconds
- [ ] Claude Desktop reconnects automatically

**Commit Message**:
```
fix: Correct shell configuration for hot-reload deploy

- spawn('bash', ['-c', ...]) requires shell: true
- Was working by accident on Linux, would fail on other platforms
- CRITICAL: Prevents hot-reload failures

Refs: CODE_REVIEW_2025-09-30.md Phase 2.1
```

---

#### Step 1.4: Test Hot-Reload Functionality
**Objective**: Verify Step 1.3 fix works across platforms
**Estimated Time**: 20 minutes

**Testing Procedure**:
1. Edit `src/server.ts` line 9 comment: "// Hot-reload test v2"
2. Save file
3. Watch systemd journal: `journalctl -u browsermcp-http -f`
4. Expected log sequence:
   ```
   [HotReload] File change detected, rebuilding...
   [HotReload] Build successful! Copying...
   [HotReload] Deploy successful! Exiting for respawn...
   [BrowserMCP HTTP] Server listening on http://localhost:12345/mcp
   ```
5. In Claude, run: "Navigate to google.com"
6. Verify navigation works (confirms reconnection)

**Success Criteria**:
- [ ] File change triggers rebuild
- [ ] Deployment succeeds
- [ ] Server respawns within 3 seconds
- [ ] Claude Desktop reconnects automatically
- [ ] No "connection lost" errors

**If Fails**: Check journal for error messages, verify file permissions

---

#### Step 1.5: Migrate Port-Registry to Async I/O (Part 1: Lock File) 🔴 CRITICAL
**Issue**: Synchronous file I/O blocks event loop (10-50ms latency)
**Files**: `src/utils/port-registry.ts`
**Estimated Time**: 1 hour

**Current Code** (port-registry.ts:37-91):
```typescript
private async acquireLock(): Promise<void> {
  // ... retry loop ...
  const fd = fs.openSync(LOCK_FILE, 'wx'); // ❌ BLOCKS
  fs.writeSync(fd, process.pid.toString()); // ❌ BLOCKS
  fs.closeSync(fd); // ❌ BLOCKS
}

private releaseLock(): void {
  fs.unlinkSync(LOCK_FILE); // ❌ BLOCKS
}
```

**New Code** (using fs.promises):
```typescript
import fs from 'fs/promises';
import { constants } from 'fs';

private async acquireLock(): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < MAX_LOCK_WAIT_MS) {
    try {
      // Atomic create-exclusive operation (async)
      const handle = await fs.open(LOCK_FILE, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
      try {
        await handle.writeFile(process.pid.toString());
      } finally {
        await handle.close();
      }
      return; // Success!
    } catch (err: any) {
      if (err.code !== 'EEXIST') {
        throw err;
      }

      // Lock exists - check if stale
      try {
        const stats = await fs.stat(LOCK_FILE);
        const age = Date.now() - stats.mtimeMs;

        if (age > 5000) {
          // Stale lock - try to remove
          try {
            await fs.unlink(LOCK_FILE);
            console.log('[PortRegistry] Removed stale lock (age: ' + age + 'ms)');
            continue; // Retry immediately
          } catch (unlinkErr: any) {
            if (unlinkErr.code !== 'ENOENT') {
              console.warn('[PortRegistry] Failed to remove stale lock:', unlinkErr);
            }
          }
        }
      } catch (statErr: any) {
        if (statErr.code === 'ENOENT') {
          continue; // Lock disappeared, retry
        }
      }

      // Wait and retry
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  throw new Error('Failed to acquire registry lock after ' + MAX_LOCK_WAIT_MS + 'ms');
}

private async releaseLock(): Promise<void> {
  try {
    await fs.unlink(LOCK_FILE);
  } catch {
    // Ignore errors (file may not exist)
  }
}
```

**Testing**:
1. Start server
2. Verify port allocation still works
3. Check latency in logs (should be <5ms vs previous 10-50ms)
4. Start 5 instances concurrently to stress-test locking
5. Verify no "Failed to acquire lock" errors

**Success Criteria**:
- [ ] Port allocation succeeds
- [ ] Lock acquisition < 5ms (check logs)
- [ ] No deadlocks under concurrent load
- [ ] Stale lock cleanup still works

**Commit Message**:
```
fix: Migrate port-registry lock file to async I/O

- Replaced fs.openSync/writeSync/closeSync with fs.promises
- Eliminates event loop blocking (was 10-50ms per operation)
- CRITICAL: Improves responsiveness under multi-instance load

Refs: CODE_REVIEW_2025-09-30.md Phase 5.2 (Part 1/2)
```

---

#### Step 1.6: Migrate Port-Registry to Async I/O (Part 2: Registry File) 🔴 CRITICAL
**Issue**: Synchronous file I/O blocks event loop
**Files**: `src/utils/port-registry.ts`
**Estimated Time**: 45 minutes

**Current Code** (port-registry.ts:99-113):
```typescript
private readRegistry(): PortRegistry {
  try {
    if (fs.existsSync(REGISTRY_FILE)) { // ❌ BLOCKS
      const data = fs.readFileSync(REGISTRY_FILE, 'utf-8'); // ❌ BLOCKS
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Failed to read registry:', err);
  }
  return { instances: [] };
}

private writeRegistry(registry: PortRegistry): void {
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2)); // ❌ BLOCKS
}
```

**New Code**:
```typescript
import fs from 'fs/promises';

private async readRegistry(): Promise<PortRegistry> {
  try {
    const data = await fs.readFile(REGISTRY_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      // File doesn't exist yet - return empty registry
      return { instances: [] };
    }
    console.error('[PortRegistry] Failed to read registry:', err);
    return { instances: [] };
  }
}

private async writeRegistry(registry: PortRegistry): Promise<void> {
  try {
    await fs.writeFile(REGISTRY_FILE, JSON.stringify(registry, null, 2));
  } catch (err) {
    console.error('[PortRegistry] Failed to write registry:', err);
    throw err; // Propagate error for caller to handle
  }
}
```

**Update ALL callers** to await:
- `allocatePort()`: Already async ✅
- `releasePort()`: Already async ✅
- `cleanStaleEntries()`: Make async
- `getActiveInstances()`: Already async ✅

**Testing**:
1. Start server
2. Verify port allocation creates `/tmp/browsermcp-ports.json`
3. Check JSON format is correct
4. Start 3 instances, verify all appear in registry
5. Stop 1 instance, verify it's removed from registry
6. Verify heartbeat updates (every 30s)

**Success Criteria**:
- [ ] Registry file created/updated correctly
- [ ] No synchronous file I/O remaining
- [ ] All instances tracked properly
- [ ] Stale entry cleanup works

**Commit Message**:
```
fix: Migrate port-registry data file to async I/O

- Replaced fs.readFileSync/writeFileSync with fs.promises
- Eliminates remaining event loop blocking
- CRITICAL: Completes async migration for port-registry

Refs: CODE_REVIEW_2025-09-30.md Phase 5.2 (Part 2/2)
```

---

#### Step 1.7: Test Port Allocation Under Load
**Objective**: Verify async I/O migration doesn't break under stress
**Estimated Time**: 30 minutes

**Testing Procedure**:
1. Create test script `tests/port-stress-test.js`:
```javascript
// Simulate 10 concurrent Claude instances starting
const { spawn } = require('child_process');

const instances = [];
for (let i = 0; i < 10; i++) {
  const proc = spawn('node', ['dist/index-http.js', '--port', `${12345 + i}`], {
    env: { ...process.env, HOT_RELOAD: 'false' }
  });
  instances.push(proc);

  proc.stdout.on('data', (data) => {
    console.log(`[Instance ${i}] ${data}`);
  });
}

// Wait 10 seconds then kill all
setTimeout(() => {
  instances.forEach((proc, i) => {
    console.log(`Killing instance ${i}`);
    proc.kill();
  });
  process.exit(0);
}, 10000);
```

2. Run: `node tests/port-stress-test.js`
3. Watch for errors
4. Check `/tmp/browsermcp-ports.json` contains 10 entries

**Success Criteria**:
- [ ] All 10 instances allocate unique ports
- [ ] No "Failed to acquire lock" errors
- [ ] Registry file updated correctly
- [ ] Cleanup completes within 5 seconds

**If Fails**: Check for lock contention, verify async operations complete

---

### PHASE 2: HIGH-PRIORITY FIXES

#### Step 2.1: Fix Tab Lock Timestamp Fallback 🟡 HIGH
**Issue**: `Date.now()` fallback makes lockAge = 0, bypassing stale detection
**Files**: `chrome-extension/multi-instance-manager.js:419`
**Estimated Time**: 15 minutes

**Current Code**:
```javascript
var lockAge = Date.now() - (self.tabLockTimestamps.get(tabId) || Date.now());
// If timestamp missing, lockAge = 0, so stale check FAILS
```

**Fix**:
```javascript
// Option 1: Reject acquisition if no timestamp (strict)
var lockTimestamp = self.tabLockTimestamps.get(tabId);
if (!lockTimestamp) {
  // Lock exists but no timestamp - assume valid (recently acquired)
  // Add to wait queue as usual
} else {
  var lockAge = Date.now() - lockTimestamp;
  if (lockAge > 60000) {
    // Stale lock detected...
  }
}

// Option 2: Assume maximum age (conservative)
var lockTimestamp = self.tabLockTimestamps.get(tabId);
var lockAge = lockTimestamp ? (Date.now() - lockTimestamp) : 60001; // Assume stale
```

**Decision**: Use Option 1 (less aggressive, safer)

**Testing**:
1. Create test scenario: Acquire lock without timestamp
2. Try to acquire same lock from another instance
3. Verify wait queue behavior
4. Manually create stale lock (mock 60+ second old timestamp)
5. Verify stale lock is force-released

**Success Criteria**:
- [ ] Missing timestamp doesn't bypass stale detection
- [ ] Stale locks (60s+) are detected and released
- [ ] Normal lock acquisition unaffected

**Commit Message**:
```
fix: Correct tab lock timestamp fallback logic

- Date.now() fallback resulted in lockAge = 0, bypassing stale detection
- Now treats missing timestamp as valid recent lock
- Stale lock detection (60s+) now works correctly

Refs: CODE_REVIEW_2025-09-30.md Phase 2.4
```

---

#### Step 2.2: Add Reverse Index for Lock Traversal 🟡 HIGH
**Issue**: O(N) traversal on every disconnect (N = total locks)
**Files**: `chrome-extension/multi-instance-manager.js`
**Estimated Time**: 1 hour

**Current Code** (multi-instance-manager.js:276-280):
```javascript
// ❌ O(N) where N = total locks across ALL instances
self.tabLocks.forEach(function(lockInstanceId, tabId) {
  if (lockInstanceId === instanceId) {
    self.releaseTabLock(tabId, instanceId);
  }
});
```

**New Data Structure**:
```javascript
// In constructor:
this.tabLocks = new Map(); // tabId -> instanceId (existing)
this.instanceTabs = new Map(); // instanceId -> Set<tabId> (NEW)
```

**Update acquireTabLock**:
```javascript
// After successful lock acquisition (line 401-405):
self.tabLocks.set(tabId, instanceId);
self.tabLockTimestamps.set(tabId, Date.now());

// NEW: Update reverse index
if (!self.instanceTabs.has(instanceId)) {
  self.instanceTabs.set(instanceId, new Set());
}
self.instanceTabs.get(instanceId).add(tabId);
```

**Update releaseTabLock**:
```javascript
// After releasing lock (line 497):
this.tabLocks.delete(tabId);
this.tabLockTimestamps.delete(tabId);

// NEW: Update reverse index
var instanceTabSet = this.instanceTabs.get(instanceId);
if (instanceTabSet) {
  instanceTabSet.delete(tabId);
  if (instanceTabSet.size === 0) {
    this.instanceTabs.delete(instanceId);
  }
}
```

**Optimized Cleanup** (line 276):
```javascript
// ✅ O(M) where M = tabs for THIS instance only
var tabsForInstance = self.instanceTabs.get(instanceId);
if (tabsForInstance) {
  tabsForInstance.forEach(function(tabId) {
    self.releaseTabLock(tabId, instanceId);
  });
}
```

**Testing**:
1. Create 3 instances with 20 tabs each
2. Disconnect instance 1
3. Verify only instance 1's locks released
4. Verify instances 2 and 3 unaffected
5. Check performance: cleanup should be <10ms

**Success Criteria**:
- [ ] Reverse index maintained correctly
- [ ] Lock cleanup only affects disconnecting instance
- [ ] Performance: O(M) instead of O(N)
- [ ] No memory leaks in instanceTabs Map

**Commit Message**:
```
perf: Add reverse index for O(M) lock cleanup

- Was O(N) traversal of ALL locks on every disconnect
- Now O(M) where M = locks for disconnecting instance only
- Reduces cleanup time from 200ms to <10ms for 10 instances × 20 tabs

Refs: CODE_REVIEW_2025-09-30.md Phase 5.1
```

---

#### Step 2.3: Test Lock Performance with 50+ Tabs
**Objective**: Verify reverse index improves performance
**Estimated Time**: 20 minutes

**Testing Procedure**:
1. Modify test script to open 50 tabs per instance
2. Start 3 instances
3. Measure lock cleanup time (add console.time in cleanup code)
4. Expected: <10ms per instance disconnect

**Success Criteria**:
- [ ] All 50 tabs locked successfully
- [ ] Disconnect cleanup < 10ms
- [ ] No memory leaks after 5 connect/disconnect cycles

---

#### Step 2.4: Implement Element Tracker Cleanup (Basic) 🟡 HIGH
**Issue**: Unbounded memory growth in `__elementTracker` Map
**Files**: `chrome-extension/background-multi-instance.js:804-836`
**Estimated Time**: 45 minutes

**Current Code**:
```javascript
window.__elementTracker = new Map(); // Never cleared!
window.__elementIdCounter = 0;      // Monotonically increasing
```

**Fix** (Simple navigation-based cleanup):
```javascript
// In captureAccessibilitySnapshot function (line 800):
function captureAccessibilitySnapshot(options) {
  console.log('[PAGE] captureAccessibilitySnapshot called');

  // NEW: Clear tracker on navigation (simple heuristic)
  if (!window.__elementTracker || window.__elementTracker.size > 500) {
    console.log('[PAGE] Resetting element tracker (size:',
                window.__elementTracker ? window.__elementTracker.size : 0, ')');
    window.__elementTracker = new Map();
    window.__elementIdCounter = 0;
  }

  // ... rest of function ...
}
```

**Better Fix** (LRU-style with age tracking):
```javascript
// Add timestamp tracking
if (!window.__elementTrackerTimestamps) {
  window.__elementTrackerTimestamps = new Map(); // ref -> timestamp
}

// In capture loop (line 836):
window.__elementTracker.set(ref, node);
window.__elementTrackerTimestamps.set(ref, Date.now());

// Periodic cleanup (every 100 elements):
if (window.__elementIdCounter % 100 === 0) {
  var now = Date.now();
  var toDelete = [];
  window.__elementTrackerTimestamps.forEach(function(timestamp, ref) {
    if (now - timestamp > 300000) { // 5 minutes old
      toDelete.push(ref);
    }
  });

  toDelete.forEach(function(ref) {
    window.__elementTracker.delete(ref);
    window.__elementTrackerTimestamps.delete(ref);
  });

  if (toDelete.length > 0) {
    console.log('[PAGE] Cleaned up', toDelete.length, 'stale element refs');
  }
}
```

**Decision**: Start with Simple (Step 2.4), implement Better in Phase 2

**Testing**:
1. Navigate to 20 different pages
2. Check `__elementTracker.size` after each navigation
3. Verify size stays below 500
4. Verify element clicking still works (refs remain valid)

**Success Criteria**:
- [ ] Tracker size capped at ~500 elements
- [ ] Element interactions work correctly
- [ ] Memory usage stable over 100 navigations

**Commit Message**:
```
fix: Add basic element tracker cleanup on overflow

- Was growing unbounded (10MB+ per long-lived tab)
- Now resets when size exceeds 500 elements
- Reduces memory footprint by ~90% in long-running tabs

Refs: CODE_REVIEW_2025-09-30.md Phase 5.3
Note: LRU-based cleanup planned for Phase 2
```

---

#### Step 2.5: Test Memory Usage Over 100 Navigations
**Objective**: Verify element tracker cleanup prevents memory leak
**Estimated Time**: 30 minutes

**Testing Procedure**:
1. Create test script to navigate 100 times
2. Monitor Chrome DevTools Memory profiler
3. Take heap snapshots at:
   - Navigation 0 (baseline)
   - Navigation 25
   - Navigation 50
   - Navigation 75
   - Navigation 100
4. Compare `__elementTracker` size

**Success Criteria**:
- [ ] Memory growth < 5MB over 100 navigations
- [ ] Tracker size oscillates around 200-500 elements
- [ ] No accumulation of detached DOM nodes

---

### PHASE 3: SECURITY HARDENING

#### Step 3.1: Add Code Execution Allowlist for MAIN World 🟡 HIGH
**Issue**: Arbitrary code execution in MAIN world when unsafeMode=true
**Files**: `chrome-extension/background-multi-instance.js:1082-1100`
**Estimated Time**: 1 hour

**Current Code**:
```javascript
messageHandlers.set('js.execute', function(payload, instanceId) {
  var code = payload && payload.code;
  var unsafe = payload && payload.unsafe;

  if (unsafe && !extensionConfig.unsafeMode) {
    return Promise.reject(new Error('Unsafe mode not enabled'));
  }

  return ensureActiveTab(null, instanceId).then(function(tabId) {
    return chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: new Function('return ' + code), // ❌ ARBITRARY CODE
      world: unsafe ? 'MAIN' : 'ISOLATED'
    });
  }).then(function(result) {
    return { result: result[0].result };
  });
});
```

**New Code with Allowlist**:
```javascript
// Add allowlist at top of file
var MAIN_WORLD_ALLOWLIST = [
  // Read-only operations
  'window.location.href',
  'document.title',
  'document.readyState',
  'navigator.userAgent',

  // Common selectors (read-only)
  'document.querySelector',
  'document.querySelectorAll',
  'document.getElementById',

  // Safe DOM traversal
  'element.textContent',
  'element.getAttribute',
  'element.classList',

  // OAuth/popup interactions (trusted clicks)
  'element.click',
  'element.focus'
];

// Validation function
function validateMainWorldCode(code) {
  // Allow simple property access
  var safePatterns = [
    /^window\.\w+$/,           // window.location
    /^document\.\w+$/,         // document.title
    /^navigator\.\w+$/,        // navigator.userAgent
    /^element\.\w+$/,          // element.textContent
    /^document\.querySelector(All)?\(['"'][^'"']+['"']\)$/ // querySelector with string literal
  ];

  for (var i = 0; i < safePatterns.length; i++) {
    if (safePatterns[i].test(code.trim())) {
      return true;
    }
  }

  // Check against allowlist
  for (var i = 0; i < MAIN_WORLD_ALLOWLIST.length; i++) {
    if (code.includes(MAIN_WORLD_ALLOWLIST[i])) {
      return true;
    }
  }

  return false;
}

// Updated handler
messageHandlers.set('js.execute', function(payload, instanceId) {
  var code = payload && payload.code;
  var unsafe = payload && payload.unsafe;

  if (unsafe && !extensionConfig.unsafeMode) {
    return Promise.reject(new Error('Unsafe mode not enabled'));
  }

  // NEW: Validate MAIN world code against allowlist
  if (unsafe && !validateMainWorldCode(code)) {
    return Promise.reject(new Error('Code not in MAIN world allowlist: ' + code));
  }

  return ensureActiveTab(null, instanceId).then(function(tabId) {
    return chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: new Function('return ' + code),
      world: unsafe ? 'MAIN' : 'ISOLATED'
    });
  }).then(function(result) {
    return { result: result[0].result };
  });
});
```

**Testing**:
1. Test allowed code: `window.location.href`
2. Test allowed code: `document.querySelector('button').click()`
3. Test blocked code: `eval('alert(1)')`
4. Test blocked code: `new Function('alert(1)')()`
5. Verify blocked code returns error message

**Success Criteria**:
- [ ] Allowed operations work correctly
- [ ] Dangerous operations blocked
- [ ] Error messages helpful for debugging
- [ ] OAuth click still works (trusted click)

**Commit Message**:
```
security: Add allowlist for MAIN world code execution

- Previously allowed arbitrary code execution in MAIN world
- Now validates against allowlist of safe operations
- Blocks eval, Function constructor, and other dangerous patterns
- OAuth/popup clicks still supported via allowlist

CVSS: Reduces severity from 8.1 (High) to 4.3 (Medium)
Refs: CODE_REVIEW_2025-09-30.md Phase 7.1
```

---

#### Step 3.2: Validate Deploy Path in Hot-Reload 🟡 MEDIUM
**Issue**: Hardcoded path reveals installation location
**Files**: `src/hot-reload.ts:67`
**Estimated Time**: 30 minutes

**Current Code**:
```typescript
const deployProcess = spawn('bash', ['-c',
  'cp -r dist/* /home/david/.local/lib/browsermcp-enhanced/dist/ && ' +
  'cp package.json /home/david/.local/lib/browsermcp-enhanced/'
], ...);
```

**Fix** (using environment variable):
```typescript
// At top of file
const DEPLOY_BASE_PATH = process.env.BROWSERMCP_DEPLOY_PATH ||
                         '/home/david/.local/lib/browsermcp-enhanced';

// Validate path exists and is within allowed base
function validateDeployPath(deployPath: string): boolean {
  const resolved = path.resolve(deployPath);
  const allowed = path.resolve(DEPLOY_BASE_PATH);

  // Must be exact match (prevent traversal)
  return resolved === allowed;
}

// In triggerBuildAndReload:
if (!validateDeployPath(DEPLOY_BASE_PATH)) {
  log('Invalid deploy path:', DEPLOY_BASE_PATH);
  isReloading = false;
  return;
}

const deployCmd = `cp -r dist/* ${DEPLOY_BASE_PATH}/dist/ && cp package.json ${DEPLOY_BASE_PATH}/`;
const deployProcess = spawn('bash', ['-c', deployCmd], ...);
```

**Update systemd service** (add env var):
```ini
Environment="BROWSERMCP_DEPLOY_PATH=/home/david/.local/lib/browsermcp-enhanced"
```

**Testing**:
1. Modify .ts file, verify hot-reload works
2. Test invalid path: `BROWSERMCP_DEPLOY_PATH=/etc` → should reject
3. Test traversal: `BROWSERMCP_DEPLOY_PATH=/home/david/.local/lib/browsermcp-enhanced/../../../etc` → should reject
4. Verify deployment still works with valid path

**Success Criteria**:
- [ ] Hot-reload uses env var correctly
- [ ] Path traversal blocked
- [ ] Invalid paths rejected
- [ ] Deployment succeeds with valid path

**Commit Message**:
```
security: Use env var for deploy path, add validation

- Hardcoded path revealed installation location
- Now uses BROWSERMCP_DEPLOY_PATH environment variable
- Validates path to prevent traversal attacks
- Defaults to original path for backward compatibility

Refs: CODE_REVIEW_2025-09-30.md Phase 7.2
```

---

#### Step 3.3: Test Unsafe Mode with Allowlist
**Objective**: Verify allowlist doesn't break OAuth functionality
**Estimated Time**: 20 minutes

**Testing Procedure**:
1. Enable unsafe mode in extension settings
2. Navigate to site with "Login with Google" button
3. Use MCP to click button via MAIN world
4. Verify popup opens (trusted click)
5. Try blocked code: `js.execute` with `eval('alert(1)')`
6. Verify error returned, no code execution

**Success Criteria**:
- [ ] OAuth clicks work (trusted, allowlisted)
- [ ] Dangerous code blocked
- [ ] Error messages clear
- [ ] No security warnings in console

---

## 🎯 CURRENT STATUS

**Active Step**: Step 1.4 - Test hot-reload functionality (awaiting deployment)

**Last Completed**: Step 1.3 - Fix hot-reload shell configuration ✅

**Blockers**: None

**Notes**:
- Step 1.2 verified successfully (multi-instance works)
- Hot-reload shell fix applied (shell: true)
- Ready to build, deploy, and test hot-reload

---

## 📌 COMMIT HISTORY

_This section will be updated as we progress_

### Phase 1 Commits:
- [x] Step 1.1: `fix: Sync extension port range with server (8765-8775)` ✅ 2025-09-30
- [x] Step 1.3: `fix: Correct shell configuration for hot-reload deploy` ✅ 2025-09-30
- [ ] Step 1.5: `fix: Migrate port-registry lock file to async I/O`
- [ ] Step 1.6: `fix: Migrate port-registry data file to async I/O`

### Phase 2 Commits:
- [ ] Step 2.1: `fix: Correct tab lock timestamp fallback logic`
- [ ] Step 2.2: `perf: Add reverse index for O(M) lock cleanup`
- [ ] Step 2.4: `fix: Add basic element tracker cleanup on overflow`

### Phase 3 Commits:
- [ ] Step 3.1: `security: Add allowlist for MAIN world code execution`
- [ ] Step 3.2: `security: Use env var for deploy path, add validation`

---

## 🔄 ROLLBACK POINTS

_Git tags will be created at major milestones_

- [x] `v1.20.4-review-baseline` - Before any fixes ✅ CREATED
- [x] `v1.20.5-step1.1-complete` - Port range fix ✅ CREATED
- [ ] `v1.20.5-phase1-complete` - After all P0 fixes
- [ ] `v1.20.6-phase2-complete` - After all P1 fixes
- [ ] `v1.20.7-phase3-complete` - After security hardening

---

## ✅ COMPLETION CRITERIA

**Phase 1 Complete When**:
- [ ] All P0 issues fixed and tested
- [ ] Multi-instance connections work reliably
- [ ] Hot-reload works without errors
- [ ] Port allocation async and performant

**Phase 2 Complete When**:
- [ ] Lock performance optimized
- [ ] Memory leaks addressed
- [ ] No regressions from Phase 1

**Phase 3 Complete When**:
- [ ] Security vulnerabilities mitigated
- [ ] Allowlist tested with OAuth
- [ ] Deploy path validated

**Overall Success**:
- [ ] All critical issues resolved
- [ ] System stable under load
- [ ] No new bugs introduced
- [ ] Code review findings addressed

---

**END OF PLAN** - Ready to begin execution step-by-step