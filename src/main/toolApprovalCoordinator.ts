import { randomUUID } from "node:crypto";
import {
  classifyToolApprovalRisk,
  summarizeToolApprovalArgs,
  type ResolveToolApprovalInput,
  type ToolApprovalDecisionPayload,
  type ToolApprovalModeState,
  type ToolApprovalRequestPayload,
} from "../shared/toolApproval";
import type {
  ToolUserApprovalRequest,
  ToolUserApprovalResult,
} from "./toolAuthorizationService";

export type ToolApprovalCoordinator = ReturnType<
  typeof createToolApprovalCoordinator
>;

// v3.6.0: Read-only tools that can be auto-approved (S2-06, SEC-06).
// Write, network, and shell tools are NEVER auto-approved — they always
// require explicit user authorization regardless of auto-approval state.
// Note: web_search and citation_record perform network requests and are
// intentionally excluded; chrome_bookmarks_read reads sensitive personal data
// and requires explicit approval in practice, but is listed here as it only
// reads (no write/network/shell side effects).
const AUTO_APPROVAL_READ_ONLY_WHITELIST = new Set([
  "file_list",
  "file_read",
  "file_stat",
  "file_search",
  "code_search",
  "memory_search",
  "conversation_search",
  "git_status",
  "git_diff",
  "git_log",
  "git_show",
  "git_blame",
  "tool_result_read",
]);

// v3.6.0: Tool approval timeout in ms (5 minutes). If the user doesn't
// respond within this window, the request is auto-denied (CORE-10, S2-19).
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

function isAutoApprovable(toolName: string): boolean {
  return AUTO_APPROVAL_READ_ONLY_WHITELIST.has(toolName);
}

export function createToolApprovalCoordinator(options: {
  sendToRenderers: (channel: string, payload: unknown) => void;
  createId?: () => string;
  now?: () => string;
}) {
  const createId = options.createId ?? (() => `approval_${randomUUID()}`);
  const now = options.now ?? (() => new Date().toISOString());
  const pending = new Map<
    string,
    {
      request: ToolApprovalRequestPayload;
      resolve: (result: ToolUserApprovalResult) => void;
      timeout?: ReturnType<typeof setTimeout>;
    }
  >();
  let autoApprovalEnabled = false;

  function getAutoApprovalState(): ToolApprovalModeState {
    return { autoApprovalEnabled };
  }

  function setAutoApprovalEnabled(enabled: boolean): ToolApprovalModeState {
    autoApprovalEnabled = enabled;
    const state = getAutoApprovalState();
    options.sendToRenderers("toolApproval:modeChanged", state);
    if (enabled) {
      for (const [id, entry] of pending) {
        // v3.6.0: Only auto-approve read-only tools when enabling auto-approval.
        // Write/network/shell tools stay pending and require user action.
        if (!isAutoApprovable(entry.request.request.toolName)) continue;
        pending.delete(id);
        if (entry.timeout) clearTimeout(entry.timeout);
        approveAutomatically(entry.request);
        entry.resolve({
          approved: true,
          reason: `自动授权已开启，已同意本次 ${entry.request.request.toolName} (只读工具)。`,
          automatic: true,
        });
      }
    }
    return state;
  }

  async function requestUserApproval(
    request: ToolUserApprovalRequest,
  ): Promise<ToolUserApprovalResult> {
    const payload = createRequestPayload(request);
    const toolName = request.request.toolName;

    // v3.6.0: Auto-approval restricted to read-only tool whitelist (S2-06, SEC-06).
    // Write/network/shell tools ALWAYS require explicit user authorization.
    if (autoApprovalEnabled && isAutoApprovable(toolName)) {
      approveAutomatically(payload);
      return {
        approved: true,
        reason: `自动授权已开启，已同意本次 ${toolName} (只读工具)。`,
        automatic: true,
      };
    }

    // v3.6.0: When auto-approval is enabled but the tool is not in the read-only
    // whitelist, fall through to normal approval — write/network/shell tools
    // ALWAYS require explicit user authorization regardless of auto-approval state.
    options.sendToRenderers("toolApproval:request", payload);

    // v3.6.0: Approval timeout with auto-deny (5 min default, CORE-10, S2-19).
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        const timedOut = pending.get(payload.id);
        if (!timedOut) return;
        pending.delete(payload.id);
        const decision = createDecisionPayload(payload, false, true);
        options.sendToRenderers("toolApproval:decision", decision);
        resolve({
          approved: false,
          reason: `授权超时 (${APPROVAL_TIMEOUT_MS / 60000} 分钟)，已自动拒绝本次 ${toolName}。`,
          automatic: true,
        });
      }, APPROVAL_TIMEOUT_MS);

      pending.set(payload.id, { request: payload, resolve, timeout });
    });
  }

  function resolveApproval(input: ResolveToolApprovalInput): boolean {
    const entry = pending.get(input.id);
    if (!entry) {
      return false;
    }

    pending.delete(input.id);
    // v3.6.0: Clear the timeout when user explicitly resolves
    if (entry.timeout) clearTimeout(entry.timeout);

    const decision = createDecisionPayload(entry.request, input.approved, false);
    options.sendToRenderers("toolApproval:decision", decision);
    entry.resolve({
      approved: input.approved,
      reason: input.approved
        ? `用户已在应用内授权本次 ${entry.request.request.toolName}。`
        : `用户拒绝授权本次 ${entry.request.request.toolName}。`,
    });
    return true;
  }

  function createRequestPayload(
    request: ToolUserApprovalRequest,
  ): ToolApprovalRequestPayload {
    return {
      id: createId(),
      taskId: request.taskId,
      taskName: request.taskName,
      request: request.request,
      deniedReason: request.deniedReason,
      argsSummary: summarizeToolApprovalArgs(request.request),
      risk: classifyToolApprovalRisk(request),
      createdAt: now(),
    };
  }

  function createDecisionPayload(
    request: ToolApprovalRequestPayload,
    approved: boolean,
    automatic: boolean,
  ): ToolApprovalDecisionPayload {
    return {
      id: request.id,
      taskId: request.taskId,
      taskName: request.taskName,
      toolName: request.request.toolName,
      approved,
      automatic,
      risk: request.risk,
      createdAt: now(),
    };
  }

  function approveAutomatically(request: ToolApprovalRequestPayload): void {
    const decision = createDecisionPayload(request, true, true);
    options.sendToRenderers("toolApproval:decision", decision);
  }

  return {
    getAutoApprovalState,
    setAutoApprovalEnabled,
    requestUserApproval,
    resolveApproval,
  };
}
