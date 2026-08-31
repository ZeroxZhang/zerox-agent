import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("preload bridge", () => {
  const preloadSource = readFileSync(
    path.join(process.cwd(), "src/preload/index.ts"),
    "utf8",
  );
  const mainSource = readFileSync(
    path.join(process.cwd(), "src/main/main.ts"),
    "utf8",
  );

  it("does not import shared modules at runtime in the sandboxed preload", () => {
    const sharedImports = preloadSource
      .split(";")
      .map((statement) => `${statement.trim()};`)
      .filter(
        (statement) =>
          statement.startsWith("import") && statement.includes('from "../shared/'),
      );
    const runtimeSharedImports = sharedImports.filter(
      (statement) => !statement.startsWith("import type"),
    );

    expect(runtimeSharedImports).toEqual([]);
    expect(preloadSource).toContain("import type");
    expect(preloadSource).toContain("const KERNEL_IPC");
  });

  it("exposes a local default-off Chat disclosure mode without adding IPC authority", () => {
    expect(preloadSource).toContain("getConversationDisclosureMode");
    expect(preloadSource).toContain(
      'process.argv.includes("--zerox-chat-disclosure=projected")',
    );
    expect(preloadSource).toContain('? "projected"');
    expect(preloadSource).toContain(': "legacy"');
    expect(mainSource).not.toContain("conversationDisclosure:getMode");
  });

  it("exposes chat session management operations through stable IPC channels", () => {
    expect(preloadSource).toContain("archiveChatSession");
    expect(preloadSource).toContain('ipcRenderer.invoke("chatSessions:archive"');
    expect(preloadSource).toContain("restoreChatSession");
    expect(preloadSource).toContain('ipcRenderer.invoke("chatSessions:restore"');
    expect(preloadSource).toContain("renameChatSession");
    expect(preloadSource).toContain('ipcRenderer.invoke("chatSessions:rename"');
    expect(preloadSource).toContain("deleteChatSession");
    expect(preloadSource).toContain('ipcRenderer.invoke("chatSessions:delete"');
  });

  it("routes git worktree creation through the user-approval request channel", () => {
    expect(preloadSource).toContain("createGitWorktreeAgentWorkspace");
    expect(preloadSource).toContain(
      'ipcRenderer.invoke("agentWorkspaces:requestGitWorktree"',
    );
    expect(preloadSource).not.toContain(
      'ipcRenderer.invoke("agentWorkspaces:createGitWorktree"',
    );
  });

  it("exposes workspace open and scratch creation through stable IPC channels", () => {
    expect(preloadSource).toContain("openProjectAgentWorkspace");
    expect(preloadSource).toContain("OpenProjectAgentWorkspaceInput");
    expect(preloadSource).toContain("input?: OpenProjectAgentWorkspaceInput");
    expect(preloadSource).toContain(
      'ipcRenderer.invoke("agentWorkspaces:openProject", input)',
    );
    expect(preloadSource).toContain("createTemporaryAgentWorkspace");
    expect(preloadSource).toContain(
      'ipcRenderer.invoke("agentWorkspaces:createTemporary"',
    );
  });

  it("exposes chat stream and guided input IPC bridge operations", () => {
    expect(preloadSource).toContain("onChatStreamEvent");
    expect(preloadSource).toContain("ipcRenderer.on(CHAT_IPC.streamEvent");
    expect(preloadSource).toContain("removeListener(CHAT_IPC.streamEvent");
    expect(preloadSource).toContain("respondSkillInput");
    expect(preloadSource).toContain(
      "ipcRenderer.invoke(CHAT_IPC.respondSkillInput",
    );
    expect(preloadSource).toContain("getChatSessionTranscriptPage");
    expect(preloadSource).toContain(
      'ipcRenderer.invoke("chatSessions:getTranscriptPage"',
    );
  });

  it("exposes source-bound trajectory paging instead of requiring full-history UI reads", () => {
    expect(preloadSource).toContain("getAgentRunTrajectoryPage");
    expect(preloadSource).toContain(
      'ipcRenderer.invoke("agentRuns:getTrajectoryPage", runId, options)',
    );
    const runsPanelSource = readFileSync(
      path.join(process.cwd(), "src/renderer/components/RunsPanel.tsx"),
      "utf8",
    );
    expect(runsPanelSource).toContain("getAgentRunTrajectoryPage");
    expect(runsPanelSource).not.toContain(".listAgentRunTrajectory(");
  });

  it("exposes a pull snapshot for subscribe-first tool approval recovery", () => {
    expect(preloadSource).toContain("getPendingToolApprovals");
    expect(preloadSource).toContain(
      'ipcRenderer.invoke("toolApproval:listPending")',
    );
    expect(mainSource).toContain('ipcMain.handle("toolApproval:listPending"');
    expect(mainSource).toContain("return observeAcceptanceIpc(");
    expect(mainSource).toContain('"toolApproval:listPending",');
    expect(mainSource).toContain(
      "() => toolApprovalCoordinator.pendingSnapshot()",
    );
    const handlerStart = mainSource.indexOf(
      'ipcMain.handle("toolApproval:listPending"',
    );
    const handlerEnd = mainSource.indexOf("});", handlerStart);
    expect(mainSource.slice(handlerStart, handlerEnd)).toContain(
      "assertTrustedRendererIpcEvent(event)",
    );
    expect(mainSource).not.toContain("toolApprovalCoordinator.republishPending()");
  });

  it("exposes app update state, retry, install, and event operations", () => {
    expect(preloadSource).toContain('ipcRenderer.invoke("app:getUpdateState"');
    expect(preloadSource).toContain('ipcRenderer.invoke("app:checkForUpdates"');
    expect(preloadSource).toContain('ipcRenderer.invoke("app:installUpdate"');
    expect(preloadSource).toContain('ipcRenderer.on("app:updateStateChanged"');
    expect(preloadSource).toContain('removeListener("app:updateStateChanged"');
  });

  it("exposes distinct final-acceptance recovery operations", () => {
    expect(preloadSource).toContain("continueGoalAcceptance");
    expect(preloadSource).toContain(
      'ipcRenderer.invoke("goal:continueAcceptance", goalId)',
    );
    expect(preloadSource).toContain("markGoalCompletedUnverified");
    expect(preloadSource).toContain(
      'ipcRenderer.invoke("goal:markCompletedUnverified", goalId)',
    );
  });

  it("exposes explicit provider test-save and credential-removal operations", () => {
    expect(preloadSource).toContain("testAndSaveProviderConnection");
    expect(preloadSource).toContain(
      'ipcRenderer.invoke("modelCatalog:testAndSaveConnection", input)',
    );
    expect(preloadSource).toContain("clearProviderCredential");
    expect(preloadSource).toContain(
      '"modelCatalog:clearConnectionCredential"',
    );
  });
});
