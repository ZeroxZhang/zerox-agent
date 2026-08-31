import { describe, expect, it } from "vitest";
import { createAgentBootstrapService } from "./agentBootstrapService";
import type { AgentRunRecord } from "../shared/agentRuns";
import type { AgentBootstrapValidationSnapshot } from "../shared/agentBootstrap";
import type { PublicModelSettings } from "../shared/modelSettings";
import type { TestModelConnectionResult } from "../shared/modelSettings";
import type { ScheduledTask, ScheduledTaskInput } from "../shared/scheduledTasks";
import type { SkillDiscoveryResult } from "../shared/skills";

describe("agent bootstrap service", () => {
  it("creates the default file organizer task when the skill exists", async () => {
    const createdInputs: ScheduledTaskInput[] = [];
    const service = createAgentBootstrapService({
      modelSettingsStore: createModelSettingsStore({
        chatModel: "agent-model",
        hasApiKey: true,
      }),
      taskStore: createTaskStore([], createdInputs),
      discoverSkills: async () => createSkillResult(),
    });

    const result = await service.prepare();

    expect(result).toMatchObject({
      ready: true,
      model: { ready: true, message: "模型配置已就绪。" },
      skill: { ready: true, message: "内置文件整理技能已就绪。" },
      task: {
        ready: true,
        created: true,
        message: "已创建默认文件整理任务。",
      },
    });
    expect(result.task.task?.name).toBe("整理下载文件夹");
    expect(createdInputs).toEqual([
      {
        name: "整理下载文件夹",
        skillName: "local-file-organizer",
        enabled: true,
        schedule: { kind: "manual" },
        input: { targetDir: "~/Downloads", reportName: "agent-report.md" },
        permissions: {
          files: { read: ["~/Downloads"], write: ["~/Downloads"] },
          web: { search: false, fetchDomains: [] },
          shell: { commands: [] },
        },
      },
    ]);
  });

  it("does not duplicate the default task when it already exists", async () => {
    const existingTask = createTask({ id: "task_existing" });
    const createdInputs: ScheduledTaskInput[] = [];
    const service = createAgentBootstrapService({
      modelSettingsStore: createModelSettingsStore({
        chatModel: "agent-model",
        hasApiKey: true,
      }),
      taskStore: createTaskStore([existingTask], createdInputs),
      discoverSkills: async () => createSkillResult(),
    });

    const result = await service.prepare();

    expect(result).toMatchObject({
      ready: true,
      task: {
        ready: true,
        created: false,
        message: "默认文件整理任务已存在。",
        task: existingTask,
      },
    });
    expect(createdInputs).toEqual([]);
  });

  it("reports incomplete model setup without blocking task preparation", async () => {
    const service = createAgentBootstrapService({
      modelSettingsStore: createModelSettingsStore({
        chatModel: "",
        hasApiKey: false,
      }),
      taskStore: createTaskStore([], []),
      discoverSkills: async () => createSkillResult(),
    });

    const result = await service.prepare();

    expect(result).toMatchObject({
      ready: false,
      model: {
        ready: false,
        message: "请先在设置中保存对话模型和 API Key。",
      },
      skill: { ready: true },
      task: { ready: true, created: true },
    });
  });

  it("does not create a task when the built-in skill is missing", async () => {
    const createdInputs: ScheduledTaskInput[] = [];
    const service = createAgentBootstrapService({
      modelSettingsStore: createModelSettingsStore({
        chatModel: "agent-model",
        hasApiKey: true,
      }),
      taskStore: createTaskStore([], createdInputs),
      discoverSkills: async () => ({ skills: [], errors: [] }),
    });

    const result = await service.prepare();

    expect(result).toMatchObject({
      ready: false,
      skill: {
        ready: false,
        message: "没有找到内置文件整理技能。",
      },
      task: {
        ready: false,
        created: false,
        message: "缺少技能，暂时不能创建默认任务。",
      },
    });
    expect(createdInputs).toEqual([]);
  });

  it("validates the local agent by testing the model and running the default task", async () => {
    const existingTask = createTask({ id: "task_existing" });
    const connectionChecks: string[] = [];
    const runTaskIds: string[] = [];
    const service = createAgentBootstrapService({
      modelSettingsStore: createModelSettingsStore({
        chatModel: "agent-model",
        hasApiKey: true,
      }),
      taskStore: createTaskStore([existingTask], []),
      discoverSkills: async () => createSkillResult(),
      testModelConnection: async () => {
        connectionChecks.push("checked");
        return createConnectionResult({ ok: true });
      },
      runScheduledTask: async (taskId) => {
        runTaskIds.push(taskId);
        return {
          ok: true,
          run: createRun({ taskId, taskName: existingTask.name }),
        };
      },
    });

    const result = await service.validate();

    expect(result).toMatchObject({
      ready: true,
      connection: {
        ready: true,
        checked: true,
        latencyMs: 42,
        message: "模型连接测试成功。",
      },
      run: {
        ready: true,
        ran: true,
        message: "默认文件整理任务已验收运行。",
        run: {
          taskId: "task_existing",
          status: "succeeded",
        },
      },
    });
    expect(connectionChecks).toEqual(["checked"]);
    expect(runTaskIds).toEqual(["task_existing"]);
  });

  it.each([
    ["queued", "排队中"],
    ["running", "运行中"],
    ["waiting_for_approval", "等待授权"],
    ["paused", "已暂停"],
    ["failed", "失败"],
    ["canceled", "已取消"],
  ] as const)("reports a %s validation run without calling it failed", async (
    status,
    label,
  ) => {
    const existingTask = createTask({ id: "task_existing" });
    const service = createAgentBootstrapService({
      modelSettingsStore: createModelSettingsStore({
        chatModel: "agent-model",
        hasApiKey: true,
      }),
      taskStore: createTaskStore([existingTask], []),
      discoverSkills: async () => createSkillResult(),
      testModelConnection: async () => createConnectionResult({ ok: true }),
      runScheduledTask: async (taskId) => ({
        ok: true,
        run: createRun({ taskId, status }),
      }),
    });

    await expect(service.validate()).resolves.toMatchObject({
      ready: false,
      run: {
        ready: false,
        message: `默认文件整理任务运行结果：${label}。`,
        run: { status },
      },
    });
  });

  it("does not validate connection or run task when preparation is incomplete", async () => {
    const connectionChecks: string[] = [];
    const runTaskIds: string[] = [];
    const service = createAgentBootstrapService({
      modelSettingsStore: createModelSettingsStore({
        chatModel: "",
        hasApiKey: false,
      }),
      taskStore: createTaskStore([], []),
      discoverSkills: async () => createSkillResult(),
      testModelConnection: async () => {
        connectionChecks.push("checked");
        return createConnectionResult({ ok: true });
      },
      runScheduledTask: async (taskId) => {
        runTaskIds.push(taskId);
        return { ok: true, run: createRun({ taskId }) };
      },
    });

    const result = await service.validate();

    expect(result).toMatchObject({
      ready: false,
      model: { ready: false },
      connection: {
        ready: false,
        checked: false,
        latencyMs: null,
        message: "准备未完成，暂不测试模型连接。",
      },
      run: {
        ready: false,
        ran: false,
        run: null,
        message: "准备未完成，暂不运行默认任务。",
      },
    });
    expect(connectionChecks).toEqual([]);
    expect(runTaskIds).toEqual([]);
  });

  it("does not run the default task when model connection validation fails", async () => {
    const existingTask = createTask({ id: "task_existing" });
    const runTaskIds: string[] = [];
    const service = createAgentBootstrapService({
      modelSettingsStore: createModelSettingsStore({
        chatModel: "agent-model",
        hasApiKey: true,
      }),
      taskStore: createTaskStore([existingTask], []),
      discoverSkills: async () => createSkillResult(),
      testModelConnection: async () => ({
        ok: false,
        message: "模型连接失败。",
      }),
      runScheduledTask: async (taskId) => {
        runTaskIds.push(taskId);
        return { ok: true, run: createRun({ taskId }) };
      },
    });

    const result = await service.validate();

    expect(result).toMatchObject({
      ready: false,
      connection: {
        ready: false,
        checked: true,
        latencyMs: null,
        message: "模型连接失败。",
      },
      run: {
        ready: false,
        ran: false,
        run: null,
        message: "模型连接未通过，暂不运行默认任务。",
      },
    });
    expect(runTaskIds).toEqual([]);
  });

  it("persists and reloads the latest validation snapshot", async () => {
    const snapshots: AgentBootstrapValidationSnapshot[] = [];
    const service = createAgentBootstrapService({
      modelSettingsStore: createModelSettingsStore({
        chatModel: "agent-model",
        hasApiKey: true,
      }),
      taskStore: createTaskStore([createTask({ id: "task_existing" })], []),
      discoverSkills: async () => createSkillResult(),
      testModelConnection: async () => createConnectionResult({ ok: true }),
      runScheduledTask: async (taskId) => ({
        ok: true,
        run: createRun({ taskId }),
      }),
      validationStore: {
        async save(snapshot) {
          snapshots.push(snapshot);
          return snapshot;
        },
        async load() {
          return snapshots.at(-1) ?? null;
        },
        async flushShadowWrites() {
          return;
        },
      },
      now: () => new Date("2026-06-06T09:00:00.000Z"),
    });

    const report = await service.validate();

    expect(report.ready).toBe(true);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      validatedAt: "2026-06-06T09:00:00.000Z",
      report: {
        ready: true,
        connection: { ready: true },
        run: { ready: true },
      },
    });
    await expect(service.loadLastValidation()).resolves.toEqual(snapshots[0]);
  });
});

