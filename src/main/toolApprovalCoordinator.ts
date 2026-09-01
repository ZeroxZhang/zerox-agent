import { randomUUID } from "node:crypto";
import {
  CONVERSATION_CAUSAL_SCHEMA_VERSION,
  createConversationRequestFingerprint,
  sanitizeToolApprovalIntentLabel,
  sanitizeToolApprovalIntentSummary,
  type ToolApprovalIntent,
  type ToolApprovalIntentDecision,
  type ToolApprovalIntentState,
} from "../shared/conversationCausalSpine";
import {
  classifyToolApprovalRisk,
  deriveToolApprovalModeState,
  summarizeToolApprovalArgs,
  type ResolveToolApprovalInput,
  type ToolApprovalDecisionPayload,
  type ToolApprovalModeState,
  type ToolApprovalRequestPayload,
} from "../shared/toolApproval";
import type {
  ToolUserApprovalRequestOptions,
  ToolUserApprovalRequest,
  ToolUserApprovalResult,
} from "./toolAuthorizationService";
import type { ConversationCausalStore } from "./conversationCausalStore";

export type ToolApprovalCoordinator = ReturnType<typeof createToolApprovalCoordinator>;

const DEFAULT_APPROVAL_TIMEOUT_MS = 60_000;

type ApprovalStore = Pick<
  ConversationCausalStore,
  | "createApprovalIntent"
  | "createApprovalIntentAndLink"
  | "getApprovalIntent"
  | "decideApproval"
  | "interruptPriorProcessPending"
>;

type PendingApproval = {
  request: ToolApprovalRequestPayload;
  resolve: (result: ToolUserApprovalResult) => void;
  timeout: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  abortHandler?: () => void;
};

