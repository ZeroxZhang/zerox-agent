import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  ChatHistoryMessage,
  ChatSessionListItem,
  ChatSessionRecord,
} from "../../shared/chat";
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
  kind: "ready" | "working" | "error";
  message: string;
};

type ChatSession = {
  id: string;
  title: string;
  summary: string;
  messageCount?: number;
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
  const messageListRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    if (messageListRef.current) {
      messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
    }
  }, [messages]);

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
  const activeTasks = tasks.filter((task) => task.enabled);
  const workSteps = useMemo(() => buildAgentWorkSteps(workPhase), [workPhase]);

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

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();

    if (!content) {
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

    if (!window.buildingAgent) {
      setStatus({ kind: "working", message: "正在整理演示回复..." });
      setWorkPhase("model");
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
      return;
    }

    setStatus({ kind: "working", message: "正在检索记忆并调用模型..." });
    setWorkPhase("model");
    const result = await window.buildingAgent
      .sendChatMessage({
        ...(sessionId ? { sessionId } : {}),
        message: content,
        history,
      })
      .catch((error) => ({
        ok: false as const,
        message:
          error instanceof Error ? error.message : "会话请求失败，请稍后重试。",
      }));

    if (!result.ok) {
      setStatus({ kind: "error", message: result.message });
      setWorkPhase("error");
      appendMessage({
        role: "assistant",
        content: result.message,
      });
      return;
    }

    setSessionId(result.sessionId);
    if (result.executedRun) {
      setRuns((currentRuns) => [result.executedRun!, ...currentRuns]);
    }
    if (result.createdTask) {
      setTasks((currentTasks) => [result.createdTask!, ...currentTasks]);
    }
    setStatus({
      kind: "ready",
      message: result.createdTask
        ? "任务已创建"
        : result.executedRun
        ? `任务已运行：${translateRunStatus(result.executedRun.status)}`
        : result.relatedMemories.length
        ? `已参考 ${result.relatedMemories.length} 条记忆`
        : "模型已回复",
    });
    setWorkPhase("done");
    appendMessage({
      role: "assistant",
      content: result.reply,
    });
    void refreshSessions(result.sessionId);
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
      className="agent-chat-panel"
      aria-label="智能体会话工作台"
      data-testid="agent-chat-panel"
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
            </button>
          ))}
        </div>
      </aside>

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
          <div className="composer-inner">
            <textarea
              data-testid="agent-message-input"
              id="agent-message"
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  const form = event.currentTarget.closest("form");
                  form?.requestSubmit();
                }
              }}
              placeholder="输入消息，Enter 发送，Shift+Enter 换行"
              rows={2}
            />
            <button data-testid="agent-send-button" type="submit">
              发送
            </button>
          </div>
        </form>
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
