// Browser MCP Enhanced - Service Worker with Conditional Mode Activation
// Load all scripts upfront, then conditionally activate based on storage settings

// Static imports - must be at top level for Chrome service workers
// All scripts must be imported here, including dependencies
importScripts(
  'unified-connection-manager.js',  // Unified single-port connection (NEW)
  'multi-instance-manager.js',      // Required by background-multi-instance.js
  'background-legacy-wrapper.js',   // defines self.LegacyMode (controller pattern)
  'background-multi-instance.js',   // defines self.MultiInstanceMode
  'background-unified.js'           // defines self.UnifiedMode (NEW)
);

const TAG = '[Background]';
const log = (...args) => console.log(TAG, new Date().toISOString(), ...args);
const warn = (...args) => console.warn(TAG, new Date().toISOString(), ...args);
const error = (...args) => console.error(TAG, new Date().toISOString(), ...args);

// Debug flag for verbose logging
self.__DEBUG = true;

// Currently active controller
let activeController = null;

/**
 * Activate the appropriate mode controller
 */
function activate(multiInstanceEnabled) {
  log(`Activating ${multiInstanceEnabled ? 'multi' : 'single'}-instance mode...`);

  // Deactivate previous controller if exists
  if (activeController) {
    try {
      activeController.deinit();
      log('Previous mode deinitialized');
    } catch (err) {
      error('Error deinitializing previous mode:', err);
    }
  }

  // Activate new controller
  try {
    // NEW: Use UnifiedMode by default (single-listener architecture)
    activeController = multiInstanceEnabled ? self.MultiInstanceMode : self.UnifiedMode;

    if (!activeController) {
      throw new Error(`Mode controller not found for ${multiInstanceEnabled ? 'multi' : 'unified'}-instance`);
    }

    activeController.init();
    log(`Successfully activated ${multiInstanceEnabled ? 'multi' : 'unified'}-instance mode`);
  } catch (err) {
    error('Failed to activate mode:', err);
    error('Stack trace:', err.stack);

    // Try fallback to unified mode
    if (multiInstanceEnabled && self.UnifiedMode) {
      warn('Attempting fallback to unified mode...');
      try {
        activeController = self.UnifiedMode;
        activeController.init();
        warn('Fallback to unified mode successful');
      } catch (fallbackErr) {
        error('Fallback also failed:', fallbackErr);
      }
    }
  }
}

/**
 * Initial bootstrap - read config and activate appropriate mode
 */
async function bootstrap() {
  log('Service worker starting...');

  try {
    const config = await chrome.storage.local.get(['multiInstance', 'unsafeMode']);
    const multiInstanceEnabled = config.multiInstance === true;
    const unsafeModeEnabled = config.unsafeMode === true;

    log('Configuration loaded:', {
      multiInstance: multiInstanceEnabled,
      unsafeMode: unsafeModeEnabled
    });

    // Store unsafe mode globally for both modes to access
    self.unsafeMode = unsafeModeEnabled;

    // Activate the appropriate mode
    activate(multiInstanceEnabled);
  } catch (err) {
    error('Bootstrap failed:', err);
    // Default to legacy mode on error
    activate(false);
  }
}

/**
 * Handle storage changes - switch modes when configuration changes
 */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  // Handle multiInstance mode change
  if (changes.multiInstance) {
    const oldValue = changes.multiInstance.oldValue;
    const newValue = changes.multiInstance.newValue;
    const multiInstanceEnabled = newValue === true;

    log(`Multi-instance mode changed from ${oldValue} to ${newValue}`);
    activate(multiInstanceEnabled);
  }

  // Handle unsafeMode change
  if (changes.unsafeMode) {
    const newValue = changes.unsafeMode.newValue;
    self.unsafeMode = newValue === true;
    log(`Unsafe mode changed to ${self.unsafeMode}`);

    // Notify active controller about unsafe mode change
    if (activeController && activeController.onUnsafeModeChanged) {
      activeController.onUnsafeModeChanged(self.unsafeMode);
    }
  }
});

/**
 * Handle installation and updates
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  log('Extension installed/updated:', details.reason);

  if (details.reason === 'install') {
    // Set default configuration for new installations
    await chrome.storage.local.set({
      multiInstance: false,
      unsafeMode: false
    });
    log('Default settings configured for new installation');

    // Activate with defaults
    activate(false);
  } else if (details.reason === 'update') {
    // Ensure multiInstance setting exists for upgrades
    const config = await chrome.storage.local.get('multiInstance');
    if (config.multiInstance === undefined) {
      await chrome.storage.local.set({ multiInstance: false });
      log('Multi-instance mode disabled by default for upgrade');
    }

    // Re-bootstrap after update
    bootstrap();
  }
});

/**
 * Service worker lifecycle events
 */
self.addEventListener('activate', (event) => {
  log('Service worker activated');
  // Keep worker alive during initialization
  event.waitUntil(
    new Promise(resolve => {
      setTimeout(resolve, 2000); // 2 second delay for initialization
    }).then(() => clients.claim())
  );
});

self.addEventListener('install', (event) => {
  log('Service worker installed');
  event.waitUntil(self.skipWaiting());
});

// Heartbeat for debugging
if (self.__DEBUG) {
  setInterval(() => {
    log('Service worker heartbeat - still alive');
    if (activeController) {
      const mode = activeController === self.MultiInstanceMode ? 'multi-instance' :
                   activeController === self.UnifiedMode ? 'unified' : 'legacy';
      log('Active mode:', mode);
    }
  }, 30000); // Every 30 seconds
}

// Start the bootstrap process
log('Starting bootstrap process...');
bootstrap().catch(err => {
  error('Uncaught error during bootstrap:', err);
});