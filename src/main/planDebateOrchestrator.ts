import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type {
  ClaimLedgerItem,
  CreatePlanInput,
  DebateCritique,
  DebateRound,
  DebateRoundKind,
  FrozenPlanModelAssignments,
  PlanArtifact,
  PlanEvidenceItem,
  PlanModelAssignments,
  PlanOperationResult,
  PlanProposal,
  PlanRecord,
  PlanRevisionDecision,
  PlanRisk,
  PlanTaskContract,
  RevisedPlanProposal,
} from "../shared/planMode";
import { DEBATE_SEQUENCE } from "../shared/planMode";
import {
  assertValidPlanRoundShape,
  parseUniquePlanRoundObject,
} from "../shared/planStructuredOutput";
import { validatePlanMilestoneGraph } from "../shared/planValidation";
import { throwForModelServiceNotice } from "../shared/modelServiceNotice";
import type {
  ChatCompletionResponse,
  ChatMessage,
} from "./openAiCompatibleClient";
import type { BoundModelClient, ModelRouter } from "./providers/modelRouter";
import type { PlanArtifactWriter } from "./planArtifactWriter";
import { renderPlanMarkdown } from "./planArtifactWriter";
import type { PlanStore } from "./planStore";

const MAX_PLAN_SOURCE_CHARS = 32_000;
const MAX_CLARIFICATION_CHARS = 4_000;
const MAX_CLARIFICATION_HISTORY_CHARS = 12_000;
const MAX_CLARIFICATION_COUNT = 12;
const MAX_SKILL_PLANNING_BODY_CHARS = 24_000;

export type PlanDebateOrchestrator = {
  createPlan(input: CreatePlanInput): Promise<PlanRecord>;
  getInputRoutingPlan(sessionId: string): Promise<PlanRecord | null>;
  continueWithInput(
    planId: string,
    userInput: string,
    signal?: AbortSignal,
  ): Promise<PlanOperationResult>;
  retryFailedRound(
    planId: string,
    replacementProfileId?: string,
    signal?: AbortSignal,
  ): Promise<PlanOperationResult>;
  discard(planId: string, expectedRevision: number): Promise<PlanOperationResult>;
};

