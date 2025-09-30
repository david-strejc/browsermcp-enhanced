import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// ES module equivalents for __dirname and __filename
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Hot Reload System for BrowserMCP
 *
 * Watches src/ directory for changes, rebuilds, and triggers clean exit
 * to let Claude Desktop respawn the server with fresh code.
 *
 * Usage:
 *   import { enableHotReload } from './hot-reload';
 *   enableHotReload(server);
 */

interface HotReloadOptions {
  watchPath?: string;
  debounceMs?: number;
  buildCommand?: string;
  buildArgs?: string[];
  verbose?: boolean;
}

const DEFAULT_OPTIONS: Required<HotReloadOptions> = {
  watchPath: path.join(__dirname, '..', 'src'),
  debounceMs: 500,
  buildCommand: 'npm',
  buildArgs: ['run', 'build'],
  verbose: true
};

let isReloading = false;
let debounceTimer: NodeJS.Timeout | null = null;
let watcher: fs.FSWatcher | null = null;

function log(message: string, ...args: any[]) {
  console.error(`[HotReload] ${message}`, ...args);
}

function triggerBuildAndReload(options: Required<HotReloadOptions>) {
  if (isReloading) {
    if (options.verbose) log('Reload already in progress, skipping...');
    return;
  }

  isReloading = true;

  if (options.verbose) log('File change detected, rebuilding and deploying...');

  // Run build
  const buildProcess = spawn(options.buildCommand, options.buildArgs, {
    stdio: 'inherit',
    shell: true
  });

  buildProcess.on('close', (code) => {
    if (code === 0) {
      if (options.verbose) log('Build successful! Copying to deployed location...');

      // Copy dist and package.json to deployed location
      const deployProcess = spawn('bash', ['-c', 'cp -r dist/* /home/david/.local/lib/browsermcp-enhanced/dist/ && cp package.json /home/david/.local/lib/browsermcp-enhanced/'], {
        stdio: 'inherit',
        shell: false,
        cwd: path.join(options.watchPath, '..')
      });

      deployProcess.on('close', (deployCode) => {
        if (deployCode === 0) {
          if (options.verbose) {
            log('Deploy successful! Exiting for systemd/Claude to respawn...');
            log('HTTP transport will auto-reconnect in ~3 seconds.');
          }

          // Clean exit - systemd will respawn with fresh code
          setTimeout(() => {
            process.exit(0);
          }, 100);
        } else {
          log(`Deploy failed with code ${deployCode}`);
          isReloading = false;
        }
      });

      deployProcess.on('error', (err) => {
        log('Deploy error:', err);
        isReloading = false;
      });
    } else {
      if (options.verbose) {
        log(`Build failed with code ${code}. Server continues running with old code.`);
      }
      isReloading = false;
    }
  });

  buildProcess.on('error', (err) => {
    log('Build error:', err);
    isReloading = false;
  });
}

function startWatching(options: Required<HotReloadOptions>) {
  if (options.verbose) {
    log(`Watching ${options.watchPath} for changes...`);
  }

  try {
    watcher = fs.watch(options.watchPath, { recursive: true }, (eventType, filename) => {
      if (!filename) return;

      // Ignore non-TypeScript files and test files
      if (!filename.endsWith('.ts') || filename.includes('.test.') || filename.includes('.spec.')) {
        return;
      }

      // Ignore hot-reload.ts itself to prevent infinite loops
      if (filename.includes('hot-reload.ts')) {
        return;
      }

      if (options.verbose) {
        log(`Change detected in ${filename}`);
      }

      // Debounce multiple rapid changes
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      debounceTimer = setTimeout(() => {
        triggerBuildAndReload(options);
      }, options.debounceMs);
    });

    if (options.verbose) {
      log('Hot reload enabled! Edit any .ts file to trigger rebuild and respawn.');
    }
  } catch (err) {
    log('Failed to start file watcher:', err);
  }
}

/**
 * Enable hot reload for development
 *
 * @param options - Configuration options
 */
export function enableHotReload(options: HotReloadOptions = {}) {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };

  // Verify watch path exists
  if (!fs.existsSync(mergedOptions.watchPath)) {
    log(`Watch path does not exist: ${mergedOptions.watchPath}`);
    return;
  }

  startWatching(mergedOptions);

  // Handle manual reload signal (USR2)
  process.on('SIGUSR2', () => {
    log('Received USR2 signal, triggering manual reload...');
    triggerBuildAndReload(mergedOptions);
  });

  // Cleanup on exit
  process.on('exit', () => {
    if (watcher) {
      watcher.close();
    }
  });
}

/**
 * Disable hot reload (useful for production)
 */
export function disableHotReload() {
  if (watcher) {
    watcher.close();
    watcher = null;
    log('Hot reload disabled');
  }
}