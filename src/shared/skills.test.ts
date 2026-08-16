import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseSkillMarkdown, SkillManifestError } from "./skills";

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
    args: ["server.js"]
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
        args: ["server.js"],
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
