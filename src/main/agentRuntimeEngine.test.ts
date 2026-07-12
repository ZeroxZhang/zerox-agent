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

/** v3.6.0: Extract JSON content from XML-fenced tool result wrapper. */
function innerToolResultJson(content: string): string {
  return content.replace(/^<tool_result[^>]*>\n?/, "").replace(/\n?<\/tool_result>\s*$/, "");
}
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
  it("routes scheduled production execution through the shared agent loop", async () => {
    let sharedLoopCalls = 0;
    const engine = createAgentRuntimeEngine({
      taskStore: createTaskStore({ ...createTask(), skillName: "" }),
      runStore: createMemoryRunStore(),
      executionStore: createMemoryExecutionStore([]),
      resolveSkill: async () => null,
      chatClient: { async complete() { return finalResponse("unused"); } },
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(true),
      toolExecutor: createToolExecutor(),
      async runLoop(_initialMessages, _profile, loopOptions) {
        sharedLoopCalls += 1;
        return {
          status: "succeeded",
          summary: "shared loop complete",
          turns: 1,
          messages: [
            ...(loopOptions.resumeMessages ?? []),
            { role: "assistant", content: "shared loop complete" },
          ],
          toolCallsExecuted: loopOptions.initialToolCallsExecuted ?? 0,
          tokensConsumed: 12,
        };
      },
      createId: createSequentialId("runtime_shared"),
      now: createSteppedClock("2026-07-12T00:00:00.000Z"),
    });

    const result = await engine.startTask("task_123");

    expect(sharedLoopCalls).toBe(1);
    expect(result).toMatchObject({
      ok: true,
      run: { status: "succeeded", summary: "shared loop complete" },
    });
  });

  it("continues trajectory sequence numbers after engine recreation and resume", async () => {
    let persisted: AgentExecutionCheckpoint = {
      id: "checkpoint_resume",
      runId: "run_resume",
      taskId: "task_123",
      status: "paused",
      currentStepId: "step_resume",
      steps: [{
        id: "step_resume",
        description: "resume",
        expectedOutcome: "done",
        state: "pending",
        attempts: 0,
      }],
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "resume" },
      ],
      toolCallCount: 0,
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
    };
    const trajectoryEvents: AgentTrajectoryEvent[] = [{
      id: "event_41",
      runId: "run_resume",
      type: "checkpoint_written",
      sequence: 41,
      payload: { checkpointId: "old" },
      redaction: {
        containsApiKey: false,
        containsFileContent: false,
        containsUserText: false,
      },
      createdAt: "2026-07-12T00:00:00.000Z",
    }];
    const engine = createAgentRuntimeEngine({
      taskStore: createTaskStore(createTask()),
      runStore: createMemoryRunStore(),
      executionStore: {
        async save(checkpoint) {
          persisted = structuredClone(checkpoint);
          return persisted;
        },
        async get(runId) {
          return runId === persisted.runId ? persisted : null;
        },
        async listActive() { return [persisted]; },
        async delete() { return true; },
      },
      trajectoryStore: createMemoryTrajectoryStore(trajectoryEvents),
      resolveSkill: async () => createSkillRecord(),
      chatClient: { async complete() { return finalResponse("resumed"); } },
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(true),
      toolExecutor: createToolExecutor(),
      createId: createSequentialId("resume_sequence"),
      now: createSteppedClock("2026-07-12T00:00:01.000Z"),
    });

    await engine.resumeRun("run_resume");

    const appendedSequences = trajectoryEvents.slice(1).map((event) => event.sequence);
    expect(appendedSequences[0]).toBe(42);
    expect(appendedSequences).toEqual(
      [...appendedSequences].sort((left, right) => left - right),
    );
    expect(new Set(appendedSequences).size).toBe(appendedSequences.length);
  });

  it("starts a prompt-only scheduled task without resolving a skill", async () => {
    let resolveSkillCalled = false;
    const engine = createAgentRuntimeEngine({
      taskStore: createTaskStore({
        ...createTask(),
        skillName: "",
        input: {
          request: "每天整理下载文件夹，把报告写到桌面；权限不足时停止。",
        },
      }),
      runStore: createMemoryRunStore(),
      executionStore: createMemoryExecutionStore([]),
      resolveSkill: async () => {
        resolveSkillCalled = true;
        return null;
      },
      chatClient: {
        async complete() {
          return finalResponse("Prompt task complete");
        },
      },
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(true),
      toolExecutor: createToolExecutor(),
      createId: createSequentialId("runtime_prompt"),
      now: createSteppedClock("2026-06-07T00:00:00.000Z"),
    });

    const result = await engine.startTask("task_123");

    expect(resolveSkillCalled).toBe(false);
    expect(result).toMatchObject({
      ok: true,
      run: {
        skillName: "prompt-task",
        status: "succeeded",
        summary: "Prompt task complete",
      },
    });
  });

  it("does not expose shell_exec to prompt-only scheduled tasks without shell templates", async () => {
    const visibleToolNames: string[][] = [];
    const engine = createAgentRuntimeEngine({
      taskStore: createTaskStore({
        ...createTask(),
        skillName: "",
        input: { request: "每天汇报天气" },
        permissions: getDefaultTaskPermissionPolicy(),
      }),
      runStore: createMemoryRunStore(),
      executionStore: createMemoryExecutionStore([]),
      resolveSkill: async () => null,
      chatClient: {
        async complete(request) {
          visibleToolNames.push(
            request.tools?.map((tool) => tool.function.name) ?? [],
          );
          return finalResponse("Weather task complete");
        },
      },
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(true),
      toolExecutor: createToolExecutor(),
      createId: createSequentialId("runtime_tools"),
      now: createSteppedClock("2026-06-07T00:00:00.000Z"),
    });

    const result = await engine.startTask("task_123");

    expect(result).toMatchObject({
      ok: true,
      run: { status: "succeeded" },
    });
    expect(visibleToolNames[0]).toContain("web_search");
    expect(visibleToolNames[0]).not.toContain("shell_exec");
    expect(visibleToolNames[0]).not.toContain("test_run");
  });

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
    expect(JSON.parse(innerToolResultJson(toolMessage?.content ?? "{}"))).toEqual(
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

  it("lets the owning runtime run read its scoped offloaded tool result ref", async () => {
    const largeContent = "scoped result ".repeat(80);
    const capturedMessages: ChatMessage[][] = [];
    const store = createScopedRecordingOffloadStore();
    const engine = createAgentRuntimeEngine({
      taskStore: createTaskStore(createTask()),
      runStore: createMemoryRunStore(),
      executionStore: createMemoryExecutionStore([]),
      resolveSkill: async () => createSkillRecord(),
      chatClient: {
        async complete(request) {
          capturedMessages.push(request.messages);
          if (capturedMessages.length === 1) {
            return {
              content: null,
              toolCalls: [
                createToolCall("call_read", "file_read", {
                  path: "~/Downloads/notes.md",
                }),
              ],
              finishReason: "tool_calls",
            };
          }
          if (capturedMessages.length === 2) {
            return {
              content: null,
              toolCalls: [
                createToolCall("call_ref", "tool_result_read", {
                  ref: "tool-result-refs/ref_1.json",
                }),
              ],
              finishReason: "tool_calls",
            };
          }
          return finalResponse("Read scoped ref");
        },
      },
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(true),
      toolExecutor: {
        async execute(request, executionOptions) {
          if (request.toolName === "tool_result_read") {
            const content = await store.read(
              String(request.args.ref ?? ""),
              executionOptions?.toolResultReadScope,
            );
            return content
              ? { ok: true, result: { content } }
              : { ok: false, error: "scoped ref denied" };
          }

          return {
            ok: true,
            result: { content: largeContent },
          };
        },
      } as AgentToolExecutor,
      toolResultOffloadStore: store,
      toolResultOffloadThreshold: 120,
      createId: createSequentialId("runtime_scope"),
      now: createSteppedClock("2026-06-07T00:00:00.000Z"),
    });

    const result = await engine.startTask("task_123");

    expect(result).toMatchObject({
      ok: true,
      run: { status: "succeeded", summary: "Read scoped ref" },
    });
    const refReadToolMessage = capturedMessages[2].find(
      (message) =>
        message.role === "tool" && message.tool_call_id === "call_ref",
    );
    expect(JSON.parse(innerToolResultJson(refReadToolMessage?.content ?? "{}"))).toMatchObject({
      tool: "tool_result_read",
      ok: true,
    });
    expect(store.reads.at(-1)?.scope).toMatchObject({
      runId: "runtime_scope_1",
    });
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

  it("preserves the latest tool progress when a later model request fails", async () => {
    const savedCheckpoints: AgentExecutionCheckpoint[] = [];
    let modelCalls = 0;
    const engine = createAgentRuntimeEngine({
      taskStore: createTaskStore(createTask()),
      runStore: createMemoryRunStore(),
      executionStore: createMemoryExecutionStore(savedCheckpoints),
      resolveSkill: async () => createSkillRecord(),
      chatClient: {
        async complete() {
          modelCalls += 1;
          if (modelCalls === 1) {
            return toolCallResponse("file_read", {
              path: "~/Downloads/notes.md",
            });
          }
          throw new Error("provider unavailable after tool completion");
        },
      },
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(true),
      toolExecutor: createToolExecutor([]),
      modelRetry: { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 },
      createId: createSequentialId("failure_progress"),
      now: createSteppedClock("2026-06-07T00:00:00.000Z"),
    });

    const result = await engine.startTask("task_123");

    expect(result).toMatchObject({
      ok: true,
      run: { status: "failed" },
    });
    const terminalCheckpoint = savedCheckpoints.at(-1);
    expect(terminalCheckpoint).toMatchObject({
      status: "failed",
      toolCallCount: 1,
    });
    expect(
      terminalCheckpoint?.messages.some(
        (message) => message.role === "tool" && message.tool_call_id === "call_1",
      ),
    ).toBe(true);
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
      "tool_invocation",
      "tool_invocation",
      "tool_invocation",
      "tool_invocation",
      "tool_invocation",
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
    expect(
      trajectoryEvents
        .filter((event) => event.type === "tool_invocation")
        .map((event) => event.payload.invocationStatus),
    ).toEqual(["proposed", "visible", "authorized", "running", "completed"]);
    expect(trajectoryEvents.every((event) => event.redaction.containsApiKey === false)).toBe(
      true,
    );
  });

  it("writes a checkpoint after each tool result within the same model turn", async () => {
    const savedCheckpoints: AgentExecutionCheckpoint[] = [];
    const engine = createAgentRuntimeEngine({
      taskStore: createTaskStore(createTask()),
      runStore: createMemoryRunStore(),
      executionStore: createMemoryExecutionStore(savedCheckpoints),
      resolveSkill: async () => createSkillRecord(),
      chatClient: createChatClient([
        {
          content: null,
          finishReason: "tool_calls",
          toolCalls: [
            createToolCall("call_1", "file_read", {
              path: "~/Downloads/first.md",
            }),
            createToolCall("call_2", "file_read", {
              path: "~/Downloads/second.md",
            }),
          ],
        },
        finalResponse("Report complete"),
      ]),
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(true),
      toolExecutor: {
        async execute(request) {
          return {
            ok: true,
            result: { content: `content for ${String(request.args.path)}` },
          };
        },
      },
      createId: createSequentialId("tool_checkpoint"),
      now: createSteppedClock("2026-06-07T00:00:00.000Z"),
    });

    await engine.startTask("task_123");

    const runningCheckpoints = savedCheckpoints.filter(
      (checkpoint) => checkpoint.status === "running",
    );
    expect(runningCheckpoints).toEqual([
      expect.objectContaining({ toolCallCount: 0 }),
      expect.objectContaining({ toolCallCount: 1 }),
      expect.objectContaining({ toolCallCount: 2 }),
    ]);
    expect(
      runningCheckpoints[1].messages.filter((message) => message.role === "tool"),
    ).toHaveLength(1);
    expect(
      runningCheckpoints[2].messages.filter((message) => message.role === "tool"),
    ).toHaveLength(2);
  });

  it("compacts runtime messages before model requests and records trajectory evidence", async () => {
    const trajectoryEvents: AgentTrajectoryEvent[] = [];
    const capturedMessages: ChatMessage[][] = [];
    const engine = createAgentRuntimeEngine({
      taskStore: createTaskStore(createTask()),
      runStore: createMemoryRunStore(),
      executionStore: createMemoryExecutionStore([]),
      trajectoryStore: createMemoryTrajectoryStore(trajectoryEvents),
      resolveSkill: async () => createSkillRecord(),
      chatClient: {
        async complete(request) {
          capturedMessages.push(request.messages);
          return finalResponse("Compacted report complete");
        },
      },
      getModelProfile: async () => ({ ...createModelProfile(), maxTokens: 128 }),
      toolAuthorizationService: createAuthorizationService(true),
      toolExecutor: createToolExecutor([]),
      contextManager: {
        estimateTokens(messages) {
          return messages.length * 100;
        },
        compressMessages(messages) {
          return [
            messages[0],
            { role: "user", content: "[之前对话摘要]\n任务输入已压缩。" },
            messages.at(-1),
          ].filter(Boolean) as ChatMessage[];
        },
      },
      createId: createSequentialId("runtime_compaction"),
      now: createSteppedClock("2026-06-07T00:00:00.000Z"),
    });

    const result = await engine.startTask("task_123");

    expect(result).toMatchObject({
      ok: true,
      run: { status: "succeeded" },
    });
    expect(capturedMessages[0]).toEqual([
      expect.objectContaining({ role: "system" }),
      { role: "user", content: "[之前对话摘要]\n任务输入已压缩。" },
      expect.objectContaining({ role: "user" }),
    ]);
    expect(trajectoryEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "context_compacted",
          payload: expect.objectContaining({
            originalMessageCount: expect.any(Number),
            compactedMessageCount: 3,
            estimatedTokens: expect.any(Number),
          }),
        }),
      ]),
    );
  });

  it("retries transient runtime model request failures with trajectory evidence", async () => {
    const trajectoryEvents: AgentTrajectoryEvent[] = [];
    let attempts = 0;
    const engine = createAgentRuntimeEngine({
      taskStore: createTaskStore(createTask()),
      runStore: createMemoryRunStore(),
      executionStore: createMemoryExecutionStore([]),
      trajectoryStore: createMemoryTrajectoryStore(trajectoryEvents),
      resolveSkill: async () => createSkillRecord(),
      chatClient: {
        async complete() {
          attempts += 1;
          if (attempts === 1) {
            throw new Error("LLM request failed with status 500: overloaded");
          }
          return finalResponse("Retry recovered.");
        },
      },
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(true),
      toolExecutor: createToolExecutor([]),
      modelRetry: { maxRetries: 2, baseDelayMs: 0, maxDelayMs: 0 },
      createId: createSequentialId("model_retry"),
      now: createSteppedClock("2026-06-07T00:00:00.000Z"),
    });

    const result = await engine.startTask("task_123");

    expect(result).toMatchObject({
      ok: true,
      run: {
        status: "succeeded",
        summary: "Retry recovered.",
      },
    });
    expect(attempts).toBe(2);
    expect(trajectoryEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "model_retry",
          payload: expect.objectContaining({
            attempt: 1,
            maxRetries: 2,
            delayMs: 0,
            error: "LLM request failed with status 500: overloaded",
          }),
        }),
      ]),
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
      "tool_invocation",
      "tool_invocation",
      "tool_invocation",
      "native_tool_invocation",
      "tool_invocation",
      "native_tool_observation",
      "tool_invocation",
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
    expect(
      trajectoryEvents
        .filter((event) => event.type === "tool_invocation")
        .map((event) => event.payload.invocationStatus),
    ).toEqual(["proposed", "visible", "authorized", "running", "completed"]);
  });

  it("passes dynamic registry source to runtime tool authorization", async () => {
    const authorizationRequests: Array<{
      toolName: string;
      source?: string;
      args: Record<string, unknown>;
    }> = [];
    const executionRequests: Array<{
      toolName: string;
      source?: string;
      args: Record<string, unknown>;
    }> = [];
    const registry = createDynamicToolRegistry();
    registry.register(
      {
        type: "function",
        function: {
          name: "remote_source_lookup",
          description: "Lookup remote source",
          parameters: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        },
      },
      async () => ({ ok: true, result: { sourceCount: 1 } }),
      "mcp:research-writer:source-fetcher",
    );
    const engine = createAgentRuntimeEngine({
      taskStore: createTaskStore(createTask()),
      runStore: createMemoryRunStore(),
      executionStore: createMemoryExecutionStore([]),
      resolveSkill: async () => createSkillRecord(),
      chatClient: createChatClient([
        toolCallResponse("remote_source_lookup", { query: "agent eval" }),
        finalResponse("Report complete"),
      ]),
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: {
        async authorize(_taskId, request) {
          authorizationRequests.push(request);
          return createAuthorizationService(true).authorize(_taskId, request);
        },
      },
      toolExecutor: {
        async execute(request) {
          executionRequests.push(request);
          return registry.execute(request.toolName, request.args);
        },
        getRegistry() {
          return registry;
        },
        hasTool(toolName) {
          return registry.has(toolName);
        },
      },
      createId: createSequentialId("dynamic_source"),
      now: createSteppedClock("2026-06-07T00:00:00.000Z"),
    });

    const result = await engine.startTask("task_123");

    expect(result).toMatchObject({
      ok: true,
      run: { status: "succeeded" },
    });
    expect(authorizationRequests).toEqual([
      {
        toolName: "remote_source_lookup",
        source: "mcp:research-writer:source-fetcher",
        args: { query: "agent eval" },
      },
    ]);
    expect(executionRequests).toEqual(authorizationRequests);
  });

  it("feeds recoverable tool failures back to the model before retrying", async () => {
    const trajectoryEvents: AgentTrajectoryEvent[] = [];
    const capturedMessages: ChatMessage[][] = [];
    const executedPaths: string[] = [];
    const engine = createAgentRuntimeEngine({
      taskStore: createTaskStore(createTask()),
      runStore: createMemoryRunStore(),
      executionStore: createMemoryExecutionStore([]),
      trajectoryStore: createMemoryTrajectoryStore(trajectoryEvents),
      resolveSkill: async () => createSkillRecord(),
      chatClient: {
        async complete(request) {
          capturedMessages.push(request.messages);
          if (capturedMessages.length === 1) {
            return toolCallResponse("file_read", {
              path: "~/Downloads/missing.md",
            });
          }
          if (capturedMessages.length === 2) {
            const failedObservation = request.messages.find(
              (message) =>
                message.role === "tool" &&
                message.content.includes("File not found."),
            );
            expect(failedObservation).toBeDefined();
            return toolCallResponse("file_read", {
              path: "~/Downloads/notes.md",
            });
          }
          return finalResponse("Recovered after reading notes.");
        },
      },
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(true),
      toolExecutor: {
        async execute(request) {
          executedPaths.push(String(request.args.path ?? ""));
          if (request.args.path === "~/Downloads/missing.md") {
            return {
              ok: false,
              error: "File not found.",
              errorDetails: { kind: "not_found" },
            };
          }
          return {
            ok: true,
            result: { content: "notes" },
          };
        },
      },
      createId: createSequentialId("tool_recovery"),
      now: createSteppedClock("2026-06-07T00:00:00.000Z"),
    });

    const result = await engine.startTask("task_123");

    expect(result).toMatchObject({
      ok: true,
      run: {
        status: "succeeded",
        summary: "Recovered after reading notes.",
      },
    });
    expect(executedPaths).toEqual([
      "~/Downloads/missing.md",
      "~/Downloads/notes.md",
    ]);
    expect(trajectoryEvents.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "tool_result",
        "reflection_added",
        "final_summary",
      ]),
    );
    expect(trajectoryEvents).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "failure_classified" }),
      ]),
    );
  });

  it("records reflection evidence before letting the model finalize after a tool failure", async () => {
    const trajectoryEvents: AgentTrajectoryEvent[] = [];
    const engine = createAgentRuntimeEngine({
      taskStore: createTaskStore(createTask()),
      runStore: createMemoryRunStore(),
      executionStore: createMemoryExecutionStore([]),
      trajectoryStore: createMemoryTrajectoryStore(trajectoryEvents),
      resolveSkill: async () => createSkillRecord(),
      chatClient: createChatClient([
        toolCallResponse("test_run", {
          workspaceRoot: "/repo",
          command: "npm test -- src/failing.test.ts",
        }),
      ]),
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(true),
      toolExecutor: {
        async execute() {
          return {
            ok: false,
            error: "test_run failed with exit code 1.",
            errorDetails: { kind: "exit", stderr: "expected true to be false" },
          };
        },
      },
      createId: createSequentialId("reflection"),
      now: createSteppedClock("2026-06-07T00:00:00.000Z"),
    });

    await engine.startTask("task_123");

    expect(trajectoryEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "reflection_added",
          payload: expect.objectContaining({
            toolName: "test_run",
            failureClass: "verification_failed",
            suggestion: "retry",
            retryAllowed: true,
          }),
        }),
      ]),
    );
    expect(trajectoryEvents.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "tool_result",
        "reflection_added",
        "final_summary",
      ]),
    );
    expect(trajectoryEvents).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "failure_classified" }),
      ]),
    );
  });

  it("classifies duplicate retry blocks in failure trajectory", async () => {
    const trajectoryEvents: AgentTrajectoryEvent[] = [];
    const modelRequests: ChatMessage[][] = [];
    const engine = createAgentRuntimeEngine({
      taskStore: createTaskStore(createTask()),
      runStore: createMemoryRunStore(),
      executionStore: createMemoryExecutionStore([]),
      trajectoryStore: createMemoryTrajectoryStore(trajectoryEvents),
      resolveSkill: async () => createSkillRecord(),
      chatClient: {
        async complete(request) {
          modelRequests.push(request.messages);
          if (modelRequests.length > 2) {
            throw new Error("unexpected third model request");
          }
          return toolCallResponse("file_read", {
            path: "~/Downloads/missing.md",
          });
        },
      },
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(true),
      toolExecutor: {
        async execute() {
          return {
            ok: false,
            error: "File not found.",
            errorDetails: { kind: "not_found" },
          };
        },
      },
      createId: createSequentialId("duplicate_retry"),
      now: createSteppedClock("2026-06-07T00:00:00.000Z"),
    });

    const result = await engine.startTask("task_123");

    expect(result).toMatchObject({
      ok: true,
      run: {
        status: "failed",
        failureClass: "tool_error",
        failureMessage: expect.stringContaining("duplicate_retry_blocked"),
      },
    });
    expect(modelRequests).toHaveLength(2);
    const reflectionClasses = trajectoryEvents
      .filter((event) => event.type === "reflection_added")
      .map((event) => event.payload.failureClass);
    expect(reflectionClasses).toEqual([
      "tool_failed",
      "duplicate_retry_blocked",
    ]);
    expect(trajectoryEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "failure_classified",
          payload: expect.objectContaining({
            failureClass: "tool_error",
            toolName: "file_read",
            reflectionFailureClass: "duplicate_retry_blocked",
            retryAllowed: false,
            suggestion: "abort",
          }),
        }),
      ]),
    );
  });

  it("classifies retry budget exhaustion in failure trajectory", async () => {
    const trajectoryEvents: AgentTrajectoryEvent[] = [];
    const executedPaths: string[] = [];
    const engine = createAgentRuntimeEngine({
      taskStore: createTaskStore(createTask()),
      runStore: createMemoryRunStore(),
      executionStore: createMemoryExecutionStore([]),
      trajectoryStore: createMemoryTrajectoryStore(trajectoryEvents),
      resolveSkill: async () => createSkillRecord(),
      chatClient: createChatClient([
        toolCallResponse("file_read", {
          path: "~/Downloads/missing-1.md",
        }),
        toolCallResponse("file_read", {
          path: "~/Downloads/missing-2.md",
        }),
      ]),
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(true),
      toolExecutor: {
        async execute(request) {
          executedPaths.push(String(request.args.path ?? ""));
          return {
            ok: false,
            error: "File not found.",
            errorDetails: { kind: "not_found" },
          };
        },
      },
      createId: createSequentialId("budget_exhausted"),
      now: createSteppedClock("2026-06-07T00:00:00.000Z"),
    });

    const result = await engine.startTask("task_123");

    expect(result).toMatchObject({
      ok: true,
      run: {
        status: "failed",
        failureClass: "tool_error",
        failureMessage: expect.stringContaining("budget_exhausted"),
      },
    });
    expect(executedPaths).toEqual([
      "~/Downloads/missing-1.md",
      "~/Downloads/missing-2.md",
    ]);
    const reflectionClasses = trajectoryEvents
      .filter((event) => event.type === "reflection_added")
      .map((event) => event.payload.failureClass);
    expect(reflectionClasses).toEqual(["tool_failed", "budget_exhausted"]);
    expect(trajectoryEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "failure_classified",
          payload: expect.objectContaining({
            failureClass: "tool_error",
            toolName: "file_read",
            reflectionFailureClass: "budget_exhausted",
            retryAllowed: false,
            suggestion: "abort",
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
        runtimeContextSnapshot: expect.objectContaining({
          surface: "scheduled_task",
          model: expect.objectContaining({
            modelId: "agent-model",
          }),
          workspace: expect.objectContaining({
            workspaceId: "workspace_1",
            workspaceRoot: "/tmp/zerox/workspace",
            sandboxMode: "workspace_write",
          }),
          permissions: expect.objectContaining({
            taskId: "task_123",
            runtimeTaskId: "scheduled:task_123",
            approvalMode: "scheduled",
          }),
        }),
        runtimeContextSnapshotSummary: expect.objectContaining({
          surface: "scheduled_task",
          workspaceId: "workspace_1",
          permissionTaskId: "task_123",
        }),
      },
    });
    expect(JSON.stringify(trajectoryEvents[0].payload)).not.toContain("secret");
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

  it("binds scheduled task runs to the requested chat session context", async () => {
    const resolveInputs: Array<{ sessionId?: string } | undefined> = [];
    const engine = createAgentRuntimeEngine({
      taskStore: createTaskStore(createTask()),
      runStore: createMemoryRunStore(),
      executionStore: createMemoryExecutionStore([]),
      workspaceService: {
        async resolveRunContext(input?: { sessionId?: string }) {
          resolveInputs.push(input);
          return buildPrimaryRunContext({
            workspaceId: "workspace_1",
            workspaceRoot: "/tmp/zerox/workspace",
            ...(input?.sessionId ? { sessionId: input.sessionId } : {}),
          });
        },
      },
      resolveSkill: async () => createSkillRecord(),
      chatClient: createChatClient([finalResponse("Report complete")]),
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(true),
      toolExecutor: createToolExecutor([]),
      createId: createSequentialId("session_run"),
      now: createSteppedClock("2026-06-07T00:00:00.000Z"),
    });

    const result = await engine.startTask("task_123", {
      sessionId: "session_daily_weather",
    });

    expect(resolveInputs).toEqual([{ sessionId: "session_daily_weather" }]);
    expect(result).toMatchObject({
      ok: true,
      run: {
        runContext: {
          sessionId: "session_daily_weather",
        },
      },
    });
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
            onApprovalResolved?: (result: { approved: boolean }) => Promise<void>;
          } | undefined;
          await lifecycle?.onApprovalRequested?.();
          await lifecycle?.onApprovalResolved?.({ approved: true });
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

  it("emits model_response trajectory events carrying provider usage for runGraph cost aggregation (P8)", async () => {
    const trajectoryEvents: AgentTrajectoryEvent[] = [];
    const engine = createAgentRuntimeEngine({
      taskStore: createTaskStore(createTask()),
      runStore: createMemoryRunStore(),
      executionStore: createMemoryExecutionStore([]),
      trajectoryStore: createMemoryTrajectoryStore(trajectoryEvents),
      resolveSkill: async () => createSkillRecord(),
      chatClient: {
        async complete() {
          return {
            content: "done with usage",
            toolCalls: [],
            finishReason: "stop",
            usage: { inputTokens: 42, outputTokens: 7 },
            cacheReadTokens: 10,
          };
        },
      },
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(true),
      toolExecutor: createToolExecutor([]),
      toolResultOffloadStore: createRecordingOffloadStore(),
    });

    await engine.startTask("task_123");

    const modelResponseEvents = trajectoryEvents.filter((e) => e.type === "model_response");
    expect(modelResponseEvents.length).toBeGreaterThan(0);
    const last = modelResponseEvents[modelResponseEvents.length - 1]!;
    expect(last.payload.usage).toEqual({ inputTokens: 42, outputTokens: 7 });
    expect(last.payload.cacheReadTokens).toBe(10);
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

function createToolCall(
  id: string,
  toolName: string,
  args: Record<string, unknown>,
): ChatCompletionResponse["toolCalls"][number] {
  return {
    id,
    type: "function",
    function: { name: toolName, arguments: JSON.stringify(args) },
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
    async update() {
      throw new Error("Not needed in this test.");
    },
    async recordRun() {
      return task;
    },
    async setEnabled() {
      return task;
    },
    async delete() {
      return false;
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

function createScopedRecordingOffloadStore(): ToolResultOffloadStore & {
  writes: ToolResultOffloadWriteInput[];
  reads: Array<{
    relativePath: string;
    scope: Parameters<ToolResultOffloadStore["read"]>[1];
  }>;
} {
  const writes: ToolResultOffloadWriteInput[] = [];
  const reads: Array<{
    relativePath: string;
    scope: Parameters<ToolResultOffloadStore["read"]>[1];
  }> = [];
  const refs = new Map<string, ToolResultOffloadWriteInput>();

  return {
    writes,
    reads,
    async write(input) {
      writes.push(input);
      refs.set("tool-result-refs/ref_1.json", input);
      return {
        refId: "ref_1",
        relativePath: "tool-result-refs/ref_1.json",
        absolutePath: "/tmp/tool-result-refs/ref_1.json",
        bytesWritten: Buffer.byteLength(input.content, "utf8"),
      };
    },
    async read(relativePath, scope) {
      reads.push({ relativePath, scope });
      const input = refs.get(relativePath);
      if (!input) {
        return null;
      }
      if (input.runId && input.runId !== scope?.runId) {
        return null;
      }
      return input.content;
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
