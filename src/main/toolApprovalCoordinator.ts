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

const DEFAULT_APPROVAL_TIMEOUT_MS = 60_000;

type PendingApproval = {
  request: ToolApprovalRequestPayload;
  resolve: (result: ToolUserApprovalResult) => void;
  timeout: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  abortHandler?: () => void;
};

export function createToolApprovalCoordinator(options: {
  sendToRenderers: (channel: string, payload: unknown) => void;
  approvalTimeoutMs?: number;
  createId?: () => string;
  now?: () => string;
}) {
  const createId = options.createId ?? (() => `approval_${randomUUID()}`);
  const now = options.now ?? (() => new Date().toISOString());
  const approvalTimeoutMs =
    options.approvalTimeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS;
  const pending = new Map<string, PendingApproval>();
  let autoApprovalEnabled = false;

  function getAutoApprovalState(): ToolApprovalModeState {
    return { autoApprovalEnabled };
  }

  function setAutoApprovalEnabled(enabled: boolean): ToolApprovalModeState {
    autoApprovalEnabled = enabled;
    const state = getAutoApprovalState();
    options.sendToRenderers("toolApproval:modeChanged", state);
    if (enabled) {
      for (const [id, entry] of [...pending]) {
        if (entry.request.risk.requiresConfirmation) continue;
        settlePending(
          id,
          {
            approved: true,
            reason: `自动授权已放行本次 ${entry.request.request.toolName}。`,
            automatic: true,
          },
          true,
        );
      }
    }
    return state;
  }

  async function requestUserApproval(
    request: ToolUserApprovalRequest,
    requestOptions: { signal?: AbortSignal } = {},
  ): Promise<ToolUserApprovalResult> {
    const payload = createRequestPayload(request);
    const toolName = request.request.toolName;

    if (requestOptions.signal?.aborted) {
      return rejectAborted(payload);
    }

    if (autoApprovalEnabled && !payload.risk.requiresConfirmation) {
      return approveAutomatically(
        payload,
        `自动授权已放行本次 ${toolName}。`,
      );
    }

    options.sendToRenderers("toolApproval:request", payload);
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        const seconds = Math.max(1, Math.ceil(approvalTimeoutMs / 1000));
        settlePending(
          payload.id,
          {
            approved: false,
            reason: `授权等待已超过 ${seconds} 秒，已拒绝本次 ${toolName}；请改用安全替代方案。`,
            automatic: true,
          },
          true,
        );
      }, approvalTimeoutMs);
      const entry: PendingApproval = {
        request: payload,
        resolve,
        timeout,
        ...(requestOptions.signal ? { signal: requestOptions.signal } : {}),
      };
      if (requestOptions.signal) {
        entry.abortHandler = () => {
          settlePending(
            payload.id,
            {
              approved: false,
              reason: "运行已取消，授权请求已关闭。",
              automatic: true,
            },
            true,
          );
        };
        requestOptions.signal.addEventListener("abort", entry.abortHandler, {
          once: true,
        });
      }
      pending.set(payload.id, entry);
    });
  }

  function resolveApproval(input: ResolveToolApprovalInput): boolean {
    const entry = pending.get(input.id);
    if (!entry) return false;
    settlePending(
      input.id,
      {
        approved: input.approved,
        reason: input.approved
          ? `用户已在应用内授权本次 ${entry.request.request.toolName}。`
          : `用户拒绝授权本次 ${entry.request.request.toolName}。`,
      },
      false,
    );
    return true;
  }

  function settlePending(
    id: string,
    result: ToolUserApprovalResult,
    automatic: boolean,
  ): void {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    clearTimeout(entry.timeout);
    if (entry.signal && entry.abortHandler) {
      entry.signal.removeEventListener("abort", entry.abortHandler);
    }
    options.sendToRenderers(
      "toolApproval:decision",
      createDecisionPayload(entry.request, result.approved, automatic),
    );
    entry.resolve(result);
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

  function approveAutomatically(
    request: ToolApprovalRequestPayload,
    reason: string,
  ): ToolUserApprovalResult {
    options.sendToRenderers(
      "toolApproval:decision",
      createDecisionPayload(request, true, true),
    );
    return { approved: true, reason, automatic: true };
  }

  function rejectAborted(
    request: ToolApprovalRequestPayload,
  ): ToolUserApprovalResult {
    options.sendToRenderers(
      "toolApproval:decision",
      createDecisionPayload(request, false, true),
    );
    return {
      approved: false,
      reason: "运行已取消，授权请求已关闭。",
      automatic: true,
    };
  }

  return {
    getAutoApprovalState,
    setAutoApprovalEnabled,
    requestUserApproval,
    resolveApproval,
  };
}
