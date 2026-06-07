import { describe, expect, it } from "vitest";
import { createAgentRunnerService } from "./agentRunnerService";
import type { AgentExecutionStore } from "./agentExecutionStore";
import type { AgentRunStore } from "./agentRunStore";
import type { AgentToolExecutor } from "./agentToolExecutor";
import type { ChatClient, ChatMessage, ChatCompletionResponse } from "./openAiCompatibleClient";
import type { ScheduledTaskStore } from "./taskStore";
import type { ToolAuthorizationService } from "./toolAuthorizationService";
import type { AgentExecutionCheckpoint } from "../shared/agentExecution";
import type { AgentRunRecord } from "../shared/agentRuns";
import type { MemoryInput, MemoryRecord } from "../shared/memory";
import type { ScheduledTask } from "../shared/scheduledTasks";
import type { SkillRecord } from "../shared/skills";
import { getDefaultTaskPermissionPolicy } from "../shared/toolPermissions";

function finalResponse(content: string): ChatCompletionResponse {
  return { content, toolCalls: [], finishReason: "stop" };
}

function toolCallResponse(toolName: string, args: Record<string, unknown>): ChatCompletionResponse {
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

function createSkillRecord(maxTurns?: number): SkillRecord {
  return {
    manifest: {
      name: "local-file-organizer",
      displayName: "Local File Organizer",
      description: "Organize local files.",
      version: "0.1.0",
      execution: { mode: "agent", entrypoint: null, ...(maxTurns !== undefined ? { maxTurns } : {}) },
      inputs: [],
      permissions: {
        files: { read: [], write: [] },
        web: { search: false, fetchDomains: [] },
        shell: { commands: [] },
        memory: { read: false, write: false },
      },
    },
    body: "Summarize files in the target directory.",
    rawFrontmatter: "",
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
    async recordRun(taskId, completedAt) {
      recordedRuns.push({ taskId, completedAt: completedAt.toISOString() });
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
  return {
    async execute() {
      sequence.push("execute");
      return {
        ok: true,
        result: { content: "notes" },
      };
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
