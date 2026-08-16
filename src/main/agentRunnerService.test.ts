import { describe, expect, it } from "vitest";
import { createAgentRunnerService } from "./agentRunnerService";
import type { AgentExecutionStore } from "./agentExecutionStore";
import type { AgentRunStore } from "./agentRunStore";
import type { AgentToolExecutor } from "./agentToolExecutor";
import { createDynamicToolRegistry } from "./dynamicToolRegistry";
import type { ChatClient, ChatMessage, ChatCompletionResponse } from "./openAiCompatibleClient";
import type { ScheduledTaskStore } from "./taskStore";
import type { ToolAuthorizationService } from "./toolAuthorizationService";
import type { AgentExecutionCheckpoint } from "../shared/agentExecution";
import type { AgentRunRecord } from "../shared/agentRuns";

/** v3.6.0: Extract JSON content from XML-fenced tool result wrapper. */
function innerToolResultJson(content: string): string {
  return content.replace(/^<tool_result[^>]*>\n?/, "").replace(/\n?<\/tool_result>\s*$/, "");
}
import type { MemoryInput, MemoryRecord, MemorySearchResult } from "../shared/memory";
import type { ScheduledTask } from "../shared/scheduledTasks";
import type { SkillRecord } from "../shared/skills";
import type {
  ToolResultOffloadStore,
  ToolResultOffloadWriteInput,
} from "./toolResultOffloadStore";
import { getDefaultTaskPermissionPolicy } from "../shared/toolPermissions";

function finalResponse(content: string): ChatCompletionResponse {
  return { content, toolCalls: [], finishReason: "stop" };
}

function toolCallResponse(toolName: string, args: Record<string, unknown>): ChatCompletionResponse {
  return toolCallResponseWithId("call_1", toolName, args);
}

function toolCallResponseWithId(
  id: string,
  toolName: string,
  args: Record<string, unknown>,
): ChatCompletionResponse {
  return {
    content: null,
    toolCalls: [
      {
        id,
        type: "function",
        function: { name: toolName, arguments: JSON.stringify(args) },
      },
    ],
    finishReason: "tool_calls",
  };
}

describe("agent runner service", () => {
  it("runs a task to a final response and stores the run", async () => {
    const capturedMessages: ChatMessage[][] = [];
    const runStore = createMemoryRunStore();
    const service = createAgentRunnerService({
      taskStore: createTaskStore(createTask()),
      runStore,
      resolveSkill: async () => createSkillRecord(2),
      chatClient: {
        async complete(request) {
          capturedMessages.push(request.messages);
          return finalResponse("Report complete");
        },
      },
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(true),
      toolExecutor: createToolExecutor(),
      createId: () => "run_123",
      now: () => new Date("2026-06-05T08:00:00.000Z"),
    });

    const result = await service.runTask("task_123");

    expect(result).toMatchObject({
      ok: true,
      run: {
        id: "run_123",
        taskId: "task_123",
        status: "succeeded",
        summary: "Report complete",
      },
    });
    expect(runStore.runs).toHaveLength(1);
    // First message set is the planning phase (system + user)
    // Second message set is from the execution loop
    const execMessages = capturedMessages[capturedMessages.length - 1];
    expect(execMessages[0].role).toBe("system");
    expect(capturedMessages.some(msgs =>
      msgs.some(m => m.content.includes("Local File Organizer")),
    )).toBe(true);
  });

  it("uses the model context window instead of max output tokens for legacy compaction", async () => {
    const compactionBudgets: number[] = [];
    let completionCalls = 0;
    const service = createAgentRunnerService({
      taskStore: createTaskStore(createTask()),
      runStore: createMemoryRunStore(),
      resolveSkill: async () => createSkillRecord(2),
      chatClient: {
        async complete() {
          completionCalls += 1;
          return completionCalls === 1
            ? finalResponse("no explicit plan")
            : finalResponse("Report complete");
        },
      },
      getModelProfile: async () => ({
        ...createModelProfile(),
        maxTokens: 128,
        contextWindow: 300,
      }),
      toolAuthorizationService: createAuthorizationService(true),
      toolExecutor: createToolExecutor(),
      contextManager: {
        estimateTokens(messages) {
          return messages.length * 100;
        },
        compressMessages(messages, budget) {
          compactionBudgets.push(budget ?? 0);
          return messages;
        },
      },
    });

    await expect(service.runTask("task_123")).resolves.toMatchObject({
      ok: true,
      run: { status: "succeeded" },
    });
    expect(compactionBudgets).toEqual([154]);
  });

  it("runs a prompt-only scheduled task without resolving a skill", async () => {
    let resolveSkillCalled = false;
    let completionCalls = 0;
    const service = createAgentRunnerService({
      taskStore: createTaskStore(
        createTask({
          skillName: "",
          input: {
            request: "每天检查下载目录，把结果写入本地报告；权限不足时跳过。",
          },
        }),
      ),
      runStore: createMemoryRunStore(),
      resolveSkill: async () => {
        resolveSkillCalled = true;
        return null;
      },
      chatClient: {
        async complete() {
          completionCalls += 1;
          return completionCalls === 1
            ? finalResponse("no explicit plan")
            : finalResponse("Prompt task complete");
        },
      },
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(true),
      toolExecutor: createToolExecutor(),
      createId: () => "run_prompt_task",
      now: () => new Date("2026-06-05T08:00:00.000Z"),
    });

    const result = await service.runTask("task_123");

    expect(resolveSkillCalled).toBe(false);
    expect(result).toMatchObject({
      ok: true,
      run: {
        id: "run_prompt_task",
        skillName: "prompt-task",
        status: "succeeded",
        summary: "Prompt task complete",
      },
    });
  });

  it("keeps a provider-limited legacy run paused for a user-triggered retry", async () => {
    const service = createAgentRunnerService({
      taskStore: createTaskStore(createTask()),
      runStore: createMemoryRunStore(),
      resolveSkill: async () => createSkillRecord(2),
      chatClient: {
        async complete() {
          return {
            content: "partial",
            toolCalls: [],
            finishReason: "MAX_TOKENS",
            modelServiceNotice: {
              kind: "output_limit",
              provider: "test-provider",
              model: "test-model",
              rawReason: "MAX_TOKENS",
              message: "模型输出被截断。",
            },
          };
        },
      },
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(true),
      toolExecutor: createToolExecutor(),
      createId: () => "run_provider_limit",
      now: () => new Date("2026-06-05T08:00:00.000Z"),
    });

    await expect(service.runTask("task_123")).resolves.toMatchObject({
      ok: true,
      run: {
        status: "paused",
        summary: "模型输出被截断。",
        modelServiceNotice: {
          kind: "output_limit",
          rawReason: "MAX_TOKENS",
        },
      },
    });
  });

  it("writes episodic memory after a successful run", async () => {
    const memoryWrites: MemoryInput[] = [];
    const service = createAgentRunnerService({
      taskStore: createTaskStore(createTask()),
      runStore: createMemoryRunStore(),
      resolveSkill: async () => createSkillRecord(2),
      chatClient: createChatClient([finalResponse("Report complete")]),
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(true),
      toolExecutor: createToolExecutor(),
      memoryStore: {
        async create(input) {
          memoryWrites.push(input);
          return {
            id: "mem_from_run",
            ...input,
            tags: input.tags ?? [],
            source: input.source ?? { type: "manual" },
            importance: input.importance ?? 3,
            createdAt: "2026-06-05T08:00:00.000Z",
            updatedAt: "2026-06-05T08:00:00.000Z",
          } as MemoryRecord;
        },
      },
      createId: () => "run_memory",
      now: () => new Date("2026-06-05T08:00:00.000Z"),
    });

    await service.runTask("task_123");

    expect(memoryWrites).toEqual([
      {
        kind: "episodic",
        title: "Run: Organize Downloads",
        content: "Report complete",
        tags: ["agent-run", "local-file-organizer"],
        source: { type: "agent_run", refId: "run_memory" },
        importance: 3,
      },
    ]);
  });

  it("includes procedural memory in the planning prompt", async () => {
    const capturedMessages: ChatMessage[][] = [];
    const service = createAgentRunnerService({
      taskStore: createTaskStore(createTask()),
      runStore: createMemoryRunStore(),
      resolveSkill: async () => createSkillRecord(4, true),
      chatClient: {
        async complete(request) {
          capturedMessages.push(request.messages);
          return capturedMessages.length === 1
            ? {
                content: JSON.stringify({
                  steps: [
                    {
                      description: "Inspect downloads first",
                      expectedTool: "file_list",
                      expectedOutcome: "Directory structure is known",
                    },
                  ],
                  reasoning: "Use reviewed procedural memory.",
                }),
                toolCalls: [],
                finishReason: "stop",
              }
            : finalResponse("Step complete");
        },
      },
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(true),
      toolExecutor: createToolExecutor(),
      memoryStore: createSearchOnlyMemoryStore([
        createProceduralMemorySearchResult(
          "先使用 file_list 了解目录，再读取候选文件。",
        ),
      ]),
      createId: () => "run_planned_memory",
      now: () => new Date("2026-06-05T08:00:00.000Z"),
    });

    await service.runTask("task_123");

    const planningPrompt = capturedMessages[0][0].content;
    expect(planningPrompt).toContain("相关流程记忆");
    expect(planningPrompt).toContain("先使用 file_list 了解目录，再读取候选文件。");
  });

  it("records task run metadata after storing a run", async () => {
    const recordedRuns: Array<{ taskId: string; completedAt: string }> = [];
    const service = createAgentRunnerService({
      taskStore: createTaskStore(createTask(), recordedRuns),
      runStore: createMemoryRunStore(),
      resolveSkill: async () => createSkillRecord(2),
      chatClient: createChatClient([finalResponse("Report complete")]),
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(true),
      toolExecutor: createToolExecutor(),
      createId: () => "run_recorded",
      now: () => new Date("2026-06-05T08:03:00.000Z"),
    });

    await service.runTask("task_123");

    expect(recordedRuns).toEqual([
      {
        taskId: "task_123",
        completedAt: "2026-06-05T08:03:00.000Z",
      },
    ]);
  });

  it("authorizes and executes tool calls before continuing the model loop", async () => {
    const sequence: string[] = [];
    const runStore = createMemoryRunStore();
    const service = createAgentRunnerService({
      taskStore: createTaskStore(createTask()),
      runStore,
      resolveSkill: async () => createSkillRecord(2),
      chatClient: {
        async complete() {
          sequence.push("model");
          return sequence.filter((item) => item === "model").length === 1
            ? toolCallResponse("file_read", { path: "~/Downloads/notes.md" })
            : finalResponse("Read notes");
        },
      },
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(true, sequence),
      toolExecutor: createToolExecutor(sequence),
      createId: () => "run_tools",
      now: () => new Date("2026-06-05T08:00:00.000Z"),
    });

    const result = await service.runTask("task_123");

    expect(result).toMatchObject({
      ok: true,
      run: {
        status: "succeeded",
        summary: "Read notes",
      },
    });
    // model (plan) → authorize → execute → model (final)
    expect(sequence.filter(s => s === "model")).toHaveLength(2);
    expect(sequence).toContain("authorize");
    expect(sequence).toContain("execute");
  });

  it("offloads oversized tool results in the legacy runner fallback", async () => {
    const largeContent = "x".repeat(1000);
    const capturedMessages: ChatMessage[][] = [];
    const store = createRecordingOffloadStore();
    const service = createAgentRunnerService({
      taskStore: createTaskStore(createTask()),
      runStore: createMemoryRunStore(),
      resolveSkill: async () => createSkillRecord(2),
      chatClient: {
        async complete(request) {
          capturedMessages.push(request.messages);
          return capturedMessages.length === 1
            ? toolCallResponse("file_read", { path: "~/Downloads/notes.md" })
            : finalResponse("Read notes");
        },
      },
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(true),
      toolExecutor: {
        ...createToolExecutor(),
        async execute() {
          return {
            ok: true,
            result: { content: largeContent },
          };
        },
      },
      toolResultOffloadStore: store,
      toolResultOffloadThreshold: 120,
      createId: () => "run_offload_fallback",
      now: () => new Date("2026-06-05T08:00:00.000Z"),
    });

    await service.runTask("task_123");

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
    expect(store.writes[0].content).toContain(largeContent);
  });

  it("lets the owning legacy runner read its scoped offloaded tool result ref", async () => {
    const largeContent = "legacy scoped result ".repeat(80);
    const capturedMessages: ChatMessage[][] = [];
    const store = createScopedRecordingOffloadStore();
    const service = createAgentRunnerService({
      taskStore: createTaskStore(createTask()),
      runStore: createMemoryRunStore(),
      resolveSkill: async () => createSkillRecord(3),
      chatClient: {
        async complete(request) {
          capturedMessages.push(request.messages);
          if (capturedMessages.length === 1) {
            return toolCallResponseWithId("call_read", "file_read", {
              path: "~/Downloads/notes.md",
            });
          }
          if (capturedMessages.length === 2) {
            return toolCallResponseWithId("call_ref", "tool_result_read", {
              ref: "tool-result-refs/ref_1.json",
            });
          }
          return finalResponse("Read legacy scoped ref");
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
      createId: () => "run_legacy_scope",
      now: () => new Date("2026-06-05T08:00:00.000Z"),
    });

    const result = await service.runTask("task_123");

    expect(result).toMatchObject({
      ok: true,
      run: { status: "succeeded", summary: "Read legacy scoped ref" },
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
      runId: "task_123",
    });
  });

  it("fails the run and skips execution when a tool call is denied", async () => {
    const sequence: string[] = [];
    const runStore = createMemoryRunStore();
    const service = createAgentRunnerService({
      taskStore: createTaskStore(createTask()),
      runStore,
      resolveSkill: async () => createSkillRecord(2),
      chatClient: {
        async complete() {
          sequence.push("model");
          return toolCallResponse("file_write", { path: "/private/out.md", content: "x" });
        },
      },
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(false, sequence),
      toolExecutor: createToolExecutor(sequence),
      createId: () => "run_denied",
      now: () => new Date("2026-06-05T08:00:00.000Z"),
    });

    const result = await service.runTask("task_123");

    expect(result).toMatchObject({
      ok: true,
      run: {
        status: "failed",
      },
    });
    // Tool was denied → authorization still called
    expect(sequence).toContain("authorize");
    // Tool execution should NOT happen for denied calls
    expect(sequence).not.toContain("execute");
  });

  it("cancels an active run when its abort signal fires", async () => {
    const controller = new AbortController();
    let capturedSignal: AbortSignal | undefined;
    const runStore = createMemoryRunStore();
    const service = createAgentRunnerService({
      taskStore: createTaskStore(createTask()),
      runStore,
      resolveSkill: async () => createSkillRecord(2),
      chatClient: {
        async complete(request) {
          capturedSignal = request.signal;
          return new Promise<ChatCompletionResponse>((_resolve, reject) => {
            request.signal?.addEventListener("abort", () => {
              reject(new Error("aborted by test"));
            });
          });
        },
      },
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(true),
      toolExecutor: createToolExecutor(),
      createId: () => "run_canceled",
      now: () => new Date("2026-06-05T08:00:00.000Z"),
    });

    const resultPromise = service.runTask("task_123", {
      signal: controller.signal,
    });
    await waitFor(() => capturedSignal);
    controller.abort();

    await expect(resultPromise).resolves.toMatchObject({
      ok: true,
      run: {
        id: "run_canceled",
        status: "canceled",
        summary: "运行已取消。",
      },
    });
    expect(runStore.runs[0].events).toContainEqual(
      expect.objectContaining({
        level: "warn",
        message: "Agent run canceled.",
      }),
    );
  });

  it("does not call the model when a run is already canceled", async () => {
    const controller = new AbortController();
    controller.abort();
    let completeCalled = false;
    const service = createAgentRunnerService({
      taskStore: createTaskStore(createTask()),
      runStore: createMemoryRunStore(),
      resolveSkill: async () => createSkillRecord(2),
      chatClient: {
        async complete() {
          completeCalled = true;
          return finalResponse("unused");
        },
      },
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(true),
      toolExecutor: createToolExecutor(),
      createId: () => "run_pre_canceled",
      now: () => new Date("2026-06-05T08:00:00.000Z"),
    });

    await expect(
      service.runTask("task_123", { signal: controller.signal }),
    ).resolves.toMatchObject({
      ok: true,
      run: {
        status: "canceled",
        summary: "运行已取消。",
      },
    });
    expect(completeCalled).toBe(false);
  });

  it("returns a structured error when the task is missing", async () => {
    const service = createAgentRunnerService({
      taskStore: createTaskStore(null),
      runStore: createMemoryRunStore(),
      resolveSkill: async () => createSkillRecord(2),
      chatClient: createChatClient([]),
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(true),
      toolExecutor: createToolExecutor(),
      createId: () => "run_missing",
      now: () => new Date("2026-06-05T08:00:00.000Z"),
    });

    await expect(service.runTask("missing")).resolves.toEqual({
      ok: false,
      message: "Scheduled task was not found.",
    });
  });

  it("delegates to the recoverable runtime when an execution store is configured", async () => {
    const savedCheckpoints: AgentExecutionCheckpoint[] = [];
    const runStore = createMemoryRunStore();
    const service = createAgentRunnerService({
      taskStore: createTaskStore(createTask()),
      runStore,
      executionStore: createMemoryExecutionStore(savedCheckpoints),
      resolveSkill: async () => createSkillRecord(4),
      chatClient: createChatClient([
        toolCallResponse("file_read", { path: "~/Downloads/notes.md" }),
        finalResponse("Report complete"),
      ]),
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(true),
      toolExecutor: createToolExecutor(),
      createId: createSequentialId("runner_runtime"),
      now: createSteppedClock("2026-06-07T00:00:00.000Z"),
    });

    const result = await service.runTask("task_123");

    expect(result).toMatchObject({
      ok: true,
      run: {
        id: "runner_runtime_1",
        status: "succeeded",
        checkpointId: expect.any(String),
      },
    });
    expect(savedCheckpoints.map((checkpoint) => checkpoint.status)).toEqual([
      "queued",
      "running",
      "running",
      "succeeded",
    ]);
    expect(runStore.runs[0]).toMatchObject({
      id: "runner_runtime_1",
      checkpointId: savedCheckpoints.at(-1)?.id,
    });
  });

  it("emits runtime events before a streaming task completes", async () => {
    let resolveModel!: (response: ChatCompletionResponse) => void;
    const service = createAgentRunnerService({
      taskStore: createTaskStore(createTask()),
      runStore: createMemoryRunStore(),
      executionStore: createMemoryExecutionStore([]),
      resolveSkill: async () => createSkillRecord(4),
      chatClient: {
        async complete() {
          return new Promise<ChatCompletionResponse>((resolve) => {
            resolveModel = resolve;
          });
        },
      },
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(true),
      toolExecutor: createToolExecutor(),
      createId: createSequentialId("runner_stream"),
      now: createSteppedClock("2026-06-07T00:00:00.000Z"),
    });
    const stream = service.runTaskStreaming("task_123")[Symbol.asyncIterator]();

    await expect(stream.next()).resolves.toMatchObject({
      done: false,
      value: { level: "info", message: "Agent runtime started." },
    });

    await waitFor(() => resolveModel);
    resolveModel(finalResponse("Streaming report complete"));
    const remainingEvents = [];
    while (true) {
      const next = await stream.next();
      if (next.done) break;
      remainingEvents.push(next.value);
    }
    expect(remainingEvents).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining("succeeded") }),
    );
  });

  it("resumes a checkpoint through the recoverable runtime", async () => {
    const savedCheckpoints: AgentExecutionCheckpoint[] = [];
    const executionStore = createMemoryExecutionStore(savedCheckpoints);
    await executionStore.save(createCheckpoint("run_resume", "task_123"));
    const service = createAgentRunnerService({
      taskStore: createTaskStore(createTask()),
      runStore: createMemoryRunStore(),
      executionStore,
      resolveSkill: async () => createSkillRecord(4),
      chatClient: createChatClient([finalResponse("Resumed report complete")]),
      getModelProfile: async () => createModelProfile(),
      toolAuthorizationService: createAuthorizationService(true),
      toolExecutor: createToolExecutor(),
      createId: createSequentialId("runner_resume"),
      now: createSteppedClock("2026-06-07T00:00:00.000Z"),
    });

    const result = await service.resumeRun("run_resume");

    expect(result).toMatchObject({
      ok: true,
      run: {
        id: "run_resume",
        status: "succeeded",
        summary: "Resumed report complete",
      },
    });
    expect(savedCheckpoints.at(-1)).toMatchObject({
      runId: "run_resume",
      status: "succeeded",
    });
  });
});

function createTask(partial: Partial<ScheduledTask> = {}): ScheduledTask {
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
    ...partial,
  };
}

function createSkillRecord(
  maxTurns?: number,
  planningRequired = false,
): SkillRecord {
  return {
    manifest: {
      name: "local-file-organizer",
      displayName: "Local File Organizer",
      description: "Organize local files.",
      version: "0.1.0",
      execution: { mode: "agent", entrypoint: null, ...(maxTurns !== undefined ? { maxTurns } : {}) },
      planning: { required: planningRequired },
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

function createTaskStore(
  task: ScheduledTask | null,
  recordedRuns: Array<{ taskId: string; completedAt: string }> = [],
): ScheduledTaskStore {
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
    async recordRun(taskId, completedAt) {
      recordedRuns.push({ taskId, completedAt: completedAt.toISOString() });
      return task;
    },
    async setEnabled() {
      return task;
    },
    async delete() {
      return false;
    },
    async flushShadowWrites() {
      return;
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
    async get(runId) {
      return runs.find((run) => run.id === runId) ?? null;
    },
    async list() {
      return runs;
    },
    async flushShadowWrites() {
      return;
    },
  };
}

function createSearchOnlyMemoryStore(results: MemorySearchResult[]) {
  return {
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
    async flushShadowWrites() {
      return;
    },
  };
}

function createCheckpoint(
  runId: string,
  taskId: string,
): AgentExecutionCheckpoint {
  return {
    id: `${runId}_checkpoint`,
    runId,
    taskId,
    status: "paused",
    currentStepId: "step_1",
    steps: [
      {
        id: "step_1",
        description: "Resume task",
        expectedOutcome: "Task finishes",
        state: "running",
        attempts: 1,
      },
    ],
    messages: [
      { role: "system", content: "system" },
      { role: "user", content: "resume this task" },
    ],
    toolCallCount: 0,
    createdAt: "2026-06-07T00:00:00.000Z",
    updatedAt: "2026-06-07T00:00:00.000Z",
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

function createChatClient(responses: ChatCompletionResponse[]): ChatClient {
  return {
    async complete() {
      return responses.shift() ?? finalResponse("Done");
    },
  };
}

function createAuthorizationService(
  allowed: boolean,
  sequence: string[] = [],
): ToolAuthorizationService {
  return {
    async authorize() {
      sequence.push("authorize");
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
          createdAt: "2026-06-05T08:00:00.000Z",
        },
      };
    },
  };
}

function createToolExecutor(sequence: string[] = []): AgentToolExecutor {
  const registry = createDynamicToolRegistry();
  return {
    async execute() {
      sequence.push("execute");
      return {
        ok: true,
        result: { content: "notes" },
      };
    },
    getRegistry() {
      return registry;
    },
    hasTool() {
      return true;
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

async function waitFor(predicate: () => unknown) {
  for (let index = 0; index < 20; index += 1) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error("Timed out waiting for predicate.");
}
