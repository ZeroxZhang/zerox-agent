import {
  useCallback,
  useEffect,
  useState,
} from "react";
import {
  AgentChatPanel,
  type ChatSidebarSession,
} from "./components/AgentChatPanel";
import { Icon } from "./components/Icon";
import { EvalReviewPanel } from "./components/EvalReviewPanel";
import { LearningReviewPanel } from "./components/LearningReviewPanel";
import { MemoryPanel } from "./components/MemoryPanel";
import { ModelSettingsPanel } from "./components/ModelSettingsPanel";
import { OverviewPanel } from "./components/OverviewPanel";
import { RunsPanel } from "./components/RunsPanel";
import { ScheduledTasksPanel } from "./components/ScheduledTasksPanel";
import { SkillLibraryPanel } from "./components/SkillLibraryPanel";
import { ToolsPanel } from "./components/ToolsPanel";
import { getAppMeta, type AppMeta } from "../shared/appMeta";
import type { ChatSessionListItem } from "../shared/chat";
import { buildAgentDataBoundary } from "../shared/dataBoundary";
import { getMaterialNavigationIcon } from "../shared/materialNavigation";
import {
  getDefaultNavigationSection,
  getDefaultSettingsNavigationSection,
  getNavigationSection,
  getNavigationSections,
  getSettingsNavigationSections,
  getStartupNavigationSection,
  type NavigationSection,
  type NavigationSectionId,
  type SettingsNavigationSectionId,
} from "../shared/navigation";

const fallbackMeta = getAppMeta();
const fallbackSections = getNavigationSections();
const fallbackAppVersion = "preview";
const fallbackSessionTimestamp = new Date().toISOString();
const fallbackChatSessions: ChatSessionListItem[] = [
  {
    id: "main",
    title: "当前会话",
    summary: "直接发指令给本地智能体",
    messageCount: 0,
    updatedAt: fallbackSessionTimestamp,
  },
  {
    id: "files",
    title: "文件整理会话",
    summary: "整理下载目录并写报告",
    messageCount: 2,
    tokenUsage: { totalTokens: 1280, estimated: true },
    updatedAt: fallbackSessionTimestamp,
  },
  {
    id: "research",
    title: "资料调研会话",
    summary: "搜索、抓取、总结网页",
    messageCount: 2,
    tokenUsage: { totalTokens: 2430, estimated: true },
    updatedAt: fallbackSessionTimestamp,
  },
];

