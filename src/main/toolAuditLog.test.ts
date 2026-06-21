import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createToolAuditLog } from "./toolAuditLog";
import { createStorageImpl } from "./storage/storageDb";
import type { StorageBackend } from "../shared/storageContract";

describe("tool audit log", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(path.join(os.tmpdir(), "building-agent-audit-"));
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  it("appends authorization decisions as JSONL and lists newest events first", async () => {
    const auditLog = createToolAuditLog({
      configDir,
      createId: () => "audit_1",
      now: () => new Date("2026-06-05T08:00:00.000Z"),
    });

    const first = await auditLog.append({
      taskId: "task_123",
      request: {
        toolName: "file_read",
        args: { path: "/Users/demo/Downloads/notes.md" },
      },
      decision: {
        allowed: true,
        reason: "File path is inside an approved directory.",
      },
    });

    expect(first).toEqual({
      id: "audit_1",
      taskId: "task_123",
      request: {
        toolName: "file_read",
        args: { path: "/Users/demo/Downloads/notes.md" },
      },
      decision: {
        allowed: true,
        reason: "File path is inside an approved directory.",
      },
      createdAt: "2026-06-05T08:00:00.000Z",
    });

    await expect(auditLog.list({ limit: 10 })).resolves.toEqual([first]);
  });

  it("returns only the requested number of recent audit events", async () => {
    let counter = 0;
    const auditLog = createToolAuditLog({
      configDir,
      createId: () => `audit_${counter}`,
      now: () => new Date(`2026-06-05T08:00:0${counter++}.000Z`),
    });

    await auditLog.append({
      taskId: "task_1",
      request: { toolName: "web_search", args: { query: "memory" } },
      decision: { allowed: false, reason: "web_search is not enabled." },
    });
    const second = await auditLog.append({
      taskId: "task_2",
      request: { toolName: "web_fetch", args: { url: "https://example.com" } },
      decision: { allowed: true, reason: "Domain is approved." },
    });

    await expect(auditLog.list({ limit: 1 })).resolves.toEqual([second]);
  });

  describe.each(["sqlite", "dual"] as StorageBackend[])("backend=%s", (backend) => {
    it("returns the same audit event that it persists", async () => {
      const storage = createStorageImpl({ dbPath: path.join(configDir, "zerox.db") });
      await storage.migrate();
      try {
        const auditLog = createToolAuditLog({
          configDir,
          backend,
          storage,
          createId: () => "audit_sqlite_1",
          now: () => new Date("2026-06-21T02:00:00.000Z"),
        });

        const event = await auditLog.append({
          taskId: "task_sqlite",
          request: {
            toolName: "file_write",
            args: { path: "/tmp/report.md" },
          },
          decision: {
            allowed: false,
            reason: "Outside the writable workspace.",
          },
        });

        await expect(auditLog.list({ limit: 1 })).resolves.toEqual([event]);
      } finally {
        storage.close();
      }
    });
  });
});
