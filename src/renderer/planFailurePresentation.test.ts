import { describe, expect, it } from "vitest";
import type { PlanRecord } from "../shared/planMode";
import {
  getActivePlanPresentation,
  getPlanFailurePresentation,
  getPlanOutcomePresentation,
} from "./planFailurePresentation";

describe("plan failure presentation", () => {
  it("turns a quality-gate failure into a concise outcome and next action", () => {
    const presentation = getPlanFailurePresentation(
      planWithFailure({
        planningStages: [
          {
            id: "quality-1",
            kind: "quality",
            runId: "quality-run-1",
            status: "failed",
            evidenceRefs: [],
            startedAt: "2026-07-31T00:00:00.000Z",
            completedAt: "2026-07-31T00:00:01.000Z",
            error: "验收路径越界。",
          },
        ],
      }),
    );

    expect(presentation).toEqual({
      title: "Debate 规划失败",
      detail: "系统没有完成这次规划，但已完成的内容已经保留。",
      nextAction: "请重新检查计划；如果仍然失败，可补充验收要求后再规划。",
      actionLabel: "重新尝试",
      technicalDetail: "验收路径越界。",
    });
  });

  it("preserves the explicit legacy turn-limit explanation", () => {
    const presentation = getPlanFailurePresentation(
      planWithFailure({
        planningStages: [
          {
            id: "investigation-1",
            kind: "investigation",
            runId: "investigation-run-1",
            status: "failed",
            evidenceRefs: [],
            startedAt: "2026-07-31T00:00:00.000Z",
            completedAt: "2026-07-31T00:00:01.000Z",
            error: "turn_limit",
          },
        ],
      }),
    );

    expect(presentation).toMatchObject({
      title: "Debate 规划失败",
      actionLabel: "重新尝试",
    });
    expect(presentation?.detail).not.toContain("turn_limit");
    expect(presentation?.technicalDetail).toContain("收集 2 条证据");
  });

  it("projects a recovered plan over stale persisted failure activity", () => {
    const presentation = getActivePlanPresentation(
      planWithFailure({
        status: "awaiting_confirmation",
        finalArtifact: {
          title: "创建抖音链接转文稿 Skill",
        } as PlanRecord["finalArtifact"],
      }),
    );

    expect(presentation).toEqual({
      statusMessage:
        "Debate 规划成功 · 检查计划后点击“确认计划并开始执行”；如需调整，直接输入修改意见。",
      taskTitle: "Debate 规划成功",
      taskDetail:
        "检查计划后点击“确认计划并开始执行”；如需调整，直接输入修改意见。",
    });
  });

  it("tells the user what to do after a successful Debate without exposing internals", () => {
    const presentation = getPlanOutcomePresentation(
      planWithFailure({
        status: "awaiting_confirmation",
        actionGate: "ready",
        finalArtifact: {
          title: "可执行终版计划",
        } as PlanRecord["finalArtifact"],
      }),
    );

    expect(presentation).toEqual({
      kind: "success",
      title: "Debate 规划成功",
      detail: "终版计划已经准备好，目前还没有执行任何操作。",
      nextAction:
        "检查计划后点击“确认计划并开始执行”；如需调整，直接输入修改意见。",
    });
  });

  it("keeps a raw failed-round error only in opt-in technical detail", () => {
    const presentation = getPlanFailurePresentation(
      planWithFailure({
        rounds: [
          {
            status: "failed",
            error: "provider stack trace and raw payload",
            modelBinding: {},
          } as PlanRecord["rounds"][number],
        ],
      }),
    );

    expect(presentation).toMatchObject({
      title: "Debate 规划失败",
      actionLabel: "更换模型并重试",
      technicalDetail: "provider stack trace and raw payload",
    });
    expect(presentation?.detail).not.toContain("stack trace");
    expect(presentation?.nextAction).not.toContain("raw payload");
  });
});

function planWithFailure(
  overrides: Partial<PlanRecord>,
): PlanRecord {
  return {
    mode: "debate",
    rounds: [],
    evidence: [{}, {}],
    planningStages: [],
    taskContract: { objective: "创建测试 Skill" },
    ...overrides,
  } as PlanRecord;
}
