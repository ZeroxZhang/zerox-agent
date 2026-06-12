import type { MemoryKind } from "./memory";
import type { AgentRunRecord } from "./agentRuns";
import type { ScheduledTask } from "./scheduledTasks";
import type { GoalStatus } from "./agentGoal";

export type ChatHistoryMessage = {
  role: "assistant" | "user";
  content: string;
};

export type ChatMessageRecord = ChatHistoryMessage & {
  id: string;
  createdAt: string;
  relatedMemoryIds?: string[];
  executedRunId?: string;
  goalId?: string;
  goalEventRef?: string;
};

export type ChatSessionGoalSummary = {
  id: string;
  description: string;
  status: GoalStatus;
};

export type ChatMessageSearchOptions = {
  query: string;
  sessionId?: string;
  limit?: number;
};

export type ChatMessageSearchResult = {
  sessionId: string;
  sessionTitle: string;
  messageId: string;
  role: ChatMessageRecord["role"];
  content: string;
  createdAt: string;
  score: number;
  matchedTerms: string[];
};

export type ChatSessionRecord = {
  id: string;
  title: string;
  summary: string;
  messages: ChatMessageRecord[];
  activeGoalId?: string;
  goalIds?: string[];
  goalSummaries?: ChatSessionGoalSummary[];
  createdAt: string;
  updatedAt: string;
};

export type ChatSessionListItem = {
  id: string;
  title: string;
  summary: string;
  messageCount: number;
  activeGoal?: ChatSessionGoalSummary;
  updatedAt: string;
};

export type SendChatMessageInput = {
  sessionId?: string;
  requestId?: string;
  message: string;
  history?: ChatHistoryMessage[];
};

export type ChatRelatedMemory = {
  id: string;
  title: string;
  kind: MemoryKind;
  score: number;
};

export type ChatAgentStatus =
  | {
      state: "completed";
      runId?: string;
      toolCallsExecuted: number;
    }
  | {
      state: "paused";
      runId?: string;
      reason: "turn_limit" | "tool_failure_loop";
      maxTurns: number;
      toolCallsExecuted: number;
      message: string;
    };

export type ChatTaskStatusEvent = {
  sessionId: string;
  state:
    | "started"
    | "memory"
    | "model"
    | "reasoning"
    | "tool_call"
    | "tool_result"
    | "paused"
    | "canceled"
    | "completed"
    | "failed";
  message: string;
  createdAt: string;
  elapsedMs: number;
  turn?: number;
  toolName?: string;
  toolCallsExecuted?: number;
  maxTurns?: number;
  ok?: boolean;
};

export type CancelChatMessageResult =
  | {
      ok: true;
      message: string;
    }
  | {
      ok: false;
      message: string;
    };

export type SendChatMessageResult =
  | {
      ok: true;
      reply: string;
      sessionId: string;
      relatedMemories: ChatRelatedMemory[];
      memoryId: string | null;
      executedRun?: AgentRunRecord;
      createdTask?: ScheduledTask;
      agentStatus?: ChatAgentStatus;
    }
  | {
      ok: false;
      message: string;
    };
