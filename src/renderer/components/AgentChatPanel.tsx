import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type {
  AgentBootstrapValidationReport,
  AgentBootstrapValidationSnapshot,
} from "../../shared/agentBootstrap";
import {
  buildAgentOnboardingState,
  type AgentOnboardingAction,
} from "../../shared/agentOnboarding";
import { buildAgentDataBoundary } from "../../shared/dataBoundary";
import {
  buildFirstRunGuide,
  type FirstRunGuideAction,
} from "../../shared/firstRunGuide";
import { buildAgentReadinessChecklist } from "../../shared/agentReadiness";
import type { AgentRunEvent, AgentRunRecord } from "../../shared/agentRuns";
import type { AgentWorkspace } from "../../shared/agentWorkspace";
import type {
  ChatAttachmentInput,
  ChatAttachmentMetadata,
  ChatAgentStatus,
  ChatHistoryMessage,
  ChatSessionGoalSummary,
  ChatSessionListItem,
  ChatSessionRecord,
  ChatStreamEvent,
  ChatTaskStatusEvent,
  SendChatMessageResult,
  SkillInputField,
  SkillUserInputRequest,
} from "../../shared/chat";
import {
  formatChatAttachmentSize,
  formatChatAttachmentTypeLabel,
} from "../../shared/chatAttachments";
import type { Goal, SuccessCriterion } from "../../shared/agentGoal";
import type { GoalDraft } from "../../shared/goalTranslation";
import type { MemoryRecord } from "../../shared/memory";
import type { PublicModelSettings } from "../../shared/modelSettings";
import type { NavigationSectionId } from "../../shared/navigation";
import type { ScheduledTask } from "../../shared/scheduledTasks";
import {
  extractActiveSkillMention,
  matchSkillMentionCandidates,
  replaceActiveSkillMention,
  type SkillMentionCandidate,
} from "../../shared/skillMentions";
import {
  createDemoValidationSnapshot,
  demoMemories,
  demoModelSettings,
  demoRuns,
  demoTasks,
} from "../demoAgentData";
import {
  loadPreviewValidationSnapshot,
  savePreviewValidationSnapshot,
} from "../agentValidationPreviewStore";
import {
  buildAgentWorkSteps,
  type AgentWorkPhase,
  type AgentWorkStep,
} from "../agentWorkStatus";
import {
  parseInlineMarkdown,
  parseMarkdownBlocks,
  type MarkdownBlock,
} from "../chatMarkdown";
import {
  createMarkdownPreview,
  shouldRenderMarkdownPreview,
} from "../chatMarkdownPreview";
import {
  isChatSessionSelectionCurrent,
  rollbackFailedAttachmentTurn,
  shouldApplyPersistedSessionRefresh,
  shouldApplySequencedSessionResult,
  type ChatSessionSelectionContext,
} from "../chatSessionReconciliation";
import {
  buildRequirementProcessItems,
  buildSubagentProcessItems,
  buildTaskProcessItems,
  buildTaskActivityDetail,
  buildTaskActivityFromStatusEvent,
  buildGoalTaskActivity,
  createTaskActivity,
  getChatStatusKindFromStatusEvent,
  getGoalUiSyncState,
  getWorkPhaseFromChatStatusEvent,
  idleTaskActivity,
  restoreChatTaskActivity,
  type RequirementProcessItem,
  type TaskActivityState,
  type SubagentProcessItem,
} from "../chatTaskActivity";
import { buildGoalBudgetIncreaseDelta } from "../goalProgressViewModel";
import {
  createGoalAcceptanceOperationToken,
  doesGoalAcceptanceOperationOwnPending,
  getConfirmedManualCompletionGoalId,
  isGoalAcceptanceOperationCurrent,
  isGoalAcceptanceResultForOperation,
  projectGoalAcceptanceOperationOutcome,
  type GoalAcceptanceOperationToken,
  type GoalAcceptanceUiContext,
  type ManualCompletionConfirmation,
} from "../goalAcceptanceInteraction";
import {
  applyChatStreamEvent,
  createChatStreamState,
  finalizeChatStreamResult,
  type ChatToolCallPreview,
  type ChatStreamMessage,
} from "../chatStreamReducer";
import {
  outputPartsFromMessage,
  type RenderedOutputPart,
} from "../chatOutputModel";
import { formatChatMessageTime } from "../chatMessageTime";
import { AnswerBlock } from "./chat/AnswerBlock";
import { GoalDetailDrawer } from "./GoalDetailDrawer";
import { GoalStatusStrip } from "./GoalStatusStrip";
import { Icon, type IconName } from "./Icon";
import { useDialogFocusTrap } from "./useDialogFocusTrap";
import type {
  ToolApprovalDecisionPayload,
  ToolApprovalRequestPayload,
} from "../../shared/toolApproval";
import { shouldShowToolApproval } from "../toolApprovalVisibility";
import {
  ChatAttachmentReadError,
  readPastedChatAttachments,
} from "../chatAttachmentPaste";

type AgentChatPanelProps = {
  newChatRequestKey?: number;
  requestedSessionId?: string | null;
  activeChatSessionTitle?: string | null;
  onActiveSessionChange?: (sessionId: string | null) => void;
  onChatSessionsChange?: (sessions: ChatSidebarSession[]) => void;
  onNavigate: (sectionId: NavigationSectionId) => void;
};

type ChatMessage = ChatStreamMessage;

type VisibleChatMessage =
  | (ChatMessage & { role: "user" })
  | (Omit<ChatMessage, "outputParts"> & {
      role: "assistant";
      outputParts: RenderedOutputPart[];
    });

type SuccessfulChatResult = Extract<SendChatMessageResult, { ok: true }>;

type ChatStatus = {
  kind: "ready" | "working" | "paused" | "error";
  message: string;
};

type ChatSession = {
  id: string;
  title: string;
  summary: string;
  activeGoal?: ChatSessionGoalSummary;
  messageCount?: number;
} & Pick<
  ChatSessionListItem,
  | "updatedAt"
  | "archivedAt"
  | "lastAssistantMessageAt"
  | "tokenUsage"
  | "workspaceId"
  | "workspaceSummary"
>;

export type ChatSidebarSession = ChatSession;

type WorkspaceMenuPosition = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: "above" | "below";
};

const fallbackSessions: ChatSession[] = [
  {
    id: "main",
    title: "当前会话",
    summary: "直接发指令给本地智能体",
    messageCount: 0,
    updatedAt: new Date().toISOString(),
  },
  {
    id: "files",
    title: "文件整理会话",
    summary: "整理下载目录并写报告",
    messageCount: 2,
    updatedAt: new Date().toISOString(),
    tokenUsage: { totalTokens: 1280, estimated: true },
  },
  {
    id: "research",
    title: "资料调研会话",
    summary: "搜索、抓取、总结网页",
    messageCount: 2,
    updatedAt: new Date().toISOString(),
    tokenUsage: { totalTokens: 2430, estimated: true },
  },
];
const initialMessages: ChatMessage[] = [];
const MAX_RENDERED_RUNTIME_EVENTS = 80;
const MESSAGE_LIST_BOTTOM_THRESHOLD_PX = 96;
const composerRiskTooltips = {
  auto:
    "自动授权：普通文件、Shell 和网络操作默认放行；数据破坏、提权、密钥外传、生产发布和对外发送仍需确认。",
  goal:
    "目标模式：自动开启并锁定自动授权，智能体会持续执行和验收；仅 Policy B 极高危操作需要确认。",
} as const;

