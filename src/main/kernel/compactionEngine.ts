import {
  KERNEL_EVENT_VERSION,
  type KernelEvent,
} from "../../shared/kernelContract";
import {
  estimateMessageTokens,
} from "../contextManager";
import type { ChatMessage } from "../openAiCompatibleClient";
import type { KernelCheckpointStore } from "./checkpointStore";
import type { KernelEventBus } from "./eventBus";

const NEVER_COMPACT_MARKER = "[Goal continuity checkpoint - never compact]";
const DEFAULT_TRIGGER_RATIO = 0.85;
const DEFAULT_TAIL_TURNS = 3;
const DEFAULT_TOOL_RESULT_PRUNE_CHARS = 480;

export type CompactionConfig = {
  budget: number;
  preserveRecentTokens?: number;
  tailTurns?: number;
  triggerRatio?: number;
  toolResultPruneChars?: number;
};

export type CompactKernelContextInput = {
  runId: string;
  turn: number;
  messages: ChatMessage[];
  checkpointStore: KernelCheckpointStore;
  bus?: KernelEventBus;
  now?: () => string;
  goalContinuity?: string;
  planSnapshot?: unknown;
};

export type CompactionResult = {
  messages: ChatMessage[];
  compacted: boolean;
  beforeTokens: number;
  afterTokens: number;
  prunedTurns: number[];
  checkpointRef?: string;
};

export async function compactKernelContext(
  input: CompactKernelContextInput,
  config: CompactionConfig,
): Promise<CompactionResult> {
  const now = input.now ?? (() => new Date().toISOString());
  const beforeTokens = estimateMessageTokens(input.messages);
  const budget = Math.max(1, Math.floor(config.budget));
  const triggerRatio = config.triggerRatio ?? DEFAULT_TRIGGER_RATIO;

  if (beforeTokens <= budget * triggerRatio) {
    return {
      messages: input.messages,
      compacted: false,
      beforeTokens,
      afterTokens: beforeTokens,
      prunedTurns: [],
      checkpointRef: undefined,
    };
  }

  const checkpoint = await input.checkpointStore.writeCheckpoint({
    runId: input.runId,
    turn: input.turn,
    fullMessages: input.messages,
    ...(input.goalContinuity ? { goalContinuity: input.goalContinuity } : {}),
    ...(input.planSnapshot !== undefined
      ? { planSnapshot: input.planSnapshot }
      : {}),
  });

  input.bus?.publish({
    v: KERNEL_EVENT_VERSION,
    type: "checkpoint_written",
    runId: input.runId,
    ref: checkpoint.ref,
    turn: input.turn,
    createdAt: now(),
  });

  const tailStart = findTailStartIndex(
    input.messages,
    config.tailTurns ?? DEFAULT_TAIL_TURNS,
  );
  const toolResultPruneChars =
    config.toolResultPruneChars ?? DEFAULT_TOOL_RESULT_PRUNE_CHARS;
  const prunedTurns: number[] = [];
  let messages = input.messages.map((message, index) => {
    if (shouldPreserveMessage(message, index, tailStart)) {
      return message;
    }

    if (message.role === "tool" && message.content.length > toolResultPruneChars) {
      prunedTurns.push(index);
      return buildCheckpointRefToolMessage(message, checkpoint.ref);
    }

    return message;
  });

  messages = fitCompactedMessagesWithinBudget(messages, budget, tailStart, prunedTurns);
  const afterTokens = estimateMessageTokens(messages);

  input.bus?.publish({
    v: KERNEL_EVENT_VERSION,
    type: "compaction",
    runId: input.runId,
    beforeTokens,
    afterTokens,
    prunedTurns,
    checkpointRef: checkpoint.ref,
    createdAt: now(),
  } satisfies KernelEvent);

  return {
    messages,
    compacted: true,
    beforeTokens,
    afterTokens,
    prunedTurns,
    checkpointRef: checkpoint.ref,
  };
}

function shouldPreserveMessage(
  message: ChatMessage,
  index: number,
  tailStart: number,
): boolean {
  return (
    index >= tailStart ||
    message.content.includes(NEVER_COMPACT_MARKER)
  );
}

function findTailStartIndex(messages: ChatMessage[], tailTurns: number): number {
  const normalizedTailTurns = Math.max(0, Math.floor(tailTurns));
  if (normalizedTailTurns === 0) {
    return messages.length;
  }

  let seenUserTurns = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role !== "user") {
      continue;
    }

    seenUserTurns += 1;
    if (seenUserTurns === normalizedTailTurns) {
      return index;
    }
  }

  return 0;
}

function buildCheckpointRefToolMessage(
  message: ChatMessage,
  checkpointRef: string,
): ChatMessage {
  return {
    ...message,
    content: JSON.stringify({
      type: "tool_result_checkpoint_ref",
      checkpoint_ref: checkpointRef,
      summary: "Historical tool result was moved into a local kernel checkpoint.",
      original_chars: message.content.length,
    }),
  };
}

function fitCompactedMessagesWithinBudget(
  messages: ChatMessage[],
  budget: number,
  tailStart: number,
  prunedTurns: number[],
): ChatMessage[] {
  const kept = [...messages];
  let index = 0;

  while (estimateMessageTokens(kept) > budget && index < kept.length) {
    const message = kept[index];
    if (!message || shouldPreserveMessage(message, index, tailStart)) {
      index += 1;
      continue;
    }

    if (message.role === "tool") {
      index += 1;
      continue;
    }

    kept.splice(index, 1);
    prunedTurns.push(index);
  }

  return kept;
}
