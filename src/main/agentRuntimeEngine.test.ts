import { describe, expect, it } from "vitest";
import { createAgentRuntimeEngine } from "./agentRuntimeEngine";
import type { AgentExecutionStore } from "./agentExecutionStore";
import type { AgentRunStore } from "./agentRunStore";
import type { AgentToolExecutor } from "./agentToolExecutor";
import type { ChatClient, ChatCompletionResponse } from "./openAiCompatibleClient";
import type { ScheduledTaskStore } from "./taskStore";
import type { ToolAuthorizationService } from "./toolAuthorizationService";
import type { AgentExecutionCheckpoint } from "../shared/agentExecution";
import type { AgentRunRecord } from "../shared/agentRuns";
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
