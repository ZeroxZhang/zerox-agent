import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  authorizeToolCallWithinRunContext,
  authorizeToolCall,
  createPermissionPolicyFromSkillManifest,
  getDefaultTaskPermissionPolicy,
  normalizeTaskPermissionPolicy,
  validateTaskPermissionPolicy,
  type TaskPermissionPolicy,
} from "./toolPermissions";
import { buildDefaultSandboxPolicy, buildPrimaryRunContext } from "./agentWorkspace";
import type { SkillManifest } from "./skills";
import { analyzeShell } from "../main/tools/shell/shellAnalyzer";

describe("task permission policy", () => {
  it("defaults to denying every tool capability", () => {
    expect(getDefaultTaskPermissionPolicy()).toEqual({
      files: { read: [], write: [] },
      web: { search: false, fetchDomains: [] },
      shell: { commands: [] },
      memory: { read: false, write: false },
    });
  });

  it("normalizes repeated paths, domains, and shell templates", () => {
    expect(
      normalizeTaskPermissionPolicy({
        files: {
          read: [" ~/Downloads ", "~/Downloads", ""],
          write: [" /tmp/reports/ "],
        },
        web: {
          search: true,
          fetchDomains: [" Example.com ", "https://Docs.Example.com/path"],
        },
        shell: {
          commands: [" ls {{targetDir}} ", ""],
        },
        memory: {
          read: true,
          write: false,
        },
      }),
    ).toEqual({
      files: { read: ["~/Downloads"], write: ["/tmp/reports"] },
      web: {
        search: true,
        fetchDomains: ["example.com", "docs.example.com"],
      },
      shell: { commands: ["ls {{targetDir}}"] },
      memory: { read: true, write: false },
    });
  });

  it("validates policy shape before saving it on a task", () => {
    expect(
      validateTaskPermissionPolicy({
        files: { read: ["relative/path"], write: [] },
        web: { search: false, fetchDomains: ["bad domain"] },
        shell: { commands: ["rm -rf {{path}}"] },
      }).errors,
    ).toEqual({
      files: "文件权限必须是绝对路径、用户主目录路径，或技能占位符。",
      web: "网页抓取域名必须是有效主机名。",
      shell: "命令行模板不能包含破坏性命令。",
    });
  });

  it("can seed a task policy from a skill manifest", () => {
    const manifest: SkillManifest = {
      name: "local-file-organizer",
      displayName: "Local File Organizer",
      description: "Organizes files.",
      version: "0.1.0",
      execution: { mode: "agent", entrypoint: null },
      inputs: [],
      permissions: {
        files: {
          read: ["{{targetDir}}"],
          write: ["{{targetDir}}"],
        },
        shell: { commands: [] },
        web: { search: false, fetchDomains: [] },
        memory: { read: true, write: true },
      },
      tools: [
        {
          name: "organize_preview",
          description: "Preview file organization.",
          parameters: { type: "object", properties: {} },
          entrypoint: "./tools/preview.js",
        },
      ],
      mcpServers: [
        {
          name: "filesystem-index",
          transport: "stdio",
          command: "node",
          args: ["./mcp/filesystem-index.js"],
        },
      ],
    };

    expect(createPermissionPolicyFromSkillManifest(manifest)).toEqual({
      files: { read: ["{{targetDir}}"], write: ["{{targetDir}}"] },
      web: { search: false, fetchDomains: [] },
      shell: { commands: [] },
      memory: { read: true, write: true },
      tools: {
        allowedNames: ["organize_preview"],
        allowedSkillNames: ["local-file-organizer"],
        allowedSources: [
          "skill:local-file-organizer",
          "mcp:local-file-organizer:filesystem-index",
        ],
      },
    });
  });
});

