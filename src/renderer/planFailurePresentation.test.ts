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

  it("explains that investigation retry resumes from the failed depth", () => {
    const presentation = getPlanFailurePresentation(
      planWithFailure({
        planningStages: [
          {
            id: "investigation-contract-1",
            kind: "investigation",
            runId: "investigation-contract-run-1",
            status: "failed",
            investigationDepth: "deep",
            evidenceRefs: ["evidence_user_request", "evidence_workspace"],
            revisionAttempted: true,
            failureExcerpt: '{"skillCandidates":[{"evidenceRefs":{}}]}',
            error: "PlanningBrief.skillCandidates[0].evidenceRefs 必须是数组。",
          },
        ],
      }),
    );

    expect(presentation).toMatchObject({
      title: "规划调查未完成",
      detail: "规划调查未完成，但已完成的调查层级和收集到的证据都已保留。",
      actionLabel: "从失败调查阶段继续",
    });
    expect(presentation?.nextAction).toContain("只从失败的调查深度恢复");
    expect(presentation?.technicalDetail).toContain("合同修复");
    expect(presentation?.technicalDetail).toContain("失败响应摘录");
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

  it("keeps completed Plan steps separate from Goal achievement", () => {
    const presentation = getPlanOutcomePresentation(
      planWithFailure({
        mode: "direct",
        status: "steps_completed",
        actionGate: "ready",
      }),
    );

    expect(presentation).toEqual({
      kind: "pending",
      title: "当前路径已执行，目标尚未通过验收",
      detail: "活动 Plan 的里程碑已完成，Goal 正在等待或恢复最终验收。",
      nextAction: "继续 Goal 验收；只有有效验收证书才能将 Goal 标记为达成。",
    });
  });

  it("presents an adopted active Plan as execution rather than unfinished planning", () => {
    const presentation = getPlanOutcomePresentation(
      planWithFailure({
        mode: "direct",
        purpose: "runtime_replan",
        goalPlanVersion: 2,
        status: "executing",
      }),
    );

    expect(presentation).toEqual({
      kind: "pending",
      title: "Plan 正在执行",
      detail: "当前活动路径正在由 Goal Controller 推进。",
      nextAction: "查看 Goal 进度、里程碑与执行证据。",
    });
  });

  it("explains that a runtime Direct Plan does not replace the active Plan before adoption", () => {
    const presentation = getPlanOutcomePresentation(
      planWithFailure({
        mode: "direct",
        purpose: "runtime_replan",
        goalPlanVersion: 2,
        status: "awaiting_confirmation",
        actionGate: "ready",
      }),
    );

    expect(presentation).toMatchObject({
      kind: "success",
      title: "Direct Plan v2 已就绪",
      detail: "新的执行路径已经准备好，当前 Goal 尚未切换 Plan。",
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

  it("redacts credentials from legacy persisted planning diagnostics", () => {
    const secret = "sk-proj-legacy-plan-secret-123456";
    const presentation = getPlanFailurePresentation(
      planWithFailure({
        planningStages: [
          {
            id: "investigation-legacy-secret",
            kind: "investigation",
            runId: "investigation-legacy-secret-run",
            status: "failed",
            evidenceRefs: [],
            startedAt: "2026-07-31T00:00:00.000Z",
            completedAt: "2026-07-31T00:00:01.000Z",
            revisionAttempted: true,
            error: `provider rejected api_key=${secret}`,
            failureExcerpt: `raw response api_key=${secret}`,
          },
        ],
      }),
    );

    expect(presentation?.technicalDetail).toContain("[redacted]");
    expect(presentation?.technicalDetail).not.toContain(secret);
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
