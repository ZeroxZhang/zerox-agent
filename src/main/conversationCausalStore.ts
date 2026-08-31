import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  CONVERSATION_CAUSAL_SCHEMA_VERSION,
  CONVERSATION_REQUEST_FINGERPRINT_VERSION,
  LEGACY_CONVERSATION_REQUEST_FINGERPRINT_VERSION,
  fingerprintConversationAttemptControl,
  fingerprintConversationCausalValue,
  createConversationCausalAttemptId,
  createConversationAssistantAcceptanceWorkspaceEventId,
  mergeConversationCausalCoverage,
  mergeConversationCausalRefs,
  normalizeConversationCausalCoverage,
  isConversationRequiredSettlementFailureCode,
  resolveConversationAgentRunExecutionRevision,
  sanitizeToolApprovalIntentLabel,
  sanitizeToolApprovalIntentSummary,
  hasConsistentToolApprovalInvocationIdentity,
  resolveConversationRequestFingerprintVersion,
  type CausalMutationDisposition,
  type ConversationCausalAttempt,
  type ConversationCausalAttemptState,
  type ConversationAssistantAcceptance,
  type ConversationAgentRunAdmission,
  type ConversationAgentRunAdmissionFailureCode,
  type ConversationAgentRunOwnerFact,
  type ConversationCausalCoverage,
  type ConversationCausalRecord,
  type ConversationCausalRef,
  type ConversationRequiredSettlement,
  type ConversationRequiredSettlementFailureCode,
  type ToolApprovalIntent,
  type ToolApprovalIntentDecision,
} from "../shared/conversationCausalSpine";
import {
  createConversationAcceptedAttemptSettlement,
  type ConversationPersistedAssistantMessage,
} from "../shared/conversationDisclosure";

type StoredConversationCausalState = {
  schemaVersion: typeof CONVERSATION_CAUSAL_SCHEMA_VERSION;
  records: ConversationCausalRecord[];
  approvals: ToolApprovalIntent[];
};

export type ConversationCausalMutationResult<T> = {
  disposition: CausalMutationDisposition;
  value?: T;
};

export type ConversationCausalStore = ReturnType<typeof createConversationCausalStore>;

