import {
  createContext,
  memo,
  useCallback,
  useContext,
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
import { buildFirstRunGuide, type FirstRunGuideAction } from "../../shared/firstRunGuide";
import { buildAgentReadinessChecklist } from "../../shared/agentReadiness";
import type { AgentRunEvent, AgentRunRecord } from "../../shared/agentRuns";
import type { AgentWorkspace } from "../../shared/agentWorkspace";
import type {
  ChatAttachmentInput,
  ChatAttachmentMetadata,
  ChatAgentStatus,
  ChatSessionGoalSummary,
  ChatSessionListItem,
  ChatSessionRecord,
  ChatSessionWorkSummary,
  ChatStreamEvent,
  ChatTaskStatusEvent,
  ChatTurnResultSettlementStatus,
  SendChatMessageResult,
  SkillInputField,
  SkillUserInputRequest,
} from "../../shared/chat";
import {
  deriveChatSessionWork,
  getActionableGoalSummary,
  isLiveGoalStatus,
  isRecoverableGoalStatus,
} from "../../shared/chatSessionWork";
import {
  formatChatAttachmentSize,
  formatChatAttachmentTypeLabel,
} from "../../shared/chatAttachments";
import {
  projectGoalStatusForInteraction,
  type Goal,
  type SuccessCriterion,
} from "../../shared/agentGoal";
import type { GoalDraft } from "../../shared/goalTranslation";
import type { MemoryRecord } from "../../shared/memory";
import type {
  ModelProfile,
  PublicModelCatalog,
  PublicModelSettings,
} from "../../shared/modelSettings";
import type { NavigationSectionId } from "../../shared/navigation";
import type { PlanMode, PlanModelAssignments, PlanRecord } from "../../shared/planMode";
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
import { buildAgentWorkSteps, type AgentWorkPhase, type AgentWorkStep } from "../agentWorkStatus";
import { parseInlineMarkdown, parseMarkdownBlocks, type MarkdownBlock } from "../chatMarkdown";
import { createMarkdownPreview, shouldRenderMarkdownPreview } from "../chatMarkdownPreview";
import {
  isChatSessionSelectionCurrent,
  rollbackFailedAttachmentTurn,
  shouldApplyChatRequestSettlement,
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
  buildPersistedGoalActivity,
  createTaskActivity,
  getChatStatusKindFromStatusEvent,
  getChatStatusMessageFromStatusEvent,
  getGoalUiSyncState,
  getWorkPhaseFromChatStatusEvent,
  idleTaskActivity,
  restoreChatTaskActivity,
  type RequirementProcessItem,
  type TaskActivityState,
  type SubagentProcessItem,
} from "../chatTaskActivity";
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
  finalizeChatStreamFailure,
  finalizeChatStreamResult,
  getDurableChatTaskStatusSessionId,
  getDurableChatStreamSessionId,
  projectChatDisclosureGroups,
  resolveChatDisclosureExpanded,
  type ChatDisclosureGroup,
  type ChatStreamMessage,
} from "../chatStreamReducer";
import { getChatResultSettlementUiState } from "../chatResultSettlement";
import {
  goalProgressEventMatchesActiveContext,
  goalRunEventMatchesActiveContext,
} from "../goalEventRouting";
import type { AgentContextUsage } from "../../shared/contextUsage";
import { outputPartsFromMessage, type RenderedOutputPart } from "../chatOutputModel";
import { formatChatMessageTime } from "../chatMessageTime";
import { availableChatProfiles } from "../modelProfileAvailability";
import {
  getActivePlanPresentation,
  getPlanFailurePresentation,
  getPlanOutcomePresentation,
} from "../planFailurePresentation";
import { AnswerBlock } from "./chat/AnswerBlock";
import { GoalDetailDrawer } from "./GoalDetailDrawer";
import { GoalStatusStrip } from "./GoalStatusStrip";
import { Icon, type IconName } from "./Icon";
import { useDialogFocusTrap } from "./useDialogFocusTrap";
import type {
  ToolApprovalModeState,
  ToolApprovalRequestPayload,
} from "../../shared/toolApproval";
import { shouldShowToolApproval } from "../toolApprovalVisibility";
import {
  applyToolApprovalProjectionEvent,
  createToolApprovalProjectionState,
} from "../toolApprovalProjection";
import { getGoalTerminalTruthNotice } from "../goalTerminalTruth";
import {
  ChatAttachmentReadError,
  getAttachmentPasteBlockedMessage,
  readPastedChatAttachments,
} from "../chatAttachmentPaste";

