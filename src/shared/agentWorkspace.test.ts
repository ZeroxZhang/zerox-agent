import { describe, expect, it } from "vitest";
import {
  buildChildRunContext,
  buildDefaultSandboxPolicy,
  buildPrimaryRunContext,
  isPathInsideRunContext,
  toWorkspaceContract,
  type AgentWorkspace,
} from "./agentWorkspace";

describe("agent workspace model", () => {
  it("builds a default workspace-write sandbox without workspace escape", () => {
    expect(buildDefaultSandboxPolicy()).toEqual({
      mode: "workspace_write",
      network: "task_policy",
      shell: "approved_commands",
      allowWorkspaceEscape: false,
      extraReadRoots: [],
      extraWriteRoots: [],
    });
  });

  it("creates a primary run context with depth zero", () => {
    const context = buildPrimaryRunContext({
      workspaceId: "workspace_default",
      workspaceRoot: "/tmp/zerox/workspace",
      runId: "run_1",
      goalId: "goal_1",
      milestoneId: "milestone_1",
    });

    expect(context).toMatchObject({
      workspaceId: "workspace_default",
      workspaceRoot: "/tmp/zerox/workspace",
      runId: "run_1",
      goalId: "goal_1",
      milestoneId: "milestone_1",
      agentRole: "primary",
      depth: 0,
    });
  });

  it("creates a narrowed child run context", () => {
    const parent = buildPrimaryRunContext({
      workspaceId: "workspace_default",
      workspaceRoot: "/tmp/zerox/workspace",
      sessionId: "session_1",
    });

    expect(
      buildChildRunContext(parent, {
        parentRunId: "run_parent",
        agentRole: "executor",
      }),
    ).toMatchObject({
      workspaceId: "workspace_default",
      workspaceRoot: "/tmp/zerox/workspace",
      sessionId: "session_1",
      parentRunId: "run_parent",
      agentRole: "executor",
      depth: 1,
    });
  });

  it("checks workspace path boundaries without prefix confusion", () => {
    const context = buildPrimaryRunContext({
      workspaceId: "workspace_default",
      workspaceRoot: "/tmp/work",
    });

    expect(isPathInsideRunContext("/tmp/work/report.md", context, "write")).toBe(
      true,
    );
    expect(
      isPathInsideRunContext("/tmp/workspace/report.md", context, "write"),
    ).toBe(false);
  });

  it("allows extra read roots without widening writes", () => {
    const context = buildPrimaryRunContext({
      workspaceId: "workspace_default",
      workspaceRoot: "/tmp/work",
      sandbox: {
        ...buildDefaultSandboxPolicy(),
        extraReadRoots: ["/Users/demo/Documents"],
      },
    });

    expect(
      isPathInsideRunContext(
        "/Users/demo/Documents/brief.md",
        context,
        "read",
      ),
    ).toBe(true);
    expect(
      isPathInsideRunContext(
        "/Users/demo/Documents/brief.md",
        context,
        "write",
      ),
    ).toBe(false);
  });

  it("does not expose writable roots for read-only run contexts", () => {
    const context = buildPrimaryRunContext({
      workspaceId: "workspace_default",
      workspaceRoot: "/tmp/work",
      sandbox: {
        ...buildDefaultSandboxPolicy(),
        mode: "read_only",
      },
    });
    const workspace: AgentWorkspace = {
      id: "workspace_default",
      name: "Default",
      rootPath: "/tmp/work",
      kind: "default",
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z",
      lastUsedAt: null,
      cleanup: "keep",
    };

    expect(isPathInsideRunContext("/tmp/work/report.md", context, "write")).toBe(
      false,
    );
    expect(toWorkspaceContract(workspace, context).writableRoots).toEqual([]);
  });

  it("canonicalizes primary run context extra write roots with injected home", () => {
    const context = buildPrimaryRunContext({
      workspaceId: "workspace_default",
      workspaceRoot: "/Users/demo/project",
      locationEnv: { homeDir: "/Users/demo", platform: "darwin" },
      sandbox: {
        ...buildDefaultSandboxPolicy(),
        extraWriteRoots: ["~/Desktop"],
      },
    });

    expect(context.sandbox.extraWriteRoots).toEqual(["/Users/demo/Desktop"]);
  });

  it("treats Desktop aliases as inside only when Desktop is an explicit extra root", () => {
    const context = buildPrimaryRunContext({
      workspaceId: "workspace_default",
      workspaceRoot: "/Users/demo/project",
      locationEnv: { homeDir: "/Users/demo", platform: "darwin" },
      sandbox: {
        ...buildDefaultSandboxPolicy(),
        extraWriteRoots: ["~/Desktop"],
      },
    });
    const workspaceOnlyContext = buildPrimaryRunContext({
      workspaceId: "workspace_default",
      workspaceRoot: "/Users/demo/project",
      locationEnv: { homeDir: "/Users/demo", platform: "darwin" },
    });

    for (const candidate of [
      "~/Desktop/a.md",
      "Desktop/a.md",
      "桌面/a.md",
      "/Users/demo/Desktop/a.md",
    ]) {
      expect(isPathInsideRunContext(candidate, context, "write")).toBe(true);
      expect(isPathInsideRunContext(candidate, workspaceOnlyContext, "write")).toBe(
        false,
      );
    }
  });
});
