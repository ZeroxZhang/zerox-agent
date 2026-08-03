import { describe, expect, it } from "vitest";
import type { Goal } from "../shared/agentGoal";
import { getGoalTerminalTruthNotice } from "./goalTerminalTruth";

describe("historical Goal terminal truth", () => {
  it("overlays deterministic rejection truth without rewriting model history", () => {
    const notice = getGoalTerminalTruthNotice({
      status: "stopped_stalled",
      milestones: [
        {
          id: "milestone_1",
          description: "准备 ECharts 页面",
          state: "rejected",
        },
      ],
      acceptanceState: {
        lastDecision: { failedCheckIds: ["check_echarts"] },
      },
    } as Goal);

    expect(notice).toEqual({
      title: "当前确定性结论：目标未通过验收",
      detail: expect.stringContaining("check_echarts"),
    });
    expect(notice?.detail).toContain("历史自评");
  });

  it("does not overlay achieved or fully accepted Goals", () => {
    expect(
      getGoalTerminalTruthNotice({
        status: "achieved",
        milestones: [{ state: "accepted" }],
      } as Goal),
    ).toBeNull();
  });
});
