import type { ToolDefinition } from "./openAiCompatibleClient";
import type { ScheduledTask } from "../shared/scheduledTasks";

const shellBackedTools = new Set(["shell_exec", "test_run"]);

export function filterToolDefinitionsForScheduledTask(
  tools: ToolDefinition[],
  task: Pick<ScheduledTask, "permissions">,
): ToolDefinition[] {
  const hasShellTemplates = task.permissions.shell.commands.length > 0;

  return tools.filter((tool) => {
    const toolName = tool.function.name;
    if (shellBackedTools.has(toolName)) {
      return hasShellTemplates;
    }

    return true;
  });
}
