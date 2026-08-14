import { Worker } from "node:worker_threads";
import type { AgentToolExecutionResult } from "./agentToolExecutor";

export const READ_CODE_ALLOWED_TOOLS = new Set([
  "file_stat",
  "file_list",
  "file_search",
  "file_inventory",
  "file_move_plan",
  "file_verify_moves",
  "file_read",
  "tool_result_read",
  "code_search",
  "git_status",
  "git_diff",
  "memory_search",
  "conversation_search",
  "history_search",
  "history_around",
  "web_search",
  "web_fetch",
]);

export type ReadCodeStep = {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  dependsOn?: string[];
};

export type ReadCodeProgram = {
  steps: ReadCodeStep[];
  output?: string[];
};

export type ReadCodeRuntimeResult = {
  outputs: Array<{
    id: string;
    tool: string;
    result: AgentToolExecutionResult;
  }>;
  stepsExecuted: number;
};

export type ReadCodeRuntimeLimits = {
  maxCalls?: number;
  maxConcurrency?: number;
  timeoutMs?: number;
  maxProgramBytes?: number;
  maxOutputBytes?: number;
  maxSubcallBytes?: number;
  maxOldGenerationSizeMb?: number;
  maxYoungGenerationSizeMb?: number;
  stackSizeMb?: number;
};

export async function runReadCodeProgram(
  program: ReadCodeProgram,
  options: {
    signal?: AbortSignal;
    limits?: ReadCodeRuntimeLimits;
    invoke(
      toolName: string,
      args: Record<string, unknown>,
      signal: AbortSignal,
      call: { callId: string; stepId: string },
    ): Promise<AgentToolExecutionResult>;
  },
): Promise<ReadCodeRuntimeResult> {
  const limits = normalizeLimits(options.limits);
  validateProgramEnvelope(
    program,
    limits.maxCalls,
    limits.maxProgramBytes,
  );
  const controller = new AbortController();
  const abortFromParent = () =>
    controller.abort(
      options.signal?.reason instanceof Error
        ? options.signal.reason
        : new Error("Read Code Mode canceled."),
    );
  if (options.signal?.aborted) {
    abortFromParent();
  } else {
    options.signal?.addEventListener("abort", abortFromParent, {
      once: true,
    });
  }

  const worker = new Worker(READ_CODE_WORKER_SOURCE, {
    eval: true,
    workerData: {
      program: structuredClone(program),
      maxConcurrency: limits.maxConcurrency,
    },
    resourceLimits: {
      maxOldGenerationSizeMb: limits.maxOldGenerationSizeMb,
      maxYoungGenerationSizeMb: limits.maxYoungGenerationSizeMb,
      stackSizeMb: limits.stackSizeMb,
    },
  });
  const activeCalls = new Set<Promise<void>>();
  let callCount = 0;
  let settled = false;

  return new Promise<ReadCodeRuntimeResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      void finish(
        new Error(
          `Read Code Mode timed out after ${limits.timeoutMs}ms.`,
        ),
      );
    }, limits.timeoutMs);
    const onAbort = () => {
      void finish(
        controller.signal.reason instanceof Error
          ? controller.signal.reason
          : new Error("Read Code Mode canceled."),
      );
    };
    controller.signal.addEventListener("abort", onAbort, { once: true });

    worker.on("message", (message: unknown) => {
      if (settled || !isRecord(message)) return;
      if (message.type === "call") {
        const callId = readString(message.callId);
        const stepId = readString(message.stepId);
        const toolName = readString(message.tool);
        const args = message.args;
        if (!callId || !stepId || !toolName || !isRecord(args)) {
          void finish(new Error("Read Code worker sent an invalid call."));
          return;
        }
        callCount += 1;
        if (callCount > limits.maxCalls) {
          void finish(
            new Error(
              `Read Code Mode exceeded ${limits.maxCalls} subcalls.`,
            ),
          );
          return;
        }
        if (
          toolName === "read_code" ||
          !READ_CODE_ALLOWED_TOOLS.has(toolName)
        ) {
          void finish(
            new Error(
              `Read Code Mode tool "${toolName}" is not read-only allowlisted.`,
            ),
          );
          return;
        }
        const operation = Promise.resolve()
          .then(() =>
            options.invoke(toolName, args, controller.signal, {
              callId,
              stepId,
            }),
          )
          .then((result) => {
            const bytes = jsonBytes(result);
            if (bytes > limits.maxSubcallBytes) {
              throw new Error(
                `Read Code Mode subcall output exceeded ${limits.maxSubcallBytes} bytes.`,
              );
            }
            if (!settled) {
              worker.postMessage({
                type: "result",
                callId,
                result,
              });
            }
          })
          .catch((error) => {
            if (!settled) {
              worker.postMessage({
                type: "result",
                callId,
                result: {
                  ok: false,
                  error:
                    error instanceof Error
                      ? error.message
                      : String(error),
                },
              });
            }
          })
          .finally(() => {
            activeCalls.delete(operation);
          });
        activeCalls.add(operation);
        return;
      }
      if (message.type === "done") {
        const result = message.result;
        if (!isReadCodeRuntimeResult(result)) {
          void finish(
            new Error("Read Code worker returned an invalid result."),
          );
          return;
        }
        if (jsonBytes(result) > limits.maxOutputBytes) {
          void finish(
            new Error(
              `Read Code Mode output exceeded ${limits.maxOutputBytes} bytes.`,
            ),
          );
          return;
        }
        void finish(undefined, result);
        return;
      }
      if (message.type === "error") {
        void finish(
          new Error(
            readString(message.error) ??
              "Read Code worker failed.",
          ),
        );
      }
    });
    worker.on("error", (error) => {
      void finish(
        error instanceof Error ? error : new Error(String(error)),
      );
    });
    worker.on("exit", (code) => {
      if (!settled) {
        void finish(
          new Error(
            `Read Code worker exited before a result (${code}).`,
          ),
        );
      }
    });

    async function finish(
      error?: Error,
      result?: ReadCodeRuntimeResult,
    ): Promise<void> {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      controller.signal.removeEventListener("abort", onAbort);
      options.signal?.removeEventListener("abort", abortFromParent);
      if (error && !controller.signal.aborted) {
        controller.abort(error);
      }
      await Promise.allSettled([...activeCalls]);
      await worker.terminate().catch(() => undefined);
      if (error) {
        reject(error);
      } else if (result) {
        resolve(structuredClone(result));
      } else {
        reject(new Error("Read Code Mode ended without a result."));
      }
    }
  });
}

function normalizeLimits(limits: ReadCodeRuntimeLimits = {}) {
  return {
    maxCalls: positiveInteger(limits.maxCalls, 16),
    maxConcurrency: positiveInteger(limits.maxConcurrency, 4),
    timeoutMs: positiveInteger(limits.timeoutMs, 10_000),
    maxProgramBytes: positiveInteger(
      limits.maxProgramBytes,
      128 * 1024,
    ),
    maxOutputBytes: positiveInteger(
      limits.maxOutputBytes,
      128 * 1024,
    ),
    maxSubcallBytes: positiveInteger(
      limits.maxSubcallBytes,
      256 * 1024,
    ),
    maxOldGenerationSizeMb: positiveInteger(
      limits.maxOldGenerationSizeMb,
      32,
    ),
    maxYoungGenerationSizeMb: positiveInteger(
      limits.maxYoungGenerationSizeMb,
      8,
    ),
    stackSizeMb: positiveInteger(limits.stackSizeMb, 2),
  };
}

function validateProgramEnvelope(
  program: ReadCodeProgram,
  maxCalls: number,
  maxProgramBytes: number,
): void {
  if (!program || !Array.isArray(program.steps)) {
    throw new Error("Read Code Mode program.steps must be an array.");
  }
  if (program.steps.length === 0) {
    throw new Error("Read Code Mode requires at least one step.");
  }
  if (program.steps.length > maxCalls) {
    throw new Error(
      `Read Code Mode exceeded ${maxCalls} declared steps.`,
    );
  }
  if (jsonBytes(program) > maxProgramBytes) {
    throw new Error(
      `Read Code Mode program exceeded ${maxProgramBytes} bytes.`,
    );
  }
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0
    ? Math.max(1, Math.floor(value))
    : fallback;
}

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function isReadCodeRuntimeResult(
  value: unknown,
): value is ReadCodeRuntimeResult {
  return (
    isRecord(value) &&
    Array.isArray(value.outputs) &&
    typeof value.stepsExecuted === "number" &&
    value.outputs.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.id === "string" &&
        typeof entry.tool === "string" &&
        isRecord(entry.result) &&
        typeof entry.result.ok === "boolean",
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

const READ_CODE_WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require("node:worker_threads");

const pendingCalls = new Map();
let callSequence = 0;

parentPort.on("message", (message) => {
  if (!message || message.type !== "result") return;
  const pending = pendingCalls.get(message.callId);
  if (!pending) return;
  pendingCalls.delete(message.callId);
  pending.resolve(message.result);
});

function callTool(step) {
  return new Promise((resolve) => {
    const callId = "read-code-call-" + (++callSequence);
    pendingCalls.set(callId, { resolve });
    parentPort.postMessage({
      type: "call",
      callId,
      stepId: step.id,
      tool: step.tool,
      args: step.args,
    });
  });
}

function validateProgram(program) {
  if (!program || !Array.isArray(program.steps) || program.steps.length === 0) {
    throw new Error("program.steps must be a non-empty array");
  }
  const ids = new Set();
  for (const step of program.steps) {
    if (
      !step ||
      typeof step.id !== "string" ||
      !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(step.id) ||
      typeof step.tool !== "string" ||
      !step.args ||
      typeof step.args !== "object" ||
      Array.isArray(step.args) ||
      (step.dependsOn !== undefined &&
        (!Array.isArray(step.dependsOn) ||
          step.dependsOn.some((id) => typeof id !== "string")))
    ) {
      throw new Error("invalid read code step");
    }
    if (ids.has(step.id)) throw new Error("duplicate step id: " + step.id);
    ids.add(step.id);
  }
  for (const step of program.steps) {
    for (const dependency of step.dependsOn || []) {
      if (!ids.has(dependency)) {
        throw new Error("unknown dependency: " + dependency);
      }
    }
  }
  const outputs = program.output === undefined
    ? program.steps.map((step) => step.id)
    : program.output;
  if (
    !Array.isArray(outputs) ||
    outputs.some((id) => typeof id !== "string" || !ids.has(id))
  ) {
    throw new Error("invalid output ids");
  }
  return outputs;
}

async function main() {
  const program = workerData.program;
  const outputIds = validateProgram(program);
  const byId = new Map(program.steps.map((step) => [step.id, step]));
  const memo = new Map();
  const semaphore = {
    active: 0,
    waiters: [],
    async acquire() {
      if (this.active < workerData.maxConcurrency) {
        this.active += 1;
        return;
      }
      await new Promise((resolve) => this.waiters.push(resolve));
      this.active += 1;
    },
    release() {
      this.active -= 1;
      const next = this.waiters.shift();
      if (next) next();
    },
  };

  function execute(id, stack = []) {
    if (memo.has(id)) return memo.get(id);
    if (stack.includes(id)) {
      return Promise.reject(new Error("dependency cycle: " + [...stack, id].join(" -> ")));
    }
    const step = byId.get(id);
    const operation = Promise.all(
      (step.dependsOn || []).map((dependency) =>
        execute(dependency, [...stack, id]),
      ),
    ).then(async () => {
      await semaphore.acquire();
      try {
        return await callTool(step);
      } finally {
        semaphore.release();
      }
    });
    memo.set(id, operation);
    return operation;
  }

  const values = await Promise.all(
    outputIds.map(async (id) => ({
      id,
      tool: byId.get(id).tool,
      result: await execute(id),
    })),
  );
  await Promise.all([...memo.values()]);
  parentPort.postMessage({
    type: "done",
    result: {
      outputs: values,
      stepsExecuted: memo.size,
    },
  });
}

main().catch((error) => {
  parentPort.postMessage({
    type: "error",
    error: error && error.message ? error.message : String(error),
  });
});
`;
