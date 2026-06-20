import {
  useEffect,
  useMemo,
  useRef,
  useState,
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
import type {
  ChatAgentStatus,
  ChatHistoryMessage,
  ChatSessionGoalSummary,
  ChatSessionListItem,
  ChatSessionRecord,
  ChatTaskStatusEvent,
} from "../../shared/chat";
import type { Goal } from "../../shared/agentGoal";
import type { MemoryRecord } from "../../shared/memory";
import type { PublicModelSettings } from "../../shared/modelSettings";
import type { NavigationSectionId } from "../../shared/navigation";
import type { ScheduledTask } from "../../shared/scheduledTasks";
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
  buildTaskProcessItems,
  buildTaskActivityDetail,
  buildGoalTaskActivity,
  createTaskActivity,
  getGoalUiSyncState,
  idleTaskActivity,
  type TaskActivityState,
} from "../chatTaskActivity";
import { GoalDetailDrawer } from "./GoalDetailDrawer";
import { GoalStatusStrip } from "./GoalStatusStrip";
import type {
  ToolApprovalDecisionPayload,
  ToolApprovalRequestPayload,
} from "../../shared/toolApproval";

type AgentChatPanelProps = {
  newChatRequestKey?: number;
  requestedSessionId?: string | null;
  onActiveSessionChange?: (sessionId: string | null) => void;
  onChatSessionsChange?: (sessions: ChatSidebarSession[]) => void;
  onNavigate: (sectionId: NavigationSectionId) => void;
};

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
  createdAt: string;
};

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
  "updatedAt" | "archivedAt" | "lastAssistantMessageAt" | "tokenUsage"
>;

export type ChatSidebarSession = ChatSession;

type ComposerCommandId = "goal" | "tool" | "permission";

