import { WebSocket } from 'ws';
import { MessageType, MessagePayload, MessageResponse } from '../../types/messages';

let messageId = 0;

export function createSocketMessageSender<TMap>(ws: WebSocket) {
  const sendSocketMessage = async <T extends MessageType<TMap>>(
    type: T,
    payload: MessagePayload<TMap, T>,
    options: { timeoutMs?: number } = { timeoutMs: 30000 }
  ): Promise<MessageResponse<TMap, T>> => {
    return new Promise((resolve, reject) => {
      const id = ++messageId;
      const message = JSON.stringify({ id, type, payload });
      
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout waiting for response to message ${id} (${String(type)})`));
      }, options.timeoutMs);
      
      const handler = (data: any) => {
        try {
          const response = JSON.parse(data.toString());
          if (response.id === id) {
            clearTimeout(timeout);
            ws.removeListener('message', handler);
            if (response.error) {
              reject(new Error(response.error));
            } else {
              resolve(response.payload);
            }
          }
        } catch (e) {
          // Ignore parsing errors
        }
      };
      
      ws.on('message', handler);
      ws.send(message);
    });
  };
  
  return { sendSocketMessage };
}