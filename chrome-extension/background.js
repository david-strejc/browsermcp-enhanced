// Browser MCP Enhanced - Daemon-based service worker
// Loads the unified connection manager and daemon controller

importScripts(
  'unified-connection-manager.js',
  'background-daemon.js'
);

const TAG = '[Background]';
const log = (...args) => console.log(TAG, new Date().toISOString(), ...args);
const error = (...args) => console.error(TAG, new Date().toISOString(), ...args);

let controller = null;

async function bootstrap() {
  log('Service worker bootstrap starting...');
  try {
    controller = self.UnifiedDaemonMode;
    if (!controller) {
      throw new Error('UnifiedDaemonMode controller not found');
    }

    const config = await chrome.storage.local.get(['unsafeMode']);
    if (controller.onUnsafeModeChanged) {
      controller.onUnsafeModeChanged(config.unsafeMode === true);
    }

    await controller.init();
    log('Daemon mode initialized');
  } catch (err) {
    error('Bootstrap failed:', err);
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  log('Extension installed/updated:', details.reason);
  if (details.reason === 'install') {
    await chrome.storage.local.set({ unsafeMode: false });
  }
  bootstrap();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.unsafeMode && controller && controller.onUnsafeModeChanged) {
    controller.onUnsafeModeChanged(changes.unsafeMode.newValue === true);
  }
});

self.addEventListener('activate', (event) => {
  log('Service worker activated');
  event.waitUntil(clients.claim());
});

self.addEventListener('install', (event) => {
  log('Service worker installed');
  event.waitUntil(self.skipWaiting());
});

bootstrap();
