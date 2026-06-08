import type { AgentRunContext } from "./agentWorkspace";
import { isPathInsideRunContext } from "./agentWorkspace";
import type { SkillManifest } from "./skills";

export type AgentToolName =
  | "file_list"
  | "file_read"
  | "file_write"
  | "memory_search"
  | "conversation_search"
  | "web_search"
  | "web_fetch"
  | "shell_exec";

export type TaskPermissionPolicy = {
  files: {
    read: string[];
    write: string[];
  };
  web: {
    search: boolean;
    fetchDomains: string[];
  };
  shell: {
    commands: string[];
  };
  memory?: {
    read: boolean;
    write: boolean;
  };
};

export type ToolCallRequest = {
  toolName: AgentToolName;
  args: Record<string, unknown>;
};

export type ToolAuthorizationDecision = {
  allowed: boolean;
  reason: string;
};

export type ToolAuditEventInput = {
  taskId: string;
  request: ToolCallRequest;
  decision: ToolAuthorizationDecision;
};

export type ToolAuditEvent = ToolAuditEventInput & {
  id: string;
  createdAt: string;
};

export type AuthorizeTaskToolCallResult =
  | {
      ok: true;
      decision: ToolAuthorizationDecision;
      auditEvent: ToolAuditEvent;
    }
  | {
      ok: false;
      message: string;
    };

export type TaskPermissionPolicyValidationErrors = Partial<
  Record<"files" | "web" | "shell", string>
>;

export type TaskPermissionPolicyValidationResult = {
  valid: boolean;
  errors: TaskPermissionPolicyValidationErrors;
};

const destructiveShellPattern =
  /\b(rm\s+-[^\n]*(r|f)|git\s+reset\s+--hard|git\s+push\s+(-f|--force)|drop\s+(table|database)|truncate\s+table|kubectl\s+delete|docker\s+rm\s+-f)\b/i;
