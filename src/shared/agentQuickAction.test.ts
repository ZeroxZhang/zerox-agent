import { describe, expect, it } from "vitest";
import { classifyTaskFrame } from "./agentTaskStrategy";
import { createQuickActionPlan } from "./agentQuickAction";

describe("agent quick action", () => {
  it("creates a reviewable local file organize plan from a deterministic request", () => {
    const frame = classifyTaskFrame(
      "整理 /Users/bytedance/Downloads 这个文件夹",
    );

    expect(
      createQuickActionPlan("整理 /Users/bytedance/Downloads 这个文件夹", frame),
    ).toMatchObject({
      id: "quick_local_file_organize",
      workflowId: "local_file_organize",
      runtime: "quick_action",
      confirmationRequired: true,
      targetRefs: [
        {
          canonical: "/Users/bytedance/Downloads",
          kind: "path",
        },
      ],
      review: {
        gateId: "confirm_file_moves",
        reason: "Preview file moves before changing local data.",
      },
      recoveryTools: ["file_rollback_moves"],
      steps: [
        { id: "inventory", toolName: "file_inventory" },
        { id: "plan_moves", toolName: "file_move_plan" },
        { id: "apply_moves", toolName: "file_apply_moves" },
        { id: "verify_moves", toolName: "file_verify_moves" },
      ],
    });
  });

  it("does not create a quick action plan for exploratory code work", () => {
    const frame = classifyTaskFrame("修复登录失败 bug，并跑测试");

    expect(createQuickActionPlan("修复登录失败 bug，并跑测试", frame)).toBeNull();
  });
});
