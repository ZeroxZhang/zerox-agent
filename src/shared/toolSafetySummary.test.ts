import { describe, expect, it } from "vitest";
import { buildToolSafetySummary } from "./toolSafetySummary";
import type { TaskPermissionPolicy } from "./toolPermissions";

describe("tool safety summary", () => {
  it("marks tasks without external tool permissions as low risk", () => {
    const summary = buildToolSafetySummary({
      files: { read: [], write: [] },
      web: { search: false, fetchDomains: [] },
      shell: { commands: [] },
    });

    expect(summary).toEqual({
      tone: "safe",
      title: "低风险：没有外部工具权限",
      message: "这个任务当前不能读取文件、写入文件、抓网页或执行命令。",
      auditMessage:
        "越权但参数合法时会主动弹窗请求你一次性授权；无论允许或拒绝都会写入审计日志。",
      sections: [
        { id: "read", label: "可读目录", value: "未授权" },
        { id: "write", label: "可写目录", value: "未授权" },
        { id: "web", label: "网页权限", value: "未授权" },
        { id: "shell", label: "命令模板", value: "未授权" },
      ],
    });
  });

  it("summarizes file and web permissions as confirmation-required", () => {
    const summary = buildToolSafetySummary(
      createPolicy({
        files: { read: ["~/Downloads"], write: ["~/Downloads/reports"] },
        web: { search: true, fetchDomains: ["example.com"] },
      }),
    );

    expect(summary.tone).toBe("confirm");
    expect(summary.title).toBe("需要确认：任务可访问文件或网页");
    expect(summary.sections).toEqual([
      { id: "read", label: "可读目录", value: "~/Downloads" },
      { id: "write", label: "可写目录", value: "~/Downloads/reports" },
      { id: "web", label: "网页权限", value: "允许搜索 / example.com" },
      { id: "shell", label: "命令模板", value: "未授权" },
    ]);
  });

  it("marks shell permissions as high risk and shows templates", () => {
    const summary = buildToolSafetySummary(
      createPolicy({
        shell: { commands: ["find {{targetDir}} -maxdepth 1 -type f"] },
      }),
    );

    expect(summary).toMatchObject({
      tone: "danger",
      title: "高风险：任务可执行命令",
      message:
        "运行前请确认命令模板足够窄；实际命令必须匹配模板，并会留下审计日志。",
    });
    expect(summary.sections.at(-1)).toEqual({
      id: "shell",
      label: "命令模板",
      value: "find {{targetDir}} -maxdepth 1 -type f",
    });
  });
});

function createPolicy(
  partial: Partial<TaskPermissionPolicy>,
): TaskPermissionPolicy {
  return {
    files: { read: [], write: [] },
    web: { search: false, fetchDomains: [] },
    shell: { commands: [] },
    ...partial,
  };
}
