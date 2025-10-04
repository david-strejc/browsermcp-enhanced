import { BrowserMCPError } from "../ws/sender";
import { MessageType, MessagePayload, MessageResponse } from "../../types/messages";

interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
}

interface SendMessageOptions {
  timeoutMs?: number;
  retry?: RetryOptions;
  tabId?: string;
}

const DEFAULT_DAEMON_URL = process.env.BROWSER_MCP_DAEMON_URL || "http://127.0.0.1:8765";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function createDaemonMessageSender<TMap>(
  sessionId: string,
  daemonUrl: string = DEFAULT_DAEMON_URL
) {
  let messageCounter = 0;

  const sendDaemonMessage = async <T extends MessageType<TMap>>(
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
        backoffMultiplier: 2,
      },
      tabId,
    } = options;

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= (retry.maxRetries ?? 0); attempt++) {
      try {
        return await sendOnce<T, TMap>({
          type,
          payload,
          timeoutMs,
          sessionId,
          daemonUrl,
          tabId,
          messageId: ++messageCounter,
        });
      } catch (error) {
        lastError = error as Error;

        if (error instanceof BrowserMCPError && !error.retryable) {
          throw error;
        }

        if (attempt === (retry.maxRetries ?? 0)) {
          break;
        }

        const delay = Math.min(
          (retry.baseDelayMs ?? 1000) * Math.pow(retry.backoffMultiplier ?? 2, attempt),
          retry.maxDelayMs ?? 5000,
        );

        await sleep(delay);
      }
    }

    throw new BrowserMCPError(
      `Failed after ${(retry.maxRetries ?? 0) + 1} attempts: ${lastError?.message ?? "unknown error"}`,
      "MAX_RETRIES_EXCEEDED",
      false,
      { originalError: lastError?.message, attempts: (retry.maxRetries ?? 0) + 1 }
    );
  };

  return { sendDaemonMessage };
}

interface SendOnceArgs<T, TMap> {
  type: T;
  payload: MessagePayload<TMap, T>;
  timeoutMs: number;
  sessionId: string;
  daemonUrl: string;
  tabId?: string;
  messageId: number;
}

async function sendOnce<T extends MessageType<TMap>, TMap>({
  type,
  payload,
  timeoutMs,
  sessionId,
  daemonUrl,
  tabId,
  messageId,
}: SendOnceArgs<T, TMap>): Promise<MessageResponse<TMap, T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${daemonUrl.replace(/\/$/, "")}/commands`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Instance-ID": sessionId,
        ...(tabId ? { "X-Tab-ID": tabId } : {}),
      },
      body: JSON.stringify({
        id: messageId,
        type,
        payload,
      }),
      signal: controller.signal,
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : {};

    if (response.status === 404) {
      throw new BrowserMCPError(
        data?.error || "Instance not connected",
        "INSTANCE_NOT_CONNECTED",
        true
      );
    }

    if (response.status === 504) {
      throw new BrowserMCPError(
        data?.error || "Daemon timed out waiting for extension",
        "COMMAND_TIMEOUT",
        true
      );
    }

    if (!response.ok) {
      throw new BrowserMCPError(
        data?.error || `Daemon returned HTTP ${response.status}`,
        "DAEMON_ERROR",
        response.status >= 500,
        { status: response.status }
      );
    }

    if (!data || typeof data !== "object") {
      throw new BrowserMCPError(
        "Invalid daemon response",
        "INVALID_DAEMON_RESPONSE",
        true
      );
    }

    if (data.success === false) {
      throw new BrowserMCPError(
        data.error || "Daemon reported failure",
        "COMMAND_FAILED",
        false,
        data.details
      );
    }

    return data.payload as MessageResponse<TMap, T>;
  } catch (error) {
    if (error instanceof BrowserMCPError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      throw new BrowserMCPError(
        "Timed out waiting for daemon response",
        "COMMAND_TIMEOUT",
        true
      );
    }

    throw new BrowserMCPError(
      `Failed to contact daemon: ${(error as Error).message}`,
      "DAEMON_REQUEST_FAILED",
      true,
      { originalError: (error as Error).message }
    );
  } finally {
    clearTimeout(timeout);
  }
}
