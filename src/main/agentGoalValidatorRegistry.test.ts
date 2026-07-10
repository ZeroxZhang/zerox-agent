import { describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";
import type {
  AcceptanceCheck,
  AcceptanceCheckKind,
  GoalAcceptanceCheckResult,
} from "../shared/agentGoal";
import type { AcceptanceContext } from "./agentGoalAcceptance";
import {
  createAgentGoalValidatorRegistry,
  type AcceptanceValidator,
  type AcceptanceValidatorContext,
} from "./agentGoalValidatorRegistry";

describe("agent goal validator registry", () => {
  it("dispatches a built-in check and preserves the validator result", async () => {
    const expected: GoalAcceptanceCheckResult = {
      checkId: "check_assertion",
      kind: "assertion",
      passed: true,
      code: "assertion_passed",
      evidenceRefs: ["artifact:summary"],
      detail: "Assertion passed.",
    };
    const validator: AcceptanceValidator = {
      kind: "assertion",
      async evaluate() {
        return expected;
      },
    };
    const registry = createAgentGoalValidatorRegistry({
      validators: [validator],
    });

    const actual = await registry.evaluate(check("assertion"), context());

    expect(actual).toBe(expected);
  });

  it("passes governed capability and boundary references through a restricted view", async () => {
    const governedContext = context();
    let receivedContext: AcceptanceValidatorContext | undefined;
    const validator: AcceptanceValidator = {
      kind: "file_exists",
      async evaluate(input) {
        receivedContext = input.context;
        return passedResult(input.check);
      },
    };
    const registry = createAgentGoalValidatorRegistry({
      validators: [validator],
    });

    await registry.evaluate(check("file_exists"), governedContext);

    expect(receivedContext).not.toBe(governedContext);
    expect(receivedContext).toMatchObject({
      runId: governedContext.runId,
      goalId: governedContext.goalId,
      workspacePath: governedContext.workspacePath,
    });
    expect(receivedContext?.toolExecutor).toBe(governedContext.toolExecutor);
    expect(receivedContext?.trajectoryStore).toBe(
      governedContext.trajectoryStore,
    );
    expect(receivedContext?.extraReadRoots).toBe(governedContext.extraReadRoots);
    expect(receivedContext?.extraWriteRoots).toBe(
      governedContext.extraWriteRoots,
    );
    expect(receivedContext?.locationEnv).toBe(governedContext.locationEnv);
    expect(receivedContext?.artifacts).toBe(governedContext.artifacts);
    expect(receivedContext?.transcriptMessages).toBe(
      governedContext.transcriptMessages,
    );
  });

  it("does not expose model credentials or chat capabilities to validators", async () => {
    const sentinelApiKey = "sentinel-api-key-must-not-reach-validator";
    const fullContext = context();
    fullContext.modelProfile = {
      baseUrl: "https://example.invalid",
      apiKey: sentinelApiKey,
      model: "secret-model",
      temperature: 0,
      maxTokens: 100,
    };
    fullContext.chatClient = {
      async complete() {
        throw new Error("Chat access is not expected in registry tests.");
      },
    };
    let receivedContext: AcceptanceValidatorContext | undefined;
    const registry = createAgentGoalValidatorRegistry({
      validators: [
        {
          kind: "assertion",
          async evaluate(input) {
            receivedContext = input.context;
            return passedResult(input.check);
          },
        },
      ],
    });

    await registry.evaluate(check("assertion"), fullContext);

    expect(receivedContext).not.toHaveProperty("modelProfile");
    expect(receivedContext).not.toHaveProperty("chatClient");
    expect(JSON.stringify(receivedContext)).not.toContain(sentinelApiKey);
  });

  it("dispatches a namespaced custom validator", async () => {
    const kind = "validator:local/report" as const;
    const validator: AcceptanceValidator = {
      kind,
      async evaluate({ check: selectedCheck }) {
        return passedResult(selectedCheck);
      },
    };
    const registry = createAgentGoalValidatorRegistry({
      validators: [validator],
    });

    await expect(registry.evaluate(check(kind), context())).resolves.toMatchObject({
      checkId: "check_validator_local_report",
      kind,
      passed: true,
      code: "passed",
    });
  });

  it("rejects duplicate validator kinds during construction", () => {
    const first = validator("assertion");
    const duplicate = validator("assertion");

    expect(() =>
      createAgentGoalValidatorRegistry({ validators: [first, duplicate] }),
    ).toThrow("Acceptance validator already registered: assertion");
  });

  it("rejects duplicate validator kinds registered later", () => {
    const registry = createAgentGoalValidatorRegistry({
      validators: [validator("assertion")],
    });

    expect(() => registry.register(validator("assertion"))).toThrow(
      "Acceptance validator already registered: assertion",
    );
  });

  it("turns an unavailable custom validator into a typed blocked result", async () => {
    const registry = createAgentGoalValidatorRegistry({ timeoutMs: 20 });

    await expect(
      registry.evaluate(check("validator:local/report"), context()),
    ).resolves.toEqual({
      checkId: "check_validator_local_report",
      kind: "validator:local/report",
      passed: false,
      code: "validator_not_registered",
      failureClass: "validator_unavailable",
      evidenceRefs: [],
      detail: "Acceptance validator is not registered.",
    });
  });

  it("times out instead of allowing a validator to trap acceptance", async () => {
    let resolveValidator:
      | ((result: GoalAcceptanceCheckResult) => void)
      | undefined;
    const neverValidator: AcceptanceValidator = {
      kind: "validator:local/never",
      evaluate() {
        return new Promise((resolve) => {
          resolveValidator = resolve;
        });
      },
    };
    const registry = createAgentGoalValidatorRegistry({
      validators: [neverValidator],
      timeoutMs: 5,
    });

    const result = await registry.evaluate(check(neverValidator.kind), context());
    resolveValidator?.(passedResult(check(neverValidator.kind)));

    expect(result).toEqual({
      checkId: "check_validator_local_never",
      kind: "validator:local/never",
      passed: false,
      code: "validator_timeout",
      failureClass: "validator_unavailable",
      evidenceRefs: [],
      detail: "Acceptance validator timed out.",
    });
  });

  it("times out when a synchronous validator blocks past its deadline", async () => {
    const slowValidator: AcceptanceValidator = {
      kind: "validator:local/blocking",
      async evaluate({ check: selectedCheck }) {
        const deadline = performance.now() + 20;
        while (performance.now() < deadline) {
          // Intentionally block to prove elapsed-deadline enforcement.
        }
        return passedResult(selectedCheck);
      },
    };
    const registry = createAgentGoalValidatorRegistry({
      validators: [slowValidator],
      timeoutMs: 5,
    });

    await expect(
      registry.evaluate(check(slowValidator.kind), context()),
    ).resolves.toMatchObject({
      passed: false,
      code: "validator_timeout",
      failureClass: "validator_unavailable",
    });
  });

  it.each([
    ["a synchronous throw", () => {
      throw new Error("secret synchronous payload");
    }],
    ["a rejected promise", async () => {
      throw new Error("secret rejected payload");
    }],
  ])(
    "sanitizes validator infrastructure errors from %s",
    async (_label, evaluate) => {
      const kind = "validator:local/error" as const;
      const registry = createAgentGoalValidatorRegistry({
        validators: [{ kind, evaluate }],
      });

      const result = await registry.evaluate(check(kind), context());

      expect(result).toEqual({
        checkId: "check_validator_local_error",
        kind,
        passed: false,
        code: "validator_error",
        failureClass: "validator_unavailable",
        evidenceRefs: [],
        detail: "Acceptance validator failed.",
      });
      expect(result.detail).not.toContain("secret");
    },
  );

  it("lists kinds in registration order without exposing mutable state", () => {
    const registry = createAgentGoalValidatorRegistry({
      validators: [validator("test_passes"), validator("file_exists")],
    });

    const firstList = registry.listKinds();
    firstList.push("model_review");
    registry.register(validator("assertion"));

    expect(registry.listKinds()).toEqual([
      "test_passes",
      "file_exists",
      "assertion",
    ]);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects a nonsensical timeout value: %s",
    (timeoutMs) => {
      expect(() => createAgentGoalValidatorRegistry({ timeoutMs })).toThrow(
        "Acceptance validator timeout must be a positive finite number.",
      );
    },
  );
});

function check(kind: AcceptanceCheckKind): AcceptanceCheck {
  return {
    id: `check_${kind.replace(/[^a-z0-9]+/gi, "_")}`,
    kind,
    description: `Evaluate ${kind}`,
    params: {},
    requiresEvidence: false,
  };
}

function context(): AcceptanceContext {
  return {
    runId: "run_registry",
    goalId: "goal_registry",
    workspacePath: "/tmp/registry-workspace",
    extraReadRoots: ["/tmp/registry-read"],
    extraWriteRoots: ["/tmp/registry-write"],
    locationEnv: {
      homeDir: "/tmp/registry-home",
      platform: "linux",
    },
    artifacts: { report: { status: "ready" } },
    transcriptMessages: [{ role: "user", content: "Validate the report." }],
    toolExecutor: {
      async execute() {
        throw new Error("Tool execution is not expected in registry tests.");
      },
    },
    trajectoryStore: {
      async append(_runId, event) {
        return event;
      },
    },
  };
}

function validator(kind: AcceptanceCheckKind): AcceptanceValidator {
  return {
    kind,
    async evaluate({ check: selectedCheck }) {
      return passedResult(selectedCheck);
    },
  };
}

function passedResult(
  checkToEvaluate: AcceptanceCheck,
): GoalAcceptanceCheckResult {
  return {
    checkId: checkToEvaluate.id,
    kind: checkToEvaluate.kind,
    passed: true,
    code: "passed",
    evidenceRefs: [],
    detail: "Acceptance validator passed.",
  };
}
