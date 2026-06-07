import type { ModelSettingsStore } from "./modelSettingsStore";
import type { ScheduledTaskStore } from "./taskStore";
import type { AgentValidationStore } from "./agentValidationStore";
import type { AgentRunStatus, RunScheduledTaskResult } from "../shared/agentRuns";
import type {
  AgentBootstrapConnectionStep,
  AgentBootstrapReport,
  AgentBootstrapRunStep,
  AgentBootstrapStep,
  AgentBootstrapTaskStep,
  AgentBootstrapValidationReport,
  AgentBootstrapValidationSnapshot,
} from "../shared/agentBootstrap";
import type { TestModelConnectionResult } from "../shared/modelSettings";
import type { ScheduledTaskInput } from "../shared/scheduledTasks";
import type { SkillDiscoveryResult } from "../shared/skills";

const defaultTaskName = "整理下载文件夹";
const defaultSkillName = "local-file-organizer";

export type AgentBootstrapService = {
  prepare(): Promise<AgentBootstrapReport>;
  validate(): Promise<AgentBootstrapValidationReport>;
  loadLastValidation(): Promise<AgentBootstrapValidationSnapshot | null>;
};

export function createAgentBootstrapService(options: {
  modelSettingsStore: Pick<ModelSettingsStore, "load">;
  taskStore: Pick<ScheduledTaskStore, "list" | "create">;
  discoverSkills: () => Promise<SkillDiscoveryResult>;
  testModelConnection?: () => Promise<TestModelConnectionResult>;
  runScheduledTask?: (taskId: string) => Promise<RunScheduledTaskResult>;
  validationStore?: AgentValidationStore;
  now?: () => Date;
}): AgentBootstrapService {
  const now = options.now ?? (() => new Date());

  async function prepare(): Promise<AgentBootstrapReport> {
    const [settings, skillResult, tasks] = await Promise.all([
      options.modelSettingsStore.load(),
      options.discoverSkills(),
      options.taskStore.list(),
    ]);
    const model: AgentBootstrapStep =
      settings.chatModel && settings.hasApiKey
        ? { ready: true, message: "模型配置已就绪。" }
        : {
            ready: false,
            message: "请先在设置中保存对话模型和 API Key。",
          };
    const hasDefaultSkill = skillResult.skills.some(
      (skill) => skill.manifest.name === defaultSkillName,
    );
    const skill: AgentBootstrapStep = hasDefaultSkill
      ? { ready: true, message: "内置文件整理技能已就绪。" }
      : { ready: false, message: "没有找到内置文件整理技能。" };
    const existingTask =
      tasks.find(
        (task) =>
          task.skillName === defaultSkillName && task.name === defaultTaskName,
      ) ?? null;
    let task: AgentBootstrapTaskStep;

    if (existingTask) {
      task = {
        ready: true,
        created: false,
        message: "默认文件整理任务已存在。",
        task: existingTask,
      };
    } else if (!hasDefaultSkill) {
      task = {
        ready: false,
        created: false,
        message: "缺少技能，暂时不能创建默认任务。",
        task: null,
      };
    } else {
      const createdTask = await options.taskStore.create(
        createDefaultFileOrganizerTaskInput(),
      );
      task = {
        ready: true,
        created: true,
        message: "已创建默认文件整理任务。",
        task: createdTask,
      };
    }

    return {
      ready: model.ready && skill.ready && task.ready,
      model,
      skill,
      task,
    };
  }

  async function saveValidationSnapshot(
    report: AgentBootstrapValidationReport,
  ): Promise<AgentBootstrapValidationReport> {
    await options.validationStore?.save({
      report,
      validatedAt: now().toISOString(),
    });
    return report;
  }

  return {
    prepare,
    async validate() {
      const prepared = await prepare();

      if (!prepared.ready) {
        return saveValidationSnapshot({
          ...prepared,
          ready: false,
          connection: createSkippedConnectionStep(),
          run: createSkippedRunStep("准备未完成，暂不运行默认任务。"),
        });
      }

      const connectionResult = options.testModelConnection
        ? await options.testModelConnection()
        : {
            ok: false as const,
            message: "当前版本没有接入模型连接测试。",
          };
      const connection = toConnectionStep(connectionResult);

      if (!connection.ready) {
        return saveValidationSnapshot({
          ...prepared,
          ready: false,
          connection,
          run: createSkippedRunStep("模型连接未通过，暂不运行默认任务。"),
        });
      }

      if (!prepared.task.task) {
        return saveValidationSnapshot({
          ...prepared,
          ready: false,
          connection,
          run: createSkippedRunStep("没有可运行的默认任务。"),
        });
      }

      const runResult = options.runScheduledTask
        ? await options.runScheduledTask(prepared.task.task.id)
        : {
            ok: false as const,
            message: "当前版本没有接入任务运行器。",
          };
      const run = toRunStep(runResult);

      const report = {
        ...prepared,
        ready: prepared.ready && connection.ready && run.ready,
        connection,
        run,
      };

      return saveValidationSnapshot(report);
    },

    async loadLastValidation() {
      return options.validationStore?.load() ?? null;
    },
  };
}

function createSkippedConnectionStep(): AgentBootstrapConnectionStep {
  return {
    ready: false,
    checked: false,
    latencyMs: null,
    message: "准备未完成，暂不测试模型连接。",
  };
}

function createSkippedRunStep(message: string): AgentBootstrapRunStep {
  return {
    ready: false,
    ran: false,
    run: null,
    message,
  };
}

function toConnectionStep(
  result: TestModelConnectionResult,
): AgentBootstrapConnectionStep {
  if (!result.ok) {
    return {
      ready: false,
      checked: true,
      latencyMs: null,
      message: result.message,
    };
  }

  return {
    ready: true,
    checked: true,
    latencyMs: result.latencyMs,
    message: result.message,
  };
}

function toRunStep(result: RunScheduledTaskResult): AgentBootstrapRunStep {
  if (!result.ok) {
    return {
      ready: false,
      ran: true,
      run: null,
      message: result.message,
    };
  }

  return {
    ready: result.run.status === "succeeded",
    ran: true,
    run: result.run,
    message:
      result.run.status === "succeeded"
        ? "默认文件整理任务已验收运行。"
        : `默认文件整理任务运行结果：${translateRunStatus(result.run.status)}。`,
  };
}

function translateRunStatus(status: AgentRunStatus): string {
  if (status === "succeeded") {
    return "成功";
  }

  if (status === "canceled") {
    return "已取消";
  }

  return "失败";
}

function createDefaultFileOrganizerTaskInput(): ScheduledTaskInput {
  return {
    name: defaultTaskName,
    skillName: defaultSkillName,
    enabled: true,
    schedule: { kind: "manual" },
    input: { targetDir: "~/Downloads", reportName: "agent-report.md" },
    permissions: {
      files: { read: ["~/Downloads"], write: ["~/Downloads"] },
      web: { search: false, fetchDomains: [] },
      shell: { commands: [] },
    },
  };
}
