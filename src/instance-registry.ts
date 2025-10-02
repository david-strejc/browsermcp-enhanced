import { Context } from "./context";

export interface InstanceRecord {
  sessionId: string;
  context: Context;
  createdAt: number;
}

export type ContextFactory = (sessionId: string) => Context;

export class InstanceRegistry {
  private readonly instances = new Map<string, InstanceRecord>();
  private readonly createContext: ContextFactory;

  constructor(factory: ContextFactory) {
    this.createContext = factory;
  }

  ensure(sessionId: string): InstanceRecord {
    const existing = this.instances.get(sessionId);
    if (existing) {
      return existing;
    }

    const context = this.createContext(sessionId);
    const record: InstanceRecord = {
      sessionId,
      context,
      createdAt: Date.now(),
    };

    this.instances.set(sessionId, record);
    return record;
  }

  get(sessionId: string): InstanceRecord | undefined {
    return this.instances.get(sessionId);
  }

  has(sessionId: string): boolean {
    return this.instances.has(sessionId);
  }

  entries(): InstanceRecord[] {
    return Array.from(this.instances.values());
  }

  async release(sessionId: string): Promise<void> {
    const record = this.instances.get(sessionId);
    if (!record) return;

    try {
      await record.context.close();
    } catch (error) {
      console.warn('[BrowserMCP HTTP] Error closing context', error);
    } finally {
      this.instances.delete(sessionId);
    }
  }

  async clear(): Promise<void> {
    const releases = Array.from(this.instances.keys()).map((id) => this.release(id));
    await Promise.allSettled(releases);
    this.instances.clear();
  }
}
