import type { ToolCallRequest } from "./toolPermissions";
import {
  classifyExtremeRisk,
  type ExtremeRiskCategory,
} from "./extremeRiskPolicy";

export type ToolApprovalRiskLevel = "normal" | "high" | "critical";

export type ToolApprovalRisk = {
  level: ToolApprovalRiskLevel;
  reason: string;
  category: ExtremeRiskCategory;
  requiresConfirmation: boolean;
  affectedTargets: string[];
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
  goalModeEnabled: boolean;
  autoApprovalLocked: boolean;
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
  const extremeRisk = classifyExtremeRisk(input.request);
  if (extremeRisk.requiresConfirmation) {
    return {
      level: "critical",
      reason: extremeRisk.reason,
      category: extremeRisk.category,
      requiresConfirmation: true,
      affectedTargets: extremeRisk.affectedTargets,
    };
  }

  if (
    input.request.toolName === "chrome_bookmarks_read"
  ) {
    return {
      level: "high",
      reason:
        "chrome_bookmarks_read reads personal browser bookmark data and may write a local bookmark_list artifact.",
      category: "none",
      requiresConfirmation: false,
      affectedTargets: [],
    };
  }

  return {
    level: "normal",
    reason: extremeRisk.reason,
    category: "none",
    requiresConfirmation: false,
    affectedTargets: [],
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
    case "chrome_bookmarks_read":
      return {
        profile: String(request.args.profile ?? ""),
        chromeUserDataDir: String(request.args.chromeUserDataDir ?? ""),
        bookmarksPath: String(request.args.bookmarksPath ?? ""),
        maxBookmarks: Number(request.args.maxBookmarks ?? 5000),
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
