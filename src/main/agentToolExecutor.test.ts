import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentToolExecutor } from "./agentToolExecutor";

describe("agent tool executor", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "building-agent-tools-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("reads a local text file", async () => {
    const filePath = path.join(tempDir, "notes.md");
    await writeFile(filePath, "hello runner", "utf8");
    const executor = createAgentToolExecutor();

    await expect(
      executor.execute({
        toolName: "file_read",
        args: { path: filePath },
      }),
    ).resolves.toEqual({
      ok: true,
      result: {
        path: filePath,
        content: "hello runner",
      },
    });
  });

  it("lists a local directory without reading file contents", async () => {
    await writeFile(path.join(tempDir, "notes.md"), "hello runner", "utf8");
    await mkdir(path.join(tempDir, "screenshots"));
    const executor = createAgentToolExecutor();

    const result = await executor.execute({
      toolName: "file_list",
      args: { path: tempDir },
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        path: tempDir,
        entries: [
          {
            name: "notes.md",
            type: "file",
            size: 12,
          },
          {
            name: "screenshots",
            type: "directory",
          },
        ],
      },
    });
  });

  it("writes a local text file and creates parent directories", async () => {
    const filePath = path.join(tempDir, "reports", "today.md");
    const executor = createAgentToolExecutor();

    await expect(
      executor.execute({
        toolName: "file_write",
        args: { path: filePath, content: "done" },
      }),
    ).resolves.toEqual({
      ok: true,
      result: {
        path: filePath,
        bytesWritten: 4,
      },
    });
    await expect(readFile(filePath, "utf8")).resolves.toBe("done");
  });

  it("executes an approved shell command with stdout and exit code", async () => {
    const executor = createAgentToolExecutor();

    await expect(
      executor.execute({
        toolName: "shell_exec",
        args: { command: "printf runner" },
      }),
    ).resolves.toEqual({
      ok: true,
      result: {
        command: "printf runner",
        stdout: "runner",
        stderr: "",
        exitCode: 0,
      },
    });
  });

  it("delegates web_fetch and web_search to web tools", async () => {
    const calls: string[] = [];
    const executor = createAgentToolExecutor({
      webTools: {
        async fetchPage(url) {
          calls.push(`fetch:${url}`);
          return {
            ok: true,
            result: { url, title: "Example", text: "Readable page" },
          };
        },
        async search(query) {
          calls.push(`search:${query}`);
          return {
            ok: true,
            result: { query, results: [] },
          };
        },
      },
    });

    await expect(
      executor.execute({
        toolName: "web_fetch",
        args: { url: "https://example.com" },
      }),
    ).resolves.toEqual({
      ok: true,
      result: {
        url: "https://example.com",
        title: "Example",
        text: "Readable page",
      },
    });
    await expect(
      executor.execute({
        toolName: "web_search",
        args: { query: "agent memory" },
      }),
    ).resolves.toEqual({
      ok: true,
      result: { query: "agent memory", results: [] },
    });
    expect(calls).toEqual([
      "fetch:https://example.com",
      "search:agent memory",
    ]);
  });
});
