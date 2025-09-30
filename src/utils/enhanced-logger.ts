/**
 * Enhanced Logger for Multi-Instance Browser MCP
 *
 * Provides detailed logging with instance tracking, color coding,
 * and log level filtering for debugging multi-instance scenarios.
 */

import fs from 'fs';
import path from 'path';

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
  TRACE = 4
}

export interface LoggerConfig {
  level: LogLevel;
  logToFile: boolean;
  logDir?: string;
  includeTimestamp: boolean;
  includeInstance: boolean;
  colorize: boolean;
}

const DEFAULT_CONFIG: LoggerConfig = {
  level: LogLevel.INFO,
  logToFile: true,
  logDir: '/tmp/browsermcp-logs',
  includeTimestamp: true,
  includeInstance: true,
  colorize: true
};

// ANSI color codes
const COLORS = {
  RESET: '\x1b[0m',
  RED: '\x1b[31m',
  YELLOW: '\x1b[33m',
  GREEN: '\x1b[32m',
  BLUE: '\x1b[34m',
  MAGENTA: '\x1b[35m',
  CYAN: '\x1b[36m',
  GRAY: '\x1b[90m'
};

export class EnhancedLogger {
  private config: LoggerConfig;
  private instanceId: string;
  private port: number | null;
  private logFilePath: string | null;

  constructor(instanceId: string, port: number | null = null, config: Partial<LoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.instanceId = instanceId.substring(0, 8); // Short ID for readability
    this.port = port;
    this.logFilePath = null;

    if (this.config.logToFile && this.config.logDir) {
      // Ensure log directory exists
      if (!fs.existsSync(this.config.logDir)) {
        fs.mkdirSync(this.config.logDir, { recursive: true });
      }

      // Create instance-specific log file
      const filename = `mcp-instance-${this.instanceId}-port-${port || 'unknown'}.log`;
      this.logFilePath = path.join(this.config.logDir, filename);

      // Write header
      this.writeToFile(`\n${'='.repeat(80)}\n`);
      this.writeToFile(`Browser MCP Enhanced - Instance ${this.instanceId}\n`);
      this.writeToFile(`Started: ${new Date().toISOString()}\n`);
      this.writeToFile(`Port: ${port || 'unknown'}\n`);
      this.writeToFile(`${'='.repeat(80)}\n\n`);
    }
  }