type ComposerCommandItem = {
  id: ComposerCommandId;
  shortcut: string;
  label: string;
  description: string;
  comingSoon?: boolean;
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
const composerCommandItems: ComposerCommandItem[] = [
  {
    id: "goal",
    shortcut: "/目标",
    label: "目标",
    description: "把输入设为这轮会话的目标",
  },
  {
    id: "tool",
    shortcut: "/工具",
    label: "工具",
    description: "预留给后续工具指令",
    comingSoon: true,
  },
  {
    id: "permission",
    shortcut: "/权限",
    label: "权限",
    description: "预留给运行授权入口",
    comingSoon: true,
  },
];

const initialMessages: ChatMessage[] = [];

export function AgentChatPanel({
  newChatRequestKey = 0,
  requestedSessionId = null,
  onActiveSessionChange,
  onChatSessionsChange,
  onNavigate,
}: AgentChatPanelProps) {
  const dataBoundary = buildAgentDataBoundary(
    window.buildingAgent ? "desktop" : "preview",
  );
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>(fallbackSessions);
  const [tasks, setTasks] = useState<ScheduledTask[]>(demoTasks);
  const [runs, setRuns] = useState<AgentRunRecord[]>(demoRuns);
  const [memories, setMemories] = useState<MemoryRecord[]>(demoMemories);
  const [modelSettings, setModelSettings] =
    useState<PublicModelSettings>(demoModelSettings);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [skillCount, setSkillCount] = useState(1);
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
  const [pendingToolApproval, setPendingToolApproval] =
    useState<ToolApprovalRequestPayload | null>(null);
  const [toolApprovalEvents, setToolApprovalEvents] = useState<
    ToolApprovalDecisionPayload[]
  >([]);
  const [activeGoalDetail, setActiveGoalDetail] = useState<Goal | null>(null);
  const [goalDrawerOpen, setGoalDrawerOpen] = useState(false);
  const [activeChatRequestId, setActiveChatRequestId] = useState<string | null>(
    null,
  );
  const [chatStatusExpanded, setChatStatusExpanded] = useState(false);
  const [activityTick, setActivityTick] = useState(Date.now());
  const messageListRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const sessionIdRef = useRef<string | null>(sessionId);
  const activeStatusSessionIdRef = useRef<string | null>(null);
  const activeChatRequestIdRef = useRef<string | null>(null);
  const activeGoalRef = useRef<ChatSessionGoalSummary | null>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    if (messageListRef.current) {
      messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
    onActiveSessionChange?.(sessionId);
  }, [onActiveSessionChange, sessionId]);

  useEffect(() => {
    setChatStatusExpanded(false);
  }, [status.message]);

  useEffect(() => {
    setSessionId(null);
    setMessages(initialMessages);
    setStatus({ kind: "ready", message: "会话已就绪" });
    setWorkPhase("idle");
    setTaskActivity(idleTaskActivity);
    setTaskProcessEvents([]);
    setGoalRunEvents([]);
    setActiveGoalDetail(null);
    setGoalDrawerOpen(false);
  }, [newChatRequestKey]);

  useEffect(() => {
    if (!requestedSessionId || requestedSessionId === sessionId) {
      return;
    }

    if (window.buildingAgent) {
      void loadPersistedSession(requestedSessionId);
      return;
    }

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
      .then((state) => setAutoApprovalEnabled(state.autoApprovalEnabled))
      .catch(() => undefined);
    const unsubscribeRequest = window.buildingAgent.onToolApprovalRequest(
      (request) => {
        setPendingToolApproval(request);
      },
    );
    const unsubscribeDecision = window.buildingAgent.onToolApprovalDecision(
      (decision) => {
        setPendingToolApproval((current) =>
          current?.id === decision.id ? null : current,
        );
        setToolApprovalEvents((current) => [...current.slice(-9), decision]);
      },
    );
    const unsubscribeMode = window.buildingAgent.onToolApprovalModeChanged(
      (state) => {
        setAutoApprovalEnabled(state.autoApprovalEnabled);
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
      setGoalRunEvents((current) => [...current, event]);
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
      setTaskProcessEvents((current) => [...current, event]);
      setTaskActivity(buildTaskActivityFromStatusEvent(event));
      setStatus({
        kind: getChatStatusKindFromEvent(event),
        message: event.message,
      });
      setWorkPhase(getWorkPhaseFromStatusEvent(event));
      if (
        event.state === "paused" ||
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
          loadedSessions,
          validation,
        ]) => {
        setModelSettings(settings);
        setTasks(loadedTasks);
        setRuns(loadedRuns);
        setMemories(loadedMemories);
        setSkillCount(skills.skills.length);
        if (validation.ok && validation.snapshot) {
          setLastValidationSnapshot(validation.snapshot);
        }
        if (loadedSessions.length) {
          const nextSessions = loadedSessions.map(toSessionRailItem);
          setSessions(nextSessions);
          onChatSessionsChange?.(nextSessions);
        }
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

    const loadedSession = await window.buildingAgent.getChatSession(sessionIdToLoad);
    if (!loadedSession) {
      return;
    }

    setSessionId(loadedSession.id);
    setMessages(loadedSession.messages.map(toChatMessage));
    setWorkPhase("idle");
    setTaskActivity(idleTaskActivity);
    setTaskProcessEvents([]);
    setGoalRunEvents([]);
    if (loadedSession.activeGoalId) {
      setActiveGoalDetail(await window.buildingAgent.getGoal(loadedSession.activeGoalId));
    } else {
      setActiveGoalDetail(null);
      setGoalDrawerOpen(false);
    }
    void refreshSessions(sessionIdToLoad);
  }

  async function refreshSessions(nextActiveSessionId?: string) {
    if (!window.buildingAgent) {
      return;
    }

    const loadedSessions = await window.buildingAgent.listChatSessions();
    if (loadedSessions.length) {
      const nextSessions = loadedSessions.map(toSessionRailItem);
      setSessions(nextSessions);
      onChatSessionsChange?.(nextSessions);
    }
    if (nextActiveSessionId) {
      setSessionId(nextActiveSessionId);
    }
  }

  async function refreshActiveGoalDetail(goalId: string) {
    if (!window.buildingAgent) {
      return;
    }
    setActiveGoalDetail(await window.buildingAgent.getGoal(goalId));
  }

  async function refreshCurrentSessionMessages(sessionIdToRefresh?: string) {
    if (!window.buildingAgent) {
      return;
    }

    const currentSessionId = sessionIdToRefresh ?? sessionIdRef.current;
    if (!currentSessionId) {
      return;
    }

    const loadedSession = await window.buildingAgent
      .getChatSession(currentSessionId)
      .catch(() => null);
    if (!loadedSession) {
      return;
    }

    setSessionId(loadedSession.id);
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
  const chatTitle = activeSession?.title ?? "新会话";
  const chatStatusIsLong = status.message.length > 64;
  const chatStateClassName = [
    "chat-state",
    `is-${status.kind}`,
    chatStatusIsLong ? "is-expandable" : "",
    chatStatusExpanded ? "is-expanded" : "",
  ].filter(Boolean).join(" ");
  const activeGoal = activeSession?.activeGoal ?? null;
  activeGoalRef.current = activeGoal;
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
  const canCancelChatTask =
    Boolean(window.buildingAgent) &&
    (status.kind === "working" ||
      taskActivity.kind === "working" ||
      activeChatRequestId !== null);
  const canInterruptCurrentWork =
    canCancelChatTask || Boolean(activeGoal?.status === "executing");
  const composerCommandMenuVisible =
    commandMenuOpen || shouldShowComposerCommandMenu(draft);

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
    taskProcessItems,
    workSteps,
    status,
  });
  const contextPanelItems = buildContextPanelItems({
    contextCards,
    memories,
    activeGoal,
  });
  const shouldShowActivityCard =
    taskActivity.kind !== "idle" &&
    (taskActivity.kind !== "done" || Boolean(activeGoal));
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
      createdAt: "刚刚",
    };
  }

  function appendMessage(message: Omit<ChatMessage, "id" | "createdAt">) {
    setMessages((current) => [...current, createMessage(message, current.length)]);
  }

  function setActiveChatRequest(requestId: string | null) {
    activeChatRequestIdRef.current = requestId;
    setActiveChatRequestId(requestId);
  }

  function handleOpenCommandMenu() {
    setCommandMenuOpen(true);
    window.requestAnimationFrame(() => {
      messageInputRef.current?.focus();
    });
  }

  function handleSelectComposerCommand(commandId: ComposerCommandId) {
    if (commandId !== "goal") {
      return;
    }

    setDraft(createGoalCommandDraft(draft));
    setCommandMenuOpen(false);
    window.requestAnimationFrame(() => {
      messageInputRef.current?.focus();
    });
  }

  function handlePickPrompt(prompt: string) {
    setDraft(prompt);
    window.requestAnimationFrame(() => {
      messageInputRef.current?.focus();
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
    if (decision === "approve") {
      const result = await window.buildingAgent.resolveGoalReview(goalId, {
        kind: "approve_continue",
      });
      if (result.ok && result.goal) {
        void refreshActiveGoalDetail(goalId);
      }
      appendMessage({
        role: "assistant",
        content: result.ok ? "已审核通过，继续执行目标。" : `审核处理失败：${result.message}`,
      });
      return;
    }

    if (decision === "terminate") {
      const result = await window.buildingAgent.cancelGoal(goalId);
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

    setDraft("修改计划：");
  }

  async function handleReplanGoal() {
    if (!window.buildingAgent || !activeGoal?.id) {
      return;
    }

    const result = await window.buildingAgent.replanGoal(
      activeGoal.id,
      "用户从恢复界面请求重新规划。",
    );
    appendMessage({
      role: "assistant",
      content: result.ok
        ? "已重新规划目标，请查看新的里程碑。"
        : `重新规划失败：${result.message}`,
    });
    if (result.ok && result.goal) {
      void refreshActiveGoalDetail(result.goal.id);
    }
  }

  async function handleRetryGoal() {
    if (!window.buildingAgent || !activeGoal?.id) {
      return;
    }

    const result = await window.buildingAgent.retryGoal(activeGoal.id);
    if (result.ok && result.goal) {
      applyGoalSummaryToSessions(result.goal);
      setStatus({ kind: "working", message: "目标已恢复执行" });
      setWorkPhase("tool");
    }
    appendMessage({
      role: "assistant",
      content: result.ok
        ? "已重试目标，继续执行。"
        : `重试目标失败：${result.message}`,
    });
    if (result.ok && result.goal) {
      void refreshActiveGoalDetail(result.goal.id);
    }
  }

  async function handleCancelGoal() {
    if (!window.buildingAgent || !activeGoal?.id) {
      return;
    }

    const result = await window.buildingAgent.cancelGoal(activeGoal.id);
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
    }
  }

  async function handleSetAutoApprovalEnabled(enabled: boolean) {
    setAutoApprovalEnabled(enabled);
    const state = await window.buildingAgent
      ?.setToolAutoApprovalEnabled(enabled)
      .catch(() => ({ autoApprovalEnabled: !enabled }));
    if (state) {
      setAutoApprovalEnabled(state.autoApprovalEnabled);
    }
  }

  async function handleResolveToolApproval(approved: boolean) {
    if (!window.buildingAgent || !pendingToolApproval) {
      return;
    }

    const id = pendingToolApproval.id;
    setPendingToolApproval(null);
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

  async function submitUserMessage(rawContent: string) {
    const content = rawContent.trim();
    if (!content) {
      return;
    }
    if (status.kind === "working") {
      return;
    }

    const history = toChatHistory(messages);
    const userMessage = createMessage(
      { role: "user", content },
      messages.length,
    );

    setMessages((current) => [...current, userMessage]);
    setDraft("");
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
          input: content,
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

    setStatus({ kind: "working", message: "正在检索记忆并调用模型..." });
    setWorkPhase("model");
    const requestId = createClientRequestId();
    setActiveChatRequest(requestId);
    const result = await window.buildingAgent
      .sendChatMessage({
        ...(sessionId ? { sessionId } : {}),
        requestId,
        message: content,
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

    if (!result.ok) {
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
      if (!wasCanceled) {
        appendMessage({
          role: "assistant",
          content: result.message,
        });
      }
      return;
    }

    setSessionId(result.sessionId);
    if (result.executedRun) {
      setRuns((currentRuns) => [result.executedRun!, ...currentRuns]);
    }
    if (result.createdTask) {
      setTasks((currentTasks) => [result.createdTask!, ...currentTasks]);
    }
    if (result.activeGoal) {
      void refreshActiveGoalDetail(result.activeGoal.id);
    }
    const isPaused = result.agentStatus?.state === "paused";
    const isGoalExecuting = result.activeGoal?.status === "executing";
    setStatus({
      kind: isGoalExecuting ? "working" : isPaused ? "paused" : "ready",
      message: isGoalExecuting
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
      isGoalExecuting && result.activeGoal
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
      isPaused || isGoalExecuting ? result.sessionId : null;
    appendMessage({
      role: "assistant",
      content: result.reply,
    });
    void refreshSessions(result.sessionId);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (composerCommandMenuVisible) {
      handleSelectComposerCommand("goal");
      return;
    }
    await submitUserMessage(draft);
  }

  async function handleInterruptCurrentWork() {
    if (!window.buildingAgent || !canInterruptCurrentWork) {
      return;
    }

    if (activeGoal?.status === "executing") {
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
        .cancelGoal(activeGoal.id)
        .catch((error) => ({
          ok: false as const,
          message:
            error instanceof Error ? error.message : "中断目标失败，请稍后重试。",
        }));
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
          <div className="message-list" aria-label="消息列表" ref={messageListRef}>
            {messages.map((message) => (
              <article
                className={`chat-message is-${message.role}`}
                key={message.id}
              >
                <span>{message.role === "assistant" ? "智能体" : "你"}</span>
                <MarkdownMessage content={message.content} />
                <small>{message.createdAt}</small>
              </article>
            ))}
          </div>
        )}

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
              ? { onPause: () => void submitUserMessage("暂停这个目标") }
              : {})}
            onResolveReview={handleResolveGoalReview}
            onReplan={handleReplanGoal}
            onRetry={handleRetryGoal}
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

        {pendingToolApproval && !autoApprovalEnabled ? (
          <ToolApprovalPanel
            request={pendingToolApproval}
            onResolve={(approved) => {
              void handleResolveToolApproval(approved);
            }}
          />
        ) : null}

        <form className="composer" onSubmit={handleSubmit}>
          <div className="composer-inner">
            <div className="composer-input-shell">
              {composerCommandMenuVisible ? (
                <div
                  aria-label="命令菜单"
                  className="slash-command-menu"
                  role="listbox"
                >
                  {composerCommandItems.map((command) => (
                    <button
                      aria-disabled={command.comingSoon ? "true" : undefined}
                      className={`slash-command-item${
                        command.comingSoon ? " is-coming-soon" : ""
                      }`}
                      disabled={command.comingSoon}
                      key={command.id}
                      onClick={() => handleSelectComposerCommand(command.id)}
                      onMouseDown={(event) => event.preventDefault()}
                      role="option"
                      type="button"
                    >
                      <span>{command.shortcut}</span>
                      <div>
                        <strong>{command.label}</strong>
                        <small>{command.description}</small>
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}
              <textarea
                data-testid="agent-message-input"
                id="agent-message"
                ref={messageInputRef}
                value={draft}
                onChange={(event) => {
                  setDraft(event.currentTarget.value);
                  setCommandMenuOpen(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    if (composerCommandMenuVisible) {
                      handleSelectComposerCommand("goal");
                      return;
                    }
                    const form = event.currentTarget.closest("form");
                    form?.requestSubmit();
                    return;
                  }
                  if (event.key === "Escape" && composerCommandMenuVisible) {
                    event.preventDefault();
                    setCommandMenuOpen(false);
                    if (shouldShowComposerCommandMenu(draft)) {
                      setDraft("");
                    }
                  }
                }}
                placeholder={
                  activeGoal?.status === "executing"
                    ? "继续你的任务…"
                    : "输入消息，/ 选择命令，Enter 发送"
                }
                rows={2}
              />
              <div className="composer-floating-actions" aria-label="对话操作">
                <label
                  className={`auto-approval-toggle${
                    autoApprovalEnabled ? " is-enabled" : ""
                  }`}
                  title="自动授权工具请求"
                >
                  <input
                    aria-label="自动授权工具请求"
                    checked={autoApprovalEnabled}
                    onChange={(event) => {
                      void handleSetAutoApprovalEnabled(event.currentTarget.checked);
                    }}
                    type="checkbox"
                  />
                  <span>自动</span>
                </label>
                <button
                  aria-label="打开命令菜单"
                  className="composer-icon-button composer-command-button"
                  onClick={handleOpenCommandMenu}
                  title="打开命令菜单"
                  type="button"
                >
                  <span className="composer-icon composer-icon-command" aria-hidden="true" />
                  <span className="sr-only">打开命令菜单</span>
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
                  <span className="composer-icon composer-icon-stop" aria-hidden="true" />
                  <span className="sr-only">中断当前任务</span>
                </button>
                <button
                  aria-label="发送消息"
                  className="composer-icon-button composer-send-button"
                  data-testid="agent-send-button"
                  disabled={status.kind === "working" || !draft.trim()}
                  title="发送消息"
                  type="submit"
                >
                  <span className="composer-icon composer-icon-send" aria-hidden="true" />
                  <span className="sr-only">发送消息</span>
                </button>
              </div>
            </div>
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
          onReplan={handleReplanGoal}
          onRetry={handleRetryGoal}
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
            <strong>上下文</strong>
          </header>
          <div className="kimi-context-list">
            {contextPanelItems.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled
              >
                <span aria-hidden="true">{item.icon}</span>
                <div>
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </div>
              </button>
            ))}
          </div>
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
      <h2>今天想让智能体做什么？</h2>
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
    icon: "◷",
    label: `${card.label} · ${card.value}`,
    detail: card.detail,
  }));
  const goalItem = options.activeGoal
    ? [
        {
          id: `goal-${options.activeGoal.id}`,
          icon: "◎",
          label: "当前目标",
          detail: `${translateGoalStatus(options.activeGoal.status)} · ${options.activeGoal.description}`,
        },
      ]
    : [];
  const memoryItems = options.memories.slice(0, 3).map((memory) => ({
    id: `memory-${memory.id}`,
    icon: "□",
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
            <TaskProcessItem key={item.id} item={item} />
          ))}
        </ol>
      )}
    </section>
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

  return (
    <section
      aria-label="工具授权请求"
      className={`tool-approval-panel${
        isCritical ? " is-critical-risk" : ""
      }`}
      role="dialog"
    >
      <div>
        <span>{isCritical ? "高危授权" : "工具授权"}</span>
        <strong>{request.request.toolName}</strong>
        <p>{request.deniedReason}</p>
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
        {Object.entries(request.argsSummary).map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{String(value)}</dd>
          </div>
        ))}
      </dl>
      <div className="tool-approval-actions">
        <button type="button" onClick={() => onResolve(true)}>
          授权本次
        </button>
        <button type="button" onClick={() => onResolve(false)}>
          拒绝
        </button>
      </div>
    </section>
  );
}

