import type { ToolDefinition } from "./openAiCompatibleClient";
import type { ToolCallRequest } from "../shared/toolPermissions";

export const PLAN_MODE_ALLOWED_TOOL_NAMES = [
  "file_read",
  "file_stat",
  "file_list",
  "file_inventory",
  "file_search",
  "code_search",
  "git_status",
  "git_diff",
  "memory_search",
  "chat_history_search",
  "raw_history_search",
  "raw_history_around",
  "web_search",
  "web_fetch",
  "read_tool_result_ref",
  "skills_list",
  "skill_read",
] as const;

const allowed = new Set<string>(PLAN_MODE_ALLOWED_TOOL_NAMES);

export function isPlanModeToolAllowed(toolName: string): boolean {
  return allowed.has(toolName);
}

export function filterPlanModeToolDefinitions(
  definitions: ToolDefinition[],
): ToolDefinition[] {
  return definitions.filter((definition) =>
    isPlanModeToolAllowed(definition.function.name),
  );
}

export function authorizePlanModeTool(
  request: ToolCallRequest,
): { allowed: true } | { allowed: false; reason: string } {
  if (isPlanModeToolAllowed(request.toolName)) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: `Plan Mode 只允许规划相关的只读工具，已拒绝 ${request.toolName}。`,
  };
}