export function createPlanDebateOrchestrator(options: {
  planStore: PlanStore;
  artifactWriter: PlanArtifactWriter;
  modelRouter: ModelRouter;
  now?: () => string;
  createId?: () => string;
  collectEvidence?: (
    input: CreatePlanInput,
  ) => Promise<PlanEvidenceItem[]>;
}): PlanDebateOrchestrator {
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? (() => randomUUID());
  const collectEvidence =
    options.collectEvidence ?? collectBoundedWorkspaceEvidence;

  async function createPlan(input: CreatePlanInput): Promise<PlanRecord> {
    const createdAt = now();
    const baseSourceMessage = normalizePlanSource(input.sourceMessage);
    const normalizedInput = { ...input, sourceMessage: baseSourceMessage };
    const evidence = await collectEvidence(normalizedInput);
    const taskContract = buildTaskContract(baseSourceMessage, evidence);
    const clients = await resolveClients(input.mode, input.modelAssignments ?? {});
    const frozenModelAssignments = freezeBindings(clients);
    let record = await options.planStore.create({
      id: `plan_${createId()}`,
      sessionId: input.sessionId,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
      sourceMessage: baseSourceMessage,
      baseSourceMessage,
      clarifications: [],
      ...(input.selectedSkill
        ? { selectedSkill: snapshotSelectedSkill(input.selectedSkill) }
        : {}),
      mode: input.mode,
      status: "drafting",
      actionGate: "blocked",
      revision: 1,
      taskContract,
      evidence,
      requestedModelAssignments: { ...(input.modelAssignments ?? {}) },
      frozenModelAssignments,
      rounds: [],
      createdAt,
      updatedAt: createdAt,
    });

    return runFrom(record, clients, 0, input.signal);
  }

  async function runFrom(
    initial: PlanRecord,
    clients: ClientAssignments,
    startIndex: number,
    signal?: AbortSignal,
  ): Promise<PlanRecord> {
    let record = initial;
    const sequence: DebateRoundKind[] =
      record.mode === "direct" ? ["direct"] : DEBATE_SEQUENCE;

    for (let index = startIndex; index < sequence.length; index += 1) {
      const kind = sequence[index]!;
      await persistCancellationIfAborted(record, signal, {
        beforeRound: kind,
      });
      const client = clientForRound(kind, clients);
      const round: DebateRound = {
        id: `plan_round_${createId()}`,
        kind,
        role: roleForRound(kind),
        ordinal: ordinalForRound(kind),
        runId: `plan_run_${createId()}`,
        modelBinding: structuredClone(client.binding),
        status: "running",
        publicInputRefs: publicInputRefs(record, kind),
        startedAt: now(),
      };
      const existingRoundIndex = record.rounds.findIndex(
        (candidate) => candidate.kind === kind && candidate.status !== "invalidated",
      );
      const rounds =
        existingRoundIndex >= 0
          ? record.rounds.map((candidate, candidateIndex) =>
              candidateIndex === existingRoundIndex ? round : candidate,
            )
          : [...record.rounds, round];
      record = await options.planStore.save(
        { ...record, rounds, status: "drafting" },
        record.revision,
        "round_started",
        { kind, runId: round.runId },
      );
      const startedAtMs = Date.now();

      try {
        const response = await completeStructuredRound(
          client,
          kind,
          buildRoundPrompt(record, kind),
          signal,
        );
        const completedRound: DebateRound = {
          ...round,
          status: "completed",
          output: response.output,
          completedAt: now(),
          latencyMs: Math.max(0, Date.now() - startedAtMs),
          ...(response.usage ? { usage: response.usage } : {}),
        };
        record = await options.planStore.save(
          {
            ...record,
            rounds: record.rounds.map((candidate) =>
              candidate.id === round.id ? completedRound : candidate,
            ),
          },
          record.revision,
          "round_completed",
          { kind, runId: round.runId },
        );
      } catch (error) {
        if (signal?.aborted) {
          await options.planStore.save(
            {
              ...record,
              status: "canceled",
              actionGate: "blocked",
              rounds: record.rounds.map((candidate) =>
                candidate.id === round.id
                  ? {
                      ...candidate,
                      status: "invalidated" as const,
                      completedAt: now(),
                      latencyMs: Math.max(0, Date.now() - startedAtMs),
                    }
                  : candidate,
              ),
            },
            record.revision,
            "plan_canceled",
            { kind, runId: round.runId },
          );
          throw error;
        }
        const failedRound: DebateRound = {
          ...round,
          status: "failed",
          error:
            error instanceof Error ? error.message : "规划模型调用失败。",
          completedAt: now(),
          latencyMs: Math.max(0, Date.now() - startedAtMs),
        };
        return options.planStore.save(
          {
            ...record,
            status: "paused",
            actionGate: "blocked",
            rounds: record.rounds.map((candidate) =>
              candidate.id === round.id ? failedRound : candidate,
            ),
          },
          record.revision,
          "round_failed",
          { kind, runId: round.runId },
        );
      }
      await persistCancellationIfAborted(record, signal, {
        afterRound: kind,
      });
    }

    await persistCancellationIfAborted(record, signal, {
      beforeSynthesis: true,
    });
    const finalRound = latestCompletedRound(
      record,
      record.mode === "direct" ? "direct" : "c",
    );
    if (!finalRound?.output) {
      return options.planStore.save(
        {
          ...record,
          status: "failed",
          actionGate: "blocked",
        },
        record.revision,
        "plan_failed",
      );
    }
    const artifact = applyDeterministicGate(
      normalizePlanArtifact(finalRound.output),
    );
    if (!record.workspaceRoot) {
      const waitingForWorkspace = await options.planStore.save(
        {
          ...record,
          finalArtifact: {
            ...artifact,
            actionGate: "needs_input",
            gateReason: "必须选择工作区后才能生成和确认计划投影。",
          },
          status: "awaiting_input",
          actionGate: "needs_input",
        },
        record.revision,
        "plan_waiting_for_workspace",
      );
      await persistCancellationIfAborted(waitingForWorkspace, signal, {
        afterSynthesis: true,
      });
      return waitingForWorkspace;
    }

    await persistCancellationIfAborted(record, signal, {
      beforeProjection: true,
    });
    const projectedRevision = record.revision + 1;
    const projectedPlan = { ...record, revision: projectedRevision };
    const canonicalArtifact = {
      ...artifact,
      markdown: renderPlanMarkdown(projectedPlan, artifact),
    };
    const projection = await options.artifactWriter.write(
      projectedPlan,
      canonicalArtifact,
    );
    await persistCancellationIfAborted(record, signal, {
      afterProjection: true,
    });
    const synthesized = await options.planStore.save(
      {
        ...record,
        finalArtifact: canonicalArtifact,
        projection,
        status:
          canonicalArtifact.actionGate === "ready"
            ? "awaiting_confirmation"
            : canonicalArtifact.actionGate === "needs_input"
              ? "awaiting_input"
              : "paused",
        actionGate: canonicalArtifact.actionGate,
      },
      record.revision,
      "plan_synthesized",
      { actionGate: canonicalArtifact.actionGate },
    );
    await persistCancellationIfAborted(synthesized, signal, {
      afterSynthesis: true,
    });
    return synthesized;
  }

  async function persistCancellationIfAborted(
    record: PlanRecord,
    signal: AbortSignal | undefined,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!signal?.aborted) {
      return;
    }
    await options.planStore.save(
      {
        ...record,
        status: "canceled",
        actionGate: "blocked",
      },
      record.revision,
      "plan_canceled",
      payload,
    );
    throwIfAborted(signal);
  }

  async function resolveClients(
    mode: "direct" | "debate",
    assignments: PlanModelAssignments,
  ): Promise<ClientAssignments> {
    if (mode === "direct") {
      return {
        direct: await options.modelRouter.resolve(assignments.direct),
      };
    }
    const a = await options.modelRouter.resolve(assignments.a);
    const b = await options.modelRouter.resolve(assignments.b);
    const c = await options.modelRouter.resolve(assignments.c);
    return { a, b, c };
  }

  async function resolveRetryClients(
    plan: PlanRecord,
    replacementRole: "direct" | "a" | "b" | "c",
    replacementProfileId?: string,
  ): Promise<ClientAssignments> {
    const roles =
      plan.mode === "direct"
        ? (["direct"] as const)
        : (["a", "b", "c"] as const);
    const clients: ClientAssignments = {};
    for (const role of roles) {
      if (role === replacementRole && replacementProfileId) {
        clients[role] = await options.modelRouter.resolve(replacementProfileId);
        continue;
      }
      const frozen = plan.frozenModelAssignments[role];
      clients[role] = frozen
        ? await options.modelRouter.resolveFrozen(frozen)
        : await options.modelRouter.resolve(
            plan.requestedModelAssignments[role],
          );
    }
    return clients;
  }

  return {
    createPlan,

    async getInputRoutingPlan(sessionId) {
      const latest = await options.planStore.getLatestBySession(sessionId);
      if (!latest || latest.executionGoalId) {
        return null;
      }
      return [
        "drafting",
        "paused",
        "awaiting_input",
        "awaiting_confirmation",
        "canceled",
        "failed",
      ].includes(latest.status)
        ? latest
        : null;
    },

    async continueWithInput(planId, userInput, signal) {
      const existing = await options.planStore.get(planId);
      if (!existing) {
        return { ok: false, message: "计划不存在。" };
      }
      const isRevisable =
        existing.status === "awaiting_input" ||
        existing.status === "awaiting_confirmation" ||
        (existing.status === "paused" && Boolean(existing.finalArtifact));
      if (!isRevisable || existing.executionGoalId) {
        return {
          ok: false,
          message: "当前计划不能通过补充信息重新规划。",
          plan: existing,
        };
      }
      const clarification = userInput.trim();
      if (!clarification) {
        return {
          ok: false,
          message: "补充信息不能为空。",
          plan: existing,
        };
      }
      if (clarification.length > MAX_CLARIFICATION_CHARS) {
        return {
          ok: false,
          message: `单次补充信息不能超过 ${MAX_CLARIFICATION_CHARS} 个字符。`,
          plan: existing,
        };
      }
      throwIfAborted(signal);
      const baseSourceMessage = normalizePlanSource(
        existing.baseSourceMessage ?? existing.sourceMessage,
      );
      const clarifications = appendBoundedClarification(
        existing.clarifications ?? [],
        clarification,
      );
      const sourceMessage = formatPlanSource(baseSourceMessage, clarifications);
      const continuationInput: CreatePlanInput = {
        sessionId: existing.sessionId,
        ...(existing.workspaceId ? { workspaceId: existing.workspaceId } : {}),
        ...(existing.workspaceRoot
          ? { workspaceRoot: existing.workspaceRoot }
          : {}),
        sourceMessage,
        ...(existing.selectedSkill
          ? { selectedSkill: snapshotSelectedSkill(existing.selectedSkill) }
          : {}),
        mode: existing.mode,
        modelAssignments: existing.requestedModelAssignments,
        ...(signal ? { signal } : {}),
      };
      const evidence = await collectEvidence(continuationInput);
      const clients = await resolveRetryClients(
        existing,
        existing.mode === "direct" ? "direct" : "a",
      );
      const invalidatedRounds = existing.rounds.map((round) =>
        round.status === "invalidated"
          ? round
          : { ...round, status: "invalidated" as const },
      );
      let reset = await options.planStore.save(
        {
          ...existing,
          sourceMessage,
          taskContract: buildTaskContract(sourceMessage, evidence),
          evidence,
          baseSourceMessage,
          clarifications,
          frozenModelAssignments: freezeBindings(clients),
          rounds: invalidatedRounds,
          status: "drafting",
          actionGate: "blocked",
          finalArtifact: undefined,
          projection: undefined,
        },
        existing.revision,
        "plan_input_received",
        {
          inputLength: clarification.length,
          inputSha256: hash(clarification),
        },
      );
      reset = await runFrom(reset, clients, 0, signal);
      return {
        ok: true,
        plan: reset,
        message:
          reset.status === "awaiting_confirmation"
            ? "已根据补充信息重新生成计划，等待确认。"
            : reset.status === "awaiting_input"
              ? "已根据补充信息重新规划，仍有必要信息需要补充。"
              : "已根据补充信息重新规划，请检查当前门禁状态。",
      };
    },

    async retryFailedRound(planId, replacementProfileId, signal) {
      const existing = await options.planStore.get(planId);
      if (!existing) {
        return { ok: false, message: "计划不存在。" };
      }
      const failed = existing.rounds.find((round) => round.status === "failed");
      if (!failed) {
        return { ok: false, message: "计划没有可重试的失败轮次。", plan: existing };
      }
      const sequence =
        existing.mode === "direct" ? ["direct" as const] : DEBATE_SEQUENCE;
      const startIndex = sequence.indexOf(failed.kind);
      if (startIndex < 0) {
        return { ok: false, message: "失败轮次不属于当前协议。", plan: existing };
      }
      const role = roleForRound(failed.kind);
      const requested = { ...existing.requestedModelAssignments };
      if (replacementProfileId) {
        requested[role] = replacementProfileId;
      }
      const clients = await resolveRetryClients(
        existing,
        role,
        replacementProfileId,
      );
      const activeKinds = new Set(sequence.slice(startIndex));
      const invalidatedRounds = existing.rounds.map((round) =>
        activeKinds.has(round.kind)
          ? { ...round, status: "invalidated" as const }
          : round,
      );
      let reset = await options.planStore.save(
        {
          ...existing,
          requestedModelAssignments: requested,
          frozenModelAssignments: freezeBindings(clients),
          rounds: invalidatedRounds,
          status: "drafting",
          actionGate: "blocked",
          finalArtifact: undefined,
          projection: undefined,
        },
        existing.revision,
        "round_retry_requested",
        { kind: failed.kind, replacementProfileId },
      );
      reset = await runFrom(reset, clients, startIndex, signal);
      return {
        ok: true,
        plan: reset,
        message:
          reset.status === "paused"
            ? "轮次重试仍然失败，计划保持暂停。"
            : "已从失败轮次继续规划。",
      };
    },

    async discard(planId, expectedRevision) {
      const existing = await options.planStore.get(planId);
      if (!existing) {
        return { ok: false, message: "计划不存在。" };
      }
      if (
        existing.executionGoalId ||
        existing.executionRunId ||
        existing.status === "executing" ||
        existing.status === "completed" ||
        existing.status === "confirmed_pending_execution"
      ) {
        return { ok: false, message: "计划已经进入执行，不能丢弃。", plan: existing };
      }
      if (existing.revision !== expectedRevision) {
        return { ok: false, message: "计划版本已变化，请刷新后重试。", plan: existing };
      }
      const discarded = await options.planStore.save(
        { ...existing, status: "discarded", actionGate: "blocked" },
        existing.revision,
        "plan_discarded",
      );
      return { ok: true, plan: discarded, message: "计划已丢弃，未开始执行。" };
    },
  };
}

