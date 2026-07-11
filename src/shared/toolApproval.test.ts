import { describe, expect, it } from "vitest";
import {
  classifyToolApprovalRisk,
  summarizeToolApprovalArgs,
} from "./toolApproval";

describe("tool approval risk classification", () => {
  it("marks destructive shell commands as a Policy B forced ask", () => {
    const risk = classifyToolApprovalRisk({
      taskName: "Goal milestone",
      deniedReason: "shell_exec command 不匹配已授权模板。",
      request: {
        toolName: "shell_exec",
        args: { command: "rm -rf /tmp/report-cache" },
      },
    });

    expect(risk).toEqual({
      level: "critical",
      reason:
        "The command can irreversibly delete data or destroy local version-control state.",
      category: "irrecoverable_data_loss",
      requiresConfirmation: true,
      affectedTargets: ["rm -rf /tmp/report-cache"],
    });
  });

  it("summarizes file writes without exposing full content", () => {
    expect(
      summarizeToolApprovalArgs({
        toolName: "file_write",
        args: {
          path: "/Users/demo/report.md",
          content: "secret content that must not be displayed",
        },
      }),
    ).toEqual({
      path: "/Users/demo/report.md",
      contentLength: 41,
    });
  });
});