function createModelSettingsStore(
  partial: Partial<PublicModelSettings>,
) {
  return {
    async load(): Promise<PublicModelSettings> {
      return {
        baseUrl: "https://api.example.com/v1",
        chatModel: "",
        embeddingModel: "",
        temperature: 0.2,
        maxTokens: 8192,
        thinkingEnabled: false,
        thinkingBudgetTokens: 0,
        hasApiKey: false,
        updatedAt: null,
        ...partial,
      };
    },
  };
}

function createTaskStore(
  tasks: ScheduledTask[],
  createdInputs: ScheduledTaskInput[],
) {
  return {
    async list() {
      return tasks;
    },
    async create(input: ScheduledTaskInput) {
      createdInputs.push(input);
      const task = createTask({
        id: "task_created",
        ...input,
        permissions: input.permissions!,
      });
      tasks.push(task);
      return task;
    },
  };
}

function createTask(partial: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: "task_1",
    name: "整理下载文件夹",
    skillName: "local-file-organizer",
    enabled: true,
    schedule: { kind: "manual" },
    input: { targetDir: "~/Downloads", reportName: "agent-report.md" },
    permissions: {
      files: { read: ["~/Downloads"], write: ["~/Downloads"] },
      web: { search: false, fetchDomains: [] },
      shell: { commands: [] },
    },
    createdAt: "2026-06-06T08:00:00.000Z",
    updatedAt: "2026-06-06T08:00:00.000Z",
    lastRunAt: null,
    nextRunAt: null,
    ...partial,
  };
}

