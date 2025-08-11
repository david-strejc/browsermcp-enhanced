import { WebSocket } from 'ws';
import { MessageType, MessagePayload, MessageResponse } from '../../types/messages';

let messageId = 0;

// Enhanced error types for better error handling
export class BrowserMCPError extends Error {
  constructor(
    message: string,
    public code: string,
    public retryable: boolean = false,
    public details?: any
  ) {
    super(message);
    this.name = 'BrowserMCPError';
  }
}

// Retry configuration interface
interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
}

// Enhanced options interface
interface SendMessageOptions {
  timeoutMs?: number;
  retry?: RetryOptions;
}

// Sleep utility for retries
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function createSocketMessageSender<TMap>(ws: WebSocket) {
  const sendSocketMessage = async <T extends MessageType<TMap>>(
    type: T,
    payload: MessagePayload<TMap, T>,
    options: SendMessageOptions = {}
  ): Promise<MessageResponse<TMap, T>> => {
    const {
      timeoutMs = 30000,
      retry = {
        maxRetries: 2,
        baseDelayMs: 1000,
        maxDelayMs: 5000,
        backoffMultiplier: 2
      }
    } = options;

    let lastError: Error;
    
    for (let attempt = 0; attempt <= retry.maxRetries; attempt++) {
      try {
        return await sendSingleMessage<T, TMap>(ws, type, payload, { timeoutMs });
      } catch (error) {
        lastError = error as Error;
        
        // Don't retry on certain error types
        if (error instanceof BrowserMCPError && !error.retryable) {
          throw error;
        }
        
        // Don't retry on the last attempt
        if (attempt === retry.maxRetries) {
          break;
        }
        
        // Calculate exponential backoff delay
        const delay = Math.min(
          retry.baseDelayMs! * Math.pow(retry.backoffMultiplier!, attempt),
          retry.maxDelayMs!
        );
        
        console.warn(`[BrowserMCP] Attempt ${attempt + 1} failed for ${String(type)}, retrying in ${delay}ms:`, error.message);
        await sleep(delay);
      }
    }
    
    // If we get here, all retries failed
    throw new BrowserMCPError(
      `Failed after ${retry.maxRetries + 1} attempts: ${lastError.message}`,
      'MAX_RETRIES_EXCEEDED',
      false,
      { originalError: lastError.message, attempts: retry.maxRetries + 1 }
    );
  };
  
  return { sendSocketMessage };
}

// Internal function for single message sending
async function sendSingleMessage<T extends MessageType<TMap>, TMap>(
  ws: WebSocket,
  type: T,
  payload: MessagePayload<TMap, T>,
  options: { timeoutMs: number }
): Promise<MessageResponse<TMap, T>> {
  return new Promise((resolve, reject) => {
    const id = ++messageId;
    const message = JSON.stringify({ id, type, payload });
    
    // Check WebSocket state before sending
    if (ws.readyState !== WebSocket.OPEN) {
      reject(new BrowserMCPError(
        'WebSocket is not connected',
        'CONNECTION_CLOSED',
        true // This is retryable if connection gets restored
      ));
      return;
    }
    
    const timeout = setTimeout(() => {
      ws.removeListener('message', handler);
      reject(new BrowserMCPError(
        `Timeout waiting for response to message ${id} (${String(type)})`,
        'MESSAGE_TIMEOUT',
        true, // Timeouts are retryable
        { messageId: id, messageType: String(type), timeoutMs: options.timeoutMs }
      ));
    }, options.timeoutMs);
    
    const handler = (data: any) => {
      try {
        const response = JSON.parse(data.toString());
        if (response.id === id) {
          clearTimeout(timeout);
          ws.removeListener('message', handler);
          
          if (response.error) {
            // Classify error for retry decisions
            const isRetryable = classifyErrorAsRetryable(response.error);
            reject(new BrowserMCPError(
              response.error,
              'EXTENSION_ERROR',
              isRetryable,
              { messageId: id, messageType: String(type) }
            ));
          } else {
            resolve(response.payload);
          }
        }
      } catch (parseError) {
        // Only log parsing errors, don't fail the message
        console.warn('[BrowserMCP] Failed to parse WebSocket message:', parseError);
      }
    };
    
    const errorHandler = (error: any) => {
      clearTimeout(timeout);
      ws.removeListener('message', handler);
      ws.removeListener('error', errorHandler);
      reject(new BrowserMCPError(
        `WebSocket error: ${error.message}`,
        'WEBSOCKET_ERROR',
        true, // WebSocket errors are generally retryable
        { messageId: id, messageType: String(type) }
      ));
    };
    
    ws.on('message', handler);
    ws.on('error', errorHandler);
    
    try {
      ws.send(message);
    } catch (sendError) {
      clearTimeout(timeout);
      ws.removeListener('message', handler);
      ws.removeListener('error', errorHandler);
      reject(new BrowserMCPError(
        `Failed to send message: ${(sendError as Error).message}`,
        'SEND_ERROR',
        true, // Send errors are retryable
        { messageId: id, messageType: String(type) }
      ));
    }
  });
}

// Classify errors to determine if they should be retried
function classifyErrorAsRetryable(errorMessage: string): boolean {
  const nonRetryablePatterns = [
    /invalid.*reference/i,
    /element.*not.*found/i,
    /selector.*invalid/i,
    /permission.*denied/i,
    /invalid.*parameter/i,
    /schema.*validation/i
  ];
  
  const retryablePatterns = [
    /timeout/i,
    /connection/i,
    /network/i,
    /temporary/i,
    /busy/i,
    /rate.?limit/i
  ];
  
  // Check for non-retryable patterns first
  for (const pattern of nonRetryablePatterns) {
    if (pattern.test(errorMessage)) {
      return false;
    }
  }
  
  // Check for retryable patterns
  for (const pattern of retryablePatterns) {
    if (pattern.test(errorMessage)) {
      return true;
    }
  }
  
  // Default to retryable for unknown errors
  return true;
}