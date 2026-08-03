import type { AgentRunContext } from "./agentWorkspace";
import {
  isPathInsideRunContext,
  validatePathInsideRunContext,
} from "./agentWorkspace";
import {
  isPathInsideLocationRoot,
  normalizeLocationEnvironment,
  validatePathInsideLocationRoots,
  type LocationResourceEnvironment,
} from "./locationResource";
import type { SkillManifest } from "./skills";
import { findBlockedShellControl } from "./acceptanceCommand";

export type AgentToolName =
  | "file_list"
  | "file_stat"
  | "file_search"
  | "file_inventory"
  | "file_move_plan"
  | "file_apply_moves"
  | "file_verify_moves"
  | "file_rollback_moves"
  | "file_read"
  | "tool_result_read"
  | "file_write"
  | "chrome_bookmarks_read"
  | "code_search"
  | "git_status"
  | "git_diff"
  | "test_run"
  | "memory_search"
  | "conversation_search"
  | "history_search"
  | "history_around"
  | "skill_resource_list"
  | "skill_load"
  | "web_search"
  | "web_fetch"
  | "web_fetch_document"
  | "citation_record"
  | "citation_coverage_check"
  | "markdown_report_write"
  | "shell_exec"
  | "actor" // P6
  | "workflow"; // P6

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
  tools?: {
    allowedNames: string[];
    allowedSources: string[];
    allowedSkillNames?: string[];
  };
};

export type ToolCallRequest = {
  toolName: string;
  source?: string;
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
    tools: {
      allowedNames: manifest.tools?.map((tool) => tool.name) ?? [],
      allowedSkillNames: [manifest.name],
      allowedSources: [
        ...(manifest.tools?.length ? [`skill:${manifest.name}`] : []),
        ...(manifest.mcpServers?.map(
          (server) => `mcp:${manifest.name}:${server.name}`,
        ) ?? []),
      ],
    },
  });
}

