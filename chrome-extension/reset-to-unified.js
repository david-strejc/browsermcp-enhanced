// Temporary script to reset extension to unified mode
// Run this in the extension's service worker console

(async function() {
  console.log('[Reset] Setting extension to unified mode...');

  await chrome.storage.local.set({
    multiInstance: false  // This will trigger unified mode
  });

  const config = await chrome.storage.local.get(['multiInstance', 'unsafeMode']);
  console.log('[Reset] Current config:', config);
  console.log('[Reset] Extension will now use unified mode');
  console.log('[Reset] Reload the extension to apply changes');
})();
