// Browser MCP Enhanced - Background Service Worker
// Supports both single-instance (legacy) and multi-instance modes

// Check if multi-instance mode is enabled
chrome.storage.local.get(['multiInstance'], (result) => {
  const multiInstanceEnabled = result.multiInstance === true;

  if (multiInstanceEnabled) {
    console.log('[Background] Loading multi-instance mode...');
    // Import multi-instance background script
    importScripts('background-multi-instance.js');
  } else {
    console.log('[Background] Loading single-instance mode...');
    // Import legacy background script
    importScripts('background-legacy.js');
  }
});

// Migration helper - set default mode on install/update
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Default to single-instance mode for backwards compatibility
    chrome.storage.local.set({
      multiInstance: false,
      unsafeMode: false
    }, () => {
      console.log('[Background] Extension installed with default settings');
    });
  } else if (details.reason === 'update') {
    // Check if multiInstance setting exists
    chrome.storage.local.get(['multiInstance'], (result) => {
      if (result.multiInstance === undefined) {
        // Set to false to maintain backwards compatibility
        chrome.storage.local.set({ multiInstance: false }, () => {
          console.log('[Background] Extension updated, multi-instance mode disabled by default');
        });
      }
    });
  }
});