import { describe, expect, it } from "vitest";
import { buildToolApprovalDialogOptions } from "./toolApprovalDialog";

describe("tool approval dialog", () => {
  it("summarizes risky file writes without exposing full file content", () => {
    const options = buildToolApprovalDialogOptions({
      taskName: "Write report",
      deniedReason: "file_write 路径不在已授权可写目录内。",
      request: {
        toolName: "file_write",
        args: {
          path: "/Users/demo/Desktop/report.md",
          content: "secret content that should not be fully displayed",
        },
      },
    });

    expect(options.title).toBe("需要授权风险操作");
    expect(options.message).toContain("智能体请求执行 file_write");
    expect(options.detail).toContain("/Users/demo/Desktop/report.md");
    expect(options.detail).toContain("contentLength");
    expect(options.detail).not.toContain("secret content");
    expect(options.buttons).toEqual(["授权本次操作", "拒绝"]);
    expect(options.defaultId).toBe(1);
    expect(options.cancelId).toBe(1);
  });
});