type ClientAssignments = Partial<
  Record<"direct" | "a" | "b" | "c", BoundModelClient>
>;

function freezeBindings(
  clients: ClientAssignments,
): FrozenPlanModelAssignments {
  return Object.fromEntries(
    Object.entries(clients).map(([role, client]) => [
      role,
      structuredClone(client!.binding),
    ]),
  ) as FrozenPlanModelAssignments;
}

function clientForRound(
  kind: DebateRoundKind,
  clients: ClientAssignments,
): BoundModelClient {
  const client = clients[roleForRound(kind)];
  if (!client) {
    throw new Error(`轮次 ${kind} 没有绑定模型。`);
  }
  return client;
}

function roleForRound(kind: DebateRoundKind): "direct" | "a" | "b" | "c" {
  if (kind === "direct") return "direct";
  if (kind === "a1" || kind === "a2") return "a";
  if (kind === "b1" || kind === "b2") return "b";
  return "c";
}

function ordinalForRound(kind: DebateRoundKind): number {
  if (kind === "a2" || kind === "b2") return 2;
  return 1;
}

function publicInputRefs(record: PlanRecord, kind: DebateRoundKind): string[] {
  const allowed: Record<DebateRoundKind, DebateRoundKind[]> = {
    direct: [],
    a1: [],
    b1: ["a1"],
    a2: ["a1", "b1"],
    b2: ["a1", "b1", "a2"],
    c: ["a1", "b1", "a2", "b2"],
  };
  return record.rounds
    .filter(
      (round) =>
        round.status === "completed" && allowed[kind].includes(round.kind),
    )
    .map((round) => round.id);
}

