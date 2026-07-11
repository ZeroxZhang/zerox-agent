import type { PermissionRule } from "../../shared/kernelContract";
import type { ToolCallRequest } from "../../shared/toolPermissions";
import type { ShellPlan } from "../tools/shell/shellAnalyzer";

export type PermissionEvaluation = {
  action: PermissionRule["action"];
  command: string;
  fullCommand: string;
  matchedRule?: string;
};

// Patch 4: control-operator detection unified on ShellPlan as the single source
// of truth. The legacy regex is retained as the fallback when no ShellPlan is
// provided (zero regression for non-shell paths), now including redirection
// (`<>`) so it matches the shared toolPermissions regex.
const LEGACY_SHELL_CONTROL_OPERATOR = /(;|&&|\|\||`|\$\(|\||[<>])/;

// v3.6.0: macOS-sensitive commands that must never be executed via shell_exec.
// These commands can bypass security controls, escalate privileges, or
// automate system interactions beyond the agent's intended scope.
const DENY_LISTED_COMMANDS = new Set([
  "osascript",
  "security",
  "shortcuts",
  "automator",
  "systemsetup",
  "tccutil",
  "spctl",
  "csrutil",
  "nvram",
]);

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

/** Check whether a shell command references a deny-listed executable. */
export function isCommandDenyListed(fullCommand: string): string | null {
  // Normalize: if command is an array, join with space (handles array coercion).
  const normalized = Array.isArray(fullCommand)
    ? (fullCommand as unknown[]).map(String).join(" ")
    : String(fullCommand);
  const tokens = tokenizeShellCommand(normalized);
  if (tokens.length === 0) return null;

  // v3.6.0: Check ALL tokens, not just the first, to catch bypasses like
  // `sudo osascript` or `/bin/sh -c osascript`. Also detect deny-listed
  // base names within full paths (e.g. /usr/bin/osascript).
  for (const token of tokens) {
    const baseName = token.split("/").pop()?.toLowerCase() ?? "";
    if (DENY_LISTED_COMMANDS.has(baseName)) {
      return baseName;
    }
  }
  return null;
}

export function evaluatePermission(
  request: ToolCallRequest,
  rules: PermissionRule[],
  opts?: { shellPlan?: ShellPlan },
): PermissionEvaluation {
  const fullCommand = deriveFullCommand(request);
  const command = deriveHumanCommand(request, fullCommand);
  // Patch 4: prefer ShellPlan.controlOperators as the single source of truth;
  // fall back to the legacy regex (now incl. redirection) when no plan is given.
  const hasControlOperator = opts?.shellPlan
    ? opts.shellPlan.controlOperators.length > 0
    : LEGACY_SHELL_CONTROL_OPERATOR.test(fullCommand);
  const allowReducedCommandMatch =
    request.toolName !== "shell_exec" || !hasControlOperator;
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

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}
