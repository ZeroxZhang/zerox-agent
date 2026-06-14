import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChatClient } from "./openAiCompatibleClient";
import type { AgentToolExecutionResult } from "./agentToolExecutor";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";
import type { AcceptanceCheck, Goal, Milestone, SuccessCriterion } from "../shared/agentGoal";
import {
  createAgentGoalAcceptance,
  type AcceptanceContext,
} from "./agentGoalAcceptance";

describe("agent goal acceptance", () => {
  let workspacePath: string;
  let trajectoryEvents: AgentTrajectoryEvent[];
  let toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(os.tmpdir(), "building-agent-acceptance-"));
    trajectoryEvents = [];
    toolCalls = [];
  });

  afterEach(async () => {
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("passes and fails file_exists checks based on workspace files", async () => {
    await mkdir(path.join(workspacePath, "reports"), { recursive: true });
    await writeFile(path.join(workspacePath, "reports", "done.md"), "done", "utf8");
    const acceptance = createAgentGoalAcceptance();

    const passed = await acceptance.evaluate(
      createMilestone([
        check("check_exists", "file_exists", { path: "reports/done.md" }),
      ]),
      createContext(),
    );
    const failed = await acceptance.evaluate(
      createMilestone([
        check("check_missing", "file_exists", { path: "reports/missing.md" }),
      ]),
      createContext(),
    );

    expect(passed.accepted).toBe(true);
    expect(passed.checkResults[0]).toMatchObject({
      checkId: "check_exists",
      kind: "file_exists",
      passed: true,
    });
    expect(failed.accepted).toBe(false);
    expect(failed.checkResults[0]).toMatchObject({
      checkId: "check_missing",
      kind: "file_exists",
      passed: false,
    });
    expect(trajectoryEvents.map((event) => event.type)).toEqual([
      "acceptance_checked",
      "acceptance_checked",
    ]);
  });

  it("accepts absolute file outputs only inside explicit goal output roots", async () => {
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "goal-output-root-"));
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "goal-output-outside-"));

    try {
      const reportPath = path.join(outputRoot, "serenity-report.md");
      const outsideReportPath = path.join(outsideRoot, "serenity-report.md");
      await writeFile(reportPath, "done", "utf8");
      await writeFile(outsideReportPath, "done", "utf8");
      const acceptance = createAgentGoalAcceptance();

      const passed = await acceptance.evaluate(
        createMilestone([
          check("check_absolute_output", "file_exists", { path: reportPath }),
        ]),
        createContext({ extraWriteRoots: [outputRoot] }),
      );
      const failed = await acceptance.evaluate(
        createMilestone([
          check("check_outside_output", "file_exists", {
            path: outsideReportPath,
          }),
        ]),
        createContext({ extraWriteRoots: [outputRoot] }),
      );

      expect(passed.accepted).toBe(true);
      expect(passed.checkResults[0]).toMatchObject({
        passed: true,
        detail: `File exists: ${reportPath}`,
      });
      expect(failed.accepted).toBe(false);
      expect(failed.checkResults[0]).toMatchObject({
        passed: false,
        detail: "Path is outside the workspace.",
      });
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it("runs command_exit_code checks through the permissioned tool path", async () => {
    const acceptance = createAgentGoalAcceptance();
    const result = await acceptance.evaluate(
      createMilestone([
        check("check_command", "command_exit_code", {
          command: "npm test -- src/shared/agentGoal.test.ts",
          expectedExitCode: 0,
        }),
      ]),
      createContext({
        toolResults: [
          {
            ok: true,
            result: { exitCode: 0, evidenceRefs: ["tool_shell_1"] },
          },
        ],
      }),
    );

    expect(result.accepted).toBe(true);
    expect(result.checkResults[0]).toMatchObject({
      checkId: "check_command",
      kind: "command_exit_code",
      passed: true,
      evidenceRefs: ["tool_shell_1"],
    });
    expect(toolCalls).toEqual([
      {
        toolName: "shell_exec",
        args: { command: "npm test -- src/shared/agentGoal.test.ts" },
      },
    ]);
  });

  it("runs test_passes checks through the native test_run tool", async () => {
    const acceptance = createAgentGoalAcceptance();
    const result = await acceptance.evaluate(
      createMilestone([
        check("check_tests", "test_passes", {
          command: "npm test -- src/main/agentGoalAcceptance.test.ts",
        }),
      ]),
      createContext({
        toolResults: [
          {
            ok: true,
            result: { exitCode: 0, evidenceRefs: ["test_run_1"] },
          },
        ],
      }),
    );

    expect(result.accepted).toBe(true);
    expect(result.checkResults[0]).toMatchObject({
      checkId: "check_tests",
      kind: "test_passes",
      passed: true,
      evidenceRefs: ["test_run_1"],
    });
    expect(toolCalls).toEqual([
      {
        toolName: "test_run",
        args: {
          command: "npm test -- src/main/agentGoalAcceptance.test.ts",
          workspaceRoot: workspacePath,
        },
      },
    ]);
  });

  it("evaluates structured assertions over artifacts", async () => {
    const acceptance = createAgentGoalAcceptance();

    const result = await acceptance.evaluate(
      createMilestone([
        check("check_artifact", "assertion", {
          artifactRef: "summary",
          path: "status",
          equals: "accepted",
        }),
      ]),
      createContext({
        artifacts: {
          summary: { status: "accepted" },
        },
      }),
    );

    expect(result).toMatchObject({
      accepted: true,
      inferentialUsed: false,
      checkResults: [
        {
          checkId: "check_artifact",
          kind: "assertion",
          passed: true,
        },
      ],
    });
  });

  it("treats model_review without evidence references as not accepted", async () => {
    let modelCalls = 0;
    const acceptance = createAgentGoalAcceptance();

    const result = await acceptance.evaluate(
      createMilestone([
        check("check_review", "model_review", { rubric: "complete" }, true),
      ]),
      createContext({
        chatClient: {
          async complete() {
            modelCalls += 1;
            return {
              content: '{"accepted":true,"detail":"looks good"}',
              toolCalls: [],
              finishReason: "stop",
            };
          },
        },
      }),
    );

    expect(result.accepted).toBe(false);
    expect(result.inferentialUsed).toBe(false);
    expect(result.checkResults[0]).toMatchObject({
      checkId: "check_review",
      kind: "model_review",
      passed: false,
      evidenceRefs: [],
    });
    expect(modelCalls).toBe(0);
  });

  it("passes artifact evidence content into model_review checks", async () => {
    const capturedPrompts: string[] = [];
    const acceptance = createAgentGoalAcceptance();

    const result = await acceptance.evaluate(
      createMilestone([
        check(
          "check_review",
          "model_review",
          {
            condition: "发布版本并确认验证命令通过",
            evidenceRefs: ["artifact:goalEvidence"],
          },
          true,
        ),
      ]),
      createContext({
        artifacts: {
          goalEvidence: {
            currentMilestone: {
              status: "succeeded",
              summary: "npm run verify passed and release notes were written.",
            },
          },
        },
        chatClient: {
          async complete(request) {
            capturedPrompts.push(request.messages.at(-1)?.content ?? "");
            return {
              content: '{"accepted":true,"detail":"verify evidence is present"}',
              toolCalls: [],
              finishReason: "stop",
            };
          },
        },
      }),
    );

    expect(result.accepted).toBe(true);
    expect(result.checkResults[0]).toMatchObject({
      checkId: "check_review",
      evidenceRefs: ["artifact:goalEvidence"],
      passed: true,
    });
    expect(capturedPrompts[0]).toContain("发布版本并确认验证命令通过");
    expect(capturedPrompts[0]).toContain("artifact:goalEvidence");
    expect(capturedPrompts[0]).toContain("npm run verify passed");
  });

  it("resolves artifact evidence from files in explicit goal output roots before model_review checks", async () => {
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "goal-artifact-root-"));
    const capturedPrompts: string[] = [];

    try {
      const notesPath = path.join(outputRoot, "research_notes.md");
      await writeFile(
        notesPath,
        "# Research Notes\n\n段永平长期主义与本分方法论笔记。",
        "utf8",
      );
      const acceptance = createAgentGoalAcceptance();

      const result = await acceptance.evaluate(
        createMilestone([
          check(
            "check_review",
            "model_review",
            {
              condition: "研究笔记文件已经生成并包含可验收内容",
              evidenceRefs: ["artifact:research_notes"],
            },
            true,
          ),
        ]),
        createContext({
          extraWriteRoots: [outputRoot],
          chatClient: {
            async complete(request) {
              capturedPrompts.push(request.messages.at(-1)?.content ?? "");
              return {
                content: '{"accepted":true,"detail":"notes evidence is present"}',
                toolCalls: [],
                finishReason: "stop",
              };
            },
          },
        }),
      );

      expect(result.accepted).toBe(true);
      expect(capturedPrompts[0]).toContain("artifact:research_notes");
      expect(capturedPrompts[0]).toContain(notesPath);
      expect(capturedPrompts[0]).toContain("段永平长期主义");
      expect(capturedPrompts[0]).not.toContain("artifact:research_notes: missing");
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });

  it("rejects model_review checks when required artifact evidence cannot be resolved", async () => {
    let modelCalls = 0;
    const acceptance = createAgentGoalAcceptance();

    const result = await acceptance.evaluate(
      createMilestone([
        check(
          "check_review",
          "model_review",
          {
            condition: "研究笔记文件已经生成",
            evidenceRefs: ["artifact:research_notes"],
          },
          true,
        ),
      ]),
      createContext({
        chatClient: {
          async complete() {
            modelCalls += 1;
            return {
              content: '{"accepted":true,"detail":"looks good"}',
              toolCalls: [],
              finishReason: "stop",
            };
          },
        },
      }),
    );

    expect(result.accepted).toBe(false);
    expect(result.inferentialUsed).toBe(false);
    expect(result.checkResults[0]).toMatchObject({
      checkId: "check_review",
      kind: "model_review",
      passed: false,
      evidenceRefs: ["artifact:research_notes"],
      detail: "Missing required artifact evidence: artifact:research_notes.",
    });
    expect(modelCalls).toBe(0);
  });

  it("evaluates deterministic checks before model_review checks", async () => {
    let modelCalls = 0;
    const acceptance = createAgentGoalAcceptance();

    const result = await acceptance.evaluate(
      createMilestone([
        check(
          "check_review",
          "model_review",
          { evidenceRefs: ["evidence_1"] },
          true,
        ),
        check("check_missing", "file_exists", { path: "missing.txt" }),
      ]),
      createContext({
        chatClient: {
          async complete() {
            modelCalls += 1;
            return {
              content: '{"accepted":true,"detail":"looks good"}',
              toolCalls: [],
              finishReason: "stop",
            };
          },
        },
      }),
    );

    expect(result.accepted).toBe(false);
    expect(result.checkResults.map((checkResult) => checkResult.kind)).toEqual([
      "file_exists",
    ]);
    expect(result.inferentialUsed).toBe(false);
    expect(modelCalls).toBe(0);
  });

  it("evaluates goal-level success criteria and emits acceptance_checked trajectory details", async () => {
    const acceptance = createAgentGoalAcceptance();
    const goal = createGoal([
      check("check_goal_artifact", "assertion", {
        artifactRef: "goalSummary",
        path: "accepted",
        equals: true,
      }),
    ]);

    const result = await acceptance.evaluateGoal(
      goal,
      createContext({
        artifacts: { goalSummary: { accepted: true } },
      }),
    );

    expect(result.accepted).toBe(true);
    expect(trajectoryEvents).toHaveLength(1);
    expect(trajectoryEvents[0]).toMatchObject({
      type: "acceptance_checked",
      runId: "run_acceptance",
      payload: {
        goalId: "goal_1",
        accepted: true,
        inferentialUsed: false,
      },
    });
  });

  function createContext(options: {
    toolResults?: AgentToolExecutionResult[];
    artifacts?: Record<string, unknown>;
    chatClient?: ChatClient;
    extraWriteRoots?: string[];
  } = {}): AcceptanceContext {
    const queuedResults = [...(options.toolResults ?? [])];
    return {
      runId: "run_acceptance",
      goalId: "goal_1",
      milestoneId: "milestone_1",
      workspacePath,
      extraWriteRoots: options.extraWriteRoots ?? [],
      artifacts: options.artifacts ?? {},
      chatClient: options.chatClient,
      toolExecutor: {
        async execute(request) {
          toolCalls.push({ toolName: request.toolName, args: request.args });
          return (
            queuedResults.shift() ?? {
              ok: false,
              error: `No fake result for ${request.toolName}.`,
            }
          );
        },
      },
      trajectoryStore: {
        async append(_runId, event) {
          trajectoryEvents.push(event);
          return event;
        },
      },
      createId: () => `acceptance_${trajectoryEvents.length + 1}`,
      nextSequence: () => trajectoryEvents.length + 1,
      now: () => "2026-06-12T00:00:00.000Z",
    };
  }
});

