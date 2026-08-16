import { describe, expect, it } from "vitest";
import { buildPrimaryRunContext } from "../shared/agentWorkspace";
import type { SkillRecord } from "../shared/skills";
import type { ToolDefinition } from "./openAiCompatibleClient";
import { createRuntimeContextSnapshotForRun } from "./runtimeContextFactory";

describe("runtime context factory", () => {
  it("projects chat runtime inputs without leaking model secrets", () => {
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: "/repo",
      runId: "run_1",
      sessionId: "session_1",
    });
    const modelProfile = {
      baseUrl: "https://models.local/v1",
      apiKey: "sk-secret-value",
      model: "gpt-local",
      temperature: 0.2,
      maxTokens: 4096,
      thinking: { type: "enabled" as const, budgetTokens: 512 },
    };

    const snapshot = createRuntimeContextSnapshotForRun({
      surface: "chat",
      runId: "run_1",
      runContext,
      modelProfile,
      tools: [
        toolDefinition("shell_exec"),
        toolDefinition("file_read"),
        toolDefinition("file_read"),
      ],
      getToolSource(toolName) {
        return toolName === "shell_exec" ? "native" : "mcp:filesystem";
      },
      selectedSkill: createSkillRecord(),
      permission: {
        taskId: "chat:session_1:request_1",
        runtimeTaskId: "runtime_task_1",
        approvalMode: "manual",
        policyLabel: "chat workspace contract",
      },
      memory: {
        scopes: [
          { kind: "session", id: "session_1" },
          { kind: "workspace", id: "workspace_1" },
        ],
        recallBudgetTokens: 1500,
        rawHistoryEnabled: true,
      },
      checkpoint: {
        strategy: "boundary",
        preserveToolPairs: true,
        protectSkillLoads: true,
      },
      trajectory: {
        workspaceRunId: "workspace_run_1",
        sessionId: "session_1",
        requestId: "request_1",
      },
      createId: () => "runtime_snapshot_1",
      now: () => "2026-06-28T14:30:00.000Z",
      systemTimeZone: "Asia/Shanghai",
    });

    expect(JSON.stringify(snapshot)).not.toContain("sk-secret-value");
    expect(snapshot).toMatchObject({
      snapshotId: "runtime_snapshot_1",
      surface: "chat",
      model: {
        providerId: "openai-compatible",
        modelId: "gpt-local",
        profile: "chat",
        capabilities: ["thinking", "tools"],
      },
      permissions: {
        taskId: "chat:session_1:request_1",
        runtimeTaskId: "runtime_task_1",
        approvalMode: "manual",
      },
      skill: {
        name: "onepager",
        manifestHash: "sha256:skill-onepager",
      },
      trajectory: {
        runId: "run_1",
        workspaceRunId: "workspace_run_1",
      },
    });
    expect(snapshot.tools.visible).toEqual([
      { name: "file_read", source: "mcp:filesystem", available: true },
      { name: "shell_exec", source: "native", available: true },
    ]);
    expect(snapshot.tools.sources).toEqual(["mcp:filesystem", "native"]);
  });

  it("keeps the tool schema hash stable when tool order changes", () => {
    const first = createRuntimeContextSnapshotForRun({
      surface: "scheduled_task",
      runId: "run_1",
      modelProfile: {
        model: "gpt-local",
      },
      tools: [toolDefinition("web_search"), toolDefinition("file_read")],
      permission: {
        taskId: "task_1",
        runtimeTaskId: "scheduled:task_1",
        approvalMode: "scheduled",
      },
      createId: () => "snapshot_a",
      now: () => "2026-06-28T14:30:00.000Z",
      systemTimeZone: "Asia/Shanghai",
    });
    const second = createRuntimeContextSnapshotForRun({
      surface: "scheduled_task",
      runId: "run_1",
      modelProfile: {
        model: "gpt-local",
      },
      tools: [toolDefinition("file_read"), toolDefinition("web_search")],
      permission: {
        taskId: "task_1",
        runtimeTaskId: "scheduled:task_1",
        approvalMode: "scheduled",
      },
      createId: () => "snapshot_b",
      now: () => "2026-06-28T14:30:00.000Z",
      systemTimeZone: "Asia/Shanghai",
    });

    expect(first.tools.schemaHash).toBe(second.tools.schemaHash);
    expect(first.workspace).toBeUndefined();
    expect(first.memory.scopes).toEqual([]);
    expect(first.checkpoint.strategy).toBe("summarize");
  });

  it("uses deterministic profile metadata for native goal pipeline snapshots", () => {
    const snapshot = createRuntimeContextSnapshotForRun({
      surface: "goal",
      runId: "goal_run_1",
      runContext: buildPrimaryRunContext({
        workspaceId: "workspace_1",
        workspaceRoot: "/repo",
        runId: "goal_run_1",
        goalId: "goal_1",
        milestoneId: "milestone_1",
      }),
      modelProfile: {
        model: "deterministic",
        providerId: "native",
        profile: "goal",
        capabilities: ["native_pipeline"],
      },
      tools: [toolDefinition("chrome_bookmarks_read")],
      permission: {
        taskId: "goal:goal_1",
        runtimeTaskId: "goal:goal_1:milestone_1",
        approvalMode: "scheduled",
      },
      memory: {
        scopes: [
          { kind: "goal", id: "goal_1" },
          { kind: "workspace", id: "workspace_1" },
        ],
      },
      trajectory: {
        sessionId: "session_1",
      },
      createId: () => "goal_snapshot_1",
      now: () => "2026-06-28T14:30:00.000Z",
      systemTimeZone: "Asia/Shanghai",
    });

    expect(snapshot.model).toEqual({
      providerId: "native",
      modelId: "deterministic",
      profile: "goal",
      capabilities: ["native_pipeline"],
    });
    expect(snapshot.trajectory).toMatchObject({
      runId: "goal_run_1",
      sessionId: "session_1",
    });
    expect(snapshot.memory.scopes).toEqual([
      { kind: "goal", id: "goal_1" },
      { kind: "workspace", id: "workspace_1" },
    ]);
  });
});

function toolDefinition(name: string): ToolDefinition {
  return {
    type: "function",
    function: {
      name,
      description: `${name} description`,
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  };
}

function createSkillRecord(): SkillRecord & {
  resources: Array<{
    kind: "skill";
    path: string;
    sha256: string;
  }>;
} {
  return {
    rootDir: "/skills/onepager",
    skillFile: "/skills/onepager/SKILL.md",
    body: "# Onepager",
    manifest: {
      name: "onepager",
      displayName: "Onepager",
      description: "Create one-page reports.",
      version: "1.0.0",
      inputs: [],
      permissions: {
        files: {
          read: ["{{skillRoot}}/references"],
          write: [],
        },
        shell: {
          commands: [],
        },
        web: {
          search: false,
          fetchDomains: [],
        },
        memory: {
          read: true,
          write: false,
        },
      },
      execution: {
        mode: "agent",
        entrypoint: null,
        maxTurns: 4,
      },
    },
    resources: [
      {
        kind: "skill",
        path: "/skills/onepager/SKILL.md",
        sha256: "sha256:skill-onepager",
      },
    ],
  };
}
