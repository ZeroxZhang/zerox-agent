import {
  useEffect,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { AgentChatPanel } from "./components/AgentChatPanel";
import { EvalReviewPanel } from "./components/EvalReviewPanel";
import { GoalPanel } from "./components/GoalPanel";
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
const minNavRailWidth = 80;
const maxNavRailWidth = 156;
const resizeStep = 8;

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
  const [navRailWidth, setNavRailWidth] = useState(96);

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

  function updateNavRailWidth(nextWidth: number) {
    setNavRailWidth(clampNumber(nextWidth, minNavRailWidth, maxNavRailWidth));
  }

  function handleNavResizePointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = navRailWidth;

    function handlePointerMove(moveEvent: PointerEvent) {
      updateNavRailWidth(startWidth + moveEvent.clientX - startX);
    }

    function cleanup() {
      document.removeEventListener("pointermove", handlePointerMove);
    }

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", cleanup, { once: true });
  }

  function handleNavResizeKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      updateNavRailWidth(navRailWidth - resizeStep);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      updateNavRailWidth(navRailWidth + resizeStep);
    }
    if (event.key === "Home") {
      event.preventDefault();
      updateNavRailWidth(minNavRailWidth);
    }
    if (event.key === "End") {
      event.preventDefault();
      updateNavRailWidth(maxNavRailWidth);
    }
  }

  return (
    <main
      className={`app-shell material-shell ${
        activeSection.id === "chat" ? "is-agent-chat" : ""
      }`}
      style={
        {
          "--nav-rail-width": `${navRailWidth}px`,
        } as CSSProperties
      }
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

      <button
        aria-label="调整功能导航栏宽度"
        aria-orientation="vertical"
        aria-valuemax={maxNavRailWidth}
        aria-valuemin={minNavRailWidth}
        aria-valuenow={navRailWidth}
        className="nav-resize-handle"
        onKeyDown={handleNavResizeKeyDown}
        onPointerDown={handleNavResizePointerDown}
        role="separator"
        title="拖动调整功能导航栏宽度"
        type="button"
      >
        <span aria-hidden="true" />
      </button>

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
        {activeSection.id === "goals" ? <GoalPanel /> : null}
        {activeSection.id === "runs" ? <RunsPanel /> : null}
        {activeSection.id === "settings" ? <ModelSettingsPanel /> : null}
        {activeSection.id === "skills" ? <SkillLibraryPanel /> : null}
        {activeSection.id === "scheduled-tasks" ? (
          <ScheduledTasksPanel />
        ) : null}
        {activeSection.id === "tools" ? <ToolsPanel /> : null}
        {activeSection.id === "memory" ? <MemoryPanel /> : null}
        {activeSection.id === "learning" ? <LearningReviewPanel /> : null}
        {activeSection.id === "evals" ? <EvalReviewPanel /> : null}
      </section>
    </main>
  );
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}
