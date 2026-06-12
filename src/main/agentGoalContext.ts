import type { Goal, Milestone } from "../shared/agentGoal";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";
import type { ChatMessage } from "./openAiCompatibleClient";
import type { ProgressLedgerEvent } from "./agentGoalStore";
import type { AgentTrajectoryStore } from "./agentTrajectoryStore";
import {
  createContextManager,
  estimateMessageTokens,
} from "./contextManager";

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
        "[Goal anchors - never compact]",
        `Goal: ${goal.description}`,
        `Goal status: ${goal.status}`,
        `Plan version: ${goal.planVersion}`,
        "Success criteria:",
        ...goal.successCriteria.map(
          (criterion) =>
            `- ${criterion.id}: ${criterion.description}; checks=${criterion.acceptanceChecks
              .map((check) => `${check.id}:${check.kind}`)
              .join(", ")}`,
        ),
        "Current progress ledger:",
        ...summarizeLedger(ledgerEvents),
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        "[Goal milestone context]",
        "Accepted milestone conclusions:",
        ...summarizeAcceptedMilestones(goal.milestones, ledgerEvents),
        "Running and pending milestone detail:",
        ...summarizeOpenMilestones(goal.milestones),
      ].join("\n"),
    },
  ];
}

function summarizeLedger(events: ProgressLedgerEvent[]): string[] {
  if (!events.length) {
    return ["- No progress ledger events yet."];
  }

  return events.slice(-6).map((event) => {
    const refs = event.evidenceRefs?.length
      ? ` evidence=${event.evidenceRefs.join(",")}`
      : "";
    const milestone = event.milestoneId ? ` milestone=${event.milestoneId}` : "";
    return `- ${event.at} ${event.kind}${milestone}: ${event.summary}${refs}`;
  });
}

function summarizeAcceptedMilestones(
  milestones: Milestone[],
  ledgerEvents: ProgressLedgerEvent[],
): string[] {
  const accepted = milestones.filter((milestone) => milestone.state === "accepted");
  if (!accepted.length) {
    return ["- None accepted yet."];
  }

  return accepted.map((milestone) => {
    const refs = ledgerEvents
      .filter((event) => event.milestoneId === milestone.id)
      .flatMap((event) => event.evidenceRefs ?? []);
    const evidence = refs.length ? ` evidence=${refs.join(",")}` : "";
    return `- ${milestone.id}: ${
      milestone.lastAcceptanceSummary ?? "Accepted."
    }${evidence}`;
  });
}

function summarizeOpenMilestones(milestones: Milestone[]): string[] {
  const open = milestones.filter(
    (milestone) =>
      milestone.state === "running" ||
      milestone.state === "pending" ||
      milestone.state === "ready" ||
      milestone.state === "rejected",
  );
  if (!open.length) {
    return ["- None open."];
  }

  return open.map(
    (milestone) =>
      `- ${milestone.id}: ${milestone.description}; state=${milestone.state}; dependsOn=${
        milestone.dependsOn.join(",") || "none"
      }; criteria=${milestone.successCriteria
        .map((criterion) => `${criterion.id}:${criterion.description}`)
        .join(", ")}`,
  );
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
