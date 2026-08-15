import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Design System — Obsidian desktop control surface", () => {
  const rootStyles = readFileSync(path.join(process.cwd(), "src/renderer/styles.css"), "utf8");
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
  const appSource = readFileSync(path.join(process.cwd(), "src/renderer/App.tsx"), "utf8");
  const rendererMainSource = readFileSync(
    path.join(process.cwd(), "src/renderer/main.tsx"),
    "utf8",
  );
  const rendererErrorBoundarySource = readFileSync(
    path.join(
      process.cwd(),
      "src/renderer/components/RendererErrorBoundary.tsx",
    ),
    "utf8",
  );
  const preloadSource = readFileSync(path.join(process.cwd(), "src/preload/index.ts"), "utf8");
  const chatPanelSource = readFileSync(
    path.join(process.cwd(), "src/renderer/components/AgentChatPanel.tsx"),
    "utf8",
  );
  const modelSettingsPanelSource = readFileSync(
    path.join(process.cwd(), "src/renderer/components/ModelSettingsPanel.tsx"),
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
  const dialogFocusTrapSource = readFileSync(
    path.join(
      process.cwd(),
      "src/renderer/components/useDialogFocusTrap.ts",
    ),
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
  const scheduledTasksPanelSource = readFileSync(
    path.join(process.cwd(), "src/renderer/components/ScheduledTasksPanel.tsx"),
    "utf8",
  );
  const memoryPanelSource = readFileSync(
    path.join(process.cwd(), "src/renderer/components/MemoryPanel.tsx"),
    "utf8",
  );
  const runTrajectoryPanelSource = readFileSync(
    path.join(process.cwd(), "src/renderer/components/RunTrajectoryPanel.tsx"),
    "utf8",
  );
  const designArtifactSource = readFileSync(
    path.join(process.cwd(), "docs/design/zerox-agent-2-7-0-ui-artifact.html"),
    "utf8",
  );
  const outputRenderingArtifactPath = path.join(
    process.cwd(),
    "docs/design/zerox-agent-2-9-0-output-rendering-artifact.html",
  );
  const outputRenderingArtifactSource = existsSync(outputRenderingArtifactPath)
    ? readFileSync(outputRenderingArtifactPath, "utf8")
    : "";
  const uiUxDesignSystemPath = path.join(
    process.cwd(),
    "docs/design/zerox-agent-3-2-1-ui-ux-design-system.md",
  );
  const uiUxDesignSystemSource = existsSync(uiUxDesignSystemPath)
    ? readFileSync(uiUxDesignSystemPath, "utf8")
    : "";
  const visualSystemSpecPath = path.join(
    process.cwd(),
    "docs/design/zerox-agent-3-2-2-design-system-spec.md",
  );
  const visualSystemSpecSource = existsSync(visualSystemSpecPath)
    ? readFileSync(visualSystemSpecPath, "utf8")
    : "";
  const guideline0708Path = path.join(process.cwd(), "docs/design/guidelines_0708.html");
  const guideline0708Source = existsSync(guideline0708Path)
    ? readFileSync(guideline0708Path, "utf8")
    : "";
  const evalReviewPanelPath = path.join(
    process.cwd(),
    "src/renderer/components/EvalReviewPanel.tsx",
  );
  const evalReviewPanelSource = existsSync(evalReviewPanelPath)
    ? readFileSync(evalReviewPanelPath, "utf8")
    : "";
  const chatOutputComponentDir = path.join(process.cwd(), "src/renderer/components/chat");
  const readChatOutputComponent = (fileName: string) => {
    const filePath = path.join(chatOutputComponentDir, fileName);
    return existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  };

  it("defines comprehensive CSS custom property design tokens", () => {
    expect(rootStyles).toContain('@import "./styles/tokens.css";');
    expect(rootStyles).toContain('@import "./styles/base.css";');
    expect(rootStyles).toContain('@import "./styles/app-shell.css";');
    expect(rootStyles).toContain('@import "./styles/sidebar.css";');
    expect(rootStyles).toContain('@import "./styles/chat.css";');
    expect(rootStyles).toContain('@import "./styles/composer.css";');
    expect(rootStyles).toContain('@import "./styles/cards.css";');
    expect(rootStyles).toContain('@import "./styles/responsive.css";');
    // Color tokens
    expect(styles).toContain("--bg-root");
    expect(styles).toContain("--bg-page");
    expect(styles).toContain("--bg-surface");
    expect(styles).toContain("--glass-surface");
    expect(styles).toContain("--glass-surface-strong");
    expect(styles).toContain("--glass-sidebar");
    expect(styles).toContain("--glass-blur");
    expect(styles).toContain("--brand-primary");
    expect(styles).toContain("--brand-accent");
    expect(styles).toContain("--focus-ring");
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
    expect(appSource).not.toContain('aria-label="调整功能导航栏宽度"');
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
    expect(styles).toContain("--nav-rail-width: 232px;");
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
    expect(chatPanelSource.indexOf("selected-skill-chip")).toBeGreaterThan(
      chatPanelSource.indexOf("workspace-context-path"),
    );
    expect(chatPanelSource.indexOf("selected-skill-chip")).toBeLessThan(
      chatPanelSource.indexOf("skill-mention-menu"),
    );
    expect(styles).toContain(".skill-mention-menu");
    expect(styles).toContain(".selected-skill-chip");
    expect(styles).toContain("height: var(--composer-action-size);");
    expect(styles).toContain("bottom: var(--composer-action-inset);");
  });

  it("lets modifier Enter insert composer newlines while bare Enter submits", () => {
    expect(chatPanelSource).toContain('event.key === "Enter" && !event.shiftKey && !event.altKey');
    expect(chatPanelSource).toContain("Shift+Enter 或 Option+Enter 换行");
    expect(chatPanelSource).toContain("const content = rawContent;");
    expect(chatPanelSource).toContain("if (!content.trim())");
  });

  it("surfaces workspace selection in the chat composer", () => {
    expect(chatPanelSource).toContain("listAgentWorkspaces");
    expect(chatPanelSource).toContain("selectedWorkspaceId");
    expect(chatPanelSource).toContain("workspaceId: selectedWorkspaceId");
    expect(chatPanelSource).toContain("openProjectAgentWorkspace");
    expect(chatPanelSource).toContain("openProjectAgentWorkspace({");
    expect(chatPanelSource).toContain('mode: "create"');
    expect(chatPanelSource).not.toContain("createTemporaryAgentWorkspace({");
    expect(chatPanelSource).toContain("workspace-menu");
    expect(chatPanelSource).toContain("workspaceSearch");
    expect(chatPanelSource).toContain("历史工作区");
    expect(chatPanelSource).toContain("打开已有目录");
    expect(chatPanelSource).toContain("新建工作区");
    expect(chatPanelSource).toContain("选择或新建本地项目文件夹");
    expect(chatPanelSource).toContain("默认工作区");
    expect(chatPanelSource).toContain("composer-context-row");
    expect(chatPanelSource).toContain("workspace-picker");
    expect(chatPanelSource).not.toContain("workspace-action-buttons");
    expect(chatPanelSource).not.toContain("workspace-action-button");
    expect(styles).toContain(".composer-context-row");
    expect(styles).toContain(".workspace-picker");
    expect(styles).toContain(".workspace-menu");
    expect(styles).toContain("grid-template-rows: auto minmax(0, 1fr) auto;");
    expect(styles).toContain("--workspace-menu-safe-width");
    expect(styles).toContain("--workspace-menu-safe-height");
    expect(styles).toContain("max-height: var(--workspace-menu-safe-height);");
    expect(styles).toContain("overflow: hidden;");
    expect(styles).toContain("min-height: 0;");
    expect(styles).toContain(".composer-context-row");
    expect(styles).toContain("flex-wrap: wrap;");
    expect(styles).toContain("padding-top: 78px;");
    expect(styles).not.toContain(".workspace-action-buttons");
  });

  it("keeps workspace menus viewport anchored and internally scrollable", () => {
    expect(chatPanelSource).toContain("workspaceMenuPosition");
    expect(chatPanelSource).toContain("measureWorkspaceMenuPosition");
    expect(chatPanelSource).toContain("workspaceMenuStyle");
    expect(chatPanelSource).toContain("data-placement={workspaceMenuPosition.placement}");
    expect(styles).toContain("position: fixed;");
    expect(styles).toContain("top: clamp(");
    expect(styles).toContain("left: clamp(");
    expect(styles).toContain("max-height: var(--workspace-menu-safe-height);");
    expect(styles).toContain("overscroll-behavior: contain;");
    expect(styles).toContain("@media (max-height: 720px)");
  });

  it("keeps runtime process surfaces in a responsive scroll region above a pinned composer", () => {
    expect(chatPanelSource).toContain("chat-scroll-region");
    expect(chatPanelSource).toContain("runtime-surface-stack");
    expect(chatPanelSource.indexOf("chat-scroll-region")).toBeLessThan(
      chatPanelSource.indexOf("runtime-surface-stack"),
    );
    expect(chatPanelSource.indexOf("runtime-surface-stack")).toBeLessThan(
      chatPanelSource.indexOf('className="composer"'),
    );
    expect(styles).toContain(".chat-scroll-region");
    expect(styles).toContain(".runtime-surface-stack");
    expect(styles).toContain("flex: 0 0 auto;");
    expect(styles).toContain("min-height: clamp(104px, 18dvh, 148px);");
    expect(styles).toContain("max-height: min(34vh, 260px);");
  });

  it("keeps transcript history readable during active streaming", () => {
    expect(chatPanelSource).toContain("shouldStickToLatestMessageRef");
    expect(chatPanelSource).toContain("handleMessageListScroll");
    expect(chatPanelSource).toContain("isNearMessageListBottom");
    expect(chatPanelSource).toContain("onScroll={handleMessageListScroll}");
    expect(chatPanelSource).toContain("appendBoundedRuntimeEvent");
    expect(chatPanelSource).toContain("MAX_RENDERED_RUNTIME_EVENTS");
  });

  it("uses the shared local Icon component for primary controls", () => {
    const iconSource = readFileSync(
      path.join(process.cwd(), "src/renderer/components/Icon.tsx"),
      "utf8",
    );
    expect(iconSource).toContain("export function Icon");
    expect(chatPanelSource).toContain('<Icon name="send"');
    expect(chatPanelSource).toContain('<Icon name="stop"');
    expect(chatPanelSource).toContain('<Icon name="close"');
    expect(appSource).toContain('<Icon name="plus"');
    expect(appSource).toContain('<Icon name="more"');
    expect(appSource).not.toContain("＋");
    expect(chatPanelSource).not.toContain("×");
  });

  it("presents the local icon system in the 2.7.0 design artifact", () => {
    expect(designArtifactSource).toContain('class="artifact-icon sidebar-button-icon"');
    expect(designArtifactSource).toContain('class="artifact-icon icon-button-icon"');
    expect(designArtifactSource).toContain('stroke="currentColor"');
    expect(designArtifactSource).not.toContain("+ New Chat");
    expect(designArtifactSource).not.toContain(">Cmd<");
    expect(designArtifactSource).not.toContain(">Stop<");
    expect(designArtifactSource).not.toContain(">Send<");
  });

  it("surfaces managed chat history with archive, delete, time and token metadata", () => {
    expect(appSource).toContain("archiveChatSession");
    expect(appSource).toContain("restoreChatSession");
    expect(appSource).toContain("renameChatSession");
    expect(appSource).toContain("重命名");
    expect(appSource).toContain("RenameChatSessionDialog");
    expect(appSource).toContain("session-rename-dialog");
    expect(appSource).not.toContain("window.prompt");
    expect(appSource).toContain("activeChatSessionTitle");
    expect(appSource).toContain("deleteChatSession");
    expect(appSource).toContain("sidebar-archive-group");
    expect(appSource).toContain("sidebar-session-actions");
    expect(appSource).toContain("sidebar-session-meta");
    expect(appSource).toContain("formatSessionRelativeTime");
    expect(appSource).toContain("formatTokenUsage");
    expect(styles).toContain(".sidebar-archive-group");
    expect(styles).toContain(".sidebar-session-actions");
    expect(styles).toContain(".sidebar-session-menu");
    expect(styles).toContain(".session-rename-backdrop");
    expect(styles).toContain(".session-rename-dialog");
    expect(styles).toContain(".sidebar-session-token");
  });

  it("renders chat messages with structured readable metadata and polished markdown blocks", () => {
    expect(chatPanelSource).toContain("formatChatMessageTime");
    expect(chatPanelSource).toContain("messageTimeTick");
    expect(chatPanelSource).toContain("dateTime={message.createdAt}");
    expect(chatPanelSource).not.toContain('createdAt: "刚刚"');
    expect(chatPanelSource).toContain("chat-message-meta");
    expect(chatPanelSource).toContain("markdown-code-block");
    expect(chatPanelSource).toContain("markdown-code-header");
    expect(chatPanelSource).toContain('target="_blank"');
    expect(styles).toContain(".chat-message-meta");
    expect(styles).toContain(".chat-message-meta span");
    expect(styles).toContain(".markdown-code-block");
    expect(styles).toContain(".markdown-code-header");
    expect(styles).toContain(".markdown-message span");
    expect(styles).toContain(".markdown-message strong");
    expect(styles).toContain(".markdown-message a");
    expect(styles).toContain("font-size: var(--text-base);");
    expect(styles).toContain("background: var(--code-bg);");
    expect(styles).toContain("border: 1px solid var(--code-border);");
  });

  it("renders v2.9.0 structured assistant output through dedicated React components", () => {
    const requiredComponentFiles = [
      "AnswerBlock.tsx",
      "OutputPartRenderer.tsx",
      "CodeBlockView.tsx",
      "DataTableView.tsx",
      "CommandOutputView.tsx",
      "JsonPreview.tsx",
      "RunLedgerView.tsx",
    ];

    for (const fileName of requiredComponentFiles) {
      expect(existsSync(path.join(chatOutputComponentDir, fileName))).toBe(true);
    }

    const answerBlockSource = readChatOutputComponent("AnswerBlock.tsx");
    const outputPartRendererSource = readChatOutputComponent("OutputPartRenderer.tsx");
    const rendererCases = [
      "text",
      "table",
      "code",
      "file_diff",
      "command_output",
      "tool_call",
      "tool_result",
      "file_ref",
      "artifact",
      "citation",
      "approval_request",
      "input_request",
      "diagnostic",
      "ledger_event",
    ];

    expect(chatPanelSource).toContain("import { AnswerBlock }");
    expect(chatPanelSource).toContain("outputPartsFromMessage");
    expect(chatPanelSource).toContain("visibleChatMessages");
    expect(chatPanelSource).toContain("shouldHideGoalEventReply");
    expect(chatPanelSource).toContain(
      "!isTerminalGoalStatus(result.activeGoal.status)",
    );
    expect(chatPanelSource).toContain("outputParts.length > 0");
    expect(chatPanelSource).toContain("<AnswerBlock parts={message.outputParts} />");
    expect(chatPanelSource).not.toContain("outputMarkdownFromMessage");
    expect(answerBlockSource).toContain("OutputPartRenderer");
    expect(answerBlockSource).not.toContain("EvidenceRail");
    expect(answerBlockSource).toContain("RenderedOutputPart");

    for (const rendererCase of rendererCases) {
      expect(outputPartRendererSource).toContain(`case "${rendererCase}"`);
    }
  });

  it("keeps structured output renderer class hooks stable for Task 5 visual polish", () => {
    const componentSources = [
      readChatOutputComponent("AnswerBlock.tsx"),
      readChatOutputComponent("CodeBlockView.tsx"),
      readChatOutputComponent("DataTableView.tsx"),
      readChatOutputComponent("CommandOutputView.tsx"),
      readChatOutputComponent("JsonPreview.tsx"),
      readChatOutputComponent("RunLedgerView.tsx"),
    ].join("\n");

    for (const className of [
      "chat-answer-block",
      "chat-output-part",
      "chat-code-block",
      "chat-code-header",
      "chat-data-table-wrap",
      "chat-data-table",
      "chat-command-output",
      "chat-command-stream",
      "chat-json-preview",
      "chat-run-ledger",
    ]) {
      expect(componentSources).toContain(className);
    }
  });

  it("covers v2.9 output rendering CSS hooks for approved visual styling", () => {
    const componentSources = [
      readChatOutputComponent("AnswerBlock.tsx"),
      readChatOutputComponent("CodeBlockView.tsx"),
      readChatOutputComponent("DataTableView.tsx"),
      readChatOutputComponent("CommandOutputView.tsx"),
      readChatOutputComponent("JsonPreview.tsx"),
      readChatOutputComponent("RunLedgerView.tsx"),
      readChatOutputComponent("OutputPartRenderer.tsx"),
    ].join("\n");

    const requiredClassHooks = [
      "chat-answer-block",
      "chat-answer-body",
      "chat-output-part-list",
      "chat-output-part",
      "chat-evidence-inline",
      "chat-data-table-wrap",
      "chat-data-table",
      "chat-code-block",
      "chat-code-header",
      "chat-diff-line-added",
      "chat-diff-line-removed",
      "chat-command-output",
      "chat-command-stream",
      "chat-json-preview",
      "chat-run-ledger",
      "chat-ledger-row",
      "chat-artifact-card",
      "chat-citation-chip",
      "chat-approval-block",
      "chat-input-request-block",
    ];

    for (const className of requiredClassHooks) {
      expect(componentSources).toContain(className);
      expect(styles).toContain(`.${className}`);
    }

    expect(styles).toContain("@media (max-width: 640px)");
    expect(styles).toMatch(/@media \(max-width: 640px\)[\s\S]*\.chat-answer-block/);
    expect(styles).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(styles).toContain("overflow-wrap: anywhere;");
    expect(styles).toContain("max-width: 100%;");
  });

  it("keeps assistant answers single-column with readable content widths", () => {
    const answerBlockSource = readChatOutputComponent("AnswerBlock.tsx");
    const runLedgerSource = readChatOutputComponent("RunLedgerView.tsx");

    expect(answerBlockSource).not.toContain("hasEvidence");
    expect(answerBlockSource).not.toContain("has-evidence");
    expect(answerBlockSource).not.toContain("isEvidencePart");
    expect(answerBlockSource).toContain("is-body-only");
    expect(styles).toMatch(
      /\.chat-answer-block\s*{[\s\S]*grid-template-columns: minmax\(0, 1fr\);/,
    );
    expect(styles).not.toMatch(/\.chat-answer-block\.has-evidence/);
    expect(styles).toMatch(/\.chat-message\s*{[\s\S]*width: min\(960px, 100%\);/);
    expect(styles).toMatch(/\.chat-answer-body\s*{[\s\S]*border-left: 0;/);
    expect(styles).toMatch(/\.chat-data-table\s*{[\s\S]*table-layout: fixed;/);
    expect(styles).toMatch(
      /\.chat-code-block pre,[\s\S]*\.chat-json-preview pre\s*{[\s\S]*white-space: pre-wrap;/,
    );

    expect(runLedgerSource).toContain("hasDetail");
    expect(runLedgerSource).toContain("hasTool");
    expect(runLedgerSource).toContain("is-title-only");
    expect(runLedgerSource).toContain("has-detail");
    expect(runLedgerSource).toContain("has-tool");
    expect(styles).toMatch(
      /\.chat-ledger-row\s*{[\s\S]*grid-template-columns: auto minmax\(0, 1fr\);/,
    );
    expect(styles).toContain(".chat-ledger-row.has-detail:not(.has-tool)");
    expect(styles).toContain(".chat-ledger-row.has-tool:not(.has-detail)");
    expect(styles).toContain(".chat-ledger-row.has-detail.has-tool");
  });

  it("keeps main transcript typography on one content scale", () => {
    expect(styles).toMatch(
      /\.chat-answer-block\s*{[\s\S]*--chat-output-font-size: var\(--text-base\);/,
    );
    expect(styles).toMatch(
      /\.chat-message p,[\s\S]*\.markdown-message\s*{[\s\S]*font-size: var\(--chat-output-font-size\);/,
    );
    expect(styles).toMatch(
      /\.markdown-message p,[\s\S]*\.markdown-message blockquote\s*{[\s\S]*font-size: inherit;[\s\S]*line-height: inherit;/,
    );
    expect(styles).toMatch(/\.markdown-message strong\s*{[\s\S]*font-size: inherit;/);
    expect(styles).toMatch(
      /\.markdown-message strong\s*{[\s\S]*background: var\(--chat-output-emphasis-bg\);/,
    );
    expect(styles).toMatch(
      /\.markdown-message :not\(pre\) > code\s*{[\s\S]*font-size: inherit;[\s\S]*line-height: inherit;/,
    );
    expect(chatPanelSource).toContain("markdown-table-wrap");
    expect(chatPanelSource).toContain("markdown-table");
    expect(styles).toMatch(
      /\.markdown-message table,[\s\S]*\.chat-data-table\s*{[\s\S]*font-size: var\(--chat-output-font-size\);/,
    );
    expect(styles).toMatch(
      /\.chat-data-table\s*{[\s\S]*font-size: var\(--chat-output-font-size\);/,
    );
    expect(styles).toMatch(
      /\.chat-data-table th,[\s\S]*\.chat-data-table td\s*{[\s\S]*font-size: inherit;[\s\S]*line-height: inherit;/,
    );
    expect(styles).toMatch(
      /\.chat-code-block pre,[\s\S]*\.chat-json-preview pre\s*{[\s\S]*font-size: var\(--chat-output-font-size\);/,
    );
    expect(styles).toMatch(
      /\.agent-context-panel \.task-process-list li\s*{[\s\S]*grid-template-columns: 48px 36px minmax\(0, 1fr\) auto;/,
    );
  });

  it("keeps context process rows as one-line summaries without expand buttons", () => {
    const taskProcessItemSource = getFunctionSource(chatPanelSource, "TaskProcessItem");

    expect(chatPanelSource).toContain("compact?: boolean");
    expect(chatPanelSource).toContain("compact={true}");
    expect(taskProcessItemSource).toContain(
      "const shouldCollapse = !compact && item.message.length > 160;",
    );
    expect(taskProcessItemSource).toMatch(
      /compact\s*\?\s*getLatestRuntimeLine\(item\.message\)\s*:/,
    );
    expect(styles).toMatch(
      /\.agent-context-panel \.task-process-list span\s*{[\s\S]*white-space: nowrap;[\s\S]*text-overflow: ellipsis;/,
    );
    expect(styles).toMatch(
      /\.agent-context-panel \.task-process-item-toggle\s*{[\s\S]*display: none;/,
    );
  });

  it("uses active subagent status as the right context rail primary content", () => {
    expect(chatPanelSource).toContain("buildRequirementProcessItems");
    expect(chatPanelSource).toContain("requirementProcessItems");
    expect(chatPanelSource).toContain("buildSubagentProcessItems");
    expect(chatPanelSource).toContain("subagentProcessItems");
    expect(chatPanelSource).toContain(
      'subagentProcessItems.some((item) => item.status === "running")',
    );
    expect(chatPanelSource).toContain('aria-label="子代理执行状态"');
    expect(chatPanelSource).toContain("SubagentStatusList");
    expect(styles).toContain(".subagent-status-list");
    expect(styles).toContain(".subagent-status-item.is-running");
    expect(styles).toContain(".subagent-status-item.is-error");
  });

  it("commits the v2.9 output rendering design artifact with acceptance states", () => {
    expect(existsSync(outputRenderingArtifactPath)).toBe(true);

    for (const requiredState of [
      "single-column answer",
      "run ledger",
      "table",
      "code/diff",
      "terminal output",
      "document report",
      "approval waiting",
      "guided input",
      "error diagnostic",
      "narrow layout",
    ]) {
      expect(outputRenderingArtifactSource.toLowerCase()).toContain(requiredState);
    }

    expect(outputRenderingArtifactSource).toContain("chat-answer-block");
    expect(outputRenderingArtifactSource).not.toContain("chat-evidence-rail");
    expect(outputRenderingArtifactSource).not.toContain("has-evidence");
    expect(outputRenderingArtifactSource).toContain("chat-run-ledger");
    expect(outputRenderingArtifactSource).toContain("@media (max-width: 640px)");
  });

  it("keeps a draggable window strip visible on the chat-first desktop shell", () => {
    expect(appSource).toContain("window-drag-strip");
    expect(styles).toContain(".window-drag-strip");
    expect(styles).toContain("-webkit-app-region: drag");
    expect(styles).toContain(".window-drag-strip button");
    expect(styles).toContain("-webkit-app-region: no-drag");
    expect(styles).toContain("--window-control-safe-area");
    expect(styles).toContain(".workspace-sidebar::before");
    expect(styles).toContain("flex: 0 0 var(--window-control-safe-area);");
    expect(styles).toContain("overscroll-behavior: contain;");
  });

  it("keeps navigation icons as rounded non-clipped stroke SVGs", () => {
    const materialNavigationSource = readFileSync(
      path.join(process.cwd(), "src/shared/materialNavigation.ts"),
      "utf8",
    );

    expect(appSource).toContain('fill="none"');
    expect(appSource).toContain('stroke="currentColor"');
    expect(appSource).toContain('strokeLinecap="round"');
    expect(appSource).toContain('strokeLinejoin="round"');
    expect(appSource).toContain('strokeWidth="1.75"');
    expect(appSource).toContain('vectorEffect="non-scaling-stroke"');
    expect(styles).toContain(".material-nav-icon svg");
    expect(styles).toContain("overflow: visible;");
    expect(styles).toContain(".nav-item.is-active .material-nav-icon path");
    expect(styles).toContain("stroke-width: 1.9;");
    expect(materialNavigationSource).toContain("Rounded stroke SVG path");
    expect(materialNavigationSource).toContain("M12 15.5a3.5");
    expect(materialNavigationSource).not.toContain("M19.4 13a7.8");
  });

  it("renders the sidebar version from runtime metadata instead of a hardcoded value", () => {
    expect(appSource).not.toContain("v1.0.0");
    expect(appSource).toContain("getRuntimeInfo");
    expect(appSource).toContain("appVersion");
  });

  it("surfaces the local harness score in Overview", () => {
    expect(overviewPanelSource).toContain("computeHarnessScore");
    expect(overviewPanelSource).toContain("本地基线分");
    expect(overviewPanelSource).toContain("ETCLOVG 七类");
  });

  it("surfaces the agent capability score in Overview", () => {
    expect(overviewPanelSource).toContain("computeAgentCapabilityScore");
    expect(overviewPanelSource).toContain("智能体能力分");
    expect(overviewPanelSource).toContain("本地工具");
  });

  it("routes Overview settings shortcuts to precise Settings subsections", () => {
    expect(overviewPanelSource).toContain("NavigationTargetId");
    expect(overviewPanelSource).toContain('["model-settings", "配置模型"]');
    expect(overviewPanelSource).toContain('target: "model-settings"');
    expect(overviewPanelSource).not.toContain('target: "settings"');
  });

  it("announces Settings status changes and confirms destructive memory deletes", () => {
    expect(overviewPanelSource).toContain('role={status.kind === "error" ? "alert" : "status"}');
    expect(memoryPanelSource).toContain('role={status.kind === "error" ? "alert" : "status"}');
    expect(memoryPanelSource).toContain("ConfirmDialog");
    expect(memoryPanelSource).toContain("此操作不可撤销");
    expect(memoryPanelSource).toContain("删除本地长期记忆，不可撤销");
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
    expect(runsPanelSource).toContain("window.buildingAgent.listActiveAgentExecutions()");
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

  it("surfaces layered memory, ingestion review, and raw history as distinct memory surfaces", () => {
    expect(preloadSource).toContain("searchRawHistory");
    expect(preloadSource).toContain("readRawHistoryAround");
    expect(preloadSource).toContain("ingestRecentMemories");
    expect(preloadSource).toContain("getMemoryIngestionStatus");
    expect(preloadSource).toContain("acceptMemoryIngestionCandidate");
    expect(memoryPanelSource).toContain("memory-layer-lanes");
    expect(memoryPanelSource).toContain("memory-ingestion-inbox");
    expect(memoryPanelSource).toContain("handleIngestRecentMemories");
    expect(memoryPanelSource).toContain("loadIngestionStatus");
    expect(memoryPanelSource).toContain("window.setInterval");
    expect(memoryPanelSource).toContain("raw-history-panel");
    expect(memoryPanelSource).toContain("raw-history-action-row");
    expect(memoryPanelSource).toContain("searchRawHistory");
    expect(memoryPanelSource).toContain("原始历史");
    expect(memoryPanelSource).toContain("工作区范围");
    expect(styles).toContain(".raw-history-panel");
    expect(styles).toContain("repeat(auto-fit, minmax(min(100%, 160px), 1fr))");
    expect(styles).toContain(".raw-history-action-row");
  });

  it("surfaces eval candidate review and promotion controls", () => {
    expect(existsSync(evalReviewPanelPath)).toBe(true);

    expect(evalReviewPanelSource).toContain("listEvalCandidates");
    expect(evalReviewPanelSource).toContain("promoteEvalCandidate");
  });

  it("renders technical surfaces as collapsed Settings secondary sections", () => {
    expect(appSource).toContain("SettingsSectionShell");
    expect(appSource).toContain("getSettingsNavigationSections");
    expect(appSource).toContain("getSettingsNavigationGroups");
    expect(appSource).toContain("getSettingsNavigationSection");
    expect(appSource).toContain("getStartupNavigationTarget");
    expect(appSource).toContain("getStartupSettingsNavigationSection");
    expect(appSource).toContain("ToolsPanel");
    expect(appSource).toContain("MemoryPanel");
    expect(appSource).toContain("LearningReviewPanel");
    expect(appSource).toContain("EvalReviewPanel");
    expect(appSource).not.toContain('activeSection.id === "skills"');
    expect(appSource).not.toContain('activeSection.id === "tools"');
    expect(appSource).not.toContain('activeSection.id === "memory"');
    expect(appSource).not.toContain('activeSection.id === "learning"');
    expect(appSource).not.toContain('activeSection.id === "evals"');
    expect(styles).toContain(".settings-section-shell");
    expect(styles).toContain(".settings-section-nav");
    expect(styles).toContain(".settings-section-nav-heading");
    expect(styles).toContain(".settings-section-group");
    expect(styles).toContain(".settings-section-intent");
    expect(styles).toContain(".settings-section-priority");
    expect(styles).toContain(".settings-section-body-header");
    expect(styles).toContain(".settings-section-body");
    expect(styles).toContain("overflow-x: clip");
    expect(styles).toContain("repeat(auto-fit, minmax(min(100%, 240px), 1fr))");
    expect(styles).toContain("repeat(auto-fit, minmax(min(100%, 220px), 1fr))");
    expect(styles).toContain(".data-boundary-panel");
    expect(styles).toContain("word-break: keep-all");
    expect(styles).toContain("text-wrap: balance");
    expect(styles).toContain("repeat(auto-fit, minmax(min(100%, 180px), 1fr))");
    expect(styles).toContain("--color-app-bg");
    expect(styles).toContain("--color-surface-primary");
    expect(styles).toContain("--color-surface-muted");
    expect(styles).toContain("--shadow-sm");
    expect(appSource).toContain("settings-section-body is-");
    expect(styles).toContain(".overview-panel .data-boundary-panel");
    expect(styles).toContain(".settings-section-body.is-system-overview");
    expect(styles).toContain("background: var(--color-surface-primary);");
    expect(styles).toContain("background: var(--color-surface-muted);");
  });

  it("keeps Settings subpage navigation deep-linkable and intent grouped", () => {
    expect(appSource).toContain("type NavigationTargetId");
    expect(appSource).toContain("onClick={() => navigateTo(section.id)}");
    expect(appSource).toContain("navigateTo(getStartupNavigationTarget(window.location.hash))");
    expect(appSource).not.toContain("onSelect={setActiveSettingsSectionId}");
    expect(appSource).toContain("设置路径");
    expect(appSource).toContain("按意图分组");
    expect(appSource).toContain("formatSettingsPriority");
    expect(appSource).toContain("高频路径");
    expect(appSource).toContain("安全路径");
    expect(appSource).toContain("审查路径");
    expect(appSource).toContain("aria-current");
  });

  it("commits the v3.2.2 Soft Blue design system specification", () => {
    expect(existsSync(uiUxDesignSystemPath)).toBe(true);
    expect(uiUxDesignSystemSource).toContain("v3.2.1");
    expect(existsSync(visualSystemSpecPath)).toBe(true);
    expect(visualSystemSpecSource).toContain("v3.2.2");
    expect(visualSystemSpecSource).toContain("Soft Blue Desktop Control Surface");
    expect(visualSystemSpecSource).toContain("Not Allowed");
    expect(visualSystemSpecSource).toContain("Token Architecture");
    expect(visualSystemSpecSource).toContain("Phase 4 Entry Gate");
  });

  it("commits the v3.4.0 Obsidian design guideline and plan", () => {
    const obsidianPlanPath = path.join(
      process.cwd(),
      "docs/design/zerox-agent-3-4-0-obsidian-plan.md",
    );
    const obsidianPlanSource = existsSync(obsidianPlanPath)
      ? readFileSync(obsidianPlanPath, "utf8")
      : "";

    expect(existsSync(guideline0708Path)).toBe(true);
    expect(guideline0708Source).toContain("B · 曜石 Obsidian");
    expect(guideline0708Source).toContain('[data-accent="mono"]');
    expect(guideline0708Source).toContain("--color-accent:#26262A");
    expect(guideline0708Source).toContain("曜石方案在 Dark 下整体反转");
    expect(existsSync(obsidianPlanPath)).toBe(true);
    expect(obsidianPlanSource).toContain("Zerox Agent 3.4.0 Obsidian");
    expect(obsidianPlanSource).toContain("Frontend and interaction updates only");
  });

  it("moves Overview diagnostics into the Settings system section", () => {
    expect(appSource).toMatch(
      /props\.activeSectionId === "system-overview"[\s\S]*<OverviewPanel onNavigate={navigateTo} \/>/,
    );
    expect(appSource).not.toContain('activeSection.id === "overview"');
  });

  it("keeps the four composer controls as auto, goal, stop, and send", () => {
    expect(chatPanelSource).not.toContain('onClick={() => onNavigate("tools")}');
    expect(chatPanelSource).toContain("goalModeEnabled");
    expect(chatPanelSource).toContain("composer-goal-mode-button");
    expect(chatPanelSource).toContain("<span>目标</span>");
    expect(chatPanelSource).toContain("auto-approval-toggle");
    expect(chatPanelSource).toContain("data-risk-tooltip");
    expect(chatPanelSource).toContain("composerRiskTooltips");
    expect(chatPanelSource).toContain("composer-risk-tooltip");
    expect(chatPanelSource).toContain("自动授权：普通文件、Shell 和网络操作默认放行");
    expect(chatPanelSource).toContain("目标模式：先在只读 Plan Mode 生成计划");
    expect(chatPanelSource).toContain("composer-stop-button");
    expect(chatPanelSource).toContain("composer-send-button");
    expect(chatPanelSource).not.toContain("slash-command-menu");
    expect(chatPanelSource).not.toContain("composerCommandItems");
    expect(styles).toContain(".composer-icon");
    expect(styles).toContain(".composer-icon path");
    expect(styles).toContain(".composer-goal-mode-button");
    expect(styles).toContain(".composer .composer-goal-mode-button");
    expect(styles).toContain("min-height: var(--composer-action-size);");
    expect(styles).toContain("min-width: 40px;");
    expect(styles).toContain(".composer .auto-approval-toggle.is-enabled");
    expect(styles).toContain(".composer .composer-goal-mode-button.is-enabled");
    expect(styles).toContain(".composer-risk-tooltip");
    expect(styles).toContain("--composer-action-inset: 14px;");
    expect(styles).toContain("right: var(--composer-action-inset);");
    expect(styles).toContain("bottom: var(--composer-action-inset);");
  });

  it("keeps Goal Mode inside Chat instead of a standalone page", () => {
    expect(appSource).not.toContain('activeSection.id === "goals"');
    expect(appSource).not.toContain("<GoalPanel");
    expect(overviewPanelSource).toContain("listActiveGoals");
    expect(overviewPanelSource).toContain("goalsWaitingForReview");
    expect(overviewPanelSource).toContain('target: "chat"');
    expect(overviewPanelSource).not.toContain('target: "goals"');
  });

  it("surfaces session-native Goal Mode inside Chat", () => {
    expect(chatPanelSource).toContain("GoalStatusStrip");
    expect(chatPanelSource).toContain("activeGoal");
    expect(appSource).toContain("goal-session-badge");
    expect(chatPanelSource).toContain("GoalDetailDrawer");
    expect(chatPanelSource).toContain("handleViewGoalProgress");
    expect(chatPanelSource).toContain("handleStartGoal");
    expect(chatPanelSource).not.toContain("refreshSessions(sessionIdToLoad)");
    expect(chatPanelSource).toContain("GoalDraftCard");
    expect(chatPanelSource).toContain("handleConfirmGoalDraft");
    expect(chatPanelSource).toContain("confirmGoalDraft");
    expect(chatPanelSource).toContain('mode: "goal_plan"');
    expect(chatPanelSource).toMatch(
      /const shouldCreateGoalPlan =\s*!activeGoal &&\s*!planInputLocked/,
    );
    expect(chatPanelSource).not.toMatch(/outgoingAttachments\.length === 0 &&\s*!activeGoal/);
    expect(chatPanelSource).toContain("PlanModeDecisionCard");
    expect(chatPanelSource).toContain("PlanModeStatusCard");
    expect(chatPanelSource).toContain("PlanConfirmationCard");
    expect(chatPanelSource).toContain("handleConfirmPlan");
    expect(chatPanelSource).toContain("planModelAssignments");
    expect(chatPanelSource).toContain("isLegacyGoalCommand");
    expect(goalStatusStripSource).toContain("buildGoalProgressViewModel");
    expect(goalStatusStripSource).toContain("progress.statusLabel");
    expect(goalStatusStripSource).toContain("onResolveReview");
    expect(goalStatusStripSource).not.toContain("onIncreaseBudget");
    expect(goalStatusStripSource).toContain('case "waiting_for_model"');
    expect(goalStatusStripSource).toContain("继续生成");
    expect(chatPanelSource).toContain("async function handlePauseGoal");
    expect(chatPanelSource).toContain("pauseGoal(goalId)");
    expect(chatPanelSource).toContain("isSessionSelectionCurrent(selection)");
    expect(chatPanelSource).toContain("goalMutationSequenceRef");
    expect(chatPanelSource).toContain("isGoalMutationCurrent(selection, mutationSequence)");
    expect(chatPanelSource).toContain("? { onPause: () => void handlePauseGoal() }");
    expect(chatPanelSource).not.toContain('submitUserMessage("暂停这个目标")');
    expect(chatPanelSource).not.toContain("window.buildingAgent.increaseGoalBudget(");
    expect(chatPanelSource).not.toContain("onIncreaseBudget={handleIncreaseGoalBudget}");
    expect(chatPanelSource).toContain(
      "const goalModeVisuallyEnabled = goalModeEnabled || planInputLocked;",
    );
    expect(chatPanelSource).toContain("if (wasCanceled && planInputLocked && sessionId)");
    expect(chatPanelSource).toContain("aria-pressed={goalModeVisuallyEnabled}");
    expect(chatPanelSource).toContain('className="primary-action"');
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
    expect(styles).toContain(".goal-draft-card");
  });

  it("wires blocked acceptance recovery and safe certificate disclosure", () => {
    expect(goalDetailDrawerSource).toContain("重试验收");
    expect(goalDetailDrawerSource).toContain("调整计划");
    expect(goalDetailDrawerSource).toContain("终止目标");
    expect(goalDetailDrawerSource).toContain("查看验收证书");
    expect(goalDetailDrawerSource).toContain("progress.certificate");
    expect(goalDetailDrawerSource).toContain(
      'progress.recoveryActions.includes("retry_acceptance")',
    );
    expect(goalDetailDrawerSource).toContain('progress.recoveryActions.includes("adjust_plan")');
    expect(goalDetailDrawerSource).toContain("shortCertificateHash");
    expect(goalDetailDrawerSource).toContain("goal-certificate-hash");
    expect(goalDetailDrawerSource).toContain("<code>{artifact.path}</code>");
    expect(goalDetailDrawerSource).not.toContain("href={artifact.path}");
    expect(goalStatusStripSource).toContain('case "stopped_blocked"');
    expect(goalStatusStripSource).toContain("progress.acceptance");
    expect(chatPanelSource).toContain("retryGoal(goalId)");
    expect(chatPanelSource).toContain("!activePlan?.executionGoalId");
    expect(chatPanelSource).toContain(
      'const retryStarted = result.ok && result.goal?.status === "executing"',
    );
    expect(chatPanelSource).toContain(
      "outcomeMessage = applyCanonicalGoalState(result.goal)",
    );
    expect(chatPanelSource).toContain('setComposerDraft("调整目标计划：")');
    expect(chatPanelSource).toContain("请说明需要改变的依赖、工具路径、执行方法或验收路径");
    expect(chatPanelSource).toContain("setActivePlan(result.plan)");
    expect(chatPanelSource).toContain("运行期 Direct Plan 等待采用");
    expect(chatPanelSource).toContain("adoptGoalPlan(");
    expect(chatPanelSource).toContain("采用前不会覆盖当前 Goal");
    expect(chatPanelSource).toContain("cancelGoal(goalId)");
    expect(chatPanelSource).toContain("void refreshSessions(sessionId ?? undefined)");
  });

  it("renders Goal contract, active Plan lineage, and explicit amendment decisions", () => {
    expect(goalDetailDrawerSource).toContain("目标契约");
    expect(goalDetailDrawerSource).toContain("Plan 历史");
    expect(goalDetailDrawerSource).toContain("初始 Debate → 当前 Direct");
    expect(goalDetailDrawerSource).toContain("目标修订提案");
    expect(goalDetailDrawerSource).toContain("GoalContractComparison");
    expect(goalDetailDrawerSource).toContain("删除或放松了硬约束");
    expect(goalDetailDrawerSource).toContain("批准并生成 Direct Plan");
    expect(goalDetailDrawerSource).toContain("原执行路径已安全暂停");
    expect(goalStatusStripSource).toContain("目标修订等待批准");
    expect(goalStatusStripSource).toContain("isOpenRuntimePlanCandidate");
    expect(chatPanelSource).toContain("[activeGoalPlan, setActiveGoalPlan]");
    expect(chatPanelSource).toContain("planCandidate={activePlan}");
    expect(chatPanelSource).toContain("handleResolveGoalAmendment");
    expect(chatPanelSource).toContain("resolveGoalAmendment(");
    expect(chatPanelSource).toContain("采用 Plan 并恢复 Goal");
  });

  it("wires recoverable final acceptance without implying certification", () => {
    expect(appSource).toContain('waiting_for_acceptance: "等待最终验收"');
    expect(appSource).toContain('completed_unverified: "手动完成 · 未经机器认证"');
    expect(goalDetailDrawerSource).toContain("继续验收");
    expect(goalDetailDrawerSource).toContain("手动标记完成");
    expect(goalDetailDrawerSource).toContain("不会生成机器验收证书");
    expect(goalDetailDrawerSource).toContain("getConfirmedManualCompletionGoalId");
    expect(goalDetailDrawerSource).toContain("manualCompletionConfirmation");
    expect(goalDetailDrawerSource).toContain("onContinueAcceptance");
    expect(goalDetailDrawerSource).toContain("onMarkCompletedUnverified");
    expect(goalDetailDrawerSource).toContain("goalAcceptanceOperationPending");
    expect(goalStatusStripSource).toContain('case "waiting_for_acceptance"');
    expect(goalStatusStripSource).toContain("继续最终验收");
    expect(chatPanelSource).toMatch(
      /continueGoalAcceptance\(\s*operation\.goalId/,
    );
    expect(chatPanelSource).toMatch(
      /markGoalCompletedUnverified\(\s*operation\.goalId/,
    );
    expect(chatPanelSource).toContain("projectGoalAcceptanceOperationOutcome");
    expect(chatPanelSource).toContain("outcome.statusMessage");
    expect(chatPanelSource).toContain("outcome.assistantMessage");
    expect(chatPanelSource).not.toContain('content: "已继续最终验收。"');
    expect(chatPanelSource).toContain("setActiveGoalDetail(result.goal)");
    expect(chatPanelSource).toContain("goalAcceptanceOperationPendingRef.current");
    expect(chatPanelSource).toContain("isGoalAcceptanceOperationCurrent");
    expect(chatPanelSource).toContain("doesGoalAcceptanceOperationOwnPending");
    expect(goalDetailDrawerSource).toContain("progress.acceptance.retry");
    expect(goalDetailDrawerSource).toContain("progress.acceptance.manualCompletion");
    expect(styles).toContain(".goal-status-strip.is-completed_unverified");
    expect(styles).toContain(".goal-manual-completion-confirmation");
    expect(styles).toContain("var(--status-warning-text)");
    expect(styles).not.toContain(
      ".goal-status-strip.is-achieved,\n.goal-status-strip.is-completed_unverified",
    );
  });

  it("keeps blocked and certificate surfaces bounded, focusable, and Obsidian-styled", () => {
    expect(styles).toContain(".goal-acceptance-evidence");
    expect(styles).toContain(".goal-certificate-details");
    expect(styles).toContain(".goal-certificate-list");
    expect(styles).toContain("max-height:");
    expect(styles).toContain("overflow-y: auto;");
    expect(styles).toContain("font-family: var(--font-mono);");
    expect(styles).toContain(".goal-detail-drawer button:focus-visible");
    expect(styles).toContain("var(--color-surface-primary)");
    expect(styles).toContain("var(--border-default)");
  });

  it("maps stopped_blocked exhaustively across renderer goal surfaces", () => {
    expect(appSource).toContain('stopped_blocked: "目标受阻"');
    expect(chatPanelSource).toContain('stopped_blocked: "目标受阻"');
    expect(chatPanelSource).toContain('status === "stopped_blocked"');
    expect(goalStatusStripSource).toContain('case "stopped_blocked"');
    expect(goalDetailDrawerSource).toContain('status === "stopped_blocked"');
  });

  it("uses Obsidian styling for Goal Mode draft and execution surfaces", () => {
    expect(styles).toContain(".runtime-surface-stack {\n  flex: 0 0 auto;\n  display: grid;");
    expect(styles).toContain("background: transparent;");
    expect(styles).toContain(".goal-draft-card {\n  display: grid;\n  gap: var(--space-3);");
    expect(styles).toContain("border-radius: var(--radius-10);");
    expect(styles).toContain("background: var(--color-surface-primary);");
    expect(styles).toContain(".goal-draft-field textarea:focus");
    expect(styles).toContain(".goal-run-process {\n  display: grid;\n  gap: var(--space-2);");
    expect(styles).toContain(".goal-run-process summary {\n  display: flex;");
    expect(styles).toContain("background: transparent;");
    expect(styles).toContain(".goal-status-strip-actions button");
  });

  it("keeps goal progress synced even before the active goal summary refreshes", () => {
    expect(chatPanelSource).toContain("const eventBelongsToActiveGoal");
    expect(chatPanelSource).toContain(
      "goalProgressEventMatchesActiveContext(event",
    );
    expect(chatPanelSource).toContain("void refreshActiveGoalDetail(event.goalId)");
    expect(chatPanelSource).toContain("setActiveGoalDetail((currentGoal) =>");
    expect(chatPanelSource).toContain("status: event.status");
    expect(chatPanelSource.indexOf("setActiveGoalDetail((currentGoal) =>")).toBeLessThan(
      chatPanelSource.indexOf("void refreshActiveGoalDetail(event.goalId)"),
    );
    expect(chatPanelSource).not.toContain('const goalUiState = event.status === "stopped_blocked"');
  });

  it("accepts empty desktop chat session lists as real state", () => {
    const refreshSessionsSource = getFunctionSource(chatPanelSource, "refreshSessions");

    expect(refreshSessionsSource).toContain(
      "const nextSessions = loadedSessions.map(toSessionRailItem);",
    );
    expect(refreshSessionsSource).toContain("setSessions(nextSessions);");
    expect(chatPanelSource).toContain("onChatSessionsChange?.(sessions);");
    expect(chatPanelSource).toContain("[onChatSessionsChange, sessions]");
    expect(refreshSessionsSource).not.toContain("if (loadedSessions.length)");
  });

  it("reloads the active chat transcript when a background goal reaches a terminal state", () => {
    expect(chatPanelSource).toContain("function isTerminalGoalStatus");
    expect(chatPanelSource).toContain("async function refreshCurrentSessionMessages");
    expect(chatPanelSource).toContain("isTerminalGoalStatus(event.status)");
    expect(chatPanelSource).toContain("void refreshCurrentSessionMessages(");
    expect(chatPanelSource).toContain("event.sessionId ?? activeSessionId ?? undefined");
  });

  it("restores the persisted Goal status ahead of stale Plan activity", () => {
    const loadSessionSource = getFunctionSource(chatPanelSource, "loadPersistedSession");

    expect(loadSessionSource).toContain("const restoredGoalId =");
    expect(loadSessionSource).toContain("latestPlan?.executionGoalId");
    expect(loadSessionSource).toContain("loadedSession.goalSummaries?.at(-1)?.id");
    expect(loadSessionSource).toContain("!restoredGoalId");
    expect(loadSessionSource).toContain("buildPersistedGoalActivity({");
    expect(loadSessionSource).toContain("status: loadedGoal.status");
    expect(loadSessionSource).toContain("setStatus(restoredGoalActivity.status)");
  });

  it("reconciles every successful chat completion from persisted session state", () => {
    const successSource = getFunctionSource(chatPanelSource, "applySuccessfulChatResult");

    expect(successSource).toContain("finalizeChatStreamResult");
    expect(successSource).toContain("void refreshCurrentSessionMessages(result.sessionId);");
  });

  it("clears session-scoped Goal draft ownership before loading another transcript", () => {
    const loadSessionSource = getFunctionSource(chatPanelSource, "loadPersistedSession");
    const switchBoundary = loadSessionSource.indexOf("sessionIdRef.current = sessionIdToLoad");
    const loadBoundary = loadSessionSource.indexOf("await window.buildingAgent.getChatSession");
    const cleanupSource = loadSessionSource.slice(switchBoundary, loadBoundary);

    expect(cleanupSource).toContain("setPendingGoalDraft(null)");
    expect(cleanupSource).toContain('setGoalDraftDescription("")');
    expect(cleanupSource).toContain('setGoalDraftCriteriaText("")');
    expect(cleanupSource).toContain("goalDraftActionPendingRef.current = null");
    expect(cleanupSource).toContain("setGoalDraftActionPending(null)");
    expect(cleanupSource).toContain("setSelectedWorkspaceId(null)");
    expect(cleanupSource).toContain('setComposerDraft("", 0)');
    expect(cleanupSource).toContain("setComposerAttachments([])");
    expect(cleanupSource).toContain("setSelectedSkillName(null)");
    expect(cleanupSource).toContain("setChatStreamState(createChatStreamState([]))");
    expect(loadSessionSource).toContain("sessionLoadPendingRef.current = loadGeneration");
    expect(chatPanelSource).toContain("sessionLoadPendingRef.current !== null");
  });

  it("starts Chat in a goal-mode-ready empty home state", () => {
    expect(chatPanelSource).toContain("const initialMessages: ChatMessage[] = [];");
    expect(chatPanelSource).toContain("function AgentHomeHero");
    expect(chatPanelSource).toContain("messages.length === 0");
    expect(chatPanelSource).toContain("agent-home-hero");
    expect(chatPanelSource).toContain("onPickPrompt");
    expect(chatPanelSource).toContain("让Zerox-Agent帮你做什么？");
    expect(styles).toContain(".agent-home-hero");
    expect(styles).toContain(".home-suggestions");
  });

  it("keeps Plan Mode context, settings, and input in separate non-overlapping rows", () => {
    expect(chatPanelSource).toContain('${goalModeVisuallyEnabled ? " has-plan-mode" : ""}');
    expect(styles).toContain(".composer-input-shell.has-plan-mode .composer-context-row");
    expect(styles).toContain("position: relative;");
    expect(styles).toContain(
      ".composer-input-shell.has-plan-mode textarea,\n.composer-input-shell.has-plan-mode.has-attachments textarea",
    );
  });

  it("uses a blocking Plan decision, role-based model cards, and one technical disclosure", () => {
    expect(chatPanelSource).toContain('className="plan-mode-decision-card decision-card"');
    expect(chatPanelSource).toContain("这次目标如何规划？");
    expect(chatPanelSource).toContain("使用此规划方式");
    expect(chatPanelSource).toContain("setPlanModeDecisionOpen(false)");
    expect(chatPanelSource).toContain('<details className="plan-technical-disclosure">');
    expect(chatPanelSource).toContain("技术详情（排障时使用）");
    expect(chatPanelSource).toContain('className="plan-artifact-disclosure"');
    expect(chatPanelSource).toContain(
      "const [planDetailsOpen, setPlanDetailsOpen] = useState(false);",
    );
    expect(chatPanelSource).toContain("setPlanDetailsOpen(false);");
    expect(chatPanelSource).toContain("确认前需要回答");
    expect(chatPanelSource).toContain("decision-question-form");
    expect(chatPanelSource).toContain("提交回答并重新规划");
    expect(chatPanelSource).toContain("Debate 轮次");
    expect(chatPanelSource).toContain("plan-model-role-card");
    expect(chatPanelSource).toContain("plan-model-role-badge");
    expect(chatPanelSource).toContain("全部使用");
    expect(chatPanelSource).toContain("分配 Debate 角色");
    expect(chatPanelSource).toContain('role="radiogroup"');
    expect(chatPanelSource).toContain("onKeyDown={handleModeKeyDown}");
    expect(chatPanelSource).toContain(
      'tabIndex={props.mode === "direct" ? 0 : -1}',
    );
    expect(styles).toContain(".plan-mode-decision-card");
    expect(styles).toContain(".plan-model-role-card");
    expect(styles).toContain(".plan-model-select-shell");
    expect(styles).toContain(".plan-model-unify-action:focus-visible");
    expect(styles).toContain(".decision-question-form");
    expect(styles).toContain(".plan-technical-disclosure");
  });

  it("keeps the default Plan result focused on outcome and next action", () => {
    expect(chatPanelSource).toContain('aria-label="规划结果"');
    expect(chatPanelSource).toContain("outcomePresentation.title");
    expect(chatPanelSource).toContain("outcomePresentation.detail");
    expect(chatPanelSource).toContain("outcomePresentation.nextAction");
    expect(chatPanelSource).toContain("failure.technicalDetail");
    expect(styles).toContain(".plan-outcome-summary.is-success");
    expect(styles).toContain(".plan-outcome-summary.is-failure");
  });

  it("keeps Plan clarification typing synchronous and replaces white screens with recovery UI", () => {
    expect(chatPanelSource).toContain(
      "const nextAnswer = event.currentTarget.value;",
    );
    expect(chatPanelSource).toContain(
      "answerIndex === index ? nextAnswer : answer",
    );
    expect(chatPanelSource).not.toContain(
      "answerIndex === index ? event.currentTarget.value : answer",
    );
    expect(chatPanelSource).toContain(
      '`${index + 1}. ${question}\\n${questionAnswers[index] ?? ""}`',
    );
    expect(rendererMainSource).toContain("<RendererErrorBoundary>");
    expect(rendererErrorBoundarySource).toContain(
      "界面遇到错误，任务数据仍保留在本地",
    );
    expect(rendererErrorBoundarySource).toContain("window.location.reload()");
    expect(styles).toContain(".renderer-recovery-surface");
  });

  it("locks all follow-up input to the active pre-confirmation Plan state machine", () => {
    expect(chatPanelSource).toContain(
      "const planInputLocked = isPlanInputRoutingLocked(activePlan);",
    );
    expect(chatPanelSource).toContain("!planInputLocked &&");
    expect(chatPanelSource).toContain("planModeDecisionOpen ||");
    expect(chatPanelSource).toContain("(planInputLocked && !planAcceptsComposerInput)");
    expect(chatPanelSource).toContain("const shouldCreateGoalPlan =\n      !activeGoal");
    expect(chatPanelSource).toContain("确认或丢弃前不能退出只读 Plan Mode");
    expect(chatPanelSource).toMatch(/\"awaiting_confirmation\",\s*\"canceled\",\s*\"failed\"/);
    expect(chatPanelSource).toContain("getLatestPlanForSession(sessionId)");
    expect(chatPanelSource).not.toContain(
      "const modeState =\n        await window.buildingAgent.setToolGoalModeEnabled(true)",
    );
    expect(chatPanelSource).toContain("本条消息只用于补充或修改计划，不会启动普通 Agent");
    expect(chatPanelSource).toContain("当前计划保持只读");
    expect(chatPanelSource).toContain('options.agentStatus?.state === "failed"');
    expect(chatPanelSource).toContain("当前结果不是完成态");
    expect(styles).toContain(".plan-input-routing-note");
  });

  it("lays provider connections and configuration fields out horizontally before responsive collapse", () => {
    expect(styles).toContain(
      ".provider-identity-grid {\n  display: grid;\n  grid-template-columns: repeat(3, minmax(0, 1fr));",
    );
    expect(styles).toContain(
      "grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr));",
    );
    expect(styles).toContain(
      ".provider-manager-layout {\n  display: grid;\n  grid-template-columns: 248px minmax(0, 1fr);",
    );
    expect(styles).toContain("@media (max-width: 760px) {\n  .provider-manager-layout {");
  });

  it("keeps provider verification, credential management, models, and defaults in one connection-first surface", () => {
    expect(modelSettingsPanelSource).toContain("provider-manager-sidebar");
    expect(modelSettingsPanelSource).toContain("provider-manager-detail");
    expect(modelSettingsPanelSource).toContain("testAndSaveProviderConnection");
    expect(modelSettingsPanelSource).toContain("测试并保存");
    expect(modelSettingsPanelSource).toContain("仅保存");
    expect(modelSettingsPanelSource).toContain("clearProviderCredential");
    expect(modelSettingsPanelSource).toContain("移除凭证");
    expect(modelSettingsPanelSource).toContain("最近测试");
    expect(modelSettingsPanelSource).toContain("最近使用");
    expect(modelSettingsPanelSource).toContain("设为默认");
    expect(modelSettingsPanelSource).toContain("该连接的模型");
    expect(modelSettingsPanelSource).toContain('aria-invalid={Boolean(props.error)}');
    expect(modelSettingsPanelSource).toContain('role="alert"');
    expect(modelSettingsPanelSource).toContain("模型已验证");
    expect(modelSettingsPanelSource).not.toContain("API Key 已保存");
  });

  it("uses the v3.4.0 Obsidian root background and accent tokens", () => {
    expect(styles).toContain("--z-gray-50: #f3f3f3;");
    expect(styles).toContain("--z-obsidian-500: #26262a;");
    expect(styles).toContain("--color-app-bg: var(--z-gray-50);");
    expect(styles).toContain("--color-action-primary: var(--z-obsidian-500);");
    expect(styles).toContain("--color-action-primary-hover: var(--z-obsidian-600);");
    expect(styles).toContain("--color-action-primary-pressed: var(--z-obsidian-700);");
    expect(styles).toContain("--color-action-primary: #f2f2f4;");
    expect(styles).toContain("--color-on-accent: #141416;");
    expect(styles).toContain("--nav-rail-width: 232px;");
  });

  it("keeps composer mode enabled states on the Obsidian theme color", () => {
    expect(styles).toContain(
      ".composer .auto-approval-toggle.is-enabled,\n.composer .composer-goal-mode-button.is-enabled {\n  border-color: var(--color-action-primary);\n  color: var(--text-on-accent);\n  background: var(--color-action-primary);",
    );
    expect(styles).toContain(
      ".composer .auto-approval-toggle.is-enabled:hover,\n.composer .composer-goal-mode-button.is-enabled:hover {\n  border-color: var(--color-action-primary-hover);\n  background: var(--color-action-primary-hover);",
    );
  });

  it("uses a unified secondary-page list style for settings and task surfaces", () => {
    expect(styles).toContain("--secondary-page-outline: var(--color-border-subtle);");
    expect(styles).toContain("--secondary-page-accent: var(--color-action-primary);");
    expect(styles).toContain(
      ".settings-section-body {\n  display: grid;\n  gap: var(--space-5);\n  width: min(100%, 920px);",
    );
    expect(styles).toContain(
      ".settings-panel,\n.skill-library,\n.task-panel,\n.tools-panel,\n.memory-panel,\n.task-records-panel {",
    );
    expect(styles).toContain(
      ".field-grid,\n.tools-layout,\n.memory-layout,\n.scheduled-tasks-shell,\n.scheduled-task-grid,\n.task-record-focus,\n.task-records-content",
    );
    expect(styles).toContain(
      ".task-record-row.is-selected,\n.timeline-event.is-selected,\n.run-list-item.is-selected,\n.recommendation.is-selected,\n.module-card.is-selected {\n  border-color: var(--secondary-page-accent);",
    );
    expect(styles).toContain(
      ".settings-section-intent.is-safety,\n.settings-section-priority.is-safety {\n  color: var(--status-warning-text);",
    );
    expect(styles).toContain(".status-pill.is-preview {\n  color: var(--text-accent);");
    expect(styles).toContain(
      ".scheduled-task-meta div + div {\n  border-top: 1px solid var(--secondary-page-outline);",
    );
  });

  it("shows the right context panel only when active work needs it", () => {
    expect(chatPanelSource).toContain("const showContextPanel");
    expect(chatPanelSource).toContain("has-context-panel");
    expect(chatPanelSource).toContain("is-focus-mode");
    expect(chatPanelSource).toContain("{showContextPanel ? (");
    expect(chatPanelSource).not.toContain('<aside className="session-rail"');
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
    expect(chatPanelSource).toContain(
      'const chatTitle = activeChatSessionTitle ?? activeSession?.title ?? "新会话";',
    );
    expect(chatPanelSource).toContain("title={chatTitle}");
    expect(chatPanelSource).toContain("title={status.message}");
    expect(chatPanelSource).toContain("const chatStatusIsLong");
    expect(chatPanelSource).toContain(
      "aria-expanded={chatStatusIsLong ? chatStatusExpanded : undefined}",
    );
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
    const setCandidateStatusSource = getFunctionSource(evalReviewPanelSource, "setCandidateStatus");
    const promoteCandidateSource = getFunctionSource(evalReviewPanelSource, "promoteCandidate");

    expect(setCandidateStatusSource).toContain("catch (error)");
    expect(setCandidateStatusSource).toContain('kind: "error"');
    expect(promoteCandidateSource).toContain("catch (error)");
    expect(promoteCandidateSource).toContain('kind: "error"');
  });

  it("keeps run eval candidate generation recoverable on preload rejection", () => {
    const generateCandidateSource = getFunctionSource(
      runsPanelSource,
      "handleGenerateEvalCandidateForSelectedRun",
    );

    expect(generateCandidateSource).toContain("catch (error)");
    expect(generateCandidateSource).toContain('kind: "error"');
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
    expect(styles).not.toContain(
      "grid-template-columns: var(--session-rail-width) minmax(520px, 1fr) var(--context-panel-width)",
    );
    expect(styles).toContain(".kimi-side-card");
    expect(styles).toContain(".chat-message");
    expect(styles).toContain(".composer");
    expect(styles).toContain(".composer-input-shell");
    expect(styles).toContain(".composer-floating-actions");
    expect(styles).toContain(".composer-icon-button");
    expect(styles).toContain(".composer-goal-mode-button");
    expect(styles).toContain(".composer-icon");
    expect(styles).toContain("--composer-action-size: 32px;");
    expect(styles).toContain(
      "width: var(--composer-action-size); height: var(--composer-action-size);",
    );
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
    expect(chatPanelSource).toContain("composer-goal-mode-button");
    expect(chatPanelSource).toContain("aria-pressed={goalModeVisuallyEnabled}");
    expect(chatPanelSource).toContain('aria-label="中断当前任务"');
    expect(chatPanelSource).toContain('aria-label="发送消息"');
    expect(chatPanelSource).toContain('className="composer-floating-actions"');
    expect(chatPanelSource).toContain("disabled={!canInterruptCurrentWork}");
    expect(chatPanelSource).toContain("handleInterruptCurrentWork");
    expect(chatPanelSource).toContain('activeGoal.status === "executing"');
    expect(chatPanelSource).toContain("cancelGoal(goalId)");
    expect(chatPanelSource).toContain("const selection = captureSessionSelection()");
    expect(chatPanelSource).toContain("applyGoalSummaryToSessions(result.goal)");
    expect(chatPanelSource).not.toContain(
      'disabled={status.kind !== "working" || !activeChatRequestId}',
    );
  });

  it("keeps tool approval inside chat with an auto-authorization toggle and critical risk styling", () => {
    const goalModeHandlerSource = getFunctionSource(
      chatPanelSource,
      "handleSetGoalModeEnabled",
    );

    expect(chatPanelSource).toContain("autoApprovalEnabled");
    expect(chatPanelSource).toContain("autoApprovalLocked");
    expect(chatPanelSource).toContain(
      "const [toolApprovalMode, setToolApprovalMode] = useState<ToolApprovalModeState>",
    );
    expect(chatPanelSource).not.toContain(
      "const [goalModeEnabled, setGoalModeEnabled] = useState(false)",
    );
    expect(chatPanelSource).toContain("setToolGoalModeEnabled");
    expect(chatPanelSource).toContain("setToolAutoApprovalEnabled");
    expect(chatPanelSource).toContain("onToolApprovalRequest");
    expect(chatPanelSource).toContain("tool-approval-panel");
    expect(chatPanelSource).toContain('role="alertdialog"');
    expect(chatPanelSource).toContain('aria-modal="true"');
    expect(chatPanelSource).toContain('aria-label="自动授权工具请求"');
    expect(chatPanelSource).toContain("composer-mode-risk-summary");
    expect(chatPanelSource).toContain("resolveToolApproval");
    expect(chatPanelSource).toContain("shouldShowToolApproval(");
    expect(chatPanelSource).toContain("disabled={autoApprovalLocked}");
    expect(goalModeHandlerSource).toContain(
      "autoApprovalEnabled: true",
    );
    expect(goalModeHandlerSource).toContain(
      "autoApprovalLocked: true",
    );
    expect(goalModeHandlerSource).toContain(
      "setToolGoalModeEnabled(enabled)",
    );
    expect(chatPanelSource).toContain(
      "A persisted Plan proves that Goal mode was selected",
    );
    expect(chatPanelSource).toContain("setToolGoalModeEnabled(true)");
    expect(chatPanelSource).toContain("is-critical-risk");
    expect(styles).toContain(".tool-approval-panel");
    expect(styles).toContain(".auto-approval-toggle");
    expect(styles).toContain(".is-critical-risk");
    expect(styles).toContain("var(--status-error-text)");
  });

  it("keeps long goal instructions in a scrollable body with a short heading", () => {
    expect(goalDetailDrawerSource).toContain("buildGoalDisplayTitle");
    expect(goalDetailDrawerSource).toContain("goal-original-instructions");
    expect(goalDetailDrawerSource).toContain("查看完整目标说明");
    expect(goalDetailDrawerSource).toContain("props.summary.description");
    expect(styles).toContain(".goal-original-instructions-content");
    expect(styles).toContain("overflow-wrap: anywhere");
    expect(styles).toContain("var(--color-on-accent)");
    expect(styles).not.toContain("--color-action-primary-text");
  });

  it("routes run-record chat actions to the run session instead of the chat home", () => {
    expect(appSource).toContain("handleOpenChatSession");
    expect(appSource).toContain("<RunsPanel onOpenChatSession={handleOpenChatSession}");
    expect(preloadSource).toContain("openAgentRunSession");
    expect(runsPanelSource).toContain("openAgentRunSession(");
    expect(runsPanelSource).toContain("props.onOpenChatSession(result.sessionId)");
    expect(runsPanelSource).not.toContain(
      'if (action.kind === "review_permission") {\n      navigateToHash("chat")',
    );
  });

  it("keeps scheduled tasks editable from the saved task card", () => {
    expect(preloadSource).toContain("updateScheduledTask");
    expect(scheduledTasksPanelSource).toContain("handleOpenEditDialog");
    expect(scheduledTasksPanelSource).toContain("编辑任务");
    expect(scheduledTasksPanelSource).toContain("updateScheduledTask(editingTaskId");
  });

  it("keeps goal execution UI compact when long milestone text is active", () => {
    const handleStartGoalSource = getFunctionSource(chatPanelSource, "handleStartGoal");

    expect(handleStartGoalSource).toContain("setGoalDrawerOpen(false)");
    expect(goalDetailDrawerSource).toContain("goal-detail-drawer-backdrop");
    expect(styles).toContain(".goal-detail-drawer-backdrop");
    expect(styles).toContain("grid-template-columns: minmax(0, 0.9fr) minmax(320px, 1.1fr);");
    expect(styles).toContain("-webkit-line-clamp: 2;");
    expect(styles).toContain(".agent-work-steps { min-width: 0;");
  });

  it("subscribes to chat stream events and projects public progress into the conversation and status rail", () => {
    expect(chatPanelSource).toContain("onChatStreamEvent");
    expect(chatPanelSource).toContain("applyChatStreamEvent");
    expect(chatPanelSource).toContain("finalizeChatStreamResult");
    expect(chatPanelSource).toContain("ContextRuntimeSummary");
    expect(chatPanelSource).toContain("ConversationProgressDisclosure");
    expect(chatPanelSource).toContain("SessionContextStatusCard");
    expect(styles).toContain(".context-runtime-summary");
    expect(styles).toContain(".conversation-progress");
    expect(styles).toContain(".session-context-status-card");
  });

  it("keeps tool and raw reasoning previews out of the main interface", () => {
    expect(chatPanelSource).not.toContain("RuntimeTextDisclosure");
    expect(chatPanelSource).not.toContain("ToolCallPreviewDisclosure");
    expect(chatPanelSource).not.toContain("latestToolCallPreview");
    expect(chatPanelSource).not.toContain("context-thinking-disclosure");
    expect(chatPanelSource).not.toContain("tool-call-preview-block");
    expect(chatPanelSource).toContain("getChatStatusMessageFromStatusEvent");
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

  it("keeps long transcript rendering isolated from composer input and session switching", () => {
    const answerBlockSource = readChatOutputComponent("AnswerBlock.tsx");
    const outputPartRendererSource = readChatOutputComponent("OutputPartRenderer.tsx");

    expect(chatPanelSource).toContain("const ChatMessageList = memo(function ChatMessageList");
    expect(chatPanelSource).toContain("const MarkdownMessage = memo(function MarkdownMessage");
    expect(chatPanelSource).toContain("draftRef.current = nextDraft");
    expect(chatPanelSource).not.toContain("value={draft}");
    expect(chatPanelSource).toContain("shouldRenderMarkdownPreview(content)");
    expect(chatPanelSource).toContain("createMarkdownPreview(content)");
    expect(chatPanelSource).toContain("markdown-plain-preview");
    expect(chatPanelSource).toContain(
      "shouldPreview && !expanded ? [] : parseMarkdownBlocks(content)",
    );
    expect(answerBlockSource).toContain("memo(function AnswerBlock");
    expect(outputPartRendererSource).toContain("memo(function OutputPartRenderer");
    expect(outputPartRendererSource).toContain("const TextPartView = memo(function TextPartView");
    expect(outputPartRendererSource).toContain(
      "shouldPreview && !expanded ? [] : parseMarkdownBlocks(text)",
    );
    expect(styles).toContain(".markdown-plain-preview");
    expect(chatPanelSource).not.toContain("refreshSessions(sessionIdToLoad)");
  });

  it("exposes stable DOM hooks for production transcript performance smoke checks", () => {
    expect(appSource).toContain("data-session-id={session.id}");
    expect(chatPanelSource).toContain("data-message-id={message.id}");
  });

  it("keeps guided input reachable when the right context rail is hidden", () => {
    expect(chatPanelSource).toContain("GuidedSkillInputForm");
    expect(chatPanelSource).toMatch(/<GuidedSkillInputForm[\s\S]*pendingInputRequest/);
    expect(styles).toContain("@media (max-width: 1180px)");
    expect(styles).toContain(".agent-context-panel { display: none; }");
    expect(styles).toContain(".guided-skill-input-form");
    expect(chatPanelSource).toContain(
      "guidedInputSubmissionPendingRef.current",
    );
    expect(chatPanelSource).toContain(
      "<button disabled={pending} type=\"submit\">",
    );
  });

  it("keeps compact new-chat and session-switch controls reachable on narrow windows", () => {
    expect(appSource).toContain('aria-label="新会话"');
    expect(appSource).toContain('className="new-chat-label"');
    expect(styles).toMatch(
      /@media \(max-width: 900px\)[\s\S]*\.app-shell\.is-agent-chat \.sidebar-recents \{[\s\S]*display: grid;/,
    );
    expect(styles).toMatch(
      /@media \(max-width: 640px\)[\s\S]*\.new-chat-button \{[\s\S]*width: 44px;/,
    );
    expect(styles).toContain(
      ".sidebar-session-list:has(.sidebar-session-row.has-open-menu)",
    );
  });

  it("serializes modal keyboard ownership and traps rename focus", () => {
    expect(dialogFocusTrapSource).toContain("openDialogStack");
    expect(dialogFocusTrapSource).toContain(
      "openDialogStack.isTop(dialogToken)",
    );
    expect(dialogFocusTrapSource).toContain("stopImmediatePropagation");
    expect(dialogFocusTrapSource).toContain("const onEscapeRef = useRef(onEscape)");
    expect(dialogFocusTrapSource).toContain(
      "const removal = openDialogStack.remove(dialogToken)",
    );
    expect(dialogFocusTrapSource).not.toContain(
      "[dialogRef, initialFocusRef, onEscape, open]",
    );
    expect(appSource).toContain("useDialogFocusTrap({");
    expect(appSource).toContain("initialFocusRef: inputRef");
  });

  it("recovers App session mutations from rejected IPC promises", () => {
    const renameSource = getFunctionSource(
      appSource,
      "handleSubmitRenameChatSession",
    );
    expect(renameSource).toContain("catch (error)");
    expect(renameSource).toContain("pending: false");
    expect(getFunctionSource(appSource, "handleArchiveChatSession")).toContain(
      "catch (error)",
    );
    expect(getFunctionSource(appSource, "performDeleteChatSession")).toContain(
      "catch (error)",
    );
  });

  it("clears all active stream refs during new chat reset so stale events cannot repopulate the transcript", () => {
    const newChatResetSource = getUseEffectSource(chatPanelSource, "newChatRequestKey");

    expect(newChatResetSource).toContain("resetActiveChatRefs()");
    expect(newChatResetSource).toContain(
      "setChatStreamState(createChatStreamState(initialMessages))",
    );
    expect(chatPanelSource).toContain("function resetActiveChatRefs");
    expect(chatPanelSource).toContain("activeStatusSessionIdRef.current = null");
    expect(chatPanelSource).toContain("activeChatRequestIdRef.current = null");
    expect(chatPanelSource).toContain("pendingInputRequestRef.current = null");
  });

  it("keeps update feedback and pasted attachments compact, labeled, and keyboard operable", () => {
    expect(appSource).toContain("nav-update-action");
    expect(appSource).toContain('aria-live="polite"');
    expect(appSource).toContain("installAppUpdate");
    expect(chatPanelSource).toContain("handleComposerPaste");
    expect(chatPanelSource).toContain("ChatAttachmentChips");
    expect(chatPanelSource).toContain("移除附件");
    expect(styles).toContain(".chat-attachment-chip");
    expect(styles).toContain("height: 28px");
    expect(styles).toContain(".nav-update-status");
    expect(styles).toContain("padding-top: 118px;");
    expect(styles).toContain("top: 82px;");
    expect(styles).toContain(".app-shell.is-agent-chat .workspace-sidebar");
    expect(styles).toContain(".nav-update-action:focus-visible");
    expect(styles).toContain(".chat-attachment-chip > button:focus-visible");
    expect(chatPanelSource).toContain("attachmentAnnouncement");
    expect(chatPanelSource).toContain("getAttachmentPasteBlockedMessage");
    expect(chatPanelSource).toContain("setAttachmentError(blockedMessage)");
    expect(chatPanelSource).toContain("setAttachmentAnnouncement(blockedMessage)");
    expect(chatPanelSource).toContain("attachments: message.attachments");
    expect(chatPanelSource).toContain("rollbackFailedAttachmentTurn");
    expect(chatPanelSource).toContain("setComposerDraft(rawContent");
    expect(appSource).toContain("getAppUpdateAccessibleStatus");
    expect(appSource).toContain('className="nav-update-error-message" role="alert"');
    expect(styles).toContain(".nav-update-error-message");
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

  const effectStartIndex = Math.max(
    source.lastIndexOf("useEffect(() => {", endIndex),
    source.lastIndexOf("useLayoutEffect(() => {", endIndex),
  );
  if (effectStartIndex === -1) {
    return "";
  }

  return source.slice(effectStartIndex, endIndex + dependencyMarker.length);
}