export function normalizeTaskPermissionPolicy(
  policy: TaskPermissionPolicy,
): TaskPermissionPolicy {
  const tools = normalizeDynamicToolPolicy(policy.tools);

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
    ...(tools ? { tools } : {}),
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
  locationEnv?: LocationResourceEnvironment,
): ToolAuthorizationDecision {
  const normalized = normalizeTaskPermissionPolicy(policy);
  const env = normalizeLocationEnvironment(locationEnv);

  switch (request.toolName) {
    case "file_list":
      return authorizeFilePath(
        String(request.args.path ?? ""),
        normalized.files.read,
        "file_list 路径不在已授权可读目录内。",
        env,
      );
    case "file_stat":
      return authorizeFilePath(
        String(request.args.path ?? ""),
        normalized.files.read,
        "file_stat 路径不在已授权可读目录内。",
        env,
      );
    case "file_search":
      return authorizeFilePath(
        String(request.args.root ?? ""),
        normalized.files.read,
        "file_search 根目录不在已授权可读目录内。",
        env,
      );
    case "file_inventory":
      return authorizeFilePath(
        String(request.args.path ?? ""),
        normalized.files.read,
        "file_inventory 路径不在已授权可读目录内。",
        env,
      );
    case "file_move_plan":
      return authorizeFilePath(
        String(request.args.targetDir ?? ""),
        normalized.files.read,
        "file_move_plan 目标目录不在已授权可读目录内。",
        env,
      );
    case "file_apply_moves":
      return authorizeOrganizerPaths(
        request.args,
        normalized.files.write,
        "file_apply_moves 根目录不在已授权可写目录内。",
        env,
      );
    case "file_verify_moves":
      return authorizeOrganizerPaths(
        request.args,
        normalized.files.read,
        "file_verify_moves 根目录不在已授权可读目录内。",
        env,
      );
    case "file_rollback_moves":
      return authorizeOrganizerPaths(
        request.args,
        normalized.files.write,
        "file_rollback_moves 根目录不在已授权可写目录内。",
        env,
      );
    case "file_read":
      if (isSafeToolResultRef(String(request.args.path ?? ""))) {
        return allow("允许读取本次运行的工具结果引用。");
      }
      return authorizeFilePath(
        String(request.args.path ?? ""),
        normalized.files.read,
        "file_read 路径不在已授权可读目录内。",
        env,
      );
    case "tool_result_read":
      return isSafeToolResultRef(String(request.args.ref ?? ""))
        ? allow("允许读取本次运行的工具结果引用。")
        : deny("tool_result_read 引用无效。");
    case "file_write":
      return authorizeFilePath(
        String(request.args.path ?? ""),
        normalized.files.write,
        "file_write 路径不在已授权可写目录内。",
        env,
      );
    case "chrome_bookmarks_read":
      return authorizeFilePath(
        getChromeBookmarksAuthorizationPath(request.args),
        normalized.files.read,
        "chrome_bookmarks_read Chrome 书签目录不在已授权可读目录内。",
        env,
      );
    case "code_search":
      return authorizeWorkspaceRoot(
        String(request.args.workspaceRoot ?? ""),
        normalized.files.read,
        "code_search workspaceRoot 不在已授权可读目录内。",
        env,
      );
    case "git_status":
      return authorizeWorkspaceRoot(
        String(request.args.workspaceRoot ?? ""),
        normalized.files.read,
        "git_status workspaceRoot 不在已授权可读目录内。",
        env,
      );
    case "git_diff":
      return authorizeWorkspaceRoot(
        String(request.args.workspaceRoot ?? ""),
        normalized.files.read,
        "git_diff workspaceRoot 不在已授权可读目录内。",
        env,
      );
    case "test_run": {
      const workspaceDecision = authorizeWorkspaceRoot(
        String(request.args.workspaceRoot ?? ""),
        normalized.files.read,
        "test_run workspaceRoot 不在已授权可读目录内。",
        env,
      );
      if (!workspaceDecision.allowed) {
        return workspaceDecision;
      }

      return authorizeShellCommand(
        String(request.args.command ?? ""),
        normalized.shell.commands,
        { toolName: "test_run", templateLabel: "测试模板" },
      );
    }
    case "memory_search":
    case "conversation_search":
    case "history_search":
    case "history_around":
      return normalized.memory?.read
        ? allow(`这个任务已允许 ${request.toolName}。`)
        : deny("这个任务未允许读取本地记忆。");
    case "skill_resource_list":
    case "skill_load":
      return authorizeSkillLazyLoadTool(request.toolName, request.args, normalized);
    case "web_search":
      return normalized.web.search
        ? allow("这个任务已允许 web_search。")
        : deny("这个任务未允许 web_search。");
    case "web_fetch":
      return authorizeWebFetch(String(request.args.url ?? ""), normalized);
    case "web_fetch_document":
      return authorizeWebFetch(String(request.args.url ?? ""), normalized);
    case "citation_record":
      return authorizeWebFetch(String(request.args.url ?? ""), normalized);
    case "citation_coverage_check":
      return allow("citation_coverage_check 仅检查已提供的引用结构。");
    case "markdown_report_write":
      return authorizeFilePath(
        String(request.args.path ?? ""),
        normalized.files.write,
        "markdown_report_write 路径不在已授权可写目录内。",
        env,
      );
    case "shell_exec":
      return authorizeShellCommand(
        String(request.args.command ?? ""),
        normalized.shell.commands,
      );
  }

  if (normalized.tools?.allowedNames.includes(request.toolName)) {
    return allow(`动态工具 ${request.toolName} 已由任务显式允许。`);
  }

  if (
    request.source &&
    normalized.tools?.allowedSources.includes(request.source)
  ) {
    return allow(
      `动态工具 ${request.toolName} 来自已允许来源 ${request.source}。`,
    );
  }

  return deny(`工具 ${request.toolName} 尚未配置授权规则。`);
}