export function createConversationCausalStore(options: {
  configDir: string;
  createId?: () => string;
  now?: () => Date;
}) {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const rootDir = path.join(options.configDir, "conversation-causal");
  const statePath = path.join(rootDir, "state.json");
  let mutationQueue: Promise<void> = Promise.resolve();
  let cache: StoredConversationCausalState | null = null;

  async function readState(): Promise<StoredConversationCausalState> {
    if (cache) return cache;
    try {
      const parsed = JSON.parse(await readFile(statePath, "utf8")) as Partial<StoredConversationCausalState>;
      if (
        parsed.schemaVersion !== CONVERSATION_CAUSAL_SCHEMA_VERSION
        || !Array.isArray(parsed.records)
        || !Array.isArray(parsed.approvals)
      ) {
        throw new Error("Conversation causal store schema is invalid.");
      }
      cache = {
        schemaVersion: CONVERSATION_CAUSAL_SCHEMA_VERSION,
        records: parsed.records.map((record) => structuredClone(record)),
        approvals: parsed.approvals.map((approval) => structuredClone(approval)),
      };
      return cache;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        cache = emptyState();
        return cache;
      }
      throw error;
    }
  }

  async function writeState(state: StoredConversationCausalState): Promise<void> {
    await mkdir(rootDir, { recursive: true });
    const tempPath = `${statePath}.${createId()}.tmp`;
    try {
      await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await rename(tempPath, statePath);
      cache = state;
    } catch (error) {
      await unlink(tempPath).catch(() => undefined);
      throw error;
    }
  }

  function mutate<T>(operation: (state: StoredConversationCausalState) => Promise<T> | T): Promise<T> {
    const result = mutationQueue.then(async () => operation(await readState()));
    mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  async function persistRecord(
    state: StoredConversationCausalState,
    current: ConversationCausalRecord,
    next: ConversationCausalRecord,
  ): Promise<void> {
    await writeState({
      ...state,
      records: state.records.map((record) =>
        record.requestId === current.requestId ? next : record,
      ),
    });
  }

  return {
    async getRequest(requestId: string): Promise<ConversationCausalRecord | null> {
      const state = await mutationQueue.then(() => readState());
      const record = state.records.find((candidate) => candidate.requestId === requestId);
      return record ? structuredClone(record) : null;
    },

    async listRequests(): Promise<ConversationCausalRecord[]> {
      const state = await mutationQueue.then(() => readState());
      return state.records.map((record) => structuredClone(record));
    },

    async claimRequest(input: {
      requestId: string;
      turnId: string;
      inputFingerprint: string;
      inputFingerprintVersion?: typeof CONVERSATION_REQUEST_FINGERPRINT_VERSION;
      legacyInputFingerprint?: string;
      coverage?: ConversationCausalCoverage;
      createdAt?: string;
    }): Promise<ConversationCausalMutationResult<ConversationCausalRecord>> {
      return mutate(async (state) => {
        const existing = state.records.find((record) => record.requestId === input.requestId);
        if (existing) {
          const existingVersion = resolveConversationRequestFingerprintVersion(existing);
          const matchesCurrent = existingVersion === CONVERSATION_REQUEST_FINGERPRINT_VERSION
            && existing.inputFingerprint === input.inputFingerprint;
          const matchesLegacy = existingVersion
            === LEGACY_CONVERSATION_REQUEST_FINGERPRINT_VERSION
            && Boolean(input.legacyInputFingerprint)
            && existing.inputFingerprint === input.legacyInputFingerprint;
          const matches = existing.turnId === input.turnId
            && (matchesCurrent || matchesLegacy);
          return {
            disposition: matches ? "duplicate" : "conflict",
            value: structuredClone(existing),
          };
        }
        const timestamp = input.createdAt ?? now().toISOString();
        const record: ConversationCausalRecord = {
          schemaVersion: CONVERSATION_CAUSAL_SCHEMA_VERSION,
          requestId: input.requestId,
          turnId: input.turnId,
          inputFingerprint: input.inputFingerprint,
          inputFingerprintVersion:
            input.inputFingerprintVersion ?? CONVERSATION_REQUEST_FINGERPRINT_VERSION,
          revision: 1,
          attempts: [],
          refs: [],
          coverage: normalizeConversationCausalCoverage(input.coverage ?? {
            state: "complete",
            reasonCodes: [],
          }),
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        await writeState({ ...state, records: [...state.records, record] });
        return { disposition: "applied", value: structuredClone(record) };
      });
    },

    async bindRequest(input: {
      requestId: string;
      sessionId: string;
      userMessageId: string;
    }): Promise<ConversationCausalMutationResult<ConversationCausalRecord>> {
      return mutate(async (state) => {
        const existing = state.records.find((record) => record.requestId === input.requestId);
        if (!existing) return { disposition: "not_found" };
        const sessionId = input.sessionId.trim();
        const userMessageId = input.userMessageId.trim();
        if (!sessionId || !userMessageId) {
          return { disposition: "conflict", value: structuredClone(existing) };
        }
        if (existing.sessionId && !existing.userMessageId) {
          // Session-only rows are immutable legacy routing metadata. Allowing a
          // later path to fill userMessageId would turn routing into ownership.
          return { disposition: "conflict", value: structuredClone(existing) };
        }
        if (
          (existing.sessionId && existing.sessionId !== sessionId)
          || (existing.userMessageId && existing.userMessageId !== userMessageId)
        ) {
          return { disposition: "conflict", value: structuredClone(existing) };
        }
        if (
          existing.sessionId === sessionId
          && existing.userMessageId === userMessageId
        ) {
          return { disposition: "duplicate", value: structuredClone(existing) };
        }
        const next: ConversationCausalRecord = {
          ...existing,
          sessionId,
          userMessageId,
          revision: existing.revision + 1,
          updatedAt: now().toISOString(),
        };
        await persistRecord(state, existing, next);
        return { disposition: "applied", value: structuredClone(next) };
      });
    },

    async beginRequiredSettlement(input: {
      requestId: string;
      id: string;
      attempt: number;
      sourceSequence: number;
      targetState: ConversationRequiredSettlement["targetState"];
      guidedInputRequestId?: string;
      requiredDomains: ConversationRequiredSettlement["requiredDomains"];
      workspaceRunId?: string;
      preparedWorkspaceEventId?: string;
      preparedChatEventFingerprint: string;
    }): Promise<ConversationCausalMutationResult<ConversationCausalRecord>> {
      return mutate(async (state) => {
        const existing = state.records.find((record) => record.requestId === input.requestId);
        if (!existing) return { disposition: "not_found" };
        const settlements = existing.requiredSettlements ?? [];
        const requiredDomains = [...new Set(input.requiredDomains)].sort();
        const workspaceRunId = input.workspaceRunId?.trim() || undefined;
        const preparedWorkspaceEventId =
          input.preparedWorkspaceEventId?.trim() || undefined;
        const duplicate = settlements.find((entry) => entry.id === input.id);
        if (duplicate) {
          const exact = duplicate.attempt === input.attempt
            && duplicate.sourceSequence === input.sourceSequence
            && duplicate.targetState === input.targetState
            && duplicate.guidedInputRequestId === input.guidedInputRequestId
            && duplicate.workspaceRunId === workspaceRunId
            && duplicate.preparedWorkspaceEventId === preparedWorkspaceEventId
            && duplicate.preparedChatEventFingerprint
              === input.preparedChatEventFingerprint
            && fingerprintConversationCausalValue(duplicate.requiredDomains)
              === fingerprintConversationCausalValue(requiredDomains);
          return {
            disposition: exact ? "duplicate" : "conflict",
            value: structuredClone(existing),
          };
        }
        if (hasIrreversibleAssistantAcceptanceFence(existing, input.attempt)) {
          return { disposition: "conflict", value: structuredClone(existing) };
        }
        const hasFrozenWorkspaceIdentity = Boolean(
          workspaceRunId && preparedWorkspaceEventId,
        );
        const hasPartialWorkspaceIdentity = Boolean(workspaceRunId)
          !== Boolean(preparedWorkspaceEventId);
        if (
          !isLatestActiveAttempt(existing, input.attempt)
          || input.sourceSequence < 1
          || !input.id.trim()
          || !/^[a-f0-9]{64}$/.test(input.preparedChatEventFingerprint)
          || requiredDomains.length < 1
          || requiredDomains[0] !== "chat"
          || requiredDomains.some(
            (domain) => domain !== "chat" && domain !== "workspace",
          )
          || (input.workspaceRunId !== undefined && !workspaceRunId)
          || (
            input.preparedWorkspaceEventId !== undefined
            && !preparedWorkspaceEventId
          )
          || hasPartialWorkspaceIdentity
          || (hasFrozenWorkspaceIdentity !== requiredDomains.includes("workspace"))
        ) {
          return { disposition: "conflict", value: structuredClone(existing) };
        }
        const timestamp = now().toISOString();
        const settlement: ConversationRequiredSettlement = {
          id: input.id,
          attempt: input.attempt,
          sourceSequence: input.sourceSequence,
          targetState: input.targetState,
          ...(input.guidedInputRequestId
            ? { guidedInputRequestId: input.guidedInputRequestId }
            : {}),
          requiredDomains,
          ...(workspaceRunId ? { workspaceRunId } : {}),
          ...(preparedWorkspaceEventId
            ? { preparedWorkspaceEventId }
            : {}),
          preparedChatEventFingerprint: input.preparedChatEventFingerprint,
          state: "preparing",
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        const next: ConversationCausalRecord = {
          ...existing,
          revision: existing.revision + 1,
          requiredSettlements: [...settlements, settlement],
          updatedAt: timestamp,
        };
        await persistRecord(state, existing, next);
        return { disposition: "applied", value: structuredClone(next) };
      });
    },

    async settleRequiredSettlement(input: {
      requestId: string;
      id: string;
    } & (
      | {
          state: "committed";
          chatEventFingerprint: string;
          workspaceEventId?: string;
          failureCode?: never;
        }
      | {
          state: "failed";
          chatEventFingerprint?: string;
          workspaceEventId?: string;
          failureCode: ConversationRequiredSettlementFailureCode;
        }
    )): Promise<ConversationCausalMutationResult<ConversationCausalRecord>> {
      return mutate(async (state) => {
        const existing = state.records.find((record) => record.requestId === input.requestId);
        if (!existing) return { disposition: "not_found" };
        const settlements = existing.requiredSettlements ?? [];
        const target = settlements.find((entry) => entry.id === input.id);
        if (!target) return { disposition: "not_found", value: structuredClone(existing) };
        if (
          (input.state === "failed"
            && !isConversationRequiredSettlementFailureCode(input.failureCode))
          || (input.state === "committed" && input.failureCode !== undefined)
        ) {
          return { disposition: "conflict", value: structuredClone(existing) };
        }
        if (
          input.state === "committed"
          && (
            !input.chatEventFingerprint
            || input.chatEventFingerprint !== target.preparedChatEventFingerprint
            || (target.requiredDomains.includes("workspace") && !input.workspaceEventId)
            || (
              target.preparedWorkspaceEventId
              && input.workspaceEventId !== target.preparedWorkspaceEventId
            )
          )
        ) {
          return { disposition: "conflict", value: structuredClone(existing) };
        }
        if (
          input.chatEventFingerprint
          && input.chatEventFingerprint !== target.preparedChatEventFingerprint
        ) {
          return { disposition: "conflict", value: structuredClone(existing) };
        }
        if (
          target.preparedWorkspaceEventId
          && input.workspaceEventId
          && input.workspaceEventId !== target.preparedWorkspaceEventId
        ) {
          return { disposition: "conflict", value: structuredClone(existing) };
        }
        if (target.state !== "preparing") {
          const exact = target.state === input.state
            && target.chatEventFingerprint === input.chatEventFingerprint
            && target.workspaceEventId === input.workspaceEventId
            && target.failureCode === input.failureCode;
          return {
            disposition: exact ? "duplicate" : "conflict",
            value: structuredClone(existing),
          };
        }
        if (
          input.state === "committed"
          && !isLatestActiveAttempt(existing, target.attempt)
        ) {
          return { disposition: "conflict", value: structuredClone(existing) };
        }
        if (input.state === "failed") {
          const owningAttempt = existing.attempts.find(
            (attempt) => attempt.attempt === target.attempt,
          );
          if (!owningAttempt || owningAttempt.state === "accepted") {
            return { disposition: "conflict", value: structuredClone(existing) };
          }
        }
        const timestamp = now().toISOString();
        const settled: ConversationRequiredSettlement = {
          ...target,
          state: input.state,
          ...(input.chatEventFingerprint
            ? { chatEventFingerprint: input.chatEventFingerprint }
            : {}),
          ...(input.workspaceEventId ? { workspaceEventId: input.workspaceEventId } : {}),
          ...(input.failureCode ? { failureCode: input.failureCode } : {}),
          updatedAt: timestamp,
        };
        const next: ConversationCausalRecord = {
          ...existing,
          revision: existing.revision + 1,
          requiredSettlements: settlements.map((entry) =>
            entry.id === target.id ? settled : entry,
          ),
          updatedAt: timestamp,
        };
        await persistRecord(state, existing, next);
        return { disposition: "applied", value: structuredClone(next) };
      });
    },

    async admitAgentRun(input: {
      requestId: string;
      runId: string;
      taskId: string;
      sessionId?: string;
      executionRevision?: number;
    }): Promise<ConversationCausalMutationResult<ConversationCausalRecord>> {
      return mutate(async (state) => {
        const existing = state.records.find((record) => record.requestId === input.requestId);
        if (!existing) return { disposition: "not_found" };
        const admissions = existing.agentRunAdmissions ?? [];
        const duplicate = admissions.find((entry) => entry.runId === input.runId);
        if (duplicate) {
          const exact = duplicate.taskId === input.taskId
            && duplicate.sessionId === input.sessionId
            && resolveConversationAgentRunExecutionRevision(duplicate)
              === (input.executionRevision ?? 1);
          return {
            disposition: exact ? "duplicate" : "conflict",
            value: structuredClone(existing),
          };
        }
        const foreignOwner = state.records.some((record) =>
          record.requestId !== existing.requestId
          && (record.agentRunAdmissions ?? []).some(
            (admission) => admission.runId === input.runId,
          ),
        );
        if (
          foreignOwner
          || !input.runId.trim()
          || !input.taskId.trim()
          || !Number.isSafeInteger(input.executionRevision ?? 1)
          || (input.executionRevision ?? 1) !== 1
        ) {
          return { disposition: "conflict", value: structuredClone(existing) };
        }
        const timestamp = now().toISOString();
        const admission: ConversationAgentRunAdmission = {
          runId: input.runId,
          taskId: input.taskId,
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          executionRevision: 1,
          state: "admitted",
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        const next: ConversationCausalRecord = {
          ...existing,
          revision: existing.revision + 1,
          agentRunAdmissions: [...admissions, admission],
          refs: mergeConversationCausalRefs(existing.refs, [
            { kind: "agent_run", id: input.runId },
          ]),
          updatedAt: timestamp,
        };
        await persistRecord(state, existing, next);
        return { disposition: "applied", value: structuredClone(next) };
      });
    },

    async settleAgentRunAdmission(input: {
      requestId: string;
      runId: string;
      expectedExecutionRevision?: number;
      state: "started" | "settled" | "aborted";
      finalStatus?: ConversationAgentRunAdmission["finalStatus"];
      failureCode?: ConversationAgentRunAdmissionFailureCode;
    }): Promise<ConversationCausalMutationResult<ConversationCausalRecord>> {
      return mutate(async (state) => {
        const existing = state.records.find((record) => record.requestId === input.requestId);
        if (!existing) return { disposition: "not_found" };
        const admissions = existing.agentRunAdmissions ?? [];
        const target = admissions.find((entry) => entry.runId === input.runId);
        if (!target) return { disposition: "not_found", value: structuredClone(existing) };
        const expectedExecutionRevision = input.expectedExecutionRevision ?? 1;
        if (
          !Number.isSafeInteger(expectedExecutionRevision)
          || expectedExecutionRevision < 1
          || resolveConversationAgentRunExecutionRevision(target)
            !== expectedExecutionRevision
        ) {
          return { disposition: "conflict", value: structuredClone(existing) };
        }
        const lifecycleFieldsAreValid = input.state === "started"
          ? input.finalStatus === undefined && input.failureCode === undefined
          : input.state === "settled"
            ? input.finalStatus !== undefined && input.failureCode === undefined
            : input.finalStatus === undefined && input.failureCode !== undefined;
        if (!lifecycleFieldsAreValid) {
          return { disposition: "conflict", value: structuredClone(existing) };
        }
        const exact = target.state === input.state
          && resolveConversationAgentRunExecutionRevision(target)
            === expectedExecutionRevision
          && target.finalStatus === input.finalStatus
          && target.failureCode === input.failureCode;
        if (exact) return { disposition: "duplicate", value: structuredClone(existing) };
        const legal = target.state === "admitted"
          ? input.state === "started" || input.state === "aborted"
          : target.state === "started"
            ? input.state === "settled" || input.state === "aborted"
            : false;
        if (!legal) return { disposition: "conflict", value: structuredClone(existing) };
        const timestamp = now().toISOString();
        const settled: ConversationAgentRunAdmission = {
          ...target,
          executionRevision: expectedExecutionRevision,
          state: input.state,
          ...(input.finalStatus ? { finalStatus: input.finalStatus } : {}),
          ...(input.failureCode ? { failureCode: input.failureCode } : {}),
          updatedAt: timestamp,
        };
        const next: ConversationCausalRecord = {
          ...existing,
          revision: existing.revision + 1,
          agentRunAdmissions: admissions.map((entry) =>
            entry.runId === target.runId ? settled : entry,
          ),
          updatedAt: timestamp,
        };
        await persistRecord(state, existing, next);
        return { disposition: "applied", value: structuredClone(next) };
      });
    },

    async beginAgentRunResume(input: {
      runId: string;
      taskId: string;
      executionEnvelopeFingerprint: string;
    }): Promise<ConversationCausalMutationResult<{
      requestId: string;
      runId: string;
      taskId: string;
      executionRevision: number;
      executionEnvelopeFingerprint: string;
    }>> {
      return mutate(async (state) => {
        if (!/^[0-9a-f]{64}$/.test(input.executionEnvelopeFingerprint)) {
          return { disposition: "conflict" };
        }
        const matches = state.records.flatMap((record) =>
          (record.agentRunAdmissions ?? [])
            .filter((admission) =>
              admission.runId === input.runId
              && admission.taskId === input.taskId,
            )
            .map((admission) => ({ record, admission })),
        );
        if (matches.length === 0) return { disposition: "not_found" };
        const latestRevision = Math.max(
          ...matches.map(({ admission }) =>
            resolveConversationAgentRunExecutionRevision(admission)),
        );
        const latest = matches.filter(({ admission }) =>
          resolveConversationAgentRunExecutionRevision(admission) === latestRevision,
        );
        if (latest.length !== 1) return { disposition: "conflict" };
        const [{ record, admission }] = latest;
        if (admission.state !== "settled" || admission.finalStatus !== "paused") {
          return { disposition: "conflict" };
        }
        const executionRevision = latestRevision + 1;
        const timestamp = now().toISOString();
        const resumed: ConversationAgentRunAdmission = {
          runId: admission.runId,
          taskId: admission.taskId,
          ...(admission.sessionId ? { sessionId: admission.sessionId } : {}),
          executionRevision,
          executionEnvelopeFingerprint: input.executionEnvelopeFingerprint,
          state: "started",
          createdAt: admission.createdAt,
          updatedAt: timestamp,
        };
        const next: ConversationCausalRecord = {
          ...record,
          revision: record.revision + 1,
          agentRunAdmissions: (record.agentRunAdmissions ?? []).map((candidate) =>
            candidate === admission ? resumed : candidate,
          ),
          updatedAt: timestamp,
        };
        await persistRecord(state, record, next);
        return {
          disposition: "applied",
          value: {
            requestId: record.requestId,
            runId: input.runId,
            taskId: input.taskId,
            executionRevision,
            executionEnvelopeFingerprint: input.executionEnvelopeFingerprint,
          },
        };
      });
    },

    async reconcileAgentRunAdmissions(
      owners: ReadonlyMap<string, ConversationAgentRunOwnerFact>,
    ): Promise<{ reconciled: number; settled: number; aborted: number }> {
      return mutate(async (state) => {
        const timestamp = now().toISOString();
        const owningRequestsByRun = new Map<string, Set<string>>();
        for (const record of state.records) {
          for (const admission of record.agentRunAdmissions ?? []) {
            const requestIds = owningRequestsByRun.get(admission.runId)
              ?? new Set<string>();
            requestIds.add(record.requestId);
            owningRequestsByRun.set(admission.runId, requestIds);
          }
        }
        let reconciled = 0;
        let settled = 0;
        let aborted = 0;
        const records = state.records.map((record) => {
          let changed = false;
          const admissions = (record.agentRunAdmissions ?? []).map((admission) => {
            const admissionRevision =
              resolveConversationAgentRunExecutionRevision(admission);
            const owner = owners.get(admission.runId);
            const ownerRevision = owner
              ? resolveConversationAgentRunExecutionRevision(owner)
              : 0;
            const hasUniqueRequestOwner =
              owningRequestsByRun.get(admission.runId)?.size === 1;
            const validOwner = hasUniqueRequestOwner
              && owner?.taskId === admission.taskId
              ? owner
              : undefined;

            if (admission.state === "admitted" || admission.state === "started") {
              changed = true;
              reconciled += 1;
              if (validOwner && ownerRevision === admissionRevision) {
                settled += 1;
                return {
                  ...admission,
                  executionRevision: admissionRevision,
                  state: "settled" as const,
                  finalStatus: validOwner.status,
                  createdAt: admission.createdAt,
                  updatedAt: timestamp,
                };
              }
              aborted += 1;
              return {
                ...admission,
                executionRevision: admissionRevision,
                state: "aborted" as const,
                failureCode: validOwner
                  ? "AGENT_RUN_REVISION_GAP" as const
                  : owner
                    ? "AGENT_RUN_OWNER_CONFLICT" as const
                    : "AGENT_RUN_OWNER_MISSING" as const,
                createdAt: admission.createdAt,
                updatedAt: timestamp,
              };
            }

            if (
              admission.state === "settled"
              && admission.finalStatus === "paused"
            ) {
              if (
                validOwner
                && ownerRevision === admissionRevision
                && validOwner.status === "paused"
              ) {
                return admission;
              }
              changed = true;
              reconciled += 1;
              aborted += 1;
              return {
                ...admission,
                executionRevision: admissionRevision,
                state: "aborted" as const,
                failureCode: !owner
                  ? "AGENT_RUN_OWNER_MISSING" as const
                  : !validOwner
                    ? "AGENT_RUN_OWNER_CONFLICT" as const
                    : ownerRevision !== admissionRevision
                    ? "AGENT_RUN_REVISION_GAP" as const
                    : "AGENT_RUN_OWNER_CONFLICT" as const,
                createdAt: admission.createdAt,
                updatedAt: timestamp,
              };
            }
            return admission;
          });
          return changed
            ? {
                ...record,
                revision: record.revision + 1,
                agentRunAdmissions: admissions,
                updatedAt: timestamp,
              }
            : record;
        });
        if (reconciled > 0) await writeState({ ...state, records });
        return { reconciled, settled, aborted };
      });
    },

    async beginAttempt(input: {
      requestId: string;
      attempt: number;
    }): Promise<ConversationCausalMutationResult<ConversationCausalRecord>> {
      return mutate(async (state) => {
        const existing = state.records.find((record) => record.requestId === input.requestId);
        if (!existing) return { disposition: "not_found" };
        const prior = existing.attempts.at(-1);
        const same = existing.attempts.find((attempt) => attempt.attempt === input.attempt);
        if (same) {
          return {
            disposition: same.state === "active" ? "duplicate" : "conflict",
            value: structuredClone(existing),
          };
        }
        if (
          input.attempt < 1
          || input.attempt !== (prior?.attempt ?? 0) + 1
          || prior?.state === "active"
          || prior?.state === "accepted"
        ) {
          return { disposition: "conflict", value: structuredClone(existing) };
        }
        const timestamp = now().toISOString();
        const controlSequence = (prior?.controlSequence ?? 0) + 1;
        const attempt: ConversationCausalAttempt = {
          attempt: input.attempt,
          state: "active",
          controlSequence,
          eventFingerprint: fingerprintConversationAttemptControl({
            requestId: existing.requestId,
            turnId: existing.turnId,
            attempt: input.attempt,
            controlSequence,
            state: "active",
          }),
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        const next: ConversationCausalRecord = {
          ...existing,
          revision: existing.revision + 1,
          attempts: [...existing.attempts, attempt],
          updatedAt: timestamp,
        };
        await persistRecord(state, existing, next);
        return { disposition: "applied", value: structuredClone(next) };
      });
    },

    async settleAttempt(input: {
      requestId: string;
      attempt: number;
      state: Extract<ConversationCausalAttemptState, "superseded" | "reset" | "interrupted">;
      supersedesAttempt?: number;
    }): Promise<ConversationCausalMutationResult<ConversationCausalRecord>> {
      return mutate(async (state) => {
        const existing = state.records.find((record) => record.requestId === input.requestId);
        if (!existing) return { disposition: "not_found" };
        const target = existing.attempts.find((attempt) => attempt.attempt === input.attempt);
        if (!target) return { disposition: "not_found", value: structuredClone(existing) };
        if (target.state !== "active") {
          return {
            disposition: target.state === input.state ? "duplicate" : "conflict",
            value: structuredClone(existing),
          };
        }
        const controlSequence = target.controlSequence + 1;
        const timestamp = now().toISOString();
        const settled: ConversationCausalAttempt = {
          ...target,
          state: input.state,
          controlSequence,
          ...(input.supersedesAttempt ? { supersedesAttempt: input.supersedesAttempt } : {}),
          eventFingerprint: fingerprintConversationAttemptControl({
            requestId: existing.requestId,
            turnId: existing.turnId,
            attempt: target.attempt,
            controlSequence,
            state: input.state,
            ...(input.supersedesAttempt ? { supersedesAttempt: input.supersedesAttempt } : {}),
          }),
          updatedAt: timestamp,
        };
        const next = replaceAttempt(existing, settled, timestamp);
        await persistRecord(state, existing, next);
        return { disposition: "applied", value: structuredClone(next) };
      });
    },

    async prepareAssistantAcceptance(input: {
      requestId: string;
      attempt: number;
      persistedMessage: ConversationPersistedAssistantMessage;
      workspaceRunId?: string;
    }): Promise<ConversationCausalMutationResult<ConversationCausalRecord>> {
      return mutate(async (state) => {
        const existing = state.records.find((record) => record.requestId === input.requestId);
        if (!existing) return { disposition: "not_found" };
        const target = existing.attempts.find((attempt) => attempt.attempt === input.attempt);
        if (!target) return { disposition: "not_found", value: structuredClone(existing) };
        if (hasRequiredSettlementAssistantAcceptanceFence(existing, input.attempt)) {
          return { disposition: "conflict", value: structuredClone(existing) };
        }
        const frozenSequence = target.assistantAcceptance
          ?.acceptedSettlement.lastSequence
          ?? target.acceptedSettlement?.lastSequence
          ?? target.controlSequence + 1;
        let acceptedSettlement;
        try {
          acceptedSettlement = createConversationAcceptedAttemptSettlement({
            requestId: existing.requestId,
            turnId: existing.turnId,
            attempt: target.attempt,
            sequence: frozenSequence,
            acceptedMessageId: input.persistedMessage.id,
            persistedMessage: input.persistedMessage,
          });
        } catch {
          return { disposition: "conflict", value: structuredClone(existing) };
        }
        const requiredDomains: ConversationAssistantAcceptance["requiredDomains"] =
          input.workspaceRunId ? ["chat", "workspace"] : ["chat"];
        const preparedWorkspaceEventId = input.workspaceRunId
          ? createConversationAssistantAcceptanceWorkspaceEventId({
              requestId: existing.requestId,
              attempt: target.attempt,
              acceptanceReceiptFingerprint:
                acceptedSettlement.acceptanceReceiptFingerprint,
            })
          : undefined;
        const existingAcceptance = target.assistantAcceptance;
        if (existingAcceptance) {
          const exact =
            existingAcceptance.acceptedSettlement.acceptanceReceiptFingerprint
              === acceptedSettlement.acceptanceReceiptFingerprint
            && fingerprintConversationCausalValue(existingAcceptance.requiredDomains)
              === fingerprintConversationCausalValue(requiredDomains)
            && existingAcceptance.workspaceRunId === input.workspaceRunId
            && existingAcceptance.preparedWorkspaceEventId
              === preparedWorkspaceEventId;
          return {
            disposition: exact ? "duplicate" : "conflict",
            value: structuredClone(existing),
          };
        }
        if (!isLatestActiveAttempt(existing, input.attempt)) {
          return { disposition: "conflict", value: structuredClone(existing) };
        }
        const timestamp = now().toISOString();
        const assistantAcceptance: ConversationAssistantAcceptance = {
          state: "preparing",
          acceptedSettlement,
          requiredDomains,
          ...(input.workspaceRunId ? { workspaceRunId: input.workspaceRunId } : {}),
          ...(preparedWorkspaceEventId ? { preparedWorkspaceEventId } : {}),
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        const prepared: ConversationCausalAttempt = {
          ...target,
          assistantAcceptance,
          updatedAt: timestamp,
        };
        const next = replaceAttempt(existing, prepared, timestamp);
        await persistRecord(state, existing, next);
        return { disposition: "applied", value: structuredClone(next) };
      });
    },

    async commitAssistantAcceptance(input: {
      requestId: string;
      attempt: number;
      acceptanceReceiptFingerprint: string;
      workspaceEventId?: string;
    }): Promise<ConversationCausalMutationResult<ConversationCausalRecord>> {
      return mutate(async (state) => {
        const existing = state.records.find((record) => record.requestId === input.requestId);
        if (!existing) return { disposition: "not_found" };
        const target = existing.attempts.find((attempt) => attempt.attempt === input.attempt);
        if (!target) return { disposition: "not_found", value: structuredClone(existing) };
        const preparation = target.assistantAcceptance;
        if (
          !preparation
          || preparation.acceptedSettlement.acceptanceReceiptFingerprint
            !== input.acceptanceReceiptFingerprint
        ) {
          return { disposition: "conflict", value: structuredClone(existing) };
        }
        if (preparation.state === "committed" && target.state === "accepted") {
          return {
            disposition:
              preparation.workspaceEventId === input.workspaceEventId
                ? "duplicate"
                : "conflict",
            value: structuredClone(existing),
          };
        }
        if (
          target.state !== "active"
          || existing.attempts.at(-1)?.attempt !== input.attempt
          || hasRequiredSettlementAssistantAcceptanceFence(existing, input.attempt)
        ) {
          return { disposition: "conflict", value: structuredClone(existing) };
        }
        const requiresWorkspace = preparation.requiredDomains.includes("workspace");
        if (
          requiresWorkspace
            ? !preparation.workspaceRunId
              || !preparation.preparedWorkspaceEventId
              || input.workspaceEventId !== preparation.preparedWorkspaceEventId
            : input.workspaceEventId !== undefined
        ) {
          return { disposition: "conflict", value: structuredClone(existing) };
        }
        const timestamp = now().toISOString();
        const committedAcceptance: ConversationAssistantAcceptance = {
          ...preparation,
          state: "committed",
          ...(input.workspaceEventId ? { workspaceEventId: input.workspaceEventId } : {}),
          updatedAt: timestamp,
        };
        const settled: ConversationCausalAttempt = {
          ...target,
          state: "accepted",
          controlSequence: preparation.acceptedSettlement.lastSequence,
          eventFingerprint: fingerprintConversationAttemptControl({
            requestId: existing.requestId,
            turnId: existing.turnId,
            attempt: target.attempt,
            controlSequence: preparation.acceptedSettlement.lastSequence,
            state: "accepted",
            acceptedReceiptFingerprint: input.acceptanceReceiptFingerprint,
          }),
          assistantAcceptance: committedAcceptance,
          acceptedSettlement: preparation.acceptedSettlement,
          updatedAt: timestamp,
        };
        const refs = requiresWorkspace
          ? mergeConversationCausalRefs(existing.refs, [
              { kind: "workspace_run", id: preparation.workspaceRunId! },
              {
                kind: "workspace_event",
                runId: preparation.workspaceRunId!,
                eventId: input.workspaceEventId!,
              },
            ])
          : existing.refs;
        const next: ConversationCausalRecord = {
          ...existing,
          revision: existing.revision + 1,
          attempts: existing.attempts.map((attempt) =>
            attempt.attempt === settled.attempt ? settled : attempt,
          ),
          refs,
          updatedAt: timestamp,
        };
        await persistRecord(state, existing, next);
        return { disposition: "applied", value: structuredClone(next) };
      });
    },

    async acceptAssistant(input: {
      requestId: string;
      attempt: number;
      persistedMessage: ConversationPersistedAssistantMessage;
    }): Promise<ConversationCausalMutationResult<ConversationCausalRecord>> {
      return mutate(async (state) => {
        const existing = state.records.find((record) => record.requestId === input.requestId);
        if (!existing) return { disposition: "not_found" };
        const target = existing.attempts.find((attempt) => attempt.attempt === input.attempt);
        if (!target) return { disposition: "not_found", value: structuredClone(existing) };
        if (hasRequiredSettlementAssistantAcceptanceFence(existing, input.attempt)) {
          return { disposition: "conflict", value: structuredClone(existing) };
        }
        if (target.state === "accepted" && target.acceptedSettlement) {
          try {
            const replay = createConversationAcceptedAttemptSettlement({
              requestId: existing.requestId,
              turnId: existing.turnId,
              attempt: target.attempt,
              sequence: target.acceptedSettlement.lastSequence,
              acceptedMessageId: input.persistedMessage.id,
              persistedMessage: input.persistedMessage,
            });
            return {
              disposition:
                replay.acceptanceReceiptFingerprint
                  === target.acceptedSettlement.acceptanceReceiptFingerprint
                  ? "duplicate"
                  : "conflict",
              value: structuredClone(existing),
            };
          } catch {
            return { disposition: "conflict", value: structuredClone(existing) };
          }
        }
        if (!isLatestActiveAttempt(existing, input.attempt)) {
          return { disposition: "conflict", value: structuredClone(existing) };
        }
        const controlSequence = target.controlSequence + 1;
        let acceptedSettlement;
        try {
          acceptedSettlement = createConversationAcceptedAttemptSettlement({
            requestId: existing.requestId,
            turnId: existing.turnId,
            attempt: target.attempt,
            sequence: controlSequence,
            acceptedMessageId: input.persistedMessage.id,
            persistedMessage: input.persistedMessage,
          });
        } catch {
          return { disposition: "conflict", value: structuredClone(existing) };
        }
        const timestamp = now().toISOString();
        const settled: ConversationCausalAttempt = {
          ...target,
          state: "accepted",
          controlSequence,
          eventFingerprint: fingerprintConversationAttemptControl({
            requestId: existing.requestId,
            turnId: existing.turnId,
            attempt: target.attempt,
            controlSequence,
            state: "accepted",
            acceptedReceiptFingerprint: acceptedSettlement.acceptanceReceiptFingerprint,
          }),
          assistantAcceptance: {
            state: "committed",
            acceptedSettlement,
            requiredDomains: ["chat"],
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          acceptedSettlement,
          updatedAt: timestamp,
        };
        const next = replaceAttempt(existing, settled, timestamp);
        await persistRecord(state, existing, next);
        return { disposition: "applied", value: structuredClone(next) };
      });
    },

    async reconcileAssistant(input: {
      requestId: string;
      attempt: number;
      causalAttemptId: string;
      persistedMessage: ConversationPersistedAssistantMessage;
    }): Promise<ConversationCausalMutationResult<ConversationCausalRecord>> {
      return mutate(async (state) => {
        const existing = state.records.find((record) => record.requestId === input.requestId);
        if (!existing) return { disposition: "not_found" };
        const expectedAttemptId = createConversationCausalAttemptId({
          requestId: existing.requestId,
          turnId: existing.turnId,
          attempt: input.attempt,
        });
        if (input.causalAttemptId !== expectedAttemptId) {
          return { disposition: "conflict", value: structuredClone(existing) };
        }
        const target = existing.attempts.find((attempt) => attempt.attempt === input.attempt);
        if (!target) return { disposition: "not_found", value: structuredClone(existing) };
        if (
          existing.attempts.at(-1)?.attempt !== input.attempt
          || hasRequiredSettlementAssistantAcceptanceFence(existing, input.attempt)
        ) {
          return { disposition: "conflict", value: structuredClone(existing) };
        }
        if (target.state === "accepted" && target.acceptedSettlement) {
          try {
            const replay = createConversationAcceptedAttemptSettlement({
              requestId: existing.requestId,
              turnId: existing.turnId,
              attempt: target.attempt,
              sequence: target.acceptedSettlement.lastSequence,
              acceptedMessageId: input.persistedMessage.id,
              persistedMessage: input.persistedMessage,
            });
            return {
              disposition:
                replay.acceptanceReceiptFingerprint
                  === target.acceptedSettlement.acceptanceReceiptFingerprint
                  ? "duplicate"
                  : "conflict",
              value: structuredClone(existing),
            };
          } catch {
            return { disposition: "conflict", value: structuredClone(existing) };
          }
        }
        if (target.state !== "active" && target.state !== "interrupted") {
          return { disposition: "conflict", value: structuredClone(existing) };
        }
        const preparedAcceptance = target.assistantAcceptance;
        if (preparedAcceptance?.requiredDomains.includes("workspace")) {
          return { disposition: "conflict", value: structuredClone(existing) };
        }
        const controlSequence = preparedAcceptance
          ?.acceptedSettlement.lastSequence
          ?? target.controlSequence + 1;
        let acceptedSettlement;
        try {
          acceptedSettlement = createConversationAcceptedAttemptSettlement({
            requestId: existing.requestId,
            turnId: existing.turnId,
            attempt: target.attempt,
            sequence: controlSequence,
            acceptedMessageId: input.persistedMessage.id,
            persistedMessage: input.persistedMessage,
          });
        } catch {
          return { disposition: "conflict", value: structuredClone(existing) };
        }
        if (
          preparedAcceptance
          && preparedAcceptance.acceptedSettlement.acceptanceReceiptFingerprint
            !== acceptedSettlement.acceptanceReceiptFingerprint
        ) {
          return { disposition: "conflict", value: structuredClone(existing) };
        }
        const timestamp = now().toISOString();
        const settled: ConversationCausalAttempt = {
          ...target,
          state: "accepted",
          controlSequence,
          eventFingerprint: fingerprintConversationAttemptControl({
            requestId: existing.requestId,
            turnId: existing.turnId,
            attempt: target.attempt,
            controlSequence,
            state: "accepted",
            acceptedReceiptFingerprint: acceptedSettlement.acceptanceReceiptFingerprint,
          }),
          assistantAcceptance: {
            ...(preparedAcceptance ?? {
              requiredDomains: ["chat"] as const,
              createdAt: timestamp,
            }),
            state: "committed",
            acceptedSettlement,
            updatedAt: timestamp,
          },
          acceptedSettlement,
          updatedAt: timestamp,
        };
        const next = replaceAttempt(existing, settled, timestamp);
        await persistRecord(state, existing, next);
        return { disposition: "applied", value: structuredClone(next) };
      });
    },

    async addRefs(input: {
      requestId: string;
      refs: ConversationCausalRef[];
      coverage?: ConversationCausalCoverage;
    }): Promise<ConversationCausalMutationResult<ConversationCausalRecord>> {
      return mutate(async (state) => {
        const existing = state.records.find((record) => record.requestId === input.requestId);
        if (!existing) return { disposition: "not_found" };
        const refs = mergeConversationCausalRefs(existing.refs, input.refs);
        const coverage = input.coverage
          ? mergeConversationCausalCoverage(existing.coverage, input.coverage)
          : existing.coverage;
        if (
          fingerprintConversationCausalValue(refs) === fingerprintConversationCausalValue(existing.refs)
          && fingerprintConversationCausalValue(coverage) === fingerprintConversationCausalValue(existing.coverage)
        ) {
          return { disposition: "duplicate", value: structuredClone(existing) };
        }
        const next: ConversationCausalRecord = {
          ...existing,
          revision: existing.revision + 1,
          refs,
          coverage,
          updatedAt: now().toISOString(),
        };
        await persistRecord(state, existing, next);
        return { disposition: "applied", value: structuredClone(next) };
      });
    },

    async interruptActiveAttempts(): Promise<number> {
      return mutate(async (state) => {
        const timestamp = now().toISOString();
        let count = 0;
        const records = state.records.map((record) => {
          const active = record.attempts.filter((attempt) =>
            attempt.state === "active"
            && (
              attempt.assistantAcceptance?.state !== "preparing"
              || hasRequiredSettlementAssistantAcceptanceFence(
                record,
                attempt.attempt,
              )
            ),
          );
          if (active.length === 0) return record;
          count += active.length;
          return {
            ...record,
            revision: record.revision + 1,
            updatedAt: timestamp,
            attempts: record.attempts.map((attempt) => {
              if (
                attempt.state !== "active"
                || (
                  attempt.assistantAcceptance?.state === "preparing"
                  && !hasRequiredSettlementAssistantAcceptanceFence(
                    record,
                    attempt.attempt,
                  )
                )
              ) return attempt;
              const controlSequence = attempt.controlSequence + 1;
              return {
                ...attempt,
                state: "interrupted" as const,
                controlSequence,
                eventFingerprint: fingerprintConversationAttemptControl({
                  requestId: record.requestId,
                  turnId: record.turnId,
                  attempt: attempt.attempt,
                  controlSequence,
                  state: "interrupted",
                }),
                updatedAt: timestamp,
              };
            }),
          };
        });
        if (count > 0) await writeState({ ...state, records });
        return count;
      });
    },

    async createApprovalIntent(intent: ToolApprovalIntent): Promise<ConversationCausalMutationResult<ToolApprovalIntent>> {
      return mutate(async (state) => {
        const safeIntent: ToolApprovalIntent = {
          ...structuredClone(intent),
          taskName: sanitizeToolApprovalIntentLabel(intent.taskName),
          safeArgsSummary: sanitizeToolApprovalIntentSummary(intent.safeArgsSummary),
        };
        const existing = state.approvals.find((approval) => approval.id === safeIntent.id);
        if (existing) {
          return {
            disposition:
              isDeepStrictEqual(existing, safeIntent)
                ? "duplicate"
                : "conflict",
            value: structuredClone(existing),
          };
        }
        if (
          safeIntent.schemaVersion !== CONVERSATION_CAUSAL_SCHEMA_VERSION
          || safeIntent.state !== "pending"
          || safeIntent.revision !== 1
          || !hasConsistentToolApprovalInvocationIdentity(safeIntent.causalRef)
        ) {
          return { disposition: "conflict" };
        }
        await writeState({ ...state, approvals: [...state.approvals, safeIntent] });
        return { disposition: "applied", value: structuredClone(safeIntent) };
      });
    },

    async createApprovalIntentAndLink(input: {
      requestId: string;
      intent: ToolApprovalIntent;
    }): Promise<ConversationCausalMutationResult<{
      intent: ToolApprovalIntent;
      request: ConversationCausalRecord;
    }>> {
      return mutate(async (state) => {
        const request = state.records.find(
          (record) => record.requestId === input.requestId,
        );
        if (!request) return { disposition: "not_found" };
        const safeIntent: ToolApprovalIntent = {
          ...structuredClone(input.intent),
          taskName: sanitizeToolApprovalIntentLabel(input.intent.taskName),
          safeArgsSummary: sanitizeToolApprovalIntentSummary(
            input.intent.safeArgsSummary,
          ),
        };
        if (
          safeIntent.schemaVersion !== CONVERSATION_CAUSAL_SCHEMA_VERSION
          || safeIntent.state !== "pending"
          || safeIntent.revision !== 1
          || safeIntent.causalRef.requestId !== input.requestId
          || !hasConsistentToolApprovalInvocationIdentity(safeIntent.causalRef)
        ) {
          return { disposition: "conflict" };
        }

        const existingIntent = state.approvals.find(
          (approval) => approval.id === safeIntent.id,
        );
        const linkedRequest = state.records.find((record) =>
          record.refs.some(
            (ref) => ref.kind === "approval" && ref.id === safeIntent.id,
          ),
        );
        if (existingIntent || linkedRequest) {
          if (
            existingIntent
            && linkedRequest?.requestId === request.requestId
            && isDeepStrictEqual(existingIntent, safeIntent)
          ) {
            return {
              disposition: "duplicate",
              value: {
                intent: structuredClone(existingIntent),
                request: structuredClone(request),
              },
            };
          }
          return { disposition: "conflict" };
        }

        const timestamp = now().toISOString();
        const nextRequest: ConversationCausalRecord = {
          ...request,
          revision: request.revision + 1,
          refs: mergeConversationCausalRefs(request.refs, [
            { kind: "approval", id: safeIntent.id },
          ]),
          updatedAt: timestamp,
        };
        await writeState({
          ...state,
          records: state.records.map((record) =>
            record.requestId === request.requestId ? nextRequest : record,
          ),
          approvals: [...state.approvals, safeIntent],
        });
        return {
          disposition: "applied",
          value: {
            intent: structuredClone(safeIntent),
            request: structuredClone(nextRequest),
          },
        };
      });
    },

    async getApprovalIntent(id: string): Promise<ToolApprovalIntent | null> {
      const state = await mutationQueue.then(() => readState());
      const intent = state.approvals.find((approval) => approval.id === id);
      return intent ? structuredClone(intent) : null;
    },

    async listPendingApprovalIntents(ownerProcessEpoch?: string): Promise<ToolApprovalIntent[]> {
      const state = await mutationQueue.then(() => readState());
      return state.approvals
        .filter((approval) =>
          approval.state === "pending"
          && (!ownerProcessEpoch || approval.ownerProcessEpoch === ownerProcessEpoch),
        )
        .map((approval) => structuredClone(approval));
    },

    async decideApproval(input: {
      id: string;
      expectedRevision: number;
      decision: ToolApprovalIntentDecision;
    }): Promise<ConversationCausalMutationResult<ToolApprovalIntent>> {
      return mutate(async (state) => {
        const existing = state.approvals.find((approval) => approval.id === input.id);
        if (!existing) return { disposition: "not_found" };
        if (existing.state !== "pending") {
          const duplicate = existing.decision?.decisionId === input.decision.decisionId
            && existing.decision.outcome === input.decision.outcome;
          return {
            disposition: duplicate ? "duplicate" : "conflict",
            value: structuredClone(existing),
          };
        }
        if (input.expectedRevision !== existing.revision) {
          return { disposition: "conflict", value: structuredClone(existing) };
        }
        const next: ToolApprovalIntent = {
          ...existing,
          revision: existing.revision + 1,
          state: input.decision.outcome,
          decision: structuredClone(input.decision),
          updatedAt: input.decision.decidedAt,
        };
        await writeState({
          ...state,
          approvals: state.approvals.map((approval) =>
            approval.id === existing.id ? next : approval,
          ),
        });
        return { disposition: "applied", value: structuredClone(next) };
      });
    },

    async interruptPriorProcessPending(input: {
      currentProcessEpoch: string;
      decidedAt?: string;
    }): Promise<ToolApprovalIntent[]> {
      return mutate(async (state) => {
        const decidedAt = input.decidedAt ?? now().toISOString();
        const interrupted: ToolApprovalIntent[] = [];
        const approvals = state.approvals.map((approval) => {
          if (
            approval.state !== "pending"
            || approval.ownerProcessEpoch === input.currentProcessEpoch
          ) {
            return approval;
          }
          const decision: ToolApprovalIntentDecision = {
            decisionId: `startup-interrupt:${input.currentProcessEpoch}:${approval.id}`,
            outcome: "interrupted",
            automatic: true,
            reasonCode: "main_process_restarted",
            decidedAt,
          };
          const next: ToolApprovalIntent = {
            ...approval,
            revision: approval.revision + 1,
            state: "interrupted",
            decision,
            updatedAt: decidedAt,
          };
          interrupted.push(next);
          return next;
        });
        if (interrupted.length > 0) await writeState({ ...state, approvals });
        return interrupted.map((intent) => structuredClone(intent));
      });
    },
  };
}

function emptyState(): StoredConversationCausalState {
  return {
    schemaVersion: CONVERSATION_CAUSAL_SCHEMA_VERSION,
    records: [],
    approvals: [],
  };
}

function replaceAttempt(
  record: ConversationCausalRecord,
  attempt: ConversationCausalAttempt,
  updatedAt: string,
): ConversationCausalRecord {
  return {
    ...record,
    revision: record.revision + 1,
    attempts: record.attempts.map((candidate) =>
      candidate.attempt === attempt.attempt ? attempt : candidate,
    ),
    updatedAt,
  };
}

function isLatestActiveAttempt(
  record: ConversationCausalRecord,
  attempt: number,
): boolean {
  const latest = record.attempts.at(-1);
  return latest?.attempt === attempt && latest.state === "active";
}

function hasIrreversibleAssistantAcceptanceFence(
  record: ConversationCausalRecord,
  attempt: number,
): boolean {
  return (record.requiredSettlements ?? []).some((settlement) =>
    settlement.attempt === attempt
    && (
      settlement.state === "failed"
      || (
        settlement.state === "committed"
        && (
          settlement.targetState === "failed"
          || settlement.targetState === "canceled"
        )
      )
    ),
  );
}

function hasRequiredSettlementAssistantAcceptanceFence(
  record: ConversationCausalRecord,
  attempt: number,
): boolean {
  return (record.requiredSettlements ?? []).some((settlement) =>
    settlement.attempt === attempt
    && (
      settlement.state === "preparing"
      || settlement.state === "failed"
      || (
        settlement.state === "committed"
        && (
          settlement.targetState === "failed"
          || settlement.targetState === "canceled"
        )
      )
    ),
  );
}
