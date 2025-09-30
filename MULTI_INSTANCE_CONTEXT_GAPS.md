# Multi-Instance Context Gaps - Quick Reference

**Date:** 2025-09-30
**Status:** Tab isolation WORKS, but responses lack instance context

---

## 🎯 TL;DR

The multi-instance tab isolation mechanism is **fully functional** - locks, ownership tracking, and isolation all work correctly. The **ONLY gap** is that **tool responses don't include instance context**, so Claude can't see:
- Which instance it is
- What tab it's working in
- How many tabs it owns

---

## 📍 Where Instance Context Should Be Added

### 1. ARIA Snapshot Utility (HIGHEST IMPACT)
**File:** `/home/david/Work/Programming/browsermcp-enhanced/src/utils/aria-snapshot.ts`
**Lines:** 4-46
**Why:** Every tool uses this to capture page state

**Add this:**
```typescript
export async function captureAriaSnapshot(
  context: Context,
  status: string = "",
  options: {
    includeInstanceContext?: boolean;  // NEW: default true
    ...
  } = {},
): Promise<ToolResult> {
  const response = await context.sendSocketMessage("snapshot.accessibility", options);

  // ADD INSTANCE CONTEXT
  let contextInfo = '';
  if (options.includeInstanceContext !== false) {
    contextInfo = `\n[Instance: ${context.instanceId.substring(0,8)}... | Tab: ${context.currentTabId || 'none'} | Port: ${context.port}]\n`;
  }

  return {
    content: [{
      type: "text",
      text: status
        ? `${status}${contextInfo}\n${response.snapshot}`
        : `${contextInfo}${response.snapshot}`
    }]
  };
}
```

### 2. Navigation Tools
**File:** `/home/david/Work/Programming/browsermcp-enhanced/src/tools/navigation-unified.ts`
**Lines:** 84-91

**Add this:**
```typescript
if (snapshot) {
  const snapshotResult = await captureAriaSnapshot(context, "", {
    includeInstanceContext: true  // Enable context
  });
  snapshotResult.content[0].text =
    `${navigationResult}${popupInfo}\n\n` + snapshotResult.content[0].text;
  return snapshotResult;
}
```

### 3. Click/Type/Hover Tools
**File:** `/home/david/Work/Programming/browsermcp-enhanced/src/tools/snapshot.ts`
**Lines:** 55, 125, 146

**Add this:**
```typescript
// Line 55 (click tool)
const snapshot = await captureAriaSnapshot(context, "", {
  includeInstanceContext: true  // ADD THIS
});

// Line 125 (hover tool)
const snapshot = await captureAriaSnapshot(context, "", {
  includeInstanceContext: true  // ADD THIS
});

// Line 146+ (type tool)
const snapshot = await captureAriaSnapshot(context, "", {
  includeInstanceContext: true  // ADD THIS
});
```

### 4. Tab Management Tools
**File:** `/home/david/Work/Programming/browsermcp-enhanced/src/tools/tabs-unified.ts`

**Add instance context to all tab operation responses:**
```typescript
// Example for tab list:
return {
  content: [{
    type: "text",
    text: `[Instance: ${context.instanceId.substring(0,8)}... | Port: ${context.port}]\n\n${tabListText}`
  }]
};
```

---

## 🔧 Optional Enhancement: Tab Ownership Query

### Add to Context Class
**File:** `/home/david/Work/Programming/browsermcp-enhanced/src/context.ts`
**After line 201**

```typescript
async getOwnedTabs(): Promise<{
  current: number | undefined;
  owned: number[];
}> {
  try {
    const response = await this.sendSocketMessage("getOwnedTabs", {
      instanceId: this.instanceId
    });
    return {
      current: this._currentTabId,
      owned: response.tabs || []
    };
  } catch (error) {
    return {
      current: this._currentTabId,
      owned: []
    };
  }
}
```

### Add Handler in Extension
**File:** `/home/david/Work/Programming/browsermcp-enhanced/chrome-extension/background-multi-instance.js`
**After line 512**

```javascript
messageHandlers.set('getOwnedTabs', function(payload, instanceId) {
  if (!multiInstanceManager || !instanceId) {
    return Promise.resolve({ tabs: [] });
  }

  var instance = multiInstanceManager.instances.get(instanceId);
  if (!instance || !instance.tabs) {
    return Promise.resolve({ tabs: [] });
  }

  return Promise.resolve({
    tabs: Array.from(instance.tabs),
    activeTabId: instance.activeTabId
  });
});
```

---

## 📊 Current Tab Isolation Status

### ✅ What's Working (100% Complete)

