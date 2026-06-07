import type { ChatMessage, ToolCall } from "./openAiCompatibleClient";

export type ContextManager = {
  estimateTokens(messages: ChatMessage[]): number;
  compressMessages(
    messages: ChatMessage[],
    maxTokens: number,
  ): ChatMessage[];
};

export type ContextManagerOptions = {
  maxTokens?: number;
  recentTurnsToKeep?: number;
};

export function createContextManager(
  options: ContextManagerOptions = {},
): ContextManager {
  const maxTokens = options.maxTokens ?? 8000;
  const recentTurnsToKeep = options.recentTurnsToKeep ?? 6;

  return {
    estimateTokens(messages) {
      return estimateTotalTokens(messages);
    },

    compressMessages(messages, overrideMaxTokens) {
      const limit = overrideMaxTokens ?? maxTokens;
      const currentTokens = estimateTotalTokens(messages);

      if (currentTokens <= limit) {
        return messages;
      }

      return compressMessagesInternal(messages, limit, recentTurnsToKeep);
    },
  };
}

function estimateTotalTokens(messages: ChatMessage[]): number {
  let total = 0;

  for (const message of messages) {
    total += estimateTextTokens(message.content);
    total += 4; // message overhead (~4 tokens per message)

    if (message.tool_calls?.length) {
      for (const tc of message.tool_calls) {
        total += estimateTextTokens(tc.function.name);
        total += estimateTextTokens(tc.function.arguments);
        total += 4; // tool_call overhead
      }
    }
  }

  return total;
}

function compressMessagesInternal(
  messages: ChatMessage[],
  limit: number,
  recentTurns: number,
): ChatMessage[] {
  const systemMessages: ChatMessage[] = [];
  const conversationTurns: Array<{
    user?: ChatMessage;
    assistant?: ChatMessage;
    toolResults: ChatMessage[];
  }> = [];

  let currentTurn: {
    user?: ChatMessage;
    assistant?: ChatMessage;
    toolResults: ChatMessage[];
  } | null = null;

  for (const message of messages) {
    if (message.role === "system") {
      systemMessages.push(message);
      continue;
    }

    if (message.role === "user") {
      if (currentTurn) {
        conversationTurns.push(currentTurn);
      }
      currentTurn = { user: message, assistant: undefined, toolResults: [] };
    } else if (message.role === "assistant") {
      if (!currentTurn) {
        currentTurn = { user: undefined, assistant: message, toolResults: [] };
      } else {
        currentTurn.assistant = message;
      }
    } else if (message.role === "tool") {
      if (currentTurn) {
        currentTurn.toolResults.push(message);
      }
    }
  }

  if (currentTurn) {
    conversationTurns.push(currentTurn);
  }

  // Keep system messages + recent turns
  const systemTokens = estimateTotalTokens(systemMessages);
  const availableTokens = limit - systemTokens - 100; // 100 token buffer

  const keep: ChatMessage[] = [...systemMessages];

  if (conversationTurns.length <= recentTurns) {
    // All turns fit within recent limit, just add them all
    for (const turn of conversationTurns) {
      addTurnToKeep(keep, turn);
    }
    return keep;
  }

  // Compress older turns into a summary
  const oldTurns = conversationTurns.slice(0, -recentTurns);
  const recentTurnSlice = conversationTurns.slice(-recentTurns);

  const recentTokens = estimateTotalTokens(
    recentTurnSlice.flatMap((t) => turnToMessages(t)),
  );

  const summaryBudget = Math.max(100, availableTokens - recentTokens - 100);

  const summary = buildCompressionSummary(oldTurns, summaryBudget);

  if (summary) {
    keep.push({
      role: "user",
      content: summary,
    });
  }

  for (const turn of recentTurnSlice) {
    addTurnToKeep(keep, turn);
  }

  return keep;
}

function addTurnToKeep(
  keep: ChatMessage[],
  turn: {
    user?: ChatMessage;
    assistant?: ChatMessage;
    toolResults: ChatMessage[];
  },
) {
  if (turn.user) keep.push(turn.user);
  if (turn.assistant) keep.push(turn.assistant);
  for (const tr of turn.toolResults) keep.push(tr);
}

function turnToMessages(turn: {
  user?: ChatMessage;
  assistant?: ChatMessage;
  toolResults: ChatMessage[];
}): ChatMessage[] {
  const msgs: ChatMessage[] = [];
  if (turn.user) msgs.push(turn.user);
  if (turn.assistant) msgs.push(turn.assistant);
  msgs.push(...turn.toolResults);
  return msgs;
}

function buildCompressionSummary(
  turns: Array<{
    user?: ChatMessage;
    assistant?: ChatMessage;
    toolResults: ChatMessage[];
  }>,
  budgetTokens: number,
): string | null {
  if (!turns.length) return null;

  const summaries: string[] = [];
  let usedBudget = 0;
  const maxPerSummary = Math.floor(budgetTokens / Math.min(turns.length, 10)) * 4;

  for (const turn of turns) {
    if (usedBudget >= budgetTokens) break;

    const userText = turn.user ? truncateText(turn.user.content, 200) : "";
    const assistantText = turn.assistant
      ? extractSummary(turn.assistant)
      : "";

    const toolSummary =
      turn.toolResults.length > 0
        ? `[工具调用: ${turn.toolResults.map((t) => extractToolSummary(t)).join(", ")}]`
        : "";

    const line = [
      userText ? `用户: ${userText}` : "",
      assistantText ? `助手: ${assistantText}` : "",
      toolSummary,
    ]
      .filter(Boolean)
      .join(" ");

    if (estimateTextTokens(line) + usedBudget > budgetTokens) break;

    summaries.push(line);
    usedBudget += estimateTextTokens(line);
  }

  if (!summaries.length) return null;

  return `[之前对话摘要]\n${summaries.join("\n")}`;
}

function extractSummary(message: ChatMessage): string {
  if (message.tool_calls?.length) {
    const toolNames = message.tool_calls.map((tc) => tc.function.name);
    return `调用了工具: ${toolNames.join(", ")}`;
  }

  return truncateText(message.content, 300);
}

function extractToolSummary(message: ChatMessage): string {
  try {
    const parsed = JSON.parse(message.content) as {
      tool?: string;
      ok?: boolean;
      error?: string;
    };
    if (parsed.ok === true) return `${parsed.tool ?? ""}: 成功`;
    if (parsed.ok === false) return `${parsed.tool ?? ""}: 失败`;
  } catch {
    // fallback
  }
  return truncateText(message.content, 60);
}

export function estimateTextTokens(text: string): number {
  if (!text) return 0;

  let cjkCount = 0;
  let otherCount = 0;

  for (const char of text) {
    const code = char.charCodeAt(0);
    if (
      (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified
      (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
      (code >= 0x3000 && code <= 0x303f) || // CJK Symbols
      (code >= 0xff00 && code <= 0xffef) || // Halfwidth/Fullwidth
      (code >= 0xac00 && code <= 0xd7af) // Hangul
    ) {
      cjkCount += 1;
    } else {
      otherCount += 1;
    }
  }

  // CJK characters: ~1.5 chars per token
  // Other characters: ~4 chars per token
  return Math.ceil(cjkCount / 1.5 + otherCount / 4);
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}
