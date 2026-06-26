// Compaction strategies (contracts v1.4 §4.2, Exit Criteria for P5).
//
// `SummarizeCompaction` wraps the existing `contextManager.compressMessages`
// (byte-equivalent — the 26-eval non-regression guarantee). `RebuildFromCheckpoint`
// reads the latest markdown checkpoint + project memories from the P1
// repositories and rebuilds the message list on overflow, inserting a
// rebuildBoundary marker. `selectCompactionStrategy` picks per the
// `ZEROX_COMPACTION_STRATEGY` flag (auto = rebuild when a checkpoint exists,
// else degrade to summarize = current behavior).

import type { ChatMessage } from "../openAiCompatibleClient";
import type { ContextManager } from "../contextManager";
import { estimateMessageTokens } from "../contextManager";
import type {
  CheckpointRepository,
  MemoryRepository,
} from "../../shared/storageContract";
import {
  buildRebuildBoundaryMessage,
  NEVER_COMPACT_MARKER,
} from "../../shared/compactionMarkers";

export type CompactionStrategyId = "summarize" | "rebuild";

export interface CompactionContext {
  messages: ChatMessage[];
  budget: number; // maxTokens * 0.7
  runId: string;
  latestCheckpoint?: unknown; // hint; RebuildFromCheckpoint fetches fresh
  protectedMarkers: string[]; // incl NEVER_COMPACT_MARKER
  /** Optional query seed for memory injection (e.g. goal description). */
  memoryQuerySeed?: string;
}

export interface CompactionResult {
  messages: ChatMessage[];
  compacted: boolean;
  beforeTokens: number;
  afterTokens: number;
  strategy: "summarize" | "rebuild" | "summarize-degraded";
  prunedTurns?: number[];
  checkpointRef?: string;
  rebuilt?: boolean;
  memoryHits?: string[];
  microcompactedRefs?: string[];
  degradedReason?: "no-checkpoint" | "non-goal-run";
}

export interface CompactionStrategy {
  readonly id: CompactionStrategyId;
  shouldCompact(ctx: CompactionContext): boolean;
  compact(ctx: CompactionContext): Promise<CompactionResult>;
}

export type CompactionFlag = "summarize" | "rebuild" | "auto";

export interface CompactionDeps {
  contextManager: ContextManager;
  checkpointRepository?: CheckpointRepository;
  memoryRepository?: MemoryRepository;
  /** P5: when provided, RebuildFromCheckpoint triggers the fork-agent
   *  checkpoint writer before rebuilding (so a fresh checkpoint exists). */
  checkpointWriter?: { maybeWriteCheckpoint(input: { parentRunId: string; parentMessages: ChatMessage[] }): Promise<unknown> };
  /** Tail token budget to retain on rebuild (default 12_000). */
  rebuildTailTokens?: number;
  /** Tool names whose results may be microcompacted to placeholders. */
  regenerableToolNames?: string[];
}

const DEFAULT_REBUILD_TAIL_TOKENS = 12_000;
const REGENERABLE_TOOLS = new Set([
  "file_read",
  "shell_exec",
  "code_search",
  "glob",
  "webfetch",
  "websearch",
]);

// ---------------------------------------------------------------------------
// SummarizeCompaction — byte-equivalent wrapper over compressMessages.
// ---------------------------------------------------------------------------

export function createSummarizeCompaction(
  deps: CompactionDeps,
): CompactionStrategy {
  return {
    id: "summarize",
    shouldCompact(ctx) {
      return estimateMessageTokens(ctx.messages) > ctx.budget;
    },
    async compact(ctx) {
      const beforeTokens = estimateMessageTokens(ctx.messages);
      const compressed = deps.contextManager.compressMessages(
        ctx.messages,
        ctx.budget,
      );
      const compacted = compressed !== ctx.messages;
      const afterTokens = estimateMessageTokens(compressed);
      return {
        messages: compressed,
        compacted,
        beforeTokens,
        afterTokens,
        strategy: "summarize",
      };
    },
  };
}

