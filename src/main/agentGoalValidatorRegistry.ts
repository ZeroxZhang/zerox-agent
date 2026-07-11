import { performance } from "node:perf_hooks";
import type {
  AcceptanceCheck,
  AcceptanceCheckKind,
  GoalAcceptanceCheckResult,
} from "../shared/agentGoal";
import type { AcceptanceContext } from "./agentGoalAcceptance";

const defaultValidatorTimeoutMs = 30_000;
const maximumTimerDelayMs = 2_147_483_647;

export type AcceptanceValidatorInput = {
  check: AcceptanceCheck;
  context: AcceptanceValidatorContext;
};

export type AcceptanceValidatorContext = Pick<
  AcceptanceContext,
  | "runId"
  | "goalId"
  | "milestoneId"
  | "workspacePath"
  | "extraReadRoots"
  | "extraWriteRoots"
  | "locationEnv"
  | "toolExecutor"
  | "trajectoryStore"
  | "artifacts"
  | "transcriptMessages"
> & { signal: AbortSignal };

export type AcceptanceValidator = {
  kind: AcceptanceCheckKind;
  evaluate(input: AcceptanceValidatorInput): Promise<GoalAcceptanceCheckResult>;
};

export type AgentGoalValidatorRegistry = {
  register(validator: AcceptanceValidator): void;
  evaluate(
    check: AcceptanceCheck,
    context: AcceptanceContext,
  ): Promise<GoalAcceptanceCheckResult>;
  listKinds(): AcceptanceCheckKind[];
};

export type AgentGoalValidatorRegistryOptions = {
  validators?: AcceptanceValidator[];
  timeoutMs?: number;
};

export function createAgentGoalValidatorRegistry(
  options: AgentGoalValidatorRegistryOptions = {},
): AgentGoalValidatorRegistry {
  const timeoutMs = options.timeoutMs ?? defaultValidatorTimeoutMs;
  validateTimeout(timeoutMs);

  const validators = new Map<AcceptanceCheckKind, AcceptanceValidator>();

  function register(validator: AcceptanceValidator): void {
    if (validators.has(validator.kind)) {
      throw new Error(
        `Acceptance validator already registered: ${validator.kind}`,
      );
    }
    validators.set(validator.kind, validator);
  }

  for (const validator of options.validators ?? []) {
    register(validator);
  }

  return {
    register,
    async evaluate(check, context) {
      const validator = validators.get(check.kind);
      if (!validator) {
        return unavailableResult(
          check,
          "validator_not_registered",
          "Acceptance validator is not registered.",
        );
      }

      const outcome = await evaluateWithTimeout(
        validator,
        check,
        context,
        timeoutMs,
      );
      if (outcome.status === "completed") {
        return outcome.result;
      }
      if (outcome.status === "timed_out") {
        return unavailableResult(
          check,
          "validator_timeout",
          "Acceptance validator timed out.",
        );
      }
      return unavailableResult(
        check,
        "validator_error",
        "Acceptance validator failed.",
      );
    },
    listKinds() {
      return [...validators.keys()];
    },
  };
}

type ValidatorOutcome =
  | { status: "completed"; result: GoalAcceptanceCheckResult }
  | { status: "failed" }
  | { status: "timed_out" };

