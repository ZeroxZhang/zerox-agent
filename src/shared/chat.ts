import type { MemoryKind } from "./memory";
import type { AgentRunRecord } from "./agentRuns";
import type { ScheduledTask } from "./scheduledTasks";
import type { GoalStatus } from "./agentGoal";
import type { ChatOutputPart } from "./chatOutput";
import type { GoalDraft } from "./goalTranslation";

export type ChatHistoryMessage = {
  role: "assistant" | "user";
  content: string;
};

export type ChatMessageRecord = ChatHistoryMessage & {
  id: string;
  createdAt: string;
  outputParts?: ChatOutputPart[];
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
  mode?: "chat" | "goal_draft";
  selectedSkillName?: string;
  workspaceId?: string;
  workspaceSummary?: ChatWorkspaceSummary;
  history?: ChatHistoryMessage[];
};

export type SkillInputFieldType = "string" | "number" | "boolean" | "path" | "choice";

export type SkillInputField = {
  name: string;
  label: string;
  type: SkillInputFieldType;
  required: boolean;
  description?: string;
  defaultValue?: string | number | boolean;
  choices?: string[];
};

export type SkillUserInputRequest = {
  id: string;
  executionId: string;
  sessionId: string;
  requestId: string;
  skillName: string;
  reason: string;
  fields: SkillInputField[];
  createdAt: string;
};

export type SkillInputResponse = {
  inputRequestId: string;
  values: Record<string, string | number | boolean>;
};

export type SkillPendingInputState = {
  inputRequestId: string;
  status: "pending" | "completed";
  sessionId: string;
  requestId: string;
  userMessage: string;
  userMessageId?: string;
  selectedSkillName: string;
  workspaceId?: string;
  workspaceSummary?: ChatWorkspaceSummary;
  partialValues: Record<string, string | number | boolean>;
};

export type SkillInputResponseResult = SendChatMessageResult;

type ChatStreamEventBase = {
  sessionId: string;
  requestId: string;
  sequence: number;
  turnId: string;
  assistantMessageId?: string;
  createdAt: string;
};

export type ChatOutputStreamEvent = ChatStreamEventBase & {
  type: "output_part";
  part: ChatOutputPart;
};

export type ChatStreamEvent =
  | (ChatStreamEventBase & {
      type: "answer_delta";
      text: string;
    })
  | (ChatStreamEventBase & {
      type: "thinking_delta";
      text: string;
    })
  | (ChatStreamEventBase & {
      type: "tool_call_preview";
      toolCallId: string;
      index?: number;
      toolName?: string;
      argumentsDelta?: string;
    })
  | ChatOutputStreamEvent
  | (ChatStreamEventBase & {
      type: "status";
      status: ChatTaskStatusEvent;
    })
  | (ChatStreamEventBase & {
      type: "waiting_for_input";
      inputRequest: SkillUserInputRequest;
    })
  | (ChatStreamEventBase & {
      type: "completed" | "failed" | "canceled";
      finalMessageId?: string;
      message?: string;
    });

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
    | "skill_load"
    | "memory"
    | "memory_scope"
    | "history"
    | "model"
    | "reasoning"
    | "streaming"
    | "requirement"
    | "actor_spawned"
    | "actor_done"
    | "tool_invocation"
    | "tool_call"
    | "tool_result"
    | "checkpoint_boundary"
    | "waiting_for_input"
    | "paused"
    | "canceled"
    | "completed"
    | "failed";
  message: string;
  createdAt: string;
  elapsedMs: number;
  turn?: number;
  toolCallId?: string;
  toolInvocationId?: string;
  toolName?: string;
  toolSource?: string;
  resultRef?: string;
  resultBytes?: number;
  invocationStatus?: string;
  checkpointId?: string;
  memoryScopes?: string[];
  historyOperation?: string;
  selectedSkillName?: string;
  workspaceId?: string;
  workspaceSummary?: ChatWorkspaceSummary;
  toolCallsExecuted?: number;
  maxTurns?: number;
  inputRequest?: SkillUserInputRequest;
  pendingSkillInput?: SkillPendingInputState;
  ok?: boolean;
  payload?: Record<string, unknown>;
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
  event:
    | "started"
    | "milestone_started"
    | "milestone_accepted"
    | "milestone_rejected"
    | "review_requested"
    | "replanned"
    | "stopped"
    | "checkpoint"
    | "acceptance_manifest_created"
    | "acceptance_failure_classified"
    | "acceptance_repair_scheduled"
    | "acceptance_strategy_changed"
    | "acceptance_blocked"
    | "acceptance_certified";
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
      goalDraft?: GoalDraft;
      selectedSkill?: {
        name: string;
        displayName: string;
      };
    }
  | {
      ok: false;
      message: string;
    };
