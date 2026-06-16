import {
  useCallback,
  useEffect,
  useState,
} from "react";
import {
  AgentChatPanel,
  type ChatSidebarSession,
} from "./components/AgentChatPanel";
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
const fallbackChatSessions: ChatSessionListItem[] = [
  {
    id: "main",
    title: "当前会话",
    summary: "直接发指令给本地智能体",
    messageCount: 0,
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "files",
    title: "文件整理会话",
    summary: "整理下载目录并写报告",
    messageCount: 2,
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "research",
    title: "资料调研会话",
    summary: "搜索、抓取、总结网页",
    messageCount: 2,
    updatedAt: new Date(0).toISOString(),
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
    : "model-settings";
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

  function navigateTo(sectionId: NavigationSectionId) {
    const settingsSection = getSettingsNavigationSections().find(
      (section) => section.id === sectionId,
    );
    if (settingsSection) {
      setActiveSettingsSectionId(settingsSection.id);
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
      if (loadedSessions.length) {
        setChatSessions(loadedSessions);
      }
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
    setSelectedChatSessionId(sessionId);
    navigateTo("chat");
  }

  const handleChatSessionsChange = useCallback((sessions: ChatSidebarSession[]) => {
    if (sessions.length) {
      setChatSessions(sessions.map(toChatSessionListItem));
    }
  }, []);

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
          <span aria-hidden="true">＋</span>
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
            {chatSessions.slice(0, 8).map((session) => (
              <button
                className={`sidebar-session-item ${
                  session.id === selectedChatSessionId ? "is-active" : ""
                }`}
                key={session.id}
                type="button"
                onClick={() => onSelectChatSession(session.id)}
              >
                <strong>{session.title}</strong>
                <small>{session.summary || `${session.messageCount} 条消息`}</small>
                {session.activeGoal ? (
                  <span className={`goal-session-badge is-${session.activeGoal.status}`}>
                    {translateSidebarGoalStatus(session.activeGoal.status)}
                  </span>
                ) : null}
              </button>
            ))}
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
        {activeSection.id === "overview" ? (
          <OverviewPanel onNavigate={navigateTo} />
        ) : null}
        {activeSection.id === "runs" ? <RunsPanel /> : null}
        {activeSection.id === "scheduled-tasks" ? (
          <ScheduledTasksPanel />
        ) : null}
        {activeSection.id === "settings" ? (
          <SettingsSectionShell
            activeSectionId={activeSettingsSectionId}
            onSelect={setActiveSettingsSectionId}
          />
        ) : null}
      </section>
    </main>
  );
}

function SettingsSectionShell(props: {
  activeSectionId: SettingsNavigationSectionId;
  onSelect: (sectionId: SettingsNavigationSectionId) => void;
}) {
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

function toChatSessionListItem(session: ChatSidebarSession): ChatSessionListItem {
  return {
    id: session.id,
    title: session.title,
    summary: session.summary,
    messageCount: session.messageCount ?? 0,
    ...(session.activeGoal ? { activeGoal: session.activeGoal } : {}),
    updatedAt: new Date(0).toISOString(),
  };
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
