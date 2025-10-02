import { DaemonMessageQueue, QueuedDaemonMessage } from "./queue";
import type { Context } from "../../context";
import { createDaemonMessageSender } from "./sender";
import type { MessageType, MessagePayload } from "../../types/messages";

interface ExtensionMessage<TMap> {
  messageId: string;
  type: MessageType<TMap>;
  payload: MessagePayload<TMap, MessageType<TMap>>;
}

export class ExtensionProcessor<TMap> {
  private readonly context: Context;
  private readonly queue: DaemonMessageQueue<TMap>;
  private readonly sender: ReturnType<typeof createDaemonMessageSender<TMap>>;

  constructor(context: Context, queue?: DaemonMessageQueue<TMap>) {
    this.context = context;
    this.queue = queue ?? new DaemonMessageQueue<TMap>();
    this.sender = createDaemonMessageSender<TMap>(context.instanceId);
  }

  enqueue(message: QueuedDaemonMessage<TMap>) {
    this.queue.enqueue(message);
  }

  drain(): QueuedDaemonMessage<TMap>[] {
    return this.queue.drain();
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  async send(type: MessageType<TMap>, payload: MessagePayload<TMap, typeof type>, tabId?: string) {
    return this.sender.sendDaemonMessage(type, payload, { tabId });
  }
}