export function AgentChatPanel({
  newChatRequestKey = 0,
  requestedSessionId = null,
  activeChatSessionTitle = null,
  onActiveSessionChange,
  onChatSessionsChange,
  onNavigate,
}: AgentChatPanelProps) {
  const dataBoundary = buildAgentDataBoundary(
    window.buildingAgent ? "desktop" : "preview",
  );
  const [chatStreamState, setChatStreamState] = useState(() =>
    createChatStreamState(initialMessages),
  );
  const messages = chatStreamState.messages;
  const visibleChatMessages = useMemo<VisibleChatMessage[]>(
    () => {
      const visibleMessages: VisibleChatMessage[] = [];
      for (const message of messages) {
        if (message.role === "assistant") {
          const outputParts = outputPartsFromMessage(message);
          if (outputParts.length > 0) {
            visibleMessages.push({ ...message, role: "assistant", outputParts });
          }
          continue;
        }

        visibleMessages.push({ ...message, role: "user" });
      }

      return visibleMessages;
    },
    [messages],
  );
  const pendingInputRequest = chatStreamState.pendingInputRequest;
  const [draft, setDraft] = useState("");
  const [draftCursor, setDraftCursor] = useState(0);
  const draftRef = useRef("");
  const draftCursorRef = useRef(0);
  const [draftAttachments, setDraftAttachments] = useState<ChatAttachmentInput[]>([]);
  const draftAttachmentsRef = useRef<ChatAttachmentInput[]>([]);
  const [attachmentReadPending, setAttachmentReadPending] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [attachmentAnnouncement, setAttachmentAnnouncement] = useState("");
  const [goalModeEnabled, setGoalModeEnabled] = useState(false);
  const [pendingGoalDraft, setPendingGoalDraft] = useState<GoalDraft | null>(
    null,
  );
  const [goalDraftDescription, setGoalDraftDescription] = useState("");
  const [goalDraftCriteriaText, setGoalDraftCriteriaText] = useState("");
  const [goalDraftActionPending, setGoalDraftActionPending] = useState<
    "confirm" | "discard" | null
  >(null);
  const goalDraftActionPendingRef = useRef<{
    action: "confirm" | "discard";
    sequence: number;
  } | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>(fallbackSessions);
  const [tasks, setTasks] = useState<ScheduledTask[]>(demoTasks);
  const [runs, setRuns] = useState<AgentRunRecord[]>(demoRuns);
  const [memories, setMemories] = useState<MemoryRecord[]>(demoMemories);
  const [workspaces, setWorkspaces] = useState<AgentWorkspace[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    null,
  );
  const [workspaceActionPending, setWorkspaceActionPending] = useState<
    "open" | "create" | null
  >(null);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [workspaceSearch, setWorkspaceSearch] = useState("");
  const [workspaceMenuPosition, setWorkspaceMenuPosition] =
    useState<WorkspaceMenuPosition>({
      top: 0,
      left: 0,
      width: 420,
      maxHeight: 360,
      placement: "above",
    });
  const [modelSettings, setModelSettings] =
    useState<PublicModelSettings>(demoModelSettings);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [skillCount, setSkillCount] = useState(1);
  const [skillOptions, setSkillOptions] = useState<SkillMentionCandidate[]>([]);
  const [selectedSkillName, setSelectedSkillName] = useState<string | null>(null);
  const [lastValidationSnapshot, setLastValidationSnapshot] =
    useState<AgentBootstrapValidationSnapshot | null>(null);
  const [workPhase, setWorkPhase] = useState<AgentWorkPhase>("idle");
  const [status, setStatus] = useState<ChatStatus>({
    kind: "ready",
    message: "会话已就绪",
  });
  const [taskActivity, setTaskActivity] =
    useState<TaskActivityState>(idleTaskActivity);
  const [taskProcessEvents, setTaskProcessEvents] = useState<ChatTaskStatusEvent[]>(
    [],
  );
  const [goalRunEvents, setGoalRunEvents] = useState<AgentRunEvent[]>([]);
  const [autoApprovalEnabled, setAutoApprovalEnabled] = useState(false);
  const [autoApprovalLocked, setAutoApprovalLocked] = useState(false);
  const [pendingToolApprovals, setPendingToolApprovals] = useState<
    ToolApprovalRequestPayload[]
  >([]);
  const pendingToolApproval = pendingToolApprovals[0] ?? null;
  const [toolApprovalEvents, setToolApprovalEvents] = useState<
    ToolApprovalDecisionPayload[]
  >([]);
  const [activeGoalDetail, setActiveGoalDetail] = useState<Goal | null>(null);
  const [goalDrawerOpen, setGoalDrawerOpen] = useState(false);
  const [goalAcceptanceOperationPending, setGoalAcceptanceOperationPending] =
    useState<"continue_acceptance" | "mark_completed_unverified" | null>(null);
  const [activeChatRequestId, setActiveChatRequestId] = useState<string | null>(
    null,
  );
  const [guidedInputValues, setGuidedInputValues] = useState<
    Record<string, string | number | boolean>
  >({});
  const [chatStatusExpanded, setChatStatusExpanded] = useState(false);
  const [activityTick, setActivityTick] = useState(Date.now());
  const [messageTimeTick, setMessageTimeTick] = useState(Date.now());
  const messageListRef = useRef<HTMLDivElement>(null);
  const shouldStickToLatestMessageRef = useRef(true);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const sessionIdRef = useRef<string | null>(sessionId);
  const sessionSelectionGenerationRef = useRef(0);
  const sessionListRefreshSequenceRef = useRef(0);
  const goalDetailRefreshSequenceRef = useRef(0);
  const goalMutationSequenceRef = useRef(0);
  const sessionLoadPendingRef = useRef<number | null>(null);
  const activeStatusSessionIdRef = useRef<string | null>(null);
  const activeChatRequestIdRef = useRef<string | null>(null);
  const pendingInputRequestRef = useRef<SkillUserInputRequest | null>(null);
  const activeGoalRef = useRef<ChatSessionGoalSummary | null>(null);
  const goalAcceptanceOperationPendingRef =
    useRef<GoalAcceptanceOperationToken | null>(null);
  const goalAcceptanceOperationSequenceRef = useRef(0);
  const goalAcceptanceContextRef = useRef<{
    identity: string;
    context: GoalAcceptanceUiContext;
  }>({
    identity: "",
    context: { goalId: null, sessionId: null, generation: 0 },
  });
  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const measureWorkspaceMenuPosition = useCallback(() => {
    const trigger = workspaceMenuRef.current;
    if (!trigger) {
      return;
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const viewportMargin = 16;
    const triggerRect = trigger.getBoundingClientRect();
    const availableWidth = Math.max(240, viewportWidth - viewportMargin * 2);
    const width = clampNumber(
      Math.max(triggerRect.width, Math.min(420, availableWidth)),
      Math.min(280, availableWidth),
      availableWidth,
    );
    const left = clampNumber(
      triggerRect.left,
      viewportMargin,
      Math.max(viewportMargin, viewportWidth - width - viewportMargin),
    );
    const spaceAbove = triggerRect.top - viewportMargin;
    const spaceBelow = viewportHeight - triggerRect.bottom - viewportMargin;
    const placement = spaceBelow >= 300 || spaceBelow > spaceAbove
      ? "below"
      : "above";
    const availableHeight =
      (placement === "below" ? spaceBelow : spaceAbove) - 8;
    const minimumHeight = Math.min(
      180,
      Math.max(120, viewportHeight - viewportMargin * 2),
    );
    const maximumHeight = Math.max(
      minimumHeight,
      Math.min(440, viewportHeight - viewportMargin * 2),
    );
    const maxHeight = clampNumber(availableHeight, minimumHeight, maximumHeight);
    const rawTop =
      placement === "below"
        ? triggerRect.bottom + 8
        : triggerRect.top - maxHeight - 8;
    const top = clampNumber(
      rawTop,
      viewportMargin,
      Math.max(viewportMargin, viewportHeight - maxHeight - viewportMargin),
    );

    setWorkspaceMenuPosition({
      top,
      left,
      width,
      maxHeight,
      placement,
    });
  }, []);

  const scrollMessageListToBottom = useCallback(() => {
    const messageList = messageListRef.current;
    if (!messageList) {
      return;
    }
    messageList.scrollTop = messageList.scrollHeight;
    shouldStickToLatestMessageRef.current = true;
  }, []);

  const handleMessageListScroll = useCallback(() => {
    const messageList = messageListRef.current;
    if (!messageList) {
      return;
    }
    shouldStickToLatestMessageRef.current = isNearMessageListBottom(messageList);
  }, []);

  useEffect(() => {
    if (!shouldStickToLatestMessageRef.current) {
      return;
    }
    scrollMessageListToBottom();
  }, [
    chatStreamState.thinkingText,
    chatStreamState.toolCallPreviews.length,
    goalRunEvents.length,
    messages,
    pendingInputRequest,
    pendingToolApproval,
    scrollMessageListToBottom,
  ]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
    onActiveSessionChange?.(sessionId);
  }, [onActiveSessionChange, sessionId]);

  useEffect(() => {
    const previousInputRequest = pendingInputRequestRef.current;
    pendingInputRequestRef.current = pendingInputRequest;
    setGuidedInputValues((current) => {
      if (!pendingInputRequest) {
        return {};
      }
      return {
        ...createGuidedInputInitialValues(pendingInputRequest.fields),
        ...(previousInputRequest?.id === pendingInputRequest.id ? current : {}),
      };
    });
  }, [pendingInputRequest]);

  useEffect(() => {
    setChatStatusExpanded(false);
  }, [status.message]);

  useEffect(() => {
    if (!workspaceMenuOpen) {
      return;
    }

    function handleDocumentMouseDown(event: MouseEvent) {
      const target = event.target;
      if (
        target instanceof Node &&
        workspaceMenuRef.current?.contains(target)
      ) {
        return;
      }

      setWorkspaceMenuOpen(false);
    }

    document.addEventListener("mousedown", handleDocumentMouseDown);
    return () => {
      document.removeEventListener("mousedown", handleDocumentMouseDown);
    };
  }, [workspaceMenuOpen]);

  useLayoutEffect(() => {
    if (!workspaceMenuOpen) {
      return;
    }

    measureWorkspaceMenuPosition();
    window.addEventListener("resize", measureWorkspaceMenuPosition);
    window.addEventListener("scroll", measureWorkspaceMenuPosition, true);
    window.visualViewport?.addEventListener(
      "resize",
      measureWorkspaceMenuPosition,
    );
    return () => {
      window.removeEventListener("resize", measureWorkspaceMenuPosition);
      window.removeEventListener("scroll", measureWorkspaceMenuPosition, true);
      window.visualViewport?.removeEventListener(
        "resize",
        measureWorkspaceMenuPosition,
      );
    };
  }, [measureWorkspaceMenuPosition, workspaceMenuOpen]);

  useLayoutEffect(() => {
    resetActiveChatRefs();
    sessionLoadPendingRef.current = null;
    sessionSelectionGenerationRef.current += 1;
    sessionIdRef.current = null;
    setSessionId(null);
    setChatStreamState(createChatStreamState(initialMessages));
    setStatus({ kind: "ready", message: "会话已就绪" });
    setWorkPhase("idle");
    setTaskActivity(idleTaskActivity);
    setTaskProcessEvents([]);
    setGoalRunEvents([]);
    setSelectedSkillName(null);
    setPendingGoalDraft(null);
    setGoalDraftDescription("");
    setGoalDraftCriteriaText("");
    goalDraftActionPendingRef.current = null;
    setGoalDraftActionPending(null);
    setSelectedWorkspaceId(null);
    setWorkspaceMenuOpen(false);
    setWorkspaceSearch("");
    setActiveGoalDetail(null);
    setGoalDrawerOpen(false);
    goalAcceptanceOperationPendingRef.current = null;
    setGoalAcceptanceOperationPending(null);
  }, [newChatRequestKey]);

  useLayoutEffect(() => {
    if (!requestedSessionId || requestedSessionId === sessionId) {
      return;
    }

    if (window.buildingAgent) {
      void loadPersistedSession(requestedSessionId);
      return;
    }

    resetActiveChatRefs();
    setSessionId(requestedSessionId);
    setMessages(initialMessages);
  }, [requestedSessionId, sessionId]);

  useEffect(() => {
    if (!window.buildingAgent) {
      return;
    }

    return window.buildingAgent.onGoalProgressEvent((event) => {
      const activeGoalId = activeGoalRef.current?.id;
      const activeSessionId = sessionIdRef.current;
      const eventBelongsToActiveGoal =
        event.goalId === activeGoalId || event.sessionId === activeSessionId;
      if (eventBelongsToActiveGoal) {
        const goalUiState = getGoalUiSyncState(event.status);
        const description =
          activeGoalRef.current?.id === event.goalId
            ? activeGoalRef.current.description
            : event.message;
        setActiveGoalDetail((currentGoal) =>
          currentGoal?.id === event.goalId
            ? { ...currentGoal, status: event.status }
            : currentGoal,
        );
        void refreshActiveGoalDetail(event.goalId);
        setStatus({ kind: goalUiState.statusKind, message: event.message });
        setWorkPhase(goalUiState.workPhase);
        setTaskActivity(
          buildGoalTaskActivity({
            status: event.status,
            description,
          }),
        );
        setSessions((currentSessions) =>
          currentSessions.map((session) => {
            if (session.activeGoal?.id !== event.goalId) {
              return session;
            }
            return {
              ...session,
              activeGoal: {
                ...session.activeGoal,
                status: event.status,
              },
            };
          }),
        );
        if (goalUiState.shouldClearActiveRequest) {
          activeStatusSessionIdRef.current = null;
          setActiveChatRequest(null);
        }
      }
      if (eventBelongsToActiveGoal) {
        void refreshSessions(event.sessionId ?? activeSessionId ?? undefined);
        if (isTerminalGoalStatus(event.status)) {
          void refreshCurrentSessionMessages(
            event.sessionId ?? activeSessionId ?? undefined,
          );
        }
      }
    });
  }, []);

  useEffect(() => {
    if (!window.buildingAgent) {
      return;
    }

    void window.buildingAgent
      .getToolApprovalMode()
      .then((state) => {
        setAutoApprovalEnabled(state.autoApprovalEnabled);
        setAutoApprovalLocked(state.autoApprovalLocked);
        setGoalModeEnabled(state.goalModeEnabled);
      })
      .catch(() => undefined);
    const unsubscribeRequest = window.buildingAgent.onToolApprovalRequest(
      (request) => {
        setPendingToolApprovals((current) =>
          current.some((candidate) => candidate.id === request.id)
            ? current
            : [...current, request],
        );
      },
    );
    const unsubscribeDecision = window.buildingAgent.onToolApprovalDecision(
      (decision) => {
        setPendingToolApprovals((current) =>
          current.filter((candidate) => candidate.id !== decision.id),
        );
        setToolApprovalEvents((current) => [...current.slice(-9), decision]);
      },
    );
    const unsubscribeMode = window.buildingAgent.onToolApprovalModeChanged(
      (state) => {
        setAutoApprovalEnabled(state.autoApprovalEnabled);
        setAutoApprovalLocked(state.autoApprovalLocked);
        setGoalModeEnabled(state.goalModeEnabled);
      },
    );

    return () => {
      unsubscribeRequest();
      unsubscribeDecision();
      unsubscribeMode();
    };
  }, []);

  useEffect(() => {
    if (!window.buildingAgent) {
      return;
    }

    return window.buildingAgent.onGoalMilestoneRunEvent((event) => {
      setGoalRunEvents((current) => appendBoundedRuntimeEvent(current, event));
    });
  }, []);

  useEffect(() => {
    if (!window.buildingAgent) {
      return;
    }

    return window.buildingAgent.onChatStreamEvent((event) => {
      if (event.type === "status") {
        return;
      }

      const activeStream = {
        activeSessionId: activeStatusSessionIdRef.current ?? sessionIdRef.current,
        activeRequestId:
          activeChatRequestIdRef.current ??
          pendingInputRequestRef.current?.requestId ??
          null,
      };
      if (!chatStreamEventMatchesActive(event, activeStream)) {
        return;
      }

      activeStatusSessionIdRef.current = event.sessionId;
      setSessionId((current) => current ?? event.sessionId);
      setChatStreamState((current) =>
        applyChatStreamEvent(current, event, activeStream),
      );

      if (
        event.type === "answer_delta" ||
        event.type === "thinking_delta" ||
        event.type === "tool_call_preview"
      ) {
        setStatus({ kind: "working", message: "正在输出回复" });
        setWorkPhase("model");
        setTaskActivity(
          createTaskActivity({
            kind: "working",
            title: "正在输出回复",
            detail: "正在输出回复",
          }),
        );
      }

      if (event.type === "waiting_for_input") {
        setStatus({
          kind: "paused",
          message: event.inputRequest.reason || "等待技能输入",
        });
        setWorkPhase("paused");
        setTaskActivity(
          createTaskActivity({
            kind: "paused",
            title: "等待技能输入",
            detail: event.inputRequest.reason || "等待技能输入",
          }),
        );
        setActiveChatRequest(null);
      }

      if (event.type === "failed" || event.type === "canceled") {
        setActiveChatRequest(null);
      }
    });
  }, []);

  useEffect(() => {
    if (!window.buildingAgent) {
      return;
    }

    return window.buildingAgent.onChatTaskStatusEvent((event) => {
      const activeSessionId = activeStatusSessionIdRef.current;
      const currentSessionId = sessionIdRef.current;
      if (activeSessionId && event.sessionId !== activeSessionId) {
        return;
      }
      if (!activeSessionId && currentSessionId && event.sessionId !== currentSessionId) {
        return;
      }

      activeStatusSessionIdRef.current = event.sessionId;
      setSessionId((current) => current ?? event.sessionId);
      setTaskProcessEvents((current) => appendBoundedRuntimeEvent(current, event));
      setTaskActivity(buildTaskActivityFromStatusEvent(event));
      setStatus({
        kind: getChatStatusKindFromStatusEvent(event),
        message: event.message,
      });
      setWorkPhase(getWorkPhaseFromChatStatusEvent(event));
      if (event.state === "waiting_for_input" && event.inputRequest) {
        setPendingInputRequest(event.inputRequest);
      }
      if (
        event.state === "paused" ||
        event.state === "waiting_for_input" ||
        event.state === "canceled" ||
        event.state === "completed" ||
        event.state === "failed"
      ) {
        setActiveChatRequest(null);
      }
    });
  }, []);

  useEffect(() => {
    if (taskActivity.kind !== "working") {
      return;
    }

    setActivityTick(Date.now());
    const intervalId = window.setInterval(() => {
      setActivityTick(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [taskActivity.kind, taskActivity.startedAt]);

  useEffect(() => {
    if (messages.length === 0) {
      return;
    }

    setMessageTimeTick(Date.now());
    const intervalId = window.setInterval(() => {
      setMessageTimeTick(Date.now());
    }, 30_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [messages.length]);

  useEffect(() => {
    if (!window.buildingAgent) {
      const snapshot = loadPreviewValidationSnapshot(window.localStorage);
      if (snapshot) {
        setLastValidationSnapshot(snapshot);
      }
      setStatus({
        kind: "ready",
        message: "浏览器预览模式，正在展示演示会话",
      });
      return;
    }

    Promise.all([
      window.buildingAgent.loadModelSettings(),
      window.buildingAgent.listScheduledTasks(),
      window.buildingAgent.listAgentRuns(),
      window.buildingAgent.listMemories({ limit: 6 }),
      window.buildingAgent.listSkills(),
      window.buildingAgent.listAgentWorkspaces(),
      window.buildingAgent.listChatSessions(),
      window.buildingAgent.loadAgentValidation(),
    ])
      .then(
        async ([
          settings,
          loadedTasks,
          loadedRuns,
          loadedMemories,
          skills,
          loadedWorkspaces,
          loadedSessions,
          validation,
        ]) => {
        setModelSettings(settings);
        setTasks(loadedTasks);
        setRuns(loadedRuns);
        setMemories(loadedMemories);
        setSkillCount(skills.skills.length);
        setSkillOptions(skills.skills.map(toSkillMentionCandidate));
        setWorkspaces(loadedWorkspaces);
        if (validation.ok && validation.snapshot) {
          setLastValidationSnapshot(validation.snapshot);
        }
        const nextSessions = loadedSessions.map(toSessionRailItem);
        setSessions(nextSessions);
        onChatSessionsChange?.(nextSessions);
        setStatus({
          kind: "ready",
          message: settings.hasApiKey ? "模型已配置" : "还需要配置模型密钥",
        });
      })
      .catch((error) => {
        setStatus({
          kind: "error",
          message:
            error instanceof Error ? error.message : "读取智能体状态失败",
        });
      });
  }, [onChatSessionsChange]);

  async function loadPersistedSession(sessionIdToLoad: string) {
    if (!window.buildingAgent) {
      return;
    }

    resetActiveChatRefs();
    shouldStickToLatestMessageRef.current = false;
    const loadGeneration = sessionSelectionGenerationRef.current + 1;
    sessionSelectionGenerationRef.current = loadGeneration;
    sessionLoadPendingRef.current = loadGeneration;
    sessionIdRef.current = sessionIdToLoad;
    setSessionId(sessionIdToLoad);
    // Drafts and their pending actions belong to the previous session. Clear
    // them synchronously so an old in-flight completion cannot strand or
    // expose session-scoped controls while the next transcript is loading.
    setPendingGoalDraft(null);
    setGoalDraftDescription("");
    setGoalDraftCriteriaText("");
    goalDraftActionPendingRef.current = null;
    setGoalDraftActionPending(null);
    setActiveGoalDetail(null);
    setSelectedWorkspaceId(null);
    setChatStreamState(createChatStreamState([]));
    setWorkPhase("idle");
    setStatus({ kind: "working", message: "正在加载会话..." });
    setTaskActivity(
      createTaskActivity({
        kind: "working",
        title: "正在加载会话",
        detail: "正在读取本地会话记录",
      }),
    );
    setTaskProcessEvents([]);
    setGoalRunEvents([]);
    activeStatusSessionIdRef.current = null;

    try {
      const loadedSession = await window.buildingAgent.getChatSession(sessionIdToLoad);
      if (
        !shouldApplyPersistedSessionRefresh(
          sessionIdRef.current,
          sessionIdToLoad,
          sessionSelectionGenerationRef.current,
          loadGeneration,
        )
      ) {
        return;
      }
      if (!loadedSession) {
        setStatus({ kind: "error", message: "会话不存在或已被删除。" });
        setTaskActivity(idleTaskActivity);
        return;
      }

      setSessionId(loadedSession.id);
      setSelectedWorkspaceId(loadedSession.workspaceId ?? null);
      const restoredActivity = restoreChatTaskActivity(loadedSession.activity);
      setChatStreamState({
        ...createChatStreamState(loadedSession.messages.map(toChatMessage)),
        pendingInputRequest: restoredActivity?.pendingInputRequest ?? null,
      });
      if (restoredActivity) {
        setWorkPhase(restoredActivity.workPhase);
        setStatus(restoredActivity.status);
        setTaskActivity(restoredActivity.taskActivity);
        setTaskProcessEvents(
          restoredActivity.taskProcessEvents.slice(-MAX_RENDERED_RUNTIME_EVENTS),
        );
        activeStatusSessionIdRef.current = loadedSession.id;
      } else {
        setWorkPhase("idle");
        setStatus({ kind: "ready", message: "会话已加载" });
        setTaskActivity(idleTaskActivity);
        setTaskProcessEvents([]);
        activeStatusSessionIdRef.current = null;
      }
      if (loadedSession.activeGoalId) {
        const loadedGoal = await window.buildingAgent.getGoal(loadedSession.activeGoalId);
        if (
          sessionSelectionGenerationRef.current !== loadGeneration ||
          sessionIdRef.current !== sessionIdToLoad
        ) {
          return;
        }
        setActiveGoalDetail(loadedGoal);
      } else {
        setActiveGoalDetail(null);
        setGoalDrawerOpen(false);
      }
    } catch (error) {
      if (
        sessionSelectionGenerationRef.current === loadGeneration &&
        sessionIdRef.current === sessionIdToLoad
      ) {
        setStatus({
          kind: "error",
          message: error instanceof Error ? error.message : "加载会话失败。",
        });
        setTaskActivity(idleTaskActivity);
      }
    } finally {
      if (sessionLoadPendingRef.current === loadGeneration) {
        sessionLoadPendingRef.current = null;
      }
    }
  }

  async function refreshSessions(nextActiveSessionId?: string) {
    if (!window.buildingAgent) {
      return;
    }

    const refreshGeneration = sessionSelectionGenerationRef.current;
    const refreshSequence = sessionListRefreshSequenceRef.current + 1;
    sessionListRefreshSequenceRef.current = refreshSequence;
    const loadedSessions = await window.buildingAgent.listChatSessions();
    if (
      refreshGeneration !== sessionSelectionGenerationRef.current ||
      refreshSequence !== sessionListRefreshSequenceRef.current
    ) {
      return;
    }
    const nextSessions = loadedSessions.map(toSessionRailItem);
    setSessions(nextSessions);
    onChatSessionsChange?.(nextSessions);
    if (
      nextActiveSessionId &&
      sessionIdRef.current === nextActiveSessionId
    ) {
      setSessionId(nextActiveSessionId);
    } else if (
      sessionIdRef.current &&
      !nextSessions.some((session) => session.id === sessionIdRef.current)
    ) {
      sessionIdRef.current = null;
      setSessionId(null);
    }
  }

  async function refreshActiveGoalDetail(goalId: string) {
    if (!window.buildingAgent) {
      return;
    }
    const selection = captureSessionSelection();
    const requestSequence = goalDetailRefreshSequenceRef.current + 1;
    goalDetailRefreshSequenceRef.current = requestSequence;
    const goal = await window.buildingAgent.getGoal(goalId);
    if (
      !shouldApplySequencedSessionResult(
        selection,
        sessionIdRef.current,
        sessionSelectionGenerationRef.current,
        requestSequence,
        goalDetailRefreshSequenceRef.current,
      ) ||
      (activeGoalRef.current && activeGoalRef.current.id !== goalId)
    ) {
      return;
    }
    setActiveGoalDetail(goal);
  }

  async function refreshCurrentSessionMessages(sessionIdToRefresh?: string) {
    if (!window.buildingAgent) {
      return;
    }

    const currentSessionId = sessionIdToRefresh ?? sessionIdRef.current;
    if (!currentSessionId) {
      return;
    }
    const refreshGeneration = sessionSelectionGenerationRef.current;
    if (
      !shouldApplyPersistedSessionRefresh(
        sessionIdRef.current,
        currentSessionId,
        sessionSelectionGenerationRef.current,
        refreshGeneration,
      )
    ) {
      return;
    }

    const loadedSession = await window.buildingAgent
      .getChatSession(currentSessionId)
      .catch(() => null);
    if (!loadedSession) {
      return;
    }

    if (
      !shouldApplyPersistedSessionRefresh(
        sessionIdRef.current,
        currentSessionId,
        sessionSelectionGenerationRef.current,
        refreshGeneration,
      )
    ) {
      return;
    }

    if (!sessionIdRef.current) {
      setSessionId(loadedSession.id);
    }
    setMessages(loadedSession.messages.map(toChatMessage));
  }

  function applyGoalSummaryToSessions(goal: ChatSessionGoalSummary) {
    setSessions((currentSessions) => {
      const nextSessions = currentSessions.map((session) =>
        session.activeGoal?.id === goal.id
          ? { ...session, activeGoal: goal }
          : session,
      );
      onChatSessionsChange?.(nextSessions);
      return nextSessions;
    });
  }

  const latestRun = runs[0];
  const activeSession = sessions.find((session) => session.id === sessionId) ?? null;
  const chatTitle = activeChatSessionTitle ?? activeSession?.title ?? "新会话";
  const chatStatusIsLong = status.message.length > 64;
  const chatStateClassName = [
    "chat-state",
    `is-${status.kind}`,
    chatStatusIsLong ? "is-expandable" : "",
    chatStatusExpanded ? "is-expanded" : "",
  ].filter(Boolean).join(" ");
  const activeGoal = activeSession?.activeGoal ?? null;
  activeGoalRef.current = activeGoal;
  const goalAcceptanceContextIdentity = JSON.stringify([
    newChatRequestKey,
    sessionId,
    activeGoal?.id ?? null,
  ]);
  if (goalAcceptanceContextRef.current.identity !== goalAcceptanceContextIdentity) {
    goalAcceptanceContextRef.current = {
      identity: goalAcceptanceContextIdentity,
      context: {
        goalId: activeGoal?.id ?? null,
        sessionId,
        generation: goalAcceptanceContextRef.current.context.generation + 1,
      },
    };
  }
  const goalAcceptanceContext = goalAcceptanceContextRef.current.context;
  useEffect(() => {
    const pending = goalAcceptanceOperationPendingRef.current;
    if (
      pending &&
      !isGoalAcceptanceOperationCurrent(
        pending,
        goalAcceptanceContext,
        pending,
      )
    ) {
      goalAcceptanceOperationPendingRef.current = null;
      setGoalAcceptanceOperationPending(null);
    }
  }, [goalAcceptanceContext]);
  const goalModeVisuallyEnabled = goalModeEnabled;
  const activeTasks = tasks.filter((task) => task.enabled);
  const workSteps = useMemo(() => buildAgentWorkSteps(workPhase), [workPhase]);
  const taskActivityDetail = useMemo(
    () => buildTaskActivityDetail(taskActivity, activityTick),
    [activityTick, taskActivity],
  );
  const taskProcessItems = useMemo(
    () => buildTaskProcessItems(taskProcessEvents),
    [taskProcessEvents],
  );
  const requirementProcessItems = useMemo(
    () => buildRequirementProcessItems(taskProcessEvents),
    [taskProcessEvents],
  );
  const subagentProcessItems = useMemo(
    () => buildSubagentProcessItems(taskProcessEvents),
    [taskProcessEvents],
  );
  const hasActiveSubagents = subagentProcessItems.some((item) => item.status === "running");
  const canCancelChatTask =
    Boolean(window.buildingAgent) &&
    (status.kind === "working" ||
      taskActivity.kind === "working" ||
      activeChatRequestId !== null);
  const canInterruptCurrentWork =
    canCancelChatTask || Boolean(activeGoal?.status === "executing");
  const workspaceActionsDisabled =
    !window.buildingAgent ||
    Boolean(workspaceActionPending) ||
    status.kind === "working";
  const activeSkillMention = useMemo(
    () => extractActiveSkillMention(draft, draftCursor),
    [draft, draftCursor],
  );
  const skillMentionMatches = useMemo(
    () =>
      activeSkillMention
        ? matchSkillMentionCandidates(skillOptions, activeSkillMention.query)
        : [],
    [activeSkillMention, skillOptions],
  );
  const selectedSkill = selectedSkillName
    ? skillOptions.find((skill) => skill.name === selectedSkillName) ?? null
    : null;
  const selectedWorkspace = selectedWorkspaceId
    ? workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null
    : null;
  const activeWorkspaceLabel =
    selectedWorkspace?.name ??
    activeSession?.workspaceSummary?.name ??
    "默认工作区";
  const activeWorkspacePath =
    selectedWorkspace?.rootPath ?? activeSession?.workspaceSummary?.rootPath ?? "";
  const visibleWorkspaces = useMemo(() => {
    const query = workspaceSearch.trim().toLowerCase();
    if (!query) {
      return workspaces;
    }

    return workspaces.filter((workspace) =>
      [workspace.name, workspace.rootPath, workspace.kind]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [workspaceSearch, workspaces]);
  const workspaceMenuStyle = {
    "--workspace-menu-top": `${workspaceMenuPosition.top}px`,
    "--workspace-menu-left": `${workspaceMenuPosition.left}px`,
    "--workspace-menu-width": `${workspaceMenuPosition.width}px`,
    "--workspace-menu-max-height": `${workspaceMenuPosition.maxHeight}px`,
  } as CSSProperties;
  const hasRuntimeSurfaces =
    Boolean(chatStreamState.thinkingText) ||
    chatStreamState.toolCallPreviews.length > 0 ||
    Boolean(pendingGoalDraft) ||
    Boolean(activeGoal) ||
    goalRunEvents.length > 0 ||
    shouldShowToolApproval(pendingToolApproval, autoApprovalEnabled) ||
    Boolean(pendingInputRequest);
  const latestToolCallPreview =
    chatStreamState.toolCallPreviews.at(-1) ?? null;
  const skillMentionMenuVisible =
    Boolean(activeSkillMention) &&
    skillMentionMatches.length > 0 &&
    !(
      selectedSkillName &&
      activeSkillMention?.query.toLowerCase() === selectedSkillName
    );

  useEffect(() => {
    if (!workspaceMenuOpen && !skillMentionMenuVisible) {
      return;
    }

    function handleMenuKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }
      setWorkspaceMenuOpen(false);
      if (skillMentionMenuVisible) {
        setDraft("");
        setDraftCursor(0);
      }
    }

    document.addEventListener("keydown", handleMenuKeyDown);
    return () => {
      document.removeEventListener("keydown", handleMenuKeyDown);
    };
  }, [skillMentionMenuVisible, workspaceMenuOpen]);

  const contextCards = useMemo(
    () => [
      {
        label: "模型",
        value: modelSettings.hasApiKey ? "已配置" : "未配置",
        detail: modelSettings.chatModel || "未填写对话模型",
      },
      {
        label: "技能",
        value: `${skillCount} 个`,
        detail: "本地技能文件",
      },
      {
        label: "任务",
        value: `${activeTasks.length} 个启用`,
        detail: tasks[0]?.name ?? "还没有任务",
      },
      {
        label: "记忆",
        value: `${memories.length} 条`,
        detail: "本地可查看、可删除、可导出",
      },
    ],
    [activeTasks.length, memories.length, modelSettings, skillCount, tasks],
  );
  const progressPanelItems = buildContextProgressItems({
    activeGoalDetail,
    requirementProcessItems,
    taskProcessItems,
    workSteps,
    status,
  });
  const contextPanelItems = buildContextPanelItems({
    contextCards,
    memories,
    activeGoal,
  });
  const shouldShowActivityCard = taskActivity.kind !== "idle";
  const readinessChecklist = useMemo(
    () =>
      buildAgentReadinessChecklist({
        modelSettings,
        tasks,
        runs,
        memories,
        skillCount,
        report: lastValidationSnapshot?.report,
      }),
    [lastValidationSnapshot, memories, modelSettings, runs, skillCount, tasks],
  );
  const onboardingState = useMemo(
    () =>
      buildAgentOnboardingState(
        readinessChecklist,
        lastValidationSnapshot?.validatedAt,
      ),
    [lastValidationSnapshot, readinessChecklist],
  );
  const firstRunGuide = useMemo(
    () => buildFirstRunGuide(readinessChecklist, dataBoundary.mode),
    [dataBoundary.mode, readinessChecklist],
  );
  const showContextPanel =
    (workPhase !== "idle" && workPhase !== "done") ||
    shouldShowActivityCard ||
    Boolean(activeGoal) ||
    Boolean(pendingToolApproval);

  function createMessage(
    message: Omit<ChatMessage, "id" | "createdAt">,
    index: number,
  ): ChatMessage {
    return {
      ...message,
      id: `${message.role}-${Date.now()}-${index}`,
      createdAt: new Date().toISOString(),
    };
  }

  function setMessages(
    updater: ChatMessage[] | ((current: ChatMessage[]) => ChatMessage[]),
  ) {
    setChatStreamState((current) => ({
      ...current,
      messages:
        typeof updater === "function" ? updater(current.messages) : updater,
    }));
  }

  function setPendingInputRequest(request: SkillUserInputRequest | null) {
    setChatStreamState((current) => ({
      ...current,
      pendingInputRequest: request,
    }));
  }

  function resetStreamProcessState() {
    setChatStreamState((current) => ({
      ...current,
      thinkingText: "",
      toolCallPreviews: [],
      pendingInputRequest: null,
    }));
  }

  function appendMessage(message: Omit<ChatMessage, "id" | "createdAt">) {
    setMessages((current) => [...current, createMessage(message, current.length)]);
  }

  function resetActiveChatRefs() {
    activeStatusSessionIdRef.current = null;
    activeChatRequestIdRef.current = null;
    pendingInputRequestRef.current = null;
    setActiveChatRequestId(null);
  }

  function captureSessionSelection(): ChatSessionSelectionContext {
    return {
      sessionId: sessionIdRef.current,
      generation: sessionSelectionGenerationRef.current,
    };
  }

  function isSessionSelectionCurrent(
    captured: ChatSessionSelectionContext,
  ): boolean {
    return isChatSessionSelectionCurrent(
      captured,
      sessionIdRef.current,
      sessionSelectionGenerationRef.current,
    );
  }

  function beginGoalMutation(): number {
    goalMutationSequenceRef.current += 1;
    return goalMutationSequenceRef.current;
  }

  function isGoalMutationCurrent(
    captured: ChatSessionSelectionContext,
    mutationSequence: number,
  ): boolean {
    return (
      mutationSequence === goalMutationSequenceRef.current &&
      isSessionSelectionCurrent(captured)
    );
  }

  function setActiveChatRequest(requestId: string | null) {
    activeChatRequestIdRef.current = requestId;
    setActiveChatRequestId(requestId);
  }

  async function refreshWorkspaces(nextSelectedWorkspaceId?: string | null) {
    if (!window.buildingAgent) {
      return;
    }

    const loadedWorkspaces = await window.buildingAgent.listAgentWorkspaces();
    setWorkspaces(loadedWorkspaces);
    if (nextSelectedWorkspaceId !== undefined) {
      setSelectedWorkspaceId(nextSelectedWorkspaceId);
    }
  }

  function selectWorkspace(workspace: AgentWorkspace) {
    setWorkspaces((current) => [
      workspace,
      ...current.filter((item) => item.id !== workspace.id),
    ]);
    setSelectedWorkspaceId(workspace.id);
    setWorkspaceMenuOpen(false);
    setWorkspaceSearch("");
  }

  function handleSelectDefaultWorkspace() {
    setSelectedWorkspaceId(null);
    setWorkspaceMenuOpen(false);
    setWorkspaceSearch("");
  }

  async function handleOpenProjectWorkspace() {
    if (!window.buildingAgent || workspaceActionsDisabled) {
      return;
    }

    setWorkspaceMenuOpen(false);
    setWorkspaceActionPending("open");
    try {
      const workspace = await window.buildingAgent.openProjectAgentWorkspace();
      if (!workspace) {
        setStatus({ kind: "ready", message: "已取消打开工作区" });
        return;
      }

      selectWorkspace(workspace);
      setStatus({ kind: "ready", message: `已打开工作区：${workspace.name}` });
      void refreshWorkspaces(workspace.id);
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error ? error.message : "打开工作区失败，请稍后重试。",
      });
    } finally {
      setWorkspaceActionPending(null);
    }
  }

  async function handleCreateWorkspace() {
    if (!window.buildingAgent || workspaceActionsDisabled) {
      return;
    }

    setWorkspaceMenuOpen(false);
    setWorkspaceActionPending("create");
    try {
      const workspace = await window.buildingAgent.openProjectAgentWorkspace({
        mode: "create",
      });
      if (!workspace) {
        setStatus({ kind: "ready", message: "已取消新建工作区" });
        return;
      }

      selectWorkspace(workspace);
      setStatus({ kind: "ready", message: `已选择工作区：${workspace.name}` });
      void refreshWorkspaces(workspace.id);
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error ? error.message : "新建工作区失败，请稍后重试。",
      });
    } finally {
      setWorkspaceActionPending(null);
    }
  }

  function setComposerDraft(nextDraft: string, cursor = nextDraft.length) {
    draftRef.current = nextDraft;
    draftCursorRef.current = cursor;
    setDraft(nextDraft);
    setDraftCursor(cursor);
    const input = messageInputRef.current;
    if (input && input.value !== nextDraft) {
      input.value = nextDraft;
    }
    window.requestAnimationFrame(() => {
      messageInputRef.current?.setSelectionRange(cursor, cursor);
    });
  }

  function setComposerAttachments(attachments: ChatAttachmentInput[]) {
    draftAttachmentsRef.current = attachments;
    setDraftAttachments(attachments);
  }

  async function handleComposerPaste(
    event: React.ClipboardEvent<HTMLTextAreaElement>,
  ) {
    const itemFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    const files = itemFiles.length
      ? itemFiles
      : Array.from(event.clipboardData.files);
    if (!files.length) {
      return;
    }
    event.preventDefault();
    if (attachmentReadPending || status.kind === "working") {
      return;
    }
    setAttachmentReadPending(true);
    setAttachmentError(null);
    try {
      const attachments = await readPastedChatAttachments(
        files,
        draftAttachmentsRef.current,
      );
      const nextAttachments = [...draftAttachmentsRef.current, ...attachments];
      setComposerAttachments(nextAttachments);
      setAttachmentAnnouncement(
        `已识别 ${attachments.length} 个粘贴附件，当前共 ${nextAttachments.length} 个`,
      );
      setStatus({
        kind: "ready",
        message: `已识别 ${attachments.length} 个粘贴附件`,
      });
    } catch (error) {
      setAttachmentError(
        error instanceof ChatAttachmentReadError
          ? error.message
          : "无法读取粘贴的附件。",
      );
    } finally {
      setAttachmentReadPending(false);
    }
  }

  function removeDraftAttachment(attachmentId: string) {
    const removedAttachment = draftAttachmentsRef.current.find(
      (attachment) => attachment.id === attachmentId,
    );
    setComposerAttachments(
      draftAttachmentsRef.current.filter((attachment) => attachment.id !== attachmentId),
    );
    setAttachmentError(null);
    setAttachmentAnnouncement(
      removedAttachment ? `已移除附件 ${removedAttachment.name}` : "已移除附件",
    );
  }

  function handlePickPrompt(prompt: string) {
    setComposerDraft(prompt);
    setSelectedSkillName(null);
    window.requestAnimationFrame(() => {
      messageInputRef.current?.focus();
    });
  }

  function updateDraftCursor() {
    const input = messageInputRef.current;
    if (input) {
      draftCursorRef.current = input.selectionStart ?? input.value.length;
      if (draft) {
        setDraftCursor(draftCursorRef.current);
      }
    }
  }

  function handleSelectSkillMention(skill: SkillMentionCandidate) {
    const mention = activeSkillMention;
    const currentDraft = draftRef.current;
    const nextDraft = mention
      ? replaceActiveSkillMention(currentDraft, mention, skill.name)
      : `${currentDraft.trimEnd()} @${skill.name} `;
    setComposerDraft(nextDraft);
    setSelectedSkillName(skill.name);
    window.requestAnimationFrame(() => {
      messageInputRef.current?.focus();
      messageInputRef.current?.setSelectionRange(nextDraft.length, nextDraft.length);
    });
  }

  function handleViewGoalProgress() {
    setGoalDrawerOpen(true);
    if (activeGoal?.id) {
      void refreshActiveGoalDetail(activeGoal.id);
    }
  }

  function handleStartGoal() {
    setGoalDrawerOpen(false);
    void submitUserMessage("继续这个目标");
  }

  async function handleResolveGoalReview(decision: "approve" | "reject" | "terminate") {
    if (!window.buildingAgent || !activeGoal?.id) {
      return;
    }

    const goalId = activeGoal.id;
    const selection = captureSessionSelection();
    const mutationSequence = beginGoalMutation();
    if (decision === "approve") {
      const result = await window.buildingAgent.resolveGoalReview(goalId, {
        kind: "approve_continue",
      });
      if (!isGoalMutationCurrent(selection, mutationSequence)) {
        return;
      }
      if (result.ok && result.goal) {
        applyGoalSummaryToSessions(result.goal);
        setStatus({ kind: "working", message: "目标继续执行" });
        setWorkPhase("tool");
        setTaskActivity(
          buildGoalTaskActivity({
            status: result.goal.status,
            description: result.goal.description,
          }),
        );
        void refreshActiveGoalDetail(goalId);
        void refreshSessions(sessionId ?? undefined);
      }
      appendMessage({
        role: "assistant",
        content: result.ok ? "目标已继续执行。" : `目标继续失败：${result.message}`,
      });
      return;
    }

    if (decision === "terminate") {
      const result = await window.buildingAgent.cancelGoal(goalId);
      if (!isGoalMutationCurrent(selection, mutationSequence)) {
        return;
      }
      if (result.ok && result.goal) {
        applyGoalSummaryToSessions(result.goal);
        setStatus({ kind: "ready", message: "目标已终止" });
        setWorkPhase("done");
        setTaskActivity(
          createTaskActivity({
            kind: "done",
            title: "目标已终止",
            detail: "不会继续执行",
          }),
        );
        void refreshActiveGoalDetail(result.goal.id);
        void refreshSessions(sessionId ?? undefined);
      }
      appendMessage({
        role: "assistant",
        content: result.ok ? "已终止目标。" : `终止目标失败：${result.message}`,
      });
      return;
    }

    setComposerDraft("调整目标计划：");
    window.requestAnimationFrame(() => {
      messageInputRef.current?.focus();
    });
  }

  async function handleReplanGoal() {
    if (!window.buildingAgent || !activeGoal?.id) {
      return;
    }

    const goalId = activeGoal.id;
    const selection = captureSessionSelection();
    const mutationSequence = beginGoalMutation();
    const result = await window.buildingAgent.replanGoal(
      goalId,
      "用户从恢复界面请求重新规划。",
    );
    if (!isGoalMutationCurrent(selection, mutationSequence)) {
      return;
    }
    const remainsBlocked = result.ok && result.goal?.status === "stopped_blocked";
    appendMessage({
      role: "assistant",
      content: result.ok
        ? remainsBlocked
          ? "目标计划已调整，但目标仍处于受阻状态；请确认条件已解决后再明确重试。"
          : "已重新规划目标，请查看新的里程碑。"
        : `重新规划失败：${result.message}`,
    });
    if (result.ok && result.goal) {
      applyGoalSummaryToSessions(result.goal);
      const goalUiState = getGoalUiSyncState(result.goal.status);
      setStatus({
        kind: goalUiState.statusKind,
        message: remainsBlocked
          ? "目标计划已调整，仍需明确重试"
          : "目标计划已调整",
      });
      setWorkPhase(goalUiState.workPhase);
      setTaskActivity(
        buildGoalTaskActivity({
          status: result.goal.status,
          description: result.goal.description,
        }),
      );
      void refreshActiveGoalDetail(result.goal.id);
      void refreshSessions(sessionId ?? undefined);
    }
  }

  async function handleRetryGoal() {
    if (!window.buildingAgent || !activeGoal?.id) {
      return;
    }

    const goalId = activeGoal.id;
    const selection = captureSessionSelection();
    const mutationSequence = beginGoalMutation();
    const result = await window.buildingAgent.retryGoal(goalId);
    if (!isGoalMutationCurrent(selection, mutationSequence)) {
      return;
    }
    const retryStarted = result.ok && result.goal?.status === "executing";
    if (result.ok && result.goal) {
      applyGoalSummaryToSessions(result.goal);
      const goalUiState = getGoalUiSyncState(result.goal.status);
      setStatus({
        kind: goalUiState.statusKind,
        message: retryStarted ? "目标已恢复执行" : "目标仍未恢复执行",
      });
      setWorkPhase(goalUiState.workPhase);
      setTaskActivity(
        buildGoalTaskActivity({
          status: result.goal.status,
          description: result.goal.description,
        }),
      );
    }
    appendMessage({
      role: "assistant",
      content: result.ok
        ? retryStarted
          ? "已重试目标，继续执行。"
          : "重试未启动；目标仍处于受阻状态。"
        : `重试目标失败：${result.message}`,
    });
    if (result.ok && result.goal) {
      void refreshActiveGoalDetail(result.goal.id);
      void refreshSessions(sessionId ?? undefined);
    }
  }

  async function handleContinueGoalAcceptance() {
    if (
      !window.buildingAgent ||
      activeGoalRef.current?.status !== "waiting_for_acceptance" ||
      goalAcceptanceOperationPendingRef.current
    ) {
      return;
    }

    const operation = createGoalAcceptanceOperationToken(
      "continue_acceptance",
      goalAcceptanceContextRef.current.context,
      `goal_acceptance_${++goalAcceptanceOperationSequenceRef.current}`,
    );
    if (!operation || activeGoalRef.current.id !== operation.goalId) {
      return;
    }
    const selection = captureSessionSelection();
    const mutationSequence = beginGoalMutation();
    goalAcceptanceOperationPendingRef.current = operation;
    setGoalAcceptanceOperationPending("continue_acceptance");
    setStatus({ kind: "working", message: "正在继续最终验收..." });
    try {
      const result = await window.buildingAgent.continueGoalAcceptance(
        operation.goalId,
      );
      if (
        !isGoalAcceptanceOperationCurrent(
          operation,
          goalAcceptanceContextRef.current.context,
          goalAcceptanceOperationPendingRef.current,
        ) || !isGoalMutationCurrent(selection, mutationSequence)
      ) {
        return;
      }
      if (
        !result.ok ||
        !result.goal ||
        !isGoalAcceptanceResultForOperation(operation, result.goal)
      ) {
        const message = result.message ?? "继续最终验收失败，请稍后重试。";
        setStatus({ kind: "error", message });
        appendMessage({ role: "assistant", content: `继续验收失败：${message}` });
        return;
      }

      setActiveGoalDetail(result.goal);
      applyGoalSummaryToSessions(result.goal);
      const outcome = projectGoalAcceptanceOperationOutcome(operation, result.goal);
      if (!outcome) {
        const message = "继续最终验收返回了无法确认的目标状态。";
        setStatus({ kind: "error", message });
        appendMessage({ role: "assistant", content: message });
        return;
      }
      const goalUiState = getGoalUiSyncState(result.goal.status);
      setStatus({ kind: goalUiState.statusKind, message: outcome.statusMessage });
      setWorkPhase(goalUiState.workPhase);
      setTaskActivity(
        buildGoalTaskActivity({
          status: result.goal.status,
          description: result.goal.description,
        }),
      );
      appendMessage({
        role: "assistant",
        content: outcome.assistantMessage,
      });
    } catch {
      if (
        !isGoalAcceptanceOperationCurrent(
          operation,
          goalAcceptanceContextRef.current.context,
          goalAcceptanceOperationPendingRef.current,
        ) || !isGoalMutationCurrent(selection, mutationSequence)
      ) {
        return;
      }
      const message = "继续最终验收失败，请稍后重试。";
      setStatus({ kind: "error", message });
      appendMessage({ role: "assistant", content: message });
    } finally {
      if (
        doesGoalAcceptanceOperationOwnPending(
          operation,
          goalAcceptanceOperationPendingRef.current,
        )
      ) {
        goalAcceptanceOperationPendingRef.current = null;
        setGoalAcceptanceOperationPending(null);
      }
    }
  }

  async function handleMarkGoalCompletedUnverified(
    confirmation: ManualCompletionConfirmation,
  ) {
    const confirmedGoalId = getConfirmedManualCompletionGoalId(
      confirmation,
      goalAcceptanceContextRef.current.context,
    );
    if (
      !window.buildingAgent ||
      !confirmedGoalId ||
      activeGoalRef.current?.id !== confirmedGoalId ||
      activeGoalRef.current.status !== "waiting_for_acceptance" ||
      goalAcceptanceOperationPendingRef.current
    ) {
      return;
    }

    const operation = createGoalAcceptanceOperationToken(
      "mark_completed_unverified",
      goalAcceptanceContextRef.current.context,
      `goal_acceptance_${++goalAcceptanceOperationSequenceRef.current}`,
    );
    if (!operation || operation.goalId !== confirmedGoalId) {
      return;
    }
    const selection = captureSessionSelection();
    const mutationSequence = beginGoalMutation();
    goalAcceptanceOperationPendingRef.current = operation;
    setGoalAcceptanceOperationPending("mark_completed_unverified");
    setStatus({ kind: "working", message: "正在记录手动完成..." });
    try {
      const result = await window.buildingAgent.markGoalCompletedUnverified(
        operation.goalId,
      );
      if (
        !isGoalAcceptanceOperationCurrent(
          operation,
          goalAcceptanceContextRef.current.context,
          goalAcceptanceOperationPendingRef.current,
        ) || !isGoalMutationCurrent(selection, mutationSequence)
      ) {
        return;
      }
      if (
        !result.ok ||
        !result.goal ||
        !isGoalAcceptanceResultForOperation(operation, result.goal)
      ) {
        const message = result.message ?? "手动标记完成失败，请稍后重试。";
        setStatus({ kind: "error", message });
        appendMessage({ role: "assistant", content: `手动标记完成失败：${message}` });
        return;
      }

      const outcome = projectGoalAcceptanceOperationOutcome(operation, result.goal);
      if (!outcome) {
        const message = "手动标记完成返回了无法确认的目标状态。";
        setStatus({ kind: "error", message });
        appendMessage({ role: "assistant", content: message });
        return;
      }
      setActiveGoalDetail(result.goal);
      applyGoalSummaryToSessions(result.goal);
      const goalUiState = getGoalUiSyncState(result.goal.status);
      setStatus({ kind: goalUiState.statusKind, message: outcome.statusMessage });
      setWorkPhase(goalUiState.workPhase);
      setTaskActivity(
        buildGoalTaskActivity({
          status: result.goal.status,
          description: result.goal.description,
        }),
      );
      appendMessage({
        role: "assistant",
        content: outcome.assistantMessage,
      });
    } catch {
      if (
        !isGoalAcceptanceOperationCurrent(
          operation,
          goalAcceptanceContextRef.current.context,
          goalAcceptanceOperationPendingRef.current,
        ) || !isGoalMutationCurrent(selection, mutationSequence)
      ) {
        return;
      }
      const message = "手动标记完成失败，请稍后重试。";
      setStatus({ kind: "error", message });
      appendMessage({ role: "assistant", content: message });
    } finally {
      if (
        doesGoalAcceptanceOperationOwnPending(
          operation,
          goalAcceptanceOperationPendingRef.current,
        )
      ) {
        goalAcceptanceOperationPendingRef.current = null;
        setGoalAcceptanceOperationPending(null);
      }
    }
  }

  async function handleIncreaseGoalBudget() {
    if (!window.buildingAgent || !activeGoal?.id) {
      return;
    }

    const goalId = activeGoal.id;
    const selection = captureSessionSelection();
    const mutationSequence = beginGoalMutation();
    const delta = buildGoalBudgetIncreaseDelta(activeGoalDetail);
    const increased = await window.buildingAgent.increaseGoalBudget(
      goalId,
      delta,
    );
    if (!isGoalMutationCurrent(selection, mutationSequence)) {
      return;
    }
    if (!increased.ok) {
      appendMessage({
        role: "assistant",
        content: `增加目标预算失败：${increased.message}`,
      });
      return;
    }

    const result = await window.buildingAgent.retryGoal(goalId);
    if (!isGoalMutationCurrent(selection, mutationSequence)) {
      return;
    }
    if (result.ok && result.goal) {
      applyGoalSummaryToSessions(result.goal);
      setStatus({ kind: "working", message: "预算已增加，目标继续执行" });
      setWorkPhase("tool");
      setTaskActivity(
        buildGoalTaskActivity({
          status: result.goal.status,
          description: result.goal.description,
        }),
      );
      void refreshActiveGoalDetail(result.goal.id);
      void refreshSessions(sessionId ?? undefined);
    }
    appendMessage({
      role: "assistant",
      content: result.ok
        ? "已增加耗尽的目标预算并继续执行。"
        : `继续目标失败：${result.message}`,
    });
  }

  async function handlePauseGoal() {
    if (!window.buildingAgent || !activeGoal?.id) {
      return;
    }

    const goalId = activeGoal.id;
    const selection = captureSessionSelection();
    const mutationSequence = beginGoalMutation();
    const result = await window.buildingAgent.pauseGoal(goalId);
    if (!isGoalMutationCurrent(selection, mutationSequence)) {
      return;
    }
    if (result.ok && result.goal) {
      applyGoalSummaryToSessions(result.goal);
      setStatus({ kind: "paused", message: "目标已暂停，等待确认" });
      setWorkPhase("paused");
      setTaskActivity(
        createTaskActivity({
          kind: "paused",
          title: "目标已暂停",
          detail: "可在目标卡片中通过或调整后继续",
          startedAt: taskActivity.startedAt,
        }),
      );
    }
    appendMessage({
      role: "assistant",
      content: result.ok
        ? "已暂停目标，等待你的确认。"
        : `暂停目标失败：${result.message}`,
    });
    if (result.ok && result.goal) {
      void refreshActiveGoalDetail(result.goal.id);
      void refreshSessions(sessionId ?? undefined);
    }
  }

  async function handleCancelGoal() {
    if (!window.buildingAgent || !activeGoal?.id) {
      return;
    }

    const goalId = activeGoal.id;
    const selection = captureSessionSelection();
    const mutationSequence = beginGoalMutation();
    const result = await window.buildingAgent.cancelGoal(goalId);
    if (!isGoalMutationCurrent(selection, mutationSequence)) {
      return;
    }
    if (result.ok && result.goal) {
      applyGoalSummaryToSessions(result.goal);
      setStatus({ kind: "ready", message: "目标已取消" });
      setWorkPhase("done");
      setTaskActivity(
        createTaskActivity({
          kind: "done",
          title: "目标已取消",
          detail: "不会继续执行",
        }),
      );
    }
    appendMessage({
      role: "assistant",
      content: result.ok ? "已取消目标。" : `取消目标失败：${result.message}`,
    });
    if (result.ok && result.goal) {
      void refreshActiveGoalDetail(result.goal.id);
      void refreshSessions(sessionId ?? undefined);
    }
  }

  async function handleSetAutoApprovalEnabled(enabled: boolean) {
    const previousState = {
      autoApprovalEnabled,
      goalModeEnabled,
      autoApprovalLocked,
    };
    setAutoApprovalEnabled(enabled);
    let state = null;
    try {
      state = await window.buildingAgent?.setToolAutoApprovalEnabled(enabled);
    } catch {
      state =
        (await window.buildingAgent?.getToolApprovalMode().catch(() => null)) ??
        previousState;
    }
    if (state) {
      setAutoApprovalEnabled(state.autoApprovalEnabled);
      setAutoApprovalLocked(state.autoApprovalLocked);
      setGoalModeEnabled(state.goalModeEnabled);
    }
  }

  async function handleSetGoalModeEnabled(enabled: boolean) {
    const previousState = {
      autoApprovalEnabled,
      goalModeEnabled,
      autoApprovalLocked,
    };
    setGoalModeEnabled(enabled);
    let state = null;
    try {
      state = await window.buildingAgent?.setToolGoalModeEnabled(enabled);
    } catch {
      state =
        (await window.buildingAgent?.getToolApprovalMode().catch(() => null)) ??
        previousState;
    }
    if (state) {
      setAutoApprovalEnabled(state.autoApprovalEnabled);
      setAutoApprovalLocked(state.autoApprovalLocked);
      setGoalModeEnabled(state.goalModeEnabled);
      if (!enabled && state.goalModeEnabled && state.autoApprovalLocked) {
        setGoalDrawerOpen(true);
      }
    }
  }

  async function handleResolveToolApproval(approved: boolean) {
    if (!window.buildingAgent || !pendingToolApproval) {
      return;
    }

    const id = pendingToolApproval.id;
    setPendingToolApprovals((current) =>
      current.filter((candidate) => candidate.id !== id),
    );
    const resolved = await window.buildingAgent
      .resolveToolApproval({ id, approved })
      .catch(() => false);
    if (!resolved) {
      setStatus({
        kind: "error",
        message: "授权请求已失效，请查看最新运行状态。",
      });
    }
  }

  function applySuccessfulChatResult(
    result: SuccessfulChatResult,
    requestId: string,
  ) {
    sessionIdRef.current = result.sessionId;
    setSessionId(result.sessionId);
    if (result.goalDraft) {
      setPendingGoalDraft(result.goalDraft);
      setGoalDraftDescription(result.goalDraft.normalizedDescription);
      setGoalDraftCriteriaText(formatGoalDraftCriteria(result.goalDraft));
    }
    if (result.executedRun) {
      setRuns((currentRuns) => [result.executedRun!, ...currentRuns]);
    }
    if (result.createdTask) {
      setTasks((currentTasks) => [result.createdTask!, ...currentTasks]);
    }
    if (result.activeGoal) {
      void refreshActiveGoalDetail(result.activeGoal.id);
    }
    setSelectedSkillName(null);
    const isPaused = result.agentStatus?.state === "paused";
    const isGoalExecuting = result.activeGoal?.status === "executing";
    const isGoalDraft = Boolean(result.goalDraft);
    setStatus({
      kind: isGoalExecuting ? "working" : isPaused ? "paused" : "ready",
      message: isGoalDraft
        ? "目标草案已生成，等待确认"
        : isGoalExecuting
        ? "目标正在后台执行"
        : isPaused
        ? "等待你确认是否继续"
        : result.createdTask
          ? "任务已创建"
          : result.executedRun
            ? `任务已运行：${translateRunStatus(result.executedRun.status)}`
            : result.relatedMemories.length
              ? `已参考 ${result.relatedMemories.length} 条记忆`
              : "模型已回复",
    });
    setWorkPhase(isGoalExecuting ? "tool" : isPaused ? "paused" : "done");
    setTaskActivity(
      isGoalDraft && result.goalDraft
        ? createTaskActivity({
            kind: "paused",
            title: "等待确认目标草案",
            detail: result.goalDraft.normalizedDescription,
          })
        : isGoalExecuting && result.activeGoal
        ? buildGoalTaskActivity({
            status: result.activeGoal.status,
            description: result.activeGoal.description,
          })
        : buildTaskActivityFromAgentStatus({
            agentStatus: result.agentStatus,
            relatedMemoryCount: result.relatedMemories.length,
            fallbackDetail: isPaused ? "等待确认" : "回复已写入会话",
          }),
    );
    activeStatusSessionIdRef.current =
      isPaused || isGoalExecuting || isGoalDraft ? result.sessionId : null;
    setChatStreamState((current) =>
      finalizeChatStreamResult(current, {
        requestId,
        sessionId: result.sessionId,
        reply: result.reply,
        createdAt: new Date().toISOString(),
      }),
    );
    void refreshSessions(result.sessionId);
    // Persisted session state is authoritative after optimistic streaming.
    void refreshCurrentSessionMessages(result.sessionId);
  }

  async function handleConfirmGoalDraft() {
    if (
      !window.buildingAgent ||
      !pendingGoalDraft ||
      goalDraftActionPendingRef.current
    ) {
      return;
    }

    const draftToConfirm = pendingGoalDraft;
    const selection = captureSessionSelection();
    if (selection.sessionId !== draftToConfirm.sessionId) {
      return;
    }
    const mutationSequence = beginGoalMutation();
    const pendingOperation = { action: "confirm" as const, sequence: mutationSequence };
    goalDraftActionPendingRef.current = pendingOperation;
    setGoalDraftActionPending("confirm");
    setStatus({ kind: "working", message: "正在确认并启动目标..." });
    try {
      const result = await window.buildingAgent.confirmGoalDraft(
        draftToConfirm.id,
        {
          normalizedDescription: goalDraftDescription,
          successCriteria: buildEditedGoalDraftCriteria(
            goalDraftCriteriaText,
            draftToConfirm,
          ),
        },
      );
      if (!isGoalMutationCurrent(selection, mutationSequence)) {
        return;
      }
      if (!result.ok) {
        setStatus({ kind: "error", message: result.message });
        return;
      }

      setPendingGoalDraft(null);
      setGoalDraftDescription("");
      setGoalDraftCriteriaText("");
      setSessions((currentSessions) => {
        const nextSessions = currentSessions.map((session) =>
          session.id === draftToConfirm.sessionId
            ? { ...session, activeGoal: result.activeGoal }
            : session,
        );
        onChatSessionsChange?.(nextSessions);
        return nextSessions;
      });
      activeStatusSessionIdRef.current = draftToConfirm.sessionId;
      setStatus({
        kind: result.activeGoal.status === "executing" ? "working" : "ready",
        message:
          result.activeGoal.status === "executing"
            ? "目标正在后台执行"
            : "目标已确认",
      });
      setWorkPhase(result.activeGoal.status === "executing" ? "tool" : "done");
      setTaskActivity(
        buildGoalTaskActivity({
          status: result.activeGoal.status,
          description: result.activeGoal.description,
        }),
      );
      void refreshActiveGoalDetail(result.activeGoal.id);
      void refreshSessions(draftToConfirm.sessionId);
      void refreshCurrentSessionMessages(draftToConfirm.sessionId);
    } catch (error) {
      if (!isGoalMutationCurrent(selection, mutationSequence)) {
        return;
      }
      setStatus({
        kind: "error",
        message:
          error instanceof Error ? error.message : "确认目标草案失败。",
      });
    } finally {
      if (goalDraftActionPendingRef.current === pendingOperation) {
        goalDraftActionPendingRef.current = null;
        if (isGoalMutationCurrent(selection, mutationSequence)) {
          setGoalDraftActionPending(null);
        }
      }
    }
  }

  async function handleDiscardGoalDraft() {
    if (!pendingGoalDraft || goalDraftActionPendingRef.current) {
      return;
    }

    const draftToDiscard = pendingGoalDraft;
    const selection = captureSessionSelection();
    if (selection.sessionId !== draftToDiscard.sessionId) {
      return;
    }
    const mutationSequence = beginGoalMutation();
    const pendingOperation = { action: "discard" as const, sequence: mutationSequence };
    goalDraftActionPendingRef.current = pendingOperation;
    setGoalDraftActionPending("discard");
    try {
      const result = await window.buildingAgent?.discardGoalDraft(
        draftToDiscard.id,
      );
      if (!isGoalMutationCurrent(selection, mutationSequence)) {
        return;
      }
      if (result && !result.ok) {
        setStatus({ kind: "error", message: result.message });
        return;
      }
      setPendingGoalDraft(null);
      setGoalDraftDescription("");
      setGoalDraftCriteriaText("");
      setStatus({ kind: "ready", message: "目标草案已丢弃" });
      setTaskActivity(idleTaskActivity);
      appendMessage({
        role: "assistant",
        content: "已丢弃目标草案，未创建目标。",
      });
    } finally {
      if (goalDraftActionPendingRef.current === pendingOperation) {
        goalDraftActionPendingRef.current = null;
        if (isGoalMutationCurrent(selection, mutationSequence)) {
          setGoalDraftActionPending(null);
        }
      }
    }
  }

  async function submitUserMessage(
    rawContent: string,
    outgoingAttachments: ChatAttachmentInput[] = [],
  ) {
    const content = rawContent;
    if (!content.trim()) {
      if (!outgoingAttachments.length) {
        return;
      }
    }
    const submittedContent = content.trim()
      ? rawContent
      : "请分析这些附件。";
    if (attachmentReadPending) {
      return;
    }
    if (status.kind === "working" || sessionLoadPendingRef.current !== null) {
      return;
    }

    const history = toChatHistory(messages);
    const userMessage = createMessage(
      {
        role: "user",
        content: submittedContent,
        ...(outgoingAttachments.length
          ? { attachments: outgoingAttachments.map(toChatAttachmentMetadata) }
          : {}),
      },
      messages.length,
    );

    shouldStickToLatestMessageRef.current = true;
    setMessages((current) => [...current, userMessage]);
    resetStreamProcessState();
    setComposerDraft("", 0);
    if (outgoingAttachments.length) {
      setComposerAttachments([]);
      setAttachmentError(null);
      setAttachmentAnnouncement("");
    }
    setWorkPhase("planning");
    activeStatusSessionIdRef.current = sessionId;
    setTaskProcessEvents([]);
    setGoalRunEvents([]);
    setTaskActivity(
      createTaskActivity({
        kind: "working",
        title: "正在执行任务",
        detail: "请求已发送，等待后端状态",
      }),
    );

    if (!window.buildingAgent) {
      setStatus({ kind: "working", message: "正在整理演示回复..." });
      setWorkPhase("model");
      setTaskActivity(
        createTaskActivity({
          kind: "working",
          title: "正在生成演示回复",
          detail: "正在整理本地预览上下文",
        }),
      );
      appendMessage({
        role: "assistant",
        content: buildLocalAgentReply({
          input: submittedContent,
          hasModel: modelSettings.hasApiKey,
          taskCount: tasks.length,
          latestRun,
          memoryCount: memories.length,
        }),
      });
      setStatus({ kind: "ready", message: "演示回复已生成" });
      setWorkPhase("done");
      setTaskActivity(
        createTaskActivity({
          kind: "done",
          title: "本轮已完成",
          detail: "演示回复已生成",
        }),
      );
      activeStatusSessionIdRef.current = null;
      return;
    }

    const shouldCreateGoalDraft =
      outgoingAttachments.length === 0 &&
      (goalModeEnabled || isLegacyGoalCommand(submittedContent));
    setStatus({ kind: "working", message: "正在检索记忆并调用模型..." });
    setWorkPhase("model");
    const requestId = createClientRequestId();
    const requestGeneration = sessionSelectionGenerationRef.current;
    setActiveChatRequest(requestId);
    const result = await window.buildingAgent
      .sendChatMessage({
        ...(sessionId ? { sessionId } : {}),
        requestId,
        message: submittedContent,
        ...(outgoingAttachments.length
          ? { attachments: outgoingAttachments }
          : {}),
        ...(shouldCreateGoalDraft ? { mode: "goal_draft" as const } : {}),
        ...(selectedSkillName ? { selectedSkillName } : {}),
        ...(selectedWorkspaceId ? { workspaceId: selectedWorkspaceId } : {}),
        history,
      })
      .catch((error) => ({
        ok: false as const,
        message:
          error instanceof Error ? error.message : "会话请求失败，请稍后重试。",
      }));
    if (activeChatRequestIdRef.current === requestId) {
      setActiveChatRequest(null);
    }
    if (requestGeneration !== sessionSelectionGenerationRef.current) {
      return;
    }

    if (!result.ok) {
      if (isSkillInputRequiredMessage(result.message)) {
        setStatus({
          kind: "paused",
          message:
            pendingInputRequestRef.current?.reason || "等待技能输入",
        });
        setWorkPhase("paused");
        setTaskActivity(
          createTaskActivity({
            kind: "paused",
            title: "等待技能输入",
            detail:
              pendingInputRequestRef.current?.reason || "等待技能输入",
          }),
        );
        return;
      }
      let restoredAttachmentSubmission = false;
      if (
        outgoingAttachments.length > 0 &&
        draftAttachmentsRef.current.length === 0
      ) {
        setMessages((current) =>
          rollbackFailedAttachmentTurn(current, {
            userMessageId: userMessage.id,
            requestId,
          }),
        );
        setComposerDraft(rawContent, rawContent.length);
        setComposerAttachments(outgoingAttachments);
        setAttachmentAnnouncement(
          `发送失败，已保留 ${outgoingAttachments.length} 个附件供重试`,
        );
        restoredAttachmentSubmission = true;
      }
      activeStatusSessionIdRef.current = null;
      const wasCanceled = isCanceledMessage(result.message);
      setStatus({
        kind: wasCanceled ? "ready" : "error",
        message: result.message,
      });
      setWorkPhase(wasCanceled ? "done" : "error");
      setTaskActivity(
        createTaskActivity({
          kind: wasCanceled ? "done" : "error",
          title: wasCanceled ? "任务已中断" : "执行遇到问题",
          detail: result.message,
        }),
      );
      if (!wasCanceled && !restoredAttachmentSubmission) {
        appendMessage({
          role: "assistant",
          content: result.message,
        });
      }
      return;
    }

    applySuccessfulChatResult(result, requestId);
  }

  async function handleSubmitGuidedSkillInput(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (!window.buildingAgent || !pendingInputRequest) {
      return;
    }

    const inputRequest = pendingInputRequest;
    const requestId = inputRequest.requestId;
    const requestGeneration = sessionSelectionGenerationRef.current;
    setStatus({ kind: "working", message: "正在继续技能" });
    setWorkPhase("model");
    setTaskActivity(
      createTaskActivity({
        kind: "working",
        title: "正在继续技能",
        detail: inputRequest.skillName,
      }),
    );
    activeStatusSessionIdRef.current = inputRequest.sessionId;
    setActiveChatRequest(requestId);

    const result = await window.buildingAgent
      .respondSkillInput({
        inputRequestId: inputRequest.id,
        requestId,
        values: buildSkillInputResponseValues(
          inputRequest.fields,
          guidedInputValues,
        ),
      })
      .catch((error) => ({
        ok: false as const,
        message:
          error instanceof Error ? error.message : "技能输入提交失败，请稍后重试。",
      }));

    if (activeChatRequestIdRef.current === requestId) {
      setActiveChatRequest(null);
    }
    if (requestGeneration !== sessionSelectionGenerationRef.current) {
      return;
    }

    if (!result.ok) {
      if (isSkillInputRequiredMessage(result.message)) {
        setStatus({
          kind: "paused",
          message:
            pendingInputRequestRef.current?.reason || "等待技能输入",
        });
        setWorkPhase("paused");
        setTaskActivity(
          createTaskActivity({
            kind: "paused",
            title: "等待技能输入",
            detail:
              pendingInputRequestRef.current?.reason || "等待技能输入",
          }),
        );
        return;
      }

      if (result.message.includes("附件内容在应用重启或长时间等待后已失效")) {
        setPendingInputRequest(null);
      }

      setStatus({ kind: "error", message: result.message });
      setWorkPhase("error");
      setTaskActivity(
        createTaskActivity({
          kind: "error",
          title: "技能输入失败",
          detail: result.message,
        }),
      );
      appendMessage({
        role: "assistant",
        content: result.message,
      });
      return;
    }

    setPendingInputRequest(null);
    applySuccessfulChatResult(result, requestId);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (skillMentionMenuVisible && skillMentionMatches[0]) {
      handleSelectSkillMention(skillMentionMatches[0]);
      return;
    }
    await submitUserMessage(draftRef.current, draftAttachmentsRef.current);
  }

  async function handleInterruptCurrentWork() {
    if (!window.buildingAgent || !canInterruptCurrentWork) {
      return;
    }

    if (activeGoal?.status === "executing") {
      const goalId = activeGoal.id;
      const selection = captureSessionSelection();
      const mutationSequence = beginGoalMutation();
      setStatus({ kind: "working", message: "正在中断目标..." });
      setTaskActivity(
        createTaskActivity({
          kind: "working",
          title: "正在中断目标",
          detail: "已请求中断目标，等待当前调用返回",
          startedAt: taskActivity.startedAt,
        }),
      );
      const result = await window.buildingAgent
        .cancelGoal(goalId)
        .catch((error) => ({
          ok: false as const,
          message:
            error instanceof Error ? error.message : "中断目标失败，请稍后重试。",
        }));
      if (!isGoalMutationCurrent(selection, mutationSequence)) {
        return;
      }
      if (!result.ok) {
        setStatus({ kind: "error", message: result.message ?? "中断目标失败。" });
        setTaskActivity(
          createTaskActivity({
            kind: "error",
            title: "中断目标失败",
            detail: result.message ?? "请稍后重试。",
          }),
        );
      } else if (result.goal) {
        applyGoalSummaryToSessions(result.goal);
        setStatus({ kind: "ready", message: "目标已终止" });
        setWorkPhase("done");
        activeStatusSessionIdRef.current = null;
        setTaskActivity(
          createTaskActivity({
            kind: "done",
            title: "目标已终止",
            detail: "不会继续执行",
          }),
        );
        void refreshActiveGoalDetail(result.goal.id);
        void refreshSessions(sessionId ?? undefined);
      }
      return;
    }

    const selection = captureSessionSelection();
    setStatus({ kind: "working", message: "正在中断任务..." });
    setTaskActivity(
      createTaskActivity({
        kind: "working",
        title: "正在中断任务",
        detail: "已请求中断，等待当前调用返回",
        startedAt: taskActivity.startedAt,
      }),
    );

    const result = await window.buildingAgent
      .cancelChatMessage(activeChatRequestIdRef.current ?? undefined)
      .catch((error) => ({
        ok: false as const,
        message:
          error instanceof Error ? error.message : "中断请求失败，请稍后重试。",
      }));

    if (!isSessionSelectionCurrent(selection)) {
      return;
    }
    if (!result.ok) {
      setActiveChatRequest(null);
      setStatus({ kind: "ready", message: result.message });
      setTaskActivity(
        createTaskActivity({
          kind: "done",
          title: "没有可中断任务",
          detail: result.message,
        }),
      );
    }
  }

  async function handleRunFirstTask() {
    const firstTask = tasks[0];

    if (!firstTask) {
      appendMessage({
        role: "assistant",
        content: "现在还没有可运行的任务。你可以先去“任务”里创建一个定时或手动任务。",
      });
      setWorkPhase("idle");
      onNavigate("scheduled-tasks");
      return;
    }

    appendMessage({
      role: "user",
      content: `运行任务：${firstTask.name}`,
    });

    if (!window.buildingAgent) {
      setStatus({ kind: "working", message: "正在模拟任务运行..." });
      setWorkPhase("tool");
      const snapshot = createDemoValidationSnapshot();
      savePreviewValidationSnapshot(window.localStorage, snapshot);
      setLastValidationSnapshot(snapshot);
      appendMessage({
        role: "assistant",
        content:
          "这是浏览器预览模式。桌面端会通过现有运行器执行任务，并把模型、工具、权限、记忆事件写入“运行”时间线。",
      });
      setStatus({ kind: "ready", message: "演示任务已完成" });
      setWorkPhase("done");
      return;
    }

    setStatus({ kind: "working", message: `正在运行：${firstTask.name}` });
    setWorkPhase("tool");
    const result = await window.buildingAgent.runScheduledTask(firstTask.id);

    if (!result.ok) {
      setStatus({ kind: "error", message: result.message });
      setWorkPhase("error");
      appendMessage({
        role: "assistant",
        content: `任务没有跑起来：${result.message}`,
      });
      return;
    }

    setRuns((currentRuns) => [result.run, ...currentRuns]);
    setStatus({ kind: "ready", message: "任务运行完成" });
    setWorkPhase("done");
    appendMessage({
      role: "assistant",
      content: `任务已完成，状态是 ${translateRunStatus(result.run.status)}。我已经把过程写入“运行”时间线，你可以继续查看每一步工具调用和记忆写入。`,
    });
  }

  async function handlePrepareAgent() {
    appendMessage({
      role: "user",
      content: "一键准备本地智能体",
    });

    if (!window.buildingAgent) {
      setStatus({ kind: "working", message: "正在模拟准备流程..." });
      setWorkPhase("tool");
      appendMessage({
        role: "assistant",
        content:
          "前端预览里我会展示准备流程；在桌面端会实际检查模型配置、内置技能和默认文件整理任务。",
      });
      setStatus({ kind: "ready", message: "演示准备完成" });
      setWorkPhase("done");
      return;
    }

    setStatus({ kind: "working", message: "正在准备本地智能体..." });
    setWorkPhase("tool");
    const result = await window.buildingAgent.prepareAgent();

    if (!result.ok) {
      setStatus({ kind: "error", message: result.message });
      setWorkPhase("error");
      appendMessage({
        role: "assistant",
        content: `准备失败：${result.message}`,
      });
      return;
    }

    const [settings, loadedTasks, loadedRuns, loadedMemories, skills] =
      await Promise.all([
        window.buildingAgent.loadModelSettings(),
        window.buildingAgent.listScheduledTasks(),
        window.buildingAgent.listAgentRuns(),
        window.buildingAgent.listMemories({ limit: 6 }),
        window.buildingAgent.listSkills(),
      ]);

    setModelSettings(settings);
    setTasks(loadedTasks);
    setRuns(loadedRuns);
    setMemories(loadedMemories);
    setSkillCount(skills.skills.length);
    setStatus({
      kind: result.report.ready ? "ready" : "error",
      message: result.report.ready ? "智能体已准备好" : "仍有项目需要处理",
    });
    setWorkPhase(result.report.ready ? "done" : "error");
    appendMessage({
      role: "assistant",
      content: [
        result.report.ready
          ? "本地智能体已经准备好，可以开始对话和执行任务。"
          : "准备流程跑完了，但还有项目需要处理。",
        `模型：${result.report.model.message}`,
        `技能：${result.report.skill.message}`,
        `任务：${result.report.task.message}`,
      ].join("\n"),
    });
  }

  async function handleValidateAgent() {
    appendMessage({
      role: "user",
      content: "验收运行本地智能体",
    });

    if (!window.buildingAgent) {
      setStatus({ kind: "working", message: "正在模拟验收运行..." });
      setWorkPhase("tool");
      const snapshot = createDemoValidationSnapshot();
      savePreviewValidationSnapshot(window.localStorage, snapshot);
      setLastValidationSnapshot(snapshot);
      appendMessage({
        role: "assistant",
        content:
          "浏览器预览已推进到验收通过状态；在桌面端会实际测试模型连接，并运行默认文件整理任务，随后写入运行时间线。",
      });
      setStatus({ kind: "ready", message: "演示验收完成" });
      setWorkPhase("done");
      return;
    }

    setStatus({ kind: "working", message: "正在验收运行智能体..." });
    setWorkPhase("tool");
    const result = await window.buildingAgent.validateAgent();

    if (!result.ok) {
      setStatus({ kind: "error", message: result.message });
      setWorkPhase("error");
      appendMessage({
        role: "assistant",
        content: `验收失败：${result.message}`,
      });
      return;
    }

    const [settings, loadedTasks, loadedRuns, loadedMemories, skills] =
      await Promise.all([
        window.buildingAgent.loadModelSettings(),
        window.buildingAgent.listScheduledTasks(),
        window.buildingAgent.listAgentRuns(),
        window.buildingAgent.listMemories({ limit: 6 }),
        window.buildingAgent.listSkills(),
      ]);

    setModelSettings(settings);
    setTasks(loadedTasks);
    setRuns(loadedRuns);
    setMemories(loadedMemories);
    setSkillCount(skills.skills.length);
    setStatus({
      kind: result.report.ready ? "ready" : "error",
      message: result.report.ready ? "验收运行完成" : "验收仍有问题",
    });
    setWorkPhase(result.report.ready ? "done" : "error");
    setLastValidationSnapshot(result.snapshot);
    appendMessage({
      role: "assistant",
      content: [
        result.report.ready
          ? "本地智能体已经完成验收运行。"
          : "验收运行结束，但还有项目需要处理。",
        `模型：${result.report.model.message}`,
        `技能：${result.report.skill.message}`,
        `任务：${result.report.task.message}`,
        `模型连接：${result.report.connection.message}`,
        `验收运行：${result.report.run.message}`,
      ].join("\n"),
    });
  }

  function handleOnboardingAction(action: AgentOnboardingAction) {
    if (action.command === "prepare") {
      void handlePrepareAgent();
      return;
    }
    if (action.command === "validate") {
      void handleValidateAgent();
      return;
    }
    onNavigate(action.target);
  }

  function handleFirstRunAction(action: FirstRunGuideAction) {
    if (action.command === "prepare") {
      void handlePrepareAgent();
      return;
    }
    if (action.command === "validate") {
      void handleValidateAgent();
      return;
    }
    onNavigate(action.target);
  }

  return (
    <section
      className={`agent-chat-panel ${
        showContextPanel ? "has-context-panel" : "is-focus-mode"
      } ${messages.length === 0 ? "is-empty" : "has-messages"}`}
      aria-label="智能体会话工作台"
      data-testid="agent-chat-panel"
    >
      <section className="chat-workspace" aria-label="会话窗口">
        <div
          className="chat-scroll-region"
          onScroll={handleMessageListScroll}
          ref={messageListRef}
        >
        <div className="chat-hero">
          <div className="chat-hero-main">
            <h2 title={chatTitle}>{chatTitle}</h2>
            <div className="chat-hero-chips">
              {contextCards.map((card) => (
                <span key={card.label} className="hero-chip" title={card.detail}>
                  {card.label}：{card.value}
                </span>
              ))}
            </div>
          </div>
          {chatStatusIsLong ? (
            <button
              type="button"
              className={chatStateClassName}
              title={status.message}
              aria-expanded={chatStatusIsLong ? chatStatusExpanded : undefined}
              onClick={() => setChatStatusExpanded((expanded) => !expanded)}
            >
              <span>{status.message}</span>
              <small className="chat-state-toggle">
                {chatStatusExpanded ? "收起" : "展开"}
              </small>
            </button>
          ) : (
            <span className={chatStateClassName} title={status.message}>
              <span>{status.message}</span>
            </span>
          )}
        </div>

        {firstRunGuide.primaryAction.command === "prepare" &&
          !modelSettings.hasApiKey && (
          <section className="first-run-guide" aria-label="首次启动引导">
            <div className="first-run-guide-main">
              <div>
                <span>首次启动引导</span>
                <h3>{firstRunGuide.title}</h3>
                <p>{firstRunGuide.message}</p>
              </div>
              <div className="first-run-guide-actions">
                <button
                  type="button"
                  onClick={() => handleFirstRunAction(firstRunGuide.primaryAction)}
                >
                  {firstRunGuide.primaryAction.label}
                </button>
              </div>
            </div>
          </section>
        )}

        {messages.length === 0 ? (
          <AgentHomeHero
            contextCards={contextCards}
            modelReady={modelSettings.hasApiKey}
            onPickPrompt={handlePickPrompt}
          />
        ) : (
          <ChatMessageList
            messageTimeTick={messageTimeTick}
            messages={visibleChatMessages}
          />
        )}

        {hasRuntimeSurfaces ? (
          <div className="runtime-surface-stack" aria-label="执行过程">
            {chatStreamState.thinkingText ? (
              <RuntimeTextDisclosure
                className="thinking-process-block"
                label="思考"
                text={chatStreamState.thinkingText}
              />
            ) : null}

            {chatStreamState.toolCallPreviews.length > 0 ? (
              <ToolCallPreviewDisclosure
                latestToolCallPreview={latestToolCallPreview}
                previews={chatStreamState.toolCallPreviews}
              />
            ) : null}

            {pendingGoalDraft ? (
              <GoalDraftCard
                draft={pendingGoalDraft}
                description={goalDraftDescription}
                criteriaText={goalDraftCriteriaText}
                pendingAction={goalDraftActionPending}
                onDescriptionChange={setGoalDraftDescription}
                onCriteriaTextChange={setGoalDraftCriteriaText}
                onConfirm={() => {
                  void handleConfirmGoalDraft();
                }}
                onDiscard={() => {
                  void handleDiscardGoalDraft();
                }}
              />
            ) : null}

            {activeGoal ? (
              <GoalStatusStrip
                goal={activeGoal}
                detail={activeGoalDetail}
                onViewDetail={handleViewGoalProgress}
                {...(activeGoal.status === "planning" ||
                  activeGoal.status === "canceled"
                  ? { onStart: handleStartGoal }
                  : {})}
                {...(activeGoal.status === "executing"
                  ? { onPause: () => void handlePauseGoal() }
                  : {})}
                onResolveReview={handleResolveGoalReview}
                onIncreaseBudget={handleIncreaseGoalBudget}
                onReplan={handleReplanGoal}
                onRetry={handleRetryGoal}
                onContinueAcceptance={() => void handleContinueGoalAcceptance()}
                goalAcceptanceOperationPending={
                  goalAcceptanceOperationPending !== null
                }
                onCancel={handleCancelGoal}
              />
            ) : null}

            {activeGoal && goalRunEvents.length > 0 ? (
              <details
                className="goal-run-process"
                open={activeGoal.status === "executing"}
              >
                <summary>
                  <span>里程碑运行过程</span>
                  <small>{goalRunEvents.length} 个事件</small>
                </summary>
                <ol className="task-process-list" aria-label="里程碑运行过程">
                  {goalRunEvents.map((event, index) => (
                    <li
                      key={`${event.createdAt}-${index}`}
                      className={event.phase === "reflecting" ? "is-reasoning" : ""}
                    >
                      <time>
                        {new Date(event.createdAt).toLocaleTimeString("zh-CN", {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </time>
                      <strong>{getGoalRunEventLabel(event)}</strong>
                      <span>{event.message}</span>
                    </li>
                  ))}
                </ol>
                {toolApprovalEvents.length > 0 ? (
                  <ol className="task-process-list" aria-label="工具授权监控">
                    {toolApprovalEvents.map((event) => (
                      <li
                        key={`${event.id}-${event.createdAt}`}
                        className={
                          event.risk.level === "critical" ? "is-critical-risk" : ""
                        }
                      >
                        <time>
                          {new Date(event.createdAt).toLocaleTimeString("zh-CN", {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </time>
                        <strong>{event.automatic ? "自动授权" : "授权处理"}</strong>
                        <span>
                          {event.approved ? "已同意" : "已拒绝"} {event.toolName} ·{" "}
                          {event.risk.reason}
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </details>
            ) : null}

            {shouldShowToolApproval(
              pendingToolApproval,
              autoApprovalEnabled,
            ) && pendingToolApproval ? (
              <ToolApprovalPanel
                request={pendingToolApproval}
                onResolve={(approved) => {
                  void handleResolveToolApproval(approved);
                }}
              />
            ) : null}

            {pendingInputRequest ? (
              <GuidedSkillInputForm
                inputRequest={pendingInputRequest}
                values={guidedInputValues}
                onChange={(name, value) =>
                  setGuidedInputValues((current) => ({
                    ...current,
                    [name]: value,
                  }))
                }
                onSubmit={(event) => {
                  void handleSubmitGuidedSkillInput(event);
                }}
              />
            ) : null}
          </div>
        ) : null}
        </div>

        <form className="composer" onSubmit={handleSubmit}>
          <div className="composer-inner">
            <div
              className={`composer-input-shell${
                draftAttachments.length ? " has-attachments" : ""
              }`}
            >
              <div className="composer-context-row" aria-label="会话上下文">
                <div className="workspace-picker" ref={workspaceMenuRef}>
                  <button
                    aria-expanded={workspaceMenuOpen}
                    aria-haspopup="menu"
                    aria-label="选择工作区"
                    className="workspace-picker-trigger"
                    disabled={status.kind === "working"}
                    onClick={() => setWorkspaceMenuOpen((open) => !open)}
                    type="button"
                  >
                    <Icon name="folder" className="workspace-picker-icon" />
                    <span>工作区</span>
                    <strong>{activeWorkspaceLabel}</strong>
                    <Icon
                      name={workspaceMenuOpen ? "collapse" : "expand"}
                      className="workspace-picker-chevron"
                    />
                  </button>
                  {workspaceMenuOpen ? (
                    <div
                      aria-label="工作区菜单"
                      className="workspace-menu"
                      data-placement={workspaceMenuPosition.placement}
                      role="menu"
                      style={workspaceMenuStyle}
                    >
                      <label className="workspace-menu-search">
                        <span>搜索项目</span>
                        <input
                          autoFocus
                          placeholder="搜索项目"
                          value={workspaceSearch}
                          onChange={(event) =>
                            setWorkspaceSearch(event.currentTarget.value)
                          }
                        />
                      </label>
                      <div className="workspace-menu-section">
                        <span>历史工作区</span>
                        <button
                          className="workspace-menu-item"
                          onClick={handleSelectDefaultWorkspace}
                          role="menuitem"
                          type="button"
                        >
                          <Icon
                            name="folder"
                            className="workspace-menu-item-icon"
                          />
                          <span>
                            <strong>默认工作区</strong>
                            <small>不指定项目目录</small>
                          </span>
                          {!selectedWorkspaceId ? (
                            <Icon
                              name="approval"
                              className="workspace-menu-check"
                            />
                          ) : null}
                        </button>
                        {visibleWorkspaces.map((workspace) => (
                          <button
                            className="workspace-menu-item"
                            key={workspace.id}
                            onClick={() => selectWorkspace(workspace)}
                            role="menuitem"
                            type="button"
                          >
                            <Icon
                              name="folder"
                              className="workspace-menu-item-icon"
                            />
                            <span>
                              <strong>{workspace.name}</strong>
                              <small>{workspace.rootPath}</small>
                            </span>
                            {selectedWorkspaceId === workspace.id ? (
                              <Icon
                                name="approval"
                                className="workspace-menu-check"
                              />
                            ) : null}
                          </button>
                        ))}
                        {visibleWorkspaces.length === 0 ? (
                          <p className="workspace-menu-empty">
                            没有匹配的历史工作区
                          </p>
                        ) : null}
                      </div>
                      <div className="workspace-menu-actions">
                        <button
                          disabled={workspaceActionsDisabled}
                          onClick={() => {
                            void handleOpenProjectWorkspace();
                          }}
                          role="menuitem"
                          type="button"
                        >
                          <Icon
                            name="folder"
                            className="workspace-menu-item-icon"
                          />
                          <span>
                            <strong>
                              {workspaceActionPending === "open"
                                ? "打开中"
                                : "打开已有目录"}
                            </strong>
                            <small>选择本地项目文件夹</small>
                          </span>
                        </button>
                        <button
                          disabled={workspaceActionsDisabled}
                          onClick={() => {
                            void handleCreateWorkspace();
                          }}
                          role="menuitem"
                          type="button"
                        >
                          <Icon
                            name="plus"
                            className="workspace-menu-item-icon"
                          />
                          <span>
                            <strong>
                              {workspaceActionPending === "create"
                                ? "选择中"
                                : "新建工作区"}
                            </strong>
                            <small>选择或新建本地项目文件夹</small>
                          </span>
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
                <span
                  className="workspace-context-path"
                  title={activeWorkspacePath || activeWorkspaceLabel}
                >
                  {activeWorkspacePath || activeWorkspaceLabel}
                </span>
              </div>
              {draftAttachments.length ? (
                <ChatAttachmentChips
                  attachments={draftAttachments}
                  className="composer-attachment-list"
                  onRemove={removeDraftAttachment}
                />
              ) : null}
              {selectedSkill ? (
                <div className="selected-skill-chip" aria-label="已选择技能">
                  <span>@{selectedSkill.name}</span>
                  <button
                    type="button"
                    aria-label={`取消选择技能 ${selectedSkill.name}`}
                    onClick={() => setSelectedSkillName(null)}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
              ) : null}
              {skillMentionMenuVisible ? (
                <div
                  aria-label="选择技能"
                  className="skill-mention-menu"
                  role="listbox"
                >
                  {skillMentionMatches.map((skill) => (
                    <button
                      key={skill.name}
                      type="button"
                      role="option"
                      onClick={() => handleSelectSkillMention(skill)}
                      onMouseDown={(event) => event.preventDefault()}
                    >
                      <span>@{skill.name}</span>
                      <div>
                        <strong>{skill.displayName}</strong>
                        <small>{skill.description}</small>
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}
              <textarea
                data-testid="agent-message-input"
                id="agent-message"
                ref={messageInputRef}
                onChange={(event) => {
                  const nextDraft = event.currentTarget.value;
                  const nextCursor =
                    event.currentTarget.selectionStart ?? nextDraft.length;
                  draftRef.current = nextDraft;
                  draftCursorRef.current = nextCursor;
                  const nextMention = extractActiveSkillMention(
                    nextDraft,
                    nextCursor,
                  );
                  const shouldSyncComposerState =
                    Boolean(nextMention) ||
                    Boolean(activeSkillMention);
                  if (shouldSyncComposerState) {
                    setDraft(nextDraft);
                    setDraftCursor(nextCursor);
                  } else if (draft) {
                    setDraft("");
                    setDraftCursor(0);
                  }
                  if (
                    selectedSkillName &&
                    !nextDraft.includes(`@${selectedSkillName}`)
                  ) {
                    setSelectedSkillName(null);
                  }
                }}
                onClick={updateDraftCursor}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.altKey) {
                    event.preventDefault();
                    if (skillMentionMenuVisible && skillMentionMatches[0]) {
                      handleSelectSkillMention(skillMentionMatches[0]);
                      return;
                    }
                    const form = event.currentTarget.closest("form");
                    form?.requestSubmit();
                    return;
                  }
                }}
                onKeyUp={updateDraftCursor}
                onPaste={(event) => {
                  void handleComposerPaste(event);
                }}
                placeholder={
                  activeGoal?.status === "executing"
                    ? "继续你的任务…"
                    : goalModeEnabled
                      ? "描述目标，发送后先生成可确认的目标草案"
                      : "输入消息或粘贴图片/附件，Enter 发送；Shift+Enter 或 Option+Enter 换行"
                }
                rows={2}
              />
              <div className="composer-floating-actions" aria-label="对话操作">
                <label
                  data-risk-tooltip={composerRiskTooltips.auto}
                  className={`auto-approval-toggle${
                    autoApprovalEnabled ? " is-enabled" : ""
                  }${autoApprovalLocked ? " is-locked" : ""}`}
                  title={composerRiskTooltips.auto}
                >
                  <input
                    aria-label="自动授权工具请求"
                    checked={autoApprovalEnabled}
                    disabled={autoApprovalLocked}
                    onChange={(event) => {
                      void handleSetAutoApprovalEnabled(event.currentTarget.checked);
                    }}
                    type="checkbox"
                  />
                  <span>自动授权</span>
                  <span
                    aria-hidden="true"
                    className="composer-risk-tooltip"
                    role="tooltip"
                  >
                    {composerRiskTooltips.auto}
                  </span>
                </label>
                <button
                  aria-label="目标模式"
                  aria-pressed={goalModeVisuallyEnabled}
                  className={`composer-goal-mode-button${
                    goalModeVisuallyEnabled ? " is-enabled" : ""
                  }`}
                  data-risk-tooltip={composerRiskTooltips.goal}
                  onClick={() => {
                    void handleSetGoalModeEnabled(!goalModeEnabled);
                  }}
                  title={composerRiskTooltips.goal}
                  type="button"
                >
                  <span>目标模式</span>
                  <span
                    aria-hidden="true"
                    className="composer-risk-tooltip"
                    role="tooltip"
                  >
                    {composerRiskTooltips.goal}
                  </span>
                </button>
                <button
                  aria-label="中断当前任务"
                  className="composer-icon-button composer-stop-button"
                  data-testid="agent-stop-button"
                  disabled={!canInterruptCurrentWork}
                  onClick={() => {
                    void handleInterruptCurrentWork();
                  }}
                  title="中断当前任务"
                  type="button"
                >
                  <Icon name="stop" className="composer-icon" />
                  <span className="sr-only">中断当前任务</span>
                </button>
                <button
                  aria-label="发送消息"
                  className="composer-icon-button composer-send-button"
                  data-testid="agent-send-button"
                  disabled={status.kind === "working" || attachmentReadPending}
                  title="发送消息"
                  type="submit"
                >
                  <Icon name="send" className="composer-icon" />
                  <span className="sr-only">发送消息</span>
                </button>
              </div>
            </div>
            {attachmentError ? (
              <p className="composer-attachment-error" role="alert">
                {attachmentError}
              </p>
            ) : attachmentReadPending ? (
              <p className="composer-attachment-status" role="status">
                正在读取粘贴的附件…
              </p>
            ) : null}
            <span className="sr-only" role="status" aria-live="polite">
              {attachmentAnnouncement}
            </span>
            {autoApprovalEnabled || goalModeEnabled ? (
              <div className="composer-mode-risk-summary" role="status">
                <strong>高权限模式已开启</strong>
                <span>
                  {autoApprovalEnabled
                    ? "普通文件、Shell、网络、安装、构建和测试操作会自动放行；极高危操作仍需确认。"
                    : ""}
                  {autoApprovalEnabled && goalModeEnabled ? " " : ""}
                  {goalModeEnabled
                    ? "目标模式已锁定自动授权，并会从内部断点自动继续。"
                    : ""}
                </span>
              </div>
            ) : null}
          </div>
        </form>
        <GoalDetailDrawer
          goal={activeGoalDetail}
          open={goalDrawerOpen}
          summary={activeGoal}
          onStart={
            activeGoal && canStartGoalFromChat(activeGoal.status)
              ? handleStartGoal
              : undefined
          }
          onClose={() => setGoalDrawerOpen(false)}
          onResolveReview={handleResolveGoalReview}
          onIncreaseBudget={handleIncreaseGoalBudget}
          onReplan={handleReplanGoal}
          onRetry={handleRetryGoal}
          onContinueAcceptance={() => void handleContinueGoalAcceptance()}
          onMarkCompletedUnverified={(confirmation) =>
            void handleMarkGoalCompletedUnverified(confirmation)
          }
          goalAcceptanceContext={goalAcceptanceContext}
          goalAcceptanceOperationPending={
            goalAcceptanceOperationPending !== null
          }
          onCancel={handleCancelGoal}
        />
      </section>

      {showContextPanel ? (
      <aside className="agent-context-panel" aria-label="进度与上下文">
        {shouldShowActivityCard ? (
          <ContextActivityCard
            activity={taskActivity}
            detail={taskActivityDetail}
            processItems={taskProcessItems}
            onContinue={
              taskActivity.kind === "paused"
                ? () => {
                    void submitUserMessage("继续");
                  }
                : undefined
            }
          />
        ) : null}
        <section className="kimi-side-card">
          <header>
            <strong>进度</strong>
          </header>
          <ol className="kimi-progress-list">
            {progressPanelItems.map((item) => (
              <li className={`is-${item.status}`} key={item.id}>
                <span aria-hidden="true" />
                <p>{item.label}</p>
              </li>
            ))}
          </ol>
        </section>
        <section className="kimi-side-card">
          <header>
            <strong>{hasActiveSubagents ? "子代理" : "上下文"}</strong>
          </header>
          {hasActiveSubagents ? (
            <SubagentStatusList items={subagentProcessItems} />
          ) : (
            <div className="kimi-context-list">
              {contextPanelItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled
                >
                  <span aria-hidden="true">
                    <Icon name={item.icon} size={15} />
                  </span>
                  <div>
                    <strong>{item.label}</strong>
                    <small>{item.detail}</small>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </aside>
      ) : null}
    </section>
  );
}

function AgentHomeHero(props: {
  contextCards: Array<{ label: string; value: string; detail: string }>;
  modelReady: boolean;
  onPickPrompt: (prompt: string) => void;
}) {
  const suggestions = [
    "分析最近一次失败任务，并告诉我怎么修",
    "整理下载目录，生成一份 Markdown 报告",
    "把这个目标拆成可执行计划",
  ];

  return (
    <section className="agent-home-hero" aria-label="智能体首页">
      <img src="./logo.png" alt="" aria-hidden="true" />
      <h2>让Zerox-Agent帮你做什么？</h2>
      <p>让 Zerox 帮你规划、执行、检查和沉淀本地工作流。</p>
      <div
        className={`home-status-chips ${
          props.modelReady ? "is-ready" : "needs-model"
        }`}
        aria-label="本地智能体状态"
      >
        {props.contextCards.map((card) => (
          <span key={card.label} title={card.detail}>
            {card.label}：{card.value}
          </span>
        ))}
      </div>
      <div className="home-suggestions" aria-label="建议动作">
        {suggestions.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => props.onPickPrompt(prompt)}
          >
            {prompt}
          </button>
        ))}
      </div>
    </section>
  );
}

function GoalDraftCard(props: {
  draft: GoalDraft;
  description: string;
  criteriaText: string;
  pendingAction: "confirm" | "discard" | null;
  onDescriptionChange: (value: string) => void;
  onCriteriaTextChange: (value: string) => void;
  onConfirm: () => void;
  onDiscard: () => void;
}) {
  const checks = props.draft.successCriteria.flatMap((criterion) =>
    criterion.acceptanceChecks.map((check) => ({
      ...check,
      criterionDescription: criterion.description,
    })),
  );
  const hasWarnings = props.draft.warnings.length > 0;

  return (
    <section className="goal-draft-card" aria-label="目标草案确认">
      <header>
        <div>
          <span>目标草案</span>
          <strong>确认后开始执行</strong>
        </div>
        <small>
          {props.draft.acceptanceCoverage.deterministicChecks} 个确定性检查 ·{" "}
          {props.draft.acceptanceCoverage.modelReviewChecks} 个证据复核
        </small>
      </header>
      <label className="goal-draft-field">
        <span>目标</span>
        <textarea
          value={props.description}
          onChange={(event) => props.onDescriptionChange(event.currentTarget.value)}
          rows={2}
        />
      </label>
      <label className="goal-draft-field">
        <span>成功标准</span>
        <textarea
          value={props.criteriaText}
          onChange={(event) => props.onCriteriaTextChange(event.currentTarget.value)}
          rows={Math.max(2, props.criteriaText.split(/\n/).length)}
        />
      </label>
      <div className="goal-draft-checks" aria-label="验收检查">
        {checks.map((check) => (
          <span key={check.id} title={check.criterionDescription}>
            {getAcceptanceCheckLabel(check.kind)}
          </span>
        ))}
      </div>
      {hasWarnings ? (
        <ul className="goal-draft-warnings" aria-label="目标草案警告">
          {props.draft.warnings.map((warning) => (
            <li key={`${warning.code}-${warning.checkId ?? warning.message}`}>
              {warning.message}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="goal-draft-actions">
        <button
          type="button"
          className="secondary-action"
          disabled={Boolean(props.pendingAction)}
          onClick={props.onDiscard}
        >
          {props.pendingAction === "discard" ? "丢弃中" : "丢弃"}
        </button>
        <button
          type="button"
          className="primary-action"
          disabled={Boolean(props.pendingAction) || !props.description.trim()}
          onClick={props.onConfirm}
        >
          {props.pendingAction === "confirm" ? "确认中" : "确认并开始"}
        </button>
      </div>
    </section>
  );
}

function formatGoalDraftCriteria(draft: GoalDraft): string {
  return draft.successCriteria
    .map((criterion) => criterion.description.trim())
    .filter(Boolean)
    .join("\n");
}

function buildEditedGoalDraftCriteria(
  criteriaText: string,
  draft: GoalDraft,
): SuccessCriterion[] {
  const lines = criteriaText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) {
    return draft.successCriteria;
  }

  return lines.map((description, index) => {
    const existing = draft.successCriteria[index];
    if (existing) {
      return {
        ...existing,
        description,
      };
    }
    return {
      id: `criterion_${index + 1}`,
      description,
      acceptanceChecks: [
        {
          id: `criterion_${index + 1}_review`,
          kind: "model_review",
          description: "Evidence-backed review is required.",
          params: {
            condition: description,
            evidenceRefs: ["artifact:goalEvidence"],
          },
          requiresEvidence: true,
        },
      ],
    };
  });
}

function getAcceptanceCheckLabel(kind: string): string {
  const labels: Record<string, string> = {
    file_exists: "文件",
    command_exit_code: "命令",
    test_passes: "测试",
    assertion: "断言",
    model_review: "证据复核",
  };
  return labels[kind] ?? kind;
}

function isLegacyGoalCommand(message: string): boolean {
  return /^\/(?:目标|goal)(?:\s+|$)/i.test(message.trim());
}

function buildLocalAgentReply(options: {
  input: string;
  hasModel: boolean;
  taskCount: number;
  latestRun: AgentRunRecord | undefined;
  memoryCount: number;
}): string {
  if (!options.hasModel) {
    return [
      "## 我收到你的指令了",
      "",
      "当前还没有完成模型密钥配置，所以我会先作为本地会话记录意图。",
      "",
      "- 配置模型后，这里会进入真实模型推理",
      "- 涉及文件、网页或命令行时，会走任务权限",
      "- 有价值的结果会写入本地记忆",
    ].join("\n");
  }

  if (/运行|执行|整理|run/i.test(options.input) && options.taskCount > 0) {
    return [
      "## 可以，我会按 Agent 流程执行",
      "",
      "我会优先匹配已有任务和 skill：",
      "",
      "1. 检查任务和工具权限",
      "2. 调用对应 skill",
      "3. 写入运行时间线",
      "4. 把有价值的结果沉淀到记忆",
    ].join("\n");
  }

  if (/失败|报错|为什么|日志|timeline|时间线/i.test(options.input)) {
    return options.latestRun
      ? `最近一次运行是"${options.latestRun.taskName}"，状态是 ${translateRunStatus(options.latestRun.status)}。你可以点"查看运行时间线"看模型、权限、工具和记忆事件。`
      : "现在还没有运行记录。先创建或运行一个任务，时间线里才会出现可检查的事件。";
  }

  if (/记忆|memory/i.test(options.input)) {
    return `当前本地已有 ${options.memoryCount} 条记忆。你可以让我检索、整理、删除或导出这些记忆。`;
  }

  return [
    "## 明白",
    "",
    "我会把这个请求拆成几个步骤：",
    "",
    "- 理解目标",
    "- 选择 skill",
    "- 检查权限",
    "- 执行工具",
    "- 写入运行日志和记忆",
    "",
    "下一步你可以让我直接运行一个已有任务，或者创建新的定时任务。",
  ].join("\n");
}

type ContextProgressItem = {
  id: string;
  label: string;
  status: "done" | "active" | "pending" | "error";
};

function buildContextProgressItems(options: {
  activeGoalDetail: Goal | null;
  requirementProcessItems: RequirementProcessItem[];
  taskProcessItems: ReturnType<typeof buildTaskProcessItems>;
  workSteps: AgentWorkStep[];
  status: ChatStatus;
}): ContextProgressItem[] {
  if (options.activeGoalDetail?.milestones.length) {
    return options.activeGoalDetail.milestones.map((milestone, index) => ({
      id: milestone.id,
      label: `${String(index + 1).padStart(2, "0")} ${milestone.description}`,
      status: mapMilestoneStatusToContextStatus(milestone.state),
    }));
  }

  if (options.requirementProcessItems.length) {
    return options.requirementProcessItems.slice(0, 8).map((item) => ({
      id: item.id,
      label: item.label,
      status: mapRequirementStatusToContextStatus(item.status),
    }));
  }

  if (options.taskProcessItems.length) {
    return options.taskProcessItems.slice(0, 5).map((item, index) => ({
      id: item.id,
      label: item.message || item.label,
      status: index === 0 && options.status.kind === "working" ? "active" : "done",
    }));
  }

  return options.workSteps.map((step) => ({
    id: step.id,
    label: `${step.label} · ${step.detail}`,
    status:
      step.status === "waiting"
        ? "pending"
        : step.status === "active"
          ? "active"
          : step.status,
  }));
}

function mapRequirementStatusToContextStatus(
  status: RequirementProcessItem["status"],
): ContextProgressItem["status"] {
  if (status === "done") return "done";
  if (status === "active") return "active";
  if (status === "error") return "error";
  return "pending";
}

function mapMilestoneStatusToContextStatus(
  state: Goal["milestones"][number]["state"],
): ContextProgressItem["status"] {
  if (state === "accepted" || state === "skipped") {
    return "done";
  }
  if (state === "running" || state === "ready") {
    return "active";
  }
  if (state === "rejected" || state === "failed") {
    return "error";
  }
  return "pending";
}

function buildContextPanelItems(options: {
  contextCards: Array<{ label: string; value: string; detail: string }>;
  memories: MemoryRecord[];
  activeGoal: ChatSessionGoalSummary | null;
}) {
  const baseItems = options.contextCards.map((card) => ({
    id: `card-${card.label}`,
    icon: "run" as IconName,
    label: `${card.label} · ${card.value}`,
    detail: card.detail,
  }));
  const goalItem = options.activeGoal
    ? [
        {
          id: `goal-${options.activeGoal.id}`,
          icon: "goal" as IconName,
          label: "当前目标",
          detail: `${translateGoalStatus(options.activeGoal.status)} · ${options.activeGoal.description}`,
        },
      ]
    : [];
  const memoryItems = options.memories.slice(0, 3).map((memory) => ({
    id: `memory-${memory.id}`,
    icon: "memory" as IconName,
    label: memory.title,
    detail: memory.content,
  }));

  return [...goalItem, ...baseItems, ...memoryItems].slice(0, 8);
}

function AgentWorkTimeline({
  phase,
  status,
  steps,
}: {
  phase: AgentWorkPhase;
  status: ChatStatus;
  steps: AgentWorkStep[];
}) {
  if (phase === "idle" || phase === "done") {
    return null;
  }

  const title =
    status.kind === "working"
      ? "智能体正在工作"
      : status.kind === "paused"
        ? "等待你确认"
      : status.kind === "error"
      ? "执行遇到问题"
      : "智能体待命中";

  return (
    <section className={`agent-work-timeline is-${status.kind}`}>
      <div className="agent-work-copy">
        <strong>{title}</strong>
        <span>{status.message}</span>
      </div>
      <div className="agent-work-steps" aria-label="智能体工作步骤">
        {steps.map((step) => (
          <article className={`agent-work-step is-${step.status}`} key={step.id}>
            <i aria-hidden="true" />
            <div>
              <strong>{step.label}</strong>
              <small>{step.detail}</small>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ContextActivityCard({
  activity,
  detail,
  processItems,
  onContinue,
}: {
  activity: TaskActivityState;
  detail: string;
  processItems: ReturnType<typeof buildTaskProcessItems>;
  onContinue?: () => void;
}) {
  const latestReasoning = processItems.find((item) => item.label === "思考");
  const recentItems = processItems.slice(0, 3);
  return (
    <section className={`context-activity-card is-${activity.kind}`}>
      <header>
        <span className="context-activity-pill">{getActivityKindLabel(activity.kind)}</span>
        {typeof activity.toolCallsExecuted === "number" ? (
          <small>工具 {activity.toolCallsExecuted}</small>
        ) : null}
      </header>
      <div className="context-activity-main">
        <span className="task-activity-dot" aria-hidden="true" />
        <div>
          <strong>{activity.title}</strong>
          <p title={detail}>{detail}</p>
        </div>
      </div>
      <div className="context-activity-meta">
        {typeof activity.toolCallsExecuted === "number" && (
          <span>工具调用 {activity.toolCallsExecuted}</span>
        )}
        {onContinue && (
          <button
            type="button"
            onClick={onContinue}
          >
            继续执行
          </button>
        )}
      </div>
      {latestReasoning ? (
        <div className="task-activity-reasoning-preview">
          <span>最新思考</span>
          <p>{latestReasoning.message}</p>
        </div>
      ) : null}
      {recentItems.length > 0 && (
        <ol className="task-process-list" aria-label="最近执行过程">
          {recentItems.map((item) => (
            <TaskProcessItem compact={true} key={item.id} item={item} />
          ))}
        </ol>
      )}
    </section>
  );
}

function SubagentStatusList({
  items,
}: {
  items: SubagentProcessItem[];
}) {
  return (
    <ol className="subagent-status-list" aria-label="子代理执行状态">
      {items.map((item) => (
        <li className={`subagent-status-item is-${item.status}`} key={item.id}>
          <span aria-hidden="true" />
          <div>
            <strong>{item.label}</strong>
            <small>{item.message}</small>
          </div>
          <time>{item.time}</time>
        </li>
      ))}
    </ol>
  );
}

function getActivityKindLabel(kind: TaskActivityState["kind"]): string {
  if (kind === "working") return "执行中";
  if (kind === "paused") return "等待确认";
  if (kind === "error") return "需处理";
  if (kind === "done") return "已结束";
  return "待命";
}

function ToolApprovalPanel({
  request,
  onResolve,
}: {
  request: ToolApprovalRequestPayload;
  onResolve: (approved: boolean) => void;
}) {
  const isCritical = request.risk.level === "critical";
  const dialogRef = useRef<HTMLElement>(null);
  const denyButtonRef = useRef<HTMLButtonElement>(null);
  const handleDeny = useCallback(() => onResolve(false), [onResolve]);

  useDialogFocusTrap({
    dialogRef,
    initialFocusRef: denyButtonRef,
    onEscape: handleDeny,
    open: true,
  });

  return (
    <div className="tool-approval-backdrop" role="presentation">
      <section
        aria-describedby="tool-approval-description"
        aria-labelledby="tool-approval-title"
        aria-modal="true"
        className={`tool-approval-panel${
          isCritical ? " is-critical-risk" : ""
        }`}
        ref={dialogRef}
        role="alertdialog"
        tabIndex={-1}
      >
        <div className="tool-approval-copy">
          <span>{isCritical ? "高危授权" : "工具授权"}</span>
          <strong id="tool-approval-title">{request.request.toolName}</strong>
          <p id="tool-approval-description">
            {request.deniedReason} 请确认任务、风险和参数后再授权。
          </p>
        </div>
        <dl>
          <div>
            <dt>任务</dt>
            <dd>{request.taskName}</dd>
          </div>
          <div>
            <dt>风险</dt>
            <dd>{request.risk.reason}</dd>
          </div>
          <div>
            <dt>风险类别</dt>
            <dd>{formatRiskCategory(request.risk.category)}</dd>
          </div>
          {request.risk.affectedTargets.length > 0 ? (
            <div>
              <dt>影响对象</dt>
              <dd>{request.risk.affectedTargets.join("、")}</dd>
            </div>
          ) : null}
          {Object.entries(request.argsSummary).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{String(value)}</dd>
            </div>
          ))}
        </dl>
        <div className="tool-approval-actions">
          <button
            className="tool-approval-deny"
            ref={denyButtonRef}
            type="button"
            onClick={handleDeny}
          >
            拒绝
          </button>
          <button
            className="tool-approval-approve"
            type="button"
            onClick={() => onResolve(true)}
          >
            授权本次
          </button>
        </div>
      </section>
    </div>
  );
}

function formatRiskCategory(category: ToolApprovalRequestPayload["risk"]["category"]): string {
  if (category === "irrecoverable_data_loss") return "不可恢复的数据破坏";
  if (category === "privilege_or_security_boundary") return "权限或安全边界";
  if (category === "secret_exfiltration") return "密钥或凭据外传";
  if (category === "irreversible_external_action") return "不可逆外部操作";
  return "常规操作";
}

function GuidedSkillInputForm({
  inputRequest,
  values,
  onChange,
  onSubmit,
}: {
  inputRequest: SkillUserInputRequest;
  values: Record<string, string | number | boolean>;
  onChange: (name: string, value: string | number | boolean) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form
      className="guided-skill-input-form"
      aria-label="技能输入"
      onSubmit={onSubmit}
    >
      <header>
        <span>@{inputRequest.skillName}</span>
        <strong>输入</strong>
        <small>{inputRequest.reason}</small>
      </header>
      <div className="guided-skill-input-grid">
        {inputRequest.fields.map((field) => (
          <label key={field.name} className={`guided-skill-field is-${field.type}`}>
            <span>
              {field.label}
              {field.required ? " *" : ""}
            </span>
            {renderGuidedSkillInputControl(field, values[field.name], (value) =>
              onChange(field.name, value),
            )}
          </label>
        ))}
      </div>
      <div className="guided-skill-input-actions">
        <button type="submit">继续</button>
      </div>
    </form>
  );
}

function renderGuidedSkillInputControl(
  field: SkillInputField,
  value: string | number | boolean | undefined,
  onChange: (value: string | number | boolean) => void,
) {
  if (field.type === "boolean") {
    return (
      <input
        checked={value === true}
        onChange={(event) => onChange(event.currentTarget.checked)}
        type="checkbox"
      />
    );
  }

  if (field.type === "choice") {
    return (
      <select
        required={field.required}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        <option value="">-</option>
        {(field.choices ?? []).map((choice) => (
          <option key={choice} value={choice}>
            {choice}
          </option>
        ))}
      </select>
    );
  }

  if (field.type === "number") {
    return (
      <input
        inputMode="decimal"
        required={field.required}
        type="number"
        value={typeof value === "number" || typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    );
  }

  if (field.type === "path") {
    return (
      <input
        required={field.required}
        type="text"
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    );
  }

  if (field.type === "string") {
    return (
      <input
        required={field.required}
        type="text"
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    );
  }

  return null;
}

function RuntimeTextDisclosure({
  className,
  label,
  text,
}: {
  className: string;
  label: string;
  text: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const summary = getLatestRuntimeLine(text);

  return (
    <section
      className={`${className} runtime-disclosure ${
        expanded ? "is-expanded" : "is-collapsed"
      }`}
    >
      <header>
        <strong className="runtime-disclosure-label">{label}</strong>
        <p className="runtime-disclosure-summary" title={summary}>
          {summary}
        </p>
        <button
          className="runtime-disclosure-toggle"
          type="button"
          aria-label={expanded ? `收起${label}` : `展开${label}`}
          aria-expanded={expanded}
          title={expanded ? "收起" : "展开"}
          onClick={() => setExpanded((current) => !current)}
        >
          <Icon name={expanded ? "collapse" : "expand"} size={16} />
          <span className="sr-only">{expanded ? "收起" : "展开"}</span>
        </button>
      </header>
      {expanded ? (
        <div className="runtime-disclosure-body">
          <pre>{text}</pre>
        </div>
      ) : null}
    </section>
  );
}

function ToolCallPreviewDisclosure({
  latestToolCallPreview,
  previews,
}: {
  latestToolCallPreview: ChatToolCallPreview | null;
  previews: ChatToolCallPreview[];
}) {
  const [expanded, setExpanded] = useState(false);
  const latestToolName = latestToolCallPreview?.toolName ?? "工具";
  const latestToolArguments = latestToolCallPreview?.argumentsText ?? "{}";
  const summary = `${latestToolName} · ${getLatestRuntimeLine(
    latestToolArguments,
  )}`;

  return (
    <section
      className={`tool-call-preview-block runtime-disclosure ${
        expanded ? "is-expanded" : "is-collapsed"
      }`}
      aria-label="工具预览"
    >
      <header>
        <strong className="runtime-disclosure-label">工具</strong>
        <p className="runtime-disclosure-summary" title={summary}>
          {summary}
        </p>
        <button
          className="runtime-disclosure-toggle"
          type="button"
          aria-label={expanded ? "收起工具" : "展开工具"}
          aria-expanded={expanded}
          title={expanded ? "收起" : "展开"}
          onClick={() => setExpanded((current) => !current)}
        >
          <Icon name={expanded ? "collapse" : "expand"} size={16} />
          <span className="sr-only">{expanded ? "收起" : "展开"}</span>
        </button>
      </header>
      {expanded ? (
        <div className="runtime-disclosure-body tool-call-preview-list">
          {previews.map((preview) => (
            <article className="tool-call-preview-item" key={preview.toolCallId}>
              <header>
                <strong>{preview.toolName ?? "工具"}</strong>
                {typeof preview.index === "number" ? (
                  <small>#{preview.index + 1}</small>
                ) : null}
              </header>
              <pre>{preview.argumentsText || "{}"}</pre>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function getLatestRuntimeLine(text: string): string {
  const latestLine =
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1) ?? "";
  const compactLine = latestLine || text.trim() || "{}";
  return compactLine.length > 180
    ? `${compactLine.slice(0, 177)}...`
    : compactLine;
}

type TaskProcessItemProps = {
  compact?: boolean;
  item: ReturnType<typeof buildTaskProcessItems>[number];
};

function TaskProcessItem(props: TaskProcessItemProps) {
  const { compact = false, item } = props;
  const [expanded, setExpanded] = useState(false);
  const shouldCollapse = !compact && item.message.length > 160;
  const displayMessage =
    compact ? getLatestRuntimeLine(item.message) :
    expanded || !shouldCollapse ? item.message : `${item.message.slice(0, 157)}...`;

  return (
    <li
      className={[
        item.label === "思考" ? "is-reasoning" : "",
        shouldCollapse ? "chat-message-collapse" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <time>{item.time}</time>
      <strong>{item.label}</strong>
      <span>{displayMessage}</span>
      {shouldCollapse && (
        <button
          type="button"
          aria-expanded={expanded}
          className="task-process-item-toggle chat-message-collapse-button"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "收起" : "展开"}
        </button>
      )}
      {item.meta && <small>{item.meta}</small>}
    </li>
  );
}

function buildTaskActivityFromAgentStatus(options: {
  agentStatus: ChatAgentStatus | undefined;
  relatedMemoryCount: number;
  fallbackDetail: string;
}): TaskActivityState {
  if (options.agentStatus?.state === "paused") {
    const isFailureLoop = options.agentStatus.reason === "tool_failure_loop";
    const isStrategyGuard = options.agentStatus.reason === "strategy_guard";
    return createTaskActivity({
      kind: "paused",
      title: isFailureLoop
        ? "连续工具失败，等待确认"
        : isStrategyGuard
          ? "策略守护触发，等待确认"
          : "长任务等待确认",
      detail: isFailureLoop
        ? `已执行 ${options.agentStatus.toolCallsExecuted} 个工具，检测到同类失败循环`
        : isStrategyGuard
          ? `已执行 ${options.agentStatus.toolCallsExecuted} 个工具，检测到碎片化工具调用`
        : `已执行 ${options.agentStatus.toolCallsExecuted} 个工具，停在第 ${options.agentStatus.maxTurns} 轮检查点`,
      toolCallsExecuted: options.agentStatus.toolCallsExecuted,
      maxTurns: options.agentStatus.maxTurns,
    });
  }

  if (options.agentStatus?.state === "completed") {
    return createTaskActivity({
      kind: "done",
      title: "本轮已完成",
      detail:
        options.agentStatus.toolCallsExecuted > 0
          ? `累计执行 ${options.agentStatus.toolCallsExecuted} 个工具`
          : options.fallbackDetail,
      toolCallsExecuted:
        options.agentStatus.toolCallsExecuted > 0
          ? options.agentStatus.toolCallsExecuted
          : undefined,
    });
  }

  return createTaskActivity({
    kind: "done",
    title: "本轮已完成",
    detail:
      options.relatedMemoryCount > 0
        ? `已参考 ${options.relatedMemoryCount} 条记忆`
      : options.fallbackDetail,
  });
}

function getGoalRunEventLabel(event: AgentRunEvent): string {
  if (event.phase === "reflecting") return "思考";
  if (event.phase === "executing") return "执行";
  if (event.phase === "planning") return "规划";
  if (event.phase === "done") return "完成";
  if (event.level === "error") return "错误";
  if (event.level === "warn") return "警告";
  return "信息";
}

function createClientRequestId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isNearMessageListBottom(messageList: HTMLDivElement): boolean {
  const distanceToBottom =
    messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight;
  return distanceToBottom <= MESSAGE_LIST_BOTTOM_THRESHOLD_PX;
}

function appendBoundedRuntimeEvent<T>(events: T[], event: T): T[] {
  return [...events.slice(-(MAX_RENDERED_RUNTIME_EVENTS - 1)), event];
}

function chatStreamEventMatchesActive(
  event: ChatStreamEvent,
  activeStream: {
    activeSessionId: string | null;
    activeRequestId: string | null;
  },
): boolean {
  if (!activeStream.activeRequestId) {
    return false;
  }
  if (event.requestId !== activeStream.activeRequestId) {
    return false;
  }
  if (
    activeStream.activeSessionId &&
    event.sessionId !== activeStream.activeSessionId
  ) {
    return false;
  }
  return true;
}

function createGuidedInputInitialValues(
  fields: SkillInputField[],
): Record<string, string | number | boolean> {
  return fields.reduce<Record<string, string | number | boolean>>(
    (values, field) => {
      if (field.defaultValue !== undefined) {
        values[field.name] = field.defaultValue;
        return values;
      }
      if (field.type === "boolean") {
        values[field.name] = false;
        return values;
      }
      values[field.name] = "";
      return values;
    },
    {},
  );
}

function buildSkillInputResponseValues(
  fields: SkillInputField[],
  values: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  return fields.reduce<Record<string, string | number | boolean>>(
    (resolvedValues, field) => {
      const value = values[field.name];
      if (field.type === "boolean") {
        resolvedValues[field.name] = value === true;
        return resolvedValues;
      }

      if (field.type === "number") {
        if (value === "" || value === undefined) {
          return resolvedValues;
        }
        const numberValue =
          typeof value === "number" ? value : Number.parseFloat(String(value));
        if (Number.isFinite(numberValue)) {
          resolvedValues[field.name] = numberValue;
        }
        return resolvedValues;
      }

      if (value === undefined || value === "") {
        return resolvedValues;
      }
      resolvedValues[field.name] = String(value);
      return resolvedValues;
    },
    {},
  );
}

function isCanceledMessage(message: string): boolean {
  return /中断|取消|cancel|canceled|cancelled|abort|aborted/i.test(message);
}

function isSkillInputRequiredMessage(message: string): boolean {
  return /skill input required|input required|等待技能输入/i.test(message);
}

const ChatMessageList = memo(function ChatMessageList({
  messageTimeTick,
  messages,
}: {
  messageTimeTick: number;
  messages: VisibleChatMessage[];
}) {
  const now = useMemo(() => new Date(messageTimeTick), [messageTimeTick]);

  return (
    <div className="message-list" aria-label="消息列表">
      {messages.map((message) => (
        <article
          className={`chat-message is-${message.role}${
            message.isStreaming ? " is-streaming" : ""
          }`}
          data-message-id={message.id}
          key={message.id}
        >
          <header className="chat-message-meta">
            <span>{message.role === "assistant" ? "智能体" : "你"}</span>
            <time dateTime={message.createdAt}>
              {formatChatMessageTime({
                role: message.role,
                createdAt: message.createdAt,
                now,
              })}
            </time>
          </header>
          {message.role === "assistant" ? (
            <AnswerBlock parts={message.outputParts} />
          ) : (
            <>
              {message.attachments?.length ? (
                <ChatAttachmentChips
                  attachments={message.attachments}
                  className="message-attachment-list"
                />
              ) : null}
              <MarkdownMessage content={message.content} />
            </>
          )}
        </article>
      ))}
    </div>
  );
});

const ChatAttachmentChips = memo(function ChatAttachmentChips(props: {
  attachments: ChatAttachmentMetadata[];
  className: string;
  onRemove?: (attachmentId: string) => void;
}) {
  return (
    <div className={`chat-attachment-list ${props.className}`} aria-label="附件">
      {props.attachments.map((attachment) => (
        <span
          className={`chat-attachment-chip is-${attachment.kind}`}
          key={attachment.id}
          title={`${attachment.name} · ${formatChatAttachmentSize(attachment.size)}`}
        >
          <strong aria-hidden="true">
            {formatChatAttachmentTypeLabel(attachment)}
          </strong>
          <span>{attachment.name}</span>
          <small>{formatChatAttachmentSize(attachment.size)}</small>
          {props.onRemove ? (
            <button
              type="button"
              aria-label={`移除附件 ${attachment.name}`}
              onClick={() => props.onRemove?.(attachment.id)}
            >
              <Icon name="close" size={12} />
            </button>
          ) : null}
        </span>
      ))}
    </div>
  );
});

const MarkdownMessage = memo(function MarkdownMessage({
  content,
}: {
  content: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const shouldPreview = shouldRenderMarkdownPreview(content);
  const previewContent = useMemo(() => createMarkdownPreview(content), [content]);
  const blocks = useMemo(
    () => (shouldPreview && !expanded ? [] : parseMarkdownBlocks(content)),
    [content, expanded, shouldPreview],
  );

  return (
    <div className="markdown-message">
      {shouldPreview && !expanded ? (
        <p className="markdown-plain-preview">{previewContent}</p>
      ) : (
        blocks.map((block, index) => (
          <MarkdownBlockView block={block} key={`${block.type}-${index}`} />
        ))
      )}
      {shouldPreview ? (
        <button
          type="button"
          aria-expanded={expanded}
          className="chat-message-collapse-button markdown-preview-toggle"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "收起完整内容" : "展开完整内容"}
        </button>
      ) : null}
    </div>
  );
});

function MarkdownBlockView({ block }: { block: MarkdownBlock }) {
  const [expanded, setExpanded] = useState(false);
  const shouldCollapse = shouldCollapseMarkdownBlock(block);
  const showFullBlock = expanded || !shouldCollapse;

  if (block.type === "heading") {
    const HeadingTag = `h${Math.min(block.depth + 2, 5)}` as
      | "h3"
      | "h4"
      | "h5";
    return (
      <HeadingTag>
        <InlineMarkdown text={block.text} />
      </HeadingTag>
    );
  }

  return (
    <div
      className={`markdown-block${
        shouldCollapse ? " chat-message-collapse" : ""
      }${shouldCollapse && !expanded ? " is-collapsed" : ""}`}
    >
      {renderMarkdownBlockContent(block, showFullBlock)}
      {shouldCollapse ? (
        <button
          type="button"
          aria-expanded={expanded}
          className="chat-message-collapse-button"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "收起" : "展开"}
        </button>
      ) : null}
    </div>
  );
}

function renderMarkdownBlockContent(
  block: MarkdownBlock,
  showFullBlock: boolean,
): ReactNode {
  if (block.type === "unorderedList") {
    const items = showFullBlock ? block.items : block.items.slice(0, 4);
    return (
      <ul>
        {items.map((item, index) => (
          <li key={`${item}-${index}`}>
            <InlineMarkdown text={item} />
          </li>
        ))}
      </ul>
    );
  }

  if (block.type === "orderedList") {
    const items = showFullBlock ? block.items : block.items.slice(0, 4);
    return (
      <ol>
        {items.map((item, index) => (
          <li key={`${item}-${index}`}>
            <InlineMarkdown text={item} />
          </li>
        ))}
      </ol>
    );
  }

  if (block.type === "taskList") {
    const items = showFullBlock ? block.items : block.items.slice(0, 4);
    return (
      <ul>
        {items.map((item, index) => (
          <li key={`${item.checked}-${item.text}-${index}`}>
            <input checked={item.checked} readOnly type="checkbox" />{" "}
            <InlineMarkdown text={item.text} />
          </li>
        ))}
      </ul>
    );
  }

  if (block.type === "code") {
    return (
      <div className="markdown-code-block">
        <div className="markdown-code-header">
          <span>{block.language ?? "text"}</span>
        </div>
        <pre>
          <code>{showFullBlock ? block.code : `${block.code.slice(0, 800)}...`}</code>
        </pre>
      </div>
    );
  }

  if (block.type === "table") {
    const rows = showFullBlock ? block.rows : block.rows.slice(0, 8);
    return (
      <div className="chat-data-table-wrap markdown-table-wrap">
        <table className="chat-data-table markdown-table">
          {block.caption ? <caption>{block.caption}</caption> : null}
          <thead>
            <tr>
              {block.columns.map((column, index) => (
                <th key={`${column}-${index}`}>
                  <InlineMarkdown text={column} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={`${row.join("|")}-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <td key={`${cell}-${cellIndex}`}>
                    <InlineMarkdown text={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (block.type === "blockquote") {
    const text = showFullBlock ? block.text : `${block.text.slice(0, 360)}...`;
    return (
      <blockquote>
        <InlineMarkdown text={text} />
      </blockquote>
    );
  }

  const text = showFullBlock ? block.text : `${block.text.slice(0, 360)}...`;
  return (
    <p>
      <InlineMarkdown text={text} />
    </p>
  );
}

function shouldCollapseMarkdownBlock(block: MarkdownBlock): boolean {
  if (block.type === "code") {
    return block.code.length > 800 || block.code.split("\n").length > 16;
  }
  if (block.type === "orderedList" || block.type === "unorderedList") {
    return block.items.length > 4 || block.items.join("\n").length > 520;
  }
  if (block.type === "taskList") {
    return (
      block.items.length > 4 ||
      block.items.map((item) => item.text).join("\n").length > 520
    );
  }
  if (block.type === "table") {
    return block.rows.length > 8 || block.rows.flat().join("\n").length > 700;
  }
  if (block.type === "paragraph") {
    return block.text.length > 420;
  }
  if (block.type === "blockquote") {
    return block.text.length > 420;
  }
  return false;
}

function InlineMarkdown({ text }: { text: string }): ReactNode {
  return parseInlineMarkdown(text).map((segment, index) => {
    if (segment.type === "strong") {
      return <strong key={`${segment.type}-${index}`}>{segment.text}</strong>;
    }
    if (segment.type === "code") {
      return <code key={`${segment.type}-${index}`}>{segment.text}</code>;
    }
    if (segment.type === "link") {
      return (
        <a
          href={segment.href}
          key={`${segment.type}-${index}`}
          rel="noreferrer"
          target="_blank"
        >
          {segment.text}
        </a>
      );
    }
    return <span key={`${segment.type}-${index}`}>{segment.text}</span>;
  });
}

function toChatHistory(messages: ChatMessage[]): ChatHistoryMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    ...(message.attachments?.length
      ? { attachments: message.attachments }
      : {}),
  }));
}

function toChatAttachmentMetadata(
  attachment: ChatAttachmentInput,
): ChatAttachmentMetadata {
  return {
    id: attachment.id,
    name: attachment.name,
    mediaType: attachment.mediaType,
    size: attachment.size,
    kind: attachment.kind,
  };
}

function toSessionRailItem(session: ChatSessionListItem): ChatSession {
  return {
    id: session.id,
    title: session.title,
    summary: session.summary || `${session.messageCount} 条消息`,
    messageCount: session.messageCount,
    ...(session.activeGoal ? { activeGoal: session.activeGoal } : {}),
    ...(session.archivedAt ? { archivedAt: session.archivedAt } : {}),
    ...(session.lastAssistantMessageAt
      ? { lastAssistantMessageAt: session.lastAssistantMessageAt }
      : {}),
    ...(session.tokenUsage ? { tokenUsage: session.tokenUsage } : {}),
    ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}),
    ...(session.workspaceSummary
      ? { workspaceSummary: session.workspaceSummary }
      : {}),
    updatedAt: session.updatedAt,
  };
}

function toSkillMentionCandidate(skill: {
  manifest: {
    name: string;
    displayName: string;
    description: string;
  };
}): SkillMentionCandidate {
  return {
    name: skill.manifest.name,
    displayName: skill.manifest.displayName,
    description: skill.manifest.description,
  };
}

function toChatMessage(message: ChatSessionRecord["messages"][number]): ChatMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    ...(message.outputParts ? { outputParts: message.outputParts } : {}),
    ...(message.attachments ? { attachments: message.attachments } : {}),
  };
}

function translateRunStatus(status: AgentRunRecord["status"]): string {
  if (status === "succeeded") return "成功";
  if (status === "canceled") return "已取消";
  return "失败";
}

function translateGoalStatus(status: ChatSessionGoalSummary["status"]): string {
  const labels: Record<ChatSessionGoalSummary["status"], string> = {
    planning: "规划中",
    executing: "执行中",
    waiting_for_review: "等待审核",
    waiting_for_acceptance: "等待最终验收",
    achieved: "已达成",
    completed_unverified: "手动完成 · 未经机器认证",
    stopped_budget: "预算已用尽",
    stopped_stalled: "停滞停止",
    stopped_blocked: "目标受阻",
    failed: "失败",
    canceled: "已取消",
  };
  return labels[status];
}

function isTerminalGoalStatus(status: ChatSessionGoalSummary["status"]): boolean {
  return (
    status === "achieved" ||
    status === "completed_unverified" ||
    status === "stopped_budget" ||
    status === "stopped_stalled" ||
    status === "stopped_blocked" ||
    status === "failed" ||
    status === "canceled"
  );
}

function canStartGoalFromChat(status: ChatSessionGoalSummary["status"]): boolean {
  return status === "planning";
}
