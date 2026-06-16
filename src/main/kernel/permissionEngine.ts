import type { PermissionRule } from "../../shared/kernelContract";
import type { ToolCallRequest } from "../../shared/toolPermissions";

export type PermissionEvaluation = {
  action: PermissionRule["action"];
  command: string;
  fullCommand: string;
  matchedRule?: string;
};

const COMMAND_ARITY: Record<string, number> = {
  git: 2,
  npm: 2,
  "npm run": 3,
  "npm exec": 3,
  "npm view": 3,
  node: 2,
  pnpm: 2,
  "pnpm run": 3,
  yarn: 2,
  "yarn run": 3,
  rm: 1,
};

export function evaluatePermission(
  request: ToolCallRequest,
  rules: PermissionRule[],
): PermissionEvaluation {
  const fullCommand = deriveFullCommand(request);
  const command = deriveHumanCommand(request, fullCommand);
  const allowReducedCommandMatch =
    request.toolName !== "shell_exec" || !hasShellControlOperator(fullCommand);
  const matched = findLastMatchingRule(
    rules,
    command,
    fullCommand,
    allowReducedCommandMatch,
  );

  return {
    action: matched?.action ?? "ask",
    command,
    fullCommand,
    matchedRule: matched?.pattern,
  };
}

function findLastMatchingRule(
  rules: PermissionRule[],
  command: string,
  fullCommand: string,
  allowReducedCommandMatch: boolean,
): PermissionRule | undefined {
  for (let index = rules.length - 1; index >= 0; index -= 1) {
    const rule = rules[index];
    if (rule?.action === "allow" && !allowReducedCommandMatch) {
      continue;
    }

    if (
      rule &&
      ((rule.action !== "allow" &&
        wildcardMatch(rule.pattern, command)) ||
        (allowReducedCommandMatch && wildcardMatch(rule.pattern, command)) ||
        wildcardMatch(rule.pattern, fullCommand))
    ) {
      return rule;
    }
  }

  return undefined;
}

function deriveFullCommand(request: ToolCallRequest): string {
  if (request.toolName === "shell_exec") {
    return String(request.args.command ?? "").trim();
  }

  const primary = primaryToolArgument(request);
  return primary ? `${request.toolName} ${primary}` : request.toolName;
}

function deriveHumanCommand(
  request: ToolCallRequest,
  fullCommand: string,
): string {
  if (request.toolName !== "shell_exec") {
    return fullCommand;
  }

  const tokens = tokenizeShellCommand(fullCommand);
  if (!tokens.length) {
    return "";
  }

  const semanticTokens = tokens.filter((token) => !token.startsWith("-"));
  for (let length = semanticTokens.length; length > 0; length -= 1) {
    const prefix = semanticTokens.slice(0, length).join(" ");
    const arity = COMMAND_ARITY[prefix];
    if (arity !== undefined) {
      return semanticTokens.slice(0, Math.min(arity, semanticTokens.length)).join(" ");
    }
  }

  return semanticTokens[0] ?? tokens[0] ?? "";
}

function tokenizeShellCommand(command: string): string[] {
  return command.match(/"[^"]*"|'[^']*'|\S+/g)?.map((token) =>
    token.replace(/^["']|["']$/g, ""),
  ) ?? [];
}

function primaryToolArgument(request: ToolCallRequest): string {
  const candidates = [
    request.args.command,
    request.args.path,
    request.args.root,
    request.args.workspaceRoot,
    request.args.url,
    request.args.query,
  ];
  const value = candidates.find((candidate) =>
    typeof candidate === "string" && candidate.trim().length > 0
  );
  return typeof value === "string" ? value.trim() : "";
}

function wildcardMatch(pattern: string, value: string): boolean {
  const regex = new RegExp(`^${pattern.split("*").map(escapeRegex).join(".*")}$`);
  return regex.test(value);
}

function hasShellControlOperator(command: string): boolean {
  return /(;|&&|\|\||`|\$\(|\|)/.test(command);
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}