| Feature | Status | Location |
|---------|--------|----------|
| Instance ID generation | ✅ Complete | `src/ws.ts` (line 28) |
| Per-connection context | ✅ Complete | `src/server.ts` (lines 50-56) |
| Tab ownership tracking | ✅ Complete | `chrome-extension/multi-instance-manager.js` (lines 287-296) |
| Lock acquisition | ✅ Complete | `chrome-extension/multi-instance-manager.js` (lines 377-467) |
| Lock release & queue | ✅ Complete | `chrome-extension/multi-instance-manager.js` (lines 469-511) |
| Stale lock detection | ✅ Complete | `chrome-extension/multi-instance-manager.js` (lines 400-419) |
| Tab access enforcement | ✅ Complete | `chrome-extension/background-multi-instance.js` (lines 199-269) |

### ❌ What's Missing

| Feature | Status | Impact |
|---------|--------|--------|
| Instance context in responses | ❌ Missing | High - Claude has no visibility |
| Tab ownership visibility | ❌ Missing | Medium - Can't see owned tabs |
| Lock conflict feedback | ❌ Missing | Low - Silent fallback works |

---

## 🎯 How Tab Isolation Works

### Instance ID Flow
```
1. Server starts → PortRegistry generates UUID
2. WebSocket connects → Context gets instanceId
3. Every message → includes instanceId
4. Extension tracks → instanceId → tabs mapping
```

### Tab Access Flow
```
1. Tool called (e.g., browser_navigate)
2. ensureActiveTab(url, instanceId)
3. Try acquire lock for existing tab
   ├─ ✅ Lock acquired → Use existing tab
   └─ ❌ Lock held by other → Create NEW tab
4. Mark tab as owned by instanceId
5. Execute operation
```

### Lock Mechanism
```
Lock States:
├─ No lock → Acquire immediately
├─ Same instance → Refresh timestamp
├─ Other instance (active) → Queue & wait (30s timeout)
└─ Other instance (stale >60s) → Force release & acquire
```

---

## 🚨 Key Code Locations

### Server Side
- **Instance ID generation:** `src/ws.ts` (line 28)
- **Context per connection:** `src/server.ts` (lines 50-56)
- **Context class:** `src/context.ts` (entire file)
- **Message sending with instanceId:** `src/messaging/ws/sender.ts` (lines 102-108)

### Extension Side
- **Multi-instance manager:** `chrome-extension/multi-instance-manager.js` (entire file)
- **Lock acquisition:** Lines 377-467
- **Lock release:** Lines 469-511
- **Tab ownership tracking:** Lines 287-296
- **Background controller:** `chrome-extension/background-multi-instance.js` (entire file)
- **ensureActiveTab (isolation logic):** Lines 199-269

### Tool Response Location
- **All tools use:** `src/utils/aria-snapshot.ts` for page snapshots
- **Navigation tools:** `src/tools/navigation-unified.ts`
- **Interaction tools:** `src/tools/snapshot.ts` (click, hover, type)
- **Tab tools:** `src/tools/tabs-unified.ts`

---

## 💡 Example: What Claude Should See

### Current Response (Missing Context)
```
Navigated to https://example.com

Page Title: Example Domain
[Element tree...]
```

### Desired Response (With Context)
```
Navigated to https://example.com

[Instance: 7f3a9b2c... | Tab: 1234 | Port: 8765]

Page Title: Example Domain
[Element tree...]
```

### With Full Context (Optional Enhancement)
```
Navigated to https://example.com

[Instance Context]
Instance ID: 7f3a9b2c-4d1e-4a5f-9c8b-2e3f1d5c6a7b
Port: 8765
Current Tab: 1234
Owned Tabs: [1234, 1235, 1236] (3 tabs)

Page Title: Example Domain
[Element tree...]
```

---

## ✅ Action Items

### Immediate (High Priority)
1. ✅ Add `includeInstanceContext` parameter to `captureAriaSnapshot()`
2. ✅ Enable instance context in navigation tools
3. ✅ Enable instance context in interaction tools (click/hover/type)
4. ✅ Enable instance context in tab management tools

### Optional (Nice to Have)
5. ⬜ Add `getOwnedTabs()` method to Context
6. ⬜ Add `getOwnedTabs` handler in extension
7. ⬜ Show owned tabs count in tool responses
8. ⬜ Add lock conflict feedback (when new tab created)

### Estimated Total Effort
- Immediate changes: 2-3 hours
- Optional enhancements: 1-2 hours
- **Total: 3-5 hours**

---

## 📖 Full Investigation Report

For complete details, see:
`/home/david/Work/Programming/browsermcp-enhanced/.claude/memories/investigations/multi_instance_tab_isolation_investigation.md`

---

**Status:** Ready for implementation
**Confidence:** Very High (line-by-line code review completed)