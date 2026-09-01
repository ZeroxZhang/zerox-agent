import {
  access,
  appendFile,
  chmod,
  copyFile,
  link,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyLocalFileOrganization,
  previewLocalFileOrganization,
  readLocalFileOrganizationTransaction,
  rollbackLocalFileOrganization,
  verifyLocalFileOrganization,
} from "./localFileOrganizer";

describe("local file organizer", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "local-file-organizer-")),
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("previews, applies, and rolls back deterministic category moves", async () => {
    await writeFile(path.join(tempDir, "photo.jpg"), "image", "utf8");
    await writeFile(path.join(tempDir, "invoice.pdf"), "pdf", "utf8");
    await writeFile(path.join(tempDir, "script.ts"), "code", "utf8");

    const preview = await previewLocalFileOrganization(tempDir, {
      createId: () => "tx_1",
      now: () => "2026-06-16T00:00:00.000Z",
    });

    expect(preview).toMatchObject({
      id: "tx_1",
      root: tempDir,
      confirmationRequired: true,
      inventory: {
        files: 3,
        directories: 0,
      },
      conflicts: [],
      moves: [
        {
          from: path.join(tempDir, "invoice.pdf"),
          to: path.join(tempDir, "Documents", "invoice.pdf"),
          category: "Documents",
        },
        {
          from: path.join(tempDir, "photo.jpg"),
          to: path.join(tempDir, "Images", "photo.jpg"),
          category: "Images",
        },
        {
          from: path.join(tempDir, "script.ts"),
          to: path.join(tempDir, "Code", "script.ts"),
          category: "Code",
        },
      ],
    });

    const transaction = await applyLocalFileOrganization(preview, {
      now: () => "2026-06-16T00:01:00.000Z",
    });

    expect(transaction).toMatchObject({
      id: "tx_1",
      status: "applied",
      movesApplied: 3,
      logPath: path.join(tempDir, ".zerox-organize-transactions", "tx_1.json"),
    });
    await expectPath(path.join(tempDir, "Images", "photo.jpg"), true);
    await expectPath(path.join(tempDir, "photo.jpg"), false);
    await expect(readLocalFileOrganizationTransaction(path.join(
      tempDir,
      ".zerox-organize-transactions",
      "tx_1.json",
    ))).resolves.toMatchObject({ status: "applied" });

    const rollback = await rollbackLocalFileOrganization(transaction, {
      now: () => "2026-06-16T00:02:00.000Z",
    });

    expect(rollback).toMatchObject({
      id: "tx_1",
      status: "rolled_back",
      movesRolledBack: 3,
    });
    await expectPath(path.join(tempDir, "photo.jpg"), true);
    await expectPath(path.join(tempDir, "Images", "photo.jpg"), false);
  });

  it("does not plan overwrites when category targets already exist", async () => {
    await mkdir(path.join(tempDir, "Images"));
    await writeFile(path.join(tempDir, "photo.jpg"), "new", "utf8");
    await writeFile(path.join(tempDir, "Images", "photo.jpg"), "existing", "utf8");

    const preview = await previewLocalFileOrganization(tempDir, {
      createId: () => "tx_conflict",
      now: () => "2026-06-16T00:00:00.000Z",
    });

    expect(preview.moves).toEqual([]);
    expect(preview.conflicts).toEqual([
      {
        from: path.join(tempDir, "photo.jpg"),
        to: path.join(tempDir, "Images", "photo.jpg"),
        reason: "target_exists",
      },
    ]);
  });

  it("counts every directory as skipped inventory", async () => {
    await mkdir(path.join(tempDir, "unmanaged-directory"));
    await mkdir(path.join(tempDir, "Images"));

    const preview = await previewLocalFileOrganization(tempDir, {
      createId: () => "tx_directory_inventory",
    });

    expect(preview.inventory).toMatchObject({
      directories: 2,
      skipped: 2,
    });
  });

  it("fails closed when a target appears after preview", async () => {
    await writeFile(path.join(tempDir, "photo.jpg"), "new", "utf8");
    const preview = await previewLocalFileOrganization(tempDir, {
      createId: () => "tx_race",
    });
    await mkdir(path.join(tempDir, "Images"));
    await writeFile(path.join(tempDir, "Images", "photo.jpg"), "existing", "utf8");

    await expect(applyLocalFileOrganization(preview)).rejects.toThrow(
      /target appeared/i,
    );
    await expect(readFile(path.join(tempDir, "photo.jpg"), "utf8"))
      .resolves.toBe("new");
    await expect(readFile(path.join(tempDir, "Images", "photo.jpg"), "utf8"))
      .resolves.toBe("existing");
  });

  it("rejects a source replacement before atomic move without changing its path", async () => {
    const source = path.join(tempDir, "photo.jpg");
    const held = path.join(tempDir, "photo-held.jpg");
    const target = path.join(tempDir, "Images", "photo.jpg");
    await writeFile(source, "original", "utf8");
    const preview = await previewLocalFileOrganization(tempDir, {
      createId: () => "tx_leaf_swap",
    });
    const ready = waitForSafeFsCommand("move-into-category");
    const outcome = applyLocalFileOrganization(preview, {
      safeFsTestDelayMs: 750,
      safeFsTestReadyStage: "source-verified",
      safeFsTestOnReady: ready.onReady,
    }).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    await ready.promise;
    await rename(source, held);
    await writeFile(source, "replacement", "utf8");

    const result = await outcome;
    expect(result.ok).toBe(false);
    expect(String(result.ok ? "" : result.error)).toMatch(/identity/i);
    await expect(readFile(held, "utf8")).resolves.toBe("original");
    await expect(readFile(source, "utf8")).resolves.toBe("replacement");
    await expectPath(target, false);
    await expect(readLocalFileOrganizationTransaction(path.join(
      tempDir,
      ".zerox-organize-transactions",
      "tx_leaf_swap.json",
    ))).resolves.toMatchObject({ status: "pending" });
  });

  it("rejects an equal-length rewrite of the same source inode before rename", async () => {
    const source = path.join(tempDir, "photo.jpg");
    const target = path.join(tempDir, "Images", "photo.jpg");
    await writeFile(source, "original", "utf8");
    const originalIdentity = await stat(source);
    const preview = await previewLocalFileOrganization(tempDir, {
      createId: () => "tx_source_same_inode_rewrite",
    });
    const ready = waitForSafeFsCommand("move-into-category");
    const outcome = applyLocalFileOrganization(preview, {
      safeFsTestDelayMs: 750,
      safeFsTestReadyStage: "source-verified",
      safeFsTestOnReady: ready.onReady,
    }).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    await ready.promise;
    await writeFile(source, "modified", "utf8");
    expect((await stat(source)).ino).toBe(originalIdentity.ino);

    const result = await outcome;
    expect(result.ok).toBe(false);
    expect(String(result.ok ? "" : result.error)).toMatch(/digest|content|identity/i);
    await expect(readFile(source, "utf8")).resolves.toBe("modified");
    await expectPath(target, false);
  });

  it("marks reconciliation when a moved target is rewritten through the same inode", async () => {
    const source = path.join(tempDir, "photo.jpg");
    const target = path.join(tempDir, "Images", "photo.jpg");
    await writeFile(source, "original", "utf8");
    const preview = await previewLocalFileOrganization(tempDir, {
      createId: () => "tx_target_same_inode_rewrite",
    });
    const ready = waitForSafeFsCommand("move-into-category");
    const outcome = applyLocalFileOrganization(preview, {
      safeFsTestDelayMs: 750,
      safeFsTestReadyStage: "move-applied",
      safeFsTestOnReady: ready.onReady,
    }).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    await ready.promise;
    const movedIdentity = await stat(target);
    await writeFile(target, "modified", "utf8");
    expect((await stat(target)).ino).toBe(movedIdentity.ino);

    const result = await outcome;
    expect(result.ok).toBe(false);
    expect(String(result.ok ? "" : result.error)).toMatch(
      /authority is unresolved; reconciliation marker persisted/i,
    );
    await expect(readFile(source, "utf8")).resolves.toBe("modified");
    await expectPath(target, false);
    const transaction = await readLocalFileOrganizationTransaction(path.join(
      tempDir,
      ".zerox-organize-transactions",
      "tx_target_same_inode_rewrite.json",
    ));
    expect(transaction).toMatchObject({
      status: "reconciliation_required",
      reconciliation: { required: true, kind: "marker" },
    });
    await expect(rollbackLocalFileOrganization(transaction)).rejects.toThrow(
      /manual reconciliation/i,
    );
    await expect(verifyLocalFileOrganization(transaction)).resolves.toMatchObject({
      verified: false,
    });
  });

  it("detects an in-place rewrite after the first target digest block was read", async () => {
    const source = path.join(tempDir, "photo.jpg");
    const target = path.join(tempDir, "Images", "photo.jpg");
    await writeFile(source, Buffer.alloc(8 * 1024 * 1024, 0x61));
    const preview = await previewLocalFileOrganization(tempDir, {
      createId: () => "tx_target_mid_digest_rewrite",
    });
    const ready = waitForSafeFsCommand("move-into-category");
    const outcome = applyLocalFileOrganization(preview, {
      safeFsTestDelayMs: 750,
      safeFsTestReadyStage: "post-move-target-digest-read",
      safeFsTestOnReady: ready.onReady,
    }).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    await ready.promise;
    const handle = await open(target, "r+");
    try {
      await handle.write(Buffer.alloc(64 * 1024, 0x62), 0, 64 * 1024, 0);
      await handle.sync();
    } finally {
      await handle.close();
    }

    const result = await outcome;
    expect(result.ok).toBe(false);
    expect(String(result.ok ? "" : result.error)).toMatch(
      /changed during digest|authority is unresolved/i,
    );
    const restored = await readFile(source);
    expect(restored.subarray(0, 64 * 1024)).toEqual(Buffer.alloc(64 * 1024, 0x62));
    await expectPath(target, false);
    await expect(readLocalFileOrganizationTransaction(path.join(
      tempDir,
      ".zerox-organize-transactions",
      "tx_target_mid_digest_rewrite.json",
    ))).resolves.toMatchObject({
      status: "reconciliation_required",
      reconciliation: { required: true, kind: "marker" },
    });
  });

  it("marks reconciliation when the journal is rewritten after the move", async () => {
    const source = path.join(tempDir, "photo.jpg");
    const target = path.join(tempDir, "Images", "photo.jpg");
    const logPath = path.join(
      tempDir,
      ".zerox-organize-transactions",
      "tx_journal_same_inode_rewrite.json",
    );
    await writeFile(source, "original", "utf8");
    const preview = await previewLocalFileOrganization(tempDir, {
      createId: () => "tx_journal_same_inode_rewrite",
      now: () => "2026-06-16T00:00:00.000Z",
    });
    const ready = waitForSafeFsCommand("move-into-category");
    const outcome = applyLocalFileOrganization(preview, {
      now: () => "2026-06-16T00:01:00.000Z",
      safeFsTestDelayMs: 750,
      safeFsTestReadyStage: "move-applied",
      safeFsTestOnReady: ready.onReady,
    }).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    await ready.promise;
    const journalIdentity = await stat(logPath);
    const journal = await readFile(logPath, "utf8");
    await writeFile(logPath, journal.replace("2026-06-16", "2025-06-16"), "utf8");
    expect((await stat(logPath)).ino).toBe(journalIdentity.ino);

    const result = await outcome;
    expect(result.ok).toBe(false);
    expect(String(result.ok ? "" : result.error)).toMatch(
      /authority is unresolved; reconciliation marker persisted/i,
    );
    await expect(readFile(source, "utf8")).resolves.toBe("original");
    await expectPath(target, false);
    await expect(readLocalFileOrganizationTransaction(logPath)).resolves.toMatchObject({
      status: "reconciliation_required",
      reconciliation: { required: true, kind: "marker" },
    });
  });

  it.each([
    ["equal-length invalid JSON", (body: string) => `[${body.slice(1)}`],
    ["truncated JSON", (body: string) => body.slice(0, -8)],
  ])("projects a marker even when the journal has %s", async (_label, corrupt) => {
    const source = path.join(tempDir, "photo.jpg");
    const target = path.join(tempDir, "Images", "photo.jpg");
    const logPath = path.join(
      tempDir,
      ".zerox-organize-transactions",
      `tx_unreadable_journal_${_label.startsWith("equal") ? "equal" : "short"}.json`,
    );
    const transactionId = path.basename(logPath, ".json");
    await writeFile(source, "original", "utf8");
    const preview = await previewLocalFileOrganization(tempDir, {
      createId: () => transactionId,
    });
    const ready = waitForSafeFsCommand("move-into-category");
    const outcome = applyLocalFileOrganization(preview, {
      safeFsTestDelayMs: 750,
      safeFsTestReadyStage: "move-applied",
      safeFsTestOnReady: ready.onReady,
    }).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    await ready.promise;
    const journal = await readFile(logPath, "utf8");
    await writeFile(logPath, corrupt(journal), "utf8");

    const result = await outcome;
    expect(result.ok).toBe(false);
    await expect(readFile(source, "utf8")).resolves.toBe("original");
    await expectPath(target, false);
    const transaction = await readLocalFileOrganizationTransaction(logPath);
    expect(transaction).toMatchObject({
      id: transactionId,
      status: "reconciliation_required",
      moves: [],
      reconciliation: {
        required: true,
        kind: "marker",
        reason: "journal_unreadable_requires_manual_reconciliation",
      },
    });
    await expect(rollbackLocalFileOrganization(transaction)).rejects.toThrow(
      /manual reconciliation/i,
    );
  });

  it("persists reconciliation state when a moved source is concurrently repopulated", async () => {
    const source = path.join(tempDir, "photo.jpg");
    const target = path.join(tempDir, "Images", "photo.jpg");
    await writeFile(source, "original", "utf8");
    const preview = await previewLocalFileOrganization(tempDir, {
      createId: () => "tx_reconciliation",
    });
    const ready = waitForSafeFsCommand("move-into-category");
    const outcome = applyLocalFileOrganization(preview, {
      safeFsTestDelayMs: 750,
      safeFsTestReadyStage: "move-applied",
      safeFsTestOnReady: ready.onReady,
    }).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    await ready.promise;
    await writeFile(source, "replacement", "utf8");

    const result = await outcome;
    expect(result.ok).toBe(false);
    expect(String(result.ok ? "" : result.error)).toMatch(/reconciliation marker persisted/i);
    await expect(readFile(source, "utf8")).resolves.toBe("replacement");
    await expect(readFile(target, "utf8")).resolves.toBe("original");
    const transaction = await readLocalFileOrganizationTransaction(path.join(
      tempDir,
      ".zerox-organize-transactions",
      "tx_reconciliation.json",
    ));
    expect(transaction).toMatchObject({
      status: "reconciliation_required",
      reconciliation: {
        required: true,
        markerPath: path.join(
          tempDir,
          ".zerox-organize-transactions",
          "tx_reconciliation.reconciliation",
        ),
      },
    });
    const staleCallerProjection = {
      ...transaction,
      status: "applied" as const,
      reconciliation: undefined,
    };
    await expect(rollbackLocalFileOrganization(staleCallerProjection)).rejects.toThrow(
      /manual reconciliation/i,
    );
    await expect(verifyLocalFileOrganization(staleCallerProjection)).resolves
      .toMatchObject({ verified: false });
  });

  it("does not claim persistence for an invalid pre-existing reconciliation marker", async () => {
    const source = path.join(tempDir, "photo.jpg");
    const target = path.join(tempDir, "Images", "photo.jpg");
    const marker = path.join(
      tempDir,
      ".zerox-organize-transactions",
      "tx_invalid_marker.reconciliation",
    );
    await writeFile(source, "original", "utf8");
    const preview = await previewLocalFileOrganization(tempDir, {
      createId: () => "tx_invalid_marker",
    });
    const ready = waitForSafeFsCommand("move-into-category");
    const outcome = applyLocalFileOrganization(preview, {
      safeFsTestDelayMs: 750,
      safeFsTestReadyStage: "move-applied",
      safeFsTestOnReady: ready.onReady,
    }).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    await ready.promise;
    await writeFile(source, "replacement", "utf8");
    await writeFile(marker, "invalid", { encoding: "utf8", mode: 0o600 });

    const result = await outcome;
    expect(result.ok).toBe(false);
    expect(String(result.ok ? "" : result.error)).toMatch(
      /marker could not be persisted/i,
    );
    await expect(readFile(source, "utf8")).resolves.toBe("replacement");
    await expect(readFile(target, "utf8")).resolves.toBe("original");
    await expect(readFile(marker, "utf8")).resolves.toBe("invalid");
    await expect(readLocalFileOrganizationTransaction(path.join(
      tempDir,
      ".zerox-organize-transactions",
      "tx_invalid_marker.json",
    ))).rejects.toThrow(/reconciliation marker is invalid/i);
  });

  it("rejects a category directory replaced by a symlink", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "local-file-organizer-outside-"));
    try {
      await writeFile(path.join(tempDir, "photo.jpg"), "new", "utf8");
      const preview = await previewLocalFileOrganization(tempDir, {
        createId: () => "tx_symlink",
      });
      await symlink(outside, path.join(tempDir, "Images"));

      await expect(applyLocalFileOrganization(preview)).rejects.toThrow(
        /not stable|escaped|outside/i,
      );
      await expect(access(path.join(outside, "photo.jpg"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("binds every move to the canonical pending journal leaf", async () => {
    const source = path.join(tempDir, "photo.jpg");
    const target = path.join(tempDir, "Images", "photo.jpg");
    const journal = path.join(
      tempDir,
      ".zerox-organize-transactions",
      "tx_journal_authority.json",
    );
    const heldJournal = `${journal}.held`;
    await writeFile(source, "original", "utf8");
    const preview = await previewLocalFileOrganization(tempDir, {
      createId: () => "tx_journal_authority",
    });
    const ready = waitForSafeFsCommand("move-into-category");
    const outcome = applyLocalFileOrganization(preview, {
      safeFsTestDelayMs: 750,
      safeFsTestReadyStage: "journal-bound",
      safeFsTestOnReady: ready.onReady,
    }).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    await ready.promise;
    await rename(journal, heldJournal);
    await writeFile(journal, "replacement", { encoding: "utf8", mode: 0o600 });

    const result = await outcome;
    expect(result.ok).toBe(false);
    expect(String(result.ok ? "" : result.error)).toMatch(/identity|opened file/i);
    await expect(readFile(source, "utf8")).resolves.toBe("original");
    await expectPath(target, false);
    await expect(readFile(journal, "utf8")).resolves.toBe("replacement");
    await expect(readFile(heldJournal, "utf8")).resolves.toContain(
      '"status":"pending"',
    );
  });

  it("rejects an equal-length rewrite of the same journal inode", async () => {
    const source = path.join(tempDir, "photo.jpg");
    const target = path.join(tempDir, "Images", "photo.jpg");
    const journal = path.join(
      tempDir,
      ".zerox-organize-transactions",
      "tx_journal_same_inode_rewrite.json",
    );
    await writeFile(source, "original", "utf8");
    const preview = await previewLocalFileOrganization(tempDir, {
      createId: () => "tx_journal_same_inode_rewrite",
    });
    const ready = waitForSafeFsCommand("move-into-category");
    const outcome = applyLocalFileOrganization(preview, {
      safeFsTestDelayMs: 750,
      safeFsTestReadyStage: "journal-bound",
      safeFsTestOnReady: ready.onReady,
    }).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    await ready.promise;
    const originalBody = await readFile(journal, "utf8");
    const originalIdentity = await stat(journal);
    const rewrittenBody = originalBody.replace('"pending"', '"invalid"');
    expect(rewrittenBody).toHaveLength(originalBody.length);
    await writeFile(journal, rewrittenBody, "utf8");
    expect((await stat(journal)).ino).toBe(originalIdentity.ino);

    const result = await outcome;
    expect(result.ok).toBe(false);
    expect(String(result.ok ? "" : result.error)).toMatch(/digest|content|identity/i);
    await expect(readFile(source, "utf8")).resolves.toBe("original");
    await expectPath(target, false);
  });

  it("rejects a transaction journal whose private mode changes before mutation", async () => {
    const source = path.join(tempDir, "photo.jpg");
    const target = path.join(tempDir, "Images", "photo.jpg");
    const journal = path.join(
      tempDir,
      ".zerox-organize-transactions",
      "tx_journal_mode.json",
    );
    await writeFile(source, "original", "utf8");
    const preview = await previewLocalFileOrganization(tempDir, {
      createId: () => "tx_journal_mode",
    });
    const ready = waitForSafeFsCommand("move-into-category");
    const outcome = applyLocalFileOrganization(preview, {
      safeFsTestDelayMs: 750,
      safeFsTestReadyStage: "journal-bound",
      safeFsTestOnReady: ready.onReady,
    }).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    await ready.promise;
    await chmod(journal, 0o644);

    const result = await outcome;
    expect(result.ok).toBe(false);
    expect(String(result.ok ? "" : result.error)).toMatch(/identity changed/i);
    await expect(readFile(source, "utf8")).resolves.toBe("original");
    await expectPath(target, false);
    await expect(readLocalFileOrganizationTransaction(journal)).rejects.toThrow(
      /identity changed while reading/i,
    );
  });

  it("rejects category permission drift after native capabilities are opened", async () => {
    const source = path.join(tempDir, "photo.jpg");
    const category = path.join(tempDir, "Images");
    const target = path.join(category, "photo.jpg");
    await mkdir(category);
    await writeFile(source, "original", "utf8");
    const preview = await previewLocalFileOrganization(tempDir, {
      createId: () => "tx_category_mode_drift",
    });
    const ready = waitForSafeFsCommand("move-into-category");
    const outcome = applyLocalFileOrganization(preview, {
      safeFsTestDelayMs: 750,
      safeFsTestReadyStage: "source-verified",
      safeFsTestOnReady: ready.onReady,
    }).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    await ready.promise;
    await chmod(category, 0o777);

    const result = await outcome;
    expect(result.ok).toBe(false);
    expect(String(result.ok ? "" : result.error)).toMatch(/mode|permission|identity/i);
    await expect(readFile(source, "utf8")).resolves.toBe("original");
    await expectPath(target, false);
  });

  it("records reconciliation when journal permissions drift before append", async () => {
    const source = path.join(tempDir, "photo.jpg");
    const target = path.join(tempDir, "Images", "photo.jpg");
    const journal = path.join(
      tempDir,
      ".zerox-organize-transactions",
      "tx_log_append_mode_drift.json",
    );
    await writeFile(source, "original", "utf8");
    const preview = await previewLocalFileOrganization(tempDir, {
      createId: () => "tx_log_append_mode_drift",
    });
    const ready = waitForSafeFsCommand("log-append");
    const outcome = applyLocalFileOrganization(preview, {
      safeFsTestDelayMs: 750,
      safeFsTestReadyStage: "log-opened",
      safeFsTestOnReady: ready.onReady,
    }).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    await ready.promise;
    await chmod(journal, 0o644);

    const result = await outcome;
    expect(result.ok).toBe(false);
    expect(String(result.ok ? "" : result.error)).toMatch(/mode|permission|identity/i);
    await expectPath(source, false);
    await expect(readFile(target, "utf8")).resolves.toBe("original");
    await chmod(journal, 0o600);
    await expect(readLocalFileOrganizationTransaction(journal)).resolves.toMatchObject({
      status: "reconciliation_required",
      reconciliation: { required: true },
    });
  });

  it("rejects a category directory moved after its native capability is opened", async () => {
    const outside = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "local-file-organizer-race-outside-")),
    );
    const category = path.join(tempDir, "Images");
    const displaced = path.join(tempDir, "Images-displaced");
    try {
      await mkdir(category);
      await writeFile(path.join(tempDir, "photo.jpg"), "new", "utf8");
      const preview = await previewLocalFileOrganization(tempDir, {
        createId: () => "tx_category_capability_swap",
      });
      const ready = waitForSafeFsCommand("move-into-category");
      const outcome = applyLocalFileOrganization(preview, {
        safeFsTestDelayMs: 1_000,
        safeFsTestReadyStage: "source-verified",
        safeFsTestOnReady: ready.onReady,
      }).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );

      await ready.promise;
      await rename(category, displaced);
      await symlink(outside, category);

      const result = await outcome;
      expect(result.ok).toBe(false);
      expect(String(result.ok ? "" : result.error)).toMatch(
        /capability moved from its authorized path/i,
      );
      await expect(readFile(path.join(tempDir, "photo.jpg"), "utf8"))
        .resolves.toBe("new");
      await expect(access(path.join(outside, "photo.jpg"))).rejects
        .toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("restores an atomic move when the category capability moves after rename", async () => {
    const outside = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "local-file-organizer-post-move-outside-")),
    );
    const source = path.join(tempDir, "photo.jpg");
    const category = path.join(tempDir, "Images");
    const displaced = path.join(tempDir, "Images-displaced");
    try {
      await mkdir(category);
      await writeFile(source, "original", "utf8");
      const preview = await previewLocalFileOrganization(tempDir, {
        createId: () => "tx_category_post_move",
      });
      const ready = waitForSafeFsCommand("move-into-category");
      const outcome = applyLocalFileOrganization(preview, {
        safeFsTestDelayMs: 750,
        safeFsTestReadyStage: "move-applied",
        safeFsTestOnReady: ready.onReady,
      }).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );

      await ready.promise;
      await rename(category, displaced);
      await symlink(outside, category);

      const result = await outcome;
      expect(result.ok).toBe(false);
      expect(String(result.ok ? "" : result.error)).toMatch(
        /authority is unresolved; reconciliation marker persisted/i,
      );
      await expect(readFile(source, "utf8")).resolves.toBe("original");
      await expectPath(path.join(displaced, "photo.jpg"), false);
      await expect(access(path.join(outside, "photo.jpg"))).rejects
        .toMatchObject({ code: "ENOENT" });
      await expect(readLocalFileOrganizationTransaction(path.join(
        tempDir,
        ".zerox-organize-transactions",
        "tx_category_post_move.json",
      ))).resolves.toMatchObject({
        status: "reconciliation_required",
        reconciliation: { required: true, kind: "marker" },
      });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects a transaction directory moved after its native capability is opened", async () => {
    const outside = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "local-file-organizer-log-race-outside-")),
    );
    const transactionDirectory = path.join(tempDir, ".zerox-organize-transactions");
    const displaced = path.join(tempDir, ".zerox-organize-transactions-displaced");
    try {
      await writeFile(path.join(tempDir, "photo.jpg"), "new", "utf8");
      const preview = await previewLocalFileOrganization(tempDir, {
        createId: () => "tx_log_capability_swap",
      });
      const ready = waitForSafeFsCommand("log-create");
      const outcome = applyLocalFileOrganization(preview, {
        safeFsTestDelayMs: 1_000,
        safeFsTestOnReady: ready.onReady,
      }).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );

      await ready.promise;
      await rename(transactionDirectory, displaced);
      await symlink(outside, transactionDirectory);

      const result = await outcome;
      expect(result.ok).toBe(false);
      expect(String(result.ok ? "" : result.error)).toMatch(
        /capability moved from its authorized path/i,
      );
      await expect(access(path.join(outside, "tx_log_capability_swap.json")))
        .rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(path.join(tempDir, "photo.jpg"), "utf8"))
        .resolves.toBe("new");
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("persists reconciliation beside a journal moved after an append mutation", async () => {
    const outside = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "local-file-organizer-log-post-outside-")),
    );
    const transactionDirectory = path.join(tempDir, ".zerox-organize-transactions");
    const displaced = path.join(tempDir, ".zerox-organize-transactions-displaced");
    try {
      await writeFile(path.join(tempDir, "photo.jpg"), "original", "utf8");
      const preview = await previewLocalFileOrganization(tempDir, {
        createId: () => "tx_log_post_mutation",
      });
      const ready = waitForSafeFsCommand("log-append");
      const outcome = applyLocalFileOrganization(preview, {
        safeFsTestDelayMs: 500,
        safeFsTestReadyStage: "log-mutated",
        safeFsTestOnReady: ready.onReady,
      }).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );

      await ready.promise;
      await rename(transactionDirectory, displaced);
      await symlink(outside, transactionDirectory);

      const result = await outcome;
      expect(result.ok).toBe(false);
      expect(String(result.ok ? "" : result.error)).toMatch(
        /capability moved from its authorized path/i,
      );
      await expect(readFile(
        path.join(displaced, "tx_log_post_mutation.json"),
        "utf8",
      )).resolves.toContain('"status":"applied"');
      await expect(readFile(
        path.join(displaced, "tx_log_post_mutation.reconciliation"),
        "utf8",
      )).resolves.toContain("local-file-organization-reconciliation-required");
      await expect(access(path.join(outside, "tx_log_post_mutation.json")))
        .rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(path.join(tempDir, "Images", "photo.jpg"), "utf8"))
        .resolves.toBe("original");
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("does not create transaction directories through a replaced root symlink", async () => {
    const root = path.join(tempDir, "workspace");
    const displaced = path.join(tempDir, "workspace-displaced");
    const outside = path.join(tempDir, "outside");
    await mkdir(root);
    await mkdir(outside);
    await writeFile(path.join(root, "photo.jpg"), "new", "utf8");
    const preview = await previewLocalFileOrganization(root, {
      createId: () => "tx_root_swap",
    });
    await rename(root, displaced);
    await symlink(outside, root);

    await expect(applyLocalFileOrganization(preview)).rejects.toThrow(
      /not stable|identity|symbolic|escaped|outside/i,
    );
    await expect(access(path.join(outside, ".zerox-organize-transactions")))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(displaced, "photo.jpg"), "utf8"))
      .resolves.toBe("new");
  });

  it("rejects a root moved after its native capability is opened", async () => {
    const root = path.join(tempDir, "workspace");
    const displaced = path.join(tempDir, "workspace-displaced");
    const outside = path.join(tempDir, "outside");
    await mkdir(root);
    await mkdir(outside);
    await writeFile(path.join(root, "photo.jpg"), "new", "utf8");
    const preview = await previewLocalFileOrganization(root, {
      createId: () => "tx_root_capability_swap",
    });
    const ready = waitForSafeFsCommand("log-create");
    const outcome = applyLocalFileOrganization(preview, {
      safeFsTestDelayMs: 1_000,
      safeFsTestOnReady: ready.onReady,
    }).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    await ready.promise;
    await rename(root, displaced);
    await symlink(outside, root);

    const result = await outcome;
    expect(result.ok).toBe(false);
    expect(String(result.ok ? "" : result.error)).toMatch(
      /capability moved from its authorized path/i,
    );
    await expect(access(path.join(outside, ".zerox-organize-transactions")))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(displaced, "photo.jpg"), "utf8"))
      .resolves.toBe("new");
  });

  it("fails rollback before mutation when the original source path conflicts", async () => {
    await writeFile(path.join(tempDir, "photo.jpg"), "original", "utf8");
    const preview = await previewLocalFileOrganization(tempDir, {
      createId: () => "tx_rollback_conflict",
    });
    const transaction = await applyLocalFileOrganization(preview);
    await writeFile(path.join(tempDir, "photo.jpg"), "replacement", "utf8");

    await expect(rollbackLocalFileOrganization(transaction)).rejects.toThrow(
      /rollback.*conflict|identity/i,
    );
    await expect(readFile(path.join(tempDir, "photo.jpg"), "utf8"))
      .resolves.toBe("replacement");
    await expect(readFile(path.join(tempDir, "Images", "photo.jpg"), "utf8"))
      .resolves.toBe("original");
    await expect(readLocalFileOrganizationTransaction(transaction.logPath))
      .resolves.toMatchObject({ status: "applied" });
  });

  it("preserves both historical duplicate links for manual reconciliation", async () => {
    const source = path.join(tempDir, "photo.jpg");
    const target = path.join(tempDir, "Images", "photo.jpg");
    await writeFile(source, "original", "utf8");
    const preview = await previewLocalFileOrganization(tempDir, {
      createId: () => "tx_duplicate_preserved",
    });
    const transaction = await applyLocalFileOrganization(preview);
    await link(target, source);

    await expect(rollbackLocalFileOrganization(transaction)).rejects.toThrow(
      /preserved duplicate links for manual reconciliation/i,
    );
    await expect(readFile(source, "utf8")).resolves.toBe("original");
    await expect(readFile(target, "utf8")).resolves.toBe("original");
    await expect(readLocalFileOrganizationTransaction(transaction.logPath))
      .resolves.toMatchObject({ status: "applied" });
  });

  it("recovers a pending journal after apply fails before any move", async () => {
    await writeFile(path.join(tempDir, "photo.jpg"), "original", "utf8");
    const preview = await previewLocalFileOrganization(tempDir, {
      createId: () => "tx_pending_recovery",
    });
    const target = path.join(tempDir, "Images", "photo.jpg");
    await mkdir(path.dirname(target));
    await writeFile(target, "conflict", "utf8");

    await expect(applyLocalFileOrganization(preview)).rejects.toThrow(
      /target appeared/i,
    );
    const logPath = path.join(
      tempDir,
      ".zerox-organize-transactions",
      "tx_pending_recovery.json",
    );
    const pending = await readLocalFileOrganizationTransaction(logPath);
    expect(pending).toMatchObject({
      status: "pending",
      logIdentity: {
        dev: expect.stringMatching(/^\d+$/),
        ino: expect.stringMatching(/^\d+$/),
        size: expect.stringMatching(/^\d+$/),
        uid: expect.stringMatching(/^\d+$/),
      },
    });

    await rm(target);
    await expect(rollbackLocalFileOrganization(pending)).resolves.toMatchObject({
      status: "rolled_back",
      movesRolledBack: 1,
    });
    await expect(readFile(path.join(tempDir, "photo.jpg"), "utf8"))
      .resolves.toBe("original");
  });

  it("recovers the last complete journal record after an interrupted append", async () => {
    await writeFile(path.join(tempDir, "photo.jpg"), "original", "utf8");
    const preview = await previewLocalFileOrganization(tempDir, {
      createId: () => "tx_partial_journal",
    });
    const transaction = await applyLocalFileOrganization(preview);
    await appendFile(transaction.logPath, '{"status":"rolled_', "utf8");

    const recovered = await readLocalFileOrganizationTransaction(transaction.logPath);
    expect(recovered).toMatchObject({
      status: "applied",
      logIdentity: {
        size: expect.stringMatching(/^\d+$/),
      },
    });
    await rollbackLocalFileOrganization(recovered);
    await expect(readLocalFileOrganizationTransaction(transaction.logPath))
      .resolves.toMatchObject({ status: "rolled_back" });
  });

  it("loads v3.9.1 journals as explicit read-only reconciliation work", async () => {
    const source = path.join(tempDir, "photo.jpg");
    const target = path.join(tempDir, "Images", "photo.jpg");
    const logDirectory = path.join(tempDir, ".zerox-organize-transactions");
    const logPath = path.join(logDirectory, "tx_legacy_v391.json");
    await mkdir(path.dirname(target));
    await mkdir(logDirectory, { mode: 0o700 });
    await writeFile(target, "original", "utf8");
    await writeFile(logPath, `${JSON.stringify({
      id: "tx_legacy_v391",
      root: tempDir,
      status: "applied",
      createdAt: "2026-06-15T00:00:00.000Z",
      appliedAt: "2026-06-15T00:01:00.000Z",
      logPath,
      moves: [{
        from: source,
        to: target,
        category: "Images",
        reason: "legacy extension match",
      }],
      movesApplied: 1,
      history: [
        { status: "pending", at: "2026-06-15T00:00:00.000Z" },
        { status: "applied", at: "2026-06-15T00:01:00.000Z" },
      ],
    }, null, 2)}\n`, { encoding: "utf8", mode: 0o644 });
    await chmod(logPath, 0o644);

    const transaction = await readLocalFileOrganizationTransaction(logPath);
    expect(transaction).toMatchObject({
      id: "tx_legacy_v391",
      status: "reconciliation_required",
      reconciliation: {
        required: true,
        kind: "legacy_journal",
        reason: "v3.9.1_transaction_requires_manual_reconciliation",
      },
    });
    expect(transaction.logIdentity).toBeUndefined();
    await expect(rollbackLocalFileOrganization(transaction)).rejects.toThrow(
      /manual reconciliation/i,
    );
    await expect(verifyLocalFileOrganization(transaction)).resolves.toMatchObject({
      verified: false,
      checked: 1,
    });
    await expectPath(source, false);
    await expect(readFile(target, "utf8")).resolves.toBe("original");
  });

  it("rejects group-writable legacy journals", async () => {
    const logDirectory = path.join(tempDir, ".zerox-organize-transactions");
    const logPath = path.join(logDirectory, "tx_legacy_unsafe.json");
    await mkdir(logDirectory, { mode: 0o700 });
    await writeFile(logPath, JSON.stringify({
      id: "tx_legacy_unsafe",
      root: tempDir,
      status: "applied",
      logPath,
      moves: [],
      history: [],
    }), { encoding: "utf8", mode: 0o666 });
    await chmod(logPath, 0o666);

    await expect(readLocalFileOrganizationTransaction(logPath)).rejects.toThrow(
      /permissions are unsafe/i,
    );
  });

  it("rejects an oversized journal before reading it into memory", async () => {
    const logDirectory = path.join(tempDir, ".zerox-organize-transactions");
    const logPath = path.join(logDirectory, "tx_oversized_journal.json");
    await mkdir(logDirectory, { mode: 0o700 });
    await writeFile(logPath, Buffer.alloc(4 * 1024 * 1024 + 1, 0x20), {
      mode: 0o600,
    });

    await expect(readLocalFileOrganizationTransaction(logPath)).rejects.toThrow(
      /exceeds the safe size limit/i,
    );
  });

  it("does not overwrite a journal leaf replaced after the append descriptor opens", async () => {
    await writeFile(path.join(tempDir, "photo.jpg"), "original", "utf8");
    const preview = await previewLocalFileOrganization(tempDir, {
      createId: () => "tx_log_leaf_swap",
    });
    const ready = waitForSafeFsCommand("log-append");
    const outcome = applyLocalFileOrganization(preview, {
      safeFsTestDelayMs: 500,
      safeFsTestOnReady: ready.onReady,
    }).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    const logPath = path.join(
      tempDir,
      ".zerox-organize-transactions",
      "tx_log_leaf_swap.json",
    );
    const displacedLog = `${logPath}.displaced`;

    await ready.promise;
    await rename(logPath, displacedLog);
    await writeFile(logPath, "canary", "utf8");

    const result = await outcome;
    expect(result.ok).toBe(false);
    expect(String(result.ok ? "" : result.error)).toMatch(/identity|no longer names/i);
    await expect(readFile(logPath, "utf8")).resolves.toBe("canary");
    await expect(readFile(displacedLog, "utf8")).resolves.toContain(
      '"status":"pending"',
    );

    await rm(logPath);
    await rename(displacedLog, logPath);
    const recovered = await readLocalFileOrganizationTransaction(logPath);
    expect(recovered.status).toBe("reconciliation_required");
    await expect(rollbackLocalFileOrganization(recovered)).rejects.toThrow(
      /manual reconciliation/i,
    );
    await expect(readFile(path.join(tempDir, "Images", "photo.jpg"), "utf8"))
      .resolves.toBe("original");
  });

  it("rejects replacement targets during identity-based verification", async () => {
    await writeFile(path.join(tempDir, "photo.jpg"), "original", "utf8");
    const preview = await previewLocalFileOrganization(tempDir, {
      createId: () => "tx_verify_identity",
    });
    const transaction = await applyLocalFileOrganization(preview);
    const target = path.join(tempDir, "Images", "photo.jpg");
    await rm(target);
    await writeFile(target, "replacement", "utf8");

    await expect(verifyLocalFileOrganization(transaction)).resolves
      .toMatchObject({
        verified: false,
        checked: 1,
        missingTargets: [],
        changedTargets: [target],
        unmovedSources: [],
        sourceConflicts: [],
      });
  });

  it("fails closed when verification crosses an intermediate category symlink", async () => {
    const outside = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "local-file-organizer-verify-outside-")),
    );
    try {
      await writeFile(path.join(tempDir, "photo.jpg"), "original", "utf8");
      const preview = await previewLocalFileOrganization(tempDir, {
        createId: () => "tx_verify_category_symlink",
      });
      const transaction = await applyLocalFileOrganization(preview);
      const category = path.join(tempDir, "Images");
      const relocatedCategory = path.join(outside, "Images");
      await rename(category, relocatedCategory);
      await symlink(relocatedCategory, category);

      await expect(verifyLocalFileOrganization(transaction)).rejects.toThrow(
        /outside|escaped|symbolic|stable/i,
      );
      await expect(readFile(path.join(relocatedCategory, "photo.jpg"), "utf8"))
        .resolves.toBe("original");
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("uses the packaged resources helper when Electron resources are present", async () => {
    const resources = path.join(tempDir, "packaged-resources");
    const helperDirectory = path.join(resources, "safe-fs");
    const workspace = path.join(tempDir, "workspace");
    await mkdir(helperDirectory, { recursive: true });
    await mkdir(workspace);
    await copyFile(
      path.join(
        process.cwd(),
        `dist-native/darwin-${process.arch}/zerox-safe-fs`,
      ),
      path.join(helperDirectory, "zerox-safe-fs"),
    );
    await chmod(path.join(helperDirectory, "zerox-safe-fs"), 0o755);
    await writeFile(path.join(workspace, "photo.jpg"), "image", "utf8");
    const previousDescriptor = Object.getOwnPropertyDescriptor(
      process,
      "resourcesPath",
    );
    Object.defineProperty(process, "resourcesPath", {
      configurable: true,
      value: resources,
    });
    try {
      const preview = await previewLocalFileOrganization(workspace, {
        createId: () => "tx_packaged_helper",
      });
      await expect(applyLocalFileOrganization(preview)).resolves.toMatchObject({
        status: "applied",
        movesApplied: 1,
      });
    } finally {
      if (previousDescriptor) {
        Object.defineProperty(process, "resourcesPath", previousDescriptor);
      } else {
        Reflect.deleteProperty(process, "resourcesPath");
      }
    }
  });

  it("rejects crafted previews with moves outside the preview root before rename", async () => {
    const workspaceRoot = path.join(tempDir, "workspace");
    const outsideRoot = path.join(tempDir, "outside");
    const outsideFile = path.join(outsideRoot, "secret.txt");
    await mkdir(workspaceRoot, { recursive: true });
    await mkdir(outsideRoot, { recursive: true });
    await writeFile(outsideFile, "secret", "utf8");

    await expect(
      applyLocalFileOrganization({
        id: "tx_crafted",
        root: workspaceRoot,
        generatedAt: "2026-06-21T00:00:00.000Z",
        confirmationRequired: true,
        inventory: { files: 1, directories: 0, skipped: 0 },
        conflicts: [],
        moves: [
          {
            from: outsideFile,
            to: path.join(workspaceRoot, "Documents", "secret.txt"),
            category: "Documents",
            reason: "crafted",
          },
        ],
      }),
    ).rejects.toThrow(/outside/i);

    await expect(readFile(outsideFile, "utf8")).resolves.toBe("secret");
    await expectPath(path.join(workspaceRoot, "Documents", "secret.txt"), false);
  });

  it("rejects unsafe transaction ids and mismatched transaction logs", async () => {
    await expect(
      previewLocalFileOrganization(tempDir, {
        createId: () => "../outside",
      }),
    ).rejects.toThrow("transaction id is invalid");

    await expect(
      rollbackLocalFileOrganization({
        id: "tx_crafted",
        root: tempDir,
        status: "applied",
        createdAt: "2026-06-21T00:00:00.000Z",
        appliedAt: "2026-06-21T00:01:00.000Z",
        logPath: path.join(tempDir, "unrelated.json"),
        moves: [],
        movesApplied: 0,
        history: [],
      }),
    ).rejects.toThrow("does not belong");
    await expect(access(path.join(tempDir, "unrelated.json"))).rejects
      .toMatchObject({ code: "ENOENT" });
  });

  it("fails closed when the explicitly selected native helper is missing or non-executable", async () => {
    await writeFile(path.join(tempDir, "photo.jpg"), "new", "utf8");
    const preview = await previewLocalFileOrganization(tempDir, {
      createId: () => "tx_helper_unavailable",
    });
    const missingHelper = path.join(tempDir, "missing-safe-fs");

    await expect(applyLocalFileOrganization(preview, {
      safeFsHelperPath: missingHelper,
    })).rejects.toThrow(/helper is unavailable/i);

    const inertHelper = path.join(tempDir, "inert-safe-fs");
    await writeFile(inertHelper, "not executable", "utf8");
    await chmod(inertHelper, 0o600);
    await expect(applyLocalFileOrganization({
      ...preview,
      id: "tx_helper_inert",
    }, {
      safeFsHelperPath: inertHelper,
    })).rejects.toThrow(/helper is unavailable/i);
    await expect(readFile(path.join(tempDir, "photo.jpg"), "utf8"))
      .resolves.toBe("new");
  });

  it("rejects crafted rollback transactions with paths outside the transaction root before rename", async () => {
    const workspaceRoot = path.join(tempDir, "workspace");
    const outsideRoot = path.join(tempDir, "outside");
    const outsideFile = path.join(outsideRoot, "secret.txt");
    await mkdir(workspaceRoot, { recursive: true });
    await mkdir(outsideRoot, { recursive: true });
    await writeFile(outsideFile, "secret", "utf8");

    await expect(
      rollbackLocalFileOrganization({
        id: "tx_crafted",
        root: workspaceRoot,
        status: "applied",
        createdAt: "2026-06-21T00:00:00.000Z",
        appliedAt: "2026-06-21T00:01:00.000Z",
        logPath: path.join(workspaceRoot, ".zerox-organize-transactions", "tx_crafted.json"),
        moves: [
          {
            from: path.join(workspaceRoot, "secret.txt"),
            to: outsideFile,
            category: "Documents",
            reason: "crafted",
          },
        ],
        movesApplied: 1,
        history: [],
      }),
    ).rejects.toThrow(/outside/i);

    await expect(readFile(outsideFile, "utf8")).resolves.toBe("secret");
    await expectPath(path.join(workspaceRoot, "secret.txt"), false);
  });
});

async function expectPath(targetPath: string, exists: boolean) {
  await expect(access(targetPath).then(
    () => true,
    () => false,
  )).resolves.toBe(exists);
}

function waitForSafeFsCommand(expectedCommand: string): {
  promise: Promise<void>;
  onReady: (command: string) => void;
} {
  let resolveReady!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  return {
    promise,
    onReady(command) {
      if (command === expectedCommand) resolveReady();
    },
  };
}