describe("tool authorization", () => {
  const policy: TaskPermissionPolicy = {
    files: {
      read: ["/Users/demo/Downloads"],
      write: ["/Users/demo/Downloads/reports"],
    },
    web: {
      search: true,
      fetchDomains: ["example.com"],
    },
    shell: {
      commands: ["find {{targetDir}} -maxdepth 1 -type f"],
    },
    memory: {
      read: true,
      write: false,
    },
  };

  it("allows file reads only inside approved read directories", () => {
    expect(
      authorizeToolCall(policy, {
        toolName: "file_read",
        args: { path: "/Users/demo/Downloads/notes.md" },
      }),
    ).toMatchObject({ allowed: true });

    expect(
      authorizeToolCall(policy, {
        toolName: "file_read",
        args: { path: "/Users/demo/Documents/private.md" },
      }),
    ).toMatchObject({
      allowed: false,
      reason: "file_read 路径不在已授权可读目录内。",
      kind: "policy_deny",
    });
  });

  it("allows safe tool-result refs without broadening normal file reads", () => {
    expect(
      authorizeToolCall(policy, {
        toolName: "tool_result_read",
        args: { ref: "tool-result-refs/run_call_file_list_ref.json" },
      }),
    ).toMatchObject({ allowed: true });

    expect(
      authorizeToolCall(policy, {
        toolName: "file_read",
        args: { path: "tool-result-refs/run_call_file_list_ref.json" },
      }),
    ).toMatchObject({ allowed: true });

    expect(
      authorizeToolCall(policy, {
        toolName: "tool_result_read",
        args: { ref: "../chat-sessions.json" },
      }),
    ).toMatchObject({
      allowed: false,
      reason: "tool_result_read 引用无效。",
      kind: "invalid_request",
    });
  });

  it("authorizes Chrome bookmark reads through the Chrome user data directory", () => {
    const chromePolicy: TaskPermissionPolicy = {
      ...policy,
      files: {
        ...policy.files,
        read: ["/Users/demo/Library/Application Support/Google/Chrome"],
      },
    };

    expect(
      authorizeToolCall(chromePolicy, {
        toolName: "chrome_bookmarks_read",
        args: {
          chromeUserDataDir:
            "/Users/demo/Library/Application Support/Google/Chrome",
          profile: "Default",
        },
      }),
    ).toEqual({
      allowed: true,
      kind: "allowed",
      reason: "文件路径位于已授权目录内。",
    });
    expect(
      authorizeToolCall(chromePolicy, {
        toolName: "chrome_bookmarks_read",
        args: {
          bookmarksPath:
            "/Users/demo/Library/Application Support/Google/Chrome/Profile 1/Bookmarks",
        },
      }),
    ).toEqual({
      allowed: true,
      kind: "allowed",
      reason: "文件路径位于已授权目录内。",
    });
    expect(
      authorizeToolCall(policy, {
        toolName: "chrome_bookmarks_read",
        args: { profile: "Default" },
      }),
    ).toEqual({
      allowed: false,
      reason: "chrome_bookmarks_read Chrome 书签目录不在已授权可读目录内。",
      kind: "policy_deny",
    });
  });

  it("uses read-directory authorization for file_list", () => {
    expect(
      authorizeToolCall(policy, {
        toolName: "file_list",
        args: { path: "/Users/demo/Downloads" },
      }),
    ).toMatchObject({ allowed: true });

    expect(
      authorizeToolCall(policy, {
        toolName: "file_list",
        args: { path: "/Users/demo/Desktop" },
      }),
    ).toMatchObject({
      allowed: false,
      reason: "file_list 路径不在已授权可读目录内。",
      kind: "policy_deny",
    });
  });

  it("authorizes native batch file organizer tools by read and write scope", () => {
    const organizerPolicy: TaskPermissionPolicy = {
      ...policy,
      files: {
        read: ["/Users/demo/Downloads"],
        write: ["/Users/demo/Downloads"],
      },
    };

    expect(
      authorizeToolCall(organizerPolicy, {
        toolName: "file_inventory",
        args: { path: "/Users/demo/Downloads" },
      }),
    ).toEqual({
      allowed: true,
      kind: "allowed",
      reason: "文件路径位于已授权目录内。",
    });
    expect(
      authorizeToolCall(organizerPolicy, {
        toolName: "file_move_plan",
        args: { targetDir: "/Users/demo/Downloads" },
      }),
    ).toEqual({
      allowed: true,
      kind: "allowed",
      reason: "文件路径位于已授权目录内。",
    });
    expect(
      authorizeToolCall(organizerPolicy, {
        toolName: "file_move_transaction_read",
        args: {
          logPath: "/Users/demo/Downloads/.zerox-organize-transactions/tx.json",
        },
      }),
    ).toEqual({
      allowed: true,
      kind: "allowed",
      reason: "文件路径位于已授权目录内。",
    });
    expect(
      authorizeToolCall(organizerPolicy, {
        toolName: "file_apply_moves",
        args: { root: "/Users/demo/Downloads" },
      }),
    ).toEqual({
      allowed: true,
      kind: "allowed",
      reason: "文件路径位于已授权目录内。",
    });
    expect(
      authorizeToolCall(policy, {
        toolName: "file_apply_moves",
        args: { root: "/Users/demo/Downloads" },
      }),
    ).toEqual({
      allowed: false,
      reason: "file_apply_moves 根目录不在已授权可写目录内。",
      kind: "policy_deny",
    });
    expect(
      authorizeToolCall(organizerPolicy, {
        toolName: "file_rollback_moves",
        args: { transaction: { root: "/Users/demo/Downloads" } },
      }),
    ).toEqual({
      allowed: true,
      kind: "allowed",
      reason: "文件路径位于已授权目录内。",
    });
  });

  it("does not allow sibling path prefix escapes", () => {
    expect(
      authorizeToolCall(policy, {
        toolName: "file_read",
        args: { path: "/Users/demo/Downloads-old/notes.md" },
      }),
    ).toMatchObject({ allowed: false });
  });

  it("allows file writes only inside approved write directories", () => {
    expect(
      authorizeToolCall(policy, {
        toolName: "file_write",
        args: { path: "/Users/demo/Downloads/reports/today.md" },
      }),
    ).toMatchObject({ allowed: true });

    expect(
      authorizeToolCall(policy, {
        toolName: "file_write",
        args: { path: "/Users/demo/Downloads/notes.md" },
      }),
    ).toMatchObject({
      allowed: false,
      reason: "file_write 路径不在已授权可写目录内。",
      kind: "policy_deny",
    });
  });

  it("allows web search only when explicitly enabled", () => {
    expect(
      authorizeToolCall(policy, {
        toolName: "web_search",
        args: { query: "agent memory design" },
      }),
    ).toMatchObject({ allowed: true });

    expect(
      authorizeToolCall(
        { ...policy, web: { ...policy.web, search: false } },
        { toolName: "web_search", args: { query: "agent memory design" } },
      ),
    ).toMatchObject({
      allowed: false,
      reason: "这个任务未允许 web_search。",
      kind: "policy_deny",
    });
  });

  it("allows web fetch for approved domains and subdomains only", () => {
    expect(
      authorizeToolCall(policy, {
        toolName: "web_fetch",
        args: { url: "https://docs.example.com/guide" },
      }),
    ).toMatchObject({ allowed: true });

    expect(
      authorizeToolCall(policy, {
        toolName: "web_fetch",
        args: { url: "https://notexample.com/guide" },
      }),
    ).toMatchObject({
      allowed: false,
      reason: "web_fetch URL 域名不在允许列表内。",
      kind: "policy_deny",
    });
  });

  it("authorizes research writing tools by source domain and report path", () => {
    expect(
      authorizeToolCall(policy, {
        toolName: "web_fetch_document",
        args: { url: "https://docs.example.com/guide" },
      }),
    ).toMatchObject({ allowed: true });

    expect(
      authorizeToolCall(policy, {
        toolName: "citation_record",
        args: { url: "https://docs.example.com/guide" },
      }),
    ).toMatchObject({ allowed: true });

    expect(
      authorizeToolCall(policy, {
        toolName: "markdown_report_write",
        args: { path: "/Users/demo/Downloads/reports/research.md" },
      }),
    ).toMatchObject({ allowed: true });

    expect(
      authorizeToolCall(policy, {
        toolName: "markdown_report_write",
        args: { path: "/Users/demo/Desktop/research.md" },
      }),
    ).toEqual({
      allowed: false,
      reason: "markdown_report_write 路径不在已授权可写目录内。",
      kind: "policy_deny",
    });

    expect(
      authorizeToolCall(policy, {
        toolName: "citation_coverage_check",
        args: { claims: [], citations: [] },
      }),
    ).toEqual({
      allowed: true,
      kind: "allowed",
      reason: "citation_coverage_check 仅检查已提供的引用结构。",
    });
  });

  it("allows shell execution only when a safe command matches an approved template", () => {
    expect(
      authorizeToolCall(policy, {
        toolName: "shell_exec",
        args: { command: "find /Users/demo/Downloads -maxdepth 1 -type f" },
      }),
    ).toMatchObject({ allowed: true });

    expect(
      authorizeToolCall(policy, {
        toolName: "shell_exec",
        args: { command: "find /Users/demo/Downloads -delete" },
      }),
    ).toMatchObject({
      allowed: false,
      reason: "shell_exec command 不匹配已授权模板。",
      kind: "policy_deny",
    });
  });

  it("authorizes native code search and git tools through readable workspace paths", () => {
    const nativePolicy = getDefaultTaskPermissionPolicy();
    nativePolicy.files.read = ["/workspace/project"];

    expect(
      authorizeToolCall(nativePolicy, {
        toolName: "code_search",
        args: { workspaceRoot: "/workspace/project", query: "Agent" },
      }),
    ).toEqual({
      allowed: true,
      kind: "allowed",
      reason: "路径在已授权范围内。",
    });
    expect(
      authorizeToolCall(nativePolicy, {
        toolName: "git_status",
        args: { workspaceRoot: "/workspace/project" },
      }).allowed,
    ).toBe(true);
    expect(
      authorizeToolCall(nativePolicy, {
        toolName: "git_diff",
        args: { workspaceRoot: "/private/project" },
      }),
    ).toEqual({
      allowed: false,
      reason: "git_diff workspaceRoot 不在已授权可读目录内。",
      kind: "policy_deny",
    });
  });

  it("authorizes test_run only when the command matches shell policy", () => {
    const nativePolicy = getDefaultTaskPermissionPolicy();
    nativePolicy.files.read = ["/workspace/project"];
    nativePolicy.shell.commands = ["npm test -- *"];

    expect(
      authorizeToolCall(nativePolicy, {
        toolName: "test_run",
        args: {
          workspaceRoot: "/workspace/project",
          command: "npm test -- src/shared/nativeCapabilities.test.ts",
        },
      }).allowed,
    ).toBe(true);
    expect(
      authorizeToolCall(nativePolicy, {
        toolName: "test_run",
        args: {
          workspaceRoot: "/workspace/project",
          command: "npm install left-pad",
        },
      }),
    ).toEqual({
      allowed: false,
      reason: "test_run command 不匹配已授权测试模板。",
      kind: "policy_deny",
    });
  });

  it("rejects shell commands with shell control operators before template matching", () => {
    expect(
      authorizeToolCall(policy, {
        toolName: "shell_exec",
        args: {
          command: "find /Users/demo/Downloads -maxdepth 1 -type f; rm -rf /",
        },
      }),
    ).toMatchObject({
      allowed: false,
      reason: "shell_exec command 包含被阻止的 shell 控制符。",
      kind: "policy_deny",
    });
  });

  it.each(["shell_exec", "test_run"] as const)(
    "allows quoted interpreter statements for an exact %s command contract",
    (toolName) => {
      const command =
        "python3 -c \"import json; json.load(open('allergen-map/data/china.geo.json'))\"";
      const commandPolicy = getDefaultTaskPermissionPolicy();
      commandPolicy.files.read = ["/workspace/project"];
      commandPolicy.shell.commands = [command];

      expect(
        authorizeToolCall(commandPolicy, {
          toolName,
          args: {
            command,
            ...(toolName === "test_run"
              ? { workspaceRoot: "/workspace/project" }
              : {}),
          },
        }),
      ).toMatchObject({ allowed: true });
    },
  );

  it.each(["\n", "\r", "\r\n"])(
    "rejects newline-separated shell commands before template matching: %j",
    (separator) => {
      expect(
        authorizeToolCall(policy, {
          toolName: "shell_exec",
          args: {
            command: `find /Users/demo/Downloads -maxdepth 1${separator}curl https://attacker.example`,
          },
        }),
      ).toMatchObject({
        allowed: false,
        reason: "shell_exec command 包含被阻止的 shell 控制符。",
        kind: "policy_deny",
      });
    },
  );

  it("allows memory search tools only when memory read is enabled", () => {
    expect(
      authorizeToolCall(policy, {
        toolName: "memory_search",
        args: { query: "agent memory design" },
      }),
    ).toMatchObject({ allowed: true });

    expect(
      authorizeToolCall(policy, {
        toolName: "conversation_search",
        args: { query: "downloads" },
      }),
    ).toMatchObject({ allowed: true });

    expect(
      authorizeToolCall(policy, {
        toolName: "history_search",
        args: { query: "skill_load" },
      }),
    ).toMatchObject({ allowed: true });

    expect(
      authorizeToolCall(policy, {
        toolName: "history_around",
        args: { entryId: "history_1" },
      }),
    ).toMatchObject({ allowed: true });

    expect(
      authorizeToolCall(
        { ...policy, memory: { read: false, write: false } },
        { toolName: "memory_search", args: { query: "agent memory design" } },
      ),
    ).toMatchObject({
      allowed: false,
      reason: "这个任务未允许读取本地记忆。",
      kind: "policy_deny",
    });
  });

  it("requires explicit tool policy for skill lazy-load tools", () => {
    expect(
      authorizeToolCall(policy, {
        toolName: "skill_load",
        args: { skillName: "onepager" },
      }),
    ).toMatchObject({
      allowed: false,
      reason: "工具 skill_load 尚未配置授权规则。",
      kind: "policy_deny",
    });

    expect(
      authorizeToolCall(
        {
          ...policy,
          tools: {
            allowedNames: ["skill_load", "skill_resource_list"],
            allowedSources: [],
          },
        },
        {
          toolName: "skill_load",
          args: { skillName: "onepager" },
        },
      ),
    ).toMatchObject({
      allowed: false,
      reason: "skill_load 请求的技能 onepager 不在本次运行授权技能内。",
      kind: "policy_deny",
    });

    expect(
      authorizeToolCall(
        {
          ...policy,
          tools: {
            allowedNames: ["skill_load", "skill_resource_list"],
            allowedSources: [],
            allowedSkillNames: ["onepager"],
          },
        },
        {
          toolName: "skill_load",
          args: { skillName: "onepager" },
        },
      ),
    ).toMatchObject({
      allowed: true,
      kind: "allowed",
      reason: "skill_load 已绑定到本次运行授权技能 onepager。",
    });

    const digest = "a".repeat(64);
    const digestBoundPolicy = {
      ...policy,
      tools: {
        allowedNames: ["skill_load"],
        allowedSources: [],
        allowedSkillNames: ["onepager"],
        allowedSkillSnapshotSha256ByName: { onepager: digest },
      },
    };
    expect(authorizeToolCall(digestBoundPolicy, {
      toolName: "skill_load",
      args: { skillName: "onepager", skillSnapshotSha256: "b".repeat(64) },
    })).toMatchObject({ allowed: false });
    expect(authorizeToolCall(digestBoundPolicy, {
      toolName: "skill_load",
      args: { skillName: "onepager", skillSnapshotSha256: digest },
    })).toMatchObject({ allowed: true });

    expect(
      authorizeToolCall(
        {
          ...policy,
          tools: {
            allowedNames: ["skill_load", "skill_resource_list"],
            allowedSources: [],
            allowedSkillNames: ["onepager"],
          },
        },
        {
          toolName: "skill_resource_list",
          args: { skillName: "other-skill" },
        },
      ),
    ).toMatchObject({
      allowed: false,
      reason: "skill_resource_list 请求的技能 other-skill 不在本次运行授权技能内。",
      kind: "policy_deny",
    });
  });

  it("allows declared skill-defined dynamic tools by name", () => {
    expect(
      authorizeToolCall(
        {
          ...policy,
          tools: {
            allowedNames: ["organize_preview"],
            allowedSources: [],
          },
        },
        {
          toolName: "organize_preview",
          args: { targetDir: "/Users/demo/Downloads" },
        },
      ),
    ).toEqual({
      allowed: true,
      kind: "allowed",
      reason: "动态工具 organize_preview 已由任务显式允许。",
    });
  });

  it("allows MCP dynamic tools only from declared skill MCP sources", () => {
    const dynamicPolicy: TaskPermissionPolicy = {
      ...policy,
      tools: {
        allowedNames: [],
        allowedSources: ["mcp:research-writer:source-fetcher"],
      },
    };

    expect(
      authorizeToolCall(dynamicPolicy, {
        toolName: "remote_source_lookup",
        source: "mcp:research-writer:source-fetcher",
        args: { query: "agent eval" },
      }),
    ).toEqual({
      allowed: true,
      kind: "allowed",
      reason:
        "动态工具 remote_source_lookup 来自已允许来源 mcp:research-writer:source-fetcher。",
    });

    expect(
      authorizeToolCall(dynamicPolicy, {
        toolName: "remote_source_lookup",
        source: "mcp:other-skill:source-fetcher",
        args: { query: "agent eval" },
      }),
    ).toEqual({
      allowed: false,
      reason: "工具 remote_source_lookup 尚未配置授权规则。",
      kind: "policy_deny",
    });
  });

  it("narrows broad file permissions to the active run workspace", () => {
    const broadPolicy: TaskPermissionPolicy = {
      files: {
        read: ["/Users/demo"],
        write: ["/Users/demo"],
      },
      web: { search: true, fetchDomains: ["example.com"] },
      shell: { commands: ["find {{targetDir}} -maxdepth 1 -type f"] },
      memory: { read: true, write: false },
    };
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: "/Users/demo/project",
    });

    expect(
      authorizeToolCallWithinRunContext(broadPolicy, {
        toolName: "file_write",
        args: { path: "/Users/demo/project/report.md", content: "done" },
      }, runContext),
    ).toMatchObject({ allowed: true });

    expect(
      authorizeToolCallWithinRunContext(broadPolicy, {
        toolName: "file_write",
        args: { path: "/Users/demo/Desktop/report.md", content: "done" },
      }, runContext),
    ).toEqual({
      allowed: false,
      reason: "file_write 被运行沙箱阻止：路径不在工作区或额外可写目录内。",
      kind: "sandbox_deny",
    });
  });

  it("denies Desktop writes without an explicit Desktop run-context write root", () => {
    const broadPolicy: TaskPermissionPolicy = {
      files: {
        read: ["/Users/demo"],
        write: ["/Users/demo"],
      },
      web: { search: false, fetchDomains: [] },
      shell: { commands: [] },
      memory: { read: false, write: false },
    };
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: "/Users/demo/project",
      locationEnv: { homeDir: "/Users/demo", platform: "darwin" },
    });

    expect(
      authorizeToolCallWithinRunContext(
        broadPolicy,
        {
          toolName: "file_write",
          args: { path: "Desktop/report.md", content: "done" },
        },
        runContext,
      ),
    ).toEqual({
      allowed: false,
      reason: "file_write 被运行沙箱阻止：路径不在工作区或额外可写目录内。",
      kind: "sandbox_deny",
    });
  });

  it("allows Desktop aliases when Desktop is an explicit run-context write root", () => {
    const broadPolicy: TaskPermissionPolicy = {
      files: {
        read: ["/Users/demo"],
        write: ["/Users/demo"],
      },
      web: { search: false, fetchDomains: [] },
      shell: { commands: [] },
      memory: { read: false, write: false },
    };
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: "/Users/demo/project",
      locationEnv: { homeDir: "/Users/demo", platform: "darwin" },
      sandbox: {
        ...buildDefaultSandboxPolicy(),
        extraWriteRoots: ["~/Desktop"],
      },
    });

    for (const candidate of [
      "~/Desktop/report.md",
      "Desktop/report.md",
      "/Users/demo/Desktop/report.md",
    ]) {
      expect(
        authorizeToolCallWithinRunContext(
          broadPolicy,
          {
            toolName: "file_write",
            args: { path: candidate, content: "done" },
          },
          runContext,
        ),
      ).toMatchObject({ allowed: true });
    }
  });

  it("narrows native workspaceRoot permissions to the active run workspace", () => {
    const broadPolicy: TaskPermissionPolicy = {
      files: {
        read: ["/Users/demo"],
        write: ["/Users/demo"],
      },
      web: { search: true, fetchDomains: ["example.com"] },
      shell: { commands: ["npm test -- *"] },
      memory: { read: true, write: false },
    };
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: "/Users/demo/project",
    });

    expect(
      authorizeToolCallWithinRunContext(
        broadPolicy,
        {
          toolName: "code_search",
          args: { workspaceRoot: "/Users/demo/project", query: "Agent" },
        },
        runContext,
      ),
    ).toMatchObject({ allowed: true });

    expect(
      authorizeToolCallWithinRunContext(
        broadPolicy,
        {
          toolName: "test_run",
          args: {
            workspaceRoot: "/Users/demo/Desktop",
            command: "npm test -- src/shared/nativeCapabilities.test.ts",
          },
        },
        runContext,
      ),
    ).toEqual({
      allowed: false,
      kind: "sandbox_deny",
      reason:
        "test_run 被运行沙箱阻止：workspaceRoot 不在工作区或额外可读目录内。",
    });

    expect(
      authorizeToolCallWithinRunContext(
        broadPolicy,
        {
          toolName: "test_run",
          args: {
            workspaceRoot: "/Users/demo/project",
            command: "npm test -- src/shared/nativeCapabilities.test.ts",
          },
        },
        buildPrimaryRunContext({
          workspaceId: "workspace_1",
          workspaceRoot: "/Users/demo/project",
          sandbox: {
            mode: "workspace_write",
            network: "task_policy",
            shell: "disabled",
            allowWorkspaceEscape: false,
            extraReadRoots: [],
            extraWriteRoots: [],
          },
        }),
      ),
    ).toEqual({
      allowed: false,
      reason: "test_run 被运行沙箱阻止：命令执行已禁用。",
      kind: "sandbox_deny",
    });
  });

  it("narrows markdown report writes to the active run workspace", () => {
    const broadPolicy: TaskPermissionPolicy = {
      files: {
        read: ["/Users/demo"],
        write: ["/Users/demo"],
      },
      web: { search: true, fetchDomains: ["example.com"] },
      shell: { commands: [] },
      memory: { read: true, write: false },
    };
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: "/Users/demo/project",
    });

    expect(
      authorizeToolCallWithinRunContext(
        broadPolicy,
        {
          toolName: "markdown_report_write",
          args: { path: "/Users/demo/project/research.md" },
        },
        runContext,
      ),
    ).toMatchObject({ allowed: true });

    expect(
      authorizeToolCallWithinRunContext(
        broadPolicy,
        {
          toolName: "markdown_report_write",
          args: { path: "/Users/demo/Desktop/research.md" },
        },
        runContext,
      ),
    ).toEqual({
      allowed: false,
      kind: "sandbox_deny",
      reason:
        "markdown_report_write 被运行沙箱阻止：路径不在工作区或额外可写目录内。",
    });
  });

  it("denies symlink escapes for file and native workspace tools", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "tool-permissions-symlink-"));
    try {
      const workspaceRoot = path.join(tempDir, "workspace");
      const outsideRoot = path.join(tempDir, "outside");
      const linkPath = path.join(workspaceRoot, "linked-outside");
      await mkdir(workspaceRoot, { recursive: true });
      await mkdir(outsideRoot, { recursive: true });
      await writeFile(path.join(outsideRoot, "secret.md"), "secret", "utf8");
      await symlink(outsideRoot, linkPath);

      const broadPolicy: TaskPermissionPolicy = {
        files: {
          read: [workspaceRoot],
          write: [workspaceRoot],
        },
        web: { search: true, fetchDomains: ["example.com"] },
        shell: { commands: [] },
        memory: { read: false, write: false },
      };
      const runContext = buildPrimaryRunContext({
        workspaceId: "workspace_1",
        workspaceRoot,
      });

      const requests = [
        { toolName: "file_read", args: { path: path.join(linkPath, "secret.md") } },
        { toolName: "file_write", args: { path: path.join(linkPath, "report.md"), content: "x" } },
        { toolName: "file_stat", args: { path: path.join(linkPath, "secret.md") } },
        { toolName: "file_list", args: { path: linkPath } },
        { toolName: "file_search", args: { root: linkPath, query: "secret" } },
        { toolName: "code_search", args: { workspaceRoot: linkPath, query: "secret" } },
        { toolName: "markdown_report_write", args: { path: path.join(linkPath, "report.md") } },
      ];

      for (const request of requests) {
        expect(
          authorizeToolCallWithinRunContext(broadPolicy, request, runContext),
        ).toMatchObject({ allowed: false });
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("denies crafted move previews and transactions with paths outside the workspace", () => {
    const workspaceRoot = "/tmp/zerox/workspace";
    const outsideRoot = "/tmp/zerox/outside";
    const broadPolicy: TaskPermissionPolicy = {
      files: {
        read: ["/tmp/zerox"],
        write: ["/tmp/zerox"],
      },
      web: { search: false, fetchDomains: [] },
      shell: { commands: [] },
      memory: { read: false, write: false },
    };
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot,
    });

    expect(
      authorizeToolCallWithinRunContext(
        broadPolicy,
        {
          toolName: "file_apply_moves",
          args: {
            preview: {
              id: "tx_1",
              root: workspaceRoot,
              generatedAt: "2026-06-21T00:00:00.000Z",
              confirmationRequired: true,
              inventory: { files: 1, directories: 0, skipped: 0 },
              conflicts: [],
              moves: [
                {
                  from: path.join(outsideRoot, "secret.txt"),
                  to: path.join(workspaceRoot, "Documents", "secret.txt"),
                  category: "Documents",
                  reason: "crafted",
                },
              ],
            },
          },
        },
        runContext,
      ),
    ).toMatchObject({ allowed: false });

    expect(
      authorizeToolCallWithinRunContext(
        broadPolicy,
        {
          toolName: "file_rollback_moves",
          args: {
            transaction: {
              id: "tx_1",
              root: workspaceRoot,
              status: "applied",
              createdAt: "2026-06-21T00:00:00.000Z",
              logPath: path.join(workspaceRoot, ".zerox-organize-transactions", "tx_1.json"),
              movesApplied: 1,
              history: [],
              moves: [
                {
                  from: path.join(workspaceRoot, "secret.txt"),
                  to: path.join(outsideRoot, "secret.txt"),
                  category: "Documents",
                  reason: "crafted",
                },
              ],
            },
          },
        },
        runContext,
      ),
    ).toMatchObject({ allowed: false });
  });

  it("applies workspace path boundaries to approved shell command templates", () => {
    const broadPolicy: TaskPermissionPolicy = {
      files: {
        read: ["/"],
        write: ["/"],
      },
      web: { search: false, fetchDomains: [] },
      shell: { commands: ["cat {{target}}", "python {{script}}", "node {{script}}"] },
      memory: { read: false, write: false },
    };
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: "/workspace/project",
      sandbox: {
        mode: "workspace_write",
        network: "task_policy",
        shell: "approved_commands",
        allowWorkspaceEscape: false,
        extraReadRoots: [],
        extraWriteRoots: [],
      },
    });

    for (const command of [
      "cat /etc/passwd",
      "python /outside/script.py",
      "node /outside/script.js",
    ]) {
      expect(
        authorizeToolCallWithinRunContext(
          broadPolicy,
          { toolName: "shell_exec", args: { command } },
          runContext,
        ),
      ).toMatchObject({ allowed: false });
    }
  });

  it("denies approved shell templates when a substituted relative path escapes the workspace", () => {
    const broadPolicy: TaskPermissionPolicy = {
      files: {
        read: ["/Users/demo/project"],
        write: ["/Users/demo/project"],
      },
      web: { search: false, fetchDomains: [] },
      shell: { commands: ["cat {{target}}"] },
      memory: { read: false, write: false },
    };
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: "/Users/demo/project/workspace",
      sandbox: {
        mode: "workspace_write",
        network: "task_policy",
        shell: "approved_commands",
        allowWorkspaceEscape: false,
        extraReadRoots: [],
        extraWriteRoots: [],
      },
    });

    expect(
      authorizeToolCallWithinRunContext(
        broadPolicy,
        {
          toolName: "shell_exec",
          args: { command: "cat ../outside/secret.txt" },
        },
        runContext,
      ),
    ).toEqual({
      allowed: false,
      kind: "sandbox_deny",
      reason:
        "shell_exec 被运行沙箱阻止：路径 ../outside/secret.txt 不在工作区或额外可读目录内。",
    });
  });

  it("denies Chrome bookmark artifact writes in read-only run contexts", () => {
    const chromeRoot = "/Users/demo/Library/Application Support/Google/Chrome";
    const chromePolicy: TaskPermissionPolicy = {
      files: {
        read: [chromeRoot],
        write: ["/Users/demo/project"],
      },
      web: { search: false, fetchDomains: [] },
      shell: { commands: [] },
      memory: { read: false, write: false },
    };
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: "/Users/demo/project",
      sandbox: {
        ...buildDefaultSandboxPolicy(),
        mode: "read_only",
      },
    });

    expect(
      authorizeToolCallWithinRunContext(
        chromePolicy,
        {
          toolName: "chrome_bookmarks_read",
          args: {
            bookmarksPath: `${chromeRoot}/Default/Bookmarks`,
          },
        },
        runContext,
      ),
    ).toMatchObject({ allowed: false });
  });

  it("denies every shell command in a read-only run sandbox", () => {
    const broadPolicy = getDefaultTaskPermissionPolicy();
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: "/Users/demo/project",
      sandbox: { ...buildDefaultSandboxPolicy(), mode: "read_only" },
    });
    const command = "rm ./report.md";
    expect(
      authorizeToolCallWithinRunContext(
        broadPolicy,
        { toolName: "shell_exec", args: { command } },
        runContext,
        { shellPlan: analyzeShell(command, { cwd: runContext.workspaceRoot }) },
      ),
    ).toMatchObject({ allowed: false, reason: expect.stringContaining("只读沙箱") });
  });

  it("allows only the outer read_code envelope while subcalls remain independently authorized", () => {
    const policy = getDefaultTaskPermissionPolicy();
    expect(
      authorizeToolCall(policy, {
        toolName: "read_code",
        source: "built-in",
        args: {
          program: {
            steps: [
              { id: "read", tool: "file_read", args: { path: "/tmp/x" } },
            ],
          },
        },
      }),
    ).toEqual({
      allowed: true,
      kind: "allowed",
      reason: "read_code 仅编排会再次授权的只读工具。",
    });
    expect(
      authorizeToolCall(policy, {
        toolName: "file_read",
        source: "built-in",
        args: { path: "/outside/not-authorized" },
      }).allowed,
    ).toBe(false);
    expect(
      authorizeToolCall(policy, {
        toolName: "read_code",
        source: "mcp:spoofed",
        args: { program: { steps: [] } },
      }),
    ).toEqual({
      allowed: false,
      kind: "sandbox_deny",
      reason: "read_code 仅允许内建只读 Worker 来源。",
    });
  });

  it("denies network shell commands when the run sandbox disables network", () => {
    const broadPolicy = getDefaultTaskPermissionPolicy();
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: "/Users/demo/project",
      sandbox: { ...buildDefaultSandboxPolicy(), network: "none" },
    });
    const command = "curl https://example.com";
    expect(
      authorizeToolCallWithinRunContext(
        broadPolicy,
        { toolName: "shell_exec", args: { command } },
        runContext,
        { shellPlan: analyzeShell(command, { cwd: runContext.workspaceRoot }) },
      ),
    ).toMatchObject({ allowed: false, reason: expect.stringContaining("网络访问已禁用") });
  });

  it.each([
    "bash -c 'curl https://example.com'",
    "python -c 'import requests; requests.get(\"https://example.com\")'",
    "node -e 'fetch(\"https://example.com\")'",
  ])("denies nested network command %s", (command) => {
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: "/Users/demo/project",
      sandbox: { ...buildDefaultSandboxPolicy(), network: "none" },
    });
    expect(
      authorizeToolCallWithinRunContext(
        getDefaultTaskPermissionPolicy(),
        { toolName: "shell_exec", args: { command } },
        runContext,
        { shellPlan: analyzeShell(command, { cwd: runContext.workspaceRoot }) },
      ),
    ).toMatchObject({ allowed: false });
  });

  it("applies parsed network restrictions to test_run commands", () => {
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: "/Users/demo/project",
      sandbox: { ...buildDefaultSandboxPolicy(), network: "none" },
    });
    const command = "python3 -c 'import requests; requests.get(\"https://example.com\")'";
    const policy = getDefaultTaskPermissionPolicy();
    policy.files.read = [runContext.workspaceRoot];
    policy.shell.commands = [command];

    expect(
      authorizeToolCallWithinRunContext(
        policy,
        {
          toolName: "test_run",
          args: { command, workspaceRoot: runContext.workspaceRoot },
        },
        runContext,
        { shellPlan: analyzeShell(command, { cwd: runContext.workspaceRoot }) },
      ),
    ).toMatchObject({
      allowed: false,
      kind: "sandbox_deny",
      reason: expect.stringContaining("test_run 被运行沙箱阻止：网络访问已禁用"),
    });
  });

  it("denies opaque nested shell execution in workspace-only sandboxes", () => {
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: "/Users/demo/project",
    });
    const command = "sh -c 'cat /etc/passwd'";
    expect(
      authorizeToolCallWithinRunContext(
        getDefaultTaskPermissionPolicy(),
        { toolName: "shell_exec", args: { command } },
        runContext,
        { shellPlan: analyzeShell(command, { cwd: runContext.workspaceRoot }) },
      ),
    ).toMatchObject({ allowed: false, reason: expect.stringContaining("嵌套解释器") });
  });

  it("allows an exact task-authorized interpreter command while still enforcing its paths", () => {
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: "/Users/demo/project",
    });
    const command = "python /Users/demo/project/check.py --help";
    const policy: TaskPermissionPolicy = {
      ...getDefaultTaskPermissionPolicy(),
      files: {
        read: [runContext.workspaceRoot],
        write: [runContext.workspaceRoot],
      },
      shell: { commands: [command] },
    };

    expect(
      authorizeToolCallWithinRunContext(
        policy,
        { toolName: "shell_exec", args: { command } },
        runContext,
        { shellPlan: analyzeShell(command, { cwd: runContext.workspaceRoot }) },
      ),
    ).toMatchObject({ allowed: true });
  });

  it("denies dynamic tools in network-disabled sandboxes", () => {
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: "/Users/demo/project",
      sandbox: { ...buildDefaultSandboxPolicy(), network: "none" },
    });
    expect(
      authorizeToolCallWithinRunContext(
        getDefaultTaskPermissionPolicy(),
        { toolName: "custom_fetch", source: "mcp:remote", args: {} },
        runContext,
      ),
    ).toMatchObject({ allowed: false });
  });

  it("denies workspace_only shell commands that mention outside absolute paths", () => {
    const broadPolicy: TaskPermissionPolicy = {
      files: {
        read: ["/Users/demo"],
        write: ["/Users/demo"],
      },
      web: { search: false, fetchDomains: [] },
      shell: { commands: ["cat {{target}}"] },
      memory: { read: false, write: false },
    };
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: "/Users/demo/project",
      sandbox: {
        mode: "workspace_write",
        network: "task_policy",
        shell: "workspace_only",
        allowWorkspaceEscape: false,
        extraReadRoots: [],
        extraWriteRoots: [],
      },
    });

    expect(
      authorizeToolCallWithinRunContext(
        broadPolicy,
        {
          toolName: "shell_exec",
          args: { command: "cat /etc/passwd" },
        },
        runContext,
      ),
    ).toEqual({
      allowed: false,
      kind: "sandbox_deny",
      reason:
        "shell_exec 被运行沙箱阻止：路径 /etc/passwd 不在工作区或额外可读目录内。",
    });
  });

  it("denies shell redirection operators before template matching", () => {
    const broadPolicy: TaskPermissionPolicy = {
      files: {
        read: ["/Users/demo"],
        write: ["/Users/demo"],
      },
      web: { search: false, fetchDomains: [] },
      shell: { commands: ["cat {{target}}"] },
      memory: { read: false, write: false },
    };
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: "/Users/demo/project",
      sandbox: {
        mode: "workspace_write",
        network: "task_policy",
        shell: "workspace_only",
        allowWorkspaceEscape: false,
        extraReadRoots: [],
        extraWriteRoots: [],
      },
    });

    expect(
      authorizeToolCallWithinRunContext(
        broadPolicy,
        {
          toolName: "shell_exec",
          args: { command: "cat README.md>/tmp/out" },
        },
        runContext,
      ),
    ).toEqual({
      allowed: false,
      reason: "shell_exec command 包含被阻止的 shell 控制符。",
      kind: "policy_deny",
    });
  });

  it.each([
    "Desktop/report.md",
    "Downloads/report.md",
    "桌面/report.md",
    "下载/report.md",
  ])("denies workspace_only shell commands that mention outside alias paths: %s", (target) => {
    const broadPolicy: TaskPermissionPolicy = {
      files: {
        read: ["/Users/demo"],
        write: ["/Users/demo"],
      },
      web: { search: false, fetchDomains: [] },
      shell: { commands: ["cat {{target}}"] },
      memory: { read: false, write: false },
    };
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: "/Users/demo/project",
      locationEnv: { homeDir: "/Users/demo", platform: "darwin" },
      sandbox: {
        mode: "workspace_write",
        network: "task_policy",
        shell: "workspace_only",
        allowWorkspaceEscape: false,
        extraReadRoots: [],
        extraWriteRoots: [],
      },
    });

    expect(
      authorizeToolCallWithinRunContext(
        broadPolicy,
        {
          toolName: "shell_exec",
          args: { command: `cat ${target}` },
        },
        runContext,
      ),
    ).toEqual({
      allowed: false,
      reason: `shell_exec 被运行沙箱阻止：路径 ${target} 不在工作区或额外可读目录内。`,
      kind: "sandbox_deny",
    });
  });
});
