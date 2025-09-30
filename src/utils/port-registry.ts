import fs from 'fs/promises';
import { constants } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { isPortInUse } from './port';
import crypto from 'crypto';

const REGISTRY_FILE = '/tmp/browsermcp-ports.json';
const PORT_RANGE_START = 8765;
const PORT_RANGE_END = 8775;
const LOCK_FILE = `${REGISTRY_FILE}.lock`;
const MAX_LOCK_WAIT_MS = 5000;

interface PortRegistryEntry {
  port: number;
  instanceId: string;
  pid: number;
  createdAt: number;
  lastHeartbeat: number;
}

interface PortRegistry {
  instances: PortRegistryEntry[];
}

export class PortRegistryManager {
  private instanceId: string;
  private port: number | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Generate unique instance ID using process ID and random bytes to prevent collisions
    const pid = process.pid.toString();
    const randomBytes = crypto.randomBytes(8).toString('hex');
    this.instanceId = process.env.MCP_INSTANCE_ID || `${pid}-${randomBytes}-${Date.now()}`;
  }

  private async acquireLock(): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < MAX_LOCK_WAIT_MS) {
      try {
        // Atomic create-exclusive operation using async I/O
        // O_CREAT | O_EXCL | O_WRONLY flags ensure atomicity
        const handle = await fs.open(LOCK_FILE, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
        try {
          await handle.writeFile(process.pid.toString());
        } finally {
          await handle.close();
        }
        return; // Success! Lock acquired atomically
      } catch (err: any) {
        if (err.code !== 'EEXIST') {
          // Unexpected error (permissions, etc.)
          throw err;
        }

        // Lock file exists - check if it's stale
        try {
          const stats = await fs.stat(LOCK_FILE);
          const age = Date.now() - stats.mtimeMs;

          if (age > 5000) {
            // Stale lock detected - try to remove it
            try {
              await fs.unlink(LOCK_FILE);
              console.log('[PortRegistry] Removed stale lock (age: ' + age + 'ms)');
              continue; // Retry immediately after removing stale lock
            } catch (unlinkErr: any) {
              // Someone else may have removed it already
              if (unlinkErr.code !== 'ENOENT') {
                console.warn('[PortRegistry] Failed to remove stale lock:', unlinkErr);
              }
            }
          }
        } catch (statErr: any) {
          // Lock file disappeared between EEXIST and stat - that's OK, retry
          if (statErr.code === 'ENOENT') {
            continue;
          }
        }

        // Lock is valid and held by another process - wait and retry
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

  private readRegistry(): PortRegistry {
    try {
      if (fs.existsSync(REGISTRY_FILE)) {
        const data = fs.readFileSync(REGISTRY_FILE, 'utf-8');
        return JSON.parse(data);
      }
    } catch (err) {
      console.error('Failed to read registry:', err);
    }
    return { instances: [] };
  }

  private writeRegistry(registry: PortRegistry): void {
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
  }

  private cleanStaleEntries(registry: PortRegistry): PortRegistry {
    const now = Date.now();
    const STALE_THRESHOLD = 60000; // 1 minute

    registry.instances = registry.instances.filter(entry => {
      // Check if process is still alive
      try {
        process.kill(entry.pid, 0);
        // Check if heartbeat is recent
        return (now - entry.lastHeartbeat) < STALE_THRESHOLD;
      } catch {
        // Process doesn't exist
        return false;
      }
    });

    return registry;
  }

  async allocatePort(): Promise<{ port: number; instanceId: string }> {
    await this.acquireLock();

    try {
      let registry = this.readRegistry();
      registry = this.cleanStaleEntries(registry);

      // Find an available port
      for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
        // Check if port is already registered
        const isRegistered = registry.instances.some(entry => entry.port === port);
        if (isRegistered) continue;

        // Check if port is actually in use (double-check)
        if (await isPortInUse(port)) continue;

        // Allocate this port
        const entry: PortRegistryEntry = {
          port,
          instanceId: this.instanceId,
          pid: process.pid,
          createdAt: Date.now(),
          lastHeartbeat: Date.now()
        };

        registry.instances.push(entry);
        this.writeRegistry(registry);

        this.port = port;
        this.startHeartbeat();

        // Log to stdout for debugging
        console.log(`[PortRegistry] Allocated port ${port} for instance ${this.instanceId}`);
        console.log(`PORT=${port}`); // For external discovery

        return { port, instanceId: this.instanceId };
      }

      throw new Error(`No available ports in range ${PORT_RANGE_START}-${PORT_RANGE_END}`);
    } finally {
      await this.releaseLock();
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatInterval) return;

    this.heartbeatInterval = setInterval(async () => {
      if (!this.port) return;

      await this.acquireLock();
      try {
        let registry = this.readRegistry();
        const entry = registry.instances.find(
          e => e.instanceId === this.instanceId && e.port === this.port
        );

        if (entry) {
          entry.lastHeartbeat = Date.now();
          this.writeRegistry(registry);
        }
      } finally {
        await this.releaseLock();
      }
    }, 30000); // Every 30 seconds
  }

  async releasePort(): Promise<void> {
    if (!this.port) return;

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    await this.acquireLock();
    try {
      let registry = this.readRegistry();
      registry.instances = registry.instances.filter(
        entry => !(entry.instanceId === this.instanceId && entry.port === this.port)
      );
      this.writeRegistry(registry);

      console.log(`[PortRegistry] Released port ${this.port} for instance ${this.instanceId}`);
    } finally {
      await this.releaseLock();
    }

    this.port = null;
  }

  getInstanceId(): string {
    return this.instanceId;
  }

  getPort(): number | null {
    return this.port;
  }

  // Static method to get all active instances
  static async getActiveInstances(): Promise<PortRegistryEntry[]> {
    const manager = new PortRegistryManager();
    await manager.acquireLock();

    try {
      let registry = manager.readRegistry();
      registry = manager.cleanStaleEntries(registry);
      manager.writeRegistry(registry);
      return registry.instances;
    } finally {
      await manager.releaseLock();
    }
  }
}

// Cleanup on process exit
process.on('exit', () => {
  const manager = new PortRegistryManager();
  manager.releasePort().catch(console.error);
});

process.on('SIGINT', async () => {
  const manager = new PortRegistryManager();
  await manager.releasePort();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  const manager = new PortRegistryManager();
  await manager.releasePort();
  process.exit(0);
});