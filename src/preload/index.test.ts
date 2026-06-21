import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("preload bridge", () => {
  const preloadSource = readFileSync(
    path.join(process.cwd(), "src/preload/index.ts"),
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

  it("exposes chat session management operations through stable IPC channels", () => {
    expect(preloadSource).toContain("archiveChatSession");
    expect(preloadSource).toContain('ipcRenderer.invoke("chatSessions:archive"');
    expect(preloadSource).toContain("restoreChatSession");
    expect(preloadSource).toContain('ipcRenderer.invoke("chatSessions:restore"');
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
});
