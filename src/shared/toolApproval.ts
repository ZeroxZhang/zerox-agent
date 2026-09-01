import type { ToolCallRequest } from "./toolPermissions";
import type { ToolApprovalCausalRef } from "./conversationCausalSpine";
export type { ToolApprovalCausalRef } from "./conversationCausalSpine";
import {
  classifyExtremeRisk,
  type ExtremeRiskShellPlan,
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
  revision?: number;
  taskId: string;
  taskName: string;
  request: Pick<ToolCallRequest, "toolName" | "source">;
  deniedReason: string;
  argsSummary: Record<string, unknown>;
  risk: ToolApprovalRisk;
  createdAt: string;
  causalRef?: ToolApprovalCausalRef;
};

export type ToolApprovalDecisionPayload = {
  id: string;
  revision?: number;
  decisionId?: string;
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

export type ToolApprovalModeInputs = {
  standaloneAutoApprovalEnabled: boolean;
  goalModePreferenceEnabled: boolean;
  activeGoalCount: number;
};

/**
 * Goal autonomy is a product invariant, not a renderer convenience: whenever
 * Goal mode is selected or a Goal is active, automatic approval is enabled
 * and locked. Policy-B operations still require explicit confirmation in the
 * authorization layer.
 */
export function deriveToolApprovalModeState(
  input: ToolApprovalModeInputs,
): ToolApprovalModeState {
  const goalModeEnabled =
    input.goalModePreferenceEnabled || input.activeGoalCount > 0;
  return {
    autoApprovalEnabled:
      goalModeEnabled || input.standaloneAutoApprovalEnabled,
    goalModeEnabled,
    autoApprovalLocked: goalModeEnabled,
  };
}

export type ResolveToolApprovalInput = {
  id: string;
  approved: boolean;
  expectedRevision?: number;
  decisionId?: string;
};

export function classifyToolApprovalRisk(input: {
  taskName: string;
  deniedReason: string;
  request: ToolCallRequest;
  shellPlan?: ExtremeRiskShellPlan;
}): ToolApprovalRisk {
  const extremeRisk = classifyExtremeRisk(input.request, {
    ...(input.shellPlan ? { shellPlan: input.shellPlan } : {}),
  });
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
