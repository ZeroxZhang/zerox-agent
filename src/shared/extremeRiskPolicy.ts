import type { ToolCallRequest } from "./toolPermissions";

export type ExtremeRiskCategory =
  | "none"
  | "irrecoverable_data_loss"
  | "privilege_or_security_boundary"
  | "secret_exfiltration"
  | "irreversible_external_action";

export type ExtremeRiskAssessment = {
  requiresConfirmation: boolean;
  category: ExtremeRiskCategory;
  reason: string;
  affectedTargets: string[];
};

export type ExtremeRiskShellPlan = {
  commands: Array<{
    name: string;
    args: string[];
    writesPaths: string[];
    readsPaths: string[];
  }>;
  networkAccess: boolean;
  opaqueExecution?: boolean;
};

const DESTRUCTIVE_GIT = [
  /\bgit\s+reset\b[^\n;&|]*\s--hard\b/i,
  /\bgit\s+clean\b[^\n;&|]*\s-(?:[^\s]*f[^\s]*)\b/i,
  /\bgit\s+stash\s+(?:drop|clear)\b/i,
  /\bgit\s+worktree\s+remove\b/i,
  /\bgit\s+branch\b[^\n;&|]*\s-D\b/,
  /\bgit\s+tag\b[^\n;&|]*\s-(?:d|-delete)\b/i,
];

const DESTRUCTIVE_STORAGE = [
  /(?:^|[;&|]\s*)(?:sudo\s+)?rm\s+-(?:[^\s]*r[^\s]*f|[^\s]*f[^\s]*r)[^\s]*\s+/i,
  /\b(?:diskutil\s+erase|mkfs(?:\.[a-z0-9]+)?|format\s+[a-z]:|shred\s+-)/i,
  /\bdd\b[^\n;&|]*\bof=\/(?:dev|System|Library|Users)\b/i,
  /(?:^|[;&|]\s*)truncate\s+-s\s*0\s+\/(?:System|Library|Users|etc)\b/i,
];

const PRIVILEGE_OR_SECURITY = [
  /(?:^|[;&|]\s*)(?:sudo|doas|pkexec)\s+/i,
  /(?:^|[;&|]\s*)security\s+(?:add|delete|set|unlock|lock|import|export|find)-/i,
  /(?:^|[;&|]\s*)(?:systemsetup|spctl|csrutil|fdesetup)\s+/i,
  /(?:^|[;&|]\s*)(?:osascript|shortcuts|automator|tccutil|nvram)\b/i,
  /(?:^|[;&|]\s*)launchctl\s+(?:load|unload|bootstrap|bootout|enable|disable|kickstart)\b/i,
  /(?:^|[;&|]\s*)(?:chmod|chown)\b[^\n;&|]*\s\/(?:System|Library|etc|usr|bin|sbin)\b/i,
];

const IRREVERSIBLE_EXTERNAL = [
  /\bgit\s+push\b[^\n;&|]*(?:--force(?:-with-lease)?|-f)\b/i,
  /(?:^|[;&|]\s*)(?:npm|pnpm|yarn)\s+publish\b/i,
  /(?:^|[;&|]\s*)gh\s+release\s+create\b/i,
  /(?:^|[;&|]\s*)(?:vercel\b[^\n;&|]*--prod|firebase\s+deploy\b|fly\s+deploy\b)/i,
  /(?:^|[;&|]\s*)kubectl\s+(?:delete\b|apply\b[^\n;&|]*(?:production|prod))/i,
  /(?:^|[;&|]\s*)(?:aws|gcloud|az)\b[^\n;&|]*(?:delete|destroy|terminate|purge)\b/i,
  /(?:^|[;&|]\s*)(?:mail|mailx|sendmail)\s+/i,
];

const EXTERNAL_TOOL_NAMES = /(?:^|_)(?:send|publish|deploy|release|purchase|payment|transfer|trade|post_comment|create_issue)(?:_|$)/i;
const AUTHORIZATION_SOURCE_PATH = /(?:^|[/\\])src[/\\](?:(?:main|shared)[/\\].*(?:authorization|approval|permission|sandbox).*|main[/\\](?:main|container|agentToolExecutor)\.(?:ts|js)|shared[/\\](?:extremeRiskPolicy|toolApproval|toolPermissions|agentWorkspace|kernelContract)\.(?:ts|js)|preload[/\\]index\.(?:ts|js)|renderer[/\\]components[/\\]AgentChatPanel\.tsx)$/i;
const SECRET_WORDS = /(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|secret|credentials?|private[_-]?key|\.ssh\/id_|\.aws\/|\.gnupg\/|\.env\b|cookie)/i;
const NETWORK_TRANSMITTER = /(?:^|[;&|]\s*)(?:curl|wget|scp|sftp|rsync|nc|ncat|netcat)\b/i;

