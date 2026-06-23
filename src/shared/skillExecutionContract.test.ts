import { describe, expect, it } from "vitest";
import {
  canTransitionSkillStage,
  transitionSkillExecution,
  type SkillExecutionSnapshot,
  type SkillExecutionStage,
} from "./skillExecutionContract";

const startedAt = "2026-06-21T00:00:00.000Z";

function createSnapshot(
  stage: SkillExecutionStage = "resolving_skill",
): SkillExecutionSnapshot {
  return {
    schemaVersion: 1,
    executionId: "skill_exec_chat_s1_r1",
    taskId: "chat_s1_r1",
    sessionId: "s1",
    requestId: "r1",
    workspaceId: "workspace_building_agent",
    selectedSkillName: "agent-reach",
    skill: {
      name: "agent-reach",
      displayName: "Agent Reach",
      version: "1.0.0",
      skillFile: "/workspace/skills/agent-reach/SKILL.md",
      rootDir: "/workspace/skills/agent-reach",
      bodyHash: "sha256:body",
      manifestHash: "sha256:manifest",
    },
    budgets: {
      maxTurns: 8,
      usedTurns: 2,
      maxToolCalls: 12,
    },
    resources: [
      {
        kind: "reference",
        relativePath: "references/browser.md",
        absolutePath: "/workspace/skills/agent-reach/references/browser.md",
      },
    ],
    stage,
    stageRecords: [{ stage, enteredAt: startedAt, message: "created" }],
    terminal: stage === "succeeded" || stage === "failed" || stage === "canceled",
    createdAt: startedAt,
    updatedAt: startedAt,
  };
}

describe("skill execution contract", () => {
  it("allows the expected staged skill execution path", () => {
    const stages: SkillExecutionStage[] = [
      "resolving_skill",
      "loading_resources",
      "auditing_requirements",
      "planning",
      "executing",
      "validating",
      "finalizing",
      "succeeded",
    ];

    let snapshot = createSnapshot(stages[0]);

    stages.slice(1).forEach((stage, index) => {
      expect(canTransitionSkillStage(snapshot.stage, stage)).toBe(true);

      const previous = snapshot;
      snapshot = transitionSkillExecution(snapshot, stage, {
        at: `2026-06-21T00:00:0${index + 1}.000Z`,
        message: `entered ${stage}`,
      });

      expect(snapshot).not.toBe(previous);
      expect(previous.stage).toBe(stages[index]);
      expect(snapshot.stage).toBe(stage);
    });

    expect(snapshot.terminal).toBe(true);
    expect(snapshot.stageRecords.map((record) => record.stage)).toEqual(stages);
    expect(snapshot.stageRecords.at(-1)).toMatchObject({
      stage: "succeeded",
      message: "entered succeeded",
    });
  });

  it("keeps terminal stages immutable", () => {
    const terminalStages: SkillExecutionStage[] = [
      "succeeded",
      "failed",
      "canceled",
    ];

    terminalStages.forEach((terminalStage) => {
      const snapshot = createSnapshot(terminalStage);

      expect(canTransitionSkillStage(terminalStage, "executing")).toBe(false);
      expect(canTransitionSkillStage(terminalStage, terminalStage)).toBe(false);
      expect(() =>
        transitionSkillExecution(snapshot, "executing"),
      ).toThrowError(/terminal/i);
      expect(() =>
        transitionSkillExecution(snapshot, terminalStage),
      ).toThrowError(/terminal/i);
    });
  });

  it("rejects invalid stage skips and backwards transitions", () => {
    const invalidTransitions: Array<[SkillExecutionStage, SkillExecutionStage]> = [
      ["resolving_skill", "executing"],
      ["loading_resources", "planning"],
      ["loading_resources", "configuring"],
      ["executing", "finalizing"],
      ["validating", "succeeded"],
      ["finalizing", "executing"],
    ];

    invalidTransitions.forEach(([from, to]) => {
      expect(canTransitionSkillStage(from, to)).toBe(false);
      expect(() =>
        transitionSkillExecution(createSnapshot(from), to),
      ).toThrowError(`Cannot transition skill execution from "${from}" to "${to}".`);
    });
  });

  it("preserves skill provenance and budgets in snapshots", () => {
    const snapshot = transitionSkillExecution(
      createSnapshot("executing"),
      "validating",
      {
        at: "2026-06-21T00:00:10.000Z",
        metadata: { validation: "preflight" },
      },
    );

    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      executionId: "skill_exec_chat_s1_r1",
      selectedSkillName: "agent-reach",
      skill: {
        name: "agent-reach",
        skillFile: "/workspace/skills/agent-reach/SKILL.md",
        rootDir: "/workspace/skills/agent-reach",
        bodyHash: "sha256:body",
        manifestHash: "sha256:manifest",
      },
      budgets: {
        maxTurns: 8,
        usedTurns: 2,
        maxToolCalls: 12,
      },
    });
    expect(snapshot.resources).toEqual([
      {
        kind: "reference",
        relativePath: "references/browser.md",
        absolutePath: "/workspace/skills/agent-reach/references/browser.md",
      },
    ]);
    expect(snapshot.stageRecords.at(-1)).toMatchObject({
      stage: "validating",
      metadata: { validation: "preflight" },
    });
  });

  it("records guided input resolution while pausing and resuming preflight", () => {
    let snapshot = transitionSkillExecution(
      createSnapshot("loading_resources"),
      "auditing_requirements",
      {
        at: "2026-06-21T00:00:01.000Z",
        message: "auditing required inputs",
      },
    );

    snapshot = transitionSkillExecution(snapshot, "waiting_for_user_input", {
      at: "2026-06-21T00:00:02.000Z",
      pendingInputRequestId: "input_1",
      inputResolution: {
        status: "missing",
        values: {},
        missingFields: ["targetDir"],
        invalidFields: [],
      },
    });

    expect(snapshot.pendingInputRequestId).toBe("input_1");
    expect(snapshot.inputResolution).toEqual({
      status: "missing",
      values: {},
      missingFields: ["targetDir"],
      invalidFields: [],
    });

    snapshot = transitionSkillExecution(snapshot, "validating_input", {
      at: "2026-06-21T00:00:03.000Z",
      inputResolution: {
        status: "complete",
        values: { targetDir: "/workspace/project" },
        missingFields: [],
        invalidFields: [],
      },
    });
    snapshot = transitionSkillExecution(snapshot, "planning", {
      at: "2026-06-21T00:00:04.000Z",
    });

    expect(snapshot.stageRecords.map((record) => record.stage)).toEqual([
      "loading_resources",
      "auditing_requirements",
      "waiting_for_user_input",
      "validating_input",
      "planning",
    ]);
    expect(snapshot.inputResolution).toMatchObject({
      status: "complete",
      values: { targetDir: "/workspace/project" },
    });
  });

  it("allows tool approval waits while executing", () => {
    let snapshot = transitionSkillExecution(
      createSnapshot("executing"),
      "waiting_for_approval",
      {
        at: "2026-06-21T00:00:20.000Z",
        message: "waiting for tool approval",
      },
    );

    expect(snapshot.stage).toBe("waiting_for_approval");
    expect(canTransitionSkillStage("waiting_for_approval", "executing")).toBe(
      true,
    );

    snapshot = transitionSkillExecution(snapshot, "executing", {
      at: "2026-06-21T00:00:21.000Z",
      message: "approval granted",
    });

    expect(snapshot.stageRecords.map((record) => record.stage)).toEqual([
      "executing",
      "waiting_for_approval",
      "executing",
    ]);
  });
});