function buildRoundPrompt(
  record: PlanRecord,
  kind: DebateRoundKind,
): { system: string; user: string } {
  const common = {
    taskContract: record.taskContract,
    evidence: record.evidence,
  };
  const outputs = Object.fromEntries(
    record.rounds
      .filter((round) => round.status === "completed" && round.output)
      .map((round) => [round.kind, round.output]),
  );
  const instruction: Record<DebateRoundKind, string> = {
    direct:
      "独立产出终版项目推进计划。返回 PlanArtifact JSON，并给出 actionGate、gateReason、claimLedger、unresolvedQuestions、minorityOpinion。",
    a1:
      "作为方案提出者独立产出初版。返回 PlanProposal JSON，不得引用其他 Agent。",
    b1:
      "作为对抗审查者审阅 A1。返回 DebateCritique JSON，问题必须包含证据或反例和明确修改要求。",
    a2:
      "作为方案提出者逐项回应 B1 并修订方案。返回 RevisedPlanProposal JSON，包含 decisions。",
    b2:
      "进行终局对抗复核。返回 DebateCritique JSON，保留未解决风险和少数意见。",
    c:
      "作为匿名独立综合者，根据公开结构化记录生成唯一终版 PlanArtifact JSON。不得讨论模型身份，不得输出隐藏推理。",
  };
  return {
    system: [
      "你处于 Zerox Agent Plan Mode。",
      "只返回一个 JSON 对象，不使用 Markdown 代码围栏。",
      "输出公开、可审计的结论和证据引用，不输出思维链或私有推理。",
      "unresolvedQuestions 只允许包含必须由用户现在回答、否则会实质改变目标或验收结果的问题。可以由执行 Agent 从工作区调查、在里程碑中验证或按最佳判断决定的实现细节，必须写入 assumptions、dependencies 或 risks，不得因此设置 needs_input。用户明确授权“自行决定”时，必须作出合理假设并继续。",
      instruction[kind],
      "字段名必须严格使用下面结构中的英文名称；不要把结果包装在 result、output、plan 或 proposal 字段中。",
      JSON.stringify(roundOutputTemplate(kind)),
    ].join("\n"),
    user: JSON.stringify({
      ...common,
      ...(kind === "direct" || kind === "a1" ? {} : { publicOutputs: outputs }),
    }),
  };
}