const shellControlOperatorPattern = /(;|&&|\|\||`|\$\(|\|)/;
const placeholderPattern = /\{\{[a-zA-Z][a-zA-Z0-9_]*\}\}/g;

export function getDefaultTaskPermissionPolicy(): TaskPermissionPolicy {
  return {
    files: { read: [], write: [] },
    web: { search: false, fetchDomains: [] },
    shell: { commands: [] },
    memory: { read: false, write: false },
  };
}

export function createPermissionPolicyFromSkillManifest(
  manifest: SkillManifest,
): TaskPermissionPolicy {
  return normalizeTaskPermissionPolicy({
    files: {
      read: manifest.permissions.files.read,
      write: manifest.permissions.files.write,
    },
    web: {
      search: manifest.permissions.web.search,
      fetchDomains: manifest.permissions.web.fetchDomains,
    },
    shell: {
      commands: manifest.permissions.shell.commands,
    },
    memory: {
      read: manifest.permissions.memory.read,
      write: manifest.permissions.memory.write,
    },
  });
}

export function normalizeTaskPermissionPolicy(
  policy: TaskPermissionPolicy,
): TaskPermissionPolicy {
  return {
    files: {
      read: unique(policy.files.read.map(normalizePermissionPath).filter(Boolean)),
      write: unique(policy.files.write.map(normalizePermissionPath).filter(Boolean)),
    },
    web: {
      search: Boolean(policy.web.search),
      fetchDomains: unique(
        policy.web.fetchDomains.map(normalizeDomain).filter(Boolean),
      ),
    },
    shell: {
      commands: unique(policy.shell.commands.map((command) => command.trim()).filter(Boolean)),
    },
    memory: {
      read: Boolean(policy.memory?.read),
      write: Boolean(policy.memory?.write),
    },
  };
}

export function validateTaskPermissionPolicy(
  policy: TaskPermissionPolicy,
): TaskPermissionPolicyValidationResult {
  const normalized = normalizeTaskPermissionPolicy(policy);
  const errors: TaskPermissionPolicyValidationErrors = {};
  const paths = [...normalized.files.read, ...normalized.files.write];

  if (paths.some((permissionPath) => !isApprovedPermissionPath(permissionPath))) {
    errors.files =
      "文件权限必须是绝对路径、用户主目录路径，或技能占位符。";
  }

  if (
    normalized.web.fetchDomains.some((domain) => !isValidHostname(domain))
  ) {
    errors.web = "网页抓取域名必须是有效主机名。";
  }

  if (
    normalized.shell.commands.some((command) =>
      destructiveShellPattern.test(command),
    )
  ) {
    errors.shell = "命令行模板不能包含破坏性命令。";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export function authorizeToolCall(
  policy: TaskPermissionPolicy,
  request: ToolCallRequest,
): ToolAuthorizationDecision {
  const normalized = normalizeTaskPermissionPolicy(policy);

  switch (request.toolName) {
    case "file_list":
      return authorizeFilePath(
        String(request.args.path ?? ""),
        normalized.files.read,
        "file_list 路径不在已授权可读目录内。",
      );
    case "file_read":
      return authorizeFilePath(
        String(request.args.path ?? ""),
        normalized.files.read,
        "file_read 路径不在已授权可读目录内。",
      );
    case "file_write":
      return authorizeFilePath(
        String(request.args.path ?? ""),
        normalized.files.write,
        "file_write 路径不在已授权可写目录内。",
      );
    case "memory_search":
    case "conversation_search":
      return normalized.memory?.read
        ? allow(`这个任务已允许 ${request.toolName}。`)
        : deny("这个任务未允许读取本地记忆。");
    case "web_search":
      return normalized.web.search
        ? allow("这个任务已允许 web_search。")
        : deny("这个任务未允许 web_search。");
    case "web_fetch":
      return authorizeWebFetch(String(request.args.url ?? ""), normalized);
    case "shell_exec":
      return authorizeShellCommand(
        String(request.args.command ?? ""),
        normalized.shell.commands,
      );
  }
}

export function authorizeToolCallWithinRunContext(
  policy: TaskPermissionPolicy,
  request: ToolCallRequest,
  runContext?: AgentRunContext,
): ToolAuthorizationDecision {
  const taskDecision = authorizeToolCall(policy, request);
  if (!taskDecision.allowed || !runContext) {
    return taskDecision;
  }

  if (runContext.sandbox.network === "none" && request.toolName.startsWith("web_")) {
    return deny(`${request.toolName} 被运行沙箱阻止：网络访问已禁用。`);
  }

  if (request.toolName === "file_write" && runContext.sandbox.mode === "read_only") {
    return deny("file_write 被运行沙箱阻止：当前运行是只读沙箱。");
  }

  if (!runContext.sandbox.allowWorkspaceEscape) {
    const fileDecision = authorizeWorkspaceFileRequest(request, runContext);
    if (fileDecision) {
      return fileDecision;
    }
  }

  if (request.toolName === "shell_exec" && runContext.sandbox.shell === "disabled") {
    return deny("shell_exec 被运行沙箱阻止：命令执行已禁用。");
  }

  return taskDecision;
}

function authorizeFilePath(
  requestedPath: string,
  approvedDirectories: string[],
  deniedReason: string,
): ToolAuthorizationDecision {
  if (!requestedPath) {
    return deny("文件工具调用缺少 path。");
  }

  const resolvedRequestedPath = expandHomePath(requestedPath);
  const allowed = approvedDirectories.some((approvedDirectory) =>
    isPathInsideDirectory(resolvedRequestedPath, expandHomePath(approvedDirectory)),
  );

  return allowed ? allow("文件路径位于已授权目录内。") : deny(deniedReason);
}

function authorizeWorkspaceFileRequest(
  request: ToolCallRequest,
  runContext: AgentRunContext,
): ToolAuthorizationDecision | null {
  if (request.toolName !== "file_list" && request.toolName !== "file_read" && request.toolName !== "file_write") {
    return null;
  }

  const access = request.toolName === "file_write" ? "write" : "read";
  const requestedPath = String(request.args.path ?? "");
  if (!requestedPath) {
    return null;
  }

  if (isPathInsideRunContext(requestedPath, runContext, access)) {
    return null;
  }

  return deny(
    `${request.toolName} 被运行沙箱阻止：路径不在工作区或额外可${access === "read" ? "读" : "写"}目录内。`,
  );
}

function authorizeWebFetch(
  url: string,
  policy: TaskPermissionPolicy,
): ToolAuthorizationDecision {
  let hostname: string;

  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return deny("web_fetch URL 必须是有效 URL。");
  }

  const allowed = policy.web.fetchDomains.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
  );

  return allowed
    ? allow("web_fetch URL 域名位于允许列表内。")
    : deny("web_fetch URL 域名不在允许列表内。");
}

function authorizeShellCommand(
  command: string,
  templates: string[],
): ToolAuthorizationDecision {
  if (!command) {
    return deny("shell_exec command 必填。");
  }

  if (shellControlOperatorPattern.test(command)) {
    return deny("shell_exec command 包含被阻止的 shell 控制符。");
  }

  const allowed = templates.some((template) =>
    compileShellTemplate(template).test(command),
  );

  return allowed
    ? allow("shell_exec command 匹配已授权模板。")
    : deny("shell_exec command 不匹配已授权模板。");
}

function compileShellTemplate(template: string): RegExp {
  const pieces: string[] = [];
  let cursor = 0;

  for (const match of template.matchAll(placeholderPattern)) {
    pieces.push(escapeRegExp(template.slice(cursor, match.index)));
    pieces.push(shellArgPattern());
    cursor = match.index + match[0].length;
  }

  pieces.push(escapeRegExp(template.slice(cursor)));

  return new RegExp(`^${pieces.join("").replace(/\\\s+/g, "\\s+")}$`);
}

function shellArgPattern(): string {
  return "(?:\"[^\"\\n;&|`$]+\"|'[^'\\n;&|`$]+'|[A-Za-z0-9_./~:@%+=,-]+)";
}

function normalizePermissionPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || isSkillPlaceholder(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith("~/")) {
    return `~/${trimSlashes(trimmed.slice(2))}`;
  }

  if (!trimmed.startsWith("/")) {
    return trimmed.replace(/\/+$/, "");
  }

  return normalizeComparablePath(trimmed);
}

function normalizeDomain(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }

  try {
    if (trimmed.includes("://")) {
      return new URL(trimmed).hostname.toLowerCase();
    }
  } catch {
    return trimmed;
  }

  return trimmed.replace(/\/.*$/, "");
}

function isApprovedPermissionPath(value: string): boolean {
  return (
    isSkillPlaceholder(value) ||
    value.startsWith("/") ||
    value.startsWith("~/")
  );
}

function isSkillPlaceholder(value: string): boolean {
  return /^{{[a-zA-Z][a-zA-Z0-9_]*}}$/.test(value);
}

function isValidHostname(value: string): boolean {
  return /^(?!-)([a-z0-9-]{1,63}\.)*[a-z0-9-]{1,63}\.[a-z]{2,63}$/i.test(
    value,
  );
}

function isPathInsideDirectory(requestedPath: string, approvedDirectory: string): boolean {
  if (isSkillPlaceholder(approvedDirectory)) {
    return false;
  }

  const normalizedRequestedPath = normalizeComparablePath(requestedPath);
  const normalizedApprovedDirectory = normalizeComparablePath(approvedDirectory);

  return (
    normalizedRequestedPath === normalizedApprovedDirectory ||
    normalizedRequestedPath.startsWith(`${normalizedApprovedDirectory}/`)
  );
}

function expandHomePath(value: string): string {
  if (value === "~") {
    return "/__HOME__";
  }

  if (value.startsWith("~/")) {
    return `/__HOME__/${value.slice(2)}`;
  }

  return value;
}

function normalizeComparablePath(value: string): string {
  const expanded = expandHomePath(value).replace(/\/+$/, "");
  const absolute = expanded.startsWith("/") ? expanded : `/${expanded}`;
  const parts: string[] = [];

  for (const part of absolute.split("/")) {
    if (!part || part === ".") {
      continue;
    }

    if (part === "..") {
      parts.pop();
      continue;
    }

    parts.push(part);
  }

  return `/${parts.join("/")}`;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function allow(reason: string): ToolAuthorizationDecision {
  return { allowed: true, reason };
}

function deny(reason: string): ToolAuthorizationDecision {
  return { allowed: false, reason };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
