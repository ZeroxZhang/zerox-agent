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
>;

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
        validatorContext(context),
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
  context: AcceptanceValidatorContext,
  timeoutMs: number,
): Promise<ValidatorOutcome> {
  const startedAt = performance.now();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const evaluation: Promise<ValidatorOutcome> = Promise.resolve()
    .then(() => validator.evaluate({ check, context }))
    .then(
      (result) =>
        deadlinePassed(startedAt, timeoutMs)
          ? { status: "timed_out" }
          : { status: "completed", result },
      () =>
        deadlinePassed(startedAt, timeoutMs)
          ? { status: "timed_out" }
          : { status: "failed" },
    );
  const deadline = new Promise<ValidatorOutcome>((resolve) => {
    timeout = setTimeout(() => resolve({ status: "timed_out" }), timeoutMs);
  });

  try {
    return await Promise.race([evaluation, deadline]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function validatorContext(
  context: AcceptanceContext,
): AcceptanceValidatorContext {
  return {
    runId: context.runId,
    goalId: context.goalId,
    milestoneId: context.milestoneId,
    workspacePath: context.workspacePath,
    extraReadRoots: context.extraReadRoots,
    extraWriteRoots: context.extraWriteRoots,
    locationEnv: context.locationEnv,
    toolExecutor: context.toolExecutor,
    trajectoryStore: context.trajectoryStore,
    artifacts: context.artifacts,
    transcriptMessages: context.transcriptMessages,
  };
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
