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

  it("returns file metadata without using shell commands", async () => {
    const filePath = path.join(tempDir, "notes.md");
    await writeFile(filePath, "hello runner", "utf8");
    const executor = createAgentToolExecutor();

    await expect(
      executor.execute({
        toolName: "file_stat",
        args: { path: filePath },
      }),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        path: filePath,
        type: "file",
        size: 12,
      },
    });
  });

  it("searches filenames and small text files without falling back to shell", async () => {
    await mkdir(path.join(tempDir, "reports"));
    await writeFile(
      path.join(tempDir, "reports", "today.md"),
      "尾盘筛选报告\n候选：测试股份",
      "utf8",
    );
    await writeFile(path.join(tempDir, "notes.txt"), "普通笔记", "utf8");
    const executor = createAgentToolExecutor();

    await expect(
      executor.execute({
        toolName: "file_search",
        args: { root: tempDir, query: "候选", mode: "content", maxResults: 5 },
      }),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        root: tempDir,
        query: "候选",
        results: [
          {
            path: path.join(tempDir, "reports", "today.md"),
            type: "content",
            line: 2,
            preview: "候选：测试股份",
          },
        ],
      },
    });
  });

  it("registers native code engineering tools with descriptors", () => {
    const executor = createAgentToolExecutor();

    expect(
      executor.getRegistry().getNativeDescriptors().map((descriptor) => ({
        id: descriptor.id,
        kind: descriptor.kind,
        enabled: descriptor.enabled,
      })),
    ).toEqual(
      expect.arrayContaining([
        { id: "code_search", kind: "code", enabled: true },
        { id: "git_status", kind: "git", enabled: true },
        { id: "git_diff", kind: "git", enabled: true },
        { id: "test_run", kind: "test", enabled: true },
        { id: "web_fetch_document", kind: "web", enabled: true },
        { id: "citation_record", kind: "citation", enabled: true },
        { id: "citation_coverage_check", kind: "citation", enabled: true },
        { id: "markdown_report_write", kind: "report", enabled: true },
      ]),
    );
  });

  it("executes code_search through the native tool registry", async () => {
    await writeFile(
      path.join(tempDir, "agent.ts"),
      "export const agentRuntime = 'native-tool-registry';\n",
      "utf8",
    );
    const executor = createAgentToolExecutor();

    await expect(
      executor.execute({
        toolName: "code_search",
        args: {
          workspaceRoot: tempDir,
          query: "agentRuntime",
          maxResults: 5,
        },
      }),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        workspaceRoot: tempDir,
        query: "agentRuntime",
        results: [
          {
            relativePath: "agent.ts",
            line: 1,
            preview: "export const agentRuntime = 'native-tool-registry';",
          },
        ],
      },
    });
  });

  it("passes abort signals to native test_run", async () => {
    const executor = createAgentToolExecutor();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 25);

    const result = await executor.execute(
      {
        toolName: "test_run",
        args: {
          workspaceRoot: tempDir,
          command: `${JSON.stringify(process.execPath)} -e "setTimeout(() => {}, 1000)"`,
          timeoutMs: 1000,
        },
      },
      { signal: controller.signal },
    );

    expect(result).toMatchObject({
      ok: false,
      error: "test_run was canceled.",
      errorDetails: {
        kind: "canceled",
        cwd: tempDir,
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
    ).resolves.toMatchObject({
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

  it("returns structured diagnostics when a shell command fails without output", async () => {
    const executor = createAgentToolExecutor();
    const command = `${JSON.stringify(process.execPath)} -e "process.exit(1)"`;

    const result = await executor.execute({
      toolName: "shell_exec",
      args: { command },
    });

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("退出码 1"),
      errorDetails: {
        kind: "empty_exit",
        command,
        exitCode: 1,
        stdout: "",
        stderr: "",
      },
    });
  });

  it("supports bounded custom shell timeouts with actionable diagnostics", async () => {
    const executor = createAgentToolExecutor();
    const command = `${JSON.stringify(process.execPath)} -e "setTimeout(() => {}, 500)"`;

    const result = await executor.execute({
      toolName: "shell_exec",
      args: { command, timeoutMs: 25 },
    });

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("超时"),
      errorDetails: {
        kind: "timeout",
        command,
        timeoutMs: 25,
      },
    });
  });

  it("aborts running shell commands through the execution signal", async () => {
    const executor = createAgentToolExecutor();
    const controller = new AbortController();
    const command = `${JSON.stringify(process.execPath)} -e "setTimeout(() => {}, 1000)"`;
    setTimeout(() => controller.abort(), 25);

    const result = await executor.execute(
      {
        toolName: "shell_exec",
        args: { command, timeoutMs: 1000 },
      },
      {
        signal: controller.signal,
      },
    );

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("已中断"),
      errorDetails: {
        kind: "canceled",
        command,
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

  it("executes native research writing tools through the registry", async () => {
    const reportPath = path.join(tempDir, "research.md");
    const executor = createAgentToolExecutor({
      webTools: {
        async fetchPage(url) {
          return {
            ok: true,
            result: {
              url,
              title: "Harness Guide",
              text: "Harness tracks deterministic eval results.",
            },
          };
        },
        async search(query) {
          return { ok: true, result: { query, results: [] } };
        },
      },
    });

    await expect(
      executor.execute({
        toolName: "web_fetch_document",
        args: { url: "https://docs.example.com/guide" },
      }),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        document: {
          url: "https://docs.example.com/guide",
          title: "Harness Guide",
        },
      },
    });

    await expect(
      executor.execute({
        toolName: "citation_coverage_check",
        args: {
          citations: [
            {
              id: "src_docs",
              url: "https://docs.example.com/guide",
              title: "Harness Guide",
            },
          ],
          claims: [
            {
              id: "fact_1",
              kind: "sourced_fact",
              text: "Harness tracks deterministic eval results.",
              citationIds: ["src_docs"],
            },
          ],
        },
      }),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        coverage: { ok: true },
      },
    });

    await expect(
      executor.execute({
        toolName: "markdown_report_write",
        args: {
          path: reportPath,
          title: "Agent Capability Research",
          citations: [
            {
              id: "src_docs",
              url: "https://docs.example.com/guide",
              title: "Harness Guide",
            },
          ],
          claims: [
            {
              id: "fact_1",
              kind: "sourced_fact",
              text: "Harness tracks deterministic eval results.",
              citationIds: ["src_docs"],
            },
          ],
          sections: [{ heading: "Findings", claimIds: ["fact_1"] }],
        },
      }),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        path: reportPath,
        citationsPath: path.join(tempDir, "research.citations.json"),
      },
    });
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
      { query: "downloads", kind: "all", limit: 2, strategy: "hybrid" },
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
