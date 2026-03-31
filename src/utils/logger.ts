export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[currentLevel];
}

function formatMessage(level: LogLevel, message: string, data?: unknown): string {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  if (data !== undefined) {
    return `${prefix} ${message} ${JSON.stringify(data)}`;
  }
  return `${prefix} ${message}`;
}

/**
 * Logger that writes to stderr to avoid interfering with stdio MCP transport.
 */
export const logger = {
  debug(message: string, data?: unknown): void {
    if (shouldLog("debug")) {
      process.stderr.write(formatMessage("debug", message, data) + "\n");
    }
  },
  info(message: string, data?: unknown): void {
    if (shouldLog("info")) {
      process.stderr.write(formatMessage("info", message, data) + "\n");
    }
  },
  warn(message: string, data?: unknown): void {
    if (shouldLog("warn")) {
      process.stderr.write(formatMessage("warn", message, data) + "\n");
    }
  },
  error(message: string, data?: unknown): void {
    if (shouldLog("error")) {
      process.stderr.write(formatMessage("error", message, data) + "\n");
    }
  },
};
