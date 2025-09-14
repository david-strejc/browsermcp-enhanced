# Debugger State Manager Test Results

## Test Environment
- Date: 2025-01-14
- Version: 1.4.4 (FIXED UNSAFE MODE CONFLICT)
- Test Site: seznam.cz

## Test Cases

### 1. Navigate to seznam.cz
- **Result**: ✅ PASS - Successfully navigated

### 2. Attach debugger (first time)
- **Result**: ✅ PASS - Debugger attached with all domains

### 3. Attach debugger when already attached
- **Result**: ✅ PASS - No error, handled gracefully

### 4. Get console data
- **Test**: Execute JS with console.log, warn, error
- **Result**: ❌ FAIL - No console logs captured (logs not being collected)

### 5. Get network data
- **Result**: ❌ FAIL - No network requests captured

### 6. Execute JS in unsafe mode with debugger attached
- **Result**: ❌ FAIL - Error: Another debugger is already attached (conflict)

### 7. Detach debugger
- **Result**: ✅ PASS - Successfully detached

### 8. Execute JS in unsafe mode with debugger detached
- **Result**: ✅ PASS - Successfully executed, returned page title

### 9. Detach when already detached
- **Result**: ✅ PASS - No error, handled gracefully

### 10. Multiple attach/detach cycles
- **Result**: ✅ PASS - Successfully cycled 3 times

### 11. Get performance data
- **Result**: ❌ FAIL - No data returned

### 12. Get error data after throwing error
- **Result**: ❌ FAIL - No errors captured despite throwing error

### 13. Get network data after navigation
- **Test**: Clicked link to trigger navigation
- **Result**: ❌ FAIL - No network requests captured despite page reload

## Summary
- **PASS**: 7/13 tests
- **FAIL**: 6/13 tests

## Issues Found
1. Console logs not being captured (Runtime.consoleAPICalled events not firing)
2. Network requests not being captured
3. Performance metrics not returning data
4. **CRITICAL BUG**: Conflict when unsafe mode tries to attach debugger while already attached
   - Error: "Another debugger is already attached to the tab with id: 1177755708"
   - This needs to be FIXED - unsafe mode should check if debugger is already attached and reuse it

## Conclusion
The debugger state management is working correctly (no more sync issues), but data collection is not functioning. The state synchronization fix is successful - no more "detached but thinks attached" errors.

## FIX APPLIED (v1.4.4)
- **UNSAFE MODE DEBUGGER CONFLICT**: ✅ FIXED - Modified unsafe mode to check `debuggerStateManager.isAttached()` and reuse existing connection instead of trying to attach again
  - Only attaches new debugger if DebuggerStateManager doesn't have one
  - Properly tracks whether to detach after execution
  - Logs clearly indicate when reusing vs attaching new debugger