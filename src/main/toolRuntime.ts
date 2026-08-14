import type {
  AgentToolExecutionOptions,
  AgentToolExecutionResult,
  AgentToolExecutor,
} from "./agentToolExecutor";
import type {
  RuntimeToolAuthorizationTask,
  ToolAuthorizationOptions,
  ToolAuthorizationService,
} from "./toolAuthorizationService";
import type {
  ToolAuthorizationDecision,
  ToolCallRequest,
} from "../shared/toolPermissions";
import type { AgentRunContext } from "../shared/agentWorkspace";

export type ToolRuntimeStage =
  | "preparing"
  | "guarding"
  | "authorizing"
  | "authorized"
  | "denied"
  | "dispatching"
  | "postprocessing"
  | "finalized"
  | "dispatch_error";

export type ToolRuntimeStageEvent = Readonly<{
  stage: ToolRuntimeStage;
  taskId: string;
  request: ToolCallRequest;
  guard?: string;
  reason?: string;
  ok?: boolean;
}>;

export type ToolRuntimeContext = Readonly<{
  taskId: string;
  request: ToolCallRequest;
  runContext?: AgentRunContext;
  runtimeTask?: RuntimeToolAuthorizationTask;
  signal?: AbortSignal;
}>;

export type ToolRuntimeGuardDecision =
  | { allowed: true; reason?: string }
  | { allowed: false; reason: string; errorDetails?: Record<string, unknown> };

export type ToolRuntimePreHook = (
  context: ToolRuntimeContext,
) => void | Promise<void>;

export type ToolRuntimeGuard = {
  name: string;
  evaluate(
    context: ToolRuntimeContext,
  ): ToolRuntimeGuardDecision | Promise<ToolRuntimeGuardDecision>;
};

export type ToolRuntimePostHook = (
  context: ToolRuntimeContext & { result: AgentToolExecutionResult },
) => void | Promise<void>;

export type ToolRuntimeInput = {
  taskId: string;
  request: ToolCallRequest;
  authorizationOptions?: Omit<
    ToolAuthorizationOptions,
    "signal" | "runContext"
  >;
  executionOptions?: AgentToolExecutionOptions;
  onStage?: (
    event: ToolRuntimeStageEvent,
  ) => void | Promise<void>;
};

export type ToolRuntimeOutcome = Readonly<{
  request: ToolCallRequest;
  result: AgentToolExecutionResult;
  dispatched: boolean;
  authorization?: ToolAuthorizationDecision;
  deniedBy?: string;
  diagnostics: readonly string[];
}>;

export type ToolRuntime = {
  execute(input: ToolRuntimeInput): Promise<ToolRuntimeOutcome>;
};

export function createToolRuntime(options: {
  authorizationService?: ToolAuthorizationService;
  toolExecutor: Pick<AgentToolExecutor, "execute"> &
    Partial<Pick<AgentToolExecutor, "getRegistry">>;
  preHooks?: readonly ToolRuntimePreHook[];
  guards?: readonly ToolRuntimeGuard[];
  postHooks?: readonly ToolRuntimePostHook[];
}): ToolRuntime {
  const preHooks = [...(options.preHooks ?? [])];
  const guards = [...(options.guards ?? [])];
  const postHooks = [...(options.postHooks ?? [])];

  return {
    async execute(input) {
      const diagnostics: string[] = [];
      const canonicalRequest = canonicalizeRequest(
        input.request,
        resolveRegisteredSource(options.toolExecutor, input.request.toolName),
      );
      const runContext = input.executionOptions?.runContext;
      const hookRunContext = runContext
        ? deepFreeze(structuredClone(runContext))
        : undefined;
      const canonicalRuntimeTask = input.authorizationOptions?.runtimeTask
        ? deepFreeze(structuredClone(input.authorizationOptions.runtimeTask))
        : undefined;
      const executionOptions = input.executionOptions;
      let dispatchStarted = false;
      const context = Object.freeze({
        taskId: input.taskId,
        request: canonicalRequest,
        ...(hookRunContext
          ? { runContext: hookRunContext }
          : {}),
        ...(canonicalRuntimeTask
          ? { runtimeTask: canonicalRuntimeTask }
          : {}),
        ...(executionOptions?.signal
          ? { signal: executionOptions.signal }
          : {}),
      }) satisfies ToolRuntimeContext;
      const emit = async (
        event: Omit<ToolRuntimeStageEvent, "taskId" | "request">,
      ) => {
        if (!input.onStage) return;
        try {
          await input.onStage(
            deepFreeze({
              ...event,
              taskId: input.taskId,
              request: canonicalRequest,
            }),
          );
        } catch (error) {
          if (!dispatchStarted) {
            throw error;
          }
          diagnostics.push(`lifecycle:${event.stage}:${errorMessage(error)}`);
        }
      };

      await emit({ stage: "preparing" });
      for (const hook of preHooks) {
        try {
          await hook(context);
        } catch (error) {
          const reason = `Tool runtime pre hook failed: ${errorMessage(error)}`;
          await emit({
            stage: "denied",
            guard: "pre_hook",
            reason,
          });
          return deniedOutcome({
            request: canonicalRequest,
            reason,
            deniedBy: "pre_hook",
            diagnostics,
          });
        }
      }

      for (const guard of guards) {
        await emit({ stage: "guarding", guard: guard.name });
        let decision: ToolRuntimeGuardDecision;
        try {
          decision = await guard.evaluate(context);
        } catch (error) {
          decision = {
            allowed: false,
            reason: `Tool runtime guard "${guard.name}" failed: ${errorMessage(error)}`,
            errorDetails: { kind: "tool_runtime_guard_error" },
          };
        }
        if (!decision.allowed) {
          await emit({
            stage: "denied",
            guard: guard.name,
            reason: decision.reason,
          });
          return deniedOutcome({
            request: canonicalRequest,
            reason: decision.reason,
            deniedBy: guard.name,
            diagnostics,
            errorDetails: decision.errorDetails,
          });
        }
      }

      if (!options.authorizationService) {
        const reason = "工具授权服务未配置，已拒绝执行。";
        await emit({
          stage: "denied",
          guard: "authorization",
          reason,
        });
        return deniedOutcome({
          request: canonicalRequest,
          reason,
          deniedBy: "authorization",
          diagnostics,
          errorDetails: { kind: "authorization_unavailable" },
        });
      }

      await emit({ stage: "authorizing", guard: "authorization" });
      const authorization = await options.authorizationService.authorize(
        input.taskId,
        canonicalRequest,
        {
          ...input.authorizationOptions,
          ...(canonicalRuntimeTask
            ? { runtimeTask: canonicalRuntimeTask }
            : {}),
          ...(executionOptions?.signal
            ? { signal: executionOptions.signal }
            : {}),
          ...(executionOptions?.runContext
            ? { runContext: executionOptions.runContext }
            : {}),
        },
      );
      if (!authorization.ok || !authorization.decision.allowed) {
        const reason = authorization.ok
          ? authorization.decision.reason
          : authorization.message;
        await emit({
          stage: "denied",
          guard: "authorization",
          reason,
        });
        return deniedOutcome({
          request: canonicalRequest,
          reason,
          deniedBy: "authorization",
          diagnostics,
          errorDetails: {
            kind: authorization.ok
              ? "authorization_denied"
              : "authorization_unavailable",
          },
          ...(authorization.ok
            ? { authorization: authorization.decision }
            : {}),
        });
      }

      await emit({
        stage: "authorized",
        guard: "authorization",
        reason: authorization.decision.reason,
      });
      await emit({ stage: "dispatching" });
      dispatchStarted = true;
      let rawResult: AgentToolExecutionResult;
      try {
        rawResult = await options.toolExecutor.execute(
          canonicalRequest,
          deriveDispatchOptions(
            canonicalRequest,
            executionOptions,
            input.taskId,
            canonicalRuntimeTask,
          ),
        );
      } catch (error) {
        await emit({
          stage: "dispatch_error",
          reason: errorMessage(error),
        });
        throw error;
      }

      const result = canonicalizeResult(rawResult);
      await emit({ stage: "postprocessing", ok: result.ok });
      for (const hook of postHooks) {
        try {
          await hook(Object.freeze({ ...context, result }));
        } catch (error) {
          diagnostics.push(`post:${errorMessage(error)}`);
        }
      }
      await emit({ stage: "finalized", ok: result.ok });

      return deepFreeze({
        request: canonicalRequest,
        result,
        dispatched: true,
        authorization: deepFreeze(structuredClone(authorization.decision)),
        diagnostics: [...diagnostics],
      });
    },
  };
}

function resolveRegisteredSource(
  executor: Partial<Pick<AgentToolExecutor, "getRegistry">>,
  toolName: string,
): { authoritative: boolean; source: string | null } {
  if (!executor.getRegistry) {
    return { authoritative: false, source: null };
  }
  try {
    return {
      authoritative: true,
      source: executor.getRegistry().getSource(toolName),
    };
  } catch {
    return { authoritative: false, source: null };
  }
}

function canonicalizeRequest(
  request: ToolCallRequest,
  registeredSource: { authoritative: boolean; source: string | null },
): ToolCallRequest {
  const args = structuredClone(request.args);
  const source = registeredSource.authoritative
    ? registeredSource.source
    : request.source ?? null;
  return deepFreeze({
    toolName: String(request.toolName),
    ...(source ? { source } : {}),
    args,
  });
}

function deriveDispatchOptions(
  request: ToolCallRequest,
  executionOptions: AgentToolExecutionOptions | undefined,
  taskId: string,
  runtimeTask: RuntimeToolAuthorizationTask | undefined,
): AgentToolExecutionOptions {
  const {
    authorizedShellCommand: _untrustedCommand,
    ...safeOptions
  } = executionOptions ?? {};
  return {
    ...safeOptions,
    taskId,
    ...(runtimeTask ? { runtimeTask } : {}),
    ...(request.toolName === "shell_exec" || request.toolName === "test_run"
      ? { authorizedShellCommand: String(request.args.command ?? "") }
      : {}),
  };
}

function canonicalizeResult(
  result: AgentToolExecutionResult,
): AgentToolExecutionResult {
  if (!result || typeof result !== "object" || typeof result.ok !== "boolean") {
    return deepFreeze({
      ok: false,
      error: "Tool runtime received an invalid execution result.",
      errorDetails: { kind: "invalid_tool_output" },
    });
  }
  if (result.ok) {
    if (!isRecord(result.result)) {
      return invalidOutput(
        "Tool runtime expected successful output to be an object.",
      );
    }
    try {
      return deepFreeze(structuredClone(result));
    } catch {
      return invalidOutput(
        "Tool runtime could not canonicalize successful output.",
      );
    }
  }
  if (typeof result.error !== "string") {
    return invalidOutput(
      "Tool runtime expected failed output to contain an error string.",
    );
  }
  try {
    return deepFreeze(structuredClone(result));
  } catch {
    return invalidOutput("Tool runtime could not canonicalize failed output.");
  }
}

function invalidOutput(error: string): AgentToolExecutionResult {
  return deepFreeze({
    ok: false,
    error,
    errorDetails: { kind: "invalid_tool_output" },
  });
}

function deniedOutcome(input: {
  request: ToolCallRequest;
  reason: string;
  deniedBy: string;
  diagnostics: string[];
  errorDetails?: Record<string, unknown>;
  authorization?: ToolAuthorizationDecision;
}): ToolRuntimeOutcome {
  return deepFreeze({
    request: input.request,
    result: {
      ok: false,
      error: input.reason,
      errorDetails: {
        kind: "tool_runtime_denied",
        deniedBy: input.deniedBy,
        ...(input.errorDetails ?? {}),
      },
    },
    dispatched: false,
    ...(input.authorization
      ? { authorization: structuredClone(input.authorization) }
      : {}),
    deniedBy: input.deniedBy,
    diagnostics: [...input.diagnostics],
  });
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (!value || typeof value !== "object") return value;
  const object = value as object;
  if (seen.has(object)) return value;
  seen.add(object);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child, seen);
  }
  return Object.freeze(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
