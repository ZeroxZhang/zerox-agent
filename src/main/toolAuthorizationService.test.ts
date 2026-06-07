import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createScheduledTaskStore } from "./taskStore";
import { createToolAuditLog } from "./toolAuditLog";
import { createToolAuthorizationService } from "./toolAuthorizationService";

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
          reason: "文件路径位于已授权目录内。",
        },
        createdAt: "2026-06-05T08:01:00.000Z",
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
        reason: "用户已在弹窗中授权本次 file_write。",
      },
    });
    await expect(auditLog.list()).resolves.toEqual([
      expect.objectContaining({
        decision: {
          allowed: true,
          reason: "用户已在弹窗中授权本次 file_write。",
        },
      }),
    ]);
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
