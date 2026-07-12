import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  discoverSkills,
  shouldAutoInitializeSkillMcp,
} from "./skillRegistry";

describe("skill registry", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "building-agent-skills-"));
  });

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  it("requires explicit opt-in before skill MCP servers auto-start", () => {
    expect(shouldAutoInitializeSkillMcp({})).toBe(false);
    expect(shouldAutoInitializeSkillMcp({ ZEROX_ENABLE_SKILL_MCP: "0" })).toBe(
      false,
    );
    expect(shouldAutoInitializeSkillMcp({ ZEROX_ENABLE_SKILL_MCP: "1" })).toBe(
      true,
    );
  });

  it("discovers valid skill folders and reports invalid ones", async () => {
    await writeSkill(
      "local-file-organizer",
      `---
name: local-file-organizer
displayName: Local File Organizer
description: Use when organizing local files.
version: 0.1.0
execution:
  mode: agent
permissions:
  files:
    read: ["{{targetDir}}"]
    write: ["{{targetDir}}"]
---

# Local File Organizer
`,
    );
    await writeSkill(
      "broken-skill",
      `---
name: broken-skill
description: Use when testing broken skills.
execution:
  mode: script
---

# Broken
`,
    );

    const result = await discoverSkills({ skillsDir: tempDir, skipSystemDirs: true });

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]).toMatchObject({
      body: "# Local File Organizer\n",
      manifest: {
        name: "local-file-organizer",
        displayName: "Local File Organizer",
      },
      rootDir: path.join(tempDir, "local-file-organizer"),
      skillFile: path.join(tempDir, "local-file-organizer", "SKILL.md"),
    });
    expect(result.errors).toEqual([
      {
        folderName: "broken-skill",
        message: "Script skills require execution.entrypoint.",
      },
    ]);
  });

  async function writeSkill(folderName: string, markdown: string) {
    const skillDir = path.join(tempDir, folderName);
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), markdown, "utf8");
  }
});
