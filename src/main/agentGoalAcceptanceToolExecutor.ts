import type { Goal } from "../shared/agentGoal";
import type { AgentRunContext } from "../shared/agentWorkspace";
import type { AgentToolExecutor } from "./agentToolExecutor";
import { buildGoalMilestoneRuntimeTask } from "./goalRuntimeEngine";
import type { ToolAuthorizationService } from "./toolAuthorizationService";
import { createToolRuntime } from "./toolRuntime";

export function createAuthorizedGoalAcceptanceToolExecutor(options: {
  taskId: string;
  goal: Goal;
  runContext: AgentRunContext;
  toolExecutor: Pick<AgentToolExecutor, "execute">;
  toolAuthorizationService: ToolAuthorizationService;
}): Pick<AgentToolExecutor, "execute"> {
  const runtimeTask = buildGoalMilestoneRuntimeTask(
    options.goal,
    options.runContext,
  );
  const toolRuntime = createToolRuntime({
    authorizationService: options.toolAuthorizationService,
    toolExecutor: options.toolExecutor,
  });

  return {
    async execute(request, executionOptions) {
      throwIfAborted(executionOptions?.signal);
      const outcome = await toolRuntime.execute({
        taskId: options.taskId,
        request,
        authorizationOptions: { runtimeTask },
        executionOptions: {
          ...executionOptions,
          // Authorization and dispatch use one canonical context. Callers
          // cannot replace it with a wider sandbox.
          runContext: options.runContext,
        },
      });
      throwIfAborted(executionOptions?.signal);
      return outcome.result;
    },
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw signal.reason ?? new DOMException("Aborted", "AbortError");
}
