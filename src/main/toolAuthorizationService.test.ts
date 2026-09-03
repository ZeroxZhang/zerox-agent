import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createScheduledTaskStore } from "./taskStore";
import { createToolAuditLog } from "./toolAuditLog";
import {
  createToolAuthorizationService,
  type ToolUserApprovalRequest,
} from "./toolAuthorizationService";
import { buildPrimaryRunContext } from "../shared/agentWorkspace";
import {
  authorizeToolCallWithinRunContext,
  type TaskPermissionPolicy,
} from "../shared/toolPermissions";
import { analyzeShell } from "./tools/shell/shellAnalyzer";

describe("tool authorization service", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(
      path.join(os.tmpdir(), "building-agent-authz-"),
    );
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  it("authorizes a tool call against the task policy and writes an audit event", async () => {
    const taskStore = createScheduledTaskStore({
      configDir,
      createId: () => "task_123",
      now: () => new Date("2026-06-05T08:00:00.000Z"),
    });
    const auditLog = createToolAuditLog({
      configDir,
      createId: () => "audit_123",
      now: () => new Date("2026-06-05T08:01:00.000Z"),
    });
    const service = createToolAuthorizationService({ taskStore, auditLog });
    await taskStore.create({
      name: "Organize downloads",
      skillName: "local-file-organizer",
      enabled: true,
      schedule: { kind: "manual" },
      input: {},
      permissions: {
        files: { read: ["/Users/demo/Downloads"], write: [] },
        web: { search: false, fetchDomains: [] },
        shell: { commands: [] },
      },
    });

    const result = await service.authorize("task_123", {
      toolName: "file_read",
      args: { path: "/Users/demo/Downloads/notes.md" },
    });

    expect(result).toEqual({
      ok: true,
      decision: {
        allowed: true,
        kind: "allowed",
        reason: "文件路径位于已授权目录内。",
      },
      auditEvent: {
        id: "audit_123",
        taskId: "task_123",
        request: {
          toolName: "file_read",
          args: { path: "/Users/demo/Downloads/notes.md" },
        },
        decision: {
          allowed: true,
          kind: "allowed",
          reason: "文件路径位于已授权目录内。",
        },
        createdAt: "2026-06-05T08:01:00.000Z",
      },
    });
    await expect(auditLog.list()).resolves.toHaveLength(1);
  });

  it("authorizes a policy-allowed shell command through an allow permission rule and writes audit evidence", async () => {
    const taskStore = createScheduledTaskStore({
      configDir,
      createId: () => "task_rule_allow",
      now: () => new Date("2026-06-05T08:00:00.000Z"),
    });
    const auditLog = createToolAuditLog({
      configDir,
      createId: () => "audit_rule_allow",
      now: () => new Date("2026-06-05T08:01:00.000Z"),
    });
    const service = createToolAuthorizationService({
      taskStore,
      auditLog,
      permissionRules: [{ pattern: "git *", action: "allow" }],
    });
    await taskStore.create({
      name: "Rule allow",
      skillName: "local-shell",
      enabled: true,
      schedule: { kind: "manual" },
      input: {},
      permissions: {
        files: { read: [], write: [] },
        web: { search: false, fetchDomains: [] },
        shell: { commands: ["git status *"] },
      },
    });

    const result = await service.authorize("task_rule_allow", {
      toolName: "shell_exec",
      args: { command: "git status --short" },
    });

    expect(result).toMatchObject({
      ok: true,
      decision: {
        allowed: true,
        reason:
          "Permission rule allowed git status (git *). shell_exec command 匹配已授权模板。",
      },
      auditEvent: {
        id: "audit_rule_allow",
        decision: {
          allowed: true,
          reason:
            "Permission rule allowed git status (git *). shell_exec command 匹配已授权模板。",
        },
      },
    });
    await expect(auditLog.list()).resolves.toHaveLength(1);
  });

  it("does not let an allow permission rule bypass task shell policy", async () => {
    const taskStore = createScheduledTaskStore({
      configDir,
      createId: () => "task_rule_policy_guard",
      now: () => new Date("2026-06-05T08:00:00.000Z"),
    });
    const auditLog = createToolAuditLog({
      configDir,
      createId: () => "audit_rule_policy_guard",
      now: () => new Date("2026-06-05T08:01:00.000Z"),
    });
    const service = createToolAuthorizationService({
      taskStore,
      auditLog,
      permissionRules: [{ pattern: "git *", action: "allow" }],
    });
    await taskStore.create({
      name: "Rule allow guarded",
      skillName: "local-shell",
      enabled: true,
      schedule: { kind: "manual" },
      input: {},
      permissions: {
        files: { read: [], write: [] },
        web: { search: false, fetchDomains: [] },
        shell: { commands: [] },
      },
    });

    const result = await service.authorize("task_rule_policy_guard", {
      toolName: "shell_exec",
      args: { command: "git status --short" },
    });

    expect(result).toMatchObject({
      ok: true,
      decision: {
        allowed: false,
        reason: "shell_exec command 不匹配已授权模板。",
      },
      auditEvent: {
        id: "audit_rule_policy_guard",
        decision: {
          allowed: false,
          reason: "shell_exec command 不匹配已授权模板。",
        },
      },
    });
  });

  it("does not let an allow permission rule bypass shell safety guards", async () => {
    const taskStore = createScheduledTaskStore({
      configDir,
      createId: () => "task_rule_shell_guard",
      now: () => new Date("2026-06-05T08:00:00.000Z"),
    });
    const auditLog = createToolAuditLog({
      configDir,
      createId: () => "audit_rule_shell_guard",
      now: () => new Date("2026-06-05T08:01:00.000Z"),
    });
    const service = createToolAuthorizationService({
      taskStore,
      auditLog,
      permissionRules: [{ pattern: "git *", action: "allow" }],
    });
    await taskStore.create({
      name: "Rule shell guard",
      skillName: "local-shell",
      enabled: true,
      schedule: { kind: "manual" },
      input: {},
      permissions: {
        files: { read: [], write: [] },
        web: { search: false, fetchDomains: [] },
        shell: { commands: ["git *"] },
      },
    });

    const result = await service.authorize("task_rule_shell_guard", {
      toolName: "shell_exec",
      args: { command: "git status --short && rm -rf /tmp/cache" },
    });

    expect(result).toMatchObject({
      ok: true,
      decision: {
        allowed: false,
        reason: "shell_exec command 包含被阻止的 shell 控制符。",
      },
      auditEvent: {
        id: "audit_rule_shell_guard",
        decision: {
          allowed: false,
          reason: "shell_exec command 包含被阻止的 shell 控制符。",
        },
      },
    });
  });

  it("denies a shell command through a deny permission rule and writes audit evidence", async () => {
    const taskStore = createScheduledTaskStore({
      configDir,
      createId: () => "task_rule_deny",
      now: () => new Date("2026-06-05T08:00:00.000Z"),
    });
    const auditLog = createToolAuditLog({
      configDir,
      createId: () => "audit_rule_deny",
      now: () => new Date("2026-06-05T08:01:00.000Z"),
    });
    const service = createToolAuthorizationService({
      taskStore,
      auditLog,
      permissionRules: [{ pattern: "rm -rf *", action: "deny" }],
    });
    await taskStore.create({
      name: "Rule deny",
      skillName: "local-shell",
      enabled: true,
      schedule: { kind: "manual" },
      input: {},
      permissions: {
        files: { read: [], write: [] },
        web: { search: false, fetchDomains: [] },
        shell: { commands: [] },
      },
    });

    const result = await service.authorize("task_rule_deny", {
      toolName: "shell_exec",
      args: { command: "rm -rf /tmp/cache" },
    });

    expect(result).toMatchObject({
      ok: true,
      decision: {
        allowed: false,
        reason: "Permission rule denied rm (rm -rf *).",
      },
      auditEvent: {
        id: "audit_rule_deny",
        decision: {
          allowed: false,
          reason: "Permission rule denied rm (rm -rf *).",
        },
      },
    });
    await expect(auditLog.list()).resolves.toHaveLength(1);
  });

  it("treats absolute paths inside the current home directory as equivalent to ~/ permissions", async () => {
    const taskStore = createScheduledTaskStore({
      configDir,
      createId: () => "task_home",
      now: () => new Date("2026-06-05T08:00:00.000Z"),
    });
    const auditLog = createToolAuditLog({
      configDir,
      createId: () => "audit_home",
      now: () => new Date("2026-06-05T08:01:00.000Z"),
    });
    const service = createToolAuthorizationService({
      taskStore,
      auditLog,
      homeDir: "/Users/demo",
    });
    await taskStore.create({
      name: "Organize downloads",
      skillName: "local-file-organizer",
      enabled: true,
      schedule: { kind: "manual" },
      input: {},
      permissions: {
        files: { read: ["~/Downloads"], write: ["~/Downloads"] },
        web: { search: false, fetchDomains: [] },
        shell: { commands: [] },
      },
    });

    await expect(
      service.authorize("task_home", {
        toolName: "file_write",
        args: { path: "/Users/demo/Downloads/agent-report.md" },
      }),
    ).resolves.toMatchObject({
      ok: true,
      decision: {
        allowed: true,
        reason: "文件路径位于已授权目录内。",
      },
    });
    await expect(auditLog.list()).resolves.toHaveLength(1);
  });

  it("asks the user for one-time approval when a risky tool call is outside the task policy", async () => {
    const approvalRequests: unknown[] = [];
    const taskStore = createScheduledTaskStore({
      configDir,
      createId: () => "task_prompt",
      now: () => new Date("2026-06-05T08:00:00.000Z"),
    });
    const auditLog = createToolAuditLog({
      configDir,
      createId: () => "audit_prompt",
      now: () => new Date("2026-06-05T08:01:00.000Z"),
    });
    const service = createToolAuthorizationService({
      taskStore,
      auditLog,
      requestUserApproval: async (request) => {
        approvalRequests.push(request);
        return {
          approved: true,
          reason: "用户已在弹窗中授权本次 file_write。",
        };
      },
    });
    await taskStore.create({
      name: "Write outside policy",
      skillName: "local-file-organizer",
      enabled: true,
      schedule: { kind: "manual" },
      input: {},
      permissions: {
        files: { read: [], write: ["/Users/demo/Downloads"] },
        web: { search: false, fetchDomains: [] },
        shell: { commands: [] },
      },
    });

    const result = await service.authorize("task_prompt", {
      toolName: "file_write",
      args: { path: "/Users/demo/Desktop/report.md", content: "done" },
    });

    expect(approvalRequests).toEqual([
      expect.objectContaining({
        taskId: "task_prompt",
        taskName: "Write outside policy",
        deniedReason: "file_write 路径不在已授权可写目录内。",
        decisionKind: "policy_deny",
        request: {
          toolName: "file_write",
          args: { path: "/Users/demo/Desktop/report.md", content: "done" },
        },
      }),
    ]);
    expect(result).toMatchObject({
      ok: true,
      decision: {
        allowed: true,
        kind: "allowed",
        reason: "用户已在弹窗中授权本次 file_write。",
      },
    });
    await expect(auditLog.list()).resolves.toEqual([
      expect.objectContaining({
        decision: {
          allowed: true,
          kind: "allowed",
          reason: "用户已在弹窗中授权本次 file_write。",
        },
      }),
    ]);
  });

  it("keeps policy denials denied for scheduled auto tasks by default (strict consent)", async () => {
    const approvalRequests: unknown[] = [];
    const lifecycleEvents: string[] = [];
    const taskStore = createScheduledTaskStore({
      configDir,
      createId: () => "task_daily_auto",
      now: () => new Date("2026-06-05T08:00:00.000Z"),
    });
    const auditLog = createToolAuditLog({
      configDir,
      createId: () => "audit_daily_auto",
      now: () => new Date("2026-06-05T08:01:00.000Z"),
    });
    const service = createToolAuthorizationService({
      taskStore,
      auditLog,
      requestUserApproval: async (request) => {
        approvalRequests.push(request);
        return {
          approved: false,
          reason: "should not ask",
        };
      },
    });
    await taskStore.create({
      name: "Daily weather",
      skillName: "",
      enabled: true,
      schedule: { kind: "daily", time: "09:00" },
      input: { request: "每天汇报天气" },
      permissions: {
        files: { read: [], write: [] },
        web: { search: false, fetchDomains: [] },
        shell: { commands: [] },
      },
    });

    const result = await service.authorize(
      "task_daily_auto",
      {
        toolName: "web_search",
        args: { query: "上海天气" },
      },
      {
        onApprovalRequested: async () => {
          lifecycleEvents.push("requested");
        },
        onApprovalResolved: async () => {
          lifecycleEvents.push("resolved");
        },
      },
    );

    expect(approvalRequests).toEqual([]);
    expect(lifecycleEvents).toEqual([]);
    expect(result).toMatchObject({
      ok: true,
      decision: {
        allowed: false,
        kind: "policy_deny",
        reason: "这个任务未允许 web_search。",
      },
      auditEvent: {
        id: "audit_daily_auto",
        decision: {
          allowed: false,
          kind: "policy_deny",
          reason: "这个任务未允许 web_search。",
        },
      },
    });
  });

  it("auto-approves eligible policy denials for scheduled auto tasks only with the advanced switch ON", async () => {
    const approvalRequests: unknown[] = [];
    const taskStore = createScheduledTaskStore({
      configDir,
      createId: () => "task_daily_override",
      now: () => new Date("2026-06-05T08:00:00.000Z"),
    });
    const auditLog = createToolAuditLog({
      configDir,
      createId: () => "audit_daily_override",
      now: () => new Date("2026-06-05T08:01:00.000Z"),
    });
    const service = createToolAuthorizationService({
      taskStore,
      auditLog,
      policyDenyOverrideEnabled: () => true,
      requestUserApproval: async (request) => {
        approvalRequests.push(request);
        return {
          approved: false,
          reason: "should not ask",
        };
      },
    });
    await taskStore.create({
      name: "Daily weather",
      skillName: "",
      enabled: true,
      schedule: { kind: "daily", time: "09:00" },
      input: { request: "每天汇报天气" },
      permissions: {
        files: { read: [], write: [] },
        web: { search: false, fetchDomains: [] },
        shell: { commands: [] },
      },
    });

    const result = await service.authorize(
      "task_daily_override",
      {
        toolName: "web_search",
        args: { query: "上海天气" },
      },
      {
        onApprovalRequested: async () => {
          throw new Error("should not open approval");
        },
      },
    );

    expect(approvalRequests).toEqual([]);
    expect(result).toMatchObject({
      ok: true,
      decision: {
        allowed: true,
        kind: "allowed",
        reason: "自动任务全自动模式已放行 web_search。原始策略：这个任务未允许 web_search。",
      },
      auditEvent: {
        id: "audit_daily_override",
        decision: {
          allowed: true,
          kind: "allowed",
          reason: "自动任务全自动模式已放行 web_search。原始策略：这个任务未允许 web_search。",
        },
      },
    });
  });

  it("does not auto-approve scheduled task requests blocked by the run sandbox", async () => {
    let approvalCount = 0;
    const taskStore = createScheduledTaskStore({
      configDir,
      createId: () => "task_daily_workspace",
    });
    const auditLog = createToolAuditLog({ configDir });
    const service = createToolAuthorizationService({
      taskStore,
      auditLog,
      requestUserApproval: async () => {
        approvalCount += 1;
        return { approved: true };
      },
    });
    await taskStore.create({
      name: "Daily report",
      skillName: "",
      enabled: true,
      schedule: { kind: "daily", time: "09:00" },
      input: { request: "每天写报告" },
      permissions: {
        files: { read: ["/Users/demo"], write: ["/Users/demo"] },
        web: { search: false, fetchDomains: [] },
        shell: { commands: [] },
      },
    });

    await expect(
      service.authorize(
        "task_daily_workspace",
        {
          toolName: "file_write",
          args: { path: "/Users/demo/Desktop/report.md", content: "done" },
        },
        {
          runContext: buildPrimaryRunContext({
            workspaceId: "workspace_1",
            workspaceRoot: "/Users/demo/project",
          }),
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      decision: {
        allowed: false,
        reason:
          "file_write 被运行沙箱阻止：路径不在工作区或额外可写目录内。",
      },
    });
    expect(approvalCount).toBe(0);
  });

  it("forces confirmation for scheduled Policy B shell commands", async () => {
    let approvalCount = 0;
    const taskStore = createScheduledTaskStore({
      configDir,
      createId: () => "task_daily_shell",
    });
    const auditLog = createToolAuditLog({ configDir });
    const service = createToolAuthorizationService({
      taskStore,
      auditLog,
      requestUserApproval: async () => {
        approvalCount += 1;
        return { approved: true };
      },
    });
    await taskStore.create({
      name: "Daily shell",
      skillName: "",
      enabled: true,
      schedule: { kind: "daily", time: "09:00" },
      input: { request: "每天运行本地命令" },
      permissions: {
        files: { read: [], write: [] },
        web: { search: false, fetchDomains: [] },
        shell: { commands: [] },
      },
    });

    await expect(
      service.authorize("task_daily_shell", {
        toolName: "shell_exec",
        args: { command: "rm -rf /tmp/cache" },
      }),
    ).resolves.toMatchObject({
      ok: true,
      decision: {
        allowed: true,
      },
    });
    expect(approvalCount).toBe(1);
  });

  it("notifies callers when user approval is requested and resolved", async () => {
    const lifecycleEvents: string[] = [];
    const taskStore = createScheduledTaskStore({
      configDir,
      createId: () => "task_lifecycle",
      now: () => new Date("2026-06-05T08:00:00.000Z"),
    });
    const auditLog = createToolAuditLog({
      configDir,
      createId: () => "audit_lifecycle",
      now: () => new Date("2026-06-05T08:01:00.000Z"),
    });
    const service = createToolAuthorizationService({
      taskStore,
      auditLog,
      requestUserApproval: async (_request, options) => {
        await options?.onIntentPersisted?.({ id: "approval_lifecycle", revision: 1 });
        return {
          approved: true,
          reason: "approved",
          approvalId: "approval_lifecycle",
        };
      },
    });
    await taskStore.create({
      name: "Approval lifecycle",
      skillName: "local-file-organizer",
      enabled: true,
      schedule: { kind: "manual" },
      input: {},
      permissions: {
        files: { read: [], write: ["/Users/demo/Downloads"] },
        web: { search: false, fetchDomains: [] },
        shell: { commands: [] },
      },
    });

    await service.authorize(
      "task_lifecycle",
      {
        toolName: "file_write",
        args: { path: "/Users/demo/Desktop/report.md", content: "done" },
      },
      {
        onApprovalRequested: async (request) => {
          lifecycleEvents.push(`requested:${request.taskId}`);
        },
        onApprovalResolved: async (approval) => {
          lifecycleEvents.push(approval.approved ? "approved" : "rejected");
        },
      },
    );

    expect(lifecycleEvents).toEqual(["requested:task_lifecycle", "approved"]);
  });

  it("propagates the active run signal to an interactive approval", async () => {
    const controller = new AbortController();
    let observedSignal: AbortSignal | undefined;
    const taskStore = createScheduledTaskStore({
      configDir,
      createId: () => "task_signal",
    });
    const auditLog = createToolAuditLog({ configDir });
    const service = createToolAuthorizationService({
      taskStore,
      auditLog,
      requestUserApproval: async (_request, approvalOptions) => {
        observedSignal = approvalOptions?.signal;
        return { approved: false, reason: "canceled" };
      },
    });
    await taskStore.create({
      name: "Signal propagation",
      skillName: "",
      enabled: true,
      schedule: { kind: "manual" },
      input: {},
      permissions: {
        files: { read: [], write: [] },
        web: { search: false, fetchDomains: [] },
        shell: { commands: [] },
      },
    });

    await service.authorize(
      "task_signal",
      { toolName: "web_fetch", args: { url: "https://example.com" } },
      { signal: controller.signal },
    );

    expect(observedSignal).toBe(controller.signal);
  });

  it("forces Policy B approval even when the task policy already allows the command", async () => {
    const approvalRequests: ToolUserApprovalRequest[] = [];
    const taskStore = createScheduledTaskStore({
      configDir,
      createId: () => "task_publish",
    });
    const auditLog = createToolAuditLog({ configDir });
    const service = createToolAuthorizationService({
      taskStore,
      auditLog,
      requestUserApproval: async (request) => {
        approvalRequests.push(request);
        return { approved: false, reason: "publication rejected" };
      },
    });
    await taskStore.create({
      name: "Publish package",
      skillName: "",
      enabled: true,
      schedule: { kind: "manual" },
      input: {},
      permissions: {
        files: { read: [], write: [] },
        web: { search: false, fetchDomains: [] },
        shell: { commands: ["npm publish"] },
      },
    });

    const result = await service.authorize("task_publish", {
      toolName: "shell_exec",
      args: { command: "npm publish" },
    });

    expect(approvalRequests).toHaveLength(1);
    expect(approvalRequests[0]?.risk).toMatchObject({
      requiresConfirmation: true,
      category: "irreversible_external_action",
    });
    expect(result).toMatchObject({
      ok: true,
      decision: { allowed: false, reason: "publication rejected" },
    });
  });

  it("does not let approval override a shell workspace escape", async () => {
    let approvalCount = 0;
    const taskStore = createScheduledTaskStore({
      configDir,
      createId: () => "task_shell_escape",
    });
    const auditLog = createToolAuditLog({ configDir });
    const service = createToolAuthorizationService({
      taskStore,
      auditLog,
      requestUserApproval: async () => {
        approvalCount += 1;
        return { approved: true };
      },
    });
    await taskStore.create({
      name: "Shell escape",
      skillName: "",
      enabled: true,
      schedule: { kind: "manual" },
      input: {},
      permissions: {
        files: { read: [], write: [] },
        web: { search: false, fetchDomains: [] },
        shell: { commands: [] },
      },
    });

    const result = await service.authorize(
      "task_shell_escape",
      { toolName: "shell_exec", args: { command: "cat /etc/passwd" } },
      {
        runContext: buildPrimaryRunContext({
          workspaceId: "workspace_1",
          workspaceRoot: "/Users/demo/project",
        }),
      },
    );

    expect(approvalCount).toBe(0);
    expect(result).toMatchObject({
      ok: true,
      decision: {
        allowed: false,
        reason: expect.stringContaining("运行沙箱阻止"),
      },
    });
  });

  it("does not ask for approval when the tool request is malformed", async () => {
    let approvalCount = 0;
    const taskStore = createScheduledTaskStore({
      configDir,
      createId: () => "task_malformed",
    });
    const auditLog = createToolAuditLog({ configDir });
    const service = createToolAuthorizationService({
      taskStore,
      auditLog,
      requestUserApproval: async () => {
        approvalCount += 1;
        return { approved: true };
      },
    });
    await taskStore.create({
      name: "Malformed request",
      skillName: "local-file-organizer",
      enabled: true,
      schedule: { kind: "manual" },
      input: {},
      permissions: {
        files: { read: [], write: [] },
        web: { search: false, fetchDomains: [] },
        shell: { commands: [] },
      },
    });

    await expect(
      service.authorize("task_malformed", {
        toolName: "file_read",
        args: {},
      }),
    ).resolves.toMatchObject({
      ok: true,
      decision: {
        allowed: false,
        reason: "文件工具调用缺少 path。",
      },
    });
    expect(approvalCount).toBe(0);
  });

  it("does not ask for approval when the run sandbox blocks workspace escape", async () => {
    let approvalCount = 0;
    const taskStore = createScheduledTaskStore({
      configDir,
      createId: () => "task_workspace",
    });
    const auditLog = createToolAuditLog({ configDir });
    const service = createToolAuthorizationService({
      taskStore,
      auditLog,
      requestUserApproval: async () => {
        approvalCount += 1;
        return { approved: true };
      },
    });
    await taskStore.create({
      name: "Broad write",
      skillName: "local-file-organizer",
      enabled: true,
      schedule: { kind: "manual" },
      input: {},
      permissions: {
        files: { read: ["/Users/demo"], write: ["/Users/demo"] },
        web: { search: false, fetchDomains: [] },
        shell: { commands: [] },
      },
    });

    await expect(
      service.authorize(
        "task_workspace",
        {
          toolName: "file_write",
          args: { path: "/Users/demo/Desktop/report.md", content: "done" },
        },
        {
          runContext: buildPrimaryRunContext({
            workspaceId: "workspace_1",
            workspaceRoot: "/Users/demo/project",
          }),
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      decision: {
        allowed: false,
        reason:
          "file_write 被运行沙箱阻止：路径不在工作区或额外可写目录内。",
      },
    });
    expect(approvalCount).toBe(0);
  });

  it("denies approved shell templates when a ShellPlan includes a bare parent directory", () => {
    const broadPolicy: TaskPermissionPolicy = {
      files: {
        read: ["/Users/demo/project"],
        write: ["/Users/demo/project"],
      },
      web: { search: false, fetchDomains: [] },
      shell: { commands: ["cat {{target}}"] },
      memory: { read: false, write: false },
    };
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: "/Users/demo/project/workspace",
      sandbox: {
        mode: "workspace_write",
        network: "task_policy",
        shell: "approved_commands",
        allowWorkspaceEscape: false,
        extraReadRoots: [],
        extraWriteRoots: [],
      },
    });
    const shellPlan = analyzeShell("cat ..", {
      cwd: runContext.workspaceRoot,
    });

    expect(
      authorizeToolCallWithinRunContext(
        broadPolicy,
        {
          toolName: "shell_exec",
          args: { command: "cat .." },
        },
        runContext,
        { shellPlan },
      ),
    ).toEqual({
      allowed: false,
      kind: "sandbox_deny",
      reason:
        "shell_exec 被运行沙箱阻止：路径 /Users/demo/project 不在工作区或额外可读目录内。",
    });
  });

  it("hard-denies macOS-sensitive shell commands even with the advanced switch ON", async () => {
    const approvalRequests: unknown[] = [];
    const taskStore = createScheduledTaskStore({
      configDir,
      createId: () => "task_hard_deny",
      now: () => new Date("2026-06-05T08:00:00.000Z"),
    });
    const auditLog = createToolAuditLog({
      configDir,
      createId: () => "audit_hard_deny",
      now: () => new Date("2026-06-05T08:01:00.000Z"),
    });
    const service = createToolAuthorizationService({
      taskStore,
      auditLog,
      policyDenyOverrideEnabled: () => true,
      requestUserApproval: async (request) => {
        approvalRequests.push(request);
        return { approved: true, reason: "must not be asked" };
      },
    });
    await taskStore.create({
      name: "Automation attempt",
      skillName: "",
      enabled: true,
      schedule: { kind: "daily", time: "09:00" },
      input: {},
      permissions: {
        files: { read: ["/Users/demo"], write: [] },
        web: { search: false, fetchDomains: [] },
        shell: { commands: ["osascript {{script}}"] },
      },
    });

    const result = await service.authorize("task_hard_deny", {
      toolName: "shell_exec",
      args: { command: "osascript -e 'beep'" },
    });

    expect(approvalRequests).toEqual([]);
    expect(result).toMatchObject({
      ok: true,
      decision: {
        allowed: false,
        kind: "hard_deny",
        reason: expect.stringContaining("osascript"),
      },
    });
  });

  it("never auto-approves invalid requests even with the advanced switch ON", async () => {
    const approvalRequests: unknown[] = [];
    const taskStore = createScheduledTaskStore({
      configDir,
      createId: () => "task_invalid",
      now: () => new Date("2026-06-05T08:00:00.000Z"),
    });
    const auditLog = createToolAuditLog({
      configDir,
      createId: () => "audit_invalid",
      now: () => new Date("2026-06-05T08:01:00.000Z"),
    });
    const service = createToolAuthorizationService({
      taskStore,
      auditLog,
      policyDenyOverrideEnabled: () => true,
      requestUserApproval: async (request) => {
        approvalRequests.push(request);
        return { approved: true, reason: "must not be asked" };
      },
    });
    await taskStore.create({
      name: "Malformed writer",
      skillName: "",
      enabled: true,
      schedule: { kind: "daily", time: "09:00" },
      input: {},
      permissions: {
        files: { read: ["/Users/demo"], write: ["/Users/demo/Downloads"] },
        web: { search: false, fetchDomains: [] },
        shell: { commands: [] },
      },
    });

    const result = await service.authorize("task_invalid", {
      toolName: "file_write",
      args: { content: "no path given" },
    });

    expect(approvalRequests).toEqual([]);
    expect(result).toMatchObject({
      ok: true,
      decision: {
        allowed: false,
        kind: "invalid_request",
      },
    });
  });

  it("returns a structured error when the task is missing", async () => {
    const taskStore = createScheduledTaskStore({ configDir });
    const auditLog = createToolAuditLog({ configDir });
    const service = createToolAuthorizationService({ taskStore, auditLog });

    await expect(
      service.authorize("missing_task", {
        toolName: "web_search",
        args: { query: "memory" },
      }),
    ).resolves.toEqual({
      ok: false,
      message: "Scheduled task was not found.",
    });
    await expect(auditLog.list()).resolves.toEqual([]);
  });
});