async function completeStructuredRound(
  bound: BoundModelClient,
  kind: DebateRoundKind,
  prompt: { system: string; user: string },
  signal?: AbortSignal,
): Promise<{
  output: PlanProposal | RevisedPlanProposal | DebateCritique | PlanArtifact;
  usage?: { inputTokens: number; outputTokens: number };
}> {
  const baseMessages: ChatMessage[] = [
    { role: "system", content: prompt.system },
    { role: "user", content: prompt.user },
  ];
  let messages = baseMessages;
  let inputTokens = 0;
  let outputTokens = 0;
  let hasUsage = false;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await bound.client.complete({
      baseUrl: bound.binding.baseUrl ?? "",
      apiKey: "",
      model: bound.binding.modelId,
      temperature: bound.binding.generation.temperature,
      maxTokens: bound.binding.generation.maxTokens,
      thinking: { type: "disabled" },
      messages,
      ...(signal ? { signal } : {}),
    });
    if (response.usage) {
      hasUsage = true;
      inputTokens += response.usage.inputTokens;
      outputTokens += response.usage.outputTokens;
    }
    throwForModelServiceNotice(response.modelServiceNotice);
    try {
      if (!response.content?.trim()) {
        throw new Error("规划模型没有返回结构化内容。");
      }
      const output = parseUniquePlanRoundObject(response.content, (value) =>
        normalizeRoundOutput(kind, value),
      );
      return {
        output,
        ...(hasUsage ? { usage: { inputTokens, outputTokens } } : {}),
      };
    } catch (error) {
      if (attempt === 1) {
        throw structuredRoundFailure(error, response);
      }
      messages = [
        ...baseMessages,
        ...(response.content?.trim()
          ? [
              {
                role: "assistant" as const,
                content: response.content.slice(0, 16_000),
              },
            ]
          : []),
        {
          role: "user",
          content: buildStructuredRepairPrompt(kind, error),
        },
      ];
    }
  }
  throw new Error("规划模型结构化输出修复未完成。");
}

function buildStructuredRepairPrompt(
  kind: DebateRoundKind,
  error: unknown,
): string {
  const reason =
    error instanceof Error ? error.message : "响应未通过结构化合同校验。";
  return [
    "上一条响应未通过结构化合同校验。把本次调用视为同一轮的格式修复，不是新的方案发言。",
    `校验失败：${reason}`,
    "只返回一个 JSON 对象；不要输出解释、Markdown、XML、前后缀或代码围栏。",
    "字段名必须严格使用以下英文结构，不得包装在 result、output、plan 或 proposal 字段中：",
    JSON.stringify(roundOutputTemplate(kind)),
  ].join("\n");
}

function structuredRoundFailure(
  error: unknown,
  response: ChatCompletionResponse,
): Error {
  const reason =
    error instanceof Error ? error.message : "响应未通过结构化合同校验。";
  const content = response.content ?? "";
  const diagnostics = [
    `finishReason=${response.finishReason || "unknown"}`,
    `contentLength=${content.length}`,
    `contentSha256=${content ? hash(content).slice(0, 16) : "empty"}`,
    `reasoningOnly=${Boolean(response.reasoningContent && !content.trim())}`,
    `inputTokens=${response.usage?.inputTokens ?? "unknown"}`,
    `outputTokens=${response.usage?.outputTokens ?? "unknown"}`,
  ].join(", ");
  return new Error(
    `规划模型连续两次未返回可用 JSON 对象。最后错误：${reason}（${diagnostics}）。`,
  );
}

function normalizeRoundOutput(
  kind: DebateRoundKind,
  value: Record<string, unknown>,
): PlanProposal | RevisedPlanProposal | DebateCritique | PlanArtifact {
  const unwrapped = unwrapRoundOutput(kind, value);
  assertValidPlanRoundShape(kind, unwrapped);
  if (kind === "b1" || kind === "b2") {
    return normalizeCritique(unwrapped);
  }
  if (kind === "a2") {
    return {
      ...normalizeProposal(unwrapped),
      decisions: array(unwrapped.decisions).map(normalizeDecision),
    };
  }
  if (kind === "direct" || kind === "c") {
    return normalizeArtifact(unwrapped);
  }
  return normalizeProposal(unwrapped);
}

