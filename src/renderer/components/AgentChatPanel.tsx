import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
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
import type { AgentRunRecord } from "../../shared/agentRuns";
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
  createTaskActivity,
  idleTaskActivity,
  type TaskActivityState,
} from "../chatTaskActivity";
import { GoalContractBar } from "./GoalContractBar";
import { GoalDetailDrawer } from "./GoalDetailDrawer";

type AgentChatPanelProps = {
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
};

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
  },
  {
    id: "files",
    title: "文件整理会话",
    summary: "整理下载目录并写报告",
  },
  {
    id: "research",
    title: "资料调研会话",
    summary: "搜索、抓取、总结网页",
  },
];
const minSessionRailWidth = 180;
const maxSessionRailWidth = 360;
const minChatWorkspaceWidth = 520;
const chatResizeStep = 12;
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

const initialMessages: ChatMessage[] = [
  {
    id: "assistant-welcome",
    role: "assistant",
    content:
      "我是你的本地桌面智能体。你可以直接告诉我要做什么，例如：每天 9 点整理下载文件夹、运行本地文件整理技能、查一下最近失败原因。",
    createdAt: "刚刚",
  },
  {
    id: "assistant-safety",
    role: "assistant",
    content:
      "我会先看模型、技能、任务、工具权限和记忆状态；涉及文件、网页或命令行的动作，会按任务权限执行并留下运行日志。",
    createdAt: "刚刚",
  },
];