export function authorizeToolCallWithinRunContext(
  policy: TaskPermissionPolicy,
  request: ToolCallRequest,
  runContext?: AgentRunContext,
  opts?: {
    shellPlan?: {
      touchedPaths: string[];
      networkAccess?: boolean;
      opaqueExecution?: boolean;
      commands?: Array<{ writesPaths: string[] }>;
    };
  },
): ToolAuthorizationDecision {
  const taskDecision = authorizeToolCall(
    policy,
    request,
    runContext
      ? {
          ...runContext.locationEnv,
          workspaceRoot: runContext.workspaceRoot,
        }
      : undefined,
  );
  if (!runContext) {
    return taskDecision;
  }

  if (runContext.sandbox.network === "none" && request.toolName.startsWith("web_")) {
    return deny(`${request.toolName} 被运行沙箱阻止：网络访问已禁用。`);
  }

  if (
    (request.toolName === "shell_exec" || request.toolName === "test_run") &&
    runContext.sandbox.network === "none" &&
    opts?.shellPlan?.networkAccess
  ) {
    return deny(`${request.toolName} 被运行沙箱阻止：网络访问已禁用。`);
  }

  if (
    runContext.sandbox.network === "none" &&
    request.source &&
    request.source !== "built-in"
  ) {
    return deny(`${request.toolName} 被运行沙箱阻止：动态工具网络访问已禁用。`);
  }

  if (
    (request.toolName === "file_write" ||
      request.toolName === "file_apply_moves" ||
      request.toolName === "file_rollback_moves" ||
      request.toolName === "markdown_report_write" ||
      request.toolName === "chrome_bookmarks_read") &&
    runContext.sandbox.mode === "read_only"
  ) {
    return deny(`${request.toolName} 被运行沙箱阻止：当前运行是只读沙箱。`);
  }

  if (
    request.toolName === "shell_exec" &&
    runContext.sandbox.mode === "read_only"
  ) {
    return deny("shell_exec 被运行沙箱阻止：当前运行是只读沙箱。");
  }

  if (
    (request.toolName === "shell_exec" || request.toolName === "test_run") &&
    !runContext.sandbox.allowWorkspaceEscape &&
    opts?.shellPlan?.opaqueExecution &&
    !taskDecision.allowed
  ) {
    return deny(
      `${request.toolName} 被运行沙箱阻止：无法证明嵌套解释器命令位于工作区内。`,
    );
  }

  if (!runContext.sandbox.allowWorkspaceEscape) {
    const fileDecision = authorizeWorkspaceFileRequest(request, runContext);
    if (fileDecision) {
      return fileDecision;
    }
  }

  if (
    (request.toolName === "shell_exec" || request.toolName === "test_run") &&
    runContext.sandbox.shell === "disabled"
  ) {
    return deny(`${request.toolName} 被运行沙箱阻止：命令执行已禁用。`);
  }

  if (
    (request.toolName === "shell_exec" || request.toolName === "test_run") &&
    !runContext.sandbox.allowWorkspaceEscape &&
    runContext.sandbox.shell !== "disabled"
  ) {
    const command = String(request.args.command ?? "");
    // Patch 4: prefer ShellPlan.touchedPaths (per-command read/write paths)
    // as the single source of truth; fall back to the legacy tokenizer when
    // no plan is provided (zero regression).
    const candidatePaths = opts?.shellPlan
      ? opts.shellPlan.touchedPaths
      : extractPathLikeShellTokens(command);
    const outsidePath = candidatePaths.find(
      (token) =>
        !isPathInsideRunContext(token, runContext, "read") &&
        !isPathInsideRunContext(token, runContext, "write"),
    );

    if (outsidePath) {
      return deny(
        `${request.toolName} 被运行沙箱阻止：路径 ${outsidePath} 不在工作区或额外可读目录内。`,
      );
    }
  }

  return taskDecision;
}

function authorizeFilePath(
  requestedPath: string,
  approvedDirectories: string[],
  deniedReason: string,
  locationEnv?: LocationResourceEnvironment,
): ToolAuthorizationDecision {
  if (!requestedPath) {
    return deny("文件工具调用缺少 path。");
  }

  const env = normalizeLocationEnvironment(locationEnv);
  const allowed = approvedDirectories.some((approvedDirectory) =>
    isSkillPlaceholder(approvedDirectory)
      ? false
      : validatePathInsideLocationRoots(requestedPath, [approvedDirectory], env).ok,
  );

  return allowed ? allow("文件路径位于已授权目录内。") : deny(deniedReason);
}

function authorizeWorkspaceRoot(
  workspaceRoot: string,
  approvedDirectories: string[],
  deniedReason: string,
  locationEnv?: LocationResourceEnvironment,
): ToolAuthorizationDecision {
  if (!workspaceRoot) {
    return deny("原生工具调用缺少 workspaceRoot。");
  }

  const env = normalizeLocationEnvironment(locationEnv);
  const allowed = approvedDirectories.some((approvedDirectory) =>
    isSkillPlaceholder(approvedDirectory)
      ? false
      : validatePathInsideLocationRoots(workspaceRoot, [approvedDirectory], env).ok,
  );

  return allowed ? allow("路径在已授权范围内。") : deny(deniedReason);
}