function createConnectionResult(
  partial: Partial<Extract<TestModelConnectionResult, { ok: true }>>,
): TestModelConnectionResult {
  return {
    ok: true,
    message: "模型连接测试成功。",
    model: "agent-model",
    latencyMs: 42,
    checkedAt: "2026-06-06T08:00:00.000Z",
    replyPreview: "OK",
    ...partial,
  };
}

function createRun(partial: Partial<AgentRunRecord> = {}): AgentRunRecord {
  return {
    id: "run_1",
    taskId: "task_1",
    taskName: "整理下载文件夹",
    skillName: "local-file-organizer",
    status: "succeeded",
    summary: "验收运行完成。",
    events: [],
    startedAt: "2026-06-06T08:00:00.000Z",
    finishedAt: "2026-06-06T08:00:01.000Z",
    ...partial,
  };
}

function createSkillResult(): SkillDiscoveryResult {
  return {
    skills: [
      {
        manifest: {
          name: "local-file-organizer",
          displayName: "本地文件整理",
          description: "扫描本地文件夹，整理最近变化，并写出一份 Markdown 报告。",
          version: "0.1.0",
          execution: { mode: "agent", entrypoint: null },
          inputs: [],
          permissions: {
            files: { read: ["{{targetDir}}"], write: ["{{targetDir}}"] },
            shell: { commands: [] },
            web: { search: false, fetchDomains: [] },
            memory: { read: true, write: true },
          },
        },
        body: "默认用中文输出。",
        rootDir: "/tmp/skills/local-file-organizer",
        skillFile: "/tmp/skills/local-file-organizer/SKILL.md",
      },
    ],
    errors: [],
  };
}
