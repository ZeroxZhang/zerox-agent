import { describe, expect, it } from "vitest";
import { buildPrimaryRunContext } from "./agentWorkspace";
import {
  createAgentRuntimeContextSnapshot,
  projectSnapshotToExecutionContextPackage,
  summarizeAgentRuntimeContextSnapshot,
} from "./agentRuntimeContext";

describe("agent runtime context snapshot", () => {
  it("captures a secret-safe JSON runtime spine for a tool-bearing chat run", () => {
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: "/repo",
      runId: "run_1",
      sessionId: "session_1",
      sandbox: {
        mode: "workspace_write",
        network: "task_policy",
        shell: "workspace_only",
        allowWorkspaceEscape: false,
        extraReadRoots: ["/repo/docs", "/repo/docs"],
        extraWriteRoots: ["/repo/out"],
      },
    });

    const snapshot = createAgentRuntimeContextSnapshot({
      snapshotId: "runtime_snapshot_1",
      runId: "run_1",
      surface: "chat",
      model: {
        providerId: "openai-compatible",
        modelId: "gpt-local",
        profile: "chat",
        capabilities: ["tools", "streaming", "tools"],
      },
      time: {
        anchoredAt: "2026-06-28T14:00:00.000Z",
        timezone: "Asia/Shanghai",
      },
      runContext,
      permissions: {
        taskId: "chat:session_1:request_1",
        runtimeTaskId: "runtime_task_1",
        approvalMode: "manual",
        policyLabel: "chat workspace contract",
      },
      tools: {
        visible: [
          { name: "file_read", source: "native", available: true },
          { name: "file_read", source: "native", available: true },
          { name: "shell_exec", source: "native", available: false },
        ],
      },
      skill: {
        name: "onepager",
        displayName: "Onepager",
        rootDir: "/skills/onepager",
        manifestHash: "sha256:skill",
        resources: [
          {
            kind: "skill",
            path: "/skills/onepager/SKILL.md",
            sha256: "sha256:skill-md",
          },
        ],
      },
      memory: {
        scopes: [
          { kind: "session", id: "session_1" },
          { kind: "workspace", id: "workspace_1" },
          { kind: "workspace", id: "workspace_1" },
          { kind: "skill", id: "onepager" },
        ],
        recallBudgetTokens: 1800,
        rawHistoryEnabled: true,
      },
      checkpoint: {
        strategy: "boundary",
        preserveToolPairs: true,
        protectSkillLoads: true,
        checkpointId: "checkpoint_1",
        boundaryId: "boundary_1",
      },
      trajectory: {
        runId: "run_1",
        workspaceRunId: "workspace_run_1",
        sessionId: "session_1",
        requestId: "request_1",
      },
      createdAt: "2026-06-28T14:00:00.000Z",
    });

    const roundTripped = JSON.parse(JSON.stringify(snapshot));

    expect(roundTripped).toEqual(snapshot);
    expect(JSON.stringify(snapshot)).not.toMatch(/apiKey|secret|sk-/i);
    expect(snapshot.workspace).toMatchObject({
      workspaceId: "workspace_1",
      workspaceRoot: "/repo",
      sandboxMode: "workspace_write",
      shell: "workspace_only",
      network: "task_policy",
      readRoots: ["/repo", "/repo/docs", "/repo/out"],
      writeRoots: ["/repo", "/repo/out"],
    });
    expect(snapshot.tools.visible).toEqual([
      { name: "file_read", source: "native", available: true },
      { name: "shell_exec", source: "native", available: false },
    ]);
    expect(snapshot.tools.schemaHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(snapshot.model.capabilities).toEqual(["streaming", "tools"]);
    expect(snapshot.memory.scopes).toEqual([
      { kind: "session", id: "session_1" },
      { kind: "workspace", id: "workspace_1" },
      { kind: "skill", id: "onepager" },
    ]);
    expect(summarizeAgentRuntimeContextSnapshot(snapshot)).toEqual({
      snapshotId: "runtime_snapshot_1",
      runId: "run_1",
      surface: "chat",
      workspaceId: "workspace_1",
      workspaceRoot: "/repo",
      skillName: "onepager",
      visibleToolCount: 1,
      toolSchemaHash: snapshot.tools.schemaHash,
      memoryScopes: ["session:session_1", "workspace:workspace_1", "skill:onepager"],
      permissionTaskId: "chat:session_1:request_1",
      checkpointStrategy: "boundary",
    });
  });

  it("projects snapshots back to the existing ExecutionContextPackage contract", () => {
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_scheduled",
      workspaceRoot: "/repo",
      runId: "run_scheduled",
      sandbox: {
        mode: "read_only",
        network: "approved_domains",
        shell: "disabled",
        allowWorkspaceEscape: false,
        extraReadRoots: ["/repo/reference"],
        extraWriteRoots: [],
      },
    });
    const snapshot = createAgentRuntimeContextSnapshot({
      snapshotId: "runtime_snapshot_scheduled",
      runId: "run_scheduled",
      surface: "scheduled_task",
      model: {
        providerId: "openai-compatible",
        modelId: "gpt-local",
        profile: "scheduled",
        capabilities: ["tools"],
      },
      time: {
        anchoredAt: "2026-06-28T14:00:00.000Z",
        timezone: "Asia/Shanghai",
      },
      runContext,
      permissions: {
        taskId: "task_123",
        runtimeTaskId: "runtime_task_123",
        approvalMode: "scheduled",
      },
      tools: {
        visible: [{ name: "web_search", source: "native", available: true }],
      },
      memory: {
        scopes: [{ kind: "project", id: "project_1" }],
        recallBudgetTokens: 1000,
        rawHistoryEnabled: false,
      },
      checkpoint: {
        strategy: "summarize",
        preserveToolPairs: true,
        protectSkillLoads: true,
      },
      trajectory: {
        runId: "run_scheduled",
      },
      createdAt: "2026-06-28T14:00:00.000Z",
    });

    expect(projectSnapshotToExecutionContextPackage(snapshot)).toMatchObject({
      packageId: "runtime_snapshot_scheduled",
      runId: "run_scheduled",
      surface: "scheduled",
      workspace: {
        workspaceId: "workspace_scheduled",
        workspaceRoot: "/repo",
        sandboxMode: "read_only",
        network: "approved_domains",
        shell: "disabled",
      },
      permissions: {
        interactive: false,
        failClosedOnAsk: true,
      },
      tools: {
        visible: [{ name: "web_search", source: "native", available: true }],
      },
      memory: {
        scopes: [{ kind: "project", id: "project_1" }],
      },
    });
  });
});
