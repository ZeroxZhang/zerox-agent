import { describe, expect, it } from "vitest";
import { classifyTaskFrame } from "./agentTaskStrategy";
import {
  buildWorkflowStrategyPlan,
  selectWorkflowForTask,
} from "./agentWorkflowCatalog";

describe("agent workflow catalog", () => {
  it("selects the deterministic local file organizer workflow", () => {
    const frame = classifyTaskFrame(
      "请帮我整理 /Users/bytedance/Downloads 这个文件夹",
    );

    const workflow = selectWorkflowForTask(frame);

    expect(workflow).toMatchObject({
      id: "local_file_organize",
      domain: "files",
      preferredRuntime: "quick_action",
      preferredTools: [
        "file_inventory",
        "file_move_plan",
        "file_apply_moves",
        "file_verify_moves",
      ],
      recoveryTools: ["file_rollback_moves"],
    });
  });

  it("builds a lintable strategy plan with a review gate before local moves", () => {
    const frame = classifyTaskFrame(
      "请帮我整理 /Users/bytedance/Downloads 这个文件夹",
    );
    const workflow = selectWorkflowForTask(frame);

    expect(workflow).not.toBeNull();
    const plan = buildWorkflowStrategyPlan(frame, workflow!);

    expect(plan).toMatchObject({
      runtime: "quick_action",
      confirmationGates: [
        {
          id: "confirm_file_moves",
          beforeStepId: "apply_moves",
          reason: "Preview file moves before changing local data.",
        },
      ],
      steps: [
        {
          id: "inventory",
          toolName: "file_inventory",
          toolClass: "batch_read",
          batchExpected: true,
          platformSensitive: false,
        },
        {
          id: "plan_moves",
          toolName: "file_move_plan",
          toolClass: "model",
          batchExpected: true,
        },
        {
          id: "apply_moves",
          toolName: "file_apply_moves",
          toolClass: "write",
          risk: "local_write",
        },
        {
          id: "verify_moves",
          toolName: "file_verify_moves",
          toolClass: "batch_read",
        },
      ],
    });
    expect(plan.steps.map((step) => step.toolName)).not.toContain("shell_exec");
  });

  it("keeps exploratory code work on the agent loop workflow", () => {
    const frame = classifyTaskFrame("修复登录失败 bug，并跑测试");

    expect(selectWorkflowForTask(frame)).toMatchObject({
      id: "code_change",
      preferredRuntime: "agent_loop",
      preferredTools: ["code_search", "git_diff", "test_run"],
    });
  });
});
