// Checkpoint-writer fork actor (contracts v1.4 §5.3).
//
// Cold-reads the parent run's trajectory (ground truth, via P1 RunRepository),
// distills an 11-segment markdown-v1 checkpoint, and writes it via
// `CheckpointRepository.write(runId, "markdown", { source:"p5-fork" })`. The
// actor optionally calls the LLM (cache-aligned to the parent prefix); on any
// failure it falls back to the rule-based `buildGoalContinuityCheckpoint` so the
// writer is always reliable. P2's `RebuildFromCheckpoint` reads the result
// unchanged (it is source-agnostic).

import { buildGoalContinuityCheckpoint } from "../../shared/agentGoalContinuity";
import { NEVER_COMPACT_MARKER } from "../../shared/compactionMarkers";
import type { CheckpointRepository, RunRepository } from "../../shared/storageContract";
import type { Goal, ProgressLedgerEvent } from "../../shared/agentGoal";
import type { LLMProvider, CompleteRequest } from "../providers/provider";
import type { ActorOutcome, ForkContext, SpawnInput } from "./actorRuntime";

export interface CheckpointWriterActorDeps {
  runRepository: RunRepository;
  checkpointRepository: CheckpointRepository;
  provider?: LLMProvider;
  /** Goal + ledger for the rule-based fallback (and LLM context). */
  resolveGoal?: (parentRunId: string) => { goal: Goal; ledgerEvents: ProgressLedgerEvent[] } | null;
  apiKey?: string;
  model?: string;
  now?: () => string;
}

export async function runCheckpointWriterActor(
  input: SpawnInput,
  forkContext: ForkContext | undefined,
  cancel: AbortSignal,
  deps: CheckpointWriterActorDeps,
): Promise<ActorOutcome> {
  const parentRunId = forkContext?.parentRunId ?? input.parentRunId ?? "";
  if (!parentRunId) {
    return { status: "error", summary: "no parentRunId", filesTouched: [] };
  }
  const createdAt = (deps.now ?? (() => new Date().toISOString()))();

  try {
    // 1. Cold-read the transcript from frozenAt forward.
    const fromSeq = forkContext?.frozenAt ?? 0;
    const trajectory = deps.runRepository.getTrajectory(parentRunId, { fromSeq });
    const transcript = summarizeTrajectory(trajectory);

    // 2. Resolve goal + ledger for the rule-based fallback / LLM context.
    const goalCtx = deps.resolveGoal?.(parentRunId) ?? null;

    // 3. Produce the 11-segment content. Prefer LLM distillation (cache-aligned);
    //    fall back to rule-based extraction.
    let content: string;
    let cacheReadTokens: number | undefined;
    if (deps.provider && deps.apiKey && deps.model && forkContext) {
      try {
        const llmResult = await distillWithLlm(deps.provider, deps.model, deps.apiKey, forkContext, transcript, goalCtx, cancel);
        content = llmResult.content;
        cacheReadTokens = llmResult.cacheReadTokens;
        if (!isValidMarkdownV1(content, parentRunId)) {
          content = ruleBasedContent(parentRunId, goalCtx, createdAt);
        }
      } catch {
        content = ruleBasedContent(parentRunId, goalCtx, createdAt);
      }
    } else {
      content = ruleBasedContent(parentRunId, goalCtx, createdAt);
    }

    // 4. Write via CheckpointRepository (path-guarded).
    const ref = deps.checkpointRepository.write(parentRunId, "markdown", {
      format: "markdown-v1",
      content,
      ...(goalCtx?.goal.id ? { goalId: goalCtx.goal.id } : {}),
      segmentCount: 11,
      source: "p5-fork",
      createdAt,
    });

    return {
      status: "done",
      summary: `wrote markdown checkpoint ${ref}`,
      filesTouched: [ref],
      ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    };
  } catch (error) {
    return { status: "error", summary: String(error), filesTouched: [] };
  }
}

function ruleBasedContent(
  runId: string,
  goalCtx: { goal: Goal; ledgerEvents: ProgressLedgerEvent[] } | null,
  createdAt: string,
): string {
  const body = goalCtx
    ? buildGoalContinuityCheckpoint({ goal: goalCtx.goal, ...(goalCtx.ledgerEvents ? { ledgerEvents: goalCtx.ledgerEvents } : {}), now: createdAt })
    : `${NEVER_COMPACT_MARKER}\n\n(no goal context; trajectory-only checkpoint)`;
  const frontmatter = `<!-- zerox-checkpoint format=markdown-v1 createdAt=${createdAt} source=p5-fork -->`;
  return [`# Checkpoint — ${runId}`, frontmatter, "", body].join("\n");
}

async function distillWithLlm(
  provider: LLMProvider,
  model: string,
  apiKey: string,
  forkContext: ForkContext,
  transcript: string,
  goalCtx: { goal: Goal; ledgerEvents: ProgressLedgerEvent[] } | null,
  cancel: AbortSignal,
): Promise<{ content: string; cacheReadTokens?: number }> {
  const task = `Read the following run transcript and produce an 11-segment markdown checkpoint (sections: active_intent, next_action, directives, task_tree, current_work, files, learnings, errors, live_resources, design_decisions, open_notes). Start with "# Checkpoint — ${forkContext.parentRunId}".\n\nTranscript:\n${transcript}`;
  const req: CompleteRequest = {
    model,
    apiKey,
    temperature: 0,
    maxTokens: 2048,
    messages: [...forkContext.cachePrefix.messages, { role: "user", content: [{ type: "text", text: task }] }],
    cachePrefix: forkContext.cachePrefix,
    ...(cancel ? { signal: cancel } : {}),
  };
  const res = await provider.complete(req);
  return { content: res.content ?? "", ...(res.cacheReadTokens ? { cacheReadTokens: res.cacheReadTokens } : {}) };
}

function summarizeTrajectory(events: { type: string; sequence: number; payload: Record<string, unknown> }[]): string {
  // Keep milestone/tool/error events; drop verbose model_reasoning detail.
  const keep = events.filter((e) =>
    ["goal_planned", "milestone_started", "tool_call", "tool_result", "acceptance_checked", "workspace_escape_denied", "failure_classified", "final_summary", "goal_replanned", "checkpoint_written"].includes(e.type),
  );
  return keep.map((e) => `[${e.sequence}] ${e.type}: ${JSON.stringify(e.payload).slice(0, 300)}`).join("\n").slice(0, 8000);
}

function isValidMarkdownV1(content: string, runId: string): boolean {
  return (
    content.startsWith(`# Checkpoint — ${runId}`) &&
    content.includes("format=markdown-v1") &&
    content.includes(NEVER_COMPACT_MARKER)
  );
}
