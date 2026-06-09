import { describe, expect, it } from "vitest";
import { createAgentRuntimeEngine } from "./agentRuntimeEngine";
import type { AgentExecutionStore } from "./agentExecutionStore";
import type { AgentLearningStore } from "./agentLearningStore";
import type { AgentRunStore } from "./agentRunStore";
import type { AgentToolExecutor } from "./agentToolExecutor";
import type { AgentTrajectoryStore } from "./agentTrajectoryStore";
import { createDynamicToolRegistry } from "./dynamicToolRegistry";
import type {
  ChatClient,
  ChatCompletionResponse,
  ChatMessage,
} from "./openAiCompatibleClient";
import type { ScheduledTaskStore } from "./taskStore";
import type {
  ToolResultOffloadStore,
  ToolResultOffloadWriteInput,
} from "./toolResultOffloadStore";
import type { ToolAuthorizationService } from "./toolAuthorizationService";
import type { AgentExecutionCheckpoint } from "../shared/agentExecution";
import {
  buildPrimaryRunContext,
  type AgentRunContext,
} from "../shared/agentWorkspace";
import type {
  AgentLearningCandidate,
  AgentLearningCandidateInput,
} from "../shared/agentLearning";
import type { AgentRunRecord } from "../shared/agentRuns";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";
import type { MemoryInput, MemoryRecord, MemorySearchResult } from "../shared/memory";
import type { ScheduledTask } from "../shared/scheduledTasks";
import type { SkillRecord } from "../shared/skills";
import { defineNativeToolDescriptor } from "../shared/nativeCapabilities";
import { getDefaultTaskPermissionPolicy } from "../shared/toolPermissions";