async function evaluateWithTimeout(
  validator: AcceptanceValidator,
  check: AcceptanceCheck,
  context: AcceptanceContext,
  timeoutMs: number,
): Promise<ValidatorOutcome> {
  const startedAt = performance.now();
  const operation = createLinkedDeadline(context.signal, timeoutMs);
  if (context.signal?.aborted) {
    operation.dispose();
    throw abortError(context.signal.reason);
  }
  const evaluation: Promise<ValidatorOutcome> = Promise.resolve()
    .then(() => validator.evaluate({
      check,
      context: validatorContext(context, operation.signal),
    }))
    .then(
      (result) => {
        if (deadlinePassed(startedAt, timeoutMs)) {
          operation.abortForTimeout();
          return { status: "timed_out" };
        }
        if (operation.signal.aborted) {
          throw abortError(context.signal?.reason ?? operation.signal.reason);
        }
        return { status: "completed", result };
      },
      () => {
        if (operation.timedOut()) return { status: "timed_out" };
        if (operation.signal.aborted) {
          throw abortError(context.signal?.reason ?? operation.signal.reason);
        }
        return { status: "failed" };
      },
    );
  const canceled = new Promise<ValidatorOutcome>((resolve, reject) => {
    const onAbort = () => {
      if (operation.timedOut()) {
        resolve({ status: "timed_out" });
      } else {
        reject(abortError(context.signal?.reason ?? operation.signal.reason));
      }
    };
    operation.signal.addEventListener("abort", onAbort, { once: true });
    operation.setAbortCleanup(() => {
      operation.signal.removeEventListener("abort", onAbort);
    });
  });

  try {
    return await Promise.race([evaluation, canceled]);
  } finally {
    operation.dispose();
  }
}

function validatorContext(
  context: AcceptanceContext,
  signal: AbortSignal,
): AcceptanceValidatorContext {
  const throwIfAborted = () => {
    if (signal.aborted) throw abortError(signal.reason);
  };
  return {
    runId: context.runId,
    goalId: context.goalId,
    milestoneId: context.milestoneId,
    workspacePath: context.workspacePath,
    extraReadRoots: context.extraReadRoots,
    extraWriteRoots: context.extraWriteRoots,
    locationEnv: context.locationEnv,
    toolExecutor: {
      async execute(request, executionOptions) {
        throwIfAborted();
        const result = await context.toolExecutor.execute(request, {
          ...executionOptions,
          signal,
        });
        throwIfAborted();
        return result;
      },
    },
    trajectoryStore: {
      async append(runId, event, appendOptions) {
        throwIfAborted();
        const result = await context.trajectoryStore.append(runId, event, {
          ...appendOptions,
          signal,
        });
        throwIfAborted();
        return result;
      },
    },
    artifacts: context.artifacts,
    transcriptMessages: context.transcriptMessages,
    signal,
  };
}

type LinkedDeadline = {
  signal: AbortSignal;
  timedOut(): boolean;
  abortForTimeout(): void;
  setAbortCleanup(cleanup: () => void): void;
  dispose(): void;
};

function createLinkedDeadline(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
): LinkedDeadline {
  const controller = new AbortController();
  let didTimeOut = false;
  let abortCleanup: (() => void) | undefined;
  const onParentAbort = () => {
    if (!controller.signal.aborted) controller.abort(parentSignal?.reason);
  };
  if (parentSignal?.aborted) {
    onParentAbort();
  } else {
    parentSignal?.addEventListener("abort", onParentAbort, { once: true });
  }
  const abortForTimeout = () => {
    if (controller.signal.aborted) return;
    didTimeOut = true;
    controller.abort(new DOMException("Acceptance validator timed out.", "TimeoutError"));
  };
  const timer = setTimeout(abortForTimeout, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => didTimeOut,
    abortForTimeout,
    setAbortCleanup(cleanup) {
      abortCleanup = cleanup;
    },
    dispose() {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onParentAbort);
      abortCleanup?.();
    },
  };
}

function abortError(reason: unknown): Error {
  if (reason instanceof Error && reason.name === "AbortError") return reason;
  return new DOMException("Goal acceptance was canceled.", "AbortError");
}

function deadlinePassed(startedAt: number, timeoutMs: number): boolean {
  return performance.now() - startedAt >= timeoutMs;
}

function unavailableResult(
  check: AcceptanceCheck,
  code: "validator_not_registered" | "validator_timeout" | "validator_error",
  detail: string,
): GoalAcceptanceCheckResult {
  return {
    checkId: check.id,
    kind: check.kind,
    passed: false,
    code,
    failureClass: "validator_unavailable",
    evidenceRefs: [],
    detail,
  };
}

function validateTimeout(timeoutMs: number): void {
  if (
    !Number.isFinite(timeoutMs) ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > maximumTimerDelayMs
  ) {
    throw new RangeError(
      "Acceptance validator timeout must be a positive finite number.",
    );
  }
}
