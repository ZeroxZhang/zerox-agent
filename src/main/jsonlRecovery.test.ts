import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  RECOVERABLE_JSONL_PAGE_MAX_BYTES,
  readRecoverableJsonlPage,
} from "./jsonlRecovery";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

describe("bounded recoverable JSONL pages", () => {
  it("reads forward from byte offsets without hydrating the whole file", async () => {
    const file = await createFile([
      { id: 1 },
      { id: 2 },
      { id: 3 },
    ]);
    const first = await readRecoverableJsonlPage<{ id: number }>(file, {
      limit: 2,
    });
    expect(first).toMatchObject({
      records: [{ id: 1 }, { id: 2 }],
      complete: false,
      malformedLineCount: 0,
      status: "complete",
    });
    expect(first.nextOffset).toBeTypeOf("number");

    const second = await readRecoverableJsonlPage<{ id: number }>(file, {
      limit: 2,
      offset: first.nextOffset,
      endOffset: Number(first.sourceRevision.split(":")[3]),
      expectedIdentity: {
        dev: first.sourceRevision.split(":")[1]!,
        ino: first.sourceRevision.split(":")[2]!,
      },
    });
    expect(second).toMatchObject({
      records: [{ id: 3 }],
      complete: true,
      status: "complete",
    });
  });

  it("keeps an original cut stable when later bytes are appended", async () => {
    const file = await createFile([{ id: 1 }, { id: 2 }]);
    const first = await readRecoverableJsonlPage<{ id: number }>(file, {
      limit: 1,
    });
    await writeFile(file, `${JSON.stringify({ id: 3 })}\n`, { flag: "a" });
    const parts = first.sourceRevision.split(":");

    const second = await readRecoverableJsonlPage<{ id: number }>(file, {
      limit: 2,
      offset: first.nextOffset,
      endOffset: Number(parts[3]),
      expectedIdentity: { dev: parts[1]!, ino: parts[2]! },
    });
    expect(second.records).toEqual([{ id: 2 }]);
    expect(second.complete).toBe(true);
  });

  it("reports malformed and unterminated records without quarantine writes", async () => {
    const root = await createRoot();
    const file = path.join(root, "events.jsonl");
    await writeFile(
      file,
      `${JSON.stringify({ id: 1 })}\n{"bad"\n{"truncated":true}`,
    );
    const page = await readRecoverableJsonlPage<{ id: number }>(file, {
      limit: 10,
    });

    expect(page).toMatchObject({
      records: [{ id: 1 }],
      complete: true,
      malformedLineCount: 2,
      status: "partial",
      reasonCode: "truncated_tail",
    });
    expect(await readFile(file, "utf8")).toContain('{"truncated":true}');
    expect(await import("node:fs/promises").then(({ readdir }) => readdir(root)))
      .toEqual(["events.jsonl"]);
  });

  it("rejects aliases, oversized records, source replacement, and abort", async () => {
    const file = await createFile([{ id: 1 }]);
    const alias = `${file}.alias`;
    await link(file, alias);
    await expect(readRecoverableJsonlPage(file, { limit: 1 }))
      .rejects.toThrow("single-link regular file");
    await rm(alias);

    await writeFile(file, `${"x".repeat(128)}\n`);
    await expect(readRecoverableJsonlPage(file, {
      limit: 1,
      maxRecordBytes: 32,
    })).resolves.toMatchObject({
      records: [],
      status: "incompatible",
      reasonCode: "oversized_record",
    });

    await expect(readRecoverableJsonlPage(file, {
      limit: 1,
      expectedIdentity: { dev: "0", ino: "0" },
    })).resolves.toMatchObject({
      status: "incompatible",
      reasonCode: "source_changed",
    });

    const controller = new AbortController();
    controller.abort(new DOMException("canceled", "AbortError"));
    await expect(readRecoverableJsonlPage(file, {
      limit: 1,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("stops at the page byte ceiling", async () => {
    const file = await createFile([
      { payload: "a".repeat(1_024) },
      { payload: "b".repeat(1_024) },
    ]);
    const page = await readRecoverableJsonlPage(file, {
      limit: 20,
      maxBytes: 1_100,
    });
    expect(page.records).toHaveLength(1);
    expect(page).toMatchObject({
      complete: false,
      status: "partial",
      reasonCode: "page_byte_limit",
    });
    expect(RECOVERABLE_JSONL_PAGE_MAX_BYTES).toBe(8 * 1024 * 1024);
  });
});

async function createRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "zerox-jsonl-page-"));
  roots.push(root);
  await mkdir(root, { recursive: true });
  return root;
}

async function createFile(records: unknown[]) {
  const root = await createRoot();
  const file = path.join(root, "events.jsonl");
  await writeFile(
    file,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );
  return file;
}
