# Multi-Instance Testing Guide

**Version:** 1.15.3
**Status:** Ready for Testing
**Last Updated:** 2025-09-30

---

## 🎯 Testing Objectives

This guide describes how to test the multi-instance functionality of Browser MCP Enhanced. The goal is to verify that:

1. ✅ **Multiple Claude instances can connect simultaneously**
2. ✅ **Each instance has isolated state (separate tabs)**
3. ✅ **Tab locking mechanism works correctly**
4. ✅ **No cross-instance interference**
5. ✅ **Clean disconnection and cleanup**

---

## 📋 Prerequisites

### Required Software
- ✅ Node.js v20+ installed
- ✅ Chrome Canary with extension loaded
- ✅ Multiple Claude Desktop instances (or test scripts)

### Environment Setup
```bash
# Ensure MCP server is deployed
cd /home/david/Work/Programming/browsermcp-enhanced
./scripts/deploy

# Restart Claude Desktop to load new MCP servers
# Each Claude Desktop instance will connect to a different port (8765-8775)
```

---

## 🧪 Testing Methods

### Method 1: Automated Testing (Recommended)

The simplest way to test multi-instance functionality:

```bash
cd /home/david/Work/Programming/browsermcp-enhanced/tests

# Install dependencies
npm install ws

# Run the test suite
node simple-multi-instance-test.js
```

**What This Tests:**
- ✅ Connection to multiple MCP ports
- ✅ Unique instance IDs
- ✅ Parallel navigation
- ✅ Tab isolation
- ✅ Screenshot capture from different instances
- ✅ Sequential operations without interference

**Expected Output:**
```
=============================================================
  Multi-Instance MCP Test Suite
=============================================================

Connecting clients to MCP servers...

[Client-A:8765] Connecting to MCP server...
[Client-A:8765] ✓ WebSocket connected
[Client-A:8765] ✓ Instance ID received: a1b2c3d4

[Client-B:8766] Connecting to MCP server...
[Client-B:8766] ✓ WebSocket connected
[Client-B:8766] ✓ Instance ID received: e5f6g7h8

✓ All clients connected

Starting test execution...

━━━ Test: Instance IDs are unique ━━━
✓ PASS

━━━ Test: Parallel navigation to different URLs ━━━
[Client-A:8765] → Sent: browser_navigate
[Client-B:8766] → Sent: browser_navigate
[Client-A:8765] ← Received: response
[Client-B:8766] ← Received: response
✓ PASS

... (more tests) ...

=============================================================
  Test Results
=============================================================

Total:  5
Passed: 5
Failed: 0

✓ All tests passed!
```

### Method 2: Manual Testing with Multiple Claude Instances

1. **Open Multiple Claude Desktop Windows**
   ```bash
   # Terminal 1
   claude-desktop

   # Terminal 2
   claude-desktop

   # Or just open Claude Desktop multiple times from UI
   ```

2. **Verify Each Instance Connects**
   - Click the Browser MCP extension icon in Chrome
   - Check the badge number (should show 2, 3, or 4 depending on instances)
   - Check that icon is GREEN (connected state)

3. **Test Instance Isolation**

   **In Claude Instance 1:**
   ```
   Navigate to https://example.com and take a screenshot
   ```

   **In Claude Instance 2:**
   ```
   Navigate to https://wikipedia.org and take a screenshot
   ```

   **Expected Result:**
   - Each instance navigates to a different URL
   - Screenshots are from different tabs
   - No interference between instances

4. **Test Tab Locking**

   **In Both Instances Simultaneously:**
   ```
   Navigate to https://github.com
   ```

   **Expected Result:**
   - One instance acquires the lock first
   - Second instance waits in queue
   - Both complete successfully without errors
   - Each uses a different tab (verify with browser_tab list command)

---

## 📊 Monitoring and Logs

### Chrome Extension Logs

**View in Chrome:**
1. Open Chrome DevTools (F12)
2. Go to Console tab
3. Filter for `[MultiMgr]` or `[BrowserMCP]`

**Key Things to Watch:**
```
[MultiMgr] Registered instance abc123 on port 8765
[MultiMgr] Registered instance def456 on port 8766
[MultiMgr] Instance abc123 acquired lock for tab 123
[MultiMgr] Instance def456 acquired lock for tab 456
```

**Red Flags:**
```
❌ Instance ID mismatch!
❌ Tab lock acquisition timeout
❌ Force-releasing stale lock
```

### MCP Server Logs

Logs are written to: `/tmp/browsermcp-logs/`

```bash
# Watch logs in real-time
tail -f /tmp/browsermcp-logs/mcp-instance-*-port-*.log

# View logs for specific instance
cat /tmp/browsermcp-logs/mcp-instance-abc12345-port-8765.log
```

**Key Events to Watch:**
```
[CONNECTION] ✓ WebSocket opened
[TOOL] Tool "browser_navigate" executed in 234ms
[TAB] navigate - Tab 123
[LOCK] 🔒 Lock acquired for tab 123
[LOCK] 🔓 Lock released for tab 123
```

