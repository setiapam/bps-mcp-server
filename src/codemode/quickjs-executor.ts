import {
  getQuickJS,
  shouldInterruptAfterDeadline,
  type QuickJSContext,
  type QuickJSDeferredPromise,
  type QuickJSHandle,
  type QuickJSWASMModule,
} from "quickjs-emscripten";
import {
  DEFAULT_CODEMODE_LIMITS,
  type CodeExecutor,
  type CodeModeHostFn,
  type ExecuteOptions,
  type ExecuteResult,
} from "./executor.js";
import { normalizeCode } from "./normalize-code.js";

let quickjsModulePromise: Promise<QuickJSWASMModule> | null = null;

/**
 * Lazily load and cache the QuickJS WASM module singleton.
 * Safe to call from readiness probes (/readyz).
 */
export async function ensureQuickJSReady(): Promise<QuickJSWASMModule> {
  if (!quickjsModulePromise) {
    quickjsModulePromise = getQuickJS().catch((error) => {
      quickjsModulePromise = null;
      throw error;
    });
  }
  return quickjsModulePromise;
}

function formatErrorValue(dumped: unknown): string {
  if (typeof dumped === "string") return dumped;
  if (dumped && typeof dumped === "object") {
    const obj = dumped as { name?: unknown; message?: unknown; stack?: unknown };
    const name = typeof obj.name === "string" ? obj.name : "Error";
    const message = typeof obj.message === "string" ? obj.message : "";
    if (message) return name === "Error" ? message : `${name}: ${message}`;
    try {
      return JSON.stringify(dumped);
    } catch {
      return String(dumped);
    }
  }
  return String(dumped ?? "Unknown sandbox error");
}

function formatConsoleArg(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "undefined") return "undefined";
  if (value === null) return "null";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * Safely materialize a host JS value inside the QuickJS context via JSON.parse
 * so allocations count against the runtime memory limit with zero handle leaks.
 */
function hostValueToQuickJS(
  vm: QuickJSContext,
  value: unknown
): { value: QuickJSHandle } | { error: string } {
  if (value === undefined) {
    return { value: vm.undefined };
  }

  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch (err) {
    return { error: `Failed to serialize host result: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (json === undefined) {
    return { value: vm.undefined };
  }

  const jsonGlobal = vm.getProp(vm.global, "JSON");
  const parseFn = vm.getProp(jsonGlobal, "parse");
  const strHandle = vm.newString(json);
  try {
    const res = vm.callFunction(parseFn, jsonGlobal, strHandle);
    if (res.error) {
      const msg = formatErrorValue(vm.dump(res.error));
      res.error.dispose();
      return { error: msg };
    }
    return { value: res.value };
  } finally {
    strHandle.dispose();
    parseFn.dispose();
    jsonGlobal.dispose();
  }
}

function truncateOutputIfNeeded(
  result: unknown,
  maxOutputBytes: number
): { result: unknown; truncated: boolean } {
  if (result === undefined) {
    return { result: undefined, truncated: false };
  }
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(result);
  } catch {
    return { result: String(result), truncated: false };
  }
  if (serialized === undefined) {
    return { result: undefined, truncated: false };
  }
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes <= maxOutputBytes) {
    return { result, truncated: false };
  }

  const previewBudget = Math.max(256, maxOutputBytes - 512);
  const previewBuf = Buffer.from(serialized, "utf8").subarray(0, previewBudget);
  return {
    result: {
      _truncated: true,
      originalBytes: bytes,
      maxOutputBytes,
      preview: previewBuf.toString("utf8"),
    },
    truncated: true,
  };
}

export class QuickJSExecutor implements CodeExecutor {
  private readonly defaultOptions: Required<ExecuteOptions>;

  constructor(defaultOptions: ExecuteOptions = {}) {
    this.defaultOptions = {
      ...DEFAULT_CODEMODE_LIMITS,
      ...defaultOptions,
    };
  }

  async execute(
    code: string,
    fns: Record<string, CodeModeHostFn>,
    options: ExecuteOptions = {}
  ): Promise<ExecuteResult> {
    const startedAt = Date.now();
    const opts: Required<ExecuteOptions> = {
      ...this.defaultOptions,
      ...options,
    };

    const logs: string[] = [];
    let logBytes = 0;
    let logsTruncated = false;
    let callsUsed = 0;

    let wrappedCode: string;
    try {
      wrappedCode = normalizeCode(code);
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        logs,
        callsUsed,
        durationMs: Date.now() - startedAt,
      };
    }

    const quickjs = await ensureQuickJSReady();
    const runtime = quickjs.newRuntime();
    runtime.setMemoryLimit(opts.memoryLimitBytes);
    runtime.setMaxStackSize(opts.maxStackSizeBytes);
    runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + opts.timeoutMs));

    const vm = runtime.newContext();
    let disposed = false;
    const activeDeferreds = new Set<QuickJSDeferredPromise>();
    let rejectFromJobError: ((err: string) => void) | null = null;

    const drainJobs = (): void => {
      if (disposed) return;
      try {
        const pending = runtime.executePendingJobs();
        if (pending.error) {
          const msg = formatErrorValue(vm.dump(pending.error));
          pending.error.dispose();
          rejectFromJobError?.(msg);
        }
      } catch (err) {
        rejectFromJobError?.(err instanceof Error ? err.message : String(err));
      }
    };

    try {
      // 1. Expose safe console global
      const consoleObj = vm.newObject();
      for (const level of ["log", "info", "warn", "error"] as const) {
        const fnHandle = vm.newFunction(level, (...argHandles) => {
          if (logsTruncated) return vm.undefined;
          const parts = argHandles.map((h) => formatConsoleArg(vm.dump(h)));
          const prefix = level === "log" || level === "info" ? "" : `[${level}] `;
          const line = `${prefix}${parts.join(" ")}`;
          const lineBytes = Buffer.byteLength(line, "utf8");
          if (logBytes + lineBytes > opts.maxLogBytes) {
            logs.push("[logs truncated]");
            logsTruncated = true;
            return vm.undefined;
          }
          logBytes += lineBytes;
          logs.push(line);
          return vm.undefined;
        });
        vm.setProp(consoleObj, level, fnHandle);
        fnHandle.dispose();
      }
      vm.setProp(vm.global, "console", consoleObj);
      consoleObj.dispose();

      // 2. Expose `bps` API object with async bridged host functions
      const bpsObj = vm.newObject();
      for (const [methodName, hostFn] of Object.entries(fns)) {
        const fnHandle = vm.newFunction(methodName, (...argHandles) => {
          const deferred = vm.newPromise();
          activeDeferreds.add(deferred);

          if (callsUsed >= opts.maxCalls) {
            activeDeferreds.delete(deferred);
            const errHandle = vm.newError(
              `Maximum API call limit (${opts.maxCalls}) exceeded in a single execution.`
            );
            deferred.reject(errHandle);
            errHandle.dispose();
            return deferred.handle;
          }
          callsUsed++;

          let parsedArgs: Record<string, unknown> | undefined;
          if (argHandles.length > 0) {
            const rawArg = vm.dump(argHandles[0]);
            if (rawArg !== undefined && rawArg !== null) {
              if (typeof rawArg === "object" && !Array.isArray(rawArg)) {
                parsedArgs = rawArg as Record<string, unknown>;
              } else if (methodName === "help" && typeof rawArg === "string") {
                parsedArgs = { method: rawArg };
              } else {
                activeDeferreds.delete(deferred);
                const errHandle = vm.newError(
                  `bps.${methodName}() expects an options object argument.`
                );
                deferred.reject(errHandle);
                errHandle.dispose();
                return deferred.handle;
              }
            }
          }

          Promise.resolve()
            .then(() => hostFn(parsedArgs))
            .then((resultValue) => {
              if (disposed) return;
              activeDeferreds.delete(deferred);
              const converted = hostValueToQuickJS(vm, resultValue);
              if ("error" in converted) {
                const errHandle = vm.newError(converted.error);
                deferred.reject(errHandle);
                errHandle.dispose();
              } else {
                deferred.resolve(converted.value);
                if (converted.value !== vm.undefined) {
                  converted.value.dispose();
                }
              }
              drainJobs();
            })
            .catch((err) => {
              if (disposed) return;
              activeDeferreds.delete(deferred);
              const message = err instanceof Error ? err.message : String(err);
              const errHandle = vm.newError(message);
              deferred.reject(errHandle);
              errHandle.dispose();
              drainJobs();
            });

          return deferred.handle;
        });
        vm.setProp(bpsObj, methodName, fnHandle);
        fnHandle.dispose();
      }
      vm.setProp(vm.global, "bps", bpsObj);
      bpsObj.dispose();

      // 3. Evaluate normalized async IIFE
      const evalResult = vm.evalCode(wrappedCode, "bps-script.js");
      if (evalResult.error) {
        const msg = formatErrorValue(vm.dump(evalResult.error));
        evalResult.error.dispose();
        return {
          error: msg,
          logs,
          callsUsed,
          durationMs: Date.now() - startedAt,
        };
      }

      const promiseHandle = evalResult.value;
      const resolvedPromise = vm.resolvePromise(promiseHandle);
      promiseHandle.dispose();

      const jobErrorPromise = new Promise<{ kind: "job_error"; message: string }>((resolve) => {
        rejectFromJobError = (message) => resolve({ kind: "job_error", message });
      });

      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<{ kind: "timeout" }>((resolve) => {
        timeoutTimer = setTimeout(() => resolve({ kind: "timeout" }), opts.timeoutMs);
      });

      // Kick off synchronous microtasks & initial bps.* calls
      drainJobs();

      const raceResult = await Promise.race([
        resolvedPromise.then((outcome) => ({ kind: "settled" as const, outcome })),
        jobErrorPromise,
        timeoutPromise,
      ]);

      if (timeoutTimer) clearTimeout(timeoutTimer);

      if (raceResult.kind === "timeout") {
        return {
          error: `Execution timed out after ${opts.timeoutMs}ms`,
          logs,
          callsUsed,
          durationMs: Date.now() - startedAt,
        };
      }

      if (raceResult.kind === "job_error") {
        return {
          error: raceResult.message,
          logs,
          callsUsed,
          durationMs: Date.now() - startedAt,
        };
      }

      const { outcome } = raceResult;
      if (outcome.error) {
        const msg = formatErrorValue(vm.dump(outcome.error));
        outcome.error.dispose();
        return {
          error: msg,
          logs,
          callsUsed,
          durationMs: Date.now() - startedAt,
        };
      }

      const dumped = vm.dump(outcome.value);
      outcome.value.dispose();
      const { result, truncated } = truncateOutputIfNeeded(dumped, opts.maxOutputBytes);

      return {
        result,
        logs,
        callsUsed,
        durationMs: Date.now() - startedAt,
        truncated,
      };
    } finally {
      disposed = true;
      for (const deferred of activeDeferreds) {
        try {
          deferred.dispose();
        } catch {
          // Best-effort cleanup for unsettled handles during timeout/abort.
        }
      }
      activeDeferreds.clear();
      try {
        vm.dispose();
      } catch {
        // Ignore secondary disposal error after OOM/interrupt.
      }
      try {
        runtime.dispose();
      } catch {
        // Ignore secondary disposal error after OOM/interrupt.
      }
    }
  }
}
