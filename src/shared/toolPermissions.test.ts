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
import { buildPrimaryRunContext } from "./agentWorkspace";
import type { SkillManifest } from "./skills";

describe("task permission policy", () => {
  it("defaults to denying every tool capability", () => {
    expect(getDefaultTaskPermissionPolicy()).toEqual({
      files: { read: [], write: [] },
      web: { search: false, fetchDomains: [] },
      shell: { commands: [] },
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
      }),
    ).toEqual({
      files: { read: ["~/Downloads"], write: ["/tmp/reports"] },
      web: {
        search: true,
        fetchDomains: ["example.com", "docs.example.com"],
      },
      shell: { commands: ["ls {{targetDir}}"] },
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
    };

    expect(createPermissionPolicyFromSkillManifest(manifest)).toEqual({
      files: { read: ["{{targetDir}}"], write: ["{{targetDir}}"] },
      web: { search: false, fetchDomains: [] },
      shell: { commands: [] },
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
    });
  });
});
