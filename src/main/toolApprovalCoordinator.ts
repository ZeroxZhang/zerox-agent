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
        pending.delete(id);
        approveAutomatically(entry.request);
        entry.resolve({
          approved: true,
          reason: `自动授权已开启，已同意本次 ${entry.request.request.toolName}。`,
        });
      }
    }
    return state;
  }

  async function requestUserApproval(
    request: ToolUserApprovalRequest,
  ): Promise<ToolUserApprovalResult> {
    const payload = createRequestPayload(request);

    if (autoApprovalEnabled) {
      approveAutomatically(payload);
      return {
        approved: true,
        reason: `自动授权已开启，已同意本次 ${request.request.toolName}。`,
      };
    }

    options.sendToRenderers("toolApproval:request", payload);
    return new Promise((resolve) => {
      pending.set(payload.id, { request: payload, resolve });
    });
  }

  function resolveApproval(input: ResolveToolApprovalInput): boolean {
    const entry = pending.get(input.id);
    if (!entry) {
      return false;
    }

    pending.delete(input.id);
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
