import { describe, expect, it, vi } from "vitest";
import type { Goal, Milestone } from "../shared/agentGoal";
import { buildPrimaryRunContext } from "../shared/agentWorkspace";
import { createAgentGoalAcceptance } from "./agentGoalAcceptance";
import { createAuthorizedGoalAcceptanceToolExecutor } from "./agentGoalAcceptanceToolExecutor";
import {
  createAgentGoalValidatorRegistry,
  type AcceptanceValidator,
} from "./agentGoalValidatorRegistry";
import type { ToolAuthorizationService } from "./toolAuthorizationService";
import { createToolAuthorizationService } from "./toolAuthorizationService";

describe("authorized goal acceptance tool executor", () => {
  it("denies a built-in command check before the raw executor runs", async () => {
    let rawCalls = 0;
    const authorize = vi.fn(async () => deniedAuthorization());
    const runContext = canonicalRunContext();
    const acceptance = createAgentGoalAcceptance();
    const result = await acceptance.evaluate(commandMilestone(), {
      runId: "run_acceptance_deny",
      goalId: "goal_acceptance_deny",
      milestoneId: "milestone_command",
      workspacePath: runContext.workspaceRoot,
      toolExecutor: createAuthorizedGoalAcceptanceToolExecutor({
        taskId: "goal_acceptance:goal_acceptance_deny:milestone_command",
        goal: goal(),
        runContext,
        toolAuthorizationService: { authorize } as ToolAuthorizationService,
        toolExecutor: {
          async execute() {
            rawCalls += 1;
            return {
              ok: true,
              result: {
                output: "exit code 0",
                metadata: { exitCode: 0 },
              },
            };
          },
        },
      }),
      trajectoryStore: { async append(_runId, event) { return event; } },
    });

    expect(result).toMatchObject({
      accepted: false,
      verdict: "acceptance_unavailable",
      failureClass: "validator_unavailable",
      checkResults: [{
        passed: false,
        code: "command_executor_unavailable",
        failureClass: "validator_unavailable",
      }],
    });
    expect(rawCalls).toBe(0);
    expect(authorize).toHaveBeenCalledWith(
      "goal_acceptance:goal_acceptance_deny:milestone_command",
      expect.objectContaining({ toolName: "test_run" }),
      expect.objectContaining({ runContext }),
    );
  });

  it("enforces real kernel deny rules before executing acceptance shell tools", async () => {
    let rawCalls = 0;
    const runContext = canonicalRunContext();
    const authorization = createToolAuthorizationService({
      taskStore: { async get() { return null; } } as never,
      auditLog: {
        async append(event: unknown) {
          return { id: "audit_acceptance_deny", ...(event as object) };
        },
      } as never,
      permissionRules: [{ pattern: "rm -f *", action: "deny" }],
    });
    const executor = createAuthorizedGoalAcceptanceToolExecutor({
      taskId: "goal_acceptance:kernel-deny",
      goal: goal(),
      runContext,
      toolAuthorizationService: authorization,
      toolExecutor: {
        async execute() {
          rawCalls += 1;
          return { ok: true, result: {} };
        },
      },
    });

    const result = await executor.execute({
      toolName: "shell_exec",
      args: { command: "rm -f ./report.md" },
    });

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("Permission rule denied rm"),
    });
    expect(rawCalls).toBe(0);
  });

  it("denies a custom validator tool call before the raw executor runs", async () => {
    let rawCalls = 0;
    const runContext = canonicalRunContext();
    const validator: AcceptanceValidator = {
      kind: "validator:local/denied-shell",
      async evaluate({ check, context }) {
        const toolResult = await context.toolExecutor.execute({
          toolName: "shell_exec",
          args: { command: "rm -f ./report.md" },
        });
        return {
          checkId: check.id,
          kind: check.kind,
          passed: toolResult.ok,
          code: toolResult.ok ? "unexpected_allow" : "authorization_denied",
          ...(toolResult.ok ? {} : { failureClass: "command_failed" as const }),
          evidenceRefs: [],
          detail: toolResult.ok ? "Unexpectedly allowed." : "Denied.",
        };
      },
    };
    const acceptance = createAgentGoalAcceptance({
      registry: createAgentGoalValidatorRegistry({ validators: [validator] }),
    });
    const milestone: Milestone = {
      id: "milestone_custom",
      description: "Run governed custom acceptance.",
      dependsOn: [],
      successCriteria: [{
        id: "criterion_custom",
        description: "Custom validator remains governed.",
        acceptanceChecks: [{
          id: "check_custom",
          kind: validator.kind,
          description: "Try a denied command.",
          params: {},
          requiresEvidence: false,
        }],
      }],
      state: "running",
      runIds: ["run_custom"],
      attempts: 1,
    };

    const result = await acceptance.evaluate(milestone, {
      runId: "run_custom",
      goalId: "goal_acceptance_deny",
      milestoneId: milestone.id,
      workspacePath: runContext.workspaceRoot,
      toolExecutor: createAuthorizedGoalAcceptanceToolExecutor({
        taskId: "goal_acceptance:goal_acceptance_deny:milestone_custom",
        goal: goal(),
        runContext,
        toolAuthorizationService: {
          authorize: async () => deniedAuthorization(),
        },
        toolExecutor: {
          async execute() {
            rawCalls += 1;
            return { ok: true, result: {} };
          },
        },
      }),
      trajectoryStore: { async append(_runId, event) { return event; } },
    });

    expect(result.accepted).toBe(false);
    expect(result.checkResults[0]?.code).toBe("authorization_denied");
    expect(rawCalls).toBe(0);
  });

  it("executes an allowed check with the canonical run context", async () => {
    const runContext = canonicalRunContext();
    const callerContext = {
      ...runContext,
      workspaceRoot: "/tmp/attacker-context",
    };
    let receivedContext: unknown;
    const executor = createAuthorizedGoalAcceptanceToolExecutor({
      taskId: "goal_acceptance:allowed",
      goal: goal(),
      runContext,
      toolAuthorizationService: {
        authorize: async () => ({
          ok: true,
          decision: { allowed: true, reason: "Allowed by test policy." },
          auditEvent: {} as never,
        }),
      },
      toolExecutor: {
        async execute(_request, options) {
          receivedContext = options?.runContext;
          return { ok: true, result: {} };
        },
      },
    });

    await executor.execute(
      { toolName: "test_run", args: { command: "npm test" } },
      { runContext: callerContext },
    );

    expect(receivedContext).toBe(runContext);
  });

  it("executes an interpreter acceptance command frozen into the goal contract", async () => {
    const command =
      "python3 -c \"import json; json.load(open('allergen-map/data/china.geo.json'))\"";
    const commandGoal = goal();
    commandGoal.successCriteria[0]!.acceptanceChecks[0]!.params.command = command;
    commandGoal.successCriteria[0]!.acceptanceChecks[0]!.params.workspaceRoot = ".";
    commandGoal.milestones[0]!.successCriteria[0]!.acceptanceChecks[0]!.params.command =
      command;
    commandGoal.milestones[0]!.successCriteria[0]!.acceptanceChecks[0]!.params.workspaceRoot =
      ".";
    const runContext = canonicalRunContext();
    const authorization = createToolAuthorizationService({
      taskStore: { async get() { return null; } } as never,
      auditLog: {
        async append(event: unknown) {
          return { id: "audit_acceptance_allowed", ...(event as object) };
        },
      } as never,
    });
    const rawExecute = vi.fn(async () => ({
      ok: true as const,
      result: { exitCode: 0 },
    }));
    const acceptance = createAgentGoalAcceptance();
    const result = await acceptance.evaluate(commandGoal.milestones[0]!, {
      runId: "run_acceptance_allowed",
      goalId: commandGoal.id,
      milestoneId: commandGoal.milestones[0]!.id,
      workspacePath: runContext.workspaceRoot,
      toolExecutor: createAuthorizedGoalAcceptanceToolExecutor({
        taskId: `goal_acceptance:${commandGoal.id}:milestone_command`,
        goal: commandGoal,
        runContext,
        toolAuthorizationService: authorization,
        toolExecutor: { execute: rawExecute },
      }),
      trajectoryStore: { async append(_runId, event) { return event; } },
    });

    expect(result.accepted).toBe(true);
    expect(rawExecute).toHaveBeenCalledTimes(1);
    expect(rawExecute).toHaveBeenCalledWith(
      {
        toolName: "test_run",
        args: {
          command,
          workspaceRoot: runContext.workspaceRoot,
        },
      },
      expect.objectContaining({
        runContext,
        authorizedShellCommand: command,
      }),
    );
  });
});