function getSectionFromHash(): NavigationSectionId {
  return getNavigationSection(window.location.hash.replace(/^#/, "")).id;
}

function getStartupSectionId(): NavigationSectionId {
  return getStartupNavigationSection(window.location.hash).id;
}

function getStartupSettingsSectionId(): SettingsNavigationSectionId {
  const hash = window.location.hash.replace(/^#/, "");
  return getSettingsNavigationSections().some((section) => section.id === hash)
    ? (hash as SettingsNavigationSectionId)
    : getDefaultSettingsNavigationSection().id;
}

export function App() {
  const dataBoundary = buildAgentDataBoundary(
    window.buildingAgent ? "desktop" : "preview",
  );
  const [meta, setMeta] = useState<AppMeta>(fallbackMeta);
  const [appVersion, setAppVersion] = useState(fallbackAppVersion);
  const [sections, setSections] = useState<NavigationSection[]>(fallbackSections);
  const [activeSectionId, setActiveSectionId] = useState<NavigationSectionId>(
    () => getStartupSectionId(),
  );
  const [activeSettingsSectionId, setActiveSettingsSectionId] =
    useState<SettingsNavigationSectionId>(() => getStartupSettingsSectionId());
  const [chatSessions, setChatSessions] =
    useState<ChatSessionListItem[]>(fallbackChatSessions);
  const [selectedChatSessionId, setSelectedChatSessionId] =
    useState<string | null>(null);
  const [newChatRequestKey, setNewChatRequestKey] = useState(0);
  const [openChatSessionMenuId, setOpenChatSessionMenuId] =
    useState<string | null>(null);
  const [archiveGroupOpen, setArchiveGroupOpen] = useState(false);

  function navigateTo(sectionId: NavigationSectionId) {
    const settingsSection = getSettingsNavigationSections().find(
      (section) => section.id === sectionId,
    );
    if (settingsSection) {
      setActiveSettingsSectionId(settingsSection.id);
    }
    if (sectionId === "overview") {
      setActiveSettingsSectionId("system-overview");
    }
    const primarySectionId = getNavigationSection(sectionId).id;
    setActiveSectionId(primarySectionId);
    const nextHash = `#${sectionId}`;
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, "", nextHash);
    }
  }

  useEffect(() => {
    window.buildingAgent?.getAppMeta().then(setMeta).catch(() => {
      setMeta(fallbackMeta);
    });
    window.buildingAgent?.getRuntimeInfo().then((runtimeInfo) => {
      setAppVersion(runtimeInfo.version);
    }).catch(() => {
      setAppVersion(fallbackAppVersion);
    });
    window.buildingAgent
      ?.listNavigationSections()
      .then(setSections)
      .catch(() => {
        setSections(fallbackSections);
      });
    window.buildingAgent?.listChatSessions().then((loadedSessions) => {
      setChatSessions(loadedSessions);
    }).catch(() => {
      setChatSessions(fallbackChatSessions);
    });
  }, []);

  useEffect(() => {
    navigateTo(getStartupSectionId());
  }, []);

  useEffect(() => {
    function handleHashChange() {
      const hash = window.location.hash.replace(/^#/, "");
      if (getSettingsNavigationSections().some((section) => section.id === hash)) {
        setActiveSettingsSectionId(hash as SettingsNavigationSectionId);
      }
      if (hash === "overview") {
        setActiveSettingsSectionId("system-overview");
      }
      setActiveSectionId(getSectionFromHash());
    }

    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  const activeSection =
    sections.find((section) => section.id === activeSectionId) ??
    getNavigationSection(getDefaultNavigationSection().id);

  function handleNewChat() {
    setSelectedChatSessionId(null);
    setNewChatRequestKey((current) => current + 1);
    navigateTo("chat");
  }

  function onSelectChatSession(sessionId: string) {
    setOpenChatSessionMenuId(null);
    setSelectedChatSessionId(sessionId);
    navigateTo("chat");
  }

  const handleChatSessionsChange = useCallback((sessions: ChatSidebarSession[]) => {
    setChatSessions(sessions.map(toChatSessionListItem));
  }, []);

  async function refreshChatSessions() {
    if (!window.buildingAgent) {
      return;
    }

    const loadedSessions = await window.buildingAgent.listChatSessions();
    setChatSessions(loadedSessions);
  }

  async function handleArchiveChatSession(session: ChatSessionListItem) {
    setOpenChatSessionMenuId(null);
    if (!window.buildingAgent) {
      const archivedAt = new Date().toISOString();
      setChatSessions((currentSessions) =>
        currentSessions.map((currentSession) =>
          currentSession.id === session.id
            ? { ...currentSession, archivedAt }
            : currentSession,
        ),
      );
      setArchiveGroupOpen(true);
      return;
    }

    const result = await window.buildingAgent.archiveChatSession(session.id);
    if (!result.ok) {
      window.alert(result.message);
      return;
    }
    setArchiveGroupOpen(true);
    await refreshChatSessions();
  }

  async function handleRestoreChatSession(session: ChatSessionListItem) {
    setOpenChatSessionMenuId(null);
    if (!window.buildingAgent) {
      setChatSessions((currentSessions) =>
        currentSessions.map((currentSession) => {
          if (currentSession.id !== session.id) {
            return currentSession;
          }
          const { archivedAt: _archivedAt, ...restoredSession } = currentSession;
          return restoredSession;
        }),
      );
      return;
    }

    const result = await window.buildingAgent.restoreChatSession(session.id);
    if (!result.ok) {
      window.alert(result.message);
      return;
    }
    await refreshChatSessions();
  }

  async function handleDeleteChatSession(session: ChatSessionListItem) {
    setOpenChatSessionMenuId(null);
    if (!window.confirm(`删除会话“${session.title}”？这不会删除已产生的运行日志。`)) {
      return;
    }

    if (!window.buildingAgent) {
      setChatSessions((currentSessions) =>
        currentSessions.filter((currentSession) => currentSession.id !== session.id),
      );
      if (selectedChatSessionId === session.id) {
        setSelectedChatSessionId(null);
        setNewChatRequestKey((current) => current + 1);
      }
      return;
    }

    const result = await window.buildingAgent.deleteChatSession(session.id);
    if (!result.ok) {
      window.alert(result.message);
      return;
    }
    if (selectedChatSessionId === session.id) {
      setSelectedChatSessionId(null);
      setNewChatRequestKey((current) => current + 1);
    }
    await refreshChatSessions();
  }

  const activeChatSessions = chatSessions.filter((session) => !session.archivedAt);
  const archivedChatSessions = chatSessions.filter((session) => session.archivedAt);
  const latestArchivedSession = archivedChatSessions[0] ?? null;

  return (
    <main
      className={`app-shell material-shell ${
        activeSection.id === "chat" ? "is-agent-chat" : ""
      }`}
    >
      <div className="window-drag-strip" aria-hidden="true" />
      <aside
        className="sidebar workspace-sidebar material-navigation-rail"
        aria-label="主导航"
      >
        <div className="brand material-brand">
          <img className="brand-mark" src="./logo.png" alt="Zerox Agent" />
          <div className="material-brand-copy">
            <strong>{meta.productName}</strong>
            <small>本地桌面智能体</small>
          </div>
        </div>
        <button className="new-chat-button" type="button" onClick={handleNewChat}>
          <Icon name="plus" size={16} />
          新会话
        </button>
        <nav className="primary-nav" aria-label="功能分区">
          {sections.map((section) => {
            const icon = getMaterialNavigationIcon(section.id);

            return (
              <button
                key={section.id}
                type="button"
                className={`nav-item material-navigation-rail-item ${
                  section.id === activeSection.id ? "is-active" : ""
                }`}
                aria-label={icon.label}
                title={section.summary}
                onClick={() => navigateTo(section.id)}
              >
                <span className="material-nav-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="24" height="24" focusable="false">
                    <path d={icon.path} fill="currentColor" />
                  </svg>
                </span>
                <span className="material-nav-label">{section.label}</span>
                <small className="material-nav-supporting">
                  {section.module}
                </small>
              </button>
            );
          })}
        </nav>
        <section className="sidebar-section sidebar-pinned" aria-label="固定入口">
          <p className="sidebar-section-title">Pinned</p>
          <button type="button" onClick={() => navigateTo("scheduled-tasks")}>
            <strong>自动任务</strong>
            <small>调度与本地执行</small>
          </button>
          <button type="button" onClick={() => navigateTo("settings")}>
            <strong>本地配置</strong>
            <small>模型、权限与记忆</small>
          </button>
        </section>
        <section className="sidebar-section sidebar-recents" aria-label="最近会话">
          <p className="sidebar-section-title">Recents</p>
          <div className="sidebar-session-list">
            {activeChatSessions.length ? (
              activeChatSessions.map((session) => (
                <SidebarSessionRow
                  key={session.id}
                  session={session}
                  isActive={session.id === selectedChatSessionId}
                  menuOpen={openChatSessionMenuId === session.id}
                  onSelect={onSelectChatSession}
                  onToggleMenu={(sessionId) =>
                    setOpenChatSessionMenuId((current) =>
                      current === sessionId ? null : sessionId,
                    )
                  }
                  onArchive={handleArchiveChatSession}
                  onRestore={handleRestoreChatSession}
                  onDelete={handleDeleteChatSession}
                />
              ))
            ) : (
              <p className="sidebar-empty-state">暂无会话</p>
            )}
            {archivedChatSessions.length ? (
              <div className="sidebar-archive-group">
                <button
                  className={`sidebar-session-item sidebar-archive-toggle ${
                    archiveGroupOpen ? "is-open" : ""
                  }`}
                  type="button"
                  aria-expanded={archiveGroupOpen}
                  onClick={() => setArchiveGroupOpen((open) => !open)}
                >
                  <span className="sidebar-session-main">
                    <span className="sidebar-session-title-line">
                      <strong>归档会话</strong>
                      <span className="sidebar-session-time">
                        {latestArchivedSession
                          ? formatSessionRelativeTime(
                              latestArchivedSession.archivedAt ??
                                latestArchivedSession.updatedAt,
                            )
                          : ""}
                      </span>
                    </span>
                    <small>{archivedChatSessions.length} 个会话已收纳</small>
                    <span className="sidebar-session-meta">
                      <span className="sidebar-session-message-count">归档组</span>
                      <span className="sidebar-session-token">
                        {formatTokenUsage(sumArchivedTokenUsage(archivedChatSessions))}
                      </span>
                    </span>
                  </span>
                </button>
                {archiveGroupOpen ? (
                  <div className="sidebar-archive-list">
                    {archivedChatSessions.map((session) => (
                      <SidebarSessionRow
                        key={session.id}
                        session={session}
                        isActive={session.id === selectedChatSessionId}
                        menuOpen={openChatSessionMenuId === session.id}
                        onSelect={onSelectChatSession}
                        onToggleMenu={(sessionId) =>
                          setOpenChatSessionMenuId((current) =>
                            current === sessionId ? null : sessionId,
                          )
                        }
                        onArchive={handleArchiveChatSession}
                        onRestore={handleRestoreChatSession}
                        onDelete={handleDeleteChatSession}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>
        <div className="nav-footer">
          <span>v{appVersion}</span>
          <small>by Zerox</small>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar material-top-app-bar">
          <div>
            <p className="eyebrow">{activeSection.module}</p>
            <h1>{activeSection.label}</h1>
          </div>
          <div className="topbar-actions">
            {activeSection.id !== "chat" ? (
              <button
                className="topbar-chat-action"
                type="button"
                onClick={() => navigateTo("chat")}
              >
                打开会话窗口
              </button>
            ) : null}
            <span className={`status-pill is-${dataBoundary.mode}`}>
              {dataBoundary.mode === "desktop" ? "正式本地数据" : "演示数据预览"}
            </span>
          </div>
        </header>

        {activeSection.id === "chat" ? (
          <AgentChatPanel
            newChatRequestKey={newChatRequestKey}
            requestedSessionId={selectedChatSessionId}
            onActiveSessionChange={setSelectedChatSessionId}
            onChatSessionsChange={handleChatSessionsChange}
            onNavigate={navigateTo}
          />
        ) : null}
        {activeSection.id === "runs" ? <RunsPanel /> : null}
        {activeSection.id === "scheduled-tasks" ? (
          <ScheduledTasksPanel />
        ) : null}
        {activeSection.id === "settings" ? (
          <SettingsSectionShell
            activeSectionId={activeSettingsSectionId}
            onNavigate={navigateTo}
            onSelect={setActiveSettingsSectionId}
          />
        ) : null}
      </section>
    </main>
  );
}

function SettingsSectionShell(props: {
  activeSectionId: SettingsNavigationSectionId;
  onNavigate: (sectionId: NavigationSectionId) => void;
  onSelect: (sectionId: SettingsNavigationSectionId) => void;
}) {
  const navigateTo = props.onNavigate;

  return (
    <section className="settings-section-shell" aria-label="设置分区">
      <aside className="settings-section-nav" aria-label="设置菜单">
        {getSettingsNavigationSections().map((section) => (
          <button
            key={section.id}
            className={section.id === props.activeSectionId ? "is-active" : ""}
            type="button"
            onClick={() => props.onSelect(section.id)}
          >
            <strong>{section.label}</strong>
            <span>{section.summary}</span>
          </button>
        ))}
      </aside>
      <section className="settings-section-body">
        {props.activeSectionId === "system-overview" ? (
          <OverviewPanel onNavigate={navigateTo} />
        ) : null}
        {props.activeSectionId === "model-settings" ? <ModelSettingsPanel /> : null}
        {props.activeSectionId === "skills" ? <SkillLibraryPanel /> : null}
        {props.activeSectionId === "tools" ? <ToolsPanel /> : null}
        {props.activeSectionId === "memory" ? <MemoryPanel /> : null}
        {props.activeSectionId === "learning" ? <LearningReviewPanel /> : null}
        {props.activeSectionId === "evals" ? <EvalReviewPanel /> : null}
      </section>
    </section>
  );
}

function SidebarSessionRow(props: {
  session: ChatSessionListItem;
  isActive: boolean;
  menuOpen: boolean;
  onSelect: (sessionId: string) => void;
  onToggleMenu: (sessionId: string) => void;
  onArchive: (session: ChatSessionListItem) => void;
  onRestore: (session: ChatSessionListItem) => void;
  onDelete: (session: ChatSessionListItem) => void;
}) {
  const { session } = props;
  const isArchived = Boolean(session.archivedAt);

  return (
    <div
      className={`sidebar-session-row ${props.isActive ? "is-active" : ""} ${
        props.menuOpen ? "has-open-menu" : ""
      } ${isArchived ? "is-archived" : ""}`}
    >
      <button
        className={`sidebar-session-item ${props.isActive ? "is-active" : ""}`}
        type="button"
        onClick={() => props.onSelect(session.id)}
      >
        <span className="sidebar-session-main">
          <span className="sidebar-session-title-line">
            <strong>{session.title}</strong>
            <span className="sidebar-session-time">
              {formatSessionRelativeTime(
                session.lastAssistantMessageAt ?? session.updatedAt,
              )}
            </span>
          </span>
          <small>{session.summary || `${session.messageCount} 条消息`}</small>
          <span className="sidebar-session-meta">
            <span className="sidebar-session-message-count">
              {session.messageCount} 条消息
            </span>
            <span className="sidebar-session-token">
              {formatTokenUsage(session.tokenUsage)}
            </span>
          </span>
          {session.activeGoal ? (
            <span className={`goal-session-badge is-${session.activeGoal.status}`}>
              {translateSidebarGoalStatus(session.activeGoal.status)}
            </span>
          ) : null}
        </span>
      </button>
      <button
        className="sidebar-session-actions"
        type="button"
        aria-label={`打开 ${session.title} 的会话操作`}
        aria-haspopup="menu"
        aria-expanded={props.menuOpen}
        onClick={(event) => {
          event.stopPropagation();
          props.onToggleMenu(session.id);
        }}
      >
        <Icon name="more" size={16} />
      </button>
      {props.menuOpen ? (
        <div className="sidebar-session-menu" role="menu">
          {isArchived ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => props.onRestore(session)}
            >
              恢复
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={() => props.onArchive(session)}
            >
              归档
            </button>
          )}
          <button
            className="is-danger"
            type="button"
            role="menuitem"
            onClick={() => props.onDelete(session)}
          >
            删除
          </button>
        </div>
      ) : null}
    </div>
  );
}

function toChatSessionListItem(session: ChatSidebarSession): ChatSessionListItem {
  return {
    id: session.id,
    title: session.title,
    summary: session.summary,
    messageCount: session.messageCount ?? 0,
    ...(session.activeGoal ? { activeGoal: session.activeGoal } : {}),
    ...(session.archivedAt ? { archivedAt: session.archivedAt } : {}),
    ...(session.lastAssistantMessageAt
      ? { lastAssistantMessageAt: session.lastAssistantMessageAt }
      : {}),
    ...(session.tokenUsage ? { tokenUsage: session.tokenUsage } : {}),
    updatedAt: session.updatedAt,
  };
}

function formatSessionRelativeTime(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return "未知";
  }

  const diffMs = Math.max(0, Date.now() - timestamp);
  const minuteMs = 60_000;
  const hourMs = minuteMs * 60;
  const dayMs = hourMs * 24;
  if (diffMs < minuteMs) {
    return "刚刚";
  }
  if (diffMs < hourMs) {
    return `${Math.max(1, Math.floor(diffMs / minuteMs))} 分钟`;
  }
  if (diffMs < dayMs) {
    return `${Math.max(1, Math.floor(diffMs / hourMs))} 小时`;
  }
  if (diffMs < dayMs * 7) {
    return `${Math.max(1, Math.floor(diffMs / dayMs))} 天`;
  }
  if (diffMs < dayMs * 35) {
    return `${Math.max(1, Math.floor(diffMs / (dayMs * 7)))} 周`;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
  }).format(timestamp);
}

function formatTokenUsage(
  usage: ChatSessionListItem["tokenUsage"] | undefined,
): string {
  const totalTokens = usage?.totalTokens ?? 0;
  const prefix = usage?.estimated ? "~" : "";
  if (totalTokens >= 1_000_000) {
    return `${prefix}${trimFixed(totalTokens / 1_000_000, 1)}m tok`;
  }
  if (totalTokens >= 1_000) {
    return `${prefix}${trimFixed(totalTokens / 1_000, totalTokens >= 10_000 ? 0 : 1)}k tok`;
  }
  return `${prefix}${totalTokens} tok`;
}

function sumArchivedTokenUsage(
  sessions: ChatSessionListItem[],
): ChatSessionListItem["tokenUsage"] | undefined {
  const usages = sessions
    .map((session) => session.tokenUsage)
    .filter((usage): usage is NonNullable<ChatSessionListItem["tokenUsage"]> =>
      Boolean(usage),
    );
  if (!usages.length) {
    return undefined;
  }

  return {
    totalTokens: usages.reduce((total, usage) => total + usage.totalTokens, 0),
    estimated: usages.some((usage) => usage.estimated),
  };
}

function trimFixed(value: number, digits: number): string {
  return value.toFixed(digits).replace(/\.0$/, "");
}

function translateSidebarGoalStatus(
  status: NonNullable<ChatSessionListItem["activeGoal"]>["status"],
): string {
  const labels: Record<
    NonNullable<ChatSessionListItem["activeGoal"]>["status"],
    string
  > = {
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