type AgentChatPanelProps = {
  newChatRequestKey?: number;
  requestedSessionId?: string | null;
  sidebarSessions?: ChatSessionListItem[];
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
type FailedChatResult = Extract<SendChatMessageResult, { ok: false }>;

type ChatStatus = {
  kind: "ready" | "working" | "paused" | "error";
  message: string;
};

type ChatSession = {
  id: string;
  title: string;
  summary: string;
  activeGoal?: ChatSessionGoalSummary;
  recoveryGoal?: ChatSessionGoalSummary;
  work?: ChatSessionWorkSummary;
  messageCount?: number;
} & Pick<
  ChatSessionListItem,
  | "updatedAt"
  | "archivedAt"
  | "lastAssistantMessageAt"
  | "tokenUsage"
  | "context"
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
export const INITIAL_RENDERED_CHAT_MESSAGE_COUNT = 80;
export const CHAT_MESSAGE_RENDER_INCREMENT = 80;
const composerRiskTooltips = {
  auto: "自动授权：普通文件、Shell 和网络操作默认放行；数据破坏、提权、密钥外传、生产发布和对外发送仍需确认。",
  goal: "目标模式：先在只读 Plan Mode 生成计划；只有你确认 Ready 计划后，才创建新的可写 Goal Run。",
} as const;

export function getRenderedChatMessageWindow<T>(
  messages: readonly T[],
  renderedMessageCount: number,
): T[] {
  const boundedCount = Math.min(
    messages.length,
    Math.max(0, Math.floor(renderedMessageCount)),
  );
  return messages.slice(messages.length - boundedCount);
}

export function AgentChatPanel({
  newChatRequestKey = 0,
  requestedSessionId = null,
  sidebarSessions,
  activeChatSessionTitle = null,
  onActiveSessionChange,
  onChatSessionsChange,
  onNavigate,
}: AgentChatPanelProps) {
  const dataBoundary = buildAgentDataBoundary(window.buildingAgent ? "desktop" : "preview");
  const [chatStreamState, setChatStreamState] = useState(() =>
    createChatStreamState(initialMessages),
  );
  const messages = chatStreamState.messages;
  const visibleChatMessages = useMemo<VisibleChatMessage[]>(() => {
      const visibleMessages: VisibleChatMessage[] = [];
      for (const message of messages) {
        if (message.role === "assistant") {
          if (
            message.goalEventRef &&
            shouldHideGoalEventReply(message.goalEventRef)
          ) {
            continue;
          }
          const outputParts = outputPartsFromMessage(message);
          if (outputParts.length > 0) {
            visibleMessages.push({ ...message, role: "assistant", outputParts });
          }
          continue;
        }

        visibleMessages.push({ ...message, role: "user" });
      }

      return visibleMessages;
  }, [messages]);
  const [renderedMessageCount, setRenderedMessageCount] = useState(
    INITIAL_RENDERED_CHAT_MESSAGE_COUNT,
  );
  const renderedChatMessages = useMemo(
    () => getRenderedChatMessageWindow(visibleChatMessages, renderedMessageCount),
    [renderedMessageCount, visibleChatMessages],
  );
  const [earlierMessageSequence, setEarlierMessageSequence] = useState<
    number | null
  >(null);
  const [earlierMessagesPending, setEarlierMessagesPending] = useState(false);
  const locallyHiddenMessageCount =
    visibleChatMessages.length - renderedChatMessages.length;
  const hiddenMessageCount =
    locallyHiddenMessageCount + Math.max(0, (earlierMessageSequence ?? 1) - 1);
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
  const [toolApprovalMode, setToolApprovalMode] = useState<ToolApprovalModeState>({
    autoApprovalEnabled: false,
    goalModeEnabled: false,
    autoApprovalLocked: false,
  });
  const { autoApprovalEnabled, goalModeEnabled, autoApprovalLocked } =
    toolApprovalMode;
  const [planModeDecisionOpen, setPlanModeDecisionOpen] = useState(false);
  const [goalPlanMode, setGoalPlanMode] = useState<PlanMode>("direct");
  const [planModelAssignments, setPlanModelAssignments] = useState<PlanModelAssignments>({});
  const [modelCatalog, setModelCatalog] = useState<PublicModelCatalog | null>(null);
  const [activePlan, setActivePlan] = useState<PlanRecord | null>(null);
  const [activeGoalPlan, setActiveGoalPlan] = useState<PlanRecord | null>(null);
  const [planActionPending, setPlanActionPending] = useState<
    "confirm" | "discard" | "retry" | null
  >(null);
  const [pendingGoalDraft, setPendingGoalDraft] = useState<GoalDraft | null>(null);
  const [goalDraftDescription, setGoalDraftDescription] = useState("");
  const [goalDraftCriteriaText, setGoalDraftCriteriaText] = useState("");
  const [goalDraftActionPending, setGoalDraftActionPending] = useState<
    "confirm" | "discard" | null
  >(null);
  const goalDraftActionPendingRef = useRef<{
    action: "confirm" | "discard";
    sequence: number;
  } | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>(() =>
    sidebarSessions?.map(toSessionRailItem) ?? fallbackSessions,
  );
  const [tasks, setTasks] = useState<ScheduledTask[]>(demoTasks);
  const [runs, setRuns] = useState<AgentRunRecord[]>(demoRuns);
  const [memories, setMemories] = useState<MemoryRecord[]>(demoMemories);
  const [workspaces, setWorkspaces] = useState<AgentWorkspace[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [workspaceActionPending, setWorkspaceActionPending] = useState<"open" | "create" | null>(
    null,
  );
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [workspaceSearch, setWorkspaceSearch] = useState("");
  const [workspaceMenuPosition, setWorkspaceMenuPosition] = useState<WorkspaceMenuPosition>({
      top: 0,
      left: 0,
      width: 420,
      maxHeight: 360,
      placement: "above",
    });
  const [modelSettings, setModelSettings] = useState<PublicModelSettings>(demoModelSettings);
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
  const [taskActivity, setTaskActivity] = useState<TaskActivityState>(idleTaskActivity);
  const [taskProcessEvents, setTaskProcessEvents] = useState<ChatTaskStatusEvent[]>([]);
  const [goalRunEvents, setGoalRunEvents] = useState<AgentRunEvent[]>([]);
  const [toolApprovalProjection, setToolApprovalProjection] = useState(
    createToolApprovalProjectionState,
  );
  const pendingToolApprovals = toolApprovalProjection.pending;
  const pendingToolApproval = pendingToolApprovals[0] ?? null;
  const [activeGoalDetail, setActiveGoalDetail] = useState<Goal | null>(null);
  const [activeGoalDetailError, setActiveGoalDetailError] =
    useState<string | null>(null);
  const [goalDrawerOpen, setGoalDrawerOpen] = useState(false);
  const [goalAcceptanceOperationPending, setGoalAcceptanceOperationPending] = useState<
    "continue_acceptance" | "mark_completed_unverified" | null
  >(null);
  const [goalAmendmentActionPending, setGoalAmendmentActionPending] = useState<
    "approve" | "reject" | null
  >(null);
  const [activeChatRequestId, setActiveChatRequestId] = useState<string | null>(null);
  const [guidedInputSubmissionPending, setGuidedInputSubmissionPending] =
    useState(false);
  const [guidedInputValues, setGuidedInputValues] = useState<
    Record<string, string | number | boolean>
  >({});
  const [chatStatusExpanded, setChatStatusExpanded] = useState(false);
  const disclosureMode = useMemo(
    () =>
      window.buildingAgent?.getConversationDisclosureMode()
      ?? resolvePreviewConversationDisclosureMode(window.location.search),
    [],
  );
  const [activityTick, setActivityTick] = useState(Date.now());
  const messageListRef = useRef<HTMLDivElement>(null);
  const shouldStickToLatestMessageRef = useRef(true);
  const pendingEarlierScrollRestoreRef = useRef<{
    scrollHeight: number;
    scrollTop: number;
  } | null>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const sessionIdRef = useRef<string | null>(sessionId);
  const sessionSelectionGenerationRef = useRef(0);
  const sessionListRefreshSequenceRef = useRef(0);
  const sessionMessageRefreshSequenceRef = useRef(0);
  const goalDetailRefreshSequenceRef = useRef(0);
  const goalMutationSequenceRef = useRef(0);
  const sessionLoadPendingRef = useRef<number | null>(null);
  const activeStatusSessionIdRef = useRef<string | null>(null);
  const activeChatRequestIdRef = useRef<string | null>(null);
  const submissionInFlightRef = useRef(false);
  const guidedInputSubmissionPendingRef = useRef<string | null>(null);
  const pendingInputRequestRef = useRef<SkillUserInputRequest | null>(null);
  const activeGoalRef = useRef<ChatSessionGoalSummary | null>(null);
  const goalAcceptanceOperationPendingRef = useRef<GoalAcceptanceOperationToken | null>(null);
  const goalAmendmentActionPendingRef = useRef<"approve" | "reject" | null>(null);
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
    const placement = spaceBelow >= 300 || spaceBelow > spaceAbove ? "below" : "above";
    const availableHeight = (placement === "below" ? spaceBelow : spaceAbove) - 8;
    const minimumHeight = Math.min(180, Math.max(120, viewportHeight - viewportMargin * 2));
    const maximumHeight = Math.max(
      minimumHeight,
      Math.min(440, viewportHeight - viewportMargin * 2),
    );
    const maxHeight = clampNumber(availableHeight, minimumHeight, maximumHeight);
    const rawTop = placement === "below" ? triggerRect.bottom + 8 : triggerRect.top - maxHeight - 8;
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

  const handleLoadEarlierMessages = useCallback(async () => {
    if (hiddenMessageCount <= 0) {
      return;
    }
    const messageList = messageListRef.current;
    pendingEarlierScrollRestoreRef.current = messageList
      ? {
          scrollHeight: messageList.scrollHeight,
          scrollTop: messageList.scrollTop,
        }
      : null;
    shouldStickToLatestMessageRef.current = false;
    if (locallyHiddenMessageCount > 0 || !earlierMessageSequence) {
      setRenderedMessageCount((current) =>
        Math.min(
          visibleChatMessages.length,
          current + CHAT_MESSAGE_RENDER_INCREMENT,
        ),
      );
      return;
    }

    const activeSessionId = sessionIdRef.current;
    const generation = sessionSelectionGenerationRef.current;
    if (
      !activeSessionId ||
      !window.buildingAgent ||
      earlierMessagesPending
    ) {
      return;
    }
    setEarlierMessagesPending(true);
    try {
      const page = await window.buildingAgent.getChatSessionTranscriptPage(
        activeSessionId,
        {
          beforeSequence: earlierMessageSequence,
          limit: CHAT_MESSAGE_RENDER_INCREMENT,
        },
      );
      if (
        !page ||
        sessionIdRef.current !== activeSessionId ||
        sessionSelectionGenerationRef.current !== generation
      ) {
        return;
      }
      const olderMessages = page.session.messages.map(toChatMessage);
      setMessages((current) => {
        const currentIds = new Set(current.map((message) => message.id));
        return [
          ...olderMessages.filter((message) => !currentIds.has(message.id)),
          ...current,
        ];
      });
      setRenderedMessageCount((current) =>
        current + olderMessages.length,
      );
      setEarlierMessageSequence(
        page.page.hasMoreBefore ? page.page.startSequence : null,
      );
    } finally {
      setEarlierMessagesPending(false);
    }
  }, [
    earlierMessageSequence,
    earlierMessagesPending,
    hiddenMessageCount,
    locallyHiddenMessageCount,
    visibleChatMessages.length,
  ]);

  useLayoutEffect(() => {
    const pendingRestore = pendingEarlierScrollRestoreRef.current;
    const messageList = messageListRef.current;
    if (!pendingRestore || !messageList) {
      return;
    }
    pendingEarlierScrollRestoreRef.current = null;
    messageList.scrollTop =
      pendingRestore.scrollTop +
      (messageList.scrollHeight - pendingRestore.scrollHeight);
  }, [renderedChatMessages.length]);

  useEffect(() => {
    if (!shouldStickToLatestMessageRef.current) {
      return;
    }
    scrollMessageListToBottom();
  }, [
    goalRunEvents.length,
    messages,
    pendingInputRequest,
    pendingToolApproval,
    planModeDecisionOpen,
    scrollMessageListToBottom,
  ]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
    onActiveSessionChange?.(sessionId);
  }, [onActiveSessionChange, sessionId]);

  useEffect(() => {
    if (!sidebarSessions) {
      return;
    }
    const nextSessions = sidebarSessions.map(toSessionRailItem);
    setSessions((currentSessions) =>
      areChatSessionListsEqual(currentSessions, nextSessions)
        ? currentSessions
        : nextSessions,
    );
  }, [sidebarSessions]);

  useEffect(() => {
    onChatSessionsChange?.(sessions);
  }, [onChatSessionsChange, sessions]);

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
      if (target instanceof Node && workspaceMenuRef.current?.contains(target)) {
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
    window.visualViewport?.addEventListener("resize", measureWorkspaceMenuPosition);
    return () => {
      window.removeEventListener("resize", measureWorkspaceMenuPosition);
      window.removeEventListener("scroll", measureWorkspaceMenuPosition, true);
      window.visualViewport?.removeEventListener("resize", measureWorkspaceMenuPosition);
    };
  }, [measureWorkspaceMenuPosition, workspaceMenuOpen]);

  useLayoutEffect(() => {
    const previousRequestId = activeChatRequestIdRef.current;
    if (previousRequestId && window.buildingAgent) {
      void window.buildingAgent.cancelChatMessage(previousRequestId);
    }
    resetActiveChatRefs();
    sessionLoadPendingRef.current = null;
    sessionSelectionGenerationRef.current += 1;
    sessionIdRef.current = null;
    pendingEarlierScrollRestoreRef.current = null;
    setSessionId(null);
    setRenderedMessageCount(INITIAL_RENDERED_CHAT_MESSAGE_COUNT);
    setEarlierMessageSequence(null);
    setEarlierMessagesPending(false);
    setChatStreamState(createChatStreamState(initialMessages));
    setStatus({ kind: "ready", message: "会话已就绪" });
    setWorkPhase("idle");
    setTaskActivity(idleTaskActivity);
    setTaskProcessEvents([]);
    setGoalRunEvents([]);
    setComposerDraft("", 0);
    setComposerAttachments([]);
    setAttachmentReadPending(false);
    setAttachmentError(null);
    setAttachmentAnnouncement("");
    setSelectedSkillName(null);
    setPendingGoalDraft(null);
    setActivePlan(null);
    setActiveGoalPlan(null);
    setPlanModeDecisionOpen(false);
    setPlanActionPending(null);
    goalAmendmentActionPendingRef.current = null;
    setGoalAmendmentActionPending(null);
    setGoalDraftDescription("");
    setGoalDraftCriteriaText("");
    goalDraftActionPendingRef.current = null;
    setGoalDraftActionPending(null);
    setSelectedWorkspaceId(null);
    setWorkspaceMenuOpen(false);
    setWorkspaceSearch("");
    setActiveGoalDetail(null);
    setActiveGoalDetailError(null);
    setGoalDrawerOpen(false);
    guidedInputSubmissionPendingRef.current = null;
    setGuidedInputSubmissionPending(false);
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
    setRenderedMessageCount(INITIAL_RENDERED_CHAT_MESSAGE_COUNT);
    setEarlierMessageSequence(null);
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
        goalProgressEventMatchesActiveContext(event, {
          activeGoalId: activeGoalId ?? null,
          activeSessionId,
        });
      if (eventBelongsToActiveGoal) {
        const goalUiState = getGoalUiSyncState(event.status);
        const description =
          activeGoalRef.current?.id === event.goalId
            ? activeGoalRef.current.description
            : event.message;
        setActiveGoalDetail((currentGoal) =>
          currentGoal?.id === event.goalId ? { ...currentGoal, status: event.status } : currentGoal,
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
        const currentSummary = activeGoalRef.current;
        if (currentSummary?.id === event.goalId) {
          applyGoalSummaryToSessions({
            ...currentSummary,
            status: event.status,
            updatedAt: event.timestamp,
          });
        }
        if (goalUiState.shouldClearActiveRequest) {
          if (!activeChatRequestIdRef.current) {
            activeStatusSessionIdRef.current = null;
          }
        }
      }
      if (eventBelongsToActiveGoal) {
        void refreshSessions(event.sessionId ?? activeSessionId ?? undefined);
        if (isTerminalGoalStatus(event.status)) {
          void refreshCurrentSessionMessages(event.sessionId ?? activeSessionId ?? undefined);
        }
      }
    });
  }, []);

  useEffect(() => {
    if (!window.buildingAgent) {
      return;
    }

    const api = window.buildingAgent;
    const unsubscribeRequest = api.onToolApprovalRequest((request) => {
      setToolApprovalProjection((current) => applyToolApprovalProjectionEvent(current, {
        type: "request",
        request,
      }));
    });
    const unsubscribeDecision = api.onToolApprovalDecision((decision) => {
      setToolApprovalProjection((current) => applyToolApprovalProjectionEvent(current, {
        type: "decision",
        decision,
      }));
    });
    const unsubscribeMode = api.onToolApprovalModeChanged((state) => {
      setToolApprovalMode(state);
    });

    void api.getPendingToolApprovals()
      .then((requests) => {
        setToolApprovalProjection((current) => applyToolApprovalProjectionEvent(current, {
          type: "snapshot",
          requests,
        }));
      })
      .catch(() => undefined);
    void api.getToolApprovalMode()
      .then((state) => {
        setToolApprovalMode(state);
      })
      .catch(() => undefined);

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
      if (
        !goalRunEventMatchesActiveContext(event, {
          activeGoalId: activeGoalRef.current?.id ?? null,
          activeSessionId: sessionIdRef.current,
        })
      ) {
        return;
      }
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
          activeChatRequestIdRef.current ?? pendingInputRequestRef.current?.requestId ?? null,
      };
      if (!chatStreamEventMatchesActive(event, activeStream)) {
        return;
      }

      const durableEventSessionId = getDurableChatStreamSessionId(event);
      if (durableEventSessionId) {
        activeStatusSessionIdRef.current = durableEventSessionId;
        setSessionId((current) => current ?? durableEventSessionId);
      }
      setChatStreamState((current) => applyChatStreamEvent(current, event, activeStream));

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
      }
    });
  }, []);

  useEffect(() => {
    if (!window.buildingAgent) {
      return;
    }

    return window.buildingAgent.onChatTaskStatusEvent((event) => {
      const activeRequestId =
        activeChatRequestIdRef.current ?? pendingInputRequestRef.current?.requestId ?? null;
      if (!activeRequestId || (event.requestId && event.requestId !== activeRequestId)) {
        return;
      }
      const activeSessionId = activeStatusSessionIdRef.current;
      const currentSessionId = sessionIdRef.current;
      if (activeSessionId && event.sessionId !== activeSessionId) {
        return;
      }
      if (!activeSessionId && currentSessionId && event.sessionId !== currentSessionId) {
        return;
      }

      const durableStatusSessionId = getDurableChatTaskStatusSessionId(event);
      if (durableStatusSessionId) {
        activeStatusSessionIdRef.current = durableStatusSessionId;
        setSessionId((current) => current ?? durableStatusSessionId);
      }
      setTaskProcessEvents((current) => appendBoundedRuntimeEvent(current, event));
      if (durableStatusSessionId && event.context) {
        setSessions((currentSessions) =>
          currentSessions.map((session) =>
            session.id === durableStatusSessionId
              ? { ...session, context: event.context }
              : session,
          ),
        );
      }
      setTaskActivity(buildTaskActivityFromStatusEvent(event));
      setStatus({
        kind: getChatStatusKindFromStatusEvent(event),
        message: getChatStatusMessageFromStatusEvent(event),
      });
      setWorkPhase(getWorkPhaseFromChatStatusEvent(event));
      if (event.state === "waiting_for_input" && event.inputRequest) {
        setPendingInputRequest(event.inputRequest);
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
      window.buildingAgent.loadAgentValidation(),
      window.buildingAgent.loadModelCatalog(),
    ])
      .then(
        async ([
          settings,
          loadedTasks,
          loadedRuns,
          loadedMemories,
          skills,
          loadedWorkspaces,
          validation,
          loadedModelCatalog,
        ]) => {
        setModelSettings(settings);
        setModelCatalog(loadedModelCatalog);
          setPlanModelAssignments(defaultPlanModelAssignments(loadedModelCatalog));
        setTasks(loadedTasks);
        setRuns(loadedRuns);
        setMemories(loadedMemories);
        setSkillCount(skills.skills.length);
        setSkillOptions(skills.skills.map(toSkillMentionCandidate));
        setWorkspaces(loadedWorkspaces);
        if (validation.ok && validation.snapshot) {
          setLastValidationSnapshot(validation.snapshot);
        }
        },
      )
      .catch((error) => {
        if (
          !activeChatRequestIdRef.current &&
          sessionLoadPendingRef.current === null &&
          sessionSelectionGenerationRef.current === 0 &&
          sessionIdRef.current === null
        ) {
          setStatus({
            kind: "error",
            message:
              error instanceof Error ? error.message : "读取智能体状态失败",
          });
        }
      });
  }, []);

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
    pendingEarlierScrollRestoreRef.current = null;
    setSessionId(sessionIdToLoad);
    setRenderedMessageCount(INITIAL_RENDERED_CHAT_MESSAGE_COUNT);
    setEarlierMessageSequence(null);
    setEarlierMessagesPending(false);
    // Drafts and their pending actions belong to the previous session. Clear
    // them synchronously so an old in-flight completion cannot strand or
    // expose session-scoped controls while the next transcript is loading.
    setPendingGoalDraft(null);
    setActivePlan(null);
    setActiveGoalPlan(null);
    setPlanModeDecisionOpen(false);
    setPlanActionPending(null);
    goalAmendmentActionPendingRef.current = null;
    setGoalAmendmentActionPending(null);
    setGoalDraftDescription("");
    setGoalDraftCriteriaText("");
    goalDraftActionPendingRef.current = null;
    setGoalDraftActionPending(null);
    setActiveGoalDetail(null);
    setActiveGoalDetailError(null);
    setSelectedWorkspaceId(null);
    setComposerDraft("", 0);
    setComposerAttachments([]);
    setAttachmentReadPending(false);
    setAttachmentError(null);
    setAttachmentAnnouncement("");
    setSelectedSkillName(null);
    guidedInputSubmissionPendingRef.current = null;
    setGuidedInputSubmissionPending(false);
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
      const loadedPage =
        await window.buildingAgent.getChatSessionTranscriptPage(
          sessionIdToLoad,
          { limit: INITIAL_RENDERED_CHAT_MESSAGE_COUNT },
        );
      const loadedSession = loadedPage?.session ?? null;
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
      setEarlierMessageSequence(
        loadedPage?.page.hasMoreBefore
          ? loadedPage.page.startSequence
          : null,
      );
      setSelectedWorkspaceId(loadedSession.workspaceId ?? null);
      const restoredActivity = restoreChatTaskActivity(loadedSession.activity);
      shouldStickToLatestMessageRef.current = true;
      setChatStreamState({
        ...createChatStreamState(loadedSession.messages.map(toChatMessage)),
        pendingInputRequest: restoredActivity?.pendingInputRequest ?? null,
      });
      window.requestAnimationFrame(scrollMessageListToBottom);
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
      const latestPlan = await window.buildingAgent.getLatestPlanForSession(loadedSession.id);
      if (
        sessionSelectionGenerationRef.current !== loadGeneration ||
        sessionIdRef.current !== sessionIdToLoad
      ) {
        return;
      }
      setActivePlan(latestPlan && latestPlan.status !== "discarded" ? latestPlan : null);
      const sessionWork = deriveChatSessionWork(loadedSession);
      const actionableGoal = getActionableGoalSummary(loadedSession);
      const restoredGoalId =
        actionableGoal?.id ??
        latestPlan?.executionGoalId ??
        (!latestPlan ? loadedSession.goalSummaries?.at(-1)?.id : undefined);
      if (
        latestPlan &&
        latestPlan.status !== "discarded" &&
        !restoredGoalId &&
        isPlanInputRoutingLocked(latestPlan)
      ) {
        const planPresentation = getActivePlanPresentation(latestPlan);
        setWorkPhase("paused");
        setStatus({
          kind: "paused",
          message: planPresentation.statusMessage,
        });
        setTaskActivity(
          createTaskActivity({
            kind: "paused",
            title: planPresentation.taskTitle,
            detail: planPresentation.taskDetail,
          }),
        );
        activeStatusSessionIdRef.current = loadedSession.id;
      }
      if (latestPlan) {
        void refreshSessions(loadedSession.id);
        void refreshCurrentSessionMessages(loadedSession.id);
      }
      if (restoredGoalId) {
        const loadedGoal = await window.buildingAgent.getGoal(restoredGoalId);
        const restoredActivePlan = loadedGoal?.activePlanRef?.planId
          ? await window.buildingAgent.getPlan(loadedGoal.activePlanRef.planId)
          : null;
        if (
          sessionSelectionGenerationRef.current !== loadGeneration ||
          sessionIdRef.current !== sessionIdToLoad
        ) {
          return;
        }
        setActiveGoalDetail(loadedGoal);
        setActiveGoalPlan(restoredActivePlan);
        if (
          restoredActivePlan &&
          (!latestPlan ||
            latestPlan.status === "discarded" ||
            latestPlan.executionGoalId === loadedGoal?.id)
        ) {
          setActivePlan(restoredActivePlan);
        }
        if (
          loadedGoal &&
          sessionWork.source === "goal" &&
          sessionWork.goalId === loadedGoal.id
        ) {
          const restoredGoalActivity = buildPersistedGoalActivity({
            status: loadedGoal.status,
            description: loadedGoal.description,
          });
          setStatus(restoredGoalActivity.status);
          setWorkPhase(restoredGoalActivity.workPhase);
          setTaskActivity(restoredGoalActivity.taskActivity);
          activeStatusSessionIdRef.current = null;
        }
      } else {
        setActiveGoalDetail(null);
        setActiveGoalPlan(null);
        setGoalDrawerOpen(false);
      }
      void refreshSessions(loadedSession.id);
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
    if (nextActiveSessionId && sessionIdRef.current === nextActiveSessionId) {
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
    setActiveGoalDetailError(null);
    try {
      const goal = await window.buildingAgent.getGoal(goalId);
      const goalPlan = goal?.activePlanRef?.planId
        ? await window.buildingAgent.getPlan(goal.activePlanRef.planId)
        : null;
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
      setActiveGoalPlan(goalPlan);
      if (!goal) {
        setActiveGoalDetailError("目标详情不存在或已被删除。");
        return;
      }
      if (goalPlan) {
        setActivePlan((current) =>
          !current ||
          current.id === goalPlan.id ||
          current.executionGoalId === goalId
            ? goalPlan
            : current,
        );
      }
    } catch (error) {
      if (
        shouldApplySequencedSessionResult(
          selection,
          sessionIdRef.current,
          sessionSelectionGenerationRef.current,
          requestSequence,
          goalDetailRefreshSequenceRef.current,
        )
      ) {
        setActiveGoalDetailError(
          error instanceof Error ? error.message : "加载目标详情失败。",
        );
      }
    }
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
    const refreshSequence = sessionMessageRefreshSequenceRef.current + 1;
    sessionMessageRefreshSequenceRef.current = refreshSequence;
    if (
      !shouldApplyPersistedSessionRefresh(
        sessionIdRef.current,
        currentSessionId,
        sessionSelectionGenerationRef.current,
        refreshGeneration,
      ) ||
      refreshSequence !== sessionMessageRefreshSequenceRef.current
    ) {
      return;
    }

    const loadedPage = await window.buildingAgent
      .getChatSessionTranscriptPage(currentSessionId, {
        limit: Math.min(
          200,
          Math.max(
            INITIAL_RENDERED_CHAT_MESSAGE_COUNT,
            renderedMessageCount,
          ),
        ),
      })
      .catch(() => null);
    const loadedSession = loadedPage?.session;
    if (!loadedSession) {
      return;
    }

    if (
      !shouldApplyPersistedSessionRefresh(
        sessionIdRef.current,
        currentSessionId,
        sessionSelectionGenerationRef.current,
        refreshGeneration,
      ) ||
      refreshSequence !== sessionMessageRefreshSequenceRef.current
    ) {
      return;
    }

    if (!sessionIdRef.current) {
      setSessionId(loadedSession.id);
    }
    const recentMessages = loadedSession.messages.map(toChatMessage);
    setMessages((current) => {
      const recentIds = new Set(recentMessages.map((message) => message.id));
      return [
        ...current.filter((message) => !recentIds.has(message.id)),
        ...recentMessages,
      ];
    });
    setEarlierMessageSequence((current) => {
      const next = loadedPage.page.hasMoreBefore
        ? loadedPage.page.startSequence
        : null;
      if (current !== null && next !== null) {
        return Math.min(current, next);
      }
      return current ?? next;
    });
  }

  function applyGoalSummaryToSessions(goal: ChatSessionGoalSummary) {
    setSessions((currentSessions) => {
      return currentSessions.map((session) => {
        if (
          session.activeGoal?.id !== goal.id &&
          session.recoveryGoal?.id !== goal.id
        ) {
          return session;
        }
        if (isLiveGoalStatus(goal.status)) {
          return {
            ...session,
            activeGoal: goal,
            recoveryGoal:
              session.recoveryGoal?.id === goal.id
                ? undefined
                : session.recoveryGoal,
            work: {
              source: "goal",
              relationship: "active",
              goalId: goal.id,
              status: goal.status,
              updatedAt: goal.updatedAt ?? new Date().toISOString(),
            },
          };
        }
        if (isRecoverableGoalStatus(goal.status)) {
          return {
            ...session,
            activeGoal:
              session.activeGoal?.id === goal.id ? undefined : session.activeGoal,
            recoveryGoal: goal,
            work: {
              source: "goal",
              relationship: "recovery",
              goalId: goal.id,
              status: goal.status,
              updatedAt: goal.updatedAt ?? new Date().toISOString(),
            },
          };
        }
        return {
          ...session,
          activeGoal:
            session.activeGoal?.id === goal.id ? undefined : session.activeGoal,
          recoveryGoal:
            session.recoveryGoal?.id === goal.id
              ? undefined
              : session.recoveryGoal,
        };
      });
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
  ]
    .filter(Boolean)
    .join(" ");
  const activeGoal =
    activeSession?.activeGoal ?? activeSession?.recoveryGoal ?? null;
  const primaryGoalId =
    activeSession?.work?.source === "goal"
      ? activeSession.work.goalId
      : null;
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
    if (pending && !isGoalAcceptanceOperationCurrent(pending, goalAcceptanceContext, pending)) {
      goalAcceptanceOperationPendingRef.current = null;
      setGoalAcceptanceOperationPending(null);
    }
  }, [goalAcceptanceContext]);
  useEffect(() => {
    const goalId = activeGoal?.id;
    setActiveGoalDetailError(null);
    setActiveGoalDetail((current) =>
      current?.id === goalId ? current : null,
    );
    setActiveGoalPlan((current) =>
      current?.goalId === goalId ? current : null,
    );
    if (goalId) {
      void refreshActiveGoalDetail(goalId);
    }
  }, [activeGoal?.id]);
  const planInputLocked = isPlanInputRoutingLocked(activePlan);
  const planAcceptsComposerInput =
    activePlan?.status === "awaiting_confirmation" ||
    (activePlan?.status === "paused" && Boolean(activePlan.finalArtifact));
  const planNeedsDecision =
    Boolean(activePlan) &&
    !activePlan?.executionGoalId &&
    ["awaiting_input", "awaiting_confirmation", "paused", "canceled", "failed"].includes(
      activePlan?.status ?? "",
    );
  const goalAmendment = activeGoalDetail?.pendingGoalAmendment;
  const planConfirmBlockedReason =
    goalAmendment?.status === "pending"
      ? "请先批准或拒绝目标修订提案，再决定是否采用 Plan。"
      : goalAmendment?.status === "approved" &&
          goalAmendment.candidatePlanId !== activePlan?.id
        ? "目标修订已批准但尚未生成对应 Plan；请重试生成或撤销修订。"
        : undefined;
  const activeGoalInteractionStatus = activeGoalDetail
    ? projectGoalStatusForInteraction(activeGoalDetail)
    : activeGoal?.status;
  const goalIsRecovery = Boolean(
    activeGoal &&
      activeSession?.recoveryGoal?.id === activeGoal.id &&
      activeGoalInteractionStatus !== "waiting_for_acceptance",
  );
  const goalNeedsDecision = activeGoalInteractionStatus
    ? needsGoalDecision(activeGoalInteractionStatus)
    : false;
  const goalModeVisuallyEnabled = goalModeEnabled || planInputLocked;
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
  const chatDisclosureGroups = useMemo(
    () => projectChatDisclosureGroups(taskProcessEvents),
    [taskProcessEvents],
  );
  const latestStreamContext = [...taskProcessEvents]
    .reverse()
    .find((event) => event.context)?.context;
  const activeContextUsage =
    activeGoalDetail?.contextUsage ?? latestStreamContext ?? activeSession?.context;
  const requirementProcessItems = useMemo(
    () => buildRequirementProcessItems(taskProcessEvents),
    [taskProcessEvents],
  );
  const subagentProcessItems = useMemo(
    () => buildSubagentProcessItems(taskProcessEvents),
    [taskProcessEvents],
  );
  const hasActiveSubagents = subagentProcessItems.some((item) => item.status === "running");
  const chatRequestInFlight = activeChatRequestId !== null;
  const canCancelChatTask =
    Boolean(window.buildingAgent) &&
    (status.kind === "working" || taskActivity.kind === "working");
  const canInterruptCurrentWork = canCancelChatTask || Boolean(activeGoal?.status === "executing");
  const workspaceActionsDisabled =
    !window.buildingAgent ||
    Boolean(workspaceActionPending) ||
    chatRequestInFlight ||
    status.kind === "working" ||
    planInputLocked;
  const activeSkillMention = useMemo(
    () => extractActiveSkillMention(draft, draftCursor),
    [draft, draftCursor],
  );
  const skillMentionMatches = useMemo(
    () =>
      activeSkillMention ? matchSkillMentionCandidates(skillOptions, activeSkillMention.query) : [],
    [activeSkillMention, skillOptions],
  );
  const selectedSkill = selectedSkillName
    ? (skillOptions.find((skill) => skill.name === selectedSkillName) ?? null)
    : null;
  const selectedWorkspace = selectedWorkspaceId
    ? (workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null)
    : null;
  const activeWorkspaceLabel =
    selectedWorkspace?.name ?? activeSession?.workspaceSummary?.name ?? "默认工作区";
  const activeWorkspacePath =
    selectedWorkspace?.rootPath ?? activeSession?.workspaceSummary?.rootPath ?? "";
  const visibleWorkspaces = useMemo(() => {
    const query = workspaceSearch.trim().toLowerCase();
    if (!query) {
      return workspaces;
    }

    return workspaces.filter((workspace) =>
      [workspace.name, workspace.rootPath, workspace.kind].join(" ").toLowerCase().includes(query),
    );
  }, [workspaceSearch, workspaces]);
  const workspaceMenuStyle = {
    "--workspace-menu-top": `${workspaceMenuPosition.top}px`,
    "--workspace-menu-left": `${workspaceMenuPosition.left}px`,
    "--workspace-menu-width": `${workspaceMenuPosition.width}px`,
    "--workspace-menu-max-height": `${workspaceMenuPosition.maxHeight}px`,
  } as CSSProperties;
  const hasRuntimeSurfaces =
    planModeDecisionOpen ||
    Boolean(pendingGoalDraft) ||
    planNeedsDecision ||
    goalNeedsDecision ||
    shouldShowToolApproval(pendingToolApproval, autoApprovalEnabled) ||
    Boolean(pendingInputRequest);
  const skillMentionMenuVisible =
    !planInputLocked &&
    Boolean(activeSkillMention) &&
    skillMentionMatches.length > 0 &&
    !(selectedSkillName && activeSkillMention?.query.toLowerCase() === selectedSkillName);

  useEffect(() => {
    if (planInputLocked) {
      setWorkspaceMenuOpen(false);
      setWorkspaceSearch("");
    }
  }, [planInputLocked]);

  useEffect(() => {
    if (
      !planInputLocked ||
      toolApprovalMode.goalModeEnabled ||
      !window.buildingAgent
    ) {
      return;
    }
    // A persisted Plan proves that Goal mode was selected before this
    // renderer/main-process lifecycle. Re-establish the same autonomy policy
    // instead of showing a visually locked Goal mode with authorization off.
    void window.buildingAgent
      .setToolGoalModeEnabled(true)
      .then((state) => setToolApprovalMode(state))
      .catch(() => {
        setStatus({
          kind: "error",
          message: "目标模式已恢复，但自动授权同步失败，请重新打开目标模式。",
        });
      });
  }, [planInputLocked, toolApprovalMode.goalModeEnabled]);

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
    primaryGoalId,
    requirementProcessItems,
    taskProcessItems,
    workSteps,
    status,
  });
  const contextPanelItems = buildContextPanelItems({
    contextCards,
    activeGoal,
    goalIsRecovery,
    goalStatus: activeGoalInteractionStatus,
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
    () => buildAgentOnboardingState(readinessChecklist, lastValidationSnapshot?.validatedAt),
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
    Boolean(activePlan) ||
    goalModeEnabled ||
    planInputLocked ||
    Boolean(activeContextUsage) ||
    goalRunEvents.length > 0 ||
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

  function setMessages(updater: ChatMessage[] | ((current: ChatMessage[]) => ChatMessage[])) {
    setChatStreamState((current) => ({
      ...current,
      messages: typeof updater === "function" ? updater(current.messages) : updater,
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

  function isSessionSelectionCurrent(captured: ChatSessionSelectionContext): boolean {
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
      mutationSequence === goalMutationSequenceRef.current && isSessionSelectionCurrent(captured)
    );
  }

  function applyCanonicalGoalState(goal: Goal): string {
    setActiveGoalDetail(goal);
    setActiveGoalDetailError(null);
    applyGoalSummaryToSessions(goal);
    const activity = buildPersistedGoalActivity({
      status: goal.status,
      description: goal.description,
    });
    setStatus(activity.status);
    setWorkPhase(activity.workPhase);
    setTaskActivity(activity.taskActivity);
    const syncState = getGoalUiSyncState(goal.status);
    if (syncState.shouldClearActiveRequest && !activeChatRequestIdRef.current) {
      activeStatusSessionIdRef.current = null;
    }
    return activity.taskActivity.title;
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
    if (workspaceActionsDisabled) {
      return;
    }
    setWorkspaces((current) => [workspace, ...current.filter((item) => item.id !== workspace.id)]);
    setSelectedWorkspaceId(workspace.id);
    setWorkspaceMenuOpen(false);
    setWorkspaceSearch("");
  }

  function handleSelectDefaultWorkspace() {
    if (workspaceActionsDisabled) {
      return;
    }
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
        message: error instanceof Error ? error.message : "打开工作区失败，请稍后重试。",
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
        message: error instanceof Error ? error.message : "新建工作区失败，请稍后重试。",
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

  async function handleComposerPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const itemFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    const files = itemFiles.length ? itemFiles : Array.from(event.clipboardData.files);
    if (!files.length) {
      return;
    }
    event.preventDefault();
    const blockedMessage = getAttachmentPasteBlockedMessage({
      attachmentReadPending,
      working: status.kind === "working",
    });
    if (blockedMessage) {
      setAttachmentError(blockedMessage);
      setAttachmentAnnouncement(blockedMessage);
      return;
    }
    setAttachmentReadPending(true);
    setAttachmentError(null);
    const pasteGeneration = sessionSelectionGenerationRef.current;
    try {
      const attachments = await readPastedChatAttachments(files, draftAttachmentsRef.current);
      if (pasteGeneration !== sessionSelectionGenerationRef.current) {
        return;
      }
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
      if (pasteGeneration === sessionSelectionGenerationRef.current) {
        setAttachmentError(
          error instanceof ChatAttachmentReadError
            ? error.message
            : "无法读取粘贴的附件。",
        );
      }
    } finally {
      if (pasteGeneration === sessionSelectionGenerationRef.current) {
        setAttachmentReadPending(false);
      }
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
      let outcomeMessage: string | null = null;
      if (result.ok && result.goal) {
        outcomeMessage = applyCanonicalGoalState(result.goal);
        void refreshActiveGoalDetail(goalId);
        void refreshSessions(sessionId ?? undefined);
      }
      appendMessage({
        role: "assistant",
        content:
          result.ok && outcomeMessage
            ? `${outcomeMessage}。`
            : `目标继续失败：${result.message ?? "未返回目标状态。"}`,
      });
      return;
    }

    if (decision === "terminate") {
      const result = await window.buildingAgent.cancelGoal(goalId);
      if (!isGoalMutationCurrent(selection, mutationSequence)) {
        return;
      }
      let outcomeMessage: string | null = null;
      if (result.ok && result.goal) {
        outcomeMessage = applyCanonicalGoalState(result.goal);
        void refreshActiveGoalDetail(result.goal.id);
        void refreshSessions(sessionId ?? undefined);
      }
      appendMessage({
        role: "assistant",
        content:
          result.ok && outcomeMessage
            ? `${outcomeMessage}。`
            : `终止目标失败：${result.message ?? "未返回目标状态。"}`,
      });
      return;
    }

    setComposerDraft("调整目标计划：");
    window.requestAnimationFrame(() => {
      messageInputRef.current?.focus();
    });
  }

  function handleReplanGoal() {
    if (!window.buildingAgent || !activeGoal?.id) {
      return;
    }
    setComposerDraft("调整目标计划：");
    setStatus({
      kind: "paused",
      message: "请说明需要改变的依赖、工具路径、执行方法或验收路径",
    });
    setWorkPhase("paused");
    setTaskActivity(
      createTaskActivity({
        kind: "paused",
        title: "等待重规划意见",
        detail: "提交后将生成新的运行期 Direct Plan，采用前不会覆盖当前 Goal",
      }),
    );
    window.requestAnimationFrame(() => {
      messageInputRef.current?.focus();
    });
  }

  async function handleResolveGoalAmendment(
    decision: "approve" | "reject",
  ) {
    const proposal = activeGoalDetail?.pendingGoalAmendment;
    if (
      !window.buildingAgent ||
      !activeGoal?.id ||
      !proposal ||
      goalAmendmentActionPendingRef.current
    ) {
      return;
    }
    const selection = captureSessionSelection();
    const mutationSequence = beginGoalMutation();
    goalAmendmentActionPendingRef.current = decision;
    setGoalAmendmentActionPending(decision);
    setStatus({
      kind: "working",
      message:
        decision === "approve"
          ? "正在暂停旧路径并生成修订后的 Direct Plan…"
          : "正在撤销目标修订…",
    });
    setWorkPhase(decision === "approve" ? "planning" : "paused");
    try {
      const result = await window.buildingAgent.resolveGoalAmendment(
        activeGoal.id,
        proposal.id,
        decision,
      );
      if (!isGoalMutationCurrent(selection, mutationSequence)) return;
      appendMessage({
        role: "assistant",
        content: result.ok ? result.message : `处理目标修订失败：${result.message}`,
      });
      if (result.ok && result.plan) {
        setActivePlan(result.plan);
        setStatus({ kind: "paused", message: "修订 Direct Plan 等待采用" });
        setWorkPhase("planning");
        setTaskActivity(
          createTaskActivity({
            kind: "paused",
            title: `Plan v${result.plan.goalPlanVersion ?? 1} · Direct`,
            detail: "Goal 修订尚未应用；采用此 Plan 后才会切换目标语义",
          }),
        );
      } else if (result.ok) {
        setStatus({
          kind: "paused",
          message:
            decision === "approve"
              ? "目标修订已批准但尚未应用，请重试生成 Direct Plan 或撤销修订"
              : "目标修订已撤销",
        });
        setWorkPhase("paused");
      } else {
        setStatus({ kind: "error", message: result.message });
      }
      void refreshActiveGoalDetail(activeGoal.id);
      void refreshSessions(sessionId ?? undefined);
    } finally {
      if (goalAmendmentActionPendingRef.current === decision) {
        goalAmendmentActionPendingRef.current = null;
        if (isGoalMutationCurrent(selection, mutationSequence)) {
          setGoalAmendmentActionPending(null);
        }
      }
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
    let outcomeMessage: string | null = null;
    if (result.ok && result.goal) {
      outcomeMessage = applyCanonicalGoalState(result.goal);
    }
    appendMessage({
      role: "assistant",
      content: result.ok
        ? retryStarted
          ? "已重试目标，继续执行。"
          : `${outcomeMessage ?? "重试未启动"}。`
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
      const result = await window.buildingAgent.continueGoalAcceptance(operation.goalId);
      if (
        !isGoalAcceptanceOperationCurrent(
          operation,
          goalAcceptanceContextRef.current.context,
          goalAcceptanceOperationPendingRef.current,
        ) ||
        !isGoalMutationCurrent(selection, mutationSequence)
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
        appendMessage({
          role: "assistant",
          content: `继续验收失败：${message}`,
        });
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
      setStatus({
        kind: goalUiState.statusKind,
        message: outcome.statusMessage,
      });
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
        ) ||
        !isGoalMutationCurrent(selection, mutationSequence)
      ) {
        return;
      }
      const message = "继续最终验收失败，请稍后重试。";
      setStatus({ kind: "error", message });
      appendMessage({ role: "assistant", content: message });
    } finally {
      if (
        doesGoalAcceptanceOperationOwnPending(operation, goalAcceptanceOperationPendingRef.current)
      ) {
        goalAcceptanceOperationPendingRef.current = null;
        setGoalAcceptanceOperationPending(null);
      }
    }
  }

  async function handleMarkGoalCompletedUnverified(confirmation: ManualCompletionConfirmation) {
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
      const result = await window.buildingAgent.markGoalCompletedUnverified(operation.goalId);
      if (
        !isGoalAcceptanceOperationCurrent(
          operation,
          goalAcceptanceContextRef.current.context,
          goalAcceptanceOperationPendingRef.current,
        ) ||
        !isGoalMutationCurrent(selection, mutationSequence)
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
        appendMessage({
          role: "assistant",
          content: `手动标记完成失败：${message}`,
        });
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
      setStatus({
        kind: goalUiState.statusKind,
        message: outcome.statusMessage,
      });
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
        ) ||
        !isGoalMutationCurrent(selection, mutationSequence)
      ) {
        return;
      }
      const message = "手动标记完成失败，请稍后重试。";
      setStatus({ kind: "error", message });
      appendMessage({ role: "assistant", content: message });
    } finally {
      if (
        doesGoalAcceptanceOperationOwnPending(operation, goalAcceptanceOperationPendingRef.current)
      ) {
        goalAcceptanceOperationPendingRef.current = null;
        setGoalAcceptanceOperationPending(null);
      }
    }
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
    let outcomeMessage: string | null = null;
    if (result.ok && result.goal) {
      outcomeMessage = applyCanonicalGoalState(result.goal);
    }
    appendMessage({
      role: "assistant",
      content:
        result.ok && outcomeMessage
          ? `${outcomeMessage}。`
          : `暂停目标失败：${result.message ?? "未返回目标状态。"}`,
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
    let outcomeMessage: string | null = null;
    if (result.ok && result.goal) {
      outcomeMessage = applyCanonicalGoalState(result.goal);
    }
    appendMessage({
      role: "assistant",
      content:
        result.ok && outcomeMessage
          ? `${outcomeMessage}。`
          : `取消目标失败：${result.message ?? "未返回目标状态。"}`,
    });
    if (result.ok && result.goal) {
      void refreshActiveGoalDetail(result.goal.id);
      void refreshSessions(sessionId ?? undefined);
    }
  }

  async function handleSetAutoApprovalEnabled(enabled: boolean) {
    const previousState = toolApprovalMode;
    setToolApprovalMode({
      ...previousState,
      autoApprovalEnabled: enabled,
    });
    try {
      const state = await window.buildingAgent?.setToolAutoApprovalEnabled(enabled);
      if (state) setToolApprovalMode(state);
    } catch {
      const recovered = await window.buildingAgent
        ?.getToolApprovalMode()
        .catch(() => null);
      setToolApprovalMode(recovered ?? previousState);
    }
  }

  async function handleSetGoalModeEnabled(enabled: boolean) {
    const previousState = toolApprovalMode;
    const selectedGoalState: ToolApprovalModeState = {
      autoApprovalEnabled: true,
      goalModeEnabled: true,
      autoApprovalLocked: true,
    };
    if (enabled) {
      setToolApprovalMode(selectedGoalState);
      setPlanModeDecisionOpen(true);
    } else {
      setPlanModeDecisionOpen(false);
    }
    if (!window.buildingAgent) return;

    try {
      const state = await window.buildingAgent.setToolGoalModeEnabled(enabled);
      if (
        enabled &&
        (!state.goalModeEnabled ||
          !state.autoApprovalEnabled ||
          !state.autoApprovalLocked)
      ) {
        throw new Error("Goal autonomy invariant was not established.");
      }
      setToolApprovalMode(state);
      if (!enabled && state.goalModeEnabled && state.autoApprovalLocked) {
        setGoalDrawerOpen(true);
      }
    } catch {
      const recovered = await window.buildingAgent
        .getToolApprovalMode()
        .catch(() => null);
      if (
        recovered &&
        recovered.goalModeEnabled === enabled &&
        (!enabled ||
          (recovered.autoApprovalEnabled && recovered.autoApprovalLocked))
      ) {
        setToolApprovalMode(recovered);
        return;
      }
      setToolApprovalMode(previousState);
      if (enabled) setPlanModeDecisionOpen(false);
      setStatus({
        kind: "error",
        message: "目标模式未能开启，请重试；自动授权状态没有改变。",
      });
    }
  }

  async function handleResolveToolApproval(approved: boolean) {
    if (!window.buildingAgent || !pendingToolApproval) {
      return;
    }

    const id = pendingToolApproval.id;
    const resolved = await window.buildingAgent
      .resolveToolApproval({
        id,
        approved,
        expectedRevision: pendingToolApproval.revision ?? 1,
        decisionId: `renderer:${id}:${approved ? "approved" : "denied"}`,
      })
      .catch(() => false);
    if (!resolved) {
      setStatus({
        kind: "error",
        message: "授权请求已失效，请查看最新运行状态。",
      });
    }
  }

  function applySuccessfulChatResult(result: SuccessfulChatResult, requestId: string) {
    const durableSessionId =
      result.domainStateAvailable === true ? result.sessionId : null;
    if (durableSessionId) {
      sessionIdRef.current = durableSessionId;
      setSessionId(durableSessionId);
    }
    if (result.goalDraft) {
      setPendingGoalDraft(result.goalDraft);
      setGoalDraftDescription(result.goalDraft.normalizedDescription);
      setGoalDraftCriteriaText(formatGoalDraftCriteria(result.goalDraft));
    }
    if (result.plan) {
      setActivePlan(result.plan);
      setPendingGoalDraft(null);
    }
    if (result.executedRun) {
      setRuns((currentRuns) => [result.executedRun!, ...currentRuns]);
    }
    if (result.createdTask) {
      setTasks((currentTasks) => [result.createdTask!, ...currentTasks]);
    }
    if (result.activeGoal) {
      void refreshActiveGoalDetail(result.activeGoal.id);
    } else if (result.plan?.goalId) {
      void refreshActiveGoalDetail(result.plan.goalId);
    }
    setSelectedSkillName(null);
    const pausedAgentStatus =
      result.agentStatus?.state === "paused" ? result.agentStatus : null;
    const failedAgentStatus = result.agentStatus?.state === "failed" ? result.agentStatus : null;
    const settlementUiState = getChatResultSettlementUiState(result);
    const isPaused = settlementUiState === "paused";
    const isFailed = settlementUiState === "failed";
    const isCanceled = settlementUiState === "canceled";
    const isGoalExecuting = result.activeGoal?.status === "executing";
    const isGoalDraft = Boolean(result.goalDraft);
    const isPlanAwaitingConfirmation = result.plan?.status === "awaiting_confirmation";
    const isPlanPaused = Boolean(result.plan && result.plan.status !== "awaiting_confirmation");
    const planFailure = result.plan
      ? getPlanFailurePresentation(result.plan)
      : null;
    setStatus({
      kind: isGoalExecuting
          ? "working"
          : isFailed
            ? "error"
          : isCanceled
            ? "ready"
          : isPaused || isPlanPaused || isPlanAwaitingConfirmation
            ? "paused"
            : "ready",
      message: isFailed
        ? formatAgentFailureForDisplay(failedAgentStatus?.message)
        : isCanceled
          ? "本轮执行已取消"
        : isPlanAwaitingConfirmation
        ? result.plan?.purpose === "runtime_replan"
          ? "运行期 Direct Plan 等待采用"
          : "计划已生成，确认前不会执行"
        : isPlanPaused
          ? planFailure
            ? `${planFailure.title}：${planFailure.detail}`
            : "规划未完成，请查看计划卡片中的原因和恢复操作"
        : isGoalDraft
        ? "目标草案已生成，等待确认"
        : isGoalExecuting
        ? "目标正在后台执行"
        : isPaused
        ? result.turnSettlementStatus === "unknown"
          ? "历史回复已恢复，但本轮执行结果无法确认，需要重新对账"
          : pausedAgentStatus?.modelServiceNotice?.kind === "output_limit"
          ? "模型输出未完成，等待你继续生成"
          : pausedAgentStatus?.modelServiceNotice
            ? "模型服务返回限制，等待你重试"
            : "等待你确认是否继续"
        : result.createdTask
          ? "任务已创建"
          : result.executedRun
            ? `任务已运行：${translateRunStatus(result.executedRun.status)}`
            : result.relatedMemories.length
              ? `已参考 ${result.relatedMemories.length} 条记忆`
              : "模型已回复",
    });
    setWorkPhase(
      isGoalExecuting
        ? "tool"
        : isFailed
          ? "error"
        : isCanceled
          ? "done"
        : isPaused || isPlanPaused || isPlanAwaitingConfirmation
          ? "paused"
          : "done",
    );
    setTaskActivity(
      result.plan
        ? createTaskActivity({
            kind: "paused",
            title:
              result.plan.status === "awaiting_confirmation"
                ? result.plan.purpose === "runtime_replan"
                  ? `等待采用 Direct Plan v${result.plan.goalPlanVersion ?? 1}`
                  : "等待确认终版计划"
                : planFailure?.title ?? "规划未完成",
            detail:
              planFailure?.detail ??
              result.plan.finalArtifact?.title ??
              result.plan.taskContract.objective,
          })
        : isGoalDraft && result.goalDraft
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
            turnSettlementStatus: result.turnSettlementStatus,
            relatedMemoryCount: result.relatedMemories.length,
            fallbackDetail:
              result.turnSettlementStatus === "unknown"
                ? "历史回复缺少可验证的执行结算收据"
                : isCanceled
                  ? "本轮执行已取消"
                : isPaused
                  ? "等待确认"
                  : "回复已写入会话",
          }),
    );
    activeStatusSessionIdRef.current =
      durableSessionId
      && (isPaused || isGoalExecuting || isGoalDraft || Boolean(result.plan))
        ? durableSessionId
        : null;
    setChatStreamState((current) =>
      finalizeChatStreamResult(current, {
        requestId,
        sessionId: result.sessionId,
        reply: result.reply,
        createdAt: new Date().toISOString(),
        suppressReply:
          Boolean(result.goalDraft || result.plan) ||
          Boolean(
            result.activeGoal &&
              !isTerminalGoalStatus(result.activeGoal.status),
          ),
      }),
    );
    if (durableSessionId) {
      void refreshSessions(durableSessionId);
      // Persisted session state is authoritative after optimistic streaming.
      void refreshCurrentSessionMessages(durableSessionId);
    }
  }

  async function handleConfirmGoalDraft() {
    if (!window.buildingAgent || !pendingGoalDraft || goalDraftActionPendingRef.current) {
      return;
    }

    const draftToConfirm = pendingGoalDraft;
    const selection = captureSessionSelection();
    if (selection.sessionId !== draftToConfirm.sessionId) {
      return;
    }
    const mutationSequence = beginGoalMutation();
    const pendingOperation = {
      action: "confirm" as const,
      sequence: mutationSequence,
    };
    goalDraftActionPendingRef.current = pendingOperation;
    setGoalDraftActionPending("confirm");
    setStatus({ kind: "working", message: "正在确认并启动目标..." });
    try {
      const result = await window.buildingAgent.confirmGoalDraft(draftToConfirm.id, {
          normalizedDescription: goalDraftDescription,
        successCriteria: buildEditedGoalDraftCriteria(goalDraftCriteriaText, draftToConfirm),
      });
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
        return currentSessions.map((session) =>
          session.id === draftToConfirm.sessionId
            ? { ...session, activeGoal: result.activeGoal }
            : session,
        );
      });
      activeStatusSessionIdRef.current = draftToConfirm.sessionId;
      setStatus({
        kind: result.activeGoal.status === "executing" ? "working" : "ready",
        message: result.activeGoal.status === "executing" ? "目标正在后台执行" : "目标已确认",
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
        message: error instanceof Error ? error.message : "确认目标草案失败。",
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
    const pendingOperation = {
      action: "discard" as const,
      sequence: mutationSequence,
    };
    goalDraftActionPendingRef.current = pendingOperation;
    setGoalDraftActionPending("discard");
    try {
      const result = await window.buildingAgent?.discardGoalDraft(draftToDiscard.id);
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

  async function handleConfirmPlan() {
    if (
      !activePlan ||
      activePlan.status !== "awaiting_confirmation" ||
      activePlan.actionGate !== "ready" ||
      !window.buildingAgent ||
      planActionPending ||
      planConfirmBlockedReason
    ) {
      return;
    }
    const planToConfirm = activePlan;
    setPlanActionPending("confirm");
    setStatus({ kind: "working", message: "正在校验计划版本、投影与工作区…" });
    try {
      const result =
        planToConfirm.purpose === "runtime_replan"
          ? await window.buildingAgent.adoptGoalPlan({
              planId: planToConfirm.id,
              expectedRevision: planToConfirm.revision,
              expectedGoalPlanVersion: planToConfirm.goalPlanVersion ?? 1,
            })
          : await window.buildingAgent.confirmPlan({
              planId: planToConfirm.id,
              expectedRevision: planToConfirm.revision,
            });
      if (!result.ok) {
        if (result.plan) {
          setActivePlan(result.plan);
        }
        setStatus({ kind: "error", message: result.message });
        return;
      }
      setActivePlan(result.plan);
      setActiveGoalPlan(result.plan);
      const confirmedGoal =
        "activeGoal" in result ? result.activeGoal : result.goal;
      setStatus({
        kind: "working",
        message:
          planToConfirm.purpose === "runtime_replan"
            ? "新 Plan 已采用，Goal 恢复执行"
            : "计划已确认，目标开始执行",
      });
      setWorkPhase("tool");
      setTaskActivity(
        createTaskActivity({
          kind: "working",
          title: "正在执行已确认计划",
          detail: confirmedGoal.description,
        }),
      );
      void refreshActiveGoalDetail(confirmedGoal.id);
      void refreshSessions(result.plan.sessionId);
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "确认计划失败。",
      });
    } finally {
      setPlanActionPending(null);
    }
  }

  async function handleDiscardPlan() {
    if (!activePlan || !window.buildingAgent || planActionPending) {
      return;
    }
    const planToDiscard = activePlan;
    setPlanActionPending("discard");
    try {
      const result = await window.buildingAgent.discardPlan(
        planToDiscard.id,
        planToDiscard.revision,
      );
      if (!result.ok) {
        if (result.plan) {
          setActivePlan(result.plan);
        }
        setStatus({ kind: "error", message: result.message });
        return;
      }
      setActivePlan(null);
      if (planToDiscard.purpose === "runtime_replan") {
        const amendmentCandidate =
          planToDiscard.trigger?.kind === "goal_amendment";
        setStatus({
          kind: "paused",
          message: amendmentCandidate
            ? "修订候选 Plan 已丢弃；目标修订仍未应用，请重新生成或撤销"
            : "候选 Plan 已丢弃，当前 Goal 和活动 Plan 保持不变",
        });
        setWorkPhase("paused");
        setTaskActivity(
          createTaskActivity({
            kind: "paused",
            title: amendmentCandidate ? "目标修订等待处理" : "重规划候选已丢弃",
            detail: amendmentCandidate
              ? "重新生成修订 Direct Plan，或在 Goal 详情中撤销修订"
              : "可以补充新的调整意见，或恢复当前 Goal",
          }),
        );
        if (planToDiscard.goalId) {
          void refreshActiveGoalDetail(planToDiscard.goalId);
        }
        void refreshSessions(planToDiscard.sessionId);
      } else {
        setStatus({ kind: "ready", message: "计划已丢弃，未执行任何任务" });
        setTaskActivity(idleTaskActivity);
      }
    } finally {
      setPlanActionPending(null);
    }
  }

  async function handleRetryPlan(replacementProfileId?: string) {
    if (!activePlan || !window.buildingAgent || planActionPending) {
      return;
    }
    setPlanActionPending("retry");
    setStatus({ kind: "working", message: "正在重试失败的规划轮次…" });
    try {
      const result = await window.buildingAgent.retryFailedPlanRound(
        activePlan.id,
        replacementProfileId,
        autoApprovalEnabled ? "auto" : "standard",
      );
      if (!result.ok) {
        if (result.plan) {
          setActivePlan(result.plan);
        }
        setStatus({ kind: "error", message: result.message });
        return;
      }
      setActivePlan(result.plan);
      setStatus({
        kind:
          result.plan.status === "awaiting_confirmation" || result.plan.status === "awaiting_input"
            ? "paused"
            : "error",
        message: result.message,
      });
      void refreshSessions(result.plan.sessionId);
      void refreshCurrentSessionMessages(result.plan.sessionId);
    } finally {
      setPlanActionPending(null);
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
    const submittedContent = content.trim() ? rawContent : "请分析这些附件。";
    const normalizedSubmittedContent = submittedContent.trim();
    const isRuntimeGoalReplanRequest =
      Boolean(activeGoal) &&
      /^(?:修改计划|调整目标计划)(?:\s*[:：]|\s+)/.test(
        normalizedSubmittedContent,
      );
    if (
      /^(?:修改计划|调整目标计划)\s*[:：]?\s*$/.test(
        normalizedSubmittedContent,
      )
    ) {
      setStatus({
        kind: "paused",
        message: "请补充需要改变的依赖、工具路径、执行方法或验收路径。",
      });
      messageInputRef.current?.focus();
      return;
    }
    if (attachmentReadPending) {
      return;
    }
    if (
      submissionInFlightRef.current ||
      activeChatRequestIdRef.current !== null ||
      status.kind === "working" ||
      sessionLoadPendingRef.current !== null
    ) {
      return;
    }
    submissionInFlightRef.current = true;

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
        title: planInputLocked
          ? "正在更新只读计划"
          : isRuntimeGoalReplanRequest
            ? "正在生成运行期 Direct Plan"
            : "正在执行任务",
        detail: planInputLocked
          ? "本条消息只用于补充或修改计划，不会启动普通 Agent"
          : isRuntimeGoalReplanRequest
            ? "基于真实 Goal 反馈重建路径，采用前不会覆盖当前 Goal"
          : "请求已发送，等待后端状态",
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
      if (disclosureMode === "projected") {
        setTaskProcessEvents(buildPreviewDisclosureEvents());
      }
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
      submissionInFlightRef.current = false;
      return;
    }

    const shouldCreateGoalPlan =
      !activeGoal && !planInputLocked && (goalModeEnabled || isLegacyGoalCommand(submittedContent));
    setStatus({
      kind: "working",
      message: planInputLocked
        ? "正在把补充或修改意见纳入只读计划…"
        : isRuntimeGoalReplanRequest
        ? "正在根据反馈生成运行期 Direct Plan…"
        : shouldCreateGoalPlan
        ? goalPlanMode === "debate"
          ? "正在执行 A1 → B1 → A2 → B2 → C 规划辩论…"
          : "正在生成可确认的直接计划…"
        : "正在检索记忆并调用模型...",
    });
    setWorkPhase(isRuntimeGoalReplanRequest ? "planning" : "model");
    const requestId = createClientRequestId();
    const requestGeneration = sessionSelectionGenerationRef.current;
    setActiveChatRequest(requestId);
    submissionInFlightRef.current = false;
    const result = await window.buildingAgent
      .sendChatMessage({
        ...(sessionId ? { sessionId } : {}),
        requestId,
        message: submittedContent,
        ...(outgoingAttachments.length ? { attachments: outgoingAttachments } : {}),
        ...(shouldCreateGoalPlan
          ? {
              mode: "goal_plan" as const,
              planMode: goalPlanMode,
              planModelAssignments,
            }
          : {}),
        ...(shouldCreateGoalPlan || planInputLocked
          ? {
              planAutonomyMode: autoApprovalEnabled
                ? "auto" as const
                : "standard" as const,
            }
          : {}),
        ...(selectedSkillName ? { selectedSkillName } : {}),
        ...(selectedWorkspaceId ? { workspaceId: selectedWorkspaceId } : {}),
      })
      .catch((error): FailedChatResult => ({
        ok: false as const,
        code: "TRANSPORT_ERROR" as const,
        retryable: true,
        message: error instanceof Error ? error.message : "会话请求失败，请稍后重试。",
      }));
    const requestStillOwnsUi = shouldApplyChatRequestSettlement(
      activeChatRequestIdRef.current,
      requestId,
      requestGeneration,
      sessionSelectionGenerationRef.current,
    );
    if (requestStillOwnsUi) {
      setActiveChatRequest(null);
    }
    if (!requestStillOwnsUi) {
      return;
    }

    if (!result.ok) {
      if (result.code === "SKILL_INPUT_REQUIRED") {
        setStatus({
          kind: "paused",
          message: pendingInputRequestRef.current?.reason || "等待技能输入",
        });
        setWorkPhase("paused");
        setTaskActivity(
          createTaskActivity({
            kind: "paused",
            title: "等待技能输入",
            detail: pendingInputRequestRef.current?.reason || "等待技能输入",
          }),
        );
        return;
      }
      let restoredAttachmentSubmission = false;
      if (outgoingAttachments.length > 0 && draftAttachmentsRef.current.length === 0) {
        setMessages((current) =>
          rollbackFailedAttachmentTurn(current, {
            userMessageId: userMessage.id,
            requestId,
          }),
        );
        setComposerDraft(rawContent, rawContent.length);
        setComposerAttachments(outgoingAttachments);
        setAttachmentAnnouncement(`发送失败，已保留 ${outgoingAttachments.length} 个附件供重试`);
        restoredAttachmentSubmission = true;
      }
      activeStatusSessionIdRef.current = null;
      if (result.executedRun) {
        setRuns((currentRuns) => [result.executedRun!, ...currentRuns]);
      }
      const wasCanceled =
        result.code === "CANCELED"
        || result.turnSettlementStatus === "canceled"
        || result.executedRun?.status === "canceled";
      if (wasCanceled && planInputLocked && sessionId) {
        const canceledPlan = await window.buildingAgent
          .getLatestPlanForSession(sessionId)
          .catch(() => null);
        if (
          sessionIdRef.current === sessionId &&
          canceledPlan &&
          canceledPlan.status !== "discarded"
        ) {
          setActivePlan(canceledPlan);
        }
        void refreshSessions(sessionId ?? undefined);
        void refreshCurrentSessionMessages(sessionId);
      }
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
        setChatStreamState((current) =>
          finalizeChatStreamFailure(current, {
            requestId,
            message: result.message,
            createdAt: new Date().toISOString(),
          }),
        );
      }
      return;
    }

    applySuccessfulChatResult(result, requestId);
  }

  async function handleSubmitGuidedSkillInput(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !window.buildingAgent ||
      !pendingInputRequest ||
      guidedInputSubmissionPendingRef.current
    ) {
      return;
    }

    const inputRequest = pendingInputRequest;
    const requestId = inputRequest.requestId;
    const requestGeneration = sessionSelectionGenerationRef.current;
    const submissionToken = `${inputRequest.id}:${requestGeneration}`;
    guidedInputSubmissionPendingRef.current = submissionToken;
    setGuidedInputSubmissionPending(true);
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

    try {
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
          code: "TRANSPORT_ERROR" as const,
          retryable: true,
          message:
            error instanceof Error
              ? error.message
              : "技能输入提交失败，请稍后重试。",
        }));

      const requestStillOwnsUi = shouldApplyChatRequestSettlement(
        activeChatRequestIdRef.current,
        requestId,
        requestGeneration,
        sessionSelectionGenerationRef.current,
      );
      if (requestStillOwnsUi) {
        setActiveChatRequest(null);
      }
      if (!requestStillOwnsUi) {
        return;
      }

      if (!result.ok) {
        if (result.code === "SKILL_INPUT_REQUIRED") {
          setStatus({
            kind: "paused",
            message: pendingInputRequestRef.current?.reason || "等待技能输入",
          });
          setWorkPhase("paused");
          setTaskActivity(
            createTaskActivity({
              kind: "paused",
              title: "等待技能输入",
              detail:
                pendingInputRequestRef.current?.reason ||
                "等待技能输入",
            }),
          );
          return;
        }

        if (
          result.code === "ATTACHMENT_EXPIRED"
          || result.code === "UNKNOWN_SKILL_INPUT"
          || result.code === "CONFLICT"
        ) {
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
        setChatStreamState((current) =>
          finalizeChatStreamFailure(current, {
            requestId,
            message: result.message,
            createdAt: new Date().toISOString(),
          }),
        );
        return;
      }

      setPendingInputRequest(null);
      applySuccessfulChatResult(result, requestId);
    } finally {
      if (guidedInputSubmissionPendingRef.current === submissionToken) {
        guidedInputSubmissionPendingRef.current = null;
        if (requestGeneration === sessionSelectionGenerationRef.current) {
          setGuidedInputSubmissionPending(false);
        }
      }
    }
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
      const result = await window.buildingAgent.cancelGoal(goalId).catch((error) => ({
          ok: false as const,
        message: error instanceof Error ? error.message : "中断目标失败，请稍后重试。",
        }));
      if (!isGoalMutationCurrent(selection, mutationSequence)) {
        return;
      }
      if (!result.ok) {
        setStatus({
          kind: "error",
          message: result.message ?? "中断目标失败。",
        });
        setTaskActivity(
          createTaskActivity({
            kind: "error",
            title: "中断目标失败",
            detail: result.message ?? "请稍后重试。",
          }),
        );
      } else if (result.goal) {
        applyCanonicalGoalState(result.goal);
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

    const requestId = activeChatRequestIdRef.current;
    if (!requestId) {
      setStatus({ kind: "ready", message: "当前没有可中断的请求。" });
      setTaskActivity(idleTaskActivity);
      return;
    }
    const result = await window.buildingAgent
      .cancelChatMessage(requestId)
      .catch((error) => ({
        ok: false as const,
        message: error instanceof Error ? error.message : "中断请求失败，请稍后重试。",
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

    const [settings, loadedTasks, loadedRuns, loadedMemories, skills] = await Promise.all([
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

    const [settings, loadedTasks, loadedRuns, loadedMemories, skills] = await Promise.all([
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
        result.report.ready ? "本地智能体已经完成验收运行。" : "验收运行结束，但还有项目需要处理。",
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
        <div className="chat-scroll-region" onScroll={handleMessageListScroll} ref={messageListRef}>
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
                <small className="chat-state-toggle">{chatStatusExpanded ? "收起" : "展开"}</small>
            </button>
          ) : (
            <span className={chatStateClassName} title={status.message}>
              <span>{status.message}</span>
            </span>
          )}
        </div>

          {firstRunGuide.primaryAction.command === "prepare" && !modelSettings.hasApiKey && (
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
              earlierMessagesPending={earlierMessagesPending}
              goal={activeGoalDetail}
              hiddenMessageCount={hiddenMessageCount}
              messages={renderedChatMessages}
              onLoadEarlier={handleLoadEarlierMessages}
            />
        )}

        {disclosureMode === "projected" ? (
          chatDisclosureGroups.length > 0 ? (
            <ProjectedConversationDisclosure groups={chatDisclosureGroups} />
          ) : null
        ) : (status.kind === "working" || status.kind === "paused") &&
          taskProcessItems.length > 0 ? (
            <ConversationProgressDisclosure
              items={taskProcessItems}
              status={status}
            />
          ) : null}

        {hasRuntimeSurfaces ? (
            <div className="runtime-surface-stack" aria-label="需要你的决定">
              {planModeDecisionOpen ? (
                <PlanModeDecisionCard
                  assignments={planModelAssignments}
                  catalog={modelCatalog}
                  mode={goalPlanMode}
                  onAssignmentsChange={setPlanModelAssignments}
                  onConfirm={() => setPlanModeDecisionOpen(false)}
                  onModeChange={setGoalPlanMode}
                  onOpenModelSettings={() => onNavigate("settings")}
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

              {activePlan && planNeedsDecision ? (
              <PlanConfirmationCard
                catalog={modelCatalog}
                pendingAction={planActionPending}
                confirmBlockedReason={planConfirmBlockedReason}
                lineageLabel={buildPlanLineageLabel(activePlan, activeGoalDetail)}
                plan={activePlan}
                onConfirm={() => {
                  void handleConfirmPlan();
                }}
                onDiscard={() => {
                  void handleDiscardPlan();
                }}
                onRetry={(replacementProfileId) => {
                  void handleRetryPlan(replacementProfileId);
                }}
                  onAnswerQuestions={(clarification) => {
                    void submitUserMessage(clarification);
                  }}
              />
            ) : null}

              {activeGoal && goalNeedsDecision ? (
              <GoalStatusStrip
                goal={activeGoal}
                detail={activeGoalDetail}
                activePlan={activeGoalPlan}
                planCandidate={activePlan}
                recovery={goalIsRecovery}
                onViewDetail={handleViewGoalProgress}
                  {...(activeGoal.status === "planning" || activeGoal.status === "canceled"
                  ? { onStart: handleStartGoal }
                  : {})}
                {...(activeGoal.status === "executing"
                  ? { onPause: () => void handlePauseGoal() }
                  : {})}
                onResolveReview={handleResolveGoalReview}
                onReplan={handleReplanGoal}
                onRetry={handleRetryGoal}
                onContinueAcceptance={() => void handleContinueGoalAcceptance()}
                  goalAcceptanceOperationPending={goalAcceptanceOperationPending !== null}
                onCancel={handleCancelGoal}
              />
            ) : null}

              {shouldShowToolApproval(pendingToolApproval, autoApprovalEnabled) &&
              pendingToolApproval ? (
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
                pending={guidedInputSubmissionPending}
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
              }${goalModeVisuallyEnabled ? " has-plan-mode" : ""}`}
            >
              <div className="composer-context-row" aria-label="会话上下文">
                <div className="workspace-picker" ref={workspaceMenuRef}>
                  <button
                    aria-expanded={workspaceMenuOpen}
                    aria-haspopup="menu"
                    aria-label="选择工作区"
                    className="workspace-picker-trigger"
                    disabled={
                      chatRequestInFlight ||
                      status.kind === "working" ||
                      planInputLocked
                    }
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
                          onChange={(event) => setWorkspaceSearch(event.currentTarget.value)}
                        />
                      </label>
                      <div className="workspace-menu-section">
                        <span>历史工作区</span>
                        <button
                          className="workspace-menu-item"
                          disabled={workspaceActionsDisabled}
                          onClick={handleSelectDefaultWorkspace}
                          role="menuitem"
                          type="button"
                        >
                          <Icon name="folder" className="workspace-menu-item-icon" />
                          <span>
                            <strong>默认工作区</strong>
                            <small>不指定项目目录</small>
                          </span>
                          {!selectedWorkspaceId ? (
                            <Icon name="approval" className="workspace-menu-check" />
                          ) : null}
                        </button>
                        {visibleWorkspaces.map((workspace) => (
                          <button
                            disabled={workspaceActionsDisabled}
                            className="workspace-menu-item"
                            key={workspace.id}
                            onClick={() => selectWorkspace(workspace)}
                            role="menuitem"
                            type="button"
                          >
                            <Icon name="folder" className="workspace-menu-item-icon" />
                            <span>
                              <strong>{workspace.name}</strong>
                              <small>{workspace.rootPath}</small>
                            </span>
                            {selectedWorkspaceId === workspace.id ? (
                              <Icon name="approval" className="workspace-menu-check" />
                            ) : null}
                          </button>
                        ))}
                        {visibleWorkspaces.length === 0 ? (
                          <p className="workspace-menu-empty">没有匹配的历史工作区</p>
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
                          <Icon name="folder" className="workspace-menu-item-icon" />
                          <span>
                            <strong>
                              {workspaceActionPending === "open" ? "打开中" : "打开已有目录"}
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
                          <Icon name="plus" className="workspace-menu-item-icon" />
                          <span>
                            <strong>
                              {workspaceActionPending === "create" ? "选择中" : "新建工作区"}
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
              {selectedSkill && !planInputLocked ? (
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
                <div aria-label="选择技能" className="skill-mention-menu" role="listbox">
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
                  const nextCursor = event.currentTarget.selectionStart ?? nextDraft.length;
                  draftRef.current = nextDraft;
                  draftCursorRef.current = nextCursor;
                  const nextMention = planInputLocked
                    ? null
                    : extractActiveSkillMention(nextDraft, nextCursor);
                  const shouldSyncComposerState =
                    Boolean(nextMention) || Boolean(activeSkillMention);
                  if (shouldSyncComposerState) {
                    setDraft(nextDraft);
                    setDraftCursor(nextCursor);
                  } else if (draft) {
                    setDraft("");
                    setDraftCursor(0);
                  }
                  if (selectedSkillName && !nextDraft.includes(`@${selectedSkillName}`)) {
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
                disabled={planModeDecisionOpen || (planInputLocked && !planAcceptsComposerInput)}
                placeholder={
                  activeGoal?.status === "executing"
                    ? "继续你的任务…"
                    : planInputLocked
                      ? planAcceptsComposerInput
                        ? activePlan?.status === "awaiting_confirmation"
                          ? "输入修改意见会重新规划；点击“确认计划并开始执行”才会进入可写模式"
                          : "补充回答或修改意见；本消息只会更新只读计划，不会执行任务"
                        : "请先使用计划卡片中的重试或丢弃操作"
                      : planModeDecisionOpen
                        ? "请先在上方选择规划方式"
                    : goalModeEnabled
                      ? goalPlanMode === "debate"
                        ? "描述目标，由 A/B 对抗审查并由 C 生成终版计划"
                        : "描述目标，发送后先生成可确认的直接计划"
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
                  <span aria-hidden="true" className="composer-risk-tooltip" role="tooltip">
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
                  disabled={
                    chatRequestInFlight ||
                    status.kind === "working" ||
                    planInputLocked
                  }
                  onClick={() => {
                    void handleSetGoalModeEnabled(!goalModeEnabled);
                  }}
                  title={
                    planInputLocked
                      ? "当前会话仍有未确认计划；确认或丢弃前不能退出只读 Plan Mode。"
                      : composerRiskTooltips.goal
                  }
                  type="button"
                >
                  <span>目标模式</span>
                  <span aria-hidden="true" className="composer-risk-tooltip" role="tooltip">
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
                  disabled={
                    status.kind === "working" ||
                    chatRequestInFlight ||
                    attachmentReadPending ||
                    planModeDecisionOpen ||
                    (planInputLocked && !planAcceptsComposerInput)
                  }
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
            {autoApprovalEnabled ? (
              <div className="composer-mode-risk-summary" role="status">
                <strong>自动授权已开启</strong>
                <span>
                  {!planInputLocked
                    ? "普通文件、Shell、网络、安装、构建和测试操作会自动放行；极高危操作仍需确认。"
                    : "当前计划保持只读；极高危操作仍需单独确认。"}
                </span>
              </div>
            ) : null}
          </div>
        </form>
        <GoalDetailDrawer
          goal={activeGoalDetail}
          loadError={activeGoalDetailError}
          activePlan={activeGoalPlan}
          planCandidate={activePlan}
          open={goalDrawerOpen}
          summary={activeGoal}
          onStart={
            activeGoal && canStartGoalFromChat(activeGoal.status) ? handleStartGoal : undefined
          }
          onClose={() => setGoalDrawerOpen(false)}
          onResolveReview={handleResolveGoalReview}
          onReplan={handleReplanGoal}
          onResolveAmendment={(decision) =>
            void handleResolveGoalAmendment(decision)
          }
          goalAmendmentActionPending={goalAmendmentActionPending}
          onRetry={handleRetryGoal}
          onContinueAcceptance={() => void handleContinueGoalAcceptance()}
          onMarkCompletedUnverified={(confirmation) =>
            void handleMarkGoalCompletedUnverified(confirmation)
          }
          goalAcceptanceContext={goalAcceptanceContext}
          goalAcceptanceOperationPending={goalAcceptanceOperationPending !== null}
          onReload={
            activeGoal?.id
              ? () => void refreshActiveGoalDetail(activeGoal.id)
              : undefined
          }
          onCancel={handleCancelGoal}
        />
      </section>

      {showContextPanel ? (
      <aside className="agent-context-panel" aria-label="进度与上下文">
          {activeGoal ? (
            <GoalRailStatusCard
              goal={activeGoal}
              recovery={goalIsRecovery}
              status={activeGoalInteractionStatus}
              onPause={activeGoal.status === "executing" ? () => void handlePauseGoal() : undefined}
              onView={handleViewGoalProgress}
            />
          ) : null}
          {(goalModeEnabled || planInputLocked) && (!planModeDecisionOpen || planInputLocked) ? (
            <PlanModeStatusCard
              assignments={activePlan?.requestedModelAssignments ?? planModelAssignments}
              catalog={modelCatalog}
              locked={planInputLocked}
              mode={activePlan?.mode ?? goalPlanMode}
              onEdit={planInputLocked ? undefined : () => setPlanModeDecisionOpen(true)}
            />
          ) : null}
          {goalRunEvents.length > 0 ||
          activePlan?.status === "drafting" ? (
            <ContextRuntimeSummary
              activePlan={activePlan}
              goalRunEvents={goalRunEvents}
            />
          ) : null}
        {shouldShowActivityCard ? (
          <ContextActivityCard
            activity={taskActivity}
            detail={taskActivityDetail}
            processItems={taskProcessItems}
            onContinue={
              taskActivity.kind === "paused" &&
              taskActivity.canContinue !== false
                ? () => {
                    void submitUserMessage("继续");
                  }
                : undefined
            }
          />
        ) : null}
        <SessionContextStatusCard
          context={activeContextUsage}
          historical={goalIsRecovery}
          messageCount={activeSession?.messageCount ?? messages.length}
          tokenUsage={activeSession?.tokenUsage}
        />
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
            <strong>{hasActiveSubagents ? "子代理" : "运行环境"}</strong>
          </header>
          {hasActiveSubagents ? (
            <SubagentStatusList items={subagentProcessItems} />
          ) : (
            <div className="kimi-context-list">
              {contextPanelItems.map((item) => (
                  <button key={item.id} type="button" disabled>
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
        className={`home-status-chips ${props.modelReady ? "is-ready" : "needs-model"}`}
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
          <button key={prompt} type="button" onClick={() => props.onPickPrompt(prompt)}>
            {prompt}
          </button>
        ))}
      </div>
    </section>
  );
}

function PlanModeDecisionCard(props: {
  mode: PlanMode;
  assignments: PlanModelAssignments;
  catalog: PublicModelCatalog | null;
  onModeChange: (mode: PlanMode) => void;
  onAssignmentsChange: (assignments: PlanModelAssignments) => void;
  onConfirm: () => void;
  onOpenModelSettings: () => void;
}) {
  const profiles = availableChatProfiles(props.catalog);
  const fallbackProfileId = props.catalog?.defaultChatProfileId ?? profiles[0]?.id ?? "";
  const selectedProfileIds =
    props.mode === "direct"
      ? [props.assignments.direct ?? fallbackProfileId]
      : (["a", "b", "c"] as const).map((role) => props.assignments[role] ?? fallbackProfileId);
  const selectedProfileNames = selectedProfileIds
    .map((profileId) => profiles.find((profile) => profile.id === profileId)?.name)
    .filter((name): name is string => Boolean(name));
  const assignmentSummary =
    new Set(selectedProfileNames).size <= 1
      ? (selectedProfileNames[0] ?? "尚未配置模型")
      : props.mode === "debate"
        ? (["A", "B", "C"] as const)
            .map((role, index) => `${role} ${selectedProfileNames[index] ?? "未配置"}`)
            .join(" · ")
        : selectedProfileNames.join(" · ");
  const fallbackProfileName =
    profiles.find((profile) => profile.id === fallbackProfileId)?.name ??
    "默认模型";

  function updateAssignment(role: "direct" | "a" | "b" | "c", profileId: string) {
    props.onAssignmentsChange({
      ...props.assignments,
      [role]: profileId,
    });
  }

  function useOneModelForDebate() {
    props.onAssignmentsChange({
      ...props.assignments,
      a: fallbackProfileId,
      b: fallbackProfileId,
      c: fallbackProfileId,
    });
  }

  function handleModeKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    const nextMode =
      event.key === "Home"
        ? "direct"
        : event.key === "End"
          ? "debate"
          : ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(
                event.key,
              )
            ? props.mode === "direct"
              ? "debate"
              : "direct"
            : null;
    if (!nextMode) return;
    event.preventDefault();
    props.onModeChange(nextMode);
    event.currentTarget.parentElement
      ?.querySelector<HTMLButtonElement>(`[data-plan-mode="${nextMode}"]`)
      ?.focus();
  }

  return (
    <section
      className="plan-mode-decision-card decision-card"
      aria-labelledby="plan-mode-decision-title"
    >
      <header>
        <div>
          <span>需要你的选择</span>
          <strong id="plan-mode-decision-title">这次目标如何规划？</strong>
          <p>只选择规划协议；确认终版计划前不会修改文件或执行命令。</p>
        </div>
        <small title={assignmentSummary}>{props.mode === "debate" ? "Debate" : "Direct"}</small>
      </header>
      <div className="plan-mode-configuration-body">
        <div className="plan-mode-switch" role="radiogroup" aria-label="规划方式">
          <button
            aria-checked={props.mode === "direct"}
            className={props.mode === "direct" ? "is-active" : ""}
            data-plan-mode="direct"
            onClick={() => props.onModeChange("direct")}
            onKeyDown={handleModeKeyDown}
            role="radio"
            tabIndex={props.mode === "direct" ? 0 : -1}
            type="button"
          >
            <strong>Direct</strong>
            <span>单 Agent 直接规划</span>
          </button>
          <button
            aria-checked={props.mode === "debate"}
            className={props.mode === "debate" ? "is-active" : ""}
            data-plan-mode="debate"
            onClick={() => props.onModeChange("debate")}
            onKeyDown={handleModeKeyDown}
            role="radio"
            tabIndex={props.mode === "debate" ? 0 : -1}
            type="button"
          >
            <strong>Debate</strong>
            <span>A/B 对抗，C 独立综合</span>
          </button>
        </div>
        {profiles.length ? (
          <section className="plan-model-assignment-section" aria-label="规划模型分配">
            <header>
              <div>
                <strong>{props.mode === "debate" ? "分配 Debate 角色" : "选择规划模型"}</strong>
                <span>
                  {props.mode === "debate"
                    ? "每个角色独立运行，可以使用同一模型或不同模型。"
                    : "使用已验证的 Chat 模型生成只读计划。"}
                </span>
              </div>
              {props.mode === "debate" ? (
                <button
                  className="plan-model-unify-action"
                  onClick={useOneModelForDebate}
                  type="button"
                >
                  全部使用 {fallbackProfileName}
                </button>
              ) : null}
            </header>
            <div className={`plan-model-assignment-grid is-${props.mode}`}>
            {props.mode === "direct" ? (
              <PlanModelSelect
                catalog={props.catalog}
                description="负责理解目标并生成可确认的执行计划"
                profileId={props.assignments.direct ?? fallbackProfileId}
                profiles={profiles}
                role="direct"
                title="规划 Agent"
                onChange={(profileId) => updateAssignment("direct", profileId)}
              />
            ) : (
              (["a", "b", "c"] as const).map((role) => (
                <PlanModelSelect
                  catalog={props.catalog}
                  description={
                    role === "a"
                      ? "提出方案，并吸收有效质疑"
                      : role === "b"
                        ? "寻找漏洞、反例和遗漏风险"
                        : "独立综合，形成最终可执行计划"
                  }
                  key={role}
                  profileId={props.assignments[role] ?? fallbackProfileId}
                  profiles={profiles}
                  role={role}
                  title={
                    role === "a" ? "方案提出" : role === "b" ? "对抗审查" : "独立综合"
                  }
                  onChange={(profileId) => updateAssignment(role, profileId)}
                />
              ))
            )}
            </div>
          </section>
        ) : (
          <button className="plan-model-missing" onClick={props.onOpenModelSettings} type="button">
            尚无可用 Chat 模型档案，前往模型设置
          </button>
        )}
        <p>
          {props.mode === "debate"
            ? "固定协议：A1 → B1 → A2 → B2 → C。A/B 各最多两次发言，每个角色使用独立 runId 与消息历史。"
            : "Direct 只生成计划，不执行 Shell、文件修改、测试或记忆写入。"}
        </p>
      </div>
      <div className="decision-card-actions">
        <span title={assignmentSummary}>{assignmentSummary}</span>
        <button
          className="primary-action"
          disabled={!profiles.length}
          onClick={props.onConfirm}
          type="button"
        >
          使用此规划方式
        </button>
      </div>
    </section>
  );
}

function PlanModelSelect(props: {
  role: "direct" | "a" | "b" | "c";
  title: string;
  description: string;
  profileId: string;
  profiles: ModelProfile[];
  catalog: PublicModelCatalog | null;
  onChange: (profileId: string) => void;
}) {
  const profile = props.profiles.find(
    (candidate) => candidate.id === props.profileId,
  );
  const connection = props.catalog?.connections.find(
    (candidate) => candidate.id === profile?.connectionId,
  );
  const descriptor = props.catalog?.descriptors.find(
    (candidate) => candidate.kind === connection?.providerKind,
  );
  const roleLabel = props.role === "direct" ? "D" : props.role.toUpperCase();

  return (
    <label className={`plan-model-role-card is-${props.role}`}>
      <span className="plan-model-role-heading">
        <span aria-hidden="true" className="plan-model-role-badge">
          {roleLabel}
        </span>
        <span>
          <strong>{props.title}</strong>
          <small>{props.description}</small>
        </span>
      </span>
      <span className="plan-model-select-shell">
        <select
          aria-label={`${props.title}模型`}
          onChange={(event) => props.onChange(event.currentTarget.value)}
          value={props.profileId}
        >
          {props.profiles.map((candidate) => {
            const candidateConnection = props.catalog?.connections.find(
              (item) => item.id === candidate.connectionId,
            );
            const candidateDescriptor = props.catalog?.descriptors.find(
              (item) => item.kind === candidateConnection?.providerKind,
            );
            return (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name} · {candidateDescriptor?.title ?? candidateConnection?.providerKind}
              </option>
            );
          })}
        </select>
      </span>
      <small className="plan-model-current-meta">
        {descriptor?.title ?? connection?.providerKind ?? "模型服务"}
        {profile?.modelId ? ` · ${profile.modelId}` : ""}
      </small>
    </label>
  );
}

function buildPlanLineageLabel(
  plan: PlanRecord,
  goal: Goal | null,
): string | undefined {
  if (plan.purpose !== "runtime_replan") return undefined;
  const initialMode = goal?.planHistory?.[0]?.mode ?? plan.parentPlanRef?.mode;
  return initialMode === "debate"
    ? `初始 Debate → 当前 Direct v${plan.goalPlanVersion ?? 1}`
    : undefined;
}

function PlanConfirmationCard(props: {
  plan: PlanRecord;
  catalog: PublicModelCatalog | null;
  pendingAction: "confirm" | "discard" | "retry" | null;
  confirmBlockedReason?: string;
  lineageLabel?: string;
  onConfirm: () => void;
  onDiscard: () => void;
  onRetry: (replacementProfileId?: string) => void;
  onAnswerQuestions: (clarification: string) => void;
}) {
  const failedRound = [...props.plan.rounds]
    .reverse()
    .find((round) => round.status === "failed");
  const failedPlanningStage = [...(props.plan.planningStages ?? [])]
    .reverse()
    .find((stage) => stage.status === "failed");
  const failurePresentation = getPlanFailurePresentation(props.plan);
  const outcomePresentation = getPlanOutcomePresentation(props.plan);
  const chatProfiles = availableChatProfiles(props.catalog);
  const failedProfileId =
    failedRound?.modelBinding.profileId ??
    failedPlanningStage?.modelBinding?.profileId ??
    "";
  const [replacementProfileId, setReplacementProfileId] = useState(failedProfileId);
  const artifact = props.plan.finalArtifact;
  const [planDetailsOpen, setPlanDetailsOpen] = useState(false);
  const questions = [
    ...(props.plan.planningBrief?.unresolvedQuestions ?? []),
    ...(artifact?.unresolvedQuestions ?? []),
  ].filter((question, index, values) => values.indexOf(question) === index);
  const [questionAnswers, setQuestionAnswers] = useState<string[]>([]);
  const canConfirm =
    props.plan.status === "awaiting_confirmation" &&
    props.plan.actionGate === "ready" &&
    !props.confirmBlockedReason &&
    Boolean(artifact && props.plan.projection);
  const canDiscard =
    ![
      "confirmed_pending_execution",
      "executing",
      "steps_completed",
      "completed",
      "superseded",
    ].includes(props.plan.status) &&
    !props.plan.executionGoalId &&
    !props.plan.executionRunId;

  useEffect(() => {
    setReplacementProfileId(failedProfileId);
  }, [failedProfileId, failedPlanningStage?.id, failedRound?.id]);

  useEffect(() => {
    setPlanDetailsOpen(false);
  }, [artifact?.actionGate, props.plan.id, props.plan.revision]);

  useEffect(() => {
    setQuestionAnswers(questions.map(() => ""));
  }, [props.plan.id, props.plan.revision, questions.length]);

  const questionForm = questions.length ? (
    <form
      className="plan-input-required decision-question-form"
      aria-label="确认前需要回答"
      onSubmit={(event) => {
        event.preventDefault();
        props.onAnswerQuestions(
          questions
            .map(
              (question, index) =>
                `${index + 1}. ${question}\n${questionAnswers[index] ?? ""}`,
            )
            .join("\n\n"),
        );
      }}
    >
      <header>
        <span>需要你的回答</span>
        <strong>补齐这些信息后继续规划</strong>
      </header>
      {questions.map((question, index) => (
        <label key={question}>
          <span>{question}</span>
          <textarea
            onChange={(event) => {
              const nextAnswer = event.currentTarget.value;
              setQuestionAnswers((current) =>
                current.map((answer, answerIndex) =>
                  answerIndex === index ? nextAnswer : answer,
                ),
              );
            }}
            required
            rows={2}
            value={questionAnswers[index] ?? ""}
          />
        </label>
      ))}
      <button
        className="primary-action"
        disabled={
          Boolean(props.pendingAction) ||
          questionAnswers.some((answer) => !answer.trim())
        }
        type="submit"
      >
        提交回答并重新规划
      </button>
    </form>
  ) : null;

  return (
    <section
      aria-label="终版计划确认"
      className="plan-confirmation-card"
      data-disclosure-id={`plan:${props.plan.id}`}
      data-source-revision={props.plan.revision}
    >
      <header>
        <div>
          <span>
            Goal r{props.plan.goalContractRef?.revision ?? 1} / Plan v
            {props.plan.goalPlanVersion ?? 1} / {props.plan.mode === "debate" ? "Debate" : "Direct"}
          </span>
          <strong>{artifact?.title ?? props.plan.taskContract.objective}</strong>
          {props.lineageLabel ? <small>{props.lineageLabel}</small> : null}
        </div>
        <div className="plan-gate-status">
          <span className={`is-${props.plan.actionGate}`}>
            {failurePresentation
              ? "规划未完成 · 可重试"
              : formatPlanGate(props.plan.actionGate)}
          </span>
          <small>v{props.plan.revision}</small>
        </div>
      </header>

      <section
        aria-live="polite"
        className={`cross-surface-attention ${
          failurePresentation ? "is-blocking" : "is-normal"
        }`}
        role={failurePresentation ? "alert" : "status"}
      >
        <span>
          {failurePresentation
            ? "规划需要处理"
            : props.plan.status === "awaiting_confirmation"
              ? "等待确认"
              : "规划进展"}
        </span>
        <strong>
          {failurePresentation?.title
            ?? outcomePresentation.title}
        </strong>
      </section>

      {props.plan.goalContractSnapshot ? (
        <details className="plan-technical-details" open>
          <summary>目标契约</summary>
          <div className="plan-technical-details-body">
            <p><b>目标结果：</b>{props.plan.goalContractSnapshot.objective}</p>
            <p>
              <b>交付物：</b>
              {props.plan.goalContractSnapshot.deliverables.join("；") || "无"}
            </p>
            <p>
              <b>范围内：</b>
              {props.plan.goalContractSnapshot.scope.in.join("；") || "无"}
            </p>
            <p>
              <b>范围外：</b>
              {props.plan.goalContractSnapshot.scope.out.join("；") || "无"}
            </p>
            <p><b>约束：</b></p>
            <ul>
              {props.plan.goalContractSnapshot.constraints.length ? (
                props.plan.goalContractSnapshot.constraints.map((constraint) => (
                  <li key={constraint.id}>
                    {constraint.strength === "hard" ? "硬约束" : "偏好"} ·
                    {constraint.description}
                  </li>
                ))
              ) : (
                <li>无显式约束</li>
              )}
            </ul>
            <p><b>成功标准：</b></p>
            <ul>
              {props.plan.goalContractSnapshot.successCriteria.map((criterion) => (
                <li key={criterion.id}>{criterion.description}</li>
              ))}
            </ul>
            <p>
              <b>风险策略：</b>
              {props.plan.goalContractSnapshot.riskPolicy.ordinaryOperations ===
              "auto_decide"
                ? "普通操作自动决策"
                : "普通操作需要确认"}
              ；高风险与不可逆操作必须确认
            </p>
            <p>
              <b>停止策略：</b>
              成功后生成验收证书；外部阻塞时
              {props.plan.goalContractSnapshot.stopPolicy.onExternalBlock ===
              "await_input"
                ? "等待输入"
                : "停止受阻"}
              ；不可实现时
              {props.plan.goalContractSnapshot.stopPolicy.onImpossible ===
              "propose_goal_amendment"
                ? "提出目标修订"
                : "停止为不可实现"}
            </p>
            <small>
              r{props.plan.goalContractSnapshot.revision} · SHA256 {" "}
              {props.plan.goalContractRef?.sha256.slice(0, 12)}
            </small>
          </div>
        </details>
      ) : null}

      <div className="goal-detail-section-header">
        <span>当前 Plan</span>
        <small>{props.plan.purpose === "runtime_replan" ? "运行期重规划" : "初始规划"}</small>
      </div>

      <section
        className={`plan-outcome-summary is-${outcomePresentation.kind}`}
        aria-label="规划结果"
        role="status"
      >
        <span aria-hidden="true" className="plan-outcome-mark">
          {outcomePresentation.kind === "success"
            ? "✓"
            : outcomePresentation.kind === "failure"
              ? "!"
              : "→"}
        </span>
        <div>
          <strong>{outcomePresentation.title}</strong>
          <p>{outcomePresentation.detail}</p>
          <small>
            <b>下一步</b>
            {outcomePresentation.nextAction}
          </small>
        </div>
      </section>

      <PlanTechnicalDetails plan={props.plan} />

      {props.confirmBlockedReason ? (
        <p className="plan-confirm-blocked" role="status">
          {props.confirmBlockedReason}
        </p>
      ) : null}

      {!artifact ? questionForm : null}

      {artifact ? (
        <div className="plan-artifact-summary">
          <p>{artifact.summary || artifact.objective}</p>
          {questionForm}
          <details
            className="plan-artifact-disclosure"
            onToggle={(event) => setPlanDetailsOpen(event.currentTarget.open)}
            open={planDetailsOpen}
          >
            <summary>
              完整计划 · {artifact.milestones.length} 个里程碑
              {artifact.risks.length ? ` · ${artifact.risks.length} 项风险` : ""}
            </summary>
            <div className="plan-artifact-body">
              <section>
                <h4>实施里程碑</h4>
                <ol className="plan-milestone-list">
                  {artifact.milestones.map((milestone) => (
                    <li key={milestone.id}>
                      <strong>{milestone.title}</strong>
                      <span>{milestone.description}</span>
                      {milestone.acceptanceCriteria.length ? (
                        <small>验收：{milestone.acceptanceCriteria.join("；")}</small>
                      ) : null}
                      {milestone.acceptanceChecks?.length ? (
                        <small>
                          类型化检查：
                          {milestone.acceptanceChecks
                            .map(
                              (check) =>
                                `${check.id} · ${check.kind} · ${check.description} · ${formatPlanAcceptanceParams(check.params)}`,
                            )
                            .join("；")}
                        </small>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </section>
              {artifact.acceptanceChecks?.length ? (
                <section>
                  <h4>整体验收检查</h4>
                  <ul className="plan-risk-list">
                    {artifact.acceptanceChecks.map((check) => (
                      <li key={check.id}>
                        <strong>{check.id} · {check.kind}</strong>
                        <span>{check.description}</span>
                        <code>{formatPlanAcceptanceParams(check.params)}</code>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {artifact.risks.length ? (
                <section>
                  <h4>风险与缓解</h4>
                  <ul className="plan-risk-list">
                    {artifact.risks.map((risk) => (
                      <li className={`is-${risk.severity}`} key={risk.id}>
                        <strong>{risk.description}</strong>
                        <span>{risk.mitigation}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          </details>
        </div>
      ) : null}

      {failedRound || failedPlanningStage ? (
        <section className="plan-recovery-panel" aria-label="失败轮次恢复">
          <div>
            <strong>
              {failurePresentation?.title ??
                `${(failedRound?.kind ?? failedPlanningStage?.kind ?? "planning").toUpperCase()} 未完成`}
            </strong>
            <span>{failurePresentation?.nextAction}</span>
          </div>
          <label>
            <span>重试模型</span>
            <select
              onChange={(event) => setReplacementProfileId(event.currentTarget.value)}
              value={replacementProfileId}
            >
              {chatProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="primary-action"
            disabled={Boolean(props.pendingAction)}
            onClick={() => props.onRetry(replacementProfileId || failedProfileId || undefined)}
            type="button"
          >
            {props.pendingAction === "retry"
              ? "重新运行中"
              : failurePresentation?.actionLabel ?? "重新运行失败阶段"}
          </button>
        </section>
      ) : null}

      <div className="plan-confirmation-actions">
        {canDiscard ? (
          <button
            className="secondary-action"
            disabled={Boolean(props.pendingAction)}
            onClick={props.onDiscard}
            type="button"
          >
            {props.pendingAction === "discard" ? "丢弃中" : "丢弃计划"}
          </button>
        ) : null}
        {props.plan.status === "awaiting_confirmation" &&
        props.plan.actionGate === "ready" ? (
          <button
            className="primary-action"
            disabled={Boolean(props.pendingAction) || !canConfirm}
            onClick={props.onConfirm}
            type="button"
          >
            {props.pendingAction === "confirm"
              ? "校验并启动中"
              : props.plan.purpose === "runtime_replan"
                ? "采用 Plan 并恢复 Goal"
                : "确认计划并开始执行"}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function formatPlanAcceptanceParams(
  params: Record<string, unknown>,
): string {
  try {
    const value = JSON.stringify(params);
    return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  } catch {
    return "[验收参数不可序列化]";
  }
}

function PlanTechnicalDetails(props: { plan: PlanRecord }) {
  const activePlanningStages = (props.plan.planningStages ?? []).filter(
    (stage) => stage.status !== "invalidated",
  );
  const activeRounds = props.plan.rounds.filter(
    (round) => round.status !== "invalidated",
  );
  const failure = getPlanFailurePresentation(props.plan);
  const artifact = props.plan.finalArtifact;
  const completedSteps =
    activePlanningStages.filter((stage) => stage.status === "completed").length +
    activeRounds.filter((round) => round.status === "completed").length;
  const totalSteps = activePlanningStages.length + activeRounds.length;

  return (
    <details className="plan-technical-disclosure">
      <summary>
        技术详情（排障时使用）
        {totalSteps ? ` · ${completedSteps}/${totalSteps} 步骤完成` : ""}
      </summary>
      <div className="plan-technical-body">
        {failure ? (
          <section className="plan-technical-error">
            <strong>失败记录</strong>
            <code>{failure.technicalDetail}</code>
          </section>
        ) : null}

        {activePlanningStages.length ? (
          <section>
            <h4>规划阶段</h4>
            <ol className="debate-round-timeline" aria-label="规划内核阶段">
              {activePlanningStages.map((stage) => (
                <li className={`is-${stage.status}`} key={stage.id}>
                  <strong>{stage.kind}</strong>
                  <span>
                    {formatDebateRoundStatus(
                      stage.status === "failed"
                        ? "failed"
                        : stage.status === "running"
                          ? "running"
                          : stage.status === "completed"
                            ? "completed"
                            : "pending",
                    )}
                  </span>
                  <small>
                    {stage.modelBinding?.modelId ?? "代码阶段"}
                    {stage.latencyMs !== undefined ? ` · ${stage.latencyMs} ms` : ""}
                  </small>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {props.plan.mode === "debate" ? (
          <section>
            <h4>Debate 轮次</h4>
            <ol className="debate-round-timeline" aria-label="辩论轮次">
              {(["a1", "b1", "a2", "b2", "c"] as const).map((kind) => {
                const round = [...activeRounds]
                  .reverse()
                  .find((candidate) => candidate.kind === kind);
                return (
                  <li className={`is-${round?.status ?? "pending"}`} key={kind}>
                    <strong>{kind.toUpperCase()}</strong>
                    <span>{formatDebateRoundStatus(round?.status ?? "pending")}</span>
                    <small>
                      {round
                        ? `${round.modelBinding.providerKind} · ${round.modelBinding.modelId}${
                            round.latencyMs !== undefined ? ` · ${round.latencyMs} ms` : ""
                          }`
                        : "等待开始"}
                    </small>
                  </li>
                );
              })}
            </ol>
          </section>
        ) : null}

        <section className="plan-kernel-summary" aria-label="规划合同与 Skill 路由">
          <div>
            <span>任务合同</span>
            <strong>{props.plan.taskContract.objective}</strong>
            <small>
              {(props.plan.taskContract.deliverables ?? []).join("；") || "未声明交付物"}
            </small>
          </div>
          <div>
            <span>Skill 路由</span>
            <strong>
              {props.plan.skillDecision?.selectedSkillName
                ? `@${props.plan.skillDecision.selectedSkillName}`
                : "无 Skill"}
            </strong>
            <small>{props.plan.skillDecision?.reason ?? "未记录 Skill 路由"}</small>
          </div>
          <div>
            <span>调查证据</span>
            <strong>{props.plan.evidence.length} 条</strong>
            <ul className="plan-evidence-list">
              {props.plan.evidence.map((item) => (
                <li key={item.id}>
                  <code>{item.id}</code>
                  <small>{item.title}</small>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {props.plan.qualityReport?.blockingIssues.length ? (
          <section className="plan-quality-issues" aria-label="质量门禁问题">
            <strong>质量门禁问题</strong>
            <ul>
              {props.plan.qualityReport.blockingIssues.map((issue, index) => (
                <li key={`${issue.code}-${issue.checkId ?? issue.milestoneId ?? index}`}>
                  {issue.message}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {props.plan.qualityReport?.warnings.length ? (
          <section className="plan-quality-warnings" aria-label="质量门禁警告">
            <strong>质量门禁警告</strong>
            <ul>
              {props.plan.qualityReport.warnings.map((issue, index) => (
                <li key={`${issue.code}-${issue.checkId ?? issue.milestoneId ?? index}`}>
                  {issue.message}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {artifact?.claimLedger.length || artifact?.minorityOpinion.length ? (
          <section className="plan-audit-grid" aria-label="规划审计记录">
            {artifact.claimLedger.length ? (
              <div>
                <h4>Claim Ledger</h4>
                <ul>
                  {artifact.claimLedger.map((claim) => (
                    <li key={claim.id}>
                      <strong>{claim.claim}</strong>
                      <span>
                        {claim.status} · {Math.round(claim.confidence * 100)}%
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {artifact.minorityOpinion.length ? (
              <div>
                <h4>少数意见</h4>
                <ul>
                  {artifact.minorityOpinion.map((opinion) => (
                    <li key={opinion}>{opinion}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}

        {props.plan.projection ? (
          <p className="plan-projection-ref">
            Markdown 投影：{props.plan.projection.path} ·{" "}
            {props.plan.projection.sha256.slice(0, 12)}
          </p>
        ) : null}
      </div>
    </details>
  );
}

function defaultPlanModelAssignments(catalog: PublicModelCatalog): PlanModelAssignments {
  const profiles = availableChatProfiles(catalog);
  const selected =
    profiles.find((profile) => profile.id === catalog.defaultChatProfileId) ?? profiles[0];
  if (!selected) {
    return {};
  }
  return {
    direct: selected.id,
    a: selected.id,
    b: selected.id,
    c: selected.id,
  };
}

function isPlanInputRoutingLocked(plan: PlanRecord | null): boolean {
  if (!plan || plan.executionGoalId) {
    return false;
  }
  return [
    "drafting",
    "paused",
    "awaiting_input",
    "awaiting_confirmation",
    "canceled",
    "failed",
  ].includes(plan.status);
}

function needsGoalDecision(status: Goal["status"] | undefined): boolean {
  return Boolean(status && !["executing", "achieved", "completed_unverified"].includes(status));
}

function formatPlanGate(gate: PlanRecord["actionGate"]): string {
  if (gate === "ready") {
    return "Ready · 可确认";
  }
  if (gate === "needs_input") {
    return "Needs Input";
  }
  return "Blocked";
}

function formatDebateRoundStatus(status: PlanRecord["rounds"][number]["status"]): string {
  const labels: Record<PlanRecord["rounds"][number]["status"], string> = {
    pending: "等待",
    running: "进行中",
    completed: "完成",
    failed: "失败",
    invalidated: "已失效",
  };
  return labels[status];
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
            <li key={`${warning.code}-${warning.checkId ?? warning.message}`}>{warning.message}</li>
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

function buildEditedGoalDraftCriteria(criteriaText: string, draft: GoalDraft): SuccessCriterion[] {
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
  primaryGoalId: string | null;
  requirementProcessItems: RequirementProcessItem[];
  taskProcessItems: ReturnType<typeof buildTaskProcessItems>;
  workSteps: AgentWorkStep[];
  status: ChatStatus;
}): ContextProgressItem[] {
  if (
    options.activeGoalDetail?.id === options.primaryGoalId &&
    options.activeGoalDetail.milestones.length
  ) {
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
      step.status === "waiting" ? "pending" : step.status === "active" ? "active" : step.status,
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
  activeGoal: ChatSessionGoalSummary | null;
  goalIsRecovery: boolean;
  goalStatus?: ChatSessionGoalSummary["status"];
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
          label: options.goalIsRecovery ? "待恢复目标" : "当前目标",
          detail: `${
            options.goalIsRecovery
              ? "可继续原目标"
              : translateGoalStatus(
                  options.goalStatus ?? options.activeGoal.status,
                )
          } · ${options.activeGoal.description}`,
        },
      ]
    : [];
  return [...goalItem, ...baseItems].slice(0, 8);
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

function GoalRailStatusCard(props: {
  goal: ChatSessionGoalSummary;
  recovery?: boolean;
  status?: ChatSessionGoalSummary["status"];
  onView: () => void;
  onPause?: () => void;
}) {
  return (
    <section className="kimi-side-card goal-rail-status-card">
      <header>
        <strong>{props.recovery ? "待恢复目标" : "目标"}</strong>
        <span>
          {props.recovery
            ? "可继续原目标"
            : translateGoalStatus(props.status ?? props.goal.status)}
        </span>
      </header>
      <p>{props.goal.description}</p>
      <div>
        <button onClick={props.onView} type="button">
          查看详情
        </button>
        {props.onPause ? (
          <button onClick={props.onPause} type="button">
            暂停
          </button>
        ) : null}
      </div>
    </section>
  );
}

function PlanModeStatusCard(props: {
  mode: PlanMode;
  assignments: PlanModelAssignments;
  catalog: PublicModelCatalog | null;
  locked: boolean;
  onEdit?: () => void;
}) {
  const profiles = availableChatProfiles(props.catalog);
  const fallbackProfileId = props.catalog?.defaultChatProfileId ?? profiles[0]?.id ?? "";
  const profileIds =
    props.mode === "direct"
      ? [props.assignments.direct ?? fallbackProfileId]
      : (["a", "b", "c"] as const).map((role) => props.assignments[role] ?? fallbackProfileId);
  const labels = profileIds.map(
    (profileId) => profiles.find((profile) => profile.id === profileId)?.name ?? "未配置",
  );
  return (
    <section className="kimi-side-card plan-mode-status-card">
      <header>
        <strong>Plan 模式</strong>
        {props.onEdit ? (
          <button onClick={props.onEdit} type="button">
            更改
          </button>
        ) : (
          <span className="is-locked">只读锁定</span>
        )}
      </header>
      <div className="plan-mode-status-main">
        <strong>{props.mode === "debate" ? "Debate" : "Direct"}</strong>
        <p>
          {props.mode === "debate" ? `A ${labels[0]} · B ${labels[1]} · C ${labels[2]}` : labels[0]}
        </p>
      </div>
    </section>
  );
}

function ContextRuntimeSummary(props: {
  activePlan: PlanRecord | null;
  goalRunEvents: AgentRunEvent[];
}) {
  const publicGoalEvents = props.goalRunEvents.filter(
    (event) =>
      !/tool (?:called|completed|failed)|calling tool/i.test(event.message),
  );
  const latestGoalEvent = publicGoalEvents.at(-1) ?? null;
  const count =
    Number(props.activePlan?.status === "drafting") + publicGoalEvents.length;
  return (
    <section className="kimi-side-card context-runtime-summary">
      <header>
        <strong>过程</strong>
        <span>{count} 项</span>
      </header>
      <div className="context-runtime-list">
        {props.activePlan?.status === "drafting" ? (
          <div>
            <span className="task-activity-dot" aria-hidden="true" />
            <p>
              <strong>
                {props.activePlan.mode === "debate" ? "Debate 规划中" : "Direct 规划中"}
              </strong>
              <small>完成后仅在需要选择时显示卡片</small>
            </p>
          </div>
        ) : null}
        {latestGoalEvent ? (
          <div>
            <span className="task-activity-dot" aria-hidden="true" />
            <p>
              <strong>{getGoalRunEventLabel(latestGoalEvent)}</strong>
              <small>{latestGoalEvent.message}</small>
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ProjectedConversationDisclosure(props: {
  groups: ChatDisclosureGroup[];
}) {
  const [groupExpansion, setGroupExpansion] = useState<Record<string, boolean>>({});
  const [rowExpansion, setRowExpansion] = useState<Record<string, boolean>>({});

  return (
    <section
      aria-label="会话进展"
      aria-live="polite"
      className="conversation-disclosure"
      data-testid="conversation-disclosure"
    >
      {props.groups.map((group) => {
        const expanded = resolveChatDisclosureExpanded({
          explicit: groupExpansion[group.id],
          defaultExpanded: group.expandedByDefault,
        });
        return (
          <section
            className={`conversation-disclosure-group is-${group.id}`}
            key={group.id}
          >
            <header>
              <button
                aria-controls={`conversation-disclosure-${group.id}`}
                aria-expanded={expanded}
                onClick={() =>
                  setGroupExpansion((current) => ({
                    ...current,
                    [group.id]: !expanded,
                  }))
                }
                type="button"
              >
                <Icon name={expanded ? "collapse" : "expand"} size={15} />
                <strong>{group.label}</strong>
                <span>{group.rows.length}</span>
              </button>
              {!expanded ? <p>{group.rows.at(-1)?.summary}</p> : null}
            </header>
            {expanded ? (
              <ol id={`conversation-disclosure-${group.id}`}>
                {group.rows.map((row) => {
                  const rowExpanded = resolveChatDisclosureExpanded({
                    explicit: rowExpansion[row.id],
                    defaultExpanded: row.expandedByDefault,
                  });
                  const hasDetail = Boolean(row.detail);
                  return (
                    <li
                      aria-label={
                        row.attention === "blocking"
                          ? `需要处理：${row.label}。${row.summary}`
                          : undefined
                      }
                      className={`is-${row.attention}`}
                      data-disclosure-id={row.id}
                      key={row.id}
                      role={row.attention === "blocking" ? "alert" : undefined}
                    >
                      <span aria-hidden="true" className="task-activity-dot" />
                      <div>
                        <strong>{row.label}</strong>
                        <p>{row.summary}</p>
                        {hasDetail && rowExpanded ? <small>{row.detail}</small> : null}
                      </div>
                      {hasDetail ? (
                        <button
                          aria-expanded={rowExpanded}
                          aria-label={`${rowExpanded ? "收起" : "展开"}${row.label}详情`}
                          onClick={() =>
                            setRowExpansion((current) => ({
                              ...current,
                              [row.id]: !rowExpanded,
                            }))
                          }
                          title={rowExpanded ? "收起详情" : "展开详情"}
                          type="button"
                        >
                          <Icon name={rowExpanded ? "collapse" : "expand"} size={14} />
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            ) : null}
          </section>
        );
      })}
    </section>
  );
}

function ConversationProgressDisclosure(props: {
  items: ReturnType<typeof buildTaskProcessItems>;
  status: ChatStatus;
}) {
  const [expanded, setExpanded] = useState(false);
  const visibleItems = expanded ? props.items.slice(0, 8) : props.items.slice(0, 3);
  return (
    <section
      className={`conversation-progress is-${props.status.kind}`}
      aria-label="当前任务关键进展"
      aria-live="polite"
    >
      <header>
        <span className="task-activity-dot" aria-hidden="true" />
        <div>
          <strong>{props.status.kind === "paused" ? "等待你的决定" : "正在推进"}</strong>
          <p>{props.items[0]?.message ?? props.status.message}</p>
        </div>
        {props.items.length > 3 ? (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "收起" : "查看进展"}
          </button>
        ) : null}
      </header>
      <ol>
        {visibleItems.map((item) => (
          <li key={item.id}>
            <time>{item.time}</time>
            <strong>{item.label}</strong>
            <span>{item.message}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function SessionContextStatusCard(props: {
  context: AgentContextUsage | undefined;
  historical: boolean;
  messageCount: number;
  tokenUsage: ChatSessionListItem["tokenUsage"] | undefined;
}) {
  const percent = props.context
    ? Math.min(100, Math.max(0, props.context.occupancyRatio * 100))
    : 0;
  const percentLabel = `${Number(
    (percent > 0 && percent < 10 ? percent.toFixed(1) : percent.toFixed(0)),
  )}%`;
  const breakdown = props.tokenUsage?.breakdown;
  return (
    <section className="kimi-side-card session-context-status-card" aria-label="会话上下文状态">
      <header>
        <strong>会话上下文</strong>
        <span className="is-isolated">独立</span>
      </header>
      <div className="session-context-token-total">
        <span>累计模型用量</span>
        <strong
          title={`${(props.tokenUsage?.totalTokens ?? 0).toLocaleString()} tokens；各次模型调用输入与输出之和`}
        >
          {formatCompactTokenCount(props.tokenUsage?.totalTokens ?? 0)}
        </strong>
        {props.tokenUsage?.estimated ? <small>含估算</small> : null}
      </div>
      <p className="session-context-token-explanation">
        各次模型调用的输入 + 输出累计，可大于单次上下文上限
      </p>
      <div className="session-context-occupancy">
        <div>
          <span>{props.historical ? "最近一次运行上下文" : "当前运行上下文"}</span>
          <strong>{props.context ? percentLabel : "等待运行"}</strong>
        </div>
        <div className="session-context-meter" aria-label={`上下文占用 ${percentLabel}`}>
          <span style={{ width: `${percent}%` }} />
        </div>
        {props.context ? (
          <small>
            约 {formatCompactTokenCount(props.context.estimatedTokens)} / {formatCompactTokenCount(props.context.tokenBudget)} 可用预算
          </small>
        ) : null}
      </div>
      <dl className="session-context-facts">
        <div>
          <dt>模型窗口</dt>
          <dd
            title={
              props.context?.contextWindowSource?.checkedAt
                ? `${props.context.contextWindowSource.label} · ${props.context.contextWindowSource.checkedAt}`
                : undefined
            }
          >
            {props.context?.contextWindow
              ? `${formatCompactTokenCount(props.context.contextWindow)} · ${
                  props.context.contextWindowSource?.label ?? "历史模型绑定"
                }`
              : props.context?.budgetEnforcement === "advisory"
                ? "未公开 · 建议预算"
                : "等待解析"}
          </dd>
        </div>
        <div>
          <dt>范围</dt>
          <dd>当前会话 + 全局记忆</dd>
        </div>
        <div>
          <dt>消息</dt>
          <dd>
            {props.context?.messageCount ?? props.messageCount} 条进入
            {props.historical ? "最近运行上下文" : "运行上下文"}
          </dd>
        </div>
        <div>
          <dt>压缩</dt>
          <dd>
            {props.context?.compactionCount
              ? `${props.context.compactionCount} 次`
              : "尚未压缩"}
          </dd>
        </div>
      </dl>
      {props.context?.lastCompaction ? (
        <p className="session-context-compaction">
          最近压缩 {formatCompactTokenCount(props.context.lastCompaction.beforeTokens)} → {formatCompactTokenCount(props.context.lastCompaction.afterTokens)}
        </p>
      ) : null}
      {breakdown ? (
        <p className="session-context-breakdown">
          累计来源：普通对话 {formatCompactTokenCount(breakdown.chatTokens)} · 规划 {formatCompactTokenCount(breakdown.planTokens)} · 目标执行 {formatCompactTokenCount(breakdown.goalTokens)}
        </p>
      ) : null}
    </section>
  );
}

function formatCompactTokenCount(value: number): string {
  const count = Math.max(0, Math.floor(value));
  if (count >= 1_000_000) {
    return `${Number((count / 1_000_000).toFixed(2))}m`;
  }
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
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
      </header>
      <div className="context-activity-main">
        <span className="task-activity-dot" aria-hidden="true" />
        <div>
          <strong>{activity.title}</strong>
          <p title={detail}>{detail}</p>
        </div>
      </div>
      <div className="context-activity-meta">
        {onContinue && (
          <button type="button" onClick={onContinue}>
            {activity.actionLabel ?? "继续执行"}
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

function SubagentStatusList({ items }: { items: SubagentProcessItem[] }) {
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
        className={`tool-approval-panel${isCritical ? " is-critical-risk" : ""}`}
        data-disclosure-id={`approval:${request.id}`}
        data-source-revision={request.revision ?? 1}
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
          <button className="tool-approval-approve" type="button" onClick={() => onResolve(true)}>
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
  pending,
  values,
  onChange,
  onSubmit,
}: {
  inputRequest: SkillUserInputRequest;
  pending: boolean;
  values: Record<string, string | number | boolean>;
  onChange: (name: string, value: string | number | boolean) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="guided-skill-input-form" aria-label="技能输入" onSubmit={onSubmit}>
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
            {renderGuidedSkillInputControl(
              field,
              values[field.name],
              (value) => onChange(field.name, value),
              pending,
            )}
          </label>
        ))}
      </div>
      <div className="guided-skill-input-actions">
        <button disabled={pending} type="submit">
          {pending ? "继续中" : "继续"}
        </button>
      </div>
    </form>
  );
}

function renderGuidedSkillInputControl(
  field: SkillInputField,
  value: string | number | boolean | undefined,
  onChange: (value: string | number | boolean) => void,
  disabled: boolean,
) {
  if (field.type === "boolean") {
    return (
      <input
        checked={value === true}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
        type="checkbox"
      />
    );
  }

  if (field.type === "choice") {
    return (
      <select
        disabled={disabled}
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
        disabled={disabled}
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
        disabled={disabled}
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
        disabled={disabled}
        required={field.required}
        type="text"
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    );
  }

  return null;
}

function getLatestRuntimeLine(text: string): string {
  const latestLine =
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1) ?? "";
  const compactLine = latestLine || text.trim() || "{}";
  return compactLine.length > 180 ? `${compactLine.slice(0, 177)}...` : compactLine;
}

type TaskProcessItemProps = {
  compact?: boolean;
  item: ReturnType<typeof buildTaskProcessItems>[number];
};

function TaskProcessItem(props: TaskProcessItemProps) {
  const { compact = false, item } = props;
  const [expanded, setExpanded] = useState(false);
  const shouldCollapse = !compact && item.message.length > 160;
  const displayMessage = compact
    ? getLatestRuntimeLine(item.message)
    : expanded || !shouldCollapse
      ? item.message
      : `${item.message.slice(0, 157)}...`;

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
  turnSettlementStatus?: ChatTurnResultSettlementStatus;
  relatedMemoryCount: number;
  fallbackDetail: string;
}): TaskActivityState {
  if (options.agentStatus?.state === "failed") {
    return createTaskActivity({
      kind: "error",
      title: "任务未完成",
      detail: formatAgentFailureForDisplay(options.agentStatus.message),
      toolCallsExecuted:
        options.agentStatus.toolCallsExecuted > 0
          ? options.agentStatus.toolCallsExecuted
          : undefined,
    });
  }

  if (options.agentStatus?.state === "paused") {
    const isFailureLoop = options.agentStatus.reason === "tool_failure_loop";
    const isStrategyGuard = options.agentStatus.reason === "strategy_guard";
    const isProviderOutput =
      options.agentStatus.reason === "provider_output_limit";
    const isProviderLimit =
      isProviderOutput ||
      options.agentStatus.reason === "provider_rate_limit" ||
      options.agentStatus.reason === "provider_quota" ||
      options.agentStatus.reason === "provider_stop";
    return createTaskActivity({
      kind: "paused",
      title: isFailureLoop
        ? "连续工具失败，等待确认"
        : isStrategyGuard
          ? "策略守护触发，等待确认"
          : isProviderOutput
            ? "模型输出未完成"
            : isProviderLimit
              ? "模型服务暂不可用"
              : "长任务等待确认",
      detail: isFailureLoop
        ? `已执行 ${options.agentStatus.toolCallsExecuted} 个工具，检测到同类失败循环`
        : isStrategyGuard
          ? `已执行 ${options.agentStatus.toolCallsExecuted} 个工具，检测到碎片化工具调用`
          : isProviderLimit
            ? options.agentStatus.modelServiceNotice?.message ??
              options.agentStatus.message
            : `已执行 ${options.agentStatus.toolCallsExecuted} 个工具，停在第 ${options.agentStatus.maxTurns} 轮检查点`,
      toolCallsExecuted: options.agentStatus.toolCallsExecuted,
      maxTurns: options.agentStatus.maxTurns,
      ...(isProviderLimit
        ? { actionLabel: isProviderOutput ? "继续生成" : "重试" }
        : {}),
    });
  }

  if (options.turnSettlementStatus === "failed") {
    return createTaskActivity({
      kind: "error",
      title: "本轮执行失败",
      detail: options.fallbackDetail,
    });
  }

  if (options.turnSettlementStatus === "canceled") {
    return createTaskActivity({
      kind: "done",
      title: "本轮已取消",
      detail: options.fallbackDetail,
    });
  }

  if (
    options.turnSettlementStatus === "paused"
    || options.turnSettlementStatus === "unknown"
  ) {
    return createTaskActivity({
      kind: "paused",
      title:
        options.turnSettlementStatus === "unknown"
          ? "历史结算待对账"
          : "本轮已暂停",
      detail: options.fallbackDetail,
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

function formatAgentFailureForDisplay(message?: string): string {
  if (message?.startsWith("Token budget exceeded:")) {
    return "这是旧版 Token 预算停止记录；当前结果不是完成态，且保持只读。";
  }
  if (message?.startsWith("Wall-clock budget exceeded")) {
    return "这是旧版运行时间预算停止记录；当前结果不是完成态，且保持只读。";
  }
  return message?.trim() || "Agent 执行失败，当前任务未完成。";
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
    globalThis.crypto?.randomUUID?.() ?? `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`
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
  if (activeStream.activeSessionId && event.sessionId !== activeStream.activeSessionId) {
    return false;
  }
  return true;
}

function createGuidedInputInitialValues(
  fields: SkillInputField[],
): Record<string, string | number | boolean> {
  return fields.reduce<Record<string, string | number | boolean>>((values, field) => {
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
  }, {});
}

function buildSkillInputResponseValues(
  fields: SkillInputField[],
  values: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  return fields.reduce<Record<string, string | number | boolean>>((resolvedValues, field) => {
      const value = values[field.name];
      if (field.type === "boolean") {
        resolvedValues[field.name] = value === true;
        return resolvedValues;
      }

      if (field.type === "number") {
        if (value === "" || value === undefined) {
          return resolvedValues;
        }
      const numberValue = typeof value === "number" ? value : Number.parseFloat(String(value));
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
  }, {});
}

const ChatMessageNowContext = createContext(new Date());

const ChatMessageList = memo(function ChatMessageList({
  earlierMessagesPending,
  goal,
  hiddenMessageCount,
  messages,
  onLoadEarlier,
}: {
  earlierMessagesPending: boolean;
  goal: Goal | null;
  hiddenMessageCount: number;
  messages: VisibleChatMessage[];
  onLoadEarlier: () => void;
}) {
  const [now, setNow] = useState(() => new Date());
  const terminalTruth = useMemo(
    () => getGoalTerminalTruthNotice(goal),
    [goal],
  );
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(new Date());
    }, 30_000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  return (
    <ChatMessageNowContext.Provider value={now}>
      <div className="message-list" aria-label="消息列表">
        {hiddenMessageCount > 0 ? (
          <button
            aria-label={`加载更早消息，尚有 ${hiddenMessageCount} 条`}
            className="chat-message-collapse-button"
            disabled={earlierMessagesPending}
            onClick={onLoadEarlier}
            type="button"
          >
            {earlierMessagesPending
              ? "正在加载更早消息"
              : `加载更早消息（${hiddenMessageCount}）`}
          </button>
        ) : null}
        {messages.map((message) => (
          <ChatMessageItem
            activeGoalId={goal?.id ?? null}
            key={message.id}
            message={message}
            terminalTruth={terminalTruth}
          />
        ))}
      </div>
    </ChatMessageNowContext.Provider>
  );
});

const ChatMessageItem = memo(function ChatMessageItem({
  activeGoalId,
  message,
  terminalTruth,
}: {
  activeGoalId: string | null;
  message: VisibleChatMessage;
  terminalTruth: ReturnType<typeof getGoalTerminalTruthNotice>;
}) {
  return (
    <article
      className={`chat-message is-${message.role}${message.isStreaming ? " is-streaming" : ""}`}
      data-message-id={message.id}
    >
      <header className="chat-message-meta">
        <span>{message.role === "assistant" ? "智能体" : "你"}</span>
        <ChatMessageTimestamp createdAt={message.createdAt} role={message.role} />
      </header>
      {message.role === "assistant" ? (
        <>
          {terminalTruth &&
          message.goalId === activeGoalId &&
          message.goalEventRef?.startsWith("goal-terminal:") ? (
            <section className="goal-terminal-truth-notice" role="status">
              <strong>{terminalTruth.title}</strong>
              <p>{terminalTruth.detail}</p>
            </section>
          ) : null}
          <AnswerBlock parts={message.outputParts} />
        </>
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
  );
});

const ChatMessageTimestamp = memo(function ChatMessageTimestamp({
  createdAt,
  role,
}: {
  createdAt: string;
  role: VisibleChatMessage["role"];
}) {
  const now = useContext(ChatMessageNowContext);

  return (
    <time dateTime={createdAt}>
      {formatChatMessageTime({ role, createdAt, now })}
    </time>
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
          <strong aria-hidden="true">{formatChatAttachmentTypeLabel(attachment)}</strong>
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

const MarkdownMessage = memo(function MarkdownMessage({ content }: { content: string }) {
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
    const HeadingTag = `h${Math.min(block.depth + 2, 5)}` as "h3" | "h4" | "h5";
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

function renderMarkdownBlockContent(block: MarkdownBlock, showFullBlock: boolean): ReactNode {
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
    return block.items.length > 4 || block.items.map((item) => item.text).join("\n").length > 520;
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
        <a href={segment.href} key={`${segment.type}-${index}`} rel="noreferrer" target="_blank">
          {segment.text}
        </a>
      );
    }
    return <span key={`${segment.type}-${index}`}>{segment.text}</span>;
  });
}

function toChatAttachmentMetadata(attachment: ChatAttachmentInput): ChatAttachmentMetadata {
  return {
    id: attachment.id,
    name: attachment.name,
    mediaType: attachment.mediaType,
    size: attachment.size,
    kind: attachment.kind,
  };
}

function resolvePreviewConversationDisclosureMode(
  search: string,
): "legacy" | "projected" {
  return /(?:^|[?&])chatDisclosure=projected(?:&|$)/.test(search)
    ? "projected"
    : "legacy";
}

function buildPreviewDisclosureEvents(): ChatTaskStatusEvent[] {
  const requestId = "preview-disclosure-request";
  const turnId = "preview-disclosure-turn";
  const createdAt = "2026-08-25T00:00:00.000Z";
  return [
    {
      sessionId: "preview-session",
      requestId,
      turnId,
      sequence: 1,
      state: "started",
      message: "已开始处理请求",
      createdAt,
      elapsedMs: 0,
    },
    {
      sessionId: "preview-session",
      requestId,
      turnId,
      sequence: 2,
      state: "workspace",
      message: "已读取当前工作区",
      createdAt,
      elapsedMs: 12,
    },
    {
      sessionId: "preview-session",
      requestId,
      turnId,
      sequence: 3,
      state: "tool_result",
      toolInvocationId: "preview-tool-1",
      toolName: "file_read",
      message: "已检查项目结构",
      createdAt,
      elapsedMs: 24,
    },
    {
      sessionId: "preview-session",
      requestId,
      turnId,
      sequence: 4,
      state: "tool_result",
      toolInvocationId: "preview-tool-2",
      toolName: "search",
      message: "已定位相关实现",
      createdAt,
      elapsedMs: 36,
    },
    {
      sessionId: "preview-session",
      requestId,
      turnId,
      sequence: 5,
      state: "model",
      message: "已整理可交付结果",
      createdAt,
      elapsedMs: 40,
    },
    {
      sessionId: "preview-session",
      requestId,
      turnId,
      sequence: 6,
      state: "context",
      message: "当前上下文保持在预算内",
      createdAt,
      elapsedMs: 42,
    },
    {
      sessionId: "preview-session",
      requestId,
      turnId,
      sequence: 7,
      settlementId: "preview-settlement",
      state: "completed",
      message: "请求已完成",
      createdAt,
      elapsedMs: 55,
    },
  ];
}

function toSessionRailItem(session: ChatSessionListItem): ChatSession {
  return {
    id: session.id,
    title: session.title,
    summary: session.summary || `${session.messageCount} 条消息`,
    messageCount: session.messageCount,
    ...(session.activeGoal ? { activeGoal: session.activeGoal } : {}),
    ...(session.recoveryGoal ? { recoveryGoal: session.recoveryGoal } : {}),
    work: session.work,
    ...(session.archivedAt ? { archivedAt: session.archivedAt } : {}),
    ...(session.lastAssistantMessageAt
      ? { lastAssistantMessageAt: session.lastAssistantMessageAt }
      : {}),
    ...(session.tokenUsage ? { tokenUsage: session.tokenUsage } : {}),
    ...(session.context ? { context: session.context } : {}),
    ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}),
    ...(session.workspaceSummary ? { workspaceSummary: session.workspaceSummary } : {}),
    updatedAt: session.updatedAt,
  };
}

function areChatSessionListsEqual(
  left: ChatSession[],
  right: ChatSession[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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
    ...(message.goalId ? { goalId: message.goalId } : {}),
    ...(message.goalEventRef ? { goalEventRef: message.goalEventRef } : {}),
  };
}

function shouldHideGoalEventReply(goalEventRef: string): boolean {
  return (
    !goalEventRef.startsWith("goal-terminal:") &&
    goalEventRef !== "goal_canceled"
  );
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
    waiting_for_model: "等待模型服务",
    achieved: "已达成",
    completed_unverified: "手动完成 · 未经机器认证",
    stopped_budget: "旧版停止（只读）",
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