function TaskProcessItem({
  item,
}: {
  item: ReturnType<typeof buildTaskProcessItems>[number];
}) {
  const [expanded, setExpanded] = useState(false);
  const shouldCollapse = item.message.length > 160;
  const displayMessage =
    expanded || !shouldCollapse ? item.message : `${item.message.slice(0, 157)}...`;

  return (
    <li className={item.label === "思考" ? "is-reasoning" : ""}>
      <time>{item.time}</time>
      <strong>{item.label}</strong>
      <span>{displayMessage}</span>
      {shouldCollapse && (
        <button
          type="button"
          className="task-process-item-toggle"
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

function buildTaskActivityFromStatusEvent(
  event: ChatTaskStatusEvent,
): TaskActivityState {
  const eventTime = parseEventTime(event.createdAt);
  const startedAt = eventTime - event.elapsedMs;
  const kind =
    event.state === "paused"
      ? "paused"
      : event.state === "completed" || event.state === "canceled"
        ? "done"
        : event.state === "failed"
          ? "error"
          : "working";

  return createTaskActivity({
    kind,
    title: getTaskActivityTitleFromStatusEvent(event),
    detail: event.message,
    now: eventTime,
    startedAt,
    lastEventAt: eventTime,
    toolCallsExecuted: event.toolCallsExecuted,
    maxTurns: event.maxTurns,
  });
}

function getTaskActivityTitleFromStatusEvent(event: ChatTaskStatusEvent): string {
  if (event.state === "started") return "正在启动任务";
  if (event.state === "memory") return "正在检索记忆";
  if (event.state === "model") return "正在调用模型";
  if (event.state === "reasoning") return "模型思考";
  if (event.state === "tool_call") return "正在执行工具";
  if (event.state === "tool_result") return "工具结果已返回";
  if (event.state === "paused") return "长任务等待确认";
  if (event.state === "canceled") return "任务已中断";
  if (event.state === "completed") return "本轮已完成";
  return "执行遇到问题";
}

function getChatStatusKindFromEvent(event: ChatTaskStatusEvent): ChatStatus["kind"] {
  if (event.state === "paused") return "paused";
  if (event.state === "failed") return "error";
  if (event.state === "canceled") return "ready";
  if (event.state === "completed") return "ready";
  return "working";
}

function getWorkPhaseFromStatusEvent(event: ChatTaskStatusEvent): AgentWorkPhase {
  if (event.state === "started") return "planning";
  if (event.state === "memory") return "memory";
  if (event.state === "model" || event.state === "reasoning") return "model";
  if (event.state === "tool_call" || event.state === "tool_result") return "tool";
  if (event.state === "paused") return "paused";
  if (event.state === "failed") return "error";
  return "done";
}

function parseEventTime(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
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

function isCanceledMessage(message: string): boolean {
  return /中断|取消|cancel|canceled|cancelled|abort|aborted/i.test(message);
}

function shouldShowComposerCommandMenu(draft: string): boolean {
  const commandDraft = draft.trimStart();
  if (!commandDraft.startsWith("/") || commandDraft.includes("\n")) {
    return false;
  }
  if (/^\/(?:目标|goal)\s+/i.test(commandDraft)) {
    return false;
  }

  const query = commandDraft.slice(1).trim().toLowerCase();
  return query.length === 0 || "目标".includes(query) || "goal".startsWith(query);
}

function createGoalCommandDraft(draft: string): string {
  const trimmed = draft.trim();
  if (!trimmed || trimmed.startsWith("/")) {
    return "/目标 ";
  }

  return `/目标 ${trimmed}`;
}

function MarkdownMessage({ content }: { content: string }) {
  const blocks = parseMarkdownBlocks(content);

  return (
    <div className="markdown-message">
      {blocks.map((block, index) => (
        <MarkdownBlockView block={block} key={`${block.type}-${index}`} />
      ))}
    </div>
  );
}

function MarkdownBlockView({ block }: { block: MarkdownBlock }) {
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

  if (block.type === "unorderedList") {
    return (
      <ul>
        {block.items.map((item, index) => (
          <li key={`${item}-${index}`}>
            <InlineMarkdown text={item} />
          </li>
        ))}
      </ul>
    );
  }

  if (block.type === "orderedList") {
    return (
      <ol>
        {block.items.map((item, index) => (
          <li key={`${item}-${index}`}>
            <InlineMarkdown text={item} />
          </li>
        ))}
      </ol>
    );
  }

  if (block.type === "code") {
    return (
      <pre>
        <code>{block.code}</code>
      </pre>
    );
  }

  return (
    <p>
      <InlineMarkdown text={block.text} />
    </p>
  );
}

function InlineMarkdown({ text }: { text: string }): ReactNode {
  return parseInlineMarkdown(text).map((segment, index) => {
    if (segment.type === "strong") {
      return <strong key={`${segment.type}-${index}`}>{segment.text}</strong>;
    }
    if (segment.type === "code") {
      return <code key={`${segment.type}-${index}`}>{segment.text}</code>;
    }
    return <span key={`${segment.type}-${index}`}>{segment.text}</span>;
  });
}

function toChatHistory(messages: ChatMessage[]): ChatHistoryMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
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
    updatedAt: session.updatedAt,
  };
}

function toChatMessage(message: ChatSessionRecord["messages"][number]): ChatMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: formatMessageTime(message.createdAt),
  };
}

function formatMessageTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
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
    achieved: "已达成",
    stopped_budget: "可继续",
    stopped_stalled: "停滞停止",
    failed: "失败",
    canceled: "已取消",
  };
  return labels[status];
}

function isTerminalGoalStatus(status: ChatSessionGoalSummary["status"]): boolean {
  return (
    status === "achieved" ||
    status === "stopped_budget" ||
    status === "stopped_stalled" ||
    status === "failed" ||
    status === "canceled"
  );
}

function canStartGoalFromChat(status: ChatSessionGoalSummary["status"]): boolean {
  return status === "planning";
}