function canonicalRunContext() {
  return buildPrimaryRunContext({
    workspaceId: "workspace_acceptance",
    workspaceRoot: "/tmp/acceptance-workspace",
    goalId: "goal_acceptance_deny",
  });
}

function deniedAuthorization() {
  return {
    ok: true as const,
    decision: {
      allowed: false as const,
      kind: "policy_deny" as const,
      reason: "Denied by kernel rule.",
    },
    auditEvent: {} as never,
  };
}

function commandMilestone(): Milestone {
  return {
    id: "milestone_command",
    description: "Run a governed command check.",
    dependsOn: [],
    successCriteria: [{
      id: "criterion_command",
      description: "Command must be authorized and pass.",
      acceptanceChecks: [{
        id: "check_command",
        kind: "command_exit_code",
        description: "Try a denied destructive command.",
        params: {
          command: "rm -f ./report.md",
          expectedExitCode: 0,
        },
        requiresEvidence: false,
      }],
    }],
    state: "running",
    runIds: ["run_acceptance_deny"],
    attempts: 1,
  };
}

function goal(): Goal {
  return {
    id: "goal_acceptance_deny",
    description: "Keep acceptance tool calls governed.",
    successCriteria: commandMilestone().successCriteria,
    milestones: [commandMilestone()],
    status: "executing",
    budget: {
      maxIterations: 3,
      maxToolCalls: 10,
      maxWallClockMs: 60_000,
      maxReplans: 1,
    },
    executionUsage: {
      iterations: 0,
      toolCalls: 0,
      wallClockMs: 0,
      tokens: 0,
      replans: 0,
    },
    reviewPolicy: "review_final_only",
    planVersion: 1,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
  };
}
