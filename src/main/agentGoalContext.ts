import type { Goal } from "../shared/agentGoal";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";
import type { ChatMessage } from "./openAiCompatibleClient";
import type { ProgressLedgerEvent } from "./agentGoalStore";
import type { AgentTrajectoryStore } from "./agentTrajectoryStore";
import { estimateMessageTokens } from "./contextManager";
import { buildGoalContinuityCheckpoint } from "../shared/agentGoalContinuity";
import {
  groupToolPairedMessages,
  sanitizeChatMessages,
} from "./messageIntegrity";

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
  return {
    assemble(goal, history, tokenBudget) {
      const anchors = buildAnchorMessages(goal, options.ledgerEvents ?? []);
      // Repair the resumed transcript before it is combined with anchors:
      // historical grouping kept incomplete tool-call pairs, so a single
      // interrupted batch poisoned every subsequent resume with provider
      // HTTP 400 rejections.
      const { messages: intactHistory } = sanitizeChatMessages(history, {
        unresolvedToolCalls: "trim",
      });
      const normalizedHistory = normalizeHistory(intactHistory);
      const combined = [...anchors, ...normalizedHistory.messages];
      const beforeTokens = estimateMessageTokens(combined);

      if (beforeTokens <= tokenBudget) {
        return {
          messages: combined,
          compacted: false,
          droppedRefs: [],
        };
      }

      const droppedRefs: string[] = [];
      const messages = fitAtomicHistoryWithinBudget(
        anchors,
        normalizedHistory.messages,
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

function fitAtomicHistoryWithinBudget(
  anchors: ChatMessage[],
  history: ChatMessage[],
  tokenBudget: number,
  droppedRefs: string[],
): ChatMessage[] {
  const groups = groupToolPairedMessages(history);
  while (
    estimateMessageTokens([...anchors, ...groups.flat()]) > tokenBudget &&
    groups.length > 0
  ) {
    const dropIndex = groups.findIndex(
      (group) => !group.some((message) => Boolean(extractToolResultRef(message.content))),
    );
    if (dropIndex < 0) break;
    const [removed] = groups.splice(dropIndex, 1);
    if (removed) {
      droppedRefs.push(
        removed.map((message) => `${message.role}:${message.content.slice(0, 40)}`).join(" | "),
      );
    }
  }
  return [...anchors, ...groups.flat()];
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
