import { describe, expect, it } from "vitest";
import type { ToolApprovalRequestPayload } from "../shared/toolApproval";
import { shouldShowToolApproval } from "./toolApprovalVisibility";

describe("tool approval visibility", () => {
  it("shows forced Policy B confirmation even while auto approval is enabled", () => {
    expect(shouldShowToolApproval(createRequest(true), true)).toBe(true);
  });

  it("hides ordinary approval requests while auto approval is enabled", () => {
    expect(shouldShowToolApproval(createRequest(false), true)).toBe(false);
  });
});

function createRequest(requiresConfirmation: boolean): ToolApprovalRequestPayload {
  return {
    id: "approval_1",
    taskId: "goal:1",
    taskName: "Goal",
    request: { toolName: "shell_exec" },
    deniedReason: "confirmation required",
    argsSummary: { command: "npm publish" },
    risk: {
      level: requiresConfirmation ? "critical" : "normal",
      reason: "test",
      category: requiresConfirmation ? "irreversible_external_action" : "none",
      requiresConfirmation,
      affectedTargets: [],
    },
    createdAt: "2026-07-11T12:00:00.000Z",
  };
}
