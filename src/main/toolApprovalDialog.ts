import type { MessageBoxOptions } from "electron";
import type { ToolCallRequest } from "../shared/toolPermissions";

export type ToolApprovalDialogInput = {
  taskName: string;
  request: ToolCallRequest;
  deniedReason: string;
};

export function buildToolApprovalDialogOptions(
  input: ToolApprovalDialogInput,
): MessageBoxOptions {
  return {
    type: "warning",
    title: "需要授权风险操作",
    message: `智能体请求执行 ${input.request.toolName}`,
    detail: [
      `任务：${input.taskName}`,
      `风险原因：${input.deniedReason}`,
      "",
      "操作参数：",
      JSON.stringify(summarizeToolArgs(input.request), null, 2),
      "",
      "授权后，本次操作会立即继续执行，并写入工具审计日志。",
    ].join("\n"),
    buttons: ["授权本次操作", "拒绝"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
}

function summarizeToolArgs(request: ToolCallRequest): Record<string, unknown> {
  switch (request.toolName) {
    case "file_list":
    case "file_read":
      return {
        path: String(request.args.path ?? ""),
      };
    case "file_write":
      return {
        path: String(request.args.path ?? ""),
        contentLength: String(request.args.content ?? "").length,
      };
    case "shell_exec":
      return {
        command: String(request.args.command ?? ""),
      };
    case "web_fetch":
      return {
        url: String(request.args.url ?? ""),
      };
    case "web_search":
      return {
        query: String(request.args.query ?? ""),
      };
    case "memory_search":
      return {
        query: String(request.args.query ?? ""),
        kind: String(request.args.kind ?? "all"),
        limit: Number(request.args.limit ?? 5),
      };
    case "conversation_search":
      return {
        query: String(request.args.query ?? ""),
        sessionId: String(request.args.sessionId ?? ""),
        limit: Number(request.args.limit ?? 5),
      };
  }
}