function authorizeOrganizerPaths(
  args: Record<string, unknown>,
  approvedDirectories: string[],
  deniedReason: string,
  locationEnv?: LocationResourceEnvironment,
): ToolAuthorizationDecision {
  const root = getOrganizerRoot(args);
  if (!root) {
    return deny("文件工具调用缺少 path。");
  }

  const paths = getOrganizerRequestPaths(args);
  const env = normalizeLocationEnvironment(locationEnv);
  const allowed = paths.every((requestedPath) =>
    approvedDirectories.some((approvedDirectory) =>
      isSkillPlaceholder(approvedDirectory)
        ? false
        : validatePathInsideLocationRoots(requestedPath, [approvedDirectory], env).ok,
    ),
  );

  return allowed ? allow("文件路径位于已授权目录内。") : deny(deniedReason);
}

function getOrganizerRoot(args: Record<string, unknown>): string {
  if (typeof args.root === "string") {
    return args.root;
  }
  if (isRecord(args.preview) && typeof args.preview.root === "string") {
    return args.preview.root;
  }
  if (isRecord(args.transaction) && typeof args.transaction.root === "string") {
    return args.transaction.root;
  }
  return "";
}

function getChromeBookmarksAuthorizationPath(args: Record<string, unknown>): string {
  if (typeof args.bookmarksPath === "string" && args.bookmarksPath.trim()) {
    return args.bookmarksPath;
  }

  if (typeof args.chromeUserDataDir === "string" && args.chromeUserDataDir.trim()) {
    return args.chromeUserDataDir;
  }

  return "~/Library/Application Support/Google/Chrome";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isSafeToolResultRef(ref: string): boolean {
  return /^tool-result-refs\/[a-zA-Z0-9._-]+\.json$/.test(ref);
}

function authorizeWorkspaceFileRequest(
  request: ToolCallRequest,
  runContext: AgentRunContext,
): ToolAuthorizationDecision | null {
  if (
    request.toolName !== "file_list" &&
    request.toolName !== "file_stat" &&
    request.toolName !== "file_search" &&
    request.toolName !== "file_inventory" &&
    request.toolName !== "file_move_plan" &&
    request.toolName !== "file_apply_moves" &&
    request.toolName !== "file_verify_moves" &&
    request.toolName !== "file_rollback_moves" &&
    request.toolName !== "file_read" &&
    request.toolName !== "file_write" &&
    request.toolName !== "code_search" &&
    request.toolName !== "git_status" &&
    request.toolName !== "git_diff" &&
    request.toolName !== "test_run" &&
    request.toolName !== "markdown_report_write"
  ) {
    return null;
  }

  const access =
    request.toolName === "file_write" ||
    request.toolName === "file_apply_moves" ||
    request.toolName === "file_rollback_moves" ||
    request.toolName === "markdown_report_write"
      ? "write"
      : "read";
  const isNativeWorkspaceRootTool =
    request.toolName === "code_search" ||
    request.toolName === "git_status" ||
    request.toolName === "git_diff" ||
    request.toolName === "test_run";
  const requestedPaths = getWorkspaceFileRequestPaths(request);
  if (!requestedPaths.length) {
    return null;
  }

  const outsidePath = requestedPaths.find(
    (requestedPath) =>
      !validatePathInsideRunContext(requestedPath, runContext, access).ok,
  );
  if (!outsidePath) {
    return null;
  }

  const pathLabel = isNativeWorkspaceRootTool ? "workspaceRoot " : "路径";
  return deny(
    `${request.toolName} 被运行沙箱阻止：${pathLabel}不在工作区或额外可${access === "read" ? "读" : "写"}目录内。`,
  );
}

function getWorkspaceFileRequestPaths(request: ToolCallRequest): string[] {
  if (
    request.toolName === "code_search" ||
    request.toolName === "git_status" ||
    request.toolName === "git_diff" ||
    request.toolName === "test_run"
  ) {
    return compactStringList([request.args.workspaceRoot]);
  }

  if (request.toolName === "file_search") {
    return compactStringList([request.args.root]);
  }

  if (request.toolName === "file_move_plan") {
    return compactStringList([request.args.targetDir]);
  }

  if (
    request.toolName === "file_apply_moves" ||
    request.toolName === "file_verify_moves" ||
    request.toolName === "file_rollback_moves"
  ) {
    return getOrganizerRequestPaths(request.args);
  }

  return compactStringList([request.args.path]);
}

function getOrganizerRequestPaths(args: Record<string, unknown>): string[] {
  const paths: string[] = [];
  const root = getOrganizerRoot(args);
  if (root) {
    paths.push(root);
  }

  for (const owner of [args.preview, args.transaction]) {
    if (!isRecord(owner)) {
      continue;
    }
    if (typeof owner.logPath === "string") {
      paths.push(owner.logPath);
    }
    if (!Array.isArray(owner.moves)) {
      continue;
    }
    for (const move of owner.moves) {
      if (!isRecord(move)) {
        continue;
      }
      if (typeof move.from === "string") {
        paths.push(move.from);
      }
      if (typeof move.to === "string") {
        paths.push(move.to);
      }
    }
  }

  return unique(paths);
}

function compactStringList(values: unknown[]): string[] {
  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
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

function authorizeSkillLazyLoadTool(
  toolName: "skill_resource_list" | "skill_load",
  args: Record<string, unknown>,
  policy: TaskPermissionPolicy,
): ToolAuthorizationDecision {
  if (!policy.tools?.allowedNames.includes(toolName)) {
    return deny(`工具 ${toolName} 尚未配置授权规则。`);
  }

  const skillName = String(args.skillName ?? "").trim();
  if (!skillName) {
    return deny(`${toolName} skillName 必填。`);
  }

  if (!policy.tools.allowedSkillNames?.includes(skillName)) {
    return deny(`${toolName} 请求的技能 ${skillName} 不在本次运行授权技能内。`);
  }

  return allow(`${toolName} 已绑定到本次运行授权技能 ${skillName}。`);
}

function authorizeShellCommand(
  command: string,
  templates: string[],
  options: {
    toolName?: AgentToolName;
    templateLabel?: string;
  } = {},
): ToolAuthorizationDecision {
  const toolName = options.toolName ?? "shell_exec";
  const templateLabel = options.templateLabel ?? "模板";
  if (!command) {
    return deny(`${toolName} command 必填。`);
  }

  if (findBlockedShellControl(command)) {
    return deny(`${toolName} command 包含被阻止的 shell 控制符。`);
  }

  const allowed = templates.some((template) =>
    compileShellTemplate(template).test(command),
  );

  return allowed
    ? allow(`${toolName} command 匹配已授权${templateLabel}。`)
    : deny(`${toolName} command 不匹配已授权${templateLabel}。`);
}

export function extractPathLikeShellTokens(command: string): string[] {
  const tokens = command.match(/(?:"[^"]+"|'[^']+'|[^\s]+)/g) ?? [];
  return tokens
    .map((token) => token.replace(/^["']|["']$/g, ""))
    .map((token) => {
      const equalsIndex = token.indexOf("=");
      return equalsIndex >= 0 ? token.slice(equalsIndex + 1) : token;
    })
    .filter((token) => isShellPathLikeToken(token));
}

function isShellPathLikeToken(token: string): boolean {
  return (
    token.startsWith("/") ||
    token.startsWith("~/") ||
    token === ".." ||
    token.startsWith("../") ||
    token.startsWith("./") ||
    token.includes("/") ||
    /^(?:Desktop|Downloads|桌面|下载)\//.test(token)
  );
}

function compileShellTemplate(template: string): RegExp {
  const pieces: string[] = [];
  let cursor = 0;
  const tokenPattern = /(\{\{[a-zA-Z][a-zA-Z0-9_]*\}\}|\*)/g;

  for (const match of template.matchAll(tokenPattern)) {
    pieces.push(escapeRegExp(template.slice(cursor, match.index)));
    pieces.push(shellArgPattern());
    cursor = match.index + match[0].length;
  }

  pieces.push(escapeRegExp(template.slice(cursor)));

  return new RegExp(`^${pieces.join("").replace(/\\\s+/g, "\\s+")}$`);
}

function shellArgPattern(): string {
  return "(?:\"[^\"\\n;&|`$<>]+\"|'[^'\\n;&|`$<>]+'|[^\\s;&|`$<>]+)";
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

function normalizeDynamicToolPolicy(
  tools: TaskPermissionPolicy["tools"] | undefined,
): TaskPermissionPolicy["tools"] | null {
  const allowedNames = unique(
    (tools?.allowedNames ?? []).map((name) => name.trim()).filter(Boolean),
  );
  const allowedSources = unique(
    (tools?.allowedSources ?? []).map((source) => source.trim()).filter(Boolean),
  );
  const allowedSkillNames = unique(
    (tools?.allowedSkillNames ?? [])
      .map((skillName) => skillName.trim())
      .filter(Boolean),
  );

  if (!allowedNames.length && !allowedSources.length && !allowedSkillNames.length) {
    return null;
  }

  return {
    allowedNames,
    allowedSources,
    ...(allowedSkillNames.length ? { allowedSkillNames } : {}),
  };
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