### Log Levels

Control logging verbosity with environment variables:

```bash
# In ~/.claude/mcp_servers.json, add to browsermcp env:
{
  "browsermcp": {
    "command": "node",
    "args": [...],
    "env": {
      "BROWSERMCP_LOG_LEVEL": "DEBUG",  // ERROR, WARN, INFO, DEBUG, TRACE
      "BROWSERMCP_LOG_FILE": "true",    // Enable/disable file logging
      "BROWSERMCP_LOG_DIR": "/tmp/browsermcp-logs"
    }
  }
}
```

---

## 🔍 Debugging Common Issues

### Issue: Badge shows "4" but icon is still red

**Fixed in v1.15.3!** The badge now correctly shows green icon when instances are connected.

**Verify Fix:**
1. Click the extension icon
2. Check that the icon in the toolbar is GREEN (not red)
3. Badge should show number of connected instances (2, 3, or 4)

### Issue: "Tab lock acquisition timeout"

**Symptoms:**
```
[MultiMgr] Tab lock acquisition timeout for instance abc123 on tab 456
```

**Causes:**
- Another instance crashed while holding a lock
- Tab was closed while lock was held
- Deadlock condition

**Resolution:**
- **Automatic:** Stale locks are now auto-detected (>60 seconds) and force-released
- **Manual:** Reload the Chrome extension if issue persists

### Issue: "Instance ID mismatch"

**Symptoms:**
```
[MultiMgr] Instance ID mismatch! Message claims: abc123, actual: def456
```

**Causes:**
- Message routing bug
- WebSocket reconnection during operation

**Resolution:**
- This should NOT happen with v1.15.3 fixes
- If it does, please report as a bug with logs

### Issue: Tabs getting mixed between instances

**Symptoms:**
- Instance A navigates to URL requested by Instance B
- Screenshots show wrong content

**Causes:**
- Shared context bug (FIXED in v1.15.2)
- Tab lock not working properly

**Verification:**
```bash
# Run the automated test
node simple-multi-instance-test.js

# Look for this test result:
"Each client manages different tabs": PASS
```

---

## 📈 Success Criteria

All tests must pass for multi-instance to be considered working:

- [ ] **Connection Test:** All instances connect to different ports
- [ ] **Isolation Test:** Each instance has unique instance ID
- [ ] **Tab Test:** Each instance manages different tabs (no overlap)
- [ ] **Lock Test:** Tab locks prevent concurrent access
- [ ] **Navigation Test:** Parallel navigation works without interference
- [ ] **Screenshot Test:** Screenshots are from correct tabs
- [ ] **Cleanup Test:** Disconnection releases all locks and closes tabs
- [ ] **Badge Test:** Extension icon shows correct state (green + count)

---

## 🚀 Performance Testing

### Load Test (Optional)

Test with maximum number of instances:

```bash
# Start 10 Claude Desktop instances
for i in {1..10}; do
  claude-desktop &
done

# Monitor extension logs
# All should connect to ports 8765-8774
```

**Expected Behavior:**
- First 10 instances connect successfully (ports 8765-8774)
- 11th instance cannot connect (no available ports)
- Badge shows "10"
- Performance remains acceptable

### Stress Test

Rapid connect/disconnect cycles:

```bash
# Run this test script
node tests/stress-test.js
```

**(To be implemented if needed)**

---

## 📝 Test Checklist for Release

Before marking multi-instance as production-ready:

- [ ] All automated tests pass
- [ ] Manual testing with 2 instances: PASS
- [ ] Manual testing with 4 instances: PASS
- [ ] Stress testing (10 instances): PASS
- [ ] Memory leak check (run for 30 minutes): PASS
- [ ] Badge/icon display correct: PASS
- [ ] Logs are clear and helpful: PASS
- [ ] No console errors: PASS
- [ ] Tab locks work correctly: PASS
- [ ] Clean disconnection: PASS

---

## 🐛 Reporting Issues

If you find a bug during testing:

1. **Collect Logs:**
   ```bash
   # MCP server logs
   tar -czf mcp-logs.tar.gz /tmp/browsermcp-logs/

   # Chrome console logs
   # Right-click Console → Save as...
   ```

2. **Document Steps to Reproduce:**
   - Number of instances
   - Actions performed
   - Expected vs actual behavior

3. **Check if Already Fixed:**
   - See `docs/MULTI_INSTANCE_FIXES.md` for known issues

4. **Report:**
   - Create GitHub issue
   - Attach logs
   - Include system info (OS, Chrome version, etc.)

---

## 📚 Related Documentation

- `docs/MULTI_INSTANCE.md` - Architecture overview
- `docs/MULTI_INSTANCE_FIXES.md` - List of fixes applied
- `docs/port-registry.md` - Port allocation details
- `CLAUDE.md` - Deployment instructions

---

**Last Test Run:** [To be filled after first test run]
**Tester:** [Your name]
**Result:** [PASS/FAIL]
**Notes:** [Any observations]

---

Generated by Claude Code (Sonnet 4.5)
Test Suite Version: 1.0.0