import { describe, expect, it } from "vitest";
import { createAgentRuntimeEngine } from "./agentRuntimeEngine";
import type { AgentExecutionStore } from "./agentExecutionStore";
import type { AgentLearningStore } from "./agentLearningStore";
import type { AgentRunStore } from "./agentRunStore";
import type { AgentToolExecutor } from "./agentToolExecutor";
import type { AgentTrajectoryStore } from "./agentTrajectoryStore";
import type { ChatClient, ChatCompletionResponse } from "./openAiCompatibleClient";
import type { ScheduledTaskStore } from "./taskStore";
import type { ToolAuthorizationService } from "./toolAuthorizationService";
import type { AgentExecutionCheckpoint } from "../shared/agentExecution";
import type {
  AgentLearningCandidate,
  AgentLearningCandidateInput,
} from "../shared/agentLearning";
import type { AgentRunRecord } from "../shared/agentRuns";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";
import type { MemoryInput, MemoryRecord, MemorySearchResult } from "../shared/memory";
import type { ScheduledTask } from "../shared/scheduledTasks";
import type { SkillRecord } from "../shared/skills";
import { getDefaultTaskPermissionPolicy } from "../shared/toolPermissions";

describe("agent runtime engine", () => {
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
