import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createToolResultOffloadStore,
  issueToolResultRefReadCapability,
} from "./toolResultOffloadStore";

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
    await expect(
      readFile(`${ref.absolutePath}.meta.json`, "utf8").then(JSON.parse),
    ).resolves.toMatchObject({
      schemaVersion: 1,
      bytesWritten: Buffer.byteLength(content, "utf8"),
      contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      runId: "run/123",
      toolCallId: "call:abc",
      toolName: "file_read",
    });
    await expect(readdir(path.dirname(ref.absolutePath))).resolves.not.toEqual(
      expect.arrayContaining([expect.stringMatching(/\.tmp$/)]),
    );
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

  it("denies forged cross-run capabilities but accepts issued internal grants", async () => {
    const configDir = await createTempConfigDir();
    const store = createToolResultOffloadStore({
      configDir,
      createId: () => "ref_scoped",
    });
    const ref = await store.write({
      runId: "run_a",
      sessionId: "session_a",
      requestId: "request_a",
      workspaceRunId: "workspace_run_a",
      toolCallId: "provider_call_1",
      toolName: "file_read",
      content: '{"ok":true}',
    });

    await expect(
      store.read(ref.relativePath, {
        runId: "run_a",
        sessionId: "session_a",
        requestId: "request_a",
        workspaceRunId: "workspace_run_a",
      }),
    ).resolves.toBe('{"ok":true}');
    await expect(
      store.read(ref.relativePath, {
        runId: "run_b",
        sessionId: "session_a",
        requestId: "request_a",
        workspaceRunId: "workspace_run_a",
      }),
    ).resolves.toBeNull();
    await expect(
      store.read(ref.relativePath, {
        runId: "run_b",
        sessionId: "session_other",
        capability: {
          kind: "tool_result_ref_read",
          ref: ref.relativePath,
          issuedByRunId: "run_a",
        },
      }),
    ).resolves.toBeNull();

    await expect(
      store.read(ref.relativePath, {
        runId: "run_b",
        sessionId: "session_other",
        capability: issueToolResultRefReadCapability({
          ref: ref.relativePath,
          issuedByRunId: "run_a",
        }),
      }),
    ).resolves.toBe('{"ok":true}');
  });

  it("fails closed for scoped reads when metadata is missing or damaged", async () => {
    const configDir = await createTempConfigDir();
    const store = createToolResultOffloadStore({
      configDir,
      createId: () => "ref_fail_closed",
    });
    const scope = {
      runId: "run_a",
      sessionId: "session_a",
    };
    const first = await store.write({
      ...scope,
      toolName: "file_read",
      content: '{"value":"first"}',
    });
    await rm(`${first.absolutePath}.meta.json`);

    await expect(store.read(first.relativePath, scope)).resolves.toBeNull();
    await expect(
      store.read(first.relativePath, {
        ...scope,
        capability: issueToolResultRefReadCapability({
          ref: first.relativePath,
          issuedByRunId: "run_a",
        }),
      }),
    ).resolves.toBeNull();

    const second = await store.write({
      ...scope,
      toolCallId: "second",
      toolName: "file_read",
      content: '{"value":"second"}',
    });
    await writeFile(`${second.absolutePath}.meta.json`, "{not-json", "utf8");
    await expect(store.read(second.relativePath, scope)).resolves.toBeNull();

    const third = await store.write({
      ...scope,
      toolCallId: "third",
      toolName: "file_read",
      content: '{"value":"third"}',
    });
    await writeFile(
      `${third.absolutePath}.meta.json`,
      JSON.stringify({ toolName: "file_read", runId: 42 }),
      "utf8",
    );
    await expect(store.read(third.relativePath, scope)).resolves.toBeNull();
  });

  it("rejects content that no longer matches its committed metadata", async () => {
    const configDir = await createTempConfigDir();
    const store = createToolResultOffloadStore({
      configDir,
      createId: () => "ref_hash",
    });
    const ref = await store.write({
      runId: "run_a",
      toolName: "file_read",
      content: '{"value":"original"}',
    });
    await writeFile(ref.absolutePath, '{"value":"replaced"}', "utf8");

    await expect(
      store.read(ref.relativePath, { runId: "run_a" }),
    ).resolves.toBeNull();
  });
});

async function createTempConfigDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "tool-result-offload-"));
  tempDirs.push(dir);
  return dir;
}