export function classifyExtremeRisk(
  request: ToolCallRequest,
  options: { shellPlan?: ExtremeRiskShellPlan } = {},
): ExtremeRiskAssessment {
  const toolName = request.toolName.trim();
  if (EXTERNAL_TOOL_NAMES.test(toolName)) {
    return forced(
      "irreversible_external_action",
      "The tool performs an external publication, message, deployment, or financial commitment.",
      [toolName],
    );
  }

  if (
    /^(?:file_write|markdown_report_write|file_apply_moves|file_rollback_moves)$/.test(toolName) &&
    collectStringValues(request.args).some((value) => AUTHORIZATION_SOURCE_PATH.test(value))
  ) {
    return forced(
      "privilege_or_security_boundary",
      "The write changes the agent's authorization boundary.",
      collectStringValues(request.args).filter((value) => AUTHORIZATION_SOURCE_PATH.test(value)),
    );
  }

  if (toolName !== "shell_exec") {
    return safeAssessment();
  }

  const command = String(request.args.command ?? "").trim();
  if (!command) return safeAssessment();

  const protectedWrite = options.shellPlan?.commands.find((candidate) => {
    const executable = unwrapExecutable(candidate.name, candidate.args);
    return (
      candidate.writesPaths.some((path) => AUTHORIZATION_SOURCE_PATH.test(path)) ||
      (isMutatingExecutable(executable.name, executable.args) &&
        candidate.readsPaths.some((path) => AUTHORIZATION_SOURCE_PATH.test(path)))
    );
  });
  if (protectedWrite) {
    const affected = [
      ...protectedWrite.writesPaths,
      ...protectedWrite.readsPaths,
    ].filter((path) => AUTHORIZATION_SOURCE_PATH.test(path));
    return forced(
      "privilege_or_security_boundary",
      "The command writes to the agent's authorization or sandbox boundary.",
      affected,
    );
  }

  const structuralRisk = classifyStructuredShellRisk(options.shellPlan);
  if (structuralRisk) return structuralRisk;

  if (DESTRUCTIVE_GIT.some((pattern) => pattern.test(command)) ||
      DESTRUCTIVE_STORAGE.some((pattern) => pattern.test(command))) {
    return forced(
      "irrecoverable_data_loss",
      "The command can irreversibly delete data or destroy local version-control state.",
      [command],
    );
  }

  if (/\brm\s+(?:(?:--recursive|--force)|-[a-z]*[rf][a-z]*)\s*(?:(?:--recursive|--force)|-[a-z]*[rf][a-z]*)?/i.test(command)) {
    const flags = command.match(/(?:--recursive|--force|-[a-z]+)/gi) ?? [];
    if (hasRecursiveAndForce(flags)) {
      return forced(
        "irrecoverable_data_loss",
        "The nested command can irreversibly delete data.",
        [command],
      );
    }
  }

  if (
    isRecursiveForcedRemove(command) ||
    /\bgit\b[^\n;&|]*\sreset\b[^\n;&|]*\s--hard\b/i.test(command)
  ) {
    return forced(
      "irrecoverable_data_loss",
      "The command can irreversibly delete data or destroy local version-control state.",
      [command],
    );
  }

  if (PRIVILEGE_OR_SECURITY.some((pattern) => pattern.test(command))) {
    return forced(
      "privilege_or_security_boundary",
      "The command elevates privileges or changes a system/security boundary.",
      [command],
    );
  }

  if (NETWORK_TRANSMITTER.test(command) && SECRET_WORDS.test(command)) {
    return forced(
      "secret_exfiltration",
      "The command may transmit credentials or other secrets to an external destination.",
      [command],
    );
  }

  if (IRREVERSIBLE_EXTERNAL.some((pattern) => pattern.test(command))) {
    return forced(
      "irreversible_external_action",
      "The command performs an irreversible external, production, publication, or messaging action.",
      [command],
    );
  }

  if (
    /(?:^|[;&|]\s*)kubectl\b[^\n;&|]*\sdelete\b/i.test(command) ||
    /(?:^|[;&|]\s*)terraform\s+destroy\b/i.test(command) ||
    /(?:^|[;&|]\s*)cargo\s+publish\b/i.test(command)
  ) {
    return forced(
      "irreversible_external_action",
      "The command performs an irreversible external, production, publication, or messaging action.",
      [command],
    );
  }

  return safeAssessment();
}

