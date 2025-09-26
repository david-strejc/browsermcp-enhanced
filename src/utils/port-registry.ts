import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { isPortInUse } from './port';

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
    this.instanceId = process.env.MCP_INSTANCE_ID || uuidv4();
  }

  private async acquireLock(): Promise<void> {
    const startTime = Date.now();
    while (fs.existsSync(LOCK_FILE)) {
      if (Date.now() - startTime > MAX_LOCK_WAIT_MS) {
        // Force unlock if lock is stale
        try {
          const stat = fs.statSync(LOCK_FILE);
          if (Date.now() - stat.mtimeMs > 5000) {
            fs.unlinkSync(LOCK_FILE);
            break;
          }
        } catch {}
        throw new Error('Failed to acquire registry lock');
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    fs.writeFileSync(LOCK_FILE, process.pid.toString());
  }

  private releaseLock(): void {
    try {
      fs.unlinkSync(LOCK_FILE);
    } catch {}
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
      this.releaseLock();
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
        this.releaseLock();
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
      this.releaseLock();
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
      manager.releaseLock();
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