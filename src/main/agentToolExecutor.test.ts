import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentToolExecutor, getShellExecShell } from "./agentToolExecutor";
import { createDynamicToolRegistry } from "./dynamicToolRegistry";
import { buildPrimaryRunContext } from "../shared/agentWorkspace";
import { getArtifactProvenancePath } from "../shared/agentArtifactProvenance";
import type { MemoryRecord } from "../shared/memory";
import type { SkillDiscoveryResult } from "../shared/skills";

describe("agent tool executor", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "building-agent-tools-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("aborts underlying non-shell work when its timeout expires", async () => {
    const registry = createDynamicToolRegistry();
    let observedAbort = false;
    registry.register(
      {
        type: "function",
        function: {
          name: "slow_fixture",
          description: "Slow fixture",
          parameters: { type: "object", properties: {} },
        },
      },
      async (_args, options) =>
        new Promise((resolve) => {
          options?.signal?.addEventListener(
            "abort",
            () => {
              observedAbort = true;
              resolve({ ok: false, error: "aborted" });
            },
            { once: true },
          );
        }),
      "test",
    );
    const executor = createAgentToolExecutor({ registry, toolTimeoutMs: 10 });

    await expect(
      executor.execute({ toolName: "slow_fixture", args: {} }),
    ).rejects.toThrow("slow_fixture timed out after 10ms");
    expect(observedAbort).toBe(true);
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

  it("reads offloaded tool-result refs without using file_read", async () => {
    const executor = createAgentToolExecutor({
      toolResultOffloadStore: {
        async read(ref) {
          return ref === "tool-result-refs/run_call_file_list_ref.json"
            ? '{"type":"tool_result","tool":"file_list","ok":true,"result":{"entries":[{"name":"src","type":"directory"}]}}'
            : null;
        },
      },
    });

    await expect(
      executor.execute({
        toolName: "tool_result_read",
        args: { ref: "tool-result-refs/run_call_file_list_ref.json" },
      }),
    ).resolves.toEqual({
      ok: true,
      result: {
        ref: "tool-result-refs/run_call_file_list_ref.json",
        content:
          '{"type":"tool_result","tool":"file_list","ok":true,"result":{"entries":[{"name":"src","type":"directory"}]}}',
      },
    });
  });

  it("routes legacy file_read calls for safe tool-result refs to the offload store", async () => {
    const executor = createAgentToolExecutor({
      toolResultOffloadStore: {
        async read(ref) {
          return ref === "tool-result-refs/run_call_file_list_ref.json"
            ? '{"type":"tool_result","tool":"file_list","ok":true,"result":{"entries":[]}}'
            : null;
        },
      },
    });

    await expect(
      executor.execute({
        toolName: "file_read",
        args: { path: "tool-result-refs/run_call_file_list_ref.json" },
      }),
    ).resolves.toEqual({
      ok: true,
      result: {
        ref: "tool-result-refs/run_call_file_list_ref.json",
        content:
          '{"type":"tool_result","tool":"file_list","ok":true,"result":{"entries":[]}}',
      },
    });
  });

  it("searches and expands raw history through native history tools", async () => {
    const searchRequests: unknown[] = [];
    const aroundRequests: unknown[] = [];
    const executor = createAgentToolExecutor({
      historyIndexStore: {
        async search(options) {
          searchRequests.push(options);
          return [
            {
              entry: {
                id: "history_1",
                sessionId: "session_1",
                workspaceId: "workspace_1",
                role: "tool",
                toolName: "skill_load",
                content: "Loaded onepager instructions",
                createdAt: "2026-06-25T00:00:00.000Z",
                source: "tool",
              },
              score: 2,
              matchedTerms: ["skill_load", "onepager"],
            },
          ];
        },
        async around(options) {
          aroundRequests.push(options);
          return {
            anchor: {
              id: "history_1",
              sessionId: "session_1",
              workspaceId: "workspace_1",
              role: "tool",
              toolName: "skill_load",
              content: "Loaded onepager instructions",
              createdAt: "2026-06-25T00:00:00.000Z",
              source: "tool",
            },
            entries: [
              {
                id: "history_0",
                sessionId: "session_1",
                role: "user",
                content: "Use onepager.",
                createdAt: "2026-06-24T23:59:59.000Z",
                source: "chat",
              },
            ],
          };
        },
      },
    });

    await expect(
      executor.execute({
        toolName: "history_search",
        args: {
          query: "skill_load onepager",
          workspaceId: "workspace_escape",
          sessionId: "session_escape",
        },
      }, {
        runContext: {
          runId: "run_1",
          workspaceId: "workspace_1",
          workspaceRoot: "/tmp/workspace-1",
          agentRole: "primary",
          depth: 0,
          sandbox: {
            mode: "read_write",
            network: "enabled",
            shell: "enabled",
            allowWorkspaceEscape: false,
            extraReadRoots: [],
            extraWriteRoots: [],
          },
          sessionId: "session_1",
        },
      }),
    ).resolves.toEqual({
      ok: true,
      result: {
        query: "skill_load onepager",
        results: [
          {
            id: "history_1",
            sessionId: "session_1",
            workspaceId: "workspace_1",
            role: "tool",
            toolName: "skill_load",
            content: "Loaded onepager instructions",
            createdAt: "2026-06-25T00:00:00.000Z",
            score: 2,
            matchedTerms: ["skill_load", "onepager"],
          },
        ],
      },
    });
    await expect(
      executor.execute({
        toolName: "history_around",
        args: { entryId: "history_1", before: 1, after: 1 },
      }, {
        runContext: {
          runId: "run_1",
          workspaceId: "workspace_1",
          workspaceRoot: "/tmp/workspace-1",
          agentRole: "primary",
          depth: 0,
          sandbox: {
            mode: "read_write",
            network: "enabled",
            shell: "enabled",
            allowWorkspaceEscape: false,
            extraReadRoots: [],
            extraWriteRoots: [],
          },
          sessionId: "session_1",
        },
      }),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        anchor: { id: "history_1" },
        entries: [expect.objectContaining({ id: "history_0" })],
      },
    });
    expect(searchRequests).toEqual([
      expect.objectContaining({
        query: "skill_load onepager",
        workspaceId: "workspace_1",
        sessionId: "session_1",
      }),
    ]);
    expect(aroundRequests).toEqual([
      expect.objectContaining({
        entryId: "history_1",
        workspaceId: "workspace_1",
        sessionId: "session_1",
      }),
    ]);
  });

  it("rejects unsafe offloaded tool-result refs", async () => {
    const executor = createAgentToolExecutor({
      toolResultOffloadStore: {
        async read() {
          throw new Error("unsafe ref should not reach store");
        },
      },
    });

    await expect(
      executor.execute({
        toolName: "tool_result_read",
        args: { ref: "../chat-sessions.json" },
      }),
    ).resolves.toEqual({
      ok: false,
      error: "tool_result_read requires a safe tool-result ref.",
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

  it("registers skill lazy-load tools when a skill discovery source is provided", async () => {
    const skillRoot = path.join(tempDir, "skills", "onepager");
    await mkdir(skillRoot, { recursive: true });
    const skillFile = path.join(skillRoot, "SKILL.md");
    await writeFile(
      skillFile,
      [
        "---",
        "name: onepager",
        "description: Build a one-page artifact.",
        "execution:",
        "  mode: agent",
        "permissions:",
        "  files:",
        "    read: []",
        "    write: []",
        "  shell:",
        "    commands: []",
        "  web:",
        "    search: false",
        "    fetchDomains: []",
        "  memory:",
        "    read: true",
        "    write: false",
        "---",
        "Use the onepager steps.",
      ].join("\n"),
      "utf8",
    );
    const discovery: SkillDiscoveryResult = {
      skills: [
        {
          manifest: {
            name: "onepager",
            displayName: "onepager",
            description: "Build a one-page artifact.",
            version: "0.1.0",
            execution: { mode: "agent", entrypoint: null },
            inputs: [],
            permissions: {
              files: { read: [], write: [] },
              shell: { commands: [] },
              web: { search: false, fetchDomains: [] },
              memory: { read: true, write: false },
            },
          },
          body: "Use the onepager steps.",
          rootDir: skillRoot,
          skillFile,
        },
      ],
      errors: [],
    };
    const executor = createAgentToolExecutor({
      discoverSkills: async () => discovery,
    });

    expect(executor.hasTool("skill_load")).toBe(true);
    await expect(
      executor.execute({
        toolName: "skill_load",
        args: { skillName: "onepager" },
      }),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        skillName: "onepager",
        instruction: "Use the onepager steps.",
      },
    });
  });

  it("previews, applies, verifies, and rolls back file organization with native tools", async () => {
    await writeFile(path.join(tempDir, "photo.jpg"), "image", "utf8");
    await writeFile(path.join(tempDir, "invoice.pdf"), "pdf", "utf8");
    const executor = createAgentToolExecutor();

    await expect(
      executor.execute({
        toolName: "file_inventory",
        args: { path: tempDir },
      }),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        root: tempDir,
        entries: expect.arrayContaining([
          expect.objectContaining({ name: "invoice.pdf", type: "file" }),
          expect.objectContaining({ name: "photo.jpg", type: "file" }),
        ]),
      },
    });

    const previewResult = await executor.execute({
      toolName: "file_move_plan",
      args: { targetDir: tempDir },
    });
    expect(previewResult).toMatchObject({
      ok: true,
      result: {
        preview: {
          root: tempDir,
          moves: expect.arrayContaining([
            expect.objectContaining({
              to: path.join(tempDir, "Documents", "invoice.pdf"),
            }),
            expect.objectContaining({
              to: path.join(tempDir, "Images", "photo.jpg"),
            }),
          ]),
        },
      },
    });
    if (!previewResult.ok) {
      throw new Error(previewResult.error);
    }

    const applyResult = await executor.execute({
      toolName: "file_apply_moves",
      args: { preview: previewResult.result.preview },
    });
    expect(applyResult).toMatchObject({
      ok: true,
      result: {
        transaction: {
          status: "applied",
          movesApplied: 2,
        },
      },
    });
    if (!applyResult.ok) {
      throw new Error(applyResult.error);
    }

    await expect(
      readFile(path.join(tempDir, "Images", "photo.jpg"), "utf8"),
    ).resolves.toBe("image");
    await expect(
      executor.execute({
        toolName: "file_verify_moves",
        args: { transaction: applyResult.result.transaction },
      }),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        verified: true,
        checked: 2,
      },
    });

    await expect(
      executor.execute({
        toolName: "file_rollback_moves",
        args: { transaction: applyResult.result.transaction },
      }),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        transaction: {
          status: "rolled_back",
          movesRolledBack: 2,
        },
      },
    });
    await expect(readFile(path.join(tempDir, "photo.jpg"), "utf8")).resolves.toBe(
      "image",
    );
  });

  it("reads Chrome bookmarks through a native structured tool", async () => {
    const bookmarksPath = path.join(tempDir, "Chrome", "Default", "Bookmarks");
    await mkdir(path.dirname(bookmarksPath), { recursive: true });
    await writeFile(
      bookmarksPath,
      JSON.stringify({
        roots: {
          bookmark_bar: {
            type: "folder",
            name: "Bookmarks Bar",
            children: [
              {
                type: "url",
                name: "OpenAI",
                url: "https://openai.com/",
                date_added: "13345678900000000",
              },
              {
                type: "folder",
                name: "Docs",
                children: [
                  {
                    type: "url",
                    name: "Zerox Docs",
                    url: "https://docs.example.com/zerox",
                  },
                ],
              },
            ],
          },
          other: {
            type: "folder",
            name: "Other Bookmarks",
            children: [],
          },
        },
      }),
      "utf8",
    );
    const executor = createAgentToolExecutor();

    await expect(
      executor.execute({
        toolName: "chrome_bookmarks_read",
        args: { bookmarksPath },
      }),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        browser: "Google Chrome",
        profileCount: 1,
        bookmarkCount: 2,
        folderCount: 1,
        profiles: [
          {
            profileName: "Default",
            bookmarksPath,
            bookmarkCount: 2,
            folderCount: 1,
          },
        ],
        bookmarks: [
          {
            profileName: "Default",
            title: "OpenAI",
            url: "https://openai.com/",
            folderPath: ["书签栏"],
          },
          {
            profileName: "Default",
            title: "Zerox Docs",
            url: "https://docs.example.com/zerox",
            folderPath: ["书签栏", "Docs"],
          },
        ],
        markdown: expect.stringContaining("OpenAI"),
      },
    });
  });

  it("caps Chrome bookmark detail rows and writes the complete artifact", async () => {
    const bookmarksPath = path.join(tempDir, "Chrome", "Default", "Bookmarks");
    const outputRoot = path.join(tempDir, "goal-output");
    await mkdir(path.dirname(bookmarksPath), { recursive: true });
    await writeFile(
      bookmarksPath,
      JSON.stringify({
        roots: {
          bookmark_bar: {
            type: "folder",
            name: "Bookmarks Bar",
            children: Array.from({ length: 100 }, (_, index) => ({
              type: "url",
              name: `Bookmark ${index + 1}`,
              url: `https://example.com/${index + 1}`,
            })),
          },
        },
      }),
      "utf8",
    );
    const executor = createAgentToolExecutor();

    const result = await executor.execute({
      toolName: "chrome_bookmarks_read",
      args: { bookmarksPath, maxBookmarks: 10000 },
    }, {
      runContext: buildPrimaryRunContext({
        workspaceId: "workspace_chrome",
        workspaceRoot: tempDir,
        runId: "goal_run_1",
        goalId: "goal_1",
        milestoneId: "milestone_1",
        sandbox: {
          mode: "workspace_write",
          network: "task_policy",
          shell: "approved_commands",
          allowWorkspaceEscape: false,
          extraReadRoots: [],
          extraWriteRoots: [outputRoot],
        },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        bookmarkCount: 100,
        returnedBookmarkCount: 25,
        requestedMaxBookmarks: 10000,
        returnedBookmarkLimit: 25,
        truncated: true,
        artifactRef: "artifact:bookmark_list",
        artifactPath: path.join(outputRoot, "bookmark_list.md"),
        provenanceRef: "provenance:bookmark_list",
        provenancePath: getArtifactProvenancePath(path.join(outputRoot, "bookmark_list.md")),
        goalEvidenceRef: "artifact:goalEvidence",
        goalEvidencePath: path.join(outputRoot, "goalEvidence.md"),
        goalEvidenceProvenanceRef: "provenance:goalEvidence",
        goalEvidenceProvenancePath: getArtifactProvenancePath(path.join(outputRoot, "goalEvidence.md")),
        evidenceRefs: [
          "artifact:bookmark_list",
          "provenance:bookmark_list",
          "artifact:goalEvidence",
          "provenance:goalEvidence",
        ],
        answerPreview: expect.stringContaining("共找到 100 个书签，返回 25 个。"),
      },
    });
    await expect(
      readFile(path.join(outputRoot, "bookmark_list.md"), "utf8"),
    ).resolves.toContain("Bookmark 100 - https://example.com/100");
    await expect(
      readFile(path.join(outputRoot, "goalEvidence.md"), "utf8"),
    ).resolves.toContain("Total bookmarks: 100");
    await expect(
      readFile(getArtifactProvenancePath(path.join(outputRoot, "bookmark_list.md")), "utf8"),
    ).resolves.toContain("\"artifactRef\": \"artifact:bookmark_list\"");
    await expect(
      readFile(getArtifactProvenancePath(path.join(outputRoot, "goalEvidence.md")), "utf8"),
    ).resolves.toContain("\"artifactRef\": \"artifact:goalEvidence\"");
  });

  it("refuses to write Chrome bookmark provenance without a real run identity", async () => {
    const bookmarksPath = path.join(tempDir, "Chrome", "Default", "Bookmarks");
    const outputRoot = path.join(tempDir, "goal-output");
    await mkdir(path.dirname(bookmarksPath), { recursive: true });
    await writeFile(
      bookmarksPath,
      JSON.stringify({
        roots: {
          bookmark_bar: {
            type: "folder",
            name: "Bookmarks Bar",
            children: [{ type: "url", name: "OpenAI", url: "https://openai.com/" }],
          },
        },
      }),
      "utf8",
    );
    const executor = createAgentToolExecutor();

    await expect(
      executor.execute(
        {
          toolName: "chrome_bookmarks_read",
          args: { bookmarksPath },
        },
        {
          runContext: buildPrimaryRunContext({
            workspaceId: "workspace_chrome",
            workspaceRoot: tempDir,
            sandbox: {
              mode: "workspace_write",
              network: "task_policy",
              shell: "approved_commands",
              allowWorkspaceEscape: false,
              extraReadRoots: [],
              extraWriteRoots: [outputRoot],
            },
          }),
        },
      ),
    ).resolves.toEqual({
      ok: false,
      error: "chrome_bookmarks_read requires runId in runContext to write provenance.",
    });
  });

  it("does not follow symlink artifact paths when writing Chrome bookmark artifacts", async () => {
    const bookmarksPath = path.join(tempDir, "Chrome", "Default", "Bookmarks");
    const outputRoot = path.join(tempDir, "goal-output");
    const outsideRoot = path.join(tempDir, "outside");
    const outsideSecret = path.join(outsideRoot, "secret.md");
    await mkdir(path.dirname(bookmarksPath), { recursive: true });
    await mkdir(outputRoot, { recursive: true });
    await mkdir(outsideRoot, { recursive: true });
    await writeFile(outsideSecret, "do not overwrite", "utf8");
    await symlink(outsideSecret, path.join(outputRoot, "bookmark_list.md"));
    await writeFile(
      bookmarksPath,
      JSON.stringify({
        roots: {
          bookmark_bar: {
            type: "folder",
            name: "Bookmarks Bar",
            children: [{ type: "url", name: "OpenAI", url: "https://openai.com/" }],
          },
        },
      }),
      "utf8",
    );
    const executor = createAgentToolExecutor();

    await expect(
      executor.execute(
        {
          toolName: "chrome_bookmarks_read",
          args: { bookmarksPath },
        },
        {
          runContext: buildPrimaryRunContext({
            workspaceId: "workspace_chrome",
            workspaceRoot: tempDir,
            runId: "goal_run_1",
            goalId: "goal_1",
            milestoneId: "milestone_1",
            sandbox: {
              mode: "workspace_write",
              network: "task_policy",
              shell: "approved_commands",
              allowWorkspaceEscape: false,
              extraReadRoots: [],
              extraWriteRoots: [outputRoot],
            },
          }),
        },
      ),
    ).resolves.toEqual({
      ok: false,
      error: "chrome_bookmarks_read refuses to overwrite symlink artifact paths.",
    });
    await expect(readFile(outsideSecret, "utf8")).resolves.toBe("do not overwrite");
  });

  it("does not follow symlink output roots when writing Chrome bookmark artifacts", async () => {
    const bookmarksPath = path.join(tempDir, "Chrome", "Default", "Bookmarks");
    const apparentRoot = path.join(tempDir, "goal-output-link");
    const outsideRoot = path.join(tempDir, "outside-output");
    await mkdir(path.dirname(bookmarksPath), { recursive: true });
    await mkdir(outsideRoot, { recursive: true });
    await symlink(outsideRoot, apparentRoot);
    await writeFile(
      bookmarksPath,
      JSON.stringify({
        roots: {
          bookmark_bar: {
            type: "folder",
            name: "Bookmarks Bar",
            children: [{ type: "url", name: "OpenAI", url: "https://openai.com/" }],
          },
        },
      }),
      "utf8",
    );
    const executor = createAgentToolExecutor();

    await expect(
      executor.execute(
        {
          toolName: "chrome_bookmarks_read",
          args: { bookmarksPath },
        },
        {
          runContext: buildPrimaryRunContext({
            workspaceId: "workspace_chrome",
            workspaceRoot: tempDir,
            runId: "goal_run_1",
            goalId: "goal_1",
            milestoneId: "milestone_1",
            sandbox: {
              mode: "workspace_write",
              network: "task_policy",
              shell: "approved_commands",
              allowWorkspaceEscape: false,
              extraReadRoots: [],
              extraWriteRoots: [apparentRoot],
            },
          }),
        },
      ),
    ).resolves.toEqual({
      ok: false,
      error: "chrome_bookmarks_read refuses to write artifacts through symlinked output roots.",
    });
    await expect(readFile(path.join(outsideRoot, "bookmark_list.md"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("writes Chrome bookmark artifacts under canonical home Desktop output roots", async () => {
    const bookmarksPath = path.join(tempDir, "Chrome", "Default", "Bookmarks");
    const homePath = path.join(tempDir, "home");
    const realDesktop = path.join(homePath, "Desktop");
    await mkdir(path.dirname(bookmarksPath), { recursive: true });
    await writeFile(
      bookmarksPath,
      JSON.stringify({
        roots: {
          bookmark_bar: {
            type: "folder",
            name: "Bookmarks Bar",
            children: [
              {
                type: "url",
                name: "OpenAI",
                url: "https://openai.com/",
              },
            ],
          },
        },
      }),
      "utf8",
    );
    const executor = createAgentToolExecutor();

    const result = await executor.execute(
      {
        toolName: "chrome_bookmarks_read",
        args: { bookmarksPath },
      },
      {
        runContext: buildPrimaryRunContext({
          workspaceId: "workspace_chrome",
          workspaceRoot: tempDir,
          runId: "goal_run_1",
          goalId: "goal_1",
          milestoneId: "milestone_1",
          locationEnv: { homeDir: homePath, platform: "darwin" },
          sandbox: {
            mode: "workspace_write",
            network: "task_policy",
            shell: "approved_commands",
            allowWorkspaceEscape: false,
            extraReadRoots: [],
            extraWriteRoots: ["~/Desktop"],
          },
        }),
      },
    );

    expect(result).toMatchObject({
      ok: true,
      result: {
        artifactPath: path.join(realDesktop, "bookmark_list.md"),
        goalEvidencePath: path.join(realDesktop, "goalEvidence.md"),
      },
    });
    await expect(
      readFile(path.join(realDesktop, "bookmark_list.md"), "utf8"),
    ).resolves.toContain("OpenAI - https://openai.com/");
    await expect(readFile(path.join(tempDir, "~", "Desktop", "bookmark_list.md"))).rejects.toMatchObject({
      code: "ENOENT",
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
        { id: "file_inventory", kind: "file", enabled: true },
        { id: "file_move_plan", kind: "file", enabled: true },
        { id: "file_apply_moves", kind: "file", enabled: true },
        { id: "file_verify_moves", kind: "file", enabled: true },
        { id: "file_rollback_moves", kind: "file", enabled: true },
        { id: "chrome_bookmarks_read", kind: "browser", enabled: true },
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

  it("defaults native workspace tools to the run context workspace root", async () => {
    await writeFile(
      path.join(tempDir, "agent.ts"),
      "export const workspaceContext = 'native-tool-registry';\n",
      "utf8",
    );
    const executor = createAgentToolExecutor();
    const definitions = executor.getRegistry().getDefinitions();
    const codeSearch = definitions.find(
      (definition) => definition.function.name === "code_search",
    );
    const gitStatus = definitions.find(
      (definition) => definition.function.name === "git_status",
    );
    const gitDiff = definitions.find(
      (definition) => definition.function.name === "git_diff",
    );
    const testRun = definitions.find(
      (definition) => definition.function.name === "test_run",
    );

    expect(codeSearch?.function.parameters.required).toEqual(["query"]);
    expect(gitStatus?.function.parameters.required).toBeUndefined();
    expect(gitDiff?.function.parameters.required).toBeUndefined();
    expect(testRun?.function.parameters.required).toEqual(["command"]);

    await expect(
      executor.execute(
        {
          toolName: "code_search",
          args: {
            query: "workspaceContext",
            maxResults: 5,
          },
        },
        {
          runContext: buildPrimaryRunContext({
            workspaceId: "workspace_temp",
            workspaceRoot: tempDir,
          }),
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        workspaceRoot: tempDir,
        query: "workspaceContext",
        results: [
          {
            relativePath: "agent.ts",
            line: 1,
          },
        ],
      },
    });
  });

  it("refuses run-context file and native workspace tools through symlink escapes", async () => {
    const workspaceRoot = path.join(tempDir, "workspace");
    const outsideRoot = path.join(tempDir, "outside");
    const linkPath = path.join(workspaceRoot, "linked-outside");
    await mkdir(workspaceRoot, { recursive: true });
    await mkdir(outsideRoot, { recursive: true });
    await writeFile(path.join(outsideRoot, "secret.md"), "secret token", "utf8");
    await symlink(outsideRoot, linkPath);
    const executor = createAgentToolExecutor();
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_temp",
      workspaceRoot,
    });

    const requests = [
      { toolName: "file_read", args: { path: path.join(linkPath, "secret.md") } },
      { toolName: "file_write", args: { path: path.join(linkPath, "report.md"), content: "done" } },
      { toolName: "file_stat", args: { path: path.join(linkPath, "secret.md") } },
      { toolName: "file_list", args: { path: linkPath } },
      { toolName: "file_search", args: { root: linkPath, query: "secret" } },
      { toolName: "code_search", args: { workspaceRoot: linkPath, query: "secret" } },
      {
        toolName: "markdown_report_write",
        args: {
          path: path.join(linkPath, "research.md"),
          title: "Escaped Report",
          citations: [],
          claims: [],
          sections: [],
        },
      },
    ];

    for (const request of requests) {
      await expect(
        executor.execute(request, { runContext }),
      ).resolves.toMatchObject({ ok: false });
    }
    await expect(readFile(path.join(outsideRoot, "report.md"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(path.join(outsideRoot, "research.md"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
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

  it("does not mint provenance from model-visible file_write artifact args", async () => {
    const filePath = path.join(tempDir, "reports", "spoofed.md");
    const executor = createAgentToolExecutor();
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: tempDir,
      runId: "goal_run_1",
      goalId: "goal_1",
      milestoneId: "milestone_1",
      sandbox: {
        mode: "workspace_write",
        network: "task_policy",
        shell: "approved_commands",
        allowWorkspaceEscape: false,
        extraReadRoots: [],
        extraWriteRoots: [path.join(tempDir, "reports")],
      },
    });

    const result = await executor.execute(
      {
        toolName: "file_write",
        args: {
          path: filePath,
          content: "# Spoofed\n",
          artifactId: "bookmark_list",
          artifactRef: "artifact:bookmark_list",
          source: { type: "chrome_bookmarks" },
        },
      },
      { runContext },
    );

    expect(result).toEqual({
      ok: true,
      result: {
        path: filePath,
        bytesWritten: Buffer.byteLength("# Spoofed\n"),
      },
    });
    await expect(
      readFile(getArtifactProvenancePath(filePath), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes provenance for internally authorized deterministic artifact file writes", async () => {
    const filePath = path.join(tempDir, "reports", "local_fixture.md");
    const executor = createAgentToolExecutor();
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: tempDir,
      runId: "goal_run_1",
      goalId: "goal_1",
      milestoneId: "milestone_1",
      sandbox: {
        mode: "workspace_write",
        network: "task_policy",
        shell: "approved_commands",
        allowWorkspaceEscape: false,
        extraReadRoots: [],
        extraWriteRoots: [path.join(tempDir, "reports")],
      },
    });

    const result = await executor.execute(
      {
        toolName: "file_write",
        args: {
          path: filePath,
          content: "# Local Fixture\n",
        },
      },
      {
        runContext,
        artifactWrite: {
          artifactId: "local_fixture",
          artifactRef: "artifact:local_fixture",
          source: {
            type: "json_file",
            path: path.join(tempDir, "input.json"),
          },
        },
      },
    );

    const provenancePath = getArtifactProvenancePath(filePath);
    expect(result).toMatchObject({
      ok: true,
      result: {
        path: filePath,
        artifactRef: "artifact:local_fixture",
        provenanceRef: "provenance:local_fixture",
        provenancePath,
      },
    });
    await expect(readFile(provenancePath, "utf8")).resolves.toContain(
      '"artifactId": "local_fixture"',
    );
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

  it("keeps macOS zsh behavior while using a portable shell on Linux CI", () => {
    expect(getShellExecShell("darwin", "/bin/bash")).toBe("/bin/zsh");
    expect(getShellExecShell("linux", "/bin/bash")).toBe("/bin/bash");
    expect(getShellExecShell("linux", "")).toBe("/bin/sh");
    expect(getShellExecShell("win32", "")).toBeUndefined();
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

  it("executes an opaque interpreter command only with an exact authorization proof", async () => {
    const executor = createAgentToolExecutor();
    const scriptPath = path.join(tempDir, "check.js");
    await writeFile(scriptPath, "console.log('help ok')", "utf8");
    const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)} --help`;
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: tempDir,
    });

    await expect(
      executor.execute(
        { toolName: "shell_exec", args: { command } },
        { runContext },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("opaque interpreter"),
    });

    await expect(
      executor.execute(
        { toolName: "shell_exec", args: { command } },
        { runContext, authorizedShellCommand: command },
      ),
    ).resolves.toMatchObject({
      ok: true,
      result: { stdout: "help ok\n", exitCode: 0 },
    });
  });

  it("blocks relative shell path escapes before executing from the run workspace", async () => {
    const workspaceRoot = path.join(tempDir, "workspace");
    const outsideRoot = path.join(tempDir, "outside");
    await mkdir(workspaceRoot);
    await mkdir(outsideRoot);
    await writeFile(path.join(outsideRoot, "secret.txt"), "outside secret", "utf8");

    const executor = createAgentToolExecutor();

    await expect(
      executor.execute(
        {
          toolName: "shell_exec",
          args: { command: "cat ../outside/secret.txt" },
        },
        {
          runContext: buildPrimaryRunContext({
            workspaceId: "workspace_1",
            workspaceRoot,
          }),
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("shell_exec refused path outside the run sandbox:"),
    });
  });

  it("enforces read-only and network-disabled shell sandboxes at execution time", async () => {
    const executor = createAgentToolExecutor();
    const base = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: tempDir,
    });

    await expect(
      executor.execute(
        { toolName: "shell_exec", args: { command: "rm ./report.md" } },
        { runContext: { ...base, sandbox: { ...base.sandbox, mode: "read_only" } } },
      ),
    ).resolves.toMatchObject({ ok: false, error: expect.stringContaining("read-only") });

    await expect(
      executor.execute(
        { toolName: "shell_exec", args: { command: "curl https://example.com" } },
        { runContext: { ...base, sandbox: { ...base.sandbox, network: "none" } } },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("network-disabled"),
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

  it("describes web_search as requiring absolute dates for date-sensitive queries", () => {
    const executor = createAgentToolExecutor();
    const definition = executor
      .getRegistry()
      .getDefinitions()
      .find((item) => item.function.name === "web_search");

    expect(definition?.function.description).toContain("日期敏感");
    expect(definition?.function.description).toContain("绝对日期");
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
