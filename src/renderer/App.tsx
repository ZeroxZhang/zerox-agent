import { useEffect, useState } from "react";
import { AgentChatPanel } from "./components/AgentChatPanel";
import { LearningReviewPanel } from "./components/LearningReviewPanel";
import { MemoryPanel } from "./components/MemoryPanel";
import { ModelSettingsPanel } from "./components/ModelSettingsPanel";
import { OverviewPanel } from "./components/OverviewPanel";
import { RunsPanel } from "./components/RunsPanel";
import { ScheduledTasksPanel } from "./components/ScheduledTasksPanel";
import { SkillLibraryPanel } from "./components/SkillLibraryPanel";
import { ToolsPanel } from "./components/ToolsPanel";
import { getAppMeta, type AppMeta } from "../shared/appMeta";
import { buildAgentDataBoundary } from "../shared/dataBoundary";
import { getMaterialNavigationIcon } from "../shared/materialNavigation";
import {
  getDefaultNavigationSection,
  getNavigationSection,
  getNavigationSections,
  getStartupNavigationSection,
  type NavigationSection,
  type NavigationSectionId,
} from "../shared/navigation";

const fallbackMeta = getAppMeta();
const fallbackSections = getNavigationSections();
const fallbackAppVersion = "preview";

function getSectionFromHash(): NavigationSectionId {
  return getNavigationSection(window.location.hash.replace(/^#/, "")).id;
}

function getStartupSectionId(): NavigationSectionId {
  return getStartupNavigationSection(window.location.hash).id;
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

  function navigateTo(sectionId: NavigationSectionId) {
    setActiveSectionId(sectionId);
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
  }, []);

  useEffect(() => {
    navigateTo(getStartupSectionId());
  }, []);

  useEffect(() => {
    function handleHashChange() {
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

  return (
    <main
      className={`app-shell material-shell ${
        activeSection.id === "chat" ? "is-agent-chat" : ""
      }`}
    >
      <aside className="sidebar material-navigation-rail" aria-label="主导航">
        <div className="brand material-brand">
          <img className="brand-mark" src="./logo.png" alt="Zerox Agent" />
          <div className="material-brand-copy">
            <strong>{meta.productName}</strong>
            <small>本地桌面智能体</small>
          </div>
        </div>
        <nav aria-label="功能分区">
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
                  {icon.glyph}
                </span>
                <span className="material-nav-label">{section.label}</span>
                <small className="material-nav-supporting">
                  {section.module}
                </small>
              </button>
            );
          })}
        </nav>
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
          <AgentChatPanel onNavigate={navigateTo} />
        ) : null}
        {activeSection.id === "overview" ? (
          <OverviewPanel onNavigate={navigateTo} />
        ) : null}
        {activeSection.id === "runs" ? <RunsPanel /> : null}
        {activeSection.id === "settings" ? <ModelSettingsPanel /> : null}
        {activeSection.id === "skills" ? <SkillLibraryPanel /> : null}
        {activeSection.id === "scheduled-tasks" ? (
          <ScheduledTasksPanel />
        ) : null}
        {activeSection.id === "tools" ? <ToolsPanel /> : null}
        {activeSection.id === "memory" ? <MemoryPanel /> : null}
        {activeSection.id === "learning" ? <LearningReviewPanel /> : null}
      </section>
    </main>
  );
}
