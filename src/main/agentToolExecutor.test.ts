import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentToolExecutor } from "./agentToolExecutor";
import { buildPrimaryRunContext } from "../shared/agentWorkspace";
import type { MemoryRecord } from "../shared/memory";

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

  it("executes shell commands from the run workspace", async () => {
    const executor = createAgentToolExecutor();
    const resolvedTempDir = await realpath(tempDir);

    await expect(
      executor.execute(
        {
          toolName: "shell_exec",
          args: { command: "pwd" },
        },
        {
          runContext: buildPrimaryRunContext({
            workspaceId: "workspace_1",
            workspaceRoot: tempDir,
          }),
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        stdout: `${resolvedTempDir}\n`,
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

  it("searches long-term memory through a bounded memory_search tool", async () => {
    const searchOptions: unknown[] = [];
    const executor = createAgentToolExecutor({
      memoryStore: {
        async search(options) {
          searchOptions.push(options);
          return [
            {
              record: createMemoryRecord({
                id: "mem_downloads",
                kind: "semantic",
                title: "Downloads preference",
                content: "Reports should be saved as Markdown.",
              }),
              score: 7,
              matchedTerms: ["downloads"],
            },
          ];
        },
      },
    });

    await expect(
      executor.execute({
        toolName: "memory_search",
        args: { query: "downloads", kind: "all", limit: 2 },
      }),
    ).resolves.toEqual({
      ok: true,
      result: {
        query: "downloads",
        kind: "all",
        results: [
          {
            id: "mem_downloads",
            kind: "semantic",
            title: "Downloads preference",
            content: "Reports should be saved as Markdown.",
            score: 7,
            source: { type: "manual" },
          },
        ],
      },
    });
    expect(searchOptions).toEqual([
      { query: "downloads", kind: "all", limit: 2 },
    ]);
  });

  it("searches raw chat evidence through conversation_search", async () => {
    const searchOptions: unknown[] = [];
    const executor = createAgentToolExecutor({
      chatSessionStore: {
        async searchMessages(options) {
          searchOptions.push(options);
          return [
            {
              sessionId: "chat_1",
              sessionTitle: "Downloads cleanup",
              messageId: "msg_1",
              role: "assistant",
              content: "报告已保存为 Markdown。",
              createdAt: "2026-06-06T08:01:00.000Z",
              score: 4,
              matchedTerms: ["报告"],
            },
          ];
        },
      },
    });

    await expect(
      executor.execute({
        toolName: "conversation_search",
        args: { query: "报告", limit: 1 },
      }),
    ).resolves.toEqual({
      ok: true,
      result: {
        query: "报告",
        results: [
          {
            sessionId: "chat_1",
            sessionTitle: "Downloads cleanup",
            messageId: "msg_1",
            role: "assistant",
            content: "报告已保存为 Markdown。",
            createdAt: "2026-06-06T08:01:00.000Z",
            score: 4,
          },
        ],
      },
    });
    expect(searchOptions).toEqual([{ query: "报告", limit: 1 }]);
  });
});

function createMemoryRecord(
  partial: Pick<MemoryRecord, "id" | "kind" | "title" | "content">,
): MemoryRecord {
  return {
    ...partial,
    tags: [],
    source: { type: "manual" },
    importance: 3,
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt: "2026-06-08T00:00:00.000Z",
  };
}