  private writeToFile(message: string): void {
    if (this.logFilePath) {
      try {
        fs.appendFileSync(this.logFilePath, message);
      } catch (err) {
        console.error(`Failed to write to log file: ${err}`);
      }
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return level <= this.config.level;
  }

  private formatMessage(level: LogLevel, category: string, message: string, data?: any): string {
    const parts: string[] = [];

    // Timestamp
    if (this.config.includeTimestamp) {
      const timestamp = new Date().toISOString();
      parts.push(this.config.colorize ? `${COLORS.GRAY}${timestamp}${COLORS.RESET}` : timestamp);
    }

    // Instance ID
    if (this.config.includeInstance) {
      const instanceTag = this.port ? `${this.instanceId}:${this.port}` : this.instanceId;
      parts.push(this.config.colorize ? `${COLORS.CYAN}[${instanceTag}]${COLORS.RESET}` : `[${instanceTag}]`);
    }

    // Log level
    const levelStr = LogLevel[level];
    let coloredLevel = levelStr;

    if (this.config.colorize) {
      switch (level) {
        case LogLevel.ERROR:
          coloredLevel = `${COLORS.RED}${levelStr}${COLORS.RESET}`;
          break;
        case LogLevel.WARN:
          coloredLevel = `${COLORS.YELLOW}${levelStr}${COLORS.RESET}`;
          break;
        case LogLevel.INFO:
          coloredLevel = `${COLORS.GREEN}${levelStr}${COLORS.RESET}`;
          break;
        case LogLevel.DEBUG:
          coloredLevel = `${COLORS.BLUE}${levelStr}${COLORS.RESET}`;
          break;
        case LogLevel.TRACE:
          coloredLevel = `${COLORS.MAGENTA}${levelStr}${COLORS.RESET}`;
          break;
      }
    }

    parts.push(coloredLevel);

    // Category
    parts.push(this.config.colorize ? `${COLORS.CYAN}[${category}]${COLORS.RESET}` : `[${category}]`);

    // Message
    parts.push(message);

    // Data (if provided)
    let fullMessage = parts.join(' ');
    if (data !== undefined) {
      fullMessage += '\n' + JSON.stringify(data, null, 2);
    }

    return fullMessage;
  }

  private log(level: LogLevel, category: string, message: string, data?: any): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const formatted = this.formatMessage(level, category, message, data);

    // Console output
    console.log(formatted);

    // File output (without colors)
    if (this.config.logToFile) {
      const uncoloredMessage = this.formatMessage(level, category, message, data)
        .replace(/\x1b\[[0-9;]*m/g, ''); // Strip ANSI codes
      this.writeToFile(uncoloredMessage + '\n');
    }
  }

  error(category: string, message: string, data?: any): void {
    this.log(LogLevel.ERROR, category, message, data);
  }

  warn(category: string, message: string, data?: any): void {
    this.log(LogLevel.WARN, category, message, data);
  }

  info(category: string, message: string, data?: any): void {
    this.log(LogLevel.INFO, category, message, data);
  }

  debug(category: string, message: string, data?: any): void {
    this.log(LogLevel.DEBUG, category, message, data);
  }

  trace(category: string, message: string, data?: any): void {
    this.log(LogLevel.TRACE, category, message, data);
  }

  // Special logging methods for key events

  connectionEvent(event: 'opened' | 'closed' | 'error', details?: any): void {
    const eventSymbol = event === 'opened' ? '✓' : event === 'closed' ? '✗' : '⚠';
    this.info('CONNECTION', `${eventSymbol} WebSocket ${event}`, details);
  }

  toolCall(toolName: string, args: any, duration?: number): void {
    const msg = duration !== undefined
      ? `Tool "${toolName}" executed in ${duration}ms`
      : `Tool "${toolName}" called`;
    this.info('TOOL', msg, args);
  }

  tabEvent(event: string, tabId: number, details?: any): void {
    this.debug('TAB', `${event} - Tab ${tabId}`, details);
  }

  lockEvent(event: 'acquired' | 'released' | 'waiting' | 'timeout', tabId: number, details?: any): void {
    const eventSymbol = event === 'acquired' ? '🔒' : event === 'released' ? '🔓' : '⏳';
    this.debug('LOCK', `${eventSymbol} Lock ${event} for tab ${tabId}`, details);
  }

  messageRouting(direction: 'incoming' | 'outgoing', messageType: string, details?: any): void {
    const arrow = direction === 'incoming' ? '→' : '←';
    this.trace('MESSAGE', `${arrow} ${messageType}`, details);
  }

  close(): void {
    if (this.logFilePath) {
      this.writeToFile(`\n${'='.repeat(80)}\n`);
      this.writeToFile(`Instance closed: ${new Date().toISOString()}\n`);
      this.writeToFile(`${'='.repeat(80)}\n`);
    }
  }
}

// Global logger instance storage
const loggers = new Map<string, EnhancedLogger>();

/**
 * Get or create a logger for an instance
 */
export function getLogger(instanceId: string, port: number | null = null): EnhancedLogger {
  const key = `${instanceId}-${port}`;

  if (!loggers.has(key)) {
    // Read log level from environment
    const envLevel = process.env.BROWSERMCP_LOG_LEVEL?.toUpperCase();
    const level = envLevel && LogLevel[envLevel as keyof typeof LogLevel] !== undefined
      ? LogLevel[envLevel as keyof typeof LogLevel]
      : LogLevel.INFO;

    const logger = new EnhancedLogger(instanceId, port, {
      level,
      logToFile: process.env.BROWSERMCP_LOG_FILE !== 'false',
      logDir: process.env.BROWSERMCP_LOG_DIR || '/tmp/browsermcp-logs'
    });

    loggers.set(key, logger);
  }

  return loggers.get(key)!;
}

/**
 * Close all loggers (for cleanup)
 */
export function closeAllLoggers(): void {
  for (const logger of loggers.values()) {
    logger.close();
  }
  loggers.clear();
}