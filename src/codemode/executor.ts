export interface ExecuteOptions {
  timeoutMs?: number;
  memoryLimitBytes?: number;
  maxStackSizeBytes?: number;
  maxCalls?: number;
  maxOutputBytes?: number;
  maxLogBytes?: number;
}

export interface ExecuteResult {
  result?: unknown;
  error?: string;
  logs: string[];
  callsUsed: number;
  durationMs: number;
  truncated?: boolean;
}

export type CodeModeHostFn = (args?: Record<string, unknown>) => Promise<unknown>;

export interface CodeExecutor {
  execute(
    code: string,
    fns: Record<string, CodeModeHostFn>,
    options?: ExecuteOptions
  ): Promise<ExecuteResult>;
}

export const DEFAULT_CODEMODE_LIMITS: Required<ExecuteOptions> = {
  timeoutMs: 25_000,
  memoryLimitBytes: 32 * 1024 * 1024,
  maxStackSizeBytes: 512 * 1024,
  maxCalls: 30,
  maxOutputBytes: 51_200,
  maxLogBytes: 4_096,
};

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function readCodeModeLimitsFromEnv(
  env: NodeJS.ProcessEnv = process.env
): Required<ExecuteOptions> {
  const memoryMb = parsePositiveInt(env.CODEMODE_MEMORY_LIMIT_MB, 32);
  const stackKb = parsePositiveInt(env.CODEMODE_STACK_LIMIT_KB, 512);
  return {
    timeoutMs: parsePositiveInt(env.CODEMODE_TIMEOUT_MS, DEFAULT_CODEMODE_LIMITS.timeoutMs),
    memoryLimitBytes: memoryMb * 1024 * 1024,
    maxStackSizeBytes: stackKb * 1024,
    maxCalls: parsePositiveInt(env.CODEMODE_MAX_CALLS, DEFAULT_CODEMODE_LIMITS.maxCalls),
    maxOutputBytes: parsePositiveInt(
      env.CODEMODE_MAX_OUTPUT_BYTES,
      DEFAULT_CODEMODE_LIMITS.maxOutputBytes
    ),
    maxLogBytes: parsePositiveInt(env.CODEMODE_MAX_LOG_BYTES, DEFAULT_CODEMODE_LIMITS.maxLogBytes),
  };
}
