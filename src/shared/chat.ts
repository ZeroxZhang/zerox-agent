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

export type ChatSessionTokenUsage = {
  totalTokens: number;
  promptTokens?: number;
  completionTokens?: number;
  estimated: boolean;
};

export type ChatWorkspaceSummary = {
  name: string;
  rootPath: string;
  kind: string;
  sandboxMode: string;
  branch?: string;
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
  workspaceId?: string;
  workspaceSummary?: ChatWorkspaceSummary;
  activeGoalId?: string;
  goalIds?: string[];
  goalSummaries?: ChatSessionGoalSummary[];
  activity?: ChatSessionActivitySnapshot;
  archivedAt?: string;
  tokenUsage?: ChatSessionTokenUsage;
  createdAt: string;
  updatedAt: string;
};

export type ChatSessionListItem = {
  id: string;
  title: string;
  summary: string;
  messageCount: number;
  workspaceId?: string;
  workspaceSummary?: ChatWorkspaceSummary;
  activeGoal?: ChatSessionGoalSummary;
  archivedAt?: string;
  lastAssistantMessageAt?: string;
  tokenUsage?: ChatSessionTokenUsage;
  updatedAt: string;
};

export type ChatSessionOperationResult =
  | { ok: true; session?: ChatSessionRecord }
  | { ok: false; message: string };

export type SendChatMessageInput = {
  sessionId?: string;
  requestId?: string;
  message: string;
  selectedSkillName?: string;
  workspaceId?: string;
  workspaceSummary?: ChatWorkspaceSummary;
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
      reason: "turn_limit" | "tool_failure_loop" | "strategy_guard";
      maxTurns: number;
      toolCallsExecuted: number;
      message: string;
    };

export type ChatTaskStatusEvent = {
  sessionId: string;
  state:
    | "started"
    | "workspace"
    | "skill"
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
  toolCallId?: string;
  toolName?: string;
  resultRef?: string;
  resultBytes?: number;
  selectedSkillName?: string;
  workspaceId?: string;
  workspaceSummary?: ChatWorkspaceSummary;
  toolCallsExecuted?: number;
  maxTurns?: number;
  ok?: boolean;
};

export type ChatSessionActivitySnapshot = {
  updatedAt: string;
  statusEvents: ChatTaskStatusEvent[];
  selectedSkillName?: string;
};

export type GoalProgressEvent = {
  kind: "goal_progress";
  goalId: string;
  sessionId?: string;
  status: GoalStatus;
  milestoneId?: string;
  event: "started" | "milestone_started" | "milestone_accepted" | "milestone_rejected" | "review_requested" | "replanned" | "stopped" | "checkpoint";
  message: string;
  timestamp: string;
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
      activeGoal?: ChatSessionGoalSummary;
      selectedSkill?: {
        name: string;
        displayName: string;
      };
    }
  | {
      ok: false;
      message: string;
    };
