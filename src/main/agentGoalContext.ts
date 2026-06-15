import type { Goal } from "../shared/agentGoal";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";
import type { ChatMessage } from "./openAiCompatibleClient";
import type { ProgressLedgerEvent } from "./agentGoalStore";
import type { AgentTrajectoryStore } from "./agentTrajectoryStore";
import {
  createContextManager,
  estimateMessageTokens,
} from "./contextManager";
import { buildGoalContinuityCheckpoint } from "../shared/agentGoalContinuity";

export type AgentGoalContext = {
  assemble(
    goal: Goal,
    history: ChatMessage[],
    tokenBudget: number,
  ): {
    messages: ChatMessage[];
    compacted: boolean;
    droppedRefs: string[];
  };
};

export function createAgentGoalContext(options: {
  ledgerEvents?: ProgressLedgerEvent[];
  trajectoryStore?: Pick<AgentTrajectoryStore, "append">;
  runId?: string;
  createId?: () => string;
  nextSequence?: () => number;
  now?: () => string;
} = {}): AgentGoalContext {
  const contextManager = createContextManager({ recentTurnsToKeep: 2 });

  return {
    assemble(goal, history, tokenBudget) {
      const anchors = buildAnchorMessages(goal, options.ledgerEvents ?? []);
      const normalizedHistory = normalizeHistory(history);
      const toolRefMessages = normalizedHistory.messages.filter((message) =>
        Boolean(extractToolResultRef(message.content)),
      );
      const compressibleHistory = normalizedHistory.messages.filter(
        (message) => !extractToolResultRef(message.content),
      );
      const preservedAnchors = [...anchors, ...toolRefMessages];
      const combined = [...preservedAnchors, ...compressibleHistory];
      const beforeTokens = estimateMessageTokens(combined);

      if (beforeTokens <= tokenBudget) {
        return {
          messages: combined,
          compacted: false,
          droppedRefs: [],
        };
      }

      const anchorTokens = estimateMessageTokens(preservedAnchors);
      const historyBudget = Math.max(60, tokenBudget - anchorTokens);
      const compressedHistory = contextManager.compressMessages(
        compressibleHistory,
        historyBudget,
      );
      const droppedRefs: string[] = [];
      const messages = fitWithinBudget(
        preservedAnchors,
        compressedHistory,
        tokenBudget,
        droppedRefs,
      );

      emitContextCompacted(options, goal, {
        beforeTokens,
        afterTokens: estimateMessageTokens(messages),
        tokenBudget,
        droppedRefs,
      });

      return {
        messages,
        compacted: true,
        droppedRefs,
      };
    },
  };
}

function buildAnchorMessages(
  goal: Goal,
  ledgerEvents: ProgressLedgerEvent[],
): ChatMessage[] {
  return [
    {
      role: "system",
      content: [
        buildGoalContinuityCheckpoint({ goal, ledgerEvents, compact: true }),
      ].join("\n"),
    },
  ];
}

function normalizeHistory(history: ChatMessage[]): {
  messages: ChatMessage[];
} {
  return {
    messages: history.map((message) => {
      if (message.role !== "tool") {
        return message;
      }

      const toolResultRef = extractToolResultRef(message.content);
      if (!toolResultRef) {
        return message;
      }

      return {
        ...message,
        content: JSON.stringify({
          type: "tool_result_ref",
          offloaded: true,
          result_ref: toolResultRef,
          summary: "Large tool observation is available through result_ref.",
        }),
      };
    }),
  };
}

function fitWithinBudget(
  anchors: ChatMessage[],
  history: ChatMessage[],
  tokenBudget: number,
  droppedRefs: string[],
): ChatMessage[] {
  const keptHistory = [...history];
  while (
    estimateMessageTokens([...anchors, ...keptHistory]) > tokenBudget &&
    keptHistory.length > 0
  ) {
    const dropIndex = keptHistory.findIndex(
      (message) => !extractToolResultRef(message.content),
    );
    if (dropIndex === -1) {
      break;
    }

    const [removed] = keptHistory.splice(dropIndex, 1);
    if (removed) {
      droppedRefs.push(describeDroppedMessage(removed));
    }
  }

  return [...anchors, ...keptHistory];
}

function extractToolResultRef(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as {
      resultRef?: unknown;
      result_ref?: unknown;
    };
    const ref = parsed.resultRef ?? parsed.result_ref;
    return typeof ref === "string" ? ref : null;
  } catch {
    return null;
  }
}

function describeDroppedMessage(message: ChatMessage): string {
  return `${message.role}:${message.content.slice(0, 40)}`;
}

function emitContextCompacted(
  options: {
    trajectoryStore?: Pick<AgentTrajectoryStore, "append">;
    runId?: string;
    createId?: () => string;
    nextSequence?: () => number;
    now?: () => string;
  },
  goal: Goal,
  payload: {
    beforeTokens: number;
    afterTokens: number;
    tokenBudget: number;
    droppedRefs: string[];
  },
): void {
  if (!options.trajectoryStore) {
    return;
  }

  const runId = options.runId ?? goal.id;
  const event: AgentTrajectoryEvent = {
    id: options.createId?.() ?? `context_compacted_${Date.now()}`,
    runId,
    type: "context_compacted",
    sequence: options.nextSequence?.() ?? 0,
    payload: {
      goalId: goal.id,
      ...payload,
    },
    redaction: {
      containsApiKey: false,
      containsFileContent: false,
      containsUserText: true,
    },
    createdAt: options.now?.() ?? new Date().toISOString(),
  };

  void options.trajectoryStore.append(runId, event);
}
