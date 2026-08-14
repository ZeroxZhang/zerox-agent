import type { ToolCallRequest } from "../shared/toolPermissions";
import type { AgentRunContext } from "../shared/agentWorkspace";
import type { ToolDefinition } from "./openAiCompatibleClient";
import type {
  DynamicToolRegistry,
  ToolRuntimeEvent,
} from "./dynamicToolRegistry";
import {
  runReadCodeProgram,
  type ReadCodeProgram,
  type ReadCodeRuntimeLimits,
} from "./readCodeRuntime";
import {
  createSerialToolPolicyAdmission,
} from "./toolBatchScheduler";
import type {
  RuntimeToolAuthorizationTask,
} from "./toolAuthorizationService";
import type {
  ToolRuntimeOutcome,
  ToolRuntimeStageEvent,
} from "./toolRuntime";
import type { ToolResultOffloadReadScope } from "./toolResultOffloadStore";

export const READ_CODE_TOOL_NAME = "read_code";

export const READ_CODE_TOOL_DEFINITION: ToolDefinition = {
  type: "function",
  function: {
    name: READ_CODE_TOOL_NAME,
    description:
      "在隔离 Worker 中执行只读工具 DAG。输入是结构化 steps，不是 JavaScript；适合一次并行读取或搜索多个目标。",
    parameters: {
      type: "object",
      properties: {
        program: {
          type: "object",
          properties: {
            steps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  tool: { type: "string" },
                  args: { type: "object" },
                  dependsOn: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
                required: ["id", "tool", "args"],
              },
            },
            output: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["steps"],
        },
      },
      required: ["program"],
    },
  },
};

export type ReadCodeSubcallInput = {
  taskId: string;
  request: ToolCallRequest;
  runContext?: AgentRunContext;
  runtimeTask?: RuntimeToolAuthorizationTask;
  signal: AbortSignal;
  toolResultReadScope?: ToolResultOffloadReadScope;
  onStage(event: ToolRuntimeStageEvent): void | Promise<void>;
};

export function registerReadCodeTool(
  registry: DynamicToolRegistry,
  options: {
    limits?: ReadCodeRuntimeLimits;
    executeSubcall(
      input: ReadCodeSubcallInput,
    ): Promise<ToolRuntimeOutcome>;
  },
): void {
  registry.register(
    READ_CODE_TOOL_DEFINITION,
    async (args, executionOptions) => {
      const taskId = executionOptions?.taskId?.trim();
      if (!taskId) {
        throw new Error(
          "read_code requires an authorized ToolRuntime task id.",
        );
      }
      const program = args.program as ReadCodeProgram;
      const admission = createSerialToolPolicyAdmission();
      const result = await runReadCodeProgram(program, {
        signal: executionOptions?.signal,
        limits: options.limits,
        async invoke(toolName, toolArgs, signal, call) {
          let dispatched = false;
          const normalizedArgs = applyReadCodeRunContextDefaults(
            toolName,
            toolArgs,
            executionOptions?.runContext,
          );
          const outcome = await admission.run(async (release) =>
            options.executeSubcall({
              taskId,
              request: {
                toolName,
                args: normalizedArgs,
              },
              ...(executionOptions?.runContext
                ? { runContext: executionOptions.runContext }
                : {}),
              ...(executionOptions?.runtimeTask
                ? { runtimeTask: executionOptions.runtimeTask }
                : {}),
              signal,
              ...(executionOptions?.toolResultReadScope
                ? {
                    toolResultReadScope:
                      executionOptions.toolResultReadScope,
                  }
                : {}),
              async onStage(event) {
                if (event.stage === "dispatching") {
                  dispatched = true;
                  executionOptions?.onRuntimeEvent?.({
                    type: "read_code_subcall",
                    callId: call.stepId,
                    toolName,
                    status: "started",
                  } satisfies ToolRuntimeEvent);
                  release();
                }
              },
            }),
          );
          executionOptions?.onRuntimeEvent?.({
            type: "read_code_subcall",
            callId: call.stepId,
            toolName,
            status: "completed",
            ok: outcome.result.ok,
          } satisfies ToolRuntimeEvent);
          if (!dispatched && outcome.result.ok) {
            return {
              ok: false,
              error: "read_code subcall did not dispatch.",
            };
          }
          return outcome.result;
        },
      });
      return {
        ok: true,
        result: {
          mode: "read_only_dag",
          outputs: result.outputs,
          stepsExecuted: result.stepsExecuted,
        },
      };
    },
    "built-in",
  );
}

function applyReadCodeRunContextDefaults(
  toolName: string,
  args: Record<string, unknown>,
  runContext: AgentRunContext | undefined,
): Record<string, unknown> {
  if (
    !runContext ||
    !["code_search", "git_status", "git_diff"].includes(toolName) ||
    (typeof args.workspaceRoot === "string" &&
      args.workspaceRoot.trim().length > 0)
  ) {
    return args;
  }
  return {
    ...args,
    workspaceRoot: runContext.workspaceRoot,
  };
}