function normalizeProposal(value: Record<string, unknown>): PlanProposal {
  const scope = record(value.scope);
  const milestones = array(value.milestones).map((candidate, index) => {
    const item = record(candidate);
    return {
      id: string(item.id) || `milestone_${index + 1}`,
      title: string(item.title) || `里程碑 ${index + 1}`,
      description: string(item.description),
      acceptanceCriteria: strings(item.acceptanceCriteria),
      dependencies: strings(item.dependencies),
    };
  });
  const proposal: PlanProposal = {
    title: string(value.title) || "执行计划",
    summary: string(value.summary),
    objective: string(value.objective),
    scope: {
      in: strings(scope.in),
      out: strings(scope.out),
    },
    assumptions: strings(value.assumptions),
    milestones,
    dependencies: strings(value.dependencies),
    risks: array(value.risks).map(normalizeRisk),
    acceptanceCriteria: strings(value.acceptanceCriteria),
  };
  validatePlanMilestoneGraph(proposal.milestones);
  return proposal;
}

function unwrapRoundOutput(
  kind: DebateRoundKind,
  value: Record<string, unknown>,
): Record<string, unknown> {
  if (matchesRoundShape(kind, value)) {
    return value;
  }
  const preferredKeys: Record<DebateRoundKind, string[]> = {
    direct: ["planArtifact", "artifact", "plan", "output", "result"],
    a1: ["planProposal", "proposal", "plan", "output", "result"],
    b1: ["debateCritique", "critique", "review", "output", "result"],
    a2: [
      "revisedPlanProposal",
      "revisedProposal",
      "proposal",
      "plan",
      "output",
      "result",
    ],
    b2: ["debateCritique", "critique", "review", "output", "result"],
    c: ["planArtifact", "artifact", "plan", "output", "result"],
  };
  for (const key of preferredKeys[kind]) {
    const candidate = record(value[key]);
    if (matchesRoundShape(kind, candidate)) {
      return candidate;
    }
  }
  const matchingChildren = Object.values(value)
    .map(record)
    .filter((candidate) => matchesRoundShape(kind, candidate));
  return matchingChildren.length === 1 ? matchingChildren[0]! : value;
}

function matchesRoundShape(
  kind: DebateRoundKind,
  value: Record<string, unknown>,
): boolean {
  if (kind === "b1" || kind === "b2") {
    return Array.isArray(value.issues) || Array.isArray(value.unresolvedRisks);
  }
  return Boolean(string(value.objective)) || Array.isArray(value.milestones);
}

function roundOutputTemplate(kind: DebateRoundKind): Record<string, unknown> {
  const proposal = {
    title: "计划标题",
    summary: "计划摘要",
    objective: "明确、可验证的目标",
    scope: { in: ["范围内事项"], out: ["范围外事项"] },
    assumptions: ["必要假设"],
    milestones: [
      {
        id: "milestone_1",
        title: "里程碑标题",
        description: "要完成的工作",
        acceptanceCriteria: ["可验证的完成标准"],
        dependencies: [],
      },
    ],
    dependencies: [],
    risks: [
      {
        id: "risk_1",
        severity: "medium",
        description: "风险描述",
        mitigation: "缓解措施",
        status: "open",
      },
    ],
    acceptanceCriteria: ["整体完成标准"],
  };
  if (kind === "a1") {
    return proposal;
  }
  if (kind === "a2") {
    return {
      ...proposal,
      decisions: [
        {
          issueId: "issue_1",
          decision: "accepted",
          reason: "接受、拒绝或部分接受的理由",
          changedSections: ["milestones"],
        },
      ],
    };
  }
  if (kind === "b1" || kind === "b2") {
    return {
      summary: "审查摘要",
      issues: [
        {
          id: "issue_1",
          target: "被质疑的计划部分",
          severity: "medium",
          claim: "问题或反方主张",
          evidenceOrCounterexample: "证据或反例",
          requestedChange: "明确修改要求",
          status: "open",
        },
      ],
      minorityOpinion: ["应保留的少数意见"],
      unresolvedRisks: [],
    };
  }
  return {
    ...proposal,
    claimLedger: [
      {
        id: "claim_1",
        claim: "终版计划采用的关键结论",
        evidenceRefs: ["evidence_user_request"],
        counterexamples: [],
        conditions: ["结论成立条件"],
        confidence: 0.8,
        status: "verified",
      },
    ],
    unresolvedQuestions: [],
    minorityOpinion: [],
    actionGate: "ready",
    gateReason: "允许或阻止确认的原因",
  };
}

function normalizeArtifact(value: Record<string, unknown>): PlanArtifact {
  const proposal = normalizeProposal(value);
  return {
    ...proposal,
    claimLedger: array(value.claimLedger).map(normalizeClaim),
    unresolvedQuestions: strings(value.unresolvedQuestions),
    minorityOpinion: strings(value.minorityOpinion),
    actionGate: normalizeGate(value.actionGate),
    gateReason: string(value.gateReason) || "终版计划已完成结构化复核。",
    markdown: "",
  };
}

