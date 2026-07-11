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
const AUTHORIZATION_SOURCE_PATH = /(?:toolApprovalCoordinator|toolAuthorizationService|extremeRiskPolicy|toolPermissions)\.(?:ts|tsx|js)$/i;
const SECRET_WORDS = /(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|secret|credentials?|private[_-]?key|\.ssh\/id_|\.aws\/|\.gnupg\/|\.env\b|cookie)/i;
const NETWORK_TRANSMITTER = /(?:^|[;&|]\s*)(?:curl|wget|scp|sftp|rsync|nc|ncat|netcat)\b/i;

export function classifyExtremeRisk(
  request: ToolCallRequest,
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
    (toolName === "file_write" || toolName === "markdown_report_write") &&
    AUTHORIZATION_SOURCE_PATH.test(String(request.args.path ?? ""))
  ) {
    return forced(
      "privilege_or_security_boundary",
      "The write changes the agent's authorization boundary.",
      [String(request.args.path ?? "")],
    );
  }

  if (toolName !== "shell_exec") {
    return safeAssessment();
  }

  const command = String(request.args.command ?? "").trim();
  if (!command) return safeAssessment();

  if (DESTRUCTIVE_GIT.some((pattern) => pattern.test(command)) ||
      DESTRUCTIVE_STORAGE.some((pattern) => pattern.test(command))) {
    return forced(
      "irrecoverable_data_loss",
      "The command can irreversibly delete data or destroy local version-control state.",
      [command],
    );
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