export function createToolApprovalCoordinator(options: {
  sendToRenderers: (channel: string, payload: unknown) => void;
  store: ApprovalStore;
  processEpoch: string;
  approvalTimeoutMs?: number;
  createId?: () => string;
  now?: () => string;
}) {
  const createId = options.createId ?? (() => `approval_${randomUUID()}`);
  const now = options.now ?? (() => new Date().toISOString());
  const approvalTimeoutMs = options.approvalTimeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS;
  const pending = new Map<string, PendingApproval>();
  let standaloneAutoApprovalEnabled = false;
  let goalModePreferenceEnabled = false;
  const activeGoalIds = new Set<string>();

  function getAutoApprovalState(): ToolApprovalModeState {
    return deriveToolApprovalModeState({
      standaloneAutoApprovalEnabled,
      goalModePreferenceEnabled,
      activeGoalCount: activeGoalIds.size,
    });
  }

  function setAutoApprovalEnabled(enabled: boolean): ToolApprovalModeState {
    standaloneAutoApprovalEnabled = enabled;
    return publishModeState();
  }

  function setGoalModeEnabled(enabled: boolean): ToolApprovalModeState {
    goalModePreferenceEnabled = enabled;
    return publishModeState();
  }

  function setGoalActive(goalId: string, active: boolean): ToolApprovalModeState {
    if (active) activeGoalIds.add(goalId);
    else activeGoalIds.delete(goalId);
    return publishModeState();
  }

  function publishModeState(): ToolApprovalModeState {
    const state = getAutoApprovalState();
    safeSend("toolApproval:modeChanged", state);
    if (state.autoApprovalEnabled) {
      for (const [id, entry] of [...pending]) {
        if (entry.request.risk.requiresConfirmation) continue;
        if (!shouldAutoApproveTask(entry.request.taskId)) continue;
        void settlePending(id, {
          approved: true,
          reason: `自动授权已放行本次 ${entry.request.request.toolName}。`,
          automatic: true,
        }, {
          decisionId: `auto:${id}`,
          outcome: "approved",
          reasonCode: "auto_approved",
        });
      }
    }
    return state;
  }

  async function initialize(
    reconcileInterrupted?: (
      approvals: readonly ToolApprovalIntent[],
    ) => Promise<unknown>,
  ): Promise<number> {
    const interrupted = await options.store.interruptPriorProcessPending({
      currentProcessEpoch: options.processEpoch,
      decidedAt: now(),
    });
    if (interrupted.length > 0) {
      await reconcileInterrupted?.(interrupted);
    }
    return interrupted.length;
  }

  function republishPending(): number {
    for (const entry of pending.values()) {
      safeSend("toolApproval:request", entry.request);
    }
    return pending.size;
  }

  function pendingSnapshot(): ToolApprovalRequestPayload[] {
    return [...pending.values()].map((entry) => structuredClone(entry.request));
  }

  async function requestUserApproval(
    request: ToolUserApprovalRequest,
    requestOptions: ToolUserApprovalRequestOptions = {},
  ): Promise<ToolUserApprovalResult> {
    const payload = createRequestPayload(request);
    const toolName = request.request.toolName;
    const created = await createPendingIntent(payload);
    if (created.disposition !== "applied") {
      return {
        approved: false,
        reason: "授权请求未能建立唯一的持久化意图，已拒绝执行。",
        automatic: true,
        approvalId: payload.id,
      };
    }
    try {
      await requestOptions.onIntentPersisted?.({
        id: payload.id,
        revision: payload.revision ?? 1,
      });
    } catch {
      return settleWithoutWaiter(payload, {
        approved: false,
        reason: "授权等待状态无法安全持久化，已拒绝执行。",
        automatic: true,
      }, {
        decisionId: `projection-failed:${payload.id}`,
        outcome: "denied",
        reasonCode: "approval_projection_failed",
      });
    }

    if (requestOptions.signal?.aborted) {
      return settleWithoutWaiter(payload, {
        approved: false,
        reason: "运行已取消，授权请求已关闭。",
        automatic: true,
      }, {
        decisionId: `abort:${payload.id}`,
        outcome: "aborted",
        reasonCode: "run_aborted",
      });
    }

    if (shouldAutoApproveTask(request.taskId) && !payload.risk.requiresConfirmation) {
      return settleWithoutWaiter(payload, {
        approved: true,
        reason: `自动授权已放行本次 ${toolName}。`,
        automatic: true,
      }, {
        decisionId: `auto:${payload.id}`,
        outcome: "approved",
        reasonCode: "auto_approved",
      });
    }

    let resolvePromise!: (result: ToolUserApprovalResult) => void;
    const resultPromise = new Promise<ToolUserApprovalResult>((resolve) => {
      resolvePromise = resolve;
    });
    const timeout = setTimeout(() => {
      const seconds = Math.max(1, Math.ceil(approvalTimeoutMs / 1000));
      void settlePending(payload.id, {
        approved: false,
        reason: `授权等待已超过 ${seconds} 秒，已拒绝本次 ${toolName}；请改用安全替代方案。`,
        automatic: true,
      }, {
        decisionId: `timeout:${payload.id}`,
        outcome: "timed_out",
        reasonCode: "approval_timeout",
      });
    }, approvalTimeoutMs);
    const entry: PendingApproval = {
      request: payload,
      resolve: resolvePromise,
      timeout,
      ...(requestOptions.signal ? { signal: requestOptions.signal } : {}),
    };
    if (requestOptions.signal) {
      entry.abortHandler = () => {
        void settlePending(payload.id, {
          approved: false,
          reason: "运行已取消，授权请求已关闭。",
          automatic: true,
        }, {
          decisionId: `abort:${payload.id}`,
          outcome: "aborted",
          reasonCode: "run_aborted",
        });
      };
      requestOptions.signal.addEventListener("abort", entry.abortHandler, { once: true });
    }
    pending.set(payload.id, entry);
    safeSend("toolApproval:request", payload);
    return resultPromise;
  }

  function shouldAutoApproveTask(taskId: string): boolean {
    if (standaloneAutoApprovalEnabled) return true;
    if (!taskId.startsWith("goal:")) return false;
    const goalId = taskId.slice("goal:".length);
    return goalModePreferenceEnabled || activeGoalIds.has(goalId);
  }

  async function resolveApproval(input: ResolveToolApprovalInput): Promise<boolean> {
    const entry = pending.get(input.id);
    const toolName = entry?.request.request.toolName ?? "工具";
    return settlePending(input.id, {
      approved: input.approved,
      reason: input.approved
        ? `用户已在应用内授权本次 ${toolName}。`
        : `用户拒绝授权本次 ${toolName}。`,
      automatic: false,
    }, {
      decisionId: input.decisionId ?? `user:${input.id}:${input.approved ? "approved" : "denied"}`,
      outcome: input.approved ? "approved" : "denied",
      reasonCode: input.approved ? "user_approved" : "user_denied",
      expectedRevision: input.expectedRevision,
    });
  }

  async function rejectAllPending(
    reason = "应用正在退出，授权请求已关闭。",
  ): Promise<number> {
    const ids = [...pending.keys()];
    const results = await Promise.all(ids.map((id) => settlePending(id, {
      approved: false,
      reason,
      automatic: true,
    }, {
      decisionId: `shutdown:${id}`,
      outcome: "interrupted",
      reasonCode: "main_process_shutdown",
    })));
    return results.filter(Boolean).length;
  }

  async function settleWithoutWaiter(
    request: ToolApprovalRequestPayload,
    result: ToolUserApprovalResult,
    decisionInput: {
      decisionId: string;
      outcome: Exclude<ToolApprovalIntentState, "pending">;
      reasonCode: string;
    },
  ): Promise<ToolUserApprovalResult> {
    const decision = createIntentDecision({
      ...decisionInput,
      automatic: result.automatic,
    });
    try {
      const settled = await options.store.decideApproval({
        id: request.id,
        expectedRevision: request.revision ?? 1,
        decision,
      });
      if (settled.disposition !== "applied" && settled.disposition !== "duplicate") {
        return failClosedResult(request.id, "授权决策发生冲突，已拒绝执行。");
      }
      safeSend("toolApproval:decision", createDecisionPayload(
        request,
        result.approved,
        result.automatic ?? false,
        decision,
      ));
      return {
        ...result,
        approvalId: request.id,
        approvalRevision: 2,
        decisionId: decision.decisionId,
      };
    } catch {
      return failClosedResult(request.id, "授权决策无法持久化，已拒绝执行。");
    }
  }

  async function settlePending(
    id: string,
    result: ToolUserApprovalResult,
    decisionInput: {
      decisionId: string;
      outcome: Exclude<ToolApprovalIntentState, "pending">;
      reasonCode: string;
      expectedRevision?: number;
    },
  ): Promise<boolean> {
    const entry = pending.get(id);
    const decision = createIntentDecision({
      ...decisionInput,
      automatic: result.automatic,
    });
    let settled;
    try {
      settled = await options.store.decideApproval({
        id,
        expectedRevision: decisionInput.expectedRevision ?? entry?.request.revision ?? 1,
        decision,
      });
    } catch {
      const durable = await options.store.getApprovalIntent(id).catch(() => null);
      return entry
        ? resolvePendingFailClosed(
            entry,
            durable?.decision?.decisionId ?? decision.decisionId,
            durable?.revision ?? 2,
          )
        : Boolean(durable && durable.state !== "pending");
    }
    if (settled.disposition !== "applied" && settled.disposition !== "duplicate") {
      if (entry && settled.value && settled.value.state !== "pending") {
        return resolvePendingFailClosed(
          entry,
          settled.value.decision?.decisionId ?? decision.decisionId,
          settled.value.revision,
        );
      }
      return false;
    }
    if (!entry) return settled.disposition === "duplicate";

    pending.delete(id);
    clearTimeout(entry.timeout);
    if (entry.signal && entry.abortHandler) {
      entry.signal.removeEventListener("abort", entry.abortHandler);
    }
    entry.resolve({
      ...result,
      approvalId: id,
      approvalRevision: settled.value?.revision ?? 2,
      decisionId: decision.decisionId,
    });
    safeSend("toolApproval:decision", createDecisionPayload(
      entry.request,
      result.approved,
      result.automatic ?? false,
      decision,
    ));
    return true;
  }

  function resolvePendingFailClosed(
    entry: PendingApproval,
    decisionId: string,
    revision: number,
  ): true {
    pending.delete(entry.request.id);
    clearTimeout(entry.timeout);
    if (entry.signal && entry.abortHandler) {
      entry.signal.removeEventListener("abort", entry.abortHandler);
    }
    entry.resolve({
      approved: false,
      reason: "授权决策提交结果不确定，已按拒绝处理且未执行工具。",
      automatic: true,
      approvalId: entry.request.id,
      approvalRevision: revision,
      decisionId,
    });
    safeSend("toolApproval:decision", createDecisionPayload(
      entry.request,
      false,
      true,
      {
        decisionId,
        outcome: "interrupted",
        automatic: true,
        reasonCode: "approval_decision_ambiguous",
        decidedAt: now(),
      },
    ));
    return true;
  }

  function createRequestPayload(request: ToolUserApprovalRequest): ToolApprovalRequestPayload {
    const argsSummary = sanitizeToolApprovalIntentSummary(
      summarizeToolApprovalArgs(request.request),
    );
    const risk = request.risk ?? classifyToolApprovalRisk(request);
    return {
      id: createId(),
      revision: 1,
      taskId: request.taskId,
      taskName: sanitizeToolApprovalIntentLabel(request.taskName),
      request: {
        toolName: request.request.toolName,
        ...(request.request.source ? { source: request.request.source } : {}),
      },
      deniedReason: sanitizeToolApprovalIntentLabel(request.deniedReason),
      argsSummary,
      risk: {
        ...risk,
        reason: sanitizeToolApprovalIntentLabel(risk.reason),
        affectedTargets: risk.affectedTargets.map((target) =>
          sanitizeToolApprovalIntentLabel(target)
        ),
      },
      createdAt: now(),
      ...(request.causalRef ? { causalRef: structuredClone(request.causalRef) } : {}),
    };
  }

  async function createPendingIntent(payload: ToolApprovalRequestPayload) {
    const expiresAt = new Date(
      new Date(payload.createdAt).getTime() + approvalTimeoutMs,
    ).toISOString();
    const intent: ToolApprovalIntent = {
      schemaVersion: CONVERSATION_CAUSAL_SCHEMA_VERSION,
      id: payload.id,
      revision: 1,
      state: "pending",
      requestFingerprint: createConversationRequestFingerprint({
        schemaVersion: 2,
        approvalId: payload.id,
        taskId: payload.taskId,
        toolName: payload.request.toolName,
        source: payload.request.source,
      }),
      taskId: payload.taskId,
      taskName: sanitizeToolApprovalIntentLabel(payload.taskName),
      toolName: payload.request.toolName,
      safeArgsSummary: sanitizeToolApprovalIntentSummary(payload.argsSummary),
      risk: {
        level: payload.risk.level,
        category: payload.risk.category,
        requiresConfirmation: payload.risk.requiresConfirmation,
      },
      causalRef: structuredClone(payload.causalRef ?? {}),
      ownerProcessEpoch: options.processEpoch,
      createdAt: payload.createdAt,
      updatedAt: payload.createdAt,
      expiresAt,
    };
    try {
      const created = payload.causalRef?.requestId
        ? await options.store.createApprovalIntentAndLink({
            requestId: payload.causalRef.requestId,
            intent,
          })
        : await options.store.createApprovalIntent(intent);
      return created;
    } catch {
      return { disposition: "conflict" as const };
    }
  }

  function createIntentDecision(input: {
    decisionId: string;
    outcome: Exclude<ToolApprovalIntentState, "pending">;
    reasonCode: string;
    automatic?: boolean;
  }): ToolApprovalIntentDecision {
    return {
      decisionId: input.decisionId,
      outcome: input.outcome,
      automatic: input.automatic ?? input.outcome !== "approved",
      reasonCode: input.reasonCode,
      decidedAt: now(),
    };
  }

  function createDecisionPayload(
    request: ToolApprovalRequestPayload,
    approved: boolean,
    automatic: boolean,
    decision: ToolApprovalIntentDecision,
  ): ToolApprovalDecisionPayload {
    return {
      id: request.id,
      revision: 2,
      decisionId: decision.decisionId,
      taskId: request.taskId,
      taskName: request.taskName,
      toolName: request.request.toolName,
      approved,
      automatic,
      risk: request.risk,
      createdAt: decision.decidedAt,
    };
  }

  function failClosedResult(id: string, reason: string): ToolUserApprovalResult {
    return { approved: false, reason, automatic: true, approvalId: id };
  }

  function safeSend(channel: string, payload: unknown): void {
    try {
      options.sendToRenderers(channel, payload);
    } catch {
      // Durable intent/decision remains authoritative across renderer failure.
    }
  }

  return {
    initialize,
    republishPending,
    pendingSnapshot,
    getAutoApprovalState,
    setAutoApprovalEnabled,
    setGoalModeEnabled,
    setGoalActive,
    requestUserApproval,
    resolveApproval,
    rejectAllPending,
  };
}
