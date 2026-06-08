import { describe, expect, it } from "vitest";
import {
  buildChildRunContext,
  buildDefaultSandboxPolicy,
  buildPrimaryRunContext,
  isPathInsideRunContext,
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
    });

    expect(context).toMatchObject({
      workspaceId: "workspace_default",
      workspaceRoot: "/tmp/zerox/workspace",
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
});
