import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Design System — Notion-inspired app shell", () => {
  const rootStyles = readFileSync(
    path.join(process.cwd(), "src/renderer/styles.css"),
    "utf8",
  );
  const rendererStyleFiles = [
    "tokens.css",
    "base.css",
    "app-shell.css",
    "sidebar.css",
    "cards.css",
    "chat.css",
    "composer.css",
    "responsive.css",
  ];
  const styles = [
    rootStyles,
    ...rendererStyleFiles.map((fileName) => {
      const filePath = path.join(process.cwd(), "src/renderer/styles", fileName);
      return existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
    }),
  ].join("\n");
  const appSource = readFileSync(
    path.join(process.cwd(), "src/renderer/App.tsx"),
    "utf8",
  );
  const preloadSource = readFileSync(
    path.join(process.cwd(), "src/preload/index.ts"),
    "utf8",
  );
  const chatPanelSource = readFileSync(
    path.join(process.cwd(), "src/renderer/components/AgentChatPanel.tsx"),
    "utf8",
  );
  const goalStatusStripSource = readFileSync(
    path.join(process.cwd(), "src/renderer/components/GoalStatusStrip.tsx"),
    "utf8",
  );
  const goalDetailDrawerSource = readFileSync(
    path.join(process.cwd(), "src/renderer/components/GoalDetailDrawer.tsx"),
    "utf8",
  );
  const overviewPanelSource = readFileSync(
    path.join(process.cwd(), "src/renderer/components/OverviewPanel.tsx"),
    "utf8",
  );
  const runsPanelSource = readFileSync(
    path.join(process.cwd(), "src/renderer/components/RunsPanel.tsx"),
    "utf8",
  );
  const runTrajectoryPanelSource = readFileSync(
    path.join(process.cwd(), "src/renderer/components/RunTrajectoryPanel.tsx"),
    "utf8",
  );
  const evalReviewPanelPath = path.join(
    process.cwd(),
    "src/renderer/components/EvalReviewPanel.tsx",
  );
  const evalReviewPanelSource = existsSync(evalReviewPanelPath)
    ? readFileSync(evalReviewPanelPath, "utf8")
    : "";

  it("defines comprehensive CSS custom property design tokens", () => {
    expect(rootStyles).toContain("@import \"./styles/tokens.css\";");
    expect(rootStyles).toContain("@import \"./styles/base.css\";");
    expect(rootStyles).toContain("@import \"./styles/app-shell.css\";");
    expect(rootStyles).toContain("@import \"./styles/sidebar.css\";");
    expect(rootStyles).toContain("@import \"./styles/chat.css\";");
    expect(rootStyles).toContain("@import \"./styles/composer.css\";");
    expect(rootStyles).toContain("@import \"./styles/cards.css\";");
    expect(rootStyles).toContain("@import \"./styles/responsive.css\";");
    // Color tokens
    expect(styles).toContain("--bg-root");
    expect(styles).toContain("--bg-page");
    expect(styles).toContain("--bg-surface");
    expect(styles).toContain("--text-primary");
    expect(styles).toContain("--text-secondary");
    expect(styles).toContain("--border-default");
    // Accent
    expect(styles).toContain("--bg-accent");
    expect(styles).toContain("--text-accent");
    // Status
    expect(styles).toContain("--status-success-text");
    expect(styles).toContain("--status-error-bg");
    // Spacing
    expect(styles).toContain("--space-4");
    expect(styles).toContain("--space-6");
    // Typography
    expect(styles).toContain("--text-xs");
    expect(styles).toContain("--text-lg");
    expect(styles).toContain("--font-sans");
    expect(styles).toContain("--font-mono");
    // Radius
    expect(styles).toContain("--radius-md");
    expect(styles).toContain("--radius-xl");
    // Shadows
    expect(styles).toContain("--shadow-sm");
    expect(styles).toContain("--shadow-md");
    // Navigation
    expect(styles).toContain("--nav-rail-width");
    expect(styles).toContain("--nav-item-text");
    // Dark theme
    expect(styles).toContain("prefers-color-scheme: dark");
  });

  it("uses app shell and navigation classes in the app frame", () => {
    expect(appSource).toContain("app-shell");
    expect(appSource).toContain("workspace-sidebar");
    expect(appSource).toContain("new-chat-button");
    expect(appSource).toContain("sidebar-section");
    expect(appSource).toContain("sidebar-recents");
    expect(appSource).not.toContain("nav-resize-handle");
    expect(appSource).not.toContain("aria-label=\"调整功能导航栏宽度\"");
    expect(appSource).toContain("material-brand"); // brand component class
    expect(appSource).toContain("material-nav-icon"); // icon wrapper class
    expect(appSource).toContain("workspace");
    expect(appSource).toContain("topbar");
  });

  it("renders a command-center chat shell with a workspace sidebar", () => {
    expect(appSource).toContain("listChatSessions");
    expect(appSource).toContain("selectedChatSessionId");
    expect(appSource).toContain("newChatRequestKey");
    expect(appSource).toContain("onChatSessionsChange");
    expect(appSource).toContain("onSelectChatSession");
    expect(styles).toContain("--nav-rail-width: 280px;");
    expect(styles).toContain(".workspace-sidebar");
    expect(styles).toContain(".new-chat-button");
    expect(styles).toContain(".sidebar-session-item");
  });

  it("supports @skill selection from the chat composer", () => {
    expect(chatPanelSource).toContain("extractActiveSkillMention");
    expect(chatPanelSource).toContain("matchSkillMentionCandidates");
    expect(chatPanelSource).toContain("selectedSkillName");
    expect(chatPanelSource).toContain("skill-mention-menu");
    expect(chatPanelSource).toContain("selected-skill-chip");
    expect(styles).toContain(".skill-mention-menu");
    expect(styles).toContain(".selected-skill-chip");
  });

  it("surfaces workspace selection in the chat composer", () => {
    expect(chatPanelSource).toContain("listAgentWorkspaces");
    expect(chatPanelSource).toContain("selectedWorkspaceId");
    expect(chatPanelSource).toContain("workspaceId: selectedWorkspaceId");
    expect(chatPanelSource).toContain("composer-context-row");
    expect(chatPanelSource).toContain("workspace-picker");
    expect(styles).toContain(".composer-context-row");
    expect(styles).toContain(".workspace-picker");
  });

  it("uses the shared local Icon component for primary controls", () => {
    const iconSource = readFileSync(
      path.join(process.cwd(), "src/renderer/components/Icon.tsx"),
      "utf8",
    );
    expect(iconSource).toContain("export function Icon");
    expect(chatPanelSource).toContain("<Icon name=\"send\"");
    expect(chatPanelSource).toContain("<Icon name=\"stop\"");
    expect(chatPanelSource).toContain("<Icon name=\"command\"");
    expect(appSource).toContain("<Icon name=\"plus\"");
    expect(appSource).not.toContain("＋");
    expect(chatPanelSource).not.toContain("×");
  });

  it("surfaces managed chat history with archive, delete, time and token metadata", () => {
    expect(appSource).toContain("archiveChatSession");
    expect(appSource).toContain("restoreChatSession");
    expect(appSource).toContain("deleteChatSession");
    expect(appSource).toContain("sidebar-archive-group");
    expect(appSource).toContain("sidebar-session-actions");
    expect(appSource).toContain("sidebar-session-meta");
    expect(appSource).toContain("formatSessionRelativeTime");
    expect(appSource).toContain("formatTokenUsage");
    expect(styles).toContain(".sidebar-archive-group");
    expect(styles).toContain(".sidebar-session-actions");
    expect(styles).toContain(".sidebar-session-menu");
    expect(styles).toContain(".sidebar-session-token");
  });

  it("keeps a draggable window strip visible on the chat-first desktop shell", () => {
    expect(appSource).toContain("window-drag-strip");
    expect(styles).toContain(".window-drag-strip");
    expect(styles).toContain("-webkit-app-region: drag");
    expect(styles).toContain(".window-drag-strip button");
    expect(styles).toContain("-webkit-app-region: no-drag");
  });

  it("renders the sidebar version from runtime metadata instead of a hardcoded value", () => {
    expect(appSource).not.toContain("v1.0.0");
    expect(appSource).toContain("getRuntimeInfo");
    expect(appSource).toContain("appVersion");
  });

  it("surfaces the local harness score in Overview", () => {
    expect(overviewPanelSource).toContain("computeHarnessScore");
    expect(overviewPanelSource).toContain("Harness");
    expect(overviewPanelSource).toContain("ETCLOVG 七类");
  });

  it("surfaces the agent capability score in Overview", () => {
    expect(overviewPanelSource).toContain("computeAgentCapabilityScore");
    expect(overviewPanelSource).toContain("Agent Capability");
    expect(overviewPanelSource).toContain("native tools");
  });

  it("surfaces child handoff review gates in Runs", () => {
    expect(runsPanelSource).toContain("summarizeHandoffReviewCards");
    expect(runsPanelSource).toContain("handoff-review-card");
    expect(runsPanelSource).toContain("Handoff Review");
    expect(styles).toContain(".handoff-review-card");
  });

  it("surfaces runtime recovery and compaction insights in Run trajectories", () => {
    expect(runTrajectoryPanelSource).toContain("summarizeTrajectoryInsights");
    expect(runTrajectoryPanelSource).toContain("trajectory-insight");
    expect(runTrajectoryPanelSource).toContain("trajectory-insight-list");
    expect(styles).toContain(".trajectory-insight");
    expect(styles).toContain(".trajectory-insight-list");
  });

  it("surfaces kernel event bridge and long-task timeline cards in Runs", () => {
    expect(preloadSource).toContain("KERNEL_IPC");
    expect(preloadSource).toContain("onKernelEvent");
    expect(preloadSource).toContain("resumeKernelRun");
    expect(runsPanelSource).toContain("summarizeKernelEventForTimeline");
    expect(runsPanelSource).toContain("kernel-event-card");
    expect(runsPanelSource).toContain("Kernel Events");
    expect(styles).toContain(".kernel-event-list");
    expect(styles).toContain(".kernel-event-card");
  });

  it("refreshes Runs from run lifecycle events instead of relying only on kernel details", () => {
    expect(preloadSource).toContain("onAgentRunsChanged");
    expect(runsPanelSource).toContain("refreshRunsSnapshot");
    expect(runsPanelSource).toContain("onAgentRunsChanged");
    expect(runsPanelSource).toContain("window.buildingAgent.listAgentRuns()");
    expect(runsPanelSource).toContain(
      "window.buildingAgent.listActiveAgentExecutions()",
    );
    expect(runsPanelSource).toContain("onKernelEvent");
    expect(runsPanelSource).toContain("appendKernelEvent");
  });

  it("surfaces evidence-backed Run Graph gates in Runs", () => {
    expect(runsPanelSource).toContain("projectRunGraph");
    expect(runsPanelSource).toContain("Run Graph");
    expect(runsPanelSource).toContain("run-graph-summary");
    expect(runsPanelSource).toContain("run-graph-gate");
    expect(runsPanelSource).toContain("translateRunGraphGateKind");
    expect(styles).toContain(".run-graph-summary");
    expect(styles).toContain(".run-graph-gate");
  });

  it("surfaces eval candidate generation from terminal Runs", () => {
    expect(runsPanelSource).toContain("Eval Candidate");
    expect(runsPanelSource).toContain("generateEvalCandidateForRun");
  });

  it("surfaces eval candidate review and promotion controls", () => {
    expect(existsSync(evalReviewPanelPath)).toBe(true);

    expect(evalReviewPanelSource).toContain("listEvalCandidates");
    expect(evalReviewPanelSource).toContain("promoteEvalCandidate");
  });

  it("renders technical surfaces as collapsed Settings secondary sections", () => {
    expect(appSource).toContain("SettingsSectionShell");
    expect(appSource).toContain("getSettingsNavigationSections");
    expect(appSource).toContain("ToolsPanel");
    expect(appSource).toContain("MemoryPanel");
    expect(appSource).toContain("LearningReviewPanel");
    expect(appSource).toContain("EvalReviewPanel");
    expect(appSource).not.toContain("activeSection.id === \"skills\"");
    expect(appSource).not.toContain("activeSection.id === \"tools\"");
    expect(appSource).not.toContain("activeSection.id === \"memory\"");
    expect(appSource).not.toContain("activeSection.id === \"learning\"");
    expect(appSource).not.toContain("activeSection.id === \"evals\"");
    expect(styles).toContain(".settings-section-shell");
    expect(styles).toContain(".settings-section-nav");
    expect(styles).toContain(".settings-section-body");
  });

  it("moves Overview diagnostics into the Settings system section", () => {
    expect(appSource).toMatch(
      /props\.activeSectionId === "system-overview"[\s\S]*<OverviewPanel onNavigate={navigateTo} \/>/,
    );
    expect(appSource).not.toContain("activeSection.id === \"overview\"");
  });

  it("keeps composer command actions inside the chat input", () => {
    expect(chatPanelSource).not.toContain("onClick={() => onNavigate(\"tools\")}");
    expect(chatPanelSource).toContain("aria-label=\"打开命令菜单\"");
    expect(chatPanelSource).toContain("className=\"composer-icon-button composer-command-button\"");
    expect(chatPanelSource).toContain("const composerCommandItems");
    expect(chatPanelSource).toContain("id: \"goal\"");
    expect(chatPanelSource).toContain("comingSoon: true");
    expect(chatPanelSource).toContain("handleOpenCommandMenu");
    expect(chatPanelSource).toContain("handleSelectComposerCommand(command.id)");
    expect(chatPanelSource).toContain("createGoalCommandDraft(draft)");
    expect(styles).toContain(".composer-icon");
    expect(styles).toContain(".composer-icon path");
    expect(styles).toContain("--composer-action-inset: 14px;");
    expect(styles).toContain("right: var(--composer-action-inset);");
    expect(styles).toContain("bottom: var(--composer-action-inset);");
  });

  it("keeps Goal Mode inside Chat instead of a standalone page", () => {
    expect(appSource).not.toContain("activeSection.id === \"goals\"");
    expect(appSource).not.toContain("<GoalPanel");
    expect(overviewPanelSource).toContain("listActiveGoals");
    expect(overviewPanelSource).toContain("goalsWaitingForReview");
    expect(overviewPanelSource).toContain("target: \"chat\"");
    expect(overviewPanelSource).not.toContain("target: \"goals\"");
  });

  it("surfaces session-native Goal Mode inside Chat", () => {
    expect(chatPanelSource).toContain("GoalStatusStrip");
    expect(chatPanelSource).toContain("activeGoal");
    expect(appSource).toContain("goal-session-badge");
    expect(chatPanelSource).toContain("GoalDetailDrawer");
    expect(chatPanelSource).toContain("handleViewGoalProgress");
    expect(chatPanelSource).toContain("handleStartGoal");
    expect(chatPanelSource).toContain("refreshSessions(sessionIdToLoad)");
    expect(chatPanelSource).toContain("slash-command-menu");
    expect(chatPanelSource).toContain("handleSelectComposerCommand(\"goal\")");
    expect(goalStatusStripSource).toContain("buildGoalProgressViewModel");
    expect(goalStatusStripSource).toContain("progress.statusLabel");
    expect(goalStatusStripSource).toContain("onResolveReview");
    expect(goalDetailDrawerSource).toContain("goal-progress-status");
    expect(goalDetailDrawerSource).toContain("goal-progress-next");
    expect(goalDetailDrawerSource).toContain("goal-progress-metrics");
    expect(goalDetailDrawerSource).toContain("progress.milestoneRows");
    expect(styles).toContain(".goal-contract-bar");
    expect(styles).toContain(".goal-session-badge");
    expect(styles).toContain(".goal-detail-drawer");
    expect(styles).toContain(".goal-progress-status");
    expect(styles).toContain(".goal-progress-next");
    expect(styles).toContain(".goal-progress-metrics");
    expect(styles).toContain(".slash-command-menu");
  });

  it("keeps goal progress synced even before the active goal summary refreshes", () => {
    expect(chatPanelSource).toContain("const eventBelongsToActiveGoal");
    expect(chatPanelSource).toContain("event.sessionId === activeSessionId");
    expect(chatPanelSource).toContain("void refreshActiveGoalDetail(event.goalId)");
  });

  it("accepts empty desktop chat session lists as real state", () => {
    const refreshSessionsSource = getFunctionSource(
      chatPanelSource,
      "refreshSessions",
    );

    expect(refreshSessionsSource).toContain(
      "const nextSessions = loadedSessions.map(toSessionRailItem);",
    );
    expect(refreshSessionsSource).toContain("setSessions(nextSessions);");
    expect(refreshSessionsSource).toContain("onChatSessionsChange?.(nextSessions);");
    expect(refreshSessionsSource).not.toContain("if (loadedSessions.length)");
  });

  it("reloads the active chat transcript when a background goal reaches a terminal state", () => {
    expect(chatPanelSource).toContain("function isTerminalGoalStatus");
    expect(chatPanelSource).toContain("async function refreshCurrentSessionMessages");
    expect(chatPanelSource).toContain("isTerminalGoalStatus(event.status)");
    expect(chatPanelSource).toContain("void refreshCurrentSessionMessages(");
    expect(chatPanelSource).toContain("event.sessionId ?? activeSessionId ?? undefined");
  });

  it("starts Chat in a command-first empty home state", () => {
    expect(chatPanelSource).toContain("const initialMessages: ChatMessage[] = [];");
    expect(chatPanelSource).toContain("function AgentHomeHero");
    expect(chatPanelSource).toContain("messages.length === 0");
    expect(chatPanelSource).toContain("agent-home-hero");
    expect(chatPanelSource).toContain("onPickPrompt");
    expect(chatPanelSource).toContain("今天想让智能体做什么？");
    expect(styles).toContain(".agent-home-hero");
    expect(styles).toContain(".home-suggestions");
  });

  it("shows the right context panel only when active work needs it", () => {
    expect(chatPanelSource).toContain("const showContextPanel");
    expect(chatPanelSource).toContain("has-context-panel");
    expect(chatPanelSource).toContain("is-focus-mode");
    expect(chatPanelSource).toContain("{showContextPanel ? (");
    expect(chatPanelSource).not.toContain("<aside className=\"session-rail\"");
    expect(styles).toContain(".agent-chat-panel.is-focus-mode");
    expect(styles).toContain(".agent-chat-panel.has-context-panel");
    expect(styles).toContain(".agent-context-panel");
    expect(styles).toContain("padding: 28px;");
  });

  it("moves active work status into the right context rail instead of a large composer strip", () => {
    expect(chatPanelSource).toContain("ContextActivityCard");
    expect(chatPanelSource).not.toContain("<TaskActivityStrip");
    expect(chatPanelSource).not.toContain("function TaskActivityStrip");
    expect(styles).toContain(".context-activity-card");
    expect(styles).toContain(".context-activity-pill");
  });

  it("contains long chat titles and live status text inside the hero header", () => {
    expect(chatPanelSource).toContain("const chatTitle = activeSession?.title ?? \"新会话\";");
    expect(chatPanelSource).toContain("title={chatTitle}");
    expect(chatPanelSource).toContain("title={status.message}");
    expect(chatPanelSource).toContain("const chatStatusIsLong");
    expect(chatPanelSource).toContain("aria-expanded={chatStatusIsLong ? chatStatusExpanded : undefined}");
    expect(chatPanelSource).toContain("setChatStatusExpanded((expanded) => !expanded)");
    expect(styles).toContain(".chat-hero h2");
    expect(styles).toContain("-webkit-line-clamp: 2;");
    expect(styles).toContain(".chat-state > span");
    expect(styles).toContain(".chat-state.is-expanded");
    expect(styles).toContain("max-width: min(420px, 42vw);");
    expect(styles).toContain("text-overflow: ellipsis;");
  });

  it("loads pending eval candidates into the Overview capability score", () => {
    expect(overviewPanelSource).not.toContain("pendingEvalCandidates: 0");
    expect(overviewPanelSource).toContain("listEvalCandidates({");
  });

  it("keeps eval candidate review mutations recoverable on preload rejection", () => {
    const setCandidateStatusSource = getFunctionSource(
      evalReviewPanelSource,
      "setCandidateStatus",
    );
    const promoteCandidateSource = getFunctionSource(
      evalReviewPanelSource,
      "promoteCandidate",
    );

    expect(setCandidateStatusSource).toContain("catch (error)");
    expect(setCandidateStatusSource).toContain("kind: \"error\"");
    expect(promoteCandidateSource).toContain("catch (error)");
    expect(promoteCandidateSource).toContain("kind: \"error\"");
  });

  it("keeps run eval candidate generation recoverable on preload rejection", () => {
    const generateCandidateSource = getFunctionSource(
      runsPanelSource,
      "handleGenerateEvalCandidateForSelectedRun",
    );

    expect(generateCandidateSource).toContain("catch (error)");
    expect(generateCandidateSource).toContain("kind: \"error\"");
  });

  it("lets Overview load when pending eval candidate loading fails", () => {
    expect(overviewPanelSource).toMatch(
      /listEvalCandidates\(\{\s*status: "pending_review",\s*\}\)\.catch\(\(\) => \[\]\)/s,
    );
  });

  it("provides reusable component classes for all screens", () => {
    // Buttons
    expect(styles).toContain(".primary-action");
    expect(styles).toContain(".secondary-action");
    expect(styles).toContain(".danger-action");
    // Cards
    expect(styles).toContain(".module-card");
    expect(styles).toContain(".health-card");
    expect(styles).toContain(".skill-card");
    // Field inputs
    expect(styles).toContain(".field input");
    expect(styles).toContain(".field-grid");
    // Chips & badges
    expect(styles).toContain(".status-pill");
    expect(styles).toContain(".memory-tags");
    // Chat
    expect(styles).toContain(".agent-chat-panel");
    expect(styles).toContain("--context-panel-width");
    expect(styles).toContain(".agent-chat-panel.is-focus-mode");
    expect(styles).toContain(".agent-chat-panel.has-context-panel");
    expect(styles).not.toContain("grid-template-columns: var(--session-rail-width) minmax(520px, 1fr) var(--context-panel-width)");
    expect(styles).toContain(".kimi-side-card");
    expect(styles).toContain(".chat-message");
    expect(styles).toContain(".composer");
    expect(styles).toContain(".composer-input-shell");
    expect(styles).toContain(".composer-floating-actions");
    expect(styles).toContain(".composer-icon-button");
    expect(styles).toContain(".composer-icon");
    expect(styles).toContain("--composer-action-size: 32px;");
    expect(styles).toContain("width: var(--composer-action-size); height: var(--composer-action-size);");
    expect(styles).toContain(".chat-hero {");
    expect(styles).toContain(".message-list {");
    expect(styles).toContain("border: none; background: transparent");
    expect(styles).toContain("max-height: min(220px, 34vh)");
    expect(styles).toContain("overflow-y: auto");
    expect(styles).toContain(".markdown-message");
    // Responsive
    expect(styles).toContain("@media");
  });

  it("keeps chatbox actions icon-only and stop available while work is running", () => {
    expect(chatPanelSource).toContain("aria-label=\"打开命令菜单\"");
    expect(chatPanelSource).toContain("aria-label=\"中断当前任务\"");
    expect(chatPanelSource).toContain("aria-label=\"发送消息\"");
    expect(chatPanelSource).toContain("className=\"composer-floating-actions\"");
    expect(chatPanelSource).toContain("disabled={!canInterruptCurrentWork}");
    expect(chatPanelSource).toContain(
      "handleInterruptCurrentWork",
    );
    expect(chatPanelSource).toContain("activeGoal.status === \"executing\"");
    expect(chatPanelSource).toContain("cancelGoal(activeGoal.id)");
    expect(chatPanelSource).toContain("applyGoalSummaryToSessions(result.goal)");
    expect(chatPanelSource).not.toContain(
      "disabled={status.kind !== \"working\" || !activeChatRequestId}",
    );
  });

  it("keeps tool approval inside chat with an auto-authorization toggle and critical risk styling", () => {
    expect(chatPanelSource).toContain("autoApprovalEnabled");
    expect(chatPanelSource).toContain("setToolAutoApprovalEnabled");
    expect(chatPanelSource).toContain("onToolApprovalRequest");
    expect(chatPanelSource).toContain("tool-approval-panel");
    expect(chatPanelSource).toContain("aria-label=\"自动授权工具请求\"");
    expect(chatPanelSource).toContain("resolveToolApproval");
    expect(chatPanelSource).toContain("is-critical-risk");
    expect(styles).toContain(".tool-approval-panel");
    expect(styles).toContain(".auto-approval-toggle");
    expect(styles).toContain(".is-critical-risk");
    expect(styles).toContain("var(--status-error-text)");
  });

  it("keeps goal execution UI compact when long milestone text is active", () => {
    const handleStartGoalSource = getFunctionSource(
      chatPanelSource,
      "handleStartGoal",
    );

    expect(handleStartGoalSource).toContain("setGoalDrawerOpen(false)");
    expect(goalDetailDrawerSource).toContain("goal-detail-drawer-backdrop");
    expect(styles).toContain(".goal-detail-drawer-backdrop");
    expect(styles).toContain(
      "grid-template-columns: minmax(0, 0.9fr) minmax(320px, 1.1fr);",
    );
    expect(styles).toContain("-webkit-line-clamp: 2;");
    expect(styles).toContain(".agent-work-steps { min-width: 0;");
  });

  it("subscribes to chat stream events and renders separated streaming transcript state", () => {
    expect(chatPanelSource).toContain("onChatStreamEvent");
    expect(chatPanelSource).toContain("applyChatStreamEvent");
    expect(chatPanelSource).toContain("finalizeChatStreamResult");
    expect(chatPanelSource).toContain("thinking-process-block");
    expect(chatPanelSource).toContain("tool-call-preview-block");
    expect(styles).toContain(".thinking-process-block");
    expect(styles).toContain(".tool-call-preview-block");
  });

  it("renders guided skill input in the main chat surface with all required controls", () => {
    expect(chatPanelSource).toContain("guided-skill-input-form");
    expect(chatPanelSource).toContain("pendingInputRequest");
    expect(chatPanelSource).toContain("respondSkillInput");
    expect(chatPanelSource).toContain("renderGuidedSkillInputControl");
    expect(chatPanelSource).toContain('field.type === "string"');
    expect(chatPanelSource).toContain('field.type === "path"');
    expect(chatPanelSource).toContain('field.type === "number"');
    expect(chatPanelSource).toContain('field.type === "boolean"');
    expect(chatPanelSource).toContain('field.type === "choice"');
    expect(styles).toContain(".guided-skill-input-form");
    expect(styles).toContain(".guided-skill-input-grid");
  });

  it("provides accessible collapse affordances for long message and process surfaces", () => {
    expect(chatPanelSource).toContain("chat-message-collapse");
    expect(chatPanelSource).toContain("aria-expanded={expanded}");
    expect(chatPanelSource).toContain("shouldCollapseMarkdownBlock");
    expect(styles).toContain(".chat-message-collapse");
    expect(styles).toContain("overflow-wrap: anywhere;");
  });

  it("keeps guided input reachable when the right context rail is hidden", () => {
    expect(chatPanelSource).toContain("GuidedSkillInputForm");
    expect(chatPanelSource).toMatch(
      /<GuidedSkillInputForm[\s\S]*pendingInputRequest/,
    );
    expect(styles).toContain("@media (max-width: 1180px)");
    expect(styles).toContain(".agent-context-panel { display: none; }");
    expect(styles).toContain(".guided-skill-input-form");
  });

  it("clears all active stream refs during new chat reset so stale events cannot repopulate the transcript", () => {
    const newChatResetSource = getUseEffectSource(
      chatPanelSource,
      "newChatRequestKey",
    );

    expect(newChatResetSource).toContain("resetActiveChatRefs()");
    expect(newChatResetSource).toContain(
      "setChatStreamState(createChatStreamState(initialMessages))",
    );
    expect(chatPanelSource).toContain("function resetActiveChatRefs");
    expect(chatPanelSource).toContain("activeStatusSessionIdRef.current = null");
    expect(chatPanelSource).toContain("activeChatRequestIdRef.current = null");
    expect(chatPanelSource).toContain("pendingInputRequestRef.current = null");
  });
});

function getFunctionSource(source: string, functionName: string): string {
  const markers = [`async function ${functionName}`, `function ${functionName}`];
  const startIndex = markers.reduce((found, marker) => {
    if (found !== -1) {
      return found;
    }
    return source.indexOf(marker);
  }, -1);
  if (startIndex === -1) {
    return "";
  }

  const bodyStartIndex = source.indexOf("{", startIndex);
  if (bodyStartIndex === -1) {
    return source.slice(startIndex);
  }

  let depth = 0;
  for (let index = bodyStartIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex, index + 1);
      }
    }
  }

  return source.slice(startIndex);
}

function getUseEffectSource(source: string, dependencyName: string): string {
  const dependencyMarker = `}, [${dependencyName}]);`;
  const endIndex = source.indexOf(dependencyMarker);
  if (endIndex === -1) {
    return "";
  }

  const searchStart = Math.max(0, endIndex - 900);
  const effectStartIndex = source.lastIndexOf("useEffect(() => {", endIndex);
  if (effectStartIndex === -1 || effectStartIndex < searchStart) {
    return "";
  }

  return source.slice(effectStartIndex, endIndex + dependencyMarker.length);
}