function normalizePlanArtifact(
  value: PlanProposal | RevisedPlanProposal | DebateCritique | PlanArtifact,
): PlanArtifact {
  return normalizeArtifact(record(value));
}

function normalizeCritique(value: Record<string, unknown>): DebateCritique {
  return {
    summary: string(value.summary),
    issues: array(value.issues).map((candidate, index) => {
      const item = record(candidate);
      return {
        id: string(item.id) || `issue_${index + 1}`,
        target: string(item.target),
        severity: normalizeSeverity(item.severity),
        claim: string(item.claim),
        evidenceOrCounterexample: string(item.evidenceOrCounterexample),
        requestedChange: string(item.requestedChange),
        status: normalizeIssueStatus(item.status),
      };
    }),
    minorityOpinion: strings(value.minorityOpinion),
    unresolvedRisks: array(value.unresolvedRisks).map(normalizeRisk),
  };
}

function normalizeDecision(value: unknown): PlanRevisionDecision {
  const item = record(value);
  const decision =
    item.decision === "rejected" || item.decision === "partially_accepted"
      ? item.decision
      : "accepted";
  return {
    issueId: string(item.issueId),
    decision,
    reason: string(item.reason),
    changedSections: strings(item.changedSections),
  };
}

function normalizeRisk(value: unknown): PlanRisk {
  const item = record(value);
  return {
    id: string(item.id) || `risk_${hash(JSON.stringify(item)).slice(0, 8)}`,
    severity: normalizeSeverity(item.severity),
    description: string(item.description),
    mitigation: string(item.mitigation),
    status:
      item.status === "resolved" || item.status === "accepted"
        ? item.status
        : "open",
  };
}

function normalizeClaim(value: unknown, index: number): ClaimLedgerItem {
  const item = record(value);
  const confidence = Number(item.confidence);
  return {
    id: string(item.id) || `claim_${index + 1}`,
    claim: string(item.claim),
    evidenceRefs: strings(item.evidenceRefs),
    counterexamples: strings(item.counterexamples),
    conditions: strings(item.conditions),
    confidence: Number.isFinite(confidence)
      ? Math.max(0, Math.min(1, confidence))
      : 0.5,
    status:
      item.status === "verified" ||
      item.status === "contested" ||
      item.status === "rejected"
        ? item.status
        : "unverified",
  };
}

function applyDeterministicGate(artifact: PlanArtifact): PlanArtifact {
  const hasCriticalOpenRisk = artifact.risks.some(
    (risk) => risk.severity === "critical" && risk.status === "open",
  );
  if (hasCriticalOpenRisk) {
    return {
      ...artifact,
      actionGate: "blocked",
      gateReason: "存在未缓解的严重风险，不能进入执行。",
    };
  }
  if (artifact.unresolvedQuestions.length > 0) {
    return {
      ...artifact,
      actionGate: "needs_input",
      gateReason: "仍有需要用户回答的关键问题。",
    };
  }
  if (artifact.actionGate === "needs_input") {
    return {
      ...artifact,
      actionGate: "ready",
      gateReason: "没有必须由用户立即回答的关键问题，计划可以进入确认。",
    };
  }
  return artifact;
}

function buildTaskContract(
  sourceMessage: string,
  evidence: PlanEvidenceItem[],
): PlanTaskContract {
  return {
    objective: sourceMessage.trim(),
    audience: "提出需求并负责确认计划的 Zerox 用户",
    inScope: ["用户需求明确要求的交付", "完成交付所需的项目内变更与验证"],
    outOfScope: ["未经用户授权的外部发布、发送或生产环境变更"],
    constraints: [
      "确认前不得执行计划中的修改操作",
      "遵守工作区权限和项目设计规范",
      ...(evidence.length ? ["计划结论应引用已收集的工作区证据"] : []),
    ],
    successCriteria: [
      "计划可直接交给执行 Agent，无需补充实现决策",
      "里程碑包含可验证的验收标准",
    ],
    assumptions: [],
  };
}

function normalizePlanSource(sourceMessage: string): string {
  const normalized = sourceMessage.trim();
  if (!normalized) {
    throw new Error("计划需求不能为空。");
  }
  if (normalized.length > MAX_PLAN_SOURCE_CHARS) {
    throw new Error(`计划需求不能超过 ${MAX_PLAN_SOURCE_CHARS} 个字符。`);
  }
  return normalized;
}

function appendBoundedClarification(
  existing: string[],
  clarification: string,
): string[] {
  const candidates = [
    ...existing.map((item) => item.trim()).filter(Boolean),
    clarification,
  ].slice(-MAX_CLARIFICATION_COUNT);
  const bounded: string[] = [];
  let totalChars = 0;
  for (const item of [...candidates].reverse()) {
    if (totalChars + item.length > MAX_CLARIFICATION_HISTORY_CHARS) {
      continue;
    }
    bounded.unshift(item);
    totalChars += item.length;
  }
  return bounded;
}

