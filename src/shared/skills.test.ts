import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  createPublicSkillDiscoveryResult,
  createPublicSkillSnapshot,
  createPublicSkillSnapshotSha256,
  parseSkillMarkdown,
  SkillManifestError,
} from "./skills";

const validSkillMarkdown = `---
name: local-file-organizer
displayName: Local File Organizer
description: Use when organizing and summarizing files in a local folder.
version: 0.1.0
execution:
  mode: agent
inputs:
  - name: targetDir
    label: Target folder
    type: path
    required: true
permissions:
  files:
    read:
      - "{{targetDir}}"
    write:
      - "{{targetDir}}"
  shell:
    commands: []
  web:
    search: false
    fetchDomains: []
  memory:
    read: true
    write: true
---

# Local File Organizer

Scan a folder, summarize changes, and write a report.
`;

describe("skill manifest parser", () => {
  it("parses a SKILL.md file into a stable manifest and body", () => {
    expect(parseSkillMarkdown(validSkillMarkdown)).toEqual({
      manifest: {
        name: "local-file-organizer",
        displayName: "Local File Organizer",
        description: "Use when organizing and summarizing files in a local folder.",
        version: "0.1.0",
        execution: {
          mode: "agent",
          entrypoint: null,
        },
        inputs: [
          {
            name: "targetDir",
            label: "Target folder",
            type: "path",
            required: true,
          },
        ],
        permissions: {
          files: {
            read: ["{{targetDir}}"],
            write: ["{{targetDir}}"],
          },
          shell: {
            commands: [],
          },
          web: {
            search: false,
            fetchDomains: [],
          },
          memory: {
            read: true,
            write: true,
          },
        },
      },
      body: "# Local File Organizer\n\nScan a folder, summarize changes, and write a report.\n",
    });
  });

  it("rejects script skills without an entrypoint", () => {
    const markdown = validSkillMarkdown
      .replace("mode: agent", "mode: script")
      .replace("entrypoint: null\n", "");

    expect(() => parseSkillMarkdown(markdown)).toThrow(SkillManifestError);
    expect(() => parseSkillMarkdown(markdown)).toThrow(
      "Script skills require execution.entrypoint.",
    );
  });

  it("rejects skills without frontmatter", () => {
    expect(() => parseSkillMarkdown("# Missing manifest")).toThrow(
      "SKILL.md must start with YAML frontmatter.",
    );
  });

  it("parses guided input metadata used by chat preflight forms", () => {
    const parsed = parseSkillMarkdown(`---
name: guided-onepager
displayName: Guided OnePager
description: Build a OnePage from structured source input.
version: 0.2.0
execution:
  mode: agent
inputs:
  - name: sourcePath
    label: Source path
    type: path
    required: true
    description: A workspace-local file or folder.
  - name: format
    label: Format
    type: choice
    required: true
    description: Output format.
    defaultValue: markdown
    choices:
      - markdown
      - html
  - name: includeResearch
    label: Include research
    type: boolean
    required: false
    description: Search supporting material before writing.
    defaultValue: false
  - name: maxSections
    label: Max sections
    type: number
    required: false
    defaultValue: 5
permissions:
  files:
    read:
      - "{{sourcePath}}"
    write:
      - "{{sourcePath}}"
  shell:
    commands: []
  web:
    search: false
    fetchDomains: []
  memory:
    read: false
    write: false
---

# Guided OnePager
`);

    expect(parsed.manifest.inputs).toEqual([
      {
        name: "sourcePath",
        label: "Source path",
        type: "path",
        required: true,
        description: "A workspace-local file or folder.",
      },
      {
        name: "format",
        label: "Format",
        type: "choice",
        required: true,
        description: "Output format.",
        defaultValue: "markdown",
        choices: ["markdown", "html"],
      },
      {
        name: "includeResearch",
        label: "Include research",
        type: "boolean",
        required: false,
        description: "Search supporting material before writing.",
        defaultValue: false,
      },
      {
        name: "maxSections",
        label: "Max sections",
        type: "number",
        required: false,
        defaultValue: 5,
      },
    ]);
  });

  it("parses strict stdio, HTTP, and SSE MCP server variants", () => {
    const parsed = parseSkillMarkdown(`---
name: mcp-skill
description: Exercise every supported MCP transport.
execution:
  mode: agent
mcpServers:
  - name: local-index
    command: node
    args: ["server.js", "--token", "ARGS_SECRET_DO_NOT_PERSIST"]
    readRoots: ["./data"]
    network: false
  - name: remote-http
    transport: http
    url: https://mcp.example.test/rpc
    headers:
      x-client: zerox
  - name: remote-sse
    transport: sse
    url: https://mcp.example.test/sse
---

# MCP
`);

    expect(parsed.manifest.mcpServers).toEqual([
      {
        name: "local-index",
        transport: "stdio",
        command: "node",
        args: ["server.js", "--token", "ARGS_SECRET_DO_NOT_PERSIST"],
        readRoots: ["./data"],
        network: false,
      },
      {
        name: "remote-http",
        transport: "http",
        url: "https://mcp.example.test/rpc",
        headers: { "x-client": "zerox" },
      },
      {
        name: "remote-sse",
        transport: "sse",
        url: "https://mcp.example.test/sse",
      },
    ]);
  });

  it("creates a public and persistent Skill snapshot without MCP credentials", () => {
    const parsed = parseSkillMarkdown(`---
name: private-mcp-skill
description: Exercise credential-safe Skill snapshots.
execution:
  mode: agent
mcpServers:
  - name: local-private
    transport: stdio
    command: node
    args: ["server.js", "--token", "ARGS_SECRET_DO_NOT_PERSIST"]
    env:
      PRIVATE_TOKEN: STDIO_SECRET_DO_NOT_PERSIST
    readRoots: ["./data"]
    network: false
  - name: remote-private
    transport: http
    url: https://mcp.example.test/rpc
    headers:
      authorization: REMOTE_SECRET_DO_NOT_PERSIST
---

# Private MCP
`);
    const runtimeSkill = {
      ...parsed,
      rootDir: "/tmp/private-mcp-skill",
      skillFile: "/tmp/private-mcp-skill/SKILL.md",
    };
    const unknownSentinel = "SKILL_UNKNOWN_FIELD_DO_NOT_PERSIST";
    Object.assign(runtimeSkill, { rawDiagnostic: unknownSentinel });
    Object.assign(runtimeSkill.manifest, { rawDiagnostic: unknownSentinel });
    Object.assign(runtimeSkill.manifest.execution, {
      rawDiagnostic: unknownSentinel,
    });
    Object.assign(runtimeSkill.manifest.permissions.files, {
      rawDiagnostic: unknownSentinel,
    });

    const snapshot = createPublicSkillSnapshot(runtimeSkill);

    expect(snapshot.manifest.mcpServers).toEqual([
      {
        name: "local-private",
        transport: "stdio",
        command: "node",
        readRoots: ["./data"],
        network: false,
      },
      {
        name: "remote-private",
        transport: "http",
      },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("STDIO_SECRET_DO_NOT_PERSIST");
    expect(JSON.stringify(snapshot)).not.toContain("REMOTE_SECRET_DO_NOT_PERSIST");
    expect(JSON.stringify(snapshot)).not.toContain("ARGS_SECRET_DO_NOT_PERSIST");
    expect(JSON.stringify(snapshot)).not.toContain(unknownSentinel);
    expect(JSON.stringify(runtimeSkill)).toContain("STDIO_SECRET_DO_NOT_PERSIST");
    expect(JSON.stringify(runtimeSkill)).toContain("REMOTE_SECRET_DO_NOT_PERSIST");
    expect(JSON.stringify(runtimeSkill)).toContain("ARGS_SECRET_DO_NOT_PERSIST");

    const samePublicSkill = structuredClone(runtimeSkill);
    const stdio = samePublicSkill.manifest.mcpServers?.[0];
    const remote = samePublicSkill.manifest.mcpServers?.[1];
    if (stdio?.transport === "stdio") {
      stdio.args = ["server.js", "--token", "DIFFERENT_PRIVATE_ARGS"];
      stdio.env = { PRIVATE_TOKEN: "DIFFERENT_PRIVATE_ENV" };
    }
    if (remote?.transport === "http") {
      remote.url = "https://different.example.test/private";
      remote.headers = { authorization: "DIFFERENT_PRIVATE_HEADER" };
    }
    expect(createPublicSkillSnapshotSha256(samePublicSkill)).toBe(
      createPublicSkillSnapshotSha256(runtimeSkill),
    );
  });

  it("keeps public discovery types and parser errors content-free", () => {
    const parsed = parseSkillMarkdown(`---
name: public-contract
description: Verify public discovery contracts.
execution:
  mode: agent
mcpServers:
  - name: local-private
    command: node
    args: ["--token", "PUBLIC_DISCOVERY_ARGS_SECRET"]
    env:
      TOKEN: PUBLIC_DISCOVERY_ENV_SECRET
  - name: remote-private
    transport: http
    url: https://mcp.example.test/rpc?token=PUBLIC_DISCOVERY_URL_SECRET
    headers:
      authorization: PUBLIC_DISCOVERY_HEADER_SECRET
---

# Public contract
`);
    const result = createPublicSkillDiscoveryResult({
      skills: [{
        ...parsed,
        rootDir: "/tmp/public-contract",
        skillFile: "/tmp/public-contract/SKILL.md",
      }],
      errors: [{
        folderName: "PUBLIC_DISCOVERY_FOLDER_SECRET",
        message:
          'YAML error near args: ["--token", "PUBLIC_DISCOVERY_ERROR_SECRET"',
      }],
    });

    expect(result.errors).toEqual([{
      folderName: "invalid-skill-1",
      message: "技能清单解析失败。",
    }]);
    expect(JSON.stringify(result)).not.toMatch(/PUBLIC_DISCOVERY_.*_SECRET/);
    const local = result.skills[0]?.manifest.mcpServers?.[0];
    if (local?.transport === "stdio") {
      // @ts-expect-error Public stdio DTOs must never expose runtime arguments.
      void local.args;
      // @ts-expect-error Public stdio DTOs must never expose runtime env.
      void local.env;
    }
    const remote = result.skills[0]?.manifest.mcpServers?.[1];
    if (remote?.transport === "http") {
      // @ts-expect-error Public remote DTOs must never expose endpoint URLs.
      void remote.url;
      // @ts-expect-error Public remote DTOs must never expose request headers.
      void remote.headers;
    }
  });

  it.each([
    [
      "mixed stdio and remote fields",
      `name: bad\ntransport: http\ncommand: node\nurl: https://mcp.example.test`,
    ],
    [
      "insecure remote URL",
      `name: bad\ntransport: sse\nurl: http://mcp.example.test`,
    ],
    [
      "remote URL credentials",
      `name: bad\ntransport: sse\nurl: https://user:password@mcp.example.test`,
    ],
    [
      "missing stdio command",
      `name: bad\ntransport: stdio`,
    ],
    [
      "unknown transport",
      `name: bad\ntransport: websocket\nurl: https://mcp.example.test`,
    ],
  ])("rejects %s MCP configuration", (_label, serverYaml) => {
    expect(() =>
      parseSkillMarkdown(`---
name: invalid-mcp
description: Invalid MCP manifest.
execution:
  mode: agent
mcpServers:
  - ${serverYaml.replaceAll("\n", "\n    ")}
---

# Invalid
`),
    ).toThrow(SkillManifestError);
  });

  it("ships the built-in file organizer skill with Chinese product copy", () => {
    const markdown = readFileSync(
      path.join(process.cwd(), "skills/local-file-organizer/SKILL.md"),
      "utf8",
    );
    const parsed = parseSkillMarkdown(markdown);

    expect(parsed.manifest).toMatchObject({
      displayName: "本地文件整理",
      description: "扫描本地文件夹，整理最近变化，并写出一份 Markdown 报告。",
      inputs: [
        {
          name: "targetDir",
          label: "目标文件夹",
        },
        {
          name: "reportName",
          label: "报告文件名",
        },
      ],
    });
    expect(parsed.body).toContain("默认用中文输出");
  });
});