function classifyStructuredShellRisk(
  shellPlan: ExtremeRiskShellPlan | undefined,
): ExtremeRiskAssessment | null {
  for (const command of shellPlan?.commands ?? []) {
    const executable = unwrapExecutable(command.name, command.args);
    const name = executable.name;
    const args = executable.args;
    const has = (value: string) => args.some((arg) => arg.toLowerCase() === value);
    if (
      (name === "rm" && hasRecursiveAndForce(args)) ||
      (name === "git" && has("reset") && has("--hard")) ||
      (name === "git" && has("clean") && args.some((arg) => /^-[a-z]*f/i.test(arg)))
    ) {
      return forced(
        "irrecoverable_data_loss",
        "The command can irreversibly delete data or destroy local version-control state.",
        command.writesPaths.length ? command.writesPaths : [name],
      );
    }
    if (["sudo", "doas", "pkexec"].includes(name)) {
      return forced(
        "privilege_or_security_boundary",
        "The command elevates privileges or changes a system/security boundary.",
        [name],
      );
    }
    if (
      (["npm", "pnpm", "yarn", "cargo"].includes(name) && has("publish")) ||
      (name === "terraform" && has("destroy")) ||
      (name === "kubectl" && has("delete")) ||
      (name === "git" && has("push") && args.some((arg) => arg === "-f" || arg.startsWith("--force")))
    ) {
      return forced(
        "irreversible_external_action",
        "The command performs an irreversible external, production, publication, or messaging action.",
        [name],
      );
    }
  }
  return null;
}

function unwrapExecutable(
  rawName: string,
  rawArgs: string[],
): { name: string; args: string[] } {
  let name = basename(rawName);
  let args = [...rawArgs];
  while (name === "env" || name === "command" || name === "xargs") {
    const index = args.findIndex(
      (arg) => !arg.startsWith("-") && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(arg),
    );
    if (index < 0) break;
    name = basename(args[index]!);
    args = args.slice(index + 1);
  }
  return { name, args };
}

function isMutatingExecutable(name: string, args: string[]): boolean {
  if (["mv", "cp", "install", "tee", "rm", "truncate"].includes(name)) return true;
  if (name === "sed") return args.some((arg) => arg === "-i" || arg.startsWith("-i"));
  if (name === "perl") return args.some((arg) => /^-.*i/.test(arg));
  return false;
}

function collectStringValues(value: unknown, depth = 0): string[] {
  if (depth > 5) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((entry) => collectStringValues(entry, depth + 1));
  if (!value || typeof value !== "object") return [];
  return Object.values(value as Record<string, unknown>).flatMap((entry) =>
    collectStringValues(entry, depth + 1),
  );
}

function basename(value: string): string {
  return value.replace(/\\/g, "/").split("/").at(-1)?.toLowerCase() ?? "";
}

function hasRecursiveAndForce(args: string[]): boolean {
  const flags = args.filter((arg) => arg.startsWith("-"));
  return (
    flags.some((flag) => flag === "--recursive" || /^-[a-z]*r/i.test(flag)) &&
    flags.some((flag) => flag === "--force" || /^-[a-z]*f/i.test(flag))
  );
}

function isRecursiveForcedRemove(command: string): boolean {
  const invocation = command.match(
    /(?:^|[;&|]\s*)(?:(?:command|env)\s+)?rm\s+([^\n;&|]+)/i,
  );
  const args = invocation?.[1] ?? "";
  const flags = args.match(/(?:^|\s)(--[a-z-]+|-[a-z]+)(?=\s|$)/gi) ?? [];
  const recursive = flags.some((flag) =>
    flag.includes("--recursive") || /^\s*-[a-z]*r/i.test(flag),
  );
  const forced = flags.some((flag) =>
    flag.includes("--force") || /^\s*-[a-z]*f/i.test(flag),
  );
  return recursive && forced;
}

function forced(
  category: Exclude<ExtremeRiskCategory, "none">,
  reason: string,
  affectedTargets: string[],
): ExtremeRiskAssessment {
  return {
    requiresConfirmation: true,
    category,
    reason,
    affectedTargets,
  };
}

function safeAssessment(): ExtremeRiskAssessment {
  return {
    requiresConfirmation: false,
    category: "none",
    reason: "The operation is not in the Policy B forced-confirmation class.",
    affectedTargets: [],
  };
}