// ---------------------------------------------------------------------------
// RebuildFromCheckpoint — overflow-priority rebuild from markdown checkpoint.
// ---------------------------------------------------------------------------

export function createRebuildFromCheckpoint(
  deps: CompactionDeps,
): CompactionStrategy {
  const tailTokens = deps.rebuildTailTokens ?? DEFAULT_REBUILD_TAIL_TOKENS;
  const regenerable = deps.regenerableToolNames ?? [...REGENERABLE_TOOLS];

  return {
    id: "rebuild",
    shouldCompact(ctx) {
      return estimateMessageTokens(ctx.messages) > ctx.budget;
    },
    async compact(ctx) {
      const beforeTokens = estimateMessageTokens(ctx.messages);
      const summarize = createSummarizeCompaction(deps);

      // P5: trigger the fork-agent checkpoint writer before reading, so a fresh
      // markdown checkpoint exists (proactive refresh). Best-effort: failures
      // degrade to summarize without blocking the main loop.
      if (deps.checkpointWriter) {
        try {
          await deps.checkpointWriter.maybeWriteCheckpoint({
            parentRunId: ctx.runId,
            parentMessages: ctx.messages,
          });
        } catch {
          // best-effort; rebuild will degrade to summarize if no checkpoint lands
        }
      }

      const checkpoint = deps.checkpointRepository?.latest(ctx.runId, "markdown");
      if (!checkpoint) {
        // Degrade to summarize (current behavior) — observability flags the miss.
        const degraded = await summarize.compact(ctx);
        return { ...degraded, strategy: "summarize-degraded", degradedReason: "no-checkpoint" };
      }

      const content = readCheckpointContent(checkpoint);
      if (!content) {
        const degraded = await summarize.compact(ctx);
        return { ...degraded, strategy: "summarize-degraded", degradedReason: "no-checkpoint" };
      }

      // 1. Inject project memories (FTS5 BM25 over the checkpoint content).
      const memoryHits: string[] = [];
      if (deps.memoryRepository) {
        const results = deps.memoryRepository.search({
          query: ctx.memoryQuerySeed ?? content.slice(0, 200),
          limit: 8,
        });
        for (const r of results) memoryHits.push(r.record.id);
      }

      // 2. Retain the recent tail (by token budget), microcompacting
      //    regenerable tool results to placeholders.
      const { tail, microcompactedRefs } = retainTail(ctx.messages, tailTokens, regenerable, ctx.protectedMarkers);

      // 3. Assemble: [checkpoint anchor system msg] + [memory injection] + [boundary] + [tail].
      const rebuilt: ChatMessage[] = [
        {
          role: "system",
          content: `${NEVER_COMPACT_MARKER}\n\n${content}`,
        },
        ...(memoryHits.length
          ? [{
              role: "system" as const,
              content: `Recalled project memories: ${memoryHits.join(", ")}`,
            }]
          : []),
        {
          role: "system",
          content: buildRebuildBoundaryMessage(checkpoint.ref, checkpoint.createdAt),
        },
        ...tail,
      ];

      const afterTokens = estimateMessageTokens(rebuilt);
      return {
        messages: rebuilt,
        compacted: true,
        beforeTokens,
        afterTokens,
        strategy: "rebuild",
        rebuilt: true,
        checkpointRef: checkpoint.ref,
        memoryHits,
        microcompactedRefs,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Strategy selector.
// ---------------------------------------------------------------------------

export function selectCompactionStrategy(
  flag: CompactionFlag,
  deps: CompactionDeps,
): CompactionStrategy {
  if (flag === "summarize") return createSummarizeCompaction(deps);
  // "rebuild" and "auto" both prefer RebuildFromCheckpoint; it degrades to
  // summarize (auto) or summarize-degraded (rebuild) when no checkpoint exists.
  return createRebuildFromCheckpoint(deps);
}

export function resolveCompactionFlag(env: NodeJS.ProcessEnv = process.env): CompactionFlag {
  const raw = (env.ZEROX_COMPACTION_STRATEGY ?? "").toLowerCase();
  if (raw === "summarize") return "summarize";
  if (raw === "rebuild") return "rebuild";
  return "auto"; // default: rebuild when a checkpoint exists, else summarize
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readCheckpointContent(checkpoint: {
  payload: unknown;
}): string | null {
  const payload = checkpoint.payload as
    | { content?: string; format?: string }
    | string
    | null;
  if (!payload) return null;
  if (typeof payload === "string") return payload;
  return payload.content ?? null;
}

function retainTail(
  messages: ChatMessage[],
  tailTokenBudget: number,
  regenerable: string[],
  protectedMarkers: string[],
): { tail: ChatMessage[]; microcompactedRefs: string[] } {
  const microcompactedRefs: string[] = [];
  // Walk backwards collecting messages until the tail token budget is spent.
  const retainedIndexes = new Set<number>();
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) break;
    if (protectedMarkers.some((m) => msg.content.includes(m))) {
      retainedIndexes.add(i);
      continue;
    }
    const tokens = estimateMessageTokens([msg]);
    if (used + tokens > tailTokenBudget && retainedIndexes.size > 0) break;
    retainedIndexes.add(i);
    used += tokens;
  }

  completeToolPairIndexes(messages, retainedIndexes);

  const tail: ChatMessage[] = [];
  for (const index of [...retainedIndexes].sort((left, right) => left - right)) {
    const msg = messages[index];
    if (!msg) {
      continue;
    }
    // Microcompact regenerable tool results to a placeholder.
    if (msg.role === "tool" && isRegenerableToolMessage(msg, regenerable)) {
      const ref = `checkpoint-tail-message-${index}`;
      microcompactedRefs.push(ref);
      tail.push({
        ...msg,
        content:
          `[microcompacted tool result: ${ref}; original result remains in ` +
          "the local checkpoint transcript]",
      });
      continue;
    }
    tail.push(msg);
  }
  return { tail, microcompactedRefs };
}

function completeToolPairIndexes(messages: ChatMessage[], retainedIndexes: Set<number>) {
  const toolCallIndexes = new Map<string, number>();
  const toolResultIndexes = new Map<string, number>();

  for (const [index, message] of messages.entries()) {
    for (const toolCall of message.tool_calls ?? []) {
      toolCallIndexes.set(toolCall.id, index);
    }
    if (message.role === "tool" && message.tool_call_id) {
      toolResultIndexes.set(message.tool_call_id, index);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const index of [...retainedIndexes]) {
      const message = messages[index];
      if (!message) {
        continue;
      }
      if (message.role === "tool" && message.tool_call_id) {
        const assistantIndex = toolCallIndexes.get(message.tool_call_id);
        if (assistantIndex !== undefined && !retainedIndexes.has(assistantIndex)) {
          retainedIndexes.add(assistantIndex);
          changed = true;
        }
      }
      for (const toolCall of message.tool_calls ?? []) {
        const resultIndex = toolResultIndexes.get(toolCall.id);
        if (resultIndex !== undefined && !retainedIndexes.has(resultIndex)) {
          retainedIndexes.add(resultIndex);
          changed = true;
        }
      }
    }
  }
}

function isRegenerableToolMessage(msg: ChatMessage, regenerable: string[]): boolean {
  // A tool result message's preceding assistant tool_call carries the tool name;
  // we approximate by checking the tool_call_id/name heuristically. The tool
  // name is not on the tool message itself in the OpenAI shape, so we conservatively
  // microcompact any large tool result (the regenerable set is a hint for callers
  // that can resolve the tool name; here we treat all large tool results as
  // regenerable candidates, matching the legacy kernel prune behavior).
  void regenerable;
  return msg.role === "tool" && msg.content.length > 480;
}