function formatPlanSource(
  baseSourceMessage: string,
  clarifications: string[],
): string {
  if (clarifications.length === 0) {
    return baseSourceMessage;
  }
  return [
    baseSourceMessage,
    "用户补充信息（按时间顺序）：",
    ...clarifications.map((item, index) => `${index + 1}. ${item}`),
  ].join("\n\n");
}

function snapshotSelectedSkill(
  skill: NonNullable<CreatePlanInput["selectedSkill"]>,
): NonNullable<PlanRecord["selectedSkill"]> {
  return {
    rootDir: skill.rootDir,
    skillFile: skill.skillFile,
    body: skill.body,
    manifest: structuredClone(skill.manifest),
  };
}

async function collectBoundedWorkspaceEvidence(
  input: CreatePlanInput,
): Promise<PlanEvidenceItem[]> {
  const evidence: PlanEvidenceItem[] = [
    {
      id: "evidence_user_request",
      kind: "user",
      title: "用户需求",
      summary: input.sourceMessage.slice(0, 12_000),
    },
  ];
  if (input.selectedSkill) {
    const planningSummary = [
      `${input.selectedSkill.manifest.name}: ${input.selectedSkill.manifest.description}`,
      input.selectedSkill.body.slice(0, MAX_SKILL_PLANNING_BODY_CHARS),
    ].join("\n\n");
    evidence.push({
      id: "evidence_selected_skill",
      kind: "skill",
      title: `Selected Skill: ${input.selectedSkill.manifest.name}`,
      summary: planningSummary,
      sourceRef: input.selectedSkill.skillFile,
      sha256: hash(
        JSON.stringify(input.selectedSkill.manifest) + input.selectedSkill.body,
      ),
    });
  }
  if (!input.workspaceRoot) {
    return evidence;
  }
  let root: string;
  try {
    root = await realpath(input.workspaceRoot);
  } catch {
    return evidence;
  }
  try {
    const names = (await readdir(root))
      .filter((name) => name !== ".zerox")
      .sort()
      .slice(0, 80);
    const inventory = names.join("\n").slice(0, 8_000);
    evidence.push({
      id: "evidence_workspace_inventory",
      kind: "workspace",
      title: "工作区顶层清单",
      summary: inventory,
      sourceRef: root,
      sha256: hash(inventory),
    });
  } catch {
    return evidence;
  }
  const candidates = [
    "AGENTS.md",
    "README.md",
    "package.json",
    path.join(".zerox", "feature_list.json"),
  ];
  for (const relative of candidates) {
    try {
      const target = await realpath(path.join(root, relative));
      assertInsideWorkspace(root, target);
      const info = await stat(target);
      if (!info.isFile() || info.size > 512_000) continue;
      const content = await readFile(target, "utf8");
      evidence.push({
        id: `evidence_file_${hash(relative).slice(0, 12)}`,
        kind: "file",
        title: relative,
        summary: content.slice(0, 16_000),
        sourceRef: target,
        sha256: hash(content),
      });
    } catch {
      // Optional evidence files may not exist.
    }
  }
  try {
    const gitDir = await realpath(path.join(root, ".git"));
    assertInsideWorkspace(root, gitDir);
    const head = (await readFile(path.join(gitDir, "HEAD"), "utf8")).trim();
    let revision = head;
    if (head.startsWith("ref: ")) {
      const ref = head.slice("ref: ".length).trim();
      if (/^[a-zA-Z0-9_./-]+$/.test(ref) && !ref.includes("..")) {
        revision = `${head}\n${(
          await readFile(path.join(gitDir, ref), "utf8")
        ).trim()}`;
      }
    }
    evidence.push({
      id: "evidence_git_head",
      kind: "git",
      title: "Git HEAD",
      summary: revision,
      sourceRef: gitDir,
      sha256: hash(revision),
    });
  } catch {
    // A workspace does not need to be a Git repository.
  }
  return evidence;
}

function assertInsideWorkspace(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("计划证据路径越过工作区边界。");
  }
}

function latestCompletedRound(
  record: PlanRecord,
  kind: DebateRoundKind,
): DebateRound | null {
  return (
    [...record.rounds]
      .reverse()
      .find(
        (round) => round.kind === kind && round.status === "completed",
      ) ?? null
  );
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function string(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function strings(value: unknown): string[] {
  return array(value).map(string).filter(Boolean);
}

function normalizeSeverity(
  value: unknown,
): "low" | "medium" | "high" | "critical" {
  return value === "low" ||
    value === "high" ||
    value === "critical"
    ? value
    : "medium";
}

function normalizeIssueStatus(
  value: unknown,
): "open" | "accepted" | "rejected" | "resolved" {
  return value === "accepted" || value === "rejected" || value === "resolved"
    ? value
    : "open";
}

function normalizeGate(value: unknown): "ready" | "needs_input" | "blocked" {
  return value === "ready" || value === "needs_input" ? value : "blocked";
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("Plan canceled.", "AbortError");
  }
}
