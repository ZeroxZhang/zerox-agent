import type { Goal } from "../shared/agentGoal";
import type { AgentRunContext } from "../shared/agentWorkspace";
import type { AgentToolExecutor } from "./agentToolExecutor";
import { buildGoalMilestoneRuntimeTask } from "./goalRuntimeEngine";
import type { ToolAuthorizationService } from "./toolAuthorizationService";

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

  return {
    async execute(request, executionOptions) {
      throwIfAborted(executionOptions?.signal);
      const authorization = await options.toolAuthorizationService.authorize(
        options.taskId,
        {
          toolName: request.toolName as never,
          args: request.args,
        },
        {
          ...(executionOptions?.signal
            ? { signal: executionOptions.signal }
            : {}),
          runContext: options.runContext,
          runtimeTask,
        },
      );
      throwIfAborted(executionOptions?.signal);
      if (!authorization.ok || !authorization.decision.allowed) {
        return {
          ok: false,
          error: authorization.ok
            ? authorization.decision.reason
            : authorization.message,
        };
      }

      return options.toolExecutor.execute(request, {
        ...executionOptions,
        // The authorization decision and execution must use the exact same
        // canonical context. Callers cannot replace it with a wider sandbox.
        runContext: options.runContext,
        signal: executionOptions?.signal,
        ...(request.toolName === "shell_exec"
          ? { authorizedShellCommand: String(request.args.command ?? "") }
          : {}),
      });
    },
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw signal.reason ?? new DOMException("Aborted", "AbortError");
}
