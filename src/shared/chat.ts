import type { MemoryKind } from "./memory";
import type { AgentRunRecord } from "./agentRuns";
import type { ScheduledTask } from "./scheduledTasks";
import type { GoalStatus } from "./agentGoal";
import type { ChatOutputPart } from "./chatOutput";
import type { ModelServiceNotice } from "./modelServiceNotice";
import type { GoalDraft } from "./goalTranslation";
import type { AgentContextUsage } from "./contextUsage";
import type {
  PlanAutonomyMode,
  PlanMode,
  PlanModelAssignments,
  PlanRecord,
} from "./planMode";

export type ChatAttachmentKind = "image" | "text";

export type ChatAttachmentMetadata = {
  id: string;
  name: string;
  mediaType: string;
  size: number;
  kind: ChatAttachmentKind;
};

export type ChatAttachmentInput = ChatAttachmentMetadata & {
  dataBase64: string;
};

export type ChatHistoryMessage = {
  role: "assistant" | "user";
  content: string;
  attachments?: ChatAttachmentMetadata[];
};

export type ChatMessageRecord = ChatHistoryMessage & {
  id: string;
  requestId?: string;
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
  /** Goal-store time, used to order Goal state against independent Chat runs. */
  updatedAt?: string;
};

export type ChatSessionWorkSummary =
  | {
      source: "goal";
      relationship: "active" | "recovery";
      goalId: string;
      status: GoalStatus;
      updatedAt: string;
    }
  | {
      source: "chat";
      status: "working" | "paused" | "completed" | "failed" | "canceled";
      updatedAt: string;
    }
  | {
      source: "idle";
      status: "idle";
      updatedAt: string;
    };

export type ChatSessionTokenUsage = {
  totalTokens: number;
  promptTokens?: number;
  completionTokens?: number;
  estimated: boolean;
  breakdown?: {
    chatTokens: number;
    planTokens: number;
    goalTokens: number;
  };
};

export type ChatSessionContextSnapshot = AgentContextUsage & {
  isolation: "session_plus_global_memory";
  sessionMessageCount: number;
  historyMessageCount: number;
  recalledSessionMemories: number;
  recalledGlobalMemories: number;
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
  context?: ChatSessionContextSnapshot;
  archivedAt?: string;
  tokenUsage?: ChatSessionTokenUsage;
  createdAt: string;
  updatedAt: string;
};

export type ChatSessionTranscriptPageOptions = {
  beforeSequence?: number;
  limit?: number;
};

export type ChatSessionTranscriptPage = {
  session: ChatSessionRecord;
  page: {
    startSequence: number;
    endSequence: number;
    totalMessages: number;
    hasMoreBefore: boolean;
  };
};

export type ChatSessionListItem = {
  id: string;
  title: string;
  summary: string;
  messageCount: number;
  workspaceId?: string;
  workspaceSummary?: ChatWorkspaceSummary;
  activeGoal?: ChatSessionGoalSummary;
  recoveryGoal?: ChatSessionGoalSummary;
  work: ChatSessionWorkSummary;
  archivedAt?: string;
  lastAssistantMessageAt?: string;
  tokenUsage?: ChatSessionTokenUsage;
  context?: ChatSessionContextSnapshot;
  updatedAt: string;
};

export type ChatSessionOperationResult =
  | { ok: true; session?: ChatSessionRecord }
  | { ok: false; message: string };

export type SendChatMessageInput = {
  sessionId?: string;
  requestId?: string;
  message: string;
  mode?: "chat" | "goal_draft" | "goal_plan";
  planMode?: PlanMode;
  planAutonomyMode?: PlanAutonomyMode;
  planModelAssignments?: PlanModelAssignments;
  selectedSkillName?: string;
  workspaceId?: string;
  workspaceSummary?: ChatWorkspaceSummary;
  history?: ChatHistoryMessage[];
  attachments?: ChatAttachmentInput[];
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
  requestId?: string;
  values: Record<string, string | number | boolean>;
};

export type SkillPendingInputState = {
  inputRequestId: string;
  status: "pending" | "processing" | "completed";
  inputRequest?: SkillUserInputRequest;
  sessionId: string;
  requestId: string;
  userMessage: string;
  userMessageId?: string;
  selectedSkillName: string;
  workspaceId?: string;
  workspaceSummary?: ChatWorkspaceSummary;
  partialValues: Record<string, string | number | boolean>;
  attachments?: ChatAttachmentMetadata[];
  /** Local-only payload checkpoint used to resume guided input after restart. */
  attachmentPayloads?: ChatAttachmentInput[];
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
      state: "failed";
      runId?: string;
      toolCallsExecuted: number;
      message: string;
    }
  | {
      state: "paused";
      runId?: string;
      reason:
        | "turn_limit"
        | "tool_failure_loop"
        | "strategy_guard"
        | "provider_output_limit"
        | "provider_rate_limit"
        | "provider_quota"
        | "provider_stop";
      maxTurns: number;
      toolCallsExecuted: number;
      message: string;
      modelServiceNotice?: ModelServiceNotice;
    };

export type ChatTaskStatusEvent = {
  sessionId: string;
  /** Present on newly emitted events; optional only for persisted v1 records. */
  requestId?: string;
  /** Monotonic within one request across status and stream events. */
  sequence?: number;
  turnId?: string;
  state:
    | "started"
    | "workspace"
    | "skill"
    | "skill_load"
    | "memory"
    | "memory_scope"
    | "history"
    | "context"
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
  context?: ChatSessionContextSnapshot;
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
    | "context_compacted"
    | "acceptance_manifest_created"
    | "acceptance_failure_classified"
    | "acceptance_repair_scheduled"
    | "acceptance_strategy_changed"
    | "acceptance_retry_scheduled"
    | "acceptance_retry_started"
    | "acceptance_retry_exhausted"
    | "acceptance_waiting_for_user"
    | "acceptance_manual_completion_requested"
    | "acceptance_manual_completion_recorded"
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

export type ChatErrorCode =
  | "CANCELED"
  | "EMPTY_MESSAGE"
  | "SKILL_INPUT_REQUIRED"
  | "UNKNOWN_SKILL_INPUT"
  | "ATTACHMENT_EXPIRED"
  | "INVALID_ATTACHMENT"
  | "MODEL_UNAVAILABLE"
  | "TRANSPORT_ERROR"
  | "CONFLICT"
  | "INTERNAL_ERROR";

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
      plan?: PlanRecord;
      selectedSkill?: {
        name: string;
        displayName: string;
      };
    }
  | {
      ok: false;
      message: string;
      code?: ChatErrorCode;
      retryable?: boolean;
    };
