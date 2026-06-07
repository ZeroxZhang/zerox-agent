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
