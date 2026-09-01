import type { AgentRunnerService } from "./agentRunnerService";
import type { ChatClient } from "./openAiCompatibleClient";
import {
  ModelServiceNoticeError,
  throwForModelServiceNotice,
} from "../shared/modelServiceNotice";
import { throwIfResponseBodyLimitError } from "./fetchWithTimeout";

export type SubTask = {
  id: string;
  description: string;
  skillName: string;
  input: Record<string, unknown>;
};

export type SubTaskResult = {
  taskId: string;
  description: string;
  status: "succeeded" | "failed";
  summary: string;
};

export type OrchestrationPlan = {
  subTasks: SubTask[];
  reasoning: string;
  parallelizable: boolean;
};

export type OrchestrationResult = {
  ok: boolean;
  plan?: OrchestrationPlan;
  results: SubTaskResult[];
  summary: string;
};

export type AgentOrchestrator = {
  execute(
    taskDescription: string,
    availableSkills: Array<{ name: string; displayName: string; description: string }>,
  ): Promise<OrchestrationResult>;
};

export function createAgentOrchestrator(options: {
  chatClient: ChatClient;
  runTask: AgentRunnerService["runTask"];
  getModelProfile: () => Promise<{
    baseUrl: string;
    apiKey: string;
    model: string;
    temperature: number;
    maxTokens: number;
  }>;
  signal?: AbortSignal;
}): AgentOrchestrator {
  return {
    async execute(taskDescription, availableSkills) {
      const profile = await options.getModelProfile();
      const results: SubTaskResult[] = [];

      // Step 1: Decompose task using LLM
      const plan = await decomposeTask(
        options.chatClient,
        profile,
        taskDescription,
        availableSkills,
      );

      if (!plan || !plan.subTasks.length) {
        return {
          ok: false,
          results: [],
          summary: "无法将任务分解为可执行的子任务。",
        };
      }

      // Step 2: Execute sub-tasks
      if (plan.parallelizable) {
        // Run sub-tasks in parallel
        const parallelResults = await Promise.all(
          plan.subTasks.map(async (subTask) => {
            try {
              const result = await options.runTask(subTask.id, {
                signal: options.signal,
              });

              if (result.ok) {
                return {
                  taskId: subTask.id,
                  description: subTask.description,
                  status: "succeeded" as const,
                  summary: result.run.summary,
                };
              }

              return {
                taskId: subTask.id,
                description: subTask.description,
                status: "failed" as const,
                summary: result.message,
              };
            } catch (error) {
              return {
                taskId: subTask.id,
                description: subTask.description,
                status: "failed" as const,
                summary:
                  error instanceof Error
                    ? error.message
                    : "Sub-task execution failed.",
              };
            }
          }),
        );

        results.push(...parallelResults);
      } else {
        // Run sub-tasks sequentially
        for (const subTask of plan.subTasks) {
          if (options.signal?.aborted) break;

          try {
            const result = await options.runTask(subTask.id, {
              signal: options.signal,
            });

            if (result.ok) {
              results.push({
                taskId: subTask.id,
                description: subTask.description,
                status: "succeeded",
                summary: result.run.summary,
              });
            } else {
              results.push({
                taskId: subTask.id,
                description: subTask.description,
                status: "failed",
                summary: result.message,
              });
            }
          } catch (error) {
            results.push({
              taskId: subTask.id,
              description: subTask.description,
              status: "failed",
              summary:
                error instanceof Error
                  ? error.message
                  : "Sub-task execution failed.",
            });
          }
        }
      }

      // Step 3: Synthesize summary
      const succeeded = results.filter((r) => r.status === "succeeded");
      const failed = results.filter((r) => r.status === "failed");

      const summary = [
        `编排执行完成：${succeeded.length}/${results.length} 个子任务成功。`,
        ...succeeded.map((r) => `✅ ${r.description}: ${r.summary.slice(0, 200)}`),
        ...failed.map((r) => `❌ ${r.description}: ${r.summary.slice(0, 200)}`),
      ].join("\n");

      return {
        ok: failed.length === 0,
        plan,
        results,
        summary,
      };
    },
  };
}

async function decomposeTask(
  chatClient: ChatClient,
  profile: {
    baseUrl: string;
    apiKey: string;
    model: string;
    temperature: number;
    maxTokens: number;
  },
  taskDescription: string,
  availableSkills: Array<{
    name: string;
    displayName: string;
    description: string;
  }>,
): Promise<OrchestrationPlan | null> {
  const skillList = availableSkills
    .map((s) => `- ${s.name}: ${s.description}`)
    .join("\n");

  const prompt = [
    "你是一个任务编排器。将以下复杂任务分解为可独立执行的子任务。",
    "",
    `用户任务：${taskDescription}`,
    "",
    "可用技能：",
    skillList || "（无可用技能）",
    "",
    "请返回 JSON 格式的编排计划：",
    "{",
    '  "subTasks": [',
    "    {",
    '      "id": "task id",',
    '      "description": "子任务描述",',
    '      "skillName": "使用的技能名称",',
    '      "input": {}',
    "    }",
    "  ],",
    '  "reasoning": "编排理由",',
    '  "parallelizable": true',
    "}",
    "",
    "要求：",
    "- 每个子任务必须指定一个可用技能",
    "- parallelizable=true 表示子任务可以并行执行",
    "- 子任务数量控制在 2-5 个",
    "- 只返回 JSON，不要额外解释",
  ].join("\n");

  try {
    const response = await chatClient.complete({
      ...profile,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
    });
    throwForModelServiceNotice(response.modelServiceNotice);

    const content = response.content ?? "";
    const parsed = JSON.parse(content) as {
      subTasks?: Array<{
        id?: string;
        description?: string;
        skillName?: string;
        input?: Record<string, unknown>;
      }>;
      reasoning?: string;
      parallelizable?: boolean;
    };

    if (!Array.isArray(parsed.subTasks) || parsed.subTasks.length === 0) {
      return null;
    }

    const subTasks: SubTask[] = parsed.subTasks.map((st, index) => ({
      id: st.id ?? `subtask_${index + 1}`,
      description: st.description ?? `子任务 ${index + 1}`,
      skillName: st.skillName ?? availableSkills[0]?.name ?? "",
      input: st.input ?? {},
    }));

    if (subTasks.some((st) => !st.skillName)) {
      return null;
    }

    return {
      subTasks,
      reasoning: parsed.reasoning ?? "",
      parallelizable: parsed.parallelizable ?? false,
    };
  } catch (error) {
    throwIfResponseBodyLimitError(error);
    if (error instanceof ModelServiceNoticeError) throw error;
    return null;
  }
}
