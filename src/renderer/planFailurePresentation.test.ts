import { describe, expect, it } from "vitest";
import type { PlanRecord } from "../shared/planMode";
import {
  getActivePlanPresentation,
  getPlanFailurePresentation,
} from "./planFailurePresentation";

describe("plan failure presentation", () => {
  it("names a quality-gate failure instead of calling it an investigation failure", () => {
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
      title: "质量门禁未通过",
      detail: "验收路径越界。",
      actionLabel: "重新运行质量门禁",
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
      title: "调查被旧版内部限制错误中断",
      actionLabel: "重新运行调查",
    });
    expect(presentation?.detail).toContain("已收集 2 条证据");
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
      statusMessage: "计划已生成，确认前不会执行",
      taskTitle: "等待确认终版计划",
      taskDetail: "创建抖音链接转文稿 Skill",
    });
  });
});

function planWithFailure(
  overrides: Partial<PlanRecord>,
): PlanRecord {
  return {
    rounds: [],
    evidence: [{}, {}],
    planningStages: [],
    taskContract: { objective: "创建测试 Skill" },
    ...overrides,
  } as PlanRecord;
}
