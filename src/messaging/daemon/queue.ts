import { MessageType, MessagePayload } from "../../types/messages";

export interface QueuedDaemonMessage<TMap> {
  sessionId: string;
  tabId?: string;
  message: {
    messageId: string;
    type: MessageType<TMap>;
    payload: MessagePayload<TMap, MessageType<TMap>>;
  };
  receivedAt: number;
}

export class DaemonMessageQueue<TMap> {
  private queue: QueuedDaemonMessage<TMap>[] = [];

  enqueue(message: QueuedDaemonMessage<TMap>) {
    this.queue.push(message);
  }

  drain(): QueuedDaemonMessage<TMap>[] {
    const items = [...this.queue];
    this.queue.length = 0;
    return items;
  }

  get length(): number {
    return this.queue.length;
  }
}
