import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Design System — Notion-inspired app shell", () => {
  const styles = readFileSync(
    path.join(process.cwd(), "src/renderer/styles.css"),
    "utf8",
  );
  const appSource = readFileSync(
    path.join(process.cwd(), "src/renderer/App.tsx"),
    "utf8",
  );
  const chatPanelSource = readFileSync(
    path.join(process.cwd(), "src/renderer/components/AgentChatPanel.tsx"),
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
  const goalPanelPath = path.join(
    process.cwd(),
    "src/renderer/components/GoalPanel.tsx",
  );
  const goalPanelSource = existsSync(goalPanelPath)
    ? readFileSync(goalPanelPath, "utf8")
    : "";

  it("defines comprehensive CSS custom property design tokens", () => {
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
    expect(appSource).toContain("sidebar");
    expect(appSource).toContain("nav-resize-handle");
    expect(appSource).toContain("aria-label=\"调整功能导航栏宽度\"");
    expect(appSource).toContain("material-brand"); // brand component class
    expect(appSource).toContain("material-nav-icon"); // icon wrapper class
    expect(appSource).toContain("workspace");
    expect(appSource).toContain("topbar");
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

  it("surfaces eval candidate generation from terminal Runs", () => {
    expect(runsPanelSource).toContain("Eval Candidate");
    expect(runsPanelSource).toContain("generateEvalCandidateForRun");
  });

  it("surfaces eval candidate review and promotion controls", () => {
    expect(existsSync(evalReviewPanelPath)).toBe(true);

    expect(evalReviewPanelSource).toContain("listEvalCandidates");
    expect(evalReviewPanelSource).toContain("promoteEvalCandidate");
  });

  it("surfaces Goal Mode review gates and controls", () => {
    expect(existsSync(goalPanelPath)).toBe(true);
    expect(appSource).toContain("GoalPanel");
    expect(goalPanelSource).toContain("createGoal");
    expect(goalPanelSource).toContain("listActiveGoals");
    expect(goalPanelSource).toContain("resolveGoalReview");
    expect(goalPanelSource).toContain("review-gate-card");
    expect(goalPanelSource).toContain("approve_continue");
    expect(goalPanelSource).toContain("modify_plan");
    expect(goalPanelSource).toContain("terminate");
    expect(overviewPanelSource).toContain("listActiveGoals");
    expect(overviewPanelSource).toContain("goalsWaitingForReview");
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
    expect(styles).toContain("--session-rail-width");
    expect(styles).toContain(".nav-resize-handle");
    expect(styles).toContain(".session-rail-resize-handle");
    expect(styles).toContain("grid-template-columns: minmax(520px, 1fr) var(--resize-handle-width) var(--session-rail-width)");
    expect(styles).toContain(".chat-message");
    expect(styles).toContain(".composer");
    expect(styles).toContain(".composer-input-shell");
    expect(styles).toContain(".composer-floating-actions");
    expect(styles).toContain(".composer-icon-button");
    expect(styles).toContain(".composer-icon-stop");
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
    expect(chatPanelSource).toContain("aria-label=\"工具权限\"");
    expect(chatPanelSource).toContain("aria-label=\"调整会话历史栏宽度\"");
    expect(chatPanelSource).toContain("aria-label=\"中断当前任务\"");
    expect(chatPanelSource).toContain("aria-label=\"发送消息\"");
    expect(chatPanelSource).toContain("className=\"composer-floating-actions\"");
    expect(chatPanelSource).toContain("disabled={!canCancelChatTask}");
    expect(chatPanelSource).toContain(
      "cancelChatMessage(activeChatRequestIdRef.current ?? undefined)",
    );
    expect(chatPanelSource).not.toContain(
      "disabled={status.kind !== \"working\" || !activeChatRequestId}",
    );
  });
});

function getFunctionSource(source: string, functionName: string): string {
  const marker = `async function ${functionName}`;
  const startIndex = source.indexOf(marker);
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
