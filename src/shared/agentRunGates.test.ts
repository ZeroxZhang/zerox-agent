import { describe, expect, it } from "vitest";
import { evaluateRunStopGates } from "./agentRunGates";

describe("agent run stop gates", () => {
  it("continues when actionable tasks remain before a run stops", () => {
    expect(
      evaluateRunStopGates({
        incompleteTasks: [
          { id: "task_1", status: "in_progress", summary: "Implement skill_load" },
          { id: "task_2", status: "blocked", summary: "Waiting for user" },
        ],
      }),
    ).toEqual({
      shouldStop: false,
      gate: "task",
      eventType: "task_gate_checked",
      reminder:
        "仍有 1 个可执行任务未完成：Implement skill_load（in_progress）。请继续执行，或明确标记 blocked/canceled。",
      evidence: ["task:task_1"],
    });
  });

  it("continues when goal evidence judge is not satisfied", () => {
    expect(
      evaluateRunStopGates({
        goalJudge: {
          stop: false,
          reason: "missing acceptance evidence",
          missing: ["artifact:report"],
        },
      }),
    ).toEqual({
      shouldStop: false,
      gate: "goal",
      eventType: "goal_judged",
      reminder:
        "目标验收尚未满足：missing acceptance evidence。缺失证据：artifact:report。请继续收集证据或说明无法完成。",
      evidence: ["missing:artifact:report"],
    });
  });
});
