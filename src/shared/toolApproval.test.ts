import { describe, expect, it } from "vitest";
import {
  classifyToolApprovalRisk,
  summarizeToolApprovalArgs,
} from "./toolApproval";

describe("tool approval risk classification", () => {
  it("marks shell commands as critical for auto-approval monitoring", () => {
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
      reason: "shell_exec can mutate the local machine outside normal app flows.",
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
