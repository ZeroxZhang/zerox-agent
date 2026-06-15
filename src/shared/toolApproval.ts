import type { ToolCallRequest } from "./toolPermissions";

export type ToolApprovalRiskLevel = "normal" | "high" | "critical";

export type ToolApprovalRisk = {
  level: ToolApprovalRiskLevel;
  reason: string;
};

export type ToolApprovalRequestPayload = {
  id: string;
  taskId: string;
  taskName: string;
  request: ToolCallRequest;
  deniedReason: string;
  argsSummary: Record<string, unknown>;
  risk: ToolApprovalRisk;
  createdAt: string;
};

export type ToolApprovalDecisionPayload = {
  id: string;
  taskId: string;
  taskName: string;
  toolName: string;
  approved: boolean;
  automatic: boolean;
  risk: ToolApprovalRisk;
  createdAt: string;
};

export type ToolApprovalModeState = {
  autoApprovalEnabled: boolean;
};

export type ResolveToolApprovalInput = {
  id: string;
  approved: boolean;
};

export function classifyToolApprovalRisk(input: {
  taskName: string;
  deniedReason: string;
  request: ToolCallRequest;
}): ToolApprovalRisk {
  if (input.request.toolName === "shell_exec") {
    return {
      level: "critical",
      reason: "shell_exec can mutate the local machine outside normal app flows.",
    };
  }

  if (
    input.request.toolName === "file_write" ||
    input.request.toolName === "markdown_report_write"
  ) {
    return {
      level: "critical",
      reason: "file writes can overwrite or create local artifacts.",
    };
  }

  if (
    input.request.toolName === "web_fetch" ||
    input.request.toolName === "web_fetch_document"
  ) {
    return {
      level: "high",
      reason: "web_fetch can transmit browsing context to an external host.",
    };
  }

  return {
    level: "normal",
    reason: "The request needs one-time permission outside the current policy.",
  };
}

export function summarizeToolApprovalArgs(
  request: ToolCallRequest,
): Record<string, unknown> {
  switch (request.toolName) {
    case "file_list":
    case "file_stat":
    case "file_read":
      return {
        path: String(request.args.path ?? ""),
      };
    case "tool_result_read":
      return {
        ref: String(request.args.ref ?? ""),
      };
    case "file_search":
      return {
        root: String(request.args.root ?? ""),
        query: String(request.args.query ?? ""),
        mode: String(request.args.mode ?? "both"),
      };
    case "file_write":
    case "markdown_report_write":
      return {
        path: String(request.args.path ?? ""),
        contentLength: String(request.args.content ?? "").length,
      };
    case "shell_exec":
      return {
        command: String(request.args.command ?? ""),
      };
    case "web_fetch":
    case "web_fetch_document":
    case "citation_record":
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

  return request.args;
}
