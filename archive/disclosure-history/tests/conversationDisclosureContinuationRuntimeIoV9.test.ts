import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
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
import { afterEach, describe, expect, it } from "vitest";

const runtimeIo = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/conversation-disclosure-continuation-runtime-io-v9.mjs"
);

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

describe("conversation disclosure continuation runtime I/O v9", () => {
  it("captures one stable file and validates the complete ledger postflight", async () => {
    const root = await createRoot();
    const filePath = path.join(root, "stable.txt");
    const bytes = Buffer.from("stable runtime input\n", "utf8");
    await writeFile(filePath, bytes, { mode: 0o644 });
    const ledger = runtimeIo.createCaptureLedgerV9();

    const capture = await runtimeIo.captureStableFileV9(filePath, "stable input", {
      expectedRoot: root,
      ledger,
    });

    expect(capture.bytes.equals(bytes)).toBe(true);
    expect(capture.digest).toBe(runtimeIo.sha256BytesV9(bytes));
    expect(capture.identity.nlink).toBe(1n);
    expect(ledger.entries).toHaveLength(1);
    expect(await runtimeIo.postflightCaptureLedgerV9(ledger)).toEqual({
      status: "passed",
      captureCount: 1,
    });
  });

  it("requires private evidence to be an owned 0600 single-link file", async () => {
    const root = await createRoot();
    const evidencePath = path.join(root, "evidence.json");
    await writeFile(evidencePath, "{}\n", { mode: 0o600 });

    const captured = await runtimeIo.capturePrivateEvidenceV9(
      evidencePath,
      "private evidence",
      { expectedRoot: root },
    );
    expect(captured.mode).toBe(0o600);
    expect(captured.uid).toBe(process.geteuid?.());

    await chmod(evidencePath, 0o644);
    await expect(runtimeIo.capturePrivateEvidenceV9(
      evidencePath,
      "private evidence",
      { expectedRoot: root },
    )).rejects.toMatchObject({ code: "RUNTIME_IO_V9_MODE" });
  });

  it("throws for every present required-absent leaf type", async () => {
    const root = await createRoot();
    const filePath = path.join(root, "present-file");
    const directoryPath = path.join(root, "present-directory");
    const targetPath = path.join(root, "symlink-target");
    const symlinkPath = path.join(root, "present-symlink");
    await writeFile(filePath, "file\n");
    await mkdir(directoryPath);
    await writeFile(targetPath, "target\n");
    await symlink(targetPath, symlinkPath);

    for (const presentPath of [filePath, directoryPath, symlinkPath]) {
      await expect(runtimeIo.captureRequiredAbsentV9(
        presentPath,
        "required absent output",
        { expectedRoot: root },
      )).rejects.toMatchObject({ code: "RUNTIME_IO_V9_EXPECTED_ABSENT" });
    }
  });

  it("records required absence and rejects a postflight appearance", async () => {
    const root = await createRoot();
    const outputPath = path.join(root, "must-remain-absent.json");
    const ledger = runtimeIo.createCaptureLedgerV9();

    await runtimeIo.captureRequiredAbsentV9(outputPath, "future output", {
      expectedRoot: root,
      ledger,
    });
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0].kind).toBe("absent");

    await writeFile(outputPath, "appeared\n", { mode: 0o600 });
    await expect(runtimeIo.postflightCaptureLedgerV9(ledger))
      .rejects.toMatchObject({ code: "RUNTIME_IO_V9_APPEARED" });
  });

  it("rejects postflight mode drift", async () => {
    const root = await createRoot();
    const filePath = path.join(root, "mode.txt");
    await writeFile(filePath, "mode\n", { mode: 0o644 });
    const ledger = runtimeIo.createCaptureLedgerV9();
    await runtimeIo.captureStableFileV9(filePath, "mode input", {
      expectedRoot: root,
      ledger,
    });

    await chmod(filePath, 0o600);
    await expect(runtimeIo.postflightCaptureLedgerV9(ledger))
      .rejects.toMatchObject({ code: "RUNTIME_IO_V9_CAPTURE_DRIFT" });
  });

  it("rejects postflight inode replacement even when bytes are unchanged", async () => {
    const root = await createRoot();
    const filePath = path.join(root, "inode.txt");
    const replacementPath = path.join(root, "replacement.txt");
    const bytes = Buffer.from("same bytes\n", "utf8");
    await writeFile(filePath, bytes, { mode: 0o644 });
    const ledger = runtimeIo.createCaptureLedgerV9();
    await runtimeIo.captureStableFileV9(filePath, "inode input", {
      expectedRoot: root,
      ledger,
    });

    await writeFile(replacementPath, bytes, { mode: 0o644 });
    await rename(replacementPath, filePath);
    await expect(runtimeIo.postflightCaptureLedgerV9(ledger))
      .rejects.toMatchObject({ code: "RUNTIME_IO_V9_CAPTURE_DRIFT" });
  });

  it("rejects postflight hard-link drift", async () => {
    const root = await createRoot();
    const filePath = path.join(root, "linked.txt");
    await writeFile(filePath, "link drift\n", { mode: 0o644 });
    const ledger = runtimeIo.createCaptureLedgerV9();
    await runtimeIo.captureStableFileV9(filePath, "linked input", {
      expectedRoot: root,
      ledger,
    });

    await link(filePath, path.join(root, "second-link.txt"));
    await expect(runtimeIo.postflightCaptureLedgerV9(ledger))
      .rejects.toMatchObject({ code: "RUNTIME_IO_V9_INVALID_LEAF" });
  });

  it("rejects postflight parent identity replacement", async () => {
    const root = await createRoot();
    const parentPath = path.join(root, "authority");
    const displacedPath = path.join(root, "authority-old");
    const filePath = path.join(parentPath, "input.txt");
    await mkdir(parentPath);
    await writeFile(filePath, "authority\n", { mode: 0o644 });
    const ledger = runtimeIo.createCaptureLedgerV9();
    await runtimeIo.captureStableFileV9(filePath, "parent-bound input", {
      expectedRoot: root,
      ledger,
    });

    await rename(parentPath, displacedPath);
    await mkdir(parentPath);
    await writeFile(filePath, "authority\n", { mode: 0o644 });
    await expect(runtimeIo.postflightCaptureLedgerV9(ledger))
      .rejects.toMatchObject({ code: "RUNTIME_IO_V9_PARENT_DRIFT" });
  });

  it("publishes exact private bytes once and reruns idempotently", async () => {
    const root = await createRoot();
    const outputPath = path.join(root, "receipt.json");
    const bytes = Buffer.from('{"status":"passed"}\n', "utf8");

    const first = await runtimeIo.publishPrivateExactV9(outputPath, bytes, {
      expectedRoot: root,
      label: "runtime receipt",
    });
    const firstStat = await stat(outputPath);
    const second = await runtimeIo.publishPrivateExactV9(outputPath, bytes, {
      expectedRoot: root,
      label: "runtime receipt",
    });
    const secondStat = await stat(outputPath);

    expect(first.status).toBe("created");
    expect(second.status).toBe("idempotent");
    expect(first.digest).toBe(runtimeIo.sha256BytesV9(bytes));
    expect(second.digest).toBe(first.digest);
    expect(second.ino).toBe(first.ino);
    expect(secondStat.ino).toBe(firstStat.ino);
    expect(secondStat.nlink).toBe(1);
    expect(secondStat.mode & 0o777).toBe(0o600);
    expect(await readFile(outputPath)).toEqual(bytes);
  });

  it("recovers deterministic private publication temps and linked crash pairs", async () => {
    const root = await createRoot();
    const bytes = Buffer.from('{"status":"passed"}\n', "utf8");

    for (const state of ["temp_only", "linked_pair"]) {
      const outputPath = path.join(root, `${state}.json`);
      const basename = path.basename(outputPath);
      const temporaryPath = path.join(
        root,
        `.${basename}.${runtimeIo.sha256BytesV9(bytes).slice(7, 31)}.tmp`,
      );
      await writeFile(temporaryPath, bytes, { mode: 0o600 });
      if (state === "linked_pair") await link(temporaryPath, outputPath);

      const result = await runtimeIo.publishPrivateExactV9(outputPath, bytes, {
        expectedRoot: root,
        label: state,
      });

      expect(result.status).toBe(state === "temp_only" ? "created" : "idempotent");
      expect((await stat(outputPath)).nlink).toBe(1);
      expect(await readFile(outputPath)).toEqual(bytes);
      await expect(lstat(temporaryPath)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("rejects partial, different, non-private, and symlink publication states", async () => {
    const root = await createRoot();
    const expected = Buffer.from("complete canonical output\n", "utf8");
    const partialPath = path.join(root, "partial.json");
    const differentPath = path.join(root, "different.json");
    const publicPath = path.join(root, "public.json");
    const targetPath = path.join(root, "target.json");
    const symlinkPath = path.join(root, "symlink.json");
    await writeFile(partialPath, expected.subarray(0, 8), { mode: 0o600 });
    await writeFile(differentPath, "different same-length output\n", { mode: 0o600 });
    await writeFile(publicPath, expected, { mode: 0o644 });
    await writeFile(targetPath, expected, { mode: 0o600 });
    await symlink(targetPath, symlinkPath);

    for (const existingPath of [partialPath, differentPath]) {
      await expect(runtimeIo.publishPrivateExactV9(existingPath, expected, {
        expectedRoot: root,
      })).rejects.toMatchObject({ code: "RUNTIME_IO_V9_THIRD_STATE" });
    }
    await expect(runtimeIo.publishPrivateExactV9(publicPath, expected, {
      expectedRoot: root,
    })).rejects.toMatchObject({ code: "RUNTIME_IO_V9_MODE" });
    await expect(runtimeIo.publishPrivateExactV9(symlinkPath, expected, {
      expectedRoot: root,
    })).rejects.toMatchObject({ code: "RUNTIME_IO_V9_ROOT_ESCAPE" });
  });
});

async function createRoot() {
  const created = await mkdtemp(path.join(os.tmpdir(), "runtime-io-v9-"));
  const root = await realpath(created);
  roots.push(root);
  return root;
}