function createMilestone(checks: AcceptanceCheck[]): Milestone {
  return {
    id: "milestone_1",
    description: "Verify milestone.",
    dependsOn: [],
    successCriteria: [createCriterion(checks)],
    state: "running",
    runIds: ["run_acceptance"],
    attempts: 1,
  };
}

function createGoal(checks: AcceptanceCheck[]): Goal {
  return {
    id: "goal_1",
    description: "Verify goal.",
    successCriteria: [createCriterion(checks)],
    milestones: [],
    status: "executing",
    budget: {
      maxIterations: 8,
      maxToolCalls: 24,
      maxWallClockMs: 600_000,
      maxReplans: 2,
    },
    budgetUsage: {
      iterations: 1,
      toolCalls: 1,
      wallClockMs: 1000,
      tokens: 0,
      replans: 0,
    },
    reviewPolicy: "review_final_only",
    planVersion: 1,
    createdAt: "2026-06-12T00:00:00.000Z",
    updatedAt: "2026-06-12T00:00:00.000Z",
  };
}

function createCriterion(checks: AcceptanceCheck[]): SuccessCriterion {
  return {
    id: "criterion_1",
    description: "Acceptance criterion.",
    acceptanceChecks: checks,
  };
}

function check(
  id: string,
  kind: AcceptanceCheck["kind"],
  params: Record<string, unknown>,
  requiresEvidence = false,
): AcceptanceCheck {
  return {
    id,
    kind,
    description: `${kind} check`,
    params,
    requiresEvidence,
  };
}
