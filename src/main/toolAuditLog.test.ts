import { mkdtemp, readFile, rm } from "node:fs/promises";
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

    expect(first).toMatchObject({
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
    expect(first.requestFingerprint).toBeUndefined();
    await expect(auditLog.get("audit_1")).resolves.toEqual(first);
    await expect(auditLog.verifyAuthorizationReceipt({
      auditEventId: "audit_1",
      taskId: "task_123",
      request: {
        toolName: "file_read",
        args: { path: "/Users/demo/Downloads/notes.md" },
      },
    })).resolves.toBe(true);
    await expect(auditLog.verifyAuthorizationReceipt({
      auditEventId: "audit_1",
      taskId: "task_123",
      request: {
        toolName: "file_read",
        args: { path: "/Users/demo/Downloads/other.md" },
      },
    })).resolves.toBe(false);

    await expect(auditLog.list({ limit: 10 })).resolves.toEqual([first]);
    const receipt = {
      auditEventId: "audit_1",
      taskId: "task_123",
      request: {
        toolName: "file_read",
        args: { path: "/Users/demo/Downloads/notes.md" },
      },
    };
    const concurrent = createToolAuditLog({ configDir });
    await expect(Promise.all([
      auditLog.consumeAuthorizationReceipt(receipt),
      concurrent.consumeAuthorizationReceipt(receipt),
    ])).resolves.toEqual(expect.arrayContaining([true, false]));
    const restarted = createToolAuditLog({ configDir });
    await expect(restarted.consumeAuthorizationReceipt(receipt)).resolves.toBe(false);
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

  it("recursively redacts credential keys and values before disk persistence", async () => {
    const auditLog = createToolAuditLog({
      configDir,
      createId: () => "audit_secret",
      now: () => new Date("2026-08-16T00:00:00.000Z"),
    });

    const event = await auditLog.append({
      taskId: "task_secret",
      request: {
        toolName: "shell_exec",
        args: {
          command:
            "curl https://user:password@example.test/run?api_key=query-secret",
          nested: {
            authorization: "Bearer nested-secret",
            output: "Set-Cookie: session=cookie-secret; Path=/",
          },
        },
      },
      decision: {
        allowed: false,
        reason: "Authorization: Bearer decision-secret",
      },
    });

    const serialized = JSON.stringify(event);
    expect(serialized).toContain("[redacted]");
    expect(serialized).not.toMatch(
      /password@example|query-secret|nested-secret|cookie-secret|decision-secret/,
    );
    expect(event.requestFingerprint).toBeUndefined();
    const durable = await readFile(path.join(configDir, "tool-audit.jsonl"), "utf8");
    expect(durable).not.toMatch(
      /password@example|query-secret|nested-secret|cookie-secret|decision-secret/,
    );
    expect(durable).toMatch(/"requestFingerprint":"[0-9a-f]{64}"/);
    await expect(auditLog.list({ limit: 1 })).resolves.toEqual([event]);
  });

  it("does not expose a comparable verifier for different secret arguments", async () => {
    let id = 0;
    const auditLog = createToolAuditLog({
      configDir,
      createId: () => `audit_private_${++id}`,
    });
    const append = (secret: string) => auditLog.append({
      taskId: "task_private",
      request: {
        toolName: "web_fetch",
        args: { url: "https://example.test", headers: { authorization: secret } },
      },
      decision: { allowed: true, reason: "approved" },
    });
    const events = await Promise.all([
      append("PRIVATE_TOOL_SECRET_ONE"),
      append("PRIVATE_TOOL_SECRET_TWO"),
    ]);
    expect(events.every((event) => event.requestFingerprint === undefined)).toBe(true);
    expect(JSON.stringify(await auditLog.list({ limit: 10 }))).not.toContain(
      "PRIVATE_TOOL_SECRET",
    );
    const durable = await readFile(path.join(configDir, "tool-audit.jsonl"), "utf8");
    expect(durable).not.toContain("PRIVATE_TOOL_SECRET");
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

    it("atomically consumes an allowed receipt once across concurrent and restarted callers", async () => {
      const storage = createStorageImpl({ dbPath: path.join(configDir, "zerox.db") });
      await storage.migrate();
      try {
        const auditLog = createToolAuditLog({ configDir, backend, storage });
        const event = await auditLog.append({
          taskId: "agent_workspaces",
          request: {
            toolName: "git_worktree_add",
            args: { name: "one", repositoryRoot: "/repo", branch: "branch" },
          },
          decision: { allowed: true, reason: "approved" },
        });
        const receipt = {
          auditEventId: event.id,
          taskId: "agent_workspaces",
          request: event.request,
        };
        const results = await Promise.all([
          auditLog.consumeAuthorizationReceipt(receipt),
          auditLog.consumeAuthorizationReceipt(receipt),
        ]);
        expect(results.sort()).toEqual([false, true]);
        const restarted = createToolAuditLog({ configDir, backend, storage });
        await expect(restarted.consumeAuthorizationReceipt(receipt)).resolves.toBe(false);
        await auditLog.flushShadowWrites();
      } finally {
        storage.close();
      }
    });
  });

  it("shares one receipt-consumption claim across dual and JSON backends", async () => {
    const storage = createStorageImpl({ dbPath: path.join(configDir, "zerox.db") });
    await storage.migrate();
    try {
      const dual = createToolAuditLog({
        configDir,
        backend: "dual",
        storage,
      });
      const firstEvent = await dual.append({
        taskId: "agent_workspaces",
        request: {
          toolName: "git_worktree_add",
          args: { name: "one", repositoryRoot: "/repo", branch: "branch-one" },
        },
        decision: { allowed: true, reason: "approved" },
      });
      await dual.flushShadowWrites();
      const firstReceipt = {
        auditEventId: firstEvent.id,
        taskId: "agent_workspaces",
        request: firstEvent.request,
      };

      await expect(dual.consumeAuthorizationReceipt(firstReceipt)).resolves.toBe(true);
      await dual.flushShadowWrites();
      // Simulate a pre-shared-marker dual build: the deterministic consumption
      // event exists in JSONL, but no cross-backend marker was created yet.
      await rm(path.join(configDir, "tool-audit-receipt-claims"), {
        recursive: true,
        force: true,
      });
      const downgradedJson = createToolAuditLog({ configDir, backend: "json" });
      await expect(
        downgradedJson.consumeAuthorizationReceipt(firstReceipt),
      ).resolves.toBe(false);

      const secondEvent = await dual.append({
        taskId: "agent_workspaces",
        request: {
          toolName: "git_worktree_add",
          args: { name: "two", repositoryRoot: "/repo", branch: "branch-two" },
        },
        decision: { allowed: true, reason: "approved" },
      });
      await dual.flushShadowWrites();
      const secondReceipt = {
        auditEventId: secondEvent.id,
        taskId: "agent_workspaces",
        request: secondEvent.request,
      };
      const concurrent = await Promise.all([
        dual.consumeAuthorizationReceipt(secondReceipt),
        downgradedJson.consumeAuthorizationReceipt(secondReceipt),
      ]);
      expect(concurrent.sort()).toEqual([false, true]);
      await expect(
        createToolAuditLog({ configDir, backend: "json" })
          .consumeAuthorizationReceipt(secondReceipt),
      ).resolves.toBe(false);
    } finally {
      storage.close();
    }
  });
});