export function AgentChatPanel({ onNavigate }: AgentChatPanelProps) {
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
  const [sessionRailWidth, setSessionRailWidth] = useState(220);
  const [activeGoalDetail, setActiveGoalDetail] = useState<Goal | null>(null);
  const [goalDrawerOpen, setGoalDrawerOpen] = useState(false);
  const [activeChatRequestId, setActiveChatRequestId] = useState<string | null>(
    null,
  );
  const [activityTick, setActivityTick] = useState(Date.now());
  const chatPanelRef = useRef<HTMLElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const sessionIdRef = useRef<string | null>(sessionId);
  const activeStatusSessionIdRef = useRef<string | null>(null);
  const activeChatRequestIdRef = useRef<string | null>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    if (messageListRef.current) {
      messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

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
          setSessions(loadedSessions.map(toSessionRailItem));
          await loadPersistedSession(loadedSessions[0].id);
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
  }, []);

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
    if (loadedSession.activeGoalId) {
      setActiveGoalDetail(await window.buildingAgent.getGoal(loadedSession.activeGoalId));
    } else {
      setActiveGoalDetail(null);
      setGoalDrawerOpen(false);
    }
  }

  async function refreshSessions(nextActiveSessionId?: string) {
    if (!window.buildingAgent) {
      return;
    }

    const loadedSessions = await window.buildingAgent.listChatSessions();
    if (loadedSessions.length) {
      setSessions(loadedSessions.map(toSessionRailItem));
    }
    if (nextActiveSessionId) {
      setSessionId(nextActiveSessionId);
    }
  }

  const latestRun = runs[0];
  const activeSession = sessions.find((session) => session.id === sessionId) ?? null;
  const activeGoal = activeSession?.activeGoal ?? null;
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
    const isPaused = result.agentStatus?.state === "paused";
    setStatus({
      kind: isPaused ? "paused" : "ready",
      message: isPaused
        ? "等待你确认是否继续"
        : result.createdTask
          ? "任务已创建"
          : result.executedRun
            ? `任务已运行：${translateRunStatus(result.executedRun.status)}`
            : result.relatedMemories.length
              ? `已参考 ${result.relatedMemories.length} 条记忆`
              : "模型已回复",
    });
    setWorkPhase(isPaused ? "paused" : "done");
    setTaskActivity(
      buildTaskActivityFromAgentStatus({
        agentStatus: result.agentStatus,
        relatedMemoryCount: result.relatedMemories.length,
        fallbackDetail: isPaused ? "等待确认" : "回复已写入会话",
      }),
    );
    activeStatusSessionIdRef.current = isPaused ? result.sessionId : null;
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

  async function handleCancelChatMessage() {
    if (!window.buildingAgent || !canCancelChatTask) {
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

  function getMaxSessionRailWidth(): number {
    const panelWidth = chatPanelRef.current?.getBoundingClientRect().width ?? 0;
    if (!panelWidth) {
      return maxSessionRailWidth;
    }

    return Math.max(
      minSessionRailWidth,
      Math.min(maxSessionRailWidth, panelWidth - minChatWorkspaceWidth - 8),
    );
  }

  function updateSessionRailWidth(nextWidth: number) {
    setSessionRailWidth(
      clampNumber(
        nextWidth,
        minSessionRailWidth,
        getMaxSessionRailWidth(),
      ),
    );
  }

  function handleSessionRailResizePointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sessionRailWidth;

    function handlePointerMove(moveEvent: PointerEvent) {
      updateSessionRailWidth(startWidth - (moveEvent.clientX - startX));
    }

    function cleanup() {
      document.removeEventListener("pointermove", handlePointerMove);
    }

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", cleanup, { once: true });
  }

  function handleSessionRailResizeKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
  ) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      updateSessionRailWidth(sessionRailWidth + chatResizeStep);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      updateSessionRailWidth(sessionRailWidth - chatResizeStep);
    }
    if (event.key === "Home") {
      event.preventDefault();
      updateSessionRailWidth(minSessionRailWidth);
    }
    if (event.key === "End") {
      event.preventDefault();
      updateSessionRailWidth(getMaxSessionRailWidth());
    }
  }

  return (
    <section
      className="agent-chat-panel"
      aria-label="智能体会话工作台"
      data-testid="agent-chat-panel"
      ref={chatPanelRef}
      style={
        {
          "--session-rail-width": `${sessionRailWidth}px`,
        } as CSSProperties
      }
    >
      <aside className="session-rail" aria-label="会话列表">
        <div className="session-rail-header">
          <span>会话</span>
          <button
            type="button"
            aria-label="新建会话"
            onClick={() => {
              setSessionId(null);
              setMessages(initialMessages);
              setStatus({ kind: "ready", message: "会话已就绪" });
              setWorkPhase("idle");
              setTaskActivity(idleTaskActivity);
              setTaskProcessEvents([]);
            }}
          >
            ＋
          </button>
        </div>
        <div className="session-list">
          {sessions.map((session) => (
            <button
              className={`session-item ${
                session.id === sessionId || (!sessionId && session.id === "main")
                  ? "is-active"
                  : ""
              }`}
              key={session.id}
              onClick={() => {
                if (window.buildingAgent) {
                  void loadPersistedSession(session.id);
                  return;
                }
                setSessionId(session.id);
              }}
              type="button"
            >
              <strong>{session.title}</strong>
              <small>{session.summary}</small>
              {session.activeGoal ? (
                <span
                  className={`goal-session-badge is-${session.activeGoal.status}`}
                >
                  {translateGoalStatus(session.activeGoal.status)}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </aside>

      <button
        aria-label="调整会话历史栏宽度"
        aria-orientation="vertical"
        aria-valuemax={getMaxSessionRailWidth()}
        aria-valuemin={minSessionRailWidth}
        aria-valuenow={sessionRailWidth}
        className="session-rail-resize-handle"
        onKeyDown={handleSessionRailResizeKeyDown}
        onPointerDown={handleSessionRailResizePointerDown}
        role="separator"
        title="拖动调整会话历史栏宽度"
        type="button"
      >
        <span aria-hidden="true" />
      </button>

      <section className="chat-workspace" aria-label="会话窗口">
        <div className="chat-hero">
          <div className="chat-hero-main">
            <h2>今天想让智能体做什么？</h2>
            <div className="chat-hero-chips">
              {contextCards.map((card) => (
                <span key={card.label} className="hero-chip" title={card.detail}>
                  {card.label}：{card.value}
                </span>
              ))}
            </div>
          </div>
          <span className={`chat-state is-${status.kind}`}>{status.message}</span>
        </div>

        <AgentWorkTimeline
          phase={workPhase}
          status={status}
          steps={workSteps}
        />

        {activeGoal ? (
          <GoalContractBar
            goal={activeGoal}
            onEnd={() => void submitUserMessage("结束目标")}
            onModify={() => setDraft("目标改一下：")}
            {...(activeGoal.status === "executing"
              ? { onPause: () => void submitUserMessage("暂停这个目标") }
              : {})}
            onViewProgress={() => setGoalDrawerOpen(true)}
          />
        ) : null}

        {activeGoal?.status === "waiting_for_review" ? (
          <article className="goal-review-gate-card" aria-label="目标等待审核">
            <span>Review Gate</span>
            <h4>目标等待审核</h4>
            <p>检查当前阶段证据后，选择继续、修改计划或终止目标。</p>
            <div className="goal-actions">
              <button type="button" onClick={() => void submitUserMessage("继续")}>
                继续
              </button>
              <button type="button" onClick={() => setDraft("修改计划：")}>
                修改计划
              </button>
              <button
                type="button"
                onClick={() => void submitUserMessage("终止目标")}
              >
                终止
              </button>
            </div>
          </article>
        ) : null}

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

        <form className="composer" onSubmit={handleSubmit}>
          <TaskActivityStrip
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
                placeholder="输入消息，/ 选择命令，Enter 发送"
                rows={2}
              />
              <div className="composer-floating-actions" aria-label="对话操作">
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
                  disabled={!canCancelChatTask}
                  onClick={() => {
                    void handleCancelChatMessage();
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
          onClose={() => setGoalDrawerOpen(false)}
        />
      </section>
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

function TaskActivityStrip({
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
  return (
    <details className={`task-activity-strip is-${activity.kind}`}>
      <summary>
        <span className="task-activity-dot" aria-hidden="true" />
        <em>
          {activity.title} · {detail}
        </em>
        {typeof activity.toolCallsExecuted === "number" && (
          <span className="task-activity-meter">
            工具 {activity.toolCallsExecuted}
          </span>
        )}
        {onContinue && (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onContinue();
            }}
          >
            继续执行
          </button>
        )}
      </summary>
      {processItems.length > 0 && (
        <ol className="task-process-list" aria-label="思考与执行过程">
          {processItems.map((item) => (
            <li key={item.id}>
              <time>{item.time}</time>
              <strong>{item.label}</strong>
              <span>{item.message}</span>
              {item.meta && <small>{item.meta}</small>}
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}

function buildTaskActivityFromAgentStatus(options: {
  agentStatus: ChatAgentStatus | undefined;
  relatedMemoryCount: number;
  fallbackDetail: string;
}): TaskActivityState {
  if (options.agentStatus?.state === "paused") {
    const isFailureLoop = options.agentStatus.reason === "tool_failure_loop";
    return createTaskActivity({
      kind: "paused",
      title: isFailureLoop ? "连续工具失败，等待确认" : "长任务等待确认",
      detail: isFailureLoop
        ? `已执行 ${options.agentStatus.toolCallsExecuted} 个工具，检测到同类失败循环`
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

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
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
    stopped_budget: "预算停止",
    stopped_stalled: "停滞停止",
    failed: "失败",
    canceled: "已取消",
  };
  return labels[status];
}