describe("agent runtime engine", () => {
  it("offloads oversized tool results in checkpoints and trajectory metadata", async () => {
    const largeContent = "x".repeat(1000);
    const capturedMessages: ChatMessage[][] = [];
    const savedCheckpoints: AgentExecutionCheckpoint[] = [];
    const trajectoryEvents: AgentTrajectoryEvent[] = [];
    const store = createRecordingOffloadStore();
    const engine = createAgentRuntimeEngine({
      taskStore: createTaskStore(createTask()),
      runStore: createMemoryRunStore(),
      executionStore: createMemoryExecutionStore(savedCheckpoints),
      trajectoryStore: createMemoryTrajectoryStore(trajectoryEvents),
      resolveSkill: async () => createSkillRecord(),
      chatClient: {
        async complete(request) {
          capturedMessages.push(request.messages);
          if (capturedMessages.length === 1) {
            return toolCallResponse("file_read", { path: "~/Downloads/notes.md" });
          }
          return finalResponse("Report complete");
        },
      },
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(true),
      toolExecutor: {
        async execute() {
          return {
            ok: true,
            result: { content: largeContent },
          };
        },
      },
      toolResultOffloadStore: store,
      toolResultOffloadThreshold: 120,
      createId: createSequentialId("runtime_offload"),
      now: createSteppedClock("2026-06-07T00:00:00.000Z"),
    });

    await engine.startTask("task_123");

    const toolMessage = capturedMessages[1].find(
      (message) => message.role === "tool",
    );
    expect(toolMessage?.content).not.toContain(largeContent);
    expect(JSON.parse(toolMessage?.content ?? "{}")).toEqual(
      expect.objectContaining({
        type: "tool_result",
        tool: "file_read",
        ok: true,
        offloaded: true,
        result_ref: "tool-result-refs/ref_1.json",
      }),
    );
    expect(savedCheckpoints[2].messages).toContainEqual(
      expect.objectContaining({
        role: "tool",
        content: expect.stringContaining('"offloaded":true'),
      }),
    );
    expect(trajectoryEvents).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        payload: expect.objectContaining({
          offloaded: true,
          resultRef: "tool-result-refs/ref_1.json",
        }),
        redaction: expect.objectContaining({
          containsFileContent: false,
        }),
      }),
    );
    expect(store.writes[0].content).toContain(largeContent);
  });

  it("runs a task, executes an authorized tool, and writes durable checkpoints", async () => {
    const savedCheckpoints: AgentExecutionCheckpoint[] = [];
    const executedTools: string[] = [];
    const runStore = createMemoryRunStore();
    const engine = createAgentRuntimeEngine({
      taskStore: createTaskStore(createTask()),
      runStore,
      executionStore: createMemoryExecutionStore(savedCheckpoints),
      resolveSkill: async () => createSkillRecord(),
      chatClient: createChatClient([
        toolCallResponse("file_read", { path: "~/Downloads/notes.md" }),
        finalResponse("Report complete"),
      ]),
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(true),
      toolExecutor: createToolExecutor(executedTools),
      createId: createSequentialId("runtime"),
      now: createSteppedClock("2026-06-07T00:00:00.000Z"),
    });

    const result = await engine.startTask("task_123");

    expect(result).toMatchObject({
      ok: true,
      run: {
        id: "runtime_1",
        taskId: "task_123",
        status: "succeeded",
        summary: "Report complete",
      },
    });
    expect(executedTools).toEqual(["file_read"]);
    expect(runStore.runs).toHaveLength(1);
    expect(savedCheckpoints.map((checkpoint) => checkpoint.status)).toEqual([
      "queued",
      "running",
      "running",
      "succeeded",
    ]);
    expect(savedCheckpoints.at(-1)).toMatchObject({
      runId: "runtime_1",
      taskId: "task_123",
      status: "succeeded",
      toolCallCount: 1,
    });
  });

  it("marks the current runtime step completed when the run succeeds", async () => {
    const savedCheckpoints: AgentExecutionCheckpoint[] = [];
    const engine = createAgentRuntimeEngine({
      taskStore: createTaskStore(createTask()),
      runStore: createMemoryRunStore(),
      executionStore: createMemoryExecutionStore(savedCheckpoints),
      resolveSkill: async () => createSkillRecord(),
      chatClient: createChatClient([finalResponse("Report complete")]),
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(true),
      toolExecutor: createToolExecutor([]),
      createId: createSequentialId("step_state"),
      now: createSteppedClock("2026-06-07T00:00:00.000Z"),
    });

    const result = await engine.startTask("task_123");

    expect(result).toMatchObject({
      ok: true,
      run: {
        status: "succeeded",
      },
    });
    expect(savedCheckpoints.at(-1)?.steps[0]).toMatchObject({
      state: "completed",
      attempts: 1,
      startedAt: "2026-06-07T00:02:00.000Z",
      finishedAt: "2026-06-07T00:04:00.000Z",
    });
  });

  it("classifies denied tool calls and stores the failed run", async () => {
    const savedCheckpoints: AgentExecutionCheckpoint[] = [];
    const runStore = createMemoryRunStore();
    const engine = createAgentRuntimeEngine({
      taskStore: createTaskStore(createTask()),
      runStore,
      executionStore: createMemoryExecutionStore(savedCheckpoints),
      resolveSkill: async () => createSkillRecord(),
      chatClient: createChatClient([
        toolCallResponse("file_write", { path: "/private/out.md", content: "x" }),
      ]),
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(false),
      toolExecutor: createToolExecutor([]),
      createId: createSequentialId("runtime"),
      now: createSteppedClock("2026-06-07T00:00:00.000Z"),
    });

    const result = await engine.startTask("task_123");

    expect(result).toMatchObject({
      ok: true,
      run: {
        status: "failed",
        failureClass: "permission_denied",
        failureMessage: "工具调用被拒绝：denied by policy",
      },
    });
    expect(runStore.runs[0]).toMatchObject({
      status: "failed",
      failureClass: "permission_denied",
    });
    expect(savedCheckpoints.at(-1)).toMatchObject({
      status: "failed",
    });
  });

  it("pauses an interrupted run and keeps the checkpoint active", async () => {
    const savedCheckpoints: AgentExecutionCheckpoint[] = [];
    const controller = new AbortController();
    controller.abort("pause");
    const executionStore = createMemoryExecutionStore(savedCheckpoints);
    const engine = createAgentRuntimeEngine({
      taskStore: createTaskStore(createTask()),
      runStore: createMemoryRunStore(),
      executionStore,
      resolveSkill: async () => createSkillRecord(),
      chatClient: createChatClient([finalResponse("unused")]),
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(true),
      toolExecutor: createToolExecutor([]),
      createId: createSequentialId("pause"),
      now: createSteppedClock("2026-06-07T00:00:00.000Z"),
    });

    const result = await engine.startTask("task_123", {
      signal: controller.signal,
    });

    expect(result).toMatchObject({
      ok: true,
      run: {
        id: "pause_1",
        status: "paused",
        summary: "运行已暂停。",
      },
    });
    expect(savedCheckpoints.at(-1)).toMatchObject({
      runId: "pause_1",
      status: "paused",
    });
    await expect(executionStore.listActive()).resolves.toEqual([
      expect.objectContaining({
        runId: "pause_1",
        status: "paused",
      }),
    ]);
  });

  it("records trajectory events for model, tool, checkpoint, and final summary boundaries", async () => {
    const trajectoryEvents: AgentTrajectoryEvent[] = [];
    const engine = createAgentRuntimeEngine({
      taskStore: createTaskStore(createTask()),
      runStore: createMemoryRunStore(),
      executionStore: createMemoryExecutionStore([]),
      trajectoryStore: createMemoryTrajectoryStore(trajectoryEvents),
      resolveSkill: async () => createSkillRecord(),
      chatClient: createChatClient([
        toolCallResponse("file_read", { path: "~/Downloads/notes.md" }),
        finalResponse("Report complete"),
      ]),
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(true),
      toolExecutor: createToolExecutor([]),
      createId: createSequentialId("trajectory"),
      now: createSteppedClock("2026-06-07T00:00:00.000Z"),
    });

    await engine.startTask("task_123");

    expect(trajectoryEvents.map((event) => event.type)).toEqual([
      "state_transition",
      "checkpoint_written",
      "state_transition",
      "checkpoint_written",
      "model_request",
      "model_response",
      "tool_call",
      "tool_result",
      "checkpoint_written",
      "model_request",
      "model_response",
      "final_summary",
      "state_transition",
      "checkpoint_written",
    ]);
    expect(trajectoryEvents.every((event) => event.runId === "trajectory_1")).toBe(
      true,
    );
    expect(trajectoryEvents.every((event) => event.redaction.containsApiKey === false)).toBe(
      true,
    );
  });

  it("records native tool invocation and observation events from registry metadata", async () => {
    const trajectoryEvents: AgentTrajectoryEvent[] = [];
    const registry = createDynamicToolRegistry();
    registry.register(
      {
        type: "function",
        function: {
          name: "code_search",
          description: "Search code",
          parameters: {
            type: "object",
            properties: {
              workspaceRoot: { type: "string" },
              query: { type: "string" },
            },
            required: ["workspaceRoot", "query"],
          },
        },
      },
      async () => ({
        ok: true,
        result: { results: [{ relativePath: "src/main.ts" }] },
      }),
      "test",
      defineNativeToolDescriptor({
        id: "code_search",
        kind: "code",
        label: "Code Search",
        description: "Search code through native registry metadata.",
        riskLevel: "low",
        permissionScope: { files: "read", shell: "none", web: "none" },
        observableEvents: ["native_tool_invocation", "native_tool_observation"],
      }),
    );
    const engine = createAgentRuntimeEngine({
      taskStore: createTaskStore(createTask()),
      runStore: createMemoryRunStore(),
      executionStore: createMemoryExecutionStore([]),
      trajectoryStore: createMemoryTrajectoryStore(trajectoryEvents),
      resolveSkill: async () => createSkillRecord(),
      chatClient: createChatClient([
        toolCallResponse("code_search", {
          workspaceRoot: "/repo",
          query: "createAgentRuntimeEngine",
        }),
        finalResponse("Report complete"),
      ]),
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(true),
      toolExecutor: {
        async execute(request) {
          return registry.execute(request.toolName, request.args);
        },
        getRegistry() {
          return registry;
        },
        hasTool(toolName) {
          return registry.has(toolName);
        },
      },
      createId: createSequentialId("native_trajectory"),
      now: createSteppedClock("2026-06-07T00:00:00.000Z"),
    });

    await engine.startTask("task_123");

    expect(trajectoryEvents.map((event) => event.type)).toEqual([
      "state_transition",
      "checkpoint_written",
      "state_transition",
      "checkpoint_written",
      "model_request",
      "model_response",
      "tool_call",
      "native_tool_invocation",
      "native_tool_observation",
      "tool_result",
      "checkpoint_written",
      "model_request",
      "model_response",
      "final_summary",
      "state_transition",
      "checkpoint_written",
    ]);
    expect(trajectoryEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "native_tool_invocation",
          payload: expect.objectContaining({
            toolCallId: "call_1",
            toolName: "code_search",
            nativeKind: "code",
            riskLevel: "low",
          }),
        }),
        expect.objectContaining({
          type: "native_tool_observation",
          payload: expect.objectContaining({
            toolCallId: "call_1",
            toolName: "code_search",
            nativeKind: "code",
            riskLevel: "low",
            ok: true,
          }),
        }),
      ]),
    );
  });

  it("extracts learning candidates from completed trajectories", async () => {
    const trajectoryEvents: AgentTrajectoryEvent[] = [];
    const learningInputs: AgentLearningCandidateInput[] = [];
    const engine = createAgentRuntimeEngine({
      taskStore: createTaskStore(createTask()),
      runStore: createMemoryRunStore(),
      executionStore: createMemoryExecutionStore([]),
      trajectoryStore: createMemoryTrajectoryStore(trajectoryEvents),
      learningStore: createMemoryLearningStore(learningInputs),
      resolveSkill: async () => createSkillRecord(),
      chatClient: createChatClient([
        toolCallResponse("file_list", { path: "~/Downloads" }),
        toolCallResponse("file_read", { path: "~/Downloads/notes.md" }),
        finalResponse("Report complete"),
      ]),
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(true),
      toolExecutor: createToolExecutor([]),
      createId: createSequentialId("learning"),
      now: createSteppedClock("2026-06-07T00:00:00.000Z"),
    });

    await engine.startTask("task_123");

    expect(learningInputs).toEqual([
      expect.objectContaining({
        type: "procedural_memory",
        sourceRunId: "learning_1",
        claim:
          "Successful run used tool sequence: file_list -> file_read.",
      }),
    ]);
  });

  it("injects relevant procedural memories into the next run", async () => {
    const capturedMessages: string[] = [];
    const engine = createAgentRuntimeEngine({
      taskStore: createTaskStore(createTask()),
      runStore: createMemoryRunStore(),
      executionStore: createMemoryExecutionStore([]),
      resolveSkill: async () => createSkillRecord(),
      chatClient: {
        async complete(request) {
          capturedMessages.push(request.messages.map((message) => message.content).join("\n"));
          return finalResponse("Report complete");
        },
      },
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(true),
      toolExecutor: createToolExecutor([]),
      memoryStore: createMemoryStoreWithSearch([
        createProceduralMemorySearchResult(
          "先使用 file_list 了解目录，再读取候选文件。",
        ),
      ]),
      createId: createSequentialId("memory"),
      now: createSteppedClock("2026-06-07T00:00:00.000Z"),
    });

    await engine.startTask("task_123");

    expect(capturedMessages[0]).toContain("相关流程记忆");
    expect(capturedMessages[0]).toContain("先使用 file_list 了解目录，再读取候选文件。");
  });

  it("stores run context in checkpoints, run records, and trajectory events", async () => {
    const savedCheckpoints: AgentExecutionCheckpoint[] = [];
    const trajectoryEvents: AgentTrajectoryEvent[] = [];
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: "/tmp/zerox/workspace",
    });
    const runStore = createMemoryRunStore();
    const engine = createAgentRuntimeEngine({
      taskStore: createTaskStore(createTask()),
      runStore,
      executionStore: createMemoryExecutionStore(savedCheckpoints),
      trajectoryStore: createMemoryTrajectoryStore(trajectoryEvents),
      workspaceService: createWorkspaceService(runContext),
      resolveSkill: async () => createSkillRecord(),
      chatClient: createChatClient([finalResponse("Report complete")]),
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(true),
      toolExecutor: createToolExecutor([]),
      createId: createSequentialId("context"),
      now: createSteppedClock("2026-06-07T00:00:00.000Z"),
    });

    const result = await engine.startTask("task_123");

    expect(result).toMatchObject({
      ok: true,
      run: {
        runContext,
      },
    });
    expect(savedCheckpoints.every((checkpoint) => checkpoint.runContext)).toBe(
      true,
    );
    expect(trajectoryEvents[0]).toMatchObject({
      type: "run_context_created",
      runContext,
      payload: {
        workspaceId: "workspace_1",
        workspaceRoot: "/tmp/zerox/workspace",
        agentRole: "primary",
      },
    });
  });

  it("passes run context to authorization and tool execution", async () => {
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: "/tmp/zerox/workspace",
    });
    const authorizationContexts: Array<AgentRunContext | undefined> = [];
    const toolContexts: Array<AgentRunContext | undefined> = [];
    const engine = createAgentRuntimeEngine({
      taskStore: createTaskStore(createTask()),
      runStore: createMemoryRunStore(),
      executionStore: createMemoryExecutionStore([]),
      workspaceService: createWorkspaceService(runContext),
      resolveSkill: async () => createSkillRecord(),
      chatClient: createChatClient([
        toolCallResponse("file_read", { path: "/tmp/zerox/workspace/notes.md" }),
        finalResponse("Report complete"),
      ]),
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: {
        async authorize(_taskId, _request, options) {
          authorizationContexts.push(options?.runContext);
          return createAuthorizationService(true).authorize(_taskId, _request);
        },
      },
      toolExecutor: {
        async execute(request, options) {
          toolContexts.push(options?.runContext);
          return createToolExecutor([]).execute(request);
        },
      },
      createId: createSequentialId("context_tool"),
      now: createSteppedClock("2026-06-07T00:00:00.000Z"),
    });

    await engine.startTask("task_123");

    expect(authorizationContexts).toEqual([runContext]);
    expect(toolContexts).toEqual([runContext]);
  });

  it("passes the abort signal to runtime tool execution", async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const engine = createAgentRuntimeEngine({
      taskStore: createTaskStore(createTask()),
      runStore: createMemoryRunStore(),
      executionStore: createMemoryExecutionStore([]),
      resolveSkill: async () => createSkillRecord(),
      chatClient: createChatClient([
        toolCallResponse("file_read", { path: "~/Downloads/notes.md" }),
        finalResponse("Report complete"),
      ]),
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(true),
      toolExecutor: {
        async execute(_request, options) {
          receivedSignal = options?.signal;
          return {
            ok: true,
            result: { content: "notes" },
          };
        },
      },
      createId: createSequentialId("signal"),
      now: createSteppedClock("2026-06-07T00:00:00.000Z"),
    });

    await engine.startTask("task_123", { signal: controller.signal });

    expect(receivedSignal).toBe(controller.signal);
  });

  it("checkpoints waiting_for_approval while tool authorization is pending", async () => {
    const savedCheckpoints: AgentExecutionCheckpoint[] = [];
    const engine = createAgentRuntimeEngine({
      taskStore: createTaskStore(createTask()),
      runStore: createMemoryRunStore(),
      executionStore: createMemoryExecutionStore(savedCheckpoints),
      resolveSkill: async () => createSkillRecord(),
      chatClient: createChatClient([
        toolCallResponse("file_read", { path: "~/Downloads/notes.md" }),
        finalResponse("Report complete"),
      ]),
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: {
        async authorize(_taskId, request, options) {
          const lifecycle = options as {
            onApprovalRequested?: () => Promise<void>;
            onApprovalResolved?: () => Promise<void>;
          } | undefined;
          await lifecycle?.onApprovalRequested?.();
          await lifecycle?.onApprovalResolved?.();
          return {
            ok: true,
            decision: {
              allowed: true,
              reason: "approved after prompt",
            },
            auditEvent: {
              id: "audit_approval",
              taskId: "task_123",
              request,
              decision: {
                allowed: true,
                reason: "approved after prompt",
              },
              createdAt: "2026-06-07T00:00:00.000Z",
            },
          };
        },
      },
      toolExecutor: createToolExecutor([]),
      createId: createSequentialId("approval"),
      now: createSteppedClock("2026-06-07T00:00:00.000Z"),
    });

    await engine.startTask("task_123");

    expect(savedCheckpoints.map((checkpoint) => checkpoint.status)).toContain(
      "waiting_for_approval",
    );
    expect(savedCheckpoints.map((checkpoint) => checkpoint.status)).toEqual(
      expect.arrayContaining(["running", "waiting_for_approval", "succeeded"]),
    );
  });

  it("records workspace escape denials before failing the run", async () => {
    const trajectoryEvents: AgentTrajectoryEvent[] = [];
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: "/tmp/zerox/workspace",
    });
    const engine = createAgentRuntimeEngine({
      taskStore: createTaskStore(createTask()),
      runStore: createMemoryRunStore(),
      executionStore: createMemoryExecutionStore([]),
      trajectoryStore: createMemoryTrajectoryStore(trajectoryEvents),
      workspaceService: createWorkspaceService(runContext),
      resolveSkill: async () => createSkillRecord(),
      chatClient: createChatClient([
        toolCallResponse("file_write", {
          path: "/tmp/outside/report.md",
          content: "done",
        }),
      ]),
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: {
        async authorize() {
          return {
            ok: true,
            decision: {
              allowed: false,
              reason:
                "file_write 被运行沙箱阻止：路径不在工作区或额外可写目录内。",
            },
            auditEvent: {
              id: "audit_1",
              taskId: "task_123",
              request: {
                toolName: "file_write",
                args: {},
              },
              decision: {
                allowed: false,
                reason:
                  "file_write 被运行沙箱阻止：路径不在工作区或额外可写目录内。",
              },
              createdAt: "2026-06-07T00:00:00.000Z",
            },
          };
        },
      },
      toolExecutor: createToolExecutor([]),
      createId: createSequentialId("escape"),
      now: createSteppedClock("2026-06-07T00:00:00.000Z"),
    });

    const result = await engine.startTask("task_123");

    expect(result).toMatchObject({
      ok: true,
      run: {
        status: "failed",
        failureClass: "permission_denied",
      },
    });
    expect(trajectoryEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "workspace_escape_denied",
          runContext,
          payload: expect.objectContaining({
            toolName: "file_write",
            reason:
              "file_write 被运行沙箱阻止：路径不在工作区或额外可写目录内。",
          }),
        }),
      ]),
    );
  });
});

function finalResponse(content: string): ChatCompletionResponse {
  return { content, toolCalls: [], finishReason: "stop" };
}

function toolCallResponse(
  toolName: string,
  args: Record<string, unknown>,
): ChatCompletionResponse {
  return {
    content: null,
    toolCalls: [
      {
        id: "call_1",
        type: "function",
        function: { name: toolName, arguments: JSON.stringify(args) },
      },
    ],
    finishReason: "tool_calls",
  };
}

function createTask(): ScheduledTask {
  return {
    id: "task_123",
    name: "Organize Downloads",
    skillName: "local-file-organizer",
    enabled: true,
    schedule: { kind: "manual" },
    input: { targetDir: "~/Downloads" },
    permissions: getDefaultTaskPermissionPolicy(),
    createdAt: "2026-06-05T08:00:00.000Z",
    updatedAt: "2026-06-05T08:00:00.000Z",
    lastRunAt: null,
    nextRunAt: null,
  };
}

function createSkillRecord(): SkillRecord {
  return {
    manifest: {
      name: "local-file-organizer",
      displayName: "Local File Organizer",
      description: "Organize local files.",
      version: "0.1.0",
      execution: { mode: "agent", entrypoint: null, maxTurns: 4 },
      inputs: [],
      permissions: {
        files: { read: [], write: [] },
        web: { search: false, fetchDomains: [] },
        shell: { commands: [] },
        memory: { read: false, write: false },
      },
    },
    body: "Summarize files in the target directory.",
    rootDir: "/tmp/skills/local-file-organizer",
    skillFile: "/tmp/skills/local-file-organizer/SKILL.md",
  };
}

function createTaskStore(task: ScheduledTask | null): ScheduledTaskStore {
  return {
    async list() {
      return task ? [task] : [];
    },
    async get() {
      return task;
    },
    async create() {
      throw new Error("Not needed in this test.");
    },
    async recordRun() {
      return task;
    },
  };
}

function createMemoryRunStore(): AgentRunStore & { runs: AgentRunRecord[] } {
  const runs: AgentRunRecord[] = [];
  return {
    runs,
    async append(run) {
      runs.push(run);
      return run;
    },
    async list() {
      return runs;
    },
  };
}

function createMemoryExecutionStore(
  saved: AgentExecutionCheckpoint[],
): AgentExecutionStore {
  const byRunId = new Map<string, AgentExecutionCheckpoint>();
  return {
    async save(checkpoint) {
      const snapshot = structuredClone(checkpoint);
      saved.push(snapshot);
      byRunId.set(checkpoint.runId, snapshot);
      return snapshot;
    },
    async get(runId) {
      return byRunId.get(runId) ?? null;
    },
    async listActive() {
      return [...byRunId.values()].filter(
        (checkpoint) =>
          checkpoint.status !== "succeeded" &&
          checkpoint.status !== "failed" &&
          checkpoint.status !== "canceled",
      );
    },
    async delete(runId) {
      return byRunId.delete(runId);
    },
  };
}

function createMemoryTrajectoryStore(
  events: AgentTrajectoryEvent[],
): AgentTrajectoryStore {
  return {
    async append(_runId, event) {
      events.push(structuredClone(event));
      return event;
    },
    async list() {
      return events;
    },
  };
}

function createMemoryLearningStore(
  inputs: AgentLearningCandidateInput[],
): AgentLearningStore {
  return {
    async create(input) {
      inputs.push(structuredClone(input));
      return {
        id: `learning_${inputs.length}`,
        status: "pending_review",
        ...input,
        createdAt: "2026-06-07T00:00:00.000Z",
        updatedAt: "2026-06-07T00:00:00.000Z",
      } as AgentLearningCandidate;
    },
    async list() {
      return [];
    },
    async setStatus() {
      return null;
    },
  };
}

function createMemoryStoreWithSearch(results: MemorySearchResult[]) {
  return {
    async create(input: MemoryInput) {
      return {
        id: "memory_written",
        ...input,
        tags: input.tags ?? [],
        source: input.source ?? { type: "manual" },
        importance: input.importance ?? 3,
        createdAt: "2026-06-07T00:00:00.000Z",
        updatedAt: "2026-06-07T00:00:00.000Z",
      } as MemoryRecord;
    },
    async search() {
      return results;
    },
  };
}

function createProceduralMemorySearchResult(content: string): MemorySearchResult {
  return {
    record: {
      id: "memory_procedure",
      kind: "procedural",
      title: "Downloads workflow",
      content,
      tags: ["local-file-organizer"],
      source: { type: "agent_run", refId: "run_previous" },
      importance: 4,
      createdAt: "2026-06-06T00:00:00.000Z",
      updatedAt: "2026-06-06T00:00:00.000Z",
    },
    score: 7,
    matchedTerms: ["downloads"],
  };
}

function createChatClient(responses: ChatCompletionResponse[]): ChatClient {
  return {
    async complete() {
      return responses.shift() ?? finalResponse("Done");
    },
  };
}

function createAuthorizationService(allowed: boolean): ToolAuthorizationService {
  return {
    async authorize() {
      return {
        ok: true,
        decision: {
          allowed,
          reason: allowed ? "allowed by policy" : "denied by policy",
        },
        auditEvent: {
          id: "audit_1",
          taskId: "task_123",
          request: {
            toolName: "file_read",
            args: {},
          },
          decision: {
            allowed,
            reason: allowed ? "allowed by policy" : "denied by policy",
          },
          createdAt: "2026-06-07T00:00:00.000Z",
        },
      };
    },
  };
}

function createWorkspaceService(runContext: AgentRunContext) {
  return {
    async resolveRunContext() {
      return runContext;
    },
    async createTemporaryWorkspace() {
      throw new Error("Not needed in this test.");
    },
    async createGitWorktreeWorkspace() {
      throw new Error("Not needed in this test.");
    },
    async listWorkspaces() {
      return [];
    },
  };
}

function createToolExecutor(executedTools: string[]): AgentToolExecutor {
  return {
    async execute(request) {
      executedTools.push(request.toolName);
      return {
        ok: true,
        result: { content: "notes" },
      };
    },
  };
}

function createRecordingOffloadStore(): ToolResultOffloadStore & {
  writes: ToolResultOffloadWriteInput[];
} {
  const writes: ToolResultOffloadWriteInput[] = [];

  return {
    writes,
    async write(input) {
      writes.push(input);
      return {
        refId: "ref_1",
        relativePath: "tool-result-refs/ref_1.json",
        absolutePath: "/tmp/tool-result-refs/ref_1.json",
        bytesWritten: Buffer.byteLength(input.content, "utf8"),
      };
    },
    async read() {
      return null;
    },
  };
}

function createModelProfile() {
  return {
    baseUrl: "https://api.example.com/v1",
    apiKey: "secret",
    model: "agent-model",
    temperature: 0.2,
    maxTokens: 8192,
  };
}

function createSequentialId(prefix: string): () => string {
  let next = 1;
  return () => `${prefix}_${next++}`;
}

function createSteppedClock(start: string): () => Date {
  let offset = 0;
  const startMs = new Date(start).getTime();
  return () => {
    const value = new Date(startMs + offset * 60_000);
    offset += 1;
    return value;
  };
}
