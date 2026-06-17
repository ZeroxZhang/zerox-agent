import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyLocalFileOrganization,
  previewLocalFileOrganization,
  rollbackLocalFileOrganization,
} from "./localFileOrganizer";

describe("local file organizer", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "local-file-organizer-"));
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
    await expect(
      readFile(
        path.join(tempDir, ".zerox-organize-transactions", "tx_1.json"),
        "utf8",
      ),
    ).resolves.toContain("\"status\": \"pending\"");

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
});

async function expectPath(targetPath: string, exists: boolean) {
  await expect(access(targetPath).then(
    () => true,
    () => false,
  )).resolves.toBe(exists);
}
