import type { TaskPermissionPolicy } from "./toolPermissions";

export type ToolSafetyTone = "safe" | "confirm" | "danger";

export type ToolSafetySummarySection = {
  id: "read" | "write" | "memory" | "web" | "shell";
  label: string;
  value: string;
};

export type ToolSafetySummary = {
  tone: ToolSafetyTone;
  title: string;
  message: string;
  auditMessage: string;
  sections: ToolSafetySummarySection[];
};

export function buildToolSafetySummary(
  policy: TaskPermissionPolicy,
): ToolSafetySummary {
  const read = policy.files.read;
  const write = policy.files.write;
  const memoryParts = [
    policy.memory?.read ? "允许读取" : "",
    policy.memory?.write ? "允许写入" : "",
  ].filter(Boolean);
  const webParts = [
    policy.web.search ? "允许搜索" : "",
    ...policy.web.fetchDomains,
  ].filter(Boolean);
  const shell = policy.shell.commands;
  const hasFileWebOrMemory =
    read.length > 0 ||
    write.length > 0 ||
    memoryParts.length > 0 ||
    policy.web.search ||
    policy.web.fetchDomains.length > 0;
  const hasShell = shell.length > 0;

  return {
    tone: hasShell ? "danger" : hasFileWebOrMemory ? "confirm" : "safe",
    title: hasShell
      ? "高风险：任务可执行命令"
      : hasFileWebOrMemory
      ? "需要确认：任务可访问文件、网页或记忆"
      : "低风险：没有外部工具权限",
    message: hasShell
      ? "运行前请确认命令模板足够窄；实际命令必须匹配模板，并会留下审计日志。"
      : hasFileWebOrMemory
      ? "运行前请确认这些目录和域名就是任务需要的最小范围。"
      : "这个任务当前不能读取文件、写入文件、读取记忆、抓网页或执行命令。",
    auditMessage:
      "越权但参数合法时会主动弹窗请求你一次性授权；无论允许或拒绝都会写入审计日志。",
    sections: [
      {
        id: "read",
        label: "可读目录",
        value: formatList(read),
      },
      {
        id: "write",
        label: "可写目录",
        value: formatList(write),
      },
      {
        id: "memory",
        label: "本地记忆",
        value: formatList(memoryParts),
      },
      {
        id: "web",
        label: "网页权限",
        value: formatList(webParts),
      },
      {
        id: "shell",
        label: "命令模板",
        value: formatList(shell),
      },
    ],
  };
}

function formatList(values: string[]): string {
  return values.length ? values.join(" / ") : "未授权";
}
