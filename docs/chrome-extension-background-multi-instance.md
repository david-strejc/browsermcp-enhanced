# Chrome Extension Background Controller (`chrome-extension/background-multi-instance.js`)

## Overview
Provides the orchestration layer for the browser extension when multi-instance mode is active. It coordinates tab ownership, message routing, and lifecycle hooks across multiple Claude Desktop clients connected simultaneously.

## Core Concepts
- **MultiInstanceManager Integration**: Instantiates `self.MultiInstanceManager`, injects all required message handlers, and reassigns the manager’s `messageHandlers` map once configuration is complete.
- **Instance-Scoped State**: Tracks `activeTabId` per Claude instance, manages tab locks, and records tab ownership via helper utilities (`getOrCreateInstance`, `markTabForInstance`).
- **Message Handling**: Populates a comprehensive handler map handling navigation, DOM interactions, screenshots, debugging, and legacy aliases.

## Initialization Flow
1. `init()` updates `extensionConfig`, calls `initializeMultiInstance()`, and registers Chrome event listeners.
2. `initializeMultiInstance()` creates the manager, calls `setupMessageHandlers()`, and finally assigns the populated handler map to `manager.messageHandlers` before logging diagnostics.
3. Event listeners for `chrome.runtime` and `chrome.tabs` keep controller state synchronized with browser activity and clean up resources on tab closure.

## Tab Isolation Strategy
- `ensureActiveTab(targetUrl, instanceId)` is rewritten to guarantee each instance has exclusive access to its tab. It tries to reuse existing tabs when the lock can be reacquired; otherwise it creates a dedicated tab and secures a lock via `MultiInstanceManager.acquireTabLock`.
- On disconnection, `cleanupInstanceTabs` iterates the instance’s tabs, releasing locks and closing tabs to prevent leakage.

## Handler Highlights
- **Navigation (`browser_navigate`)**: Ensures tab ownership, updates URL, waits for `complete` status, optionally captures popup metadata and scaffold snapshots, and annotates debug info.
- **DOM Ops**: Includes `dom.click`, `dom.type`, `dom.hover`, `dom.select`, `dom.query`, `dom.expand`, all of which rely on injected trackers to locate elements by reference.
- **Snapshots**: `snapshot.accessibility` conditionally injects scripts (`element-tracker`, `scaffold-enhanced`, `minimal-enhanced`) and supports modes (`standard`, `scaffold`, `minimal`).
- **Debugging**: Bridges Chrome debugger attach/detach flows and provides stubbed `debugger.getData` responses.
- **Utility Aliases**: Maintains backwards compatibility (`browser_press_key`, `browser_wait`, `status`, etc.) while routing to unified handlers.

## Event Lifecycle
- `listeners.onMessage` routes messages either through the manager (when `instanceId` present) or directly to handler functions for legacy messages.
- `listeners.onTabsRemoved` and `onTabsActivated` keep `activeTabId` consistent and release locks promptly when tabs close.

## Unsafe Mode Handling
- `onUnsafeModeChanged(enabled)` toggles `extensionConfig.unsafeMode`, guarding privileged script execution (e.g., `js.execute` with `world: 'MAIN'`).

## Deinitialization
- `deinit()` removes all registered listeners, calls `multiInstanceManager.cleanup()`, and clears local handler maps to reset the controller when multi-instance mode is disabled.

## Debug Instrumentation
- Extensive logging (`[BG-Multi]`) timestamps major actions, aiding diagnosis when coordinating multiple MCP instances or troubleshooting lock contention.
