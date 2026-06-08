import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createToolResultOffloadStore } from "./toolResultOffloadStore";

const tempDirs: string[] = [];

describe("tool result offload store", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("writes full serialized observations under a relative ref", async () => {
    const configDir = await createTempConfigDir();
    const store = createToolResultOffloadStore({
      configDir,
      createId: () => "ref/one",
    });
    const content =
      '{"type":"tool_result","tool":"file_read","ok":true,"result":{"content":"large"}}';

    const ref = await store.write({
      runId: "run/123",
      toolCallId: "call:abc",
      toolName: "file_read",
      content,
    });

    expect(ref.refId).toMatch(/run_123_call_abc_file_read_ref_one/);
    expect(ref.relativePath).toMatch(
      /^tool-result-refs\/run_123_call_abc_file_read_ref_one\.json$/,
    );
    expect(ref.absolutePath).toBe(path.join(configDir, ref.relativePath));
    expect(ref.bytesWritten).toBe(Buffer.byteLength(content, "utf8"));
    await expect(readFile(ref.absolutePath, "utf8")).resolves.toBe(content);
  });

  it("reads stored refs and returns null for invalid refs", async () => {
    const configDir = await createTempConfigDir();
    const store = createToolResultOffloadStore({
      configDir,
      createId: () => "ref_two",
    });
    const ref = await store.write({
      toolName: "file_list",
      content: '{"ok":true}',
    });

    await expect(store.read(ref.relativePath)).resolves.toBe('{"ok":true}');
    await expect(store.read("../secret.json")).resolves.toBeNull();
    await expect(store.read("tool-result-refs/missing.json")).resolves.toBeNull();
  });
});

async function createTempConfigDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "tool-result-offload-"));
  tempDirs.push(dir);
  return dir;
}
