import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverSkills } from "./skillRegistry";
import { createDynamicToolRegistry } from "./dynamicToolRegistry";
import { registerSkillLoadTools } from "./skillLoadTools";

describe("skill load tools", () => {
  let tempDir: string;
  let skillsDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "zerox-skill-load-"));
    skillsDir = path.join(tempDir, "skills");
    const onepagerDir = path.join(skillsDir, "onepager");
    await mkdir(path.join(onepagerDir, "references"), { recursive: true });
    await writeFile(
      path.join(onepagerDir, "SKILL.md"),
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
        "Follow the onepager workflow.",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(onepagerDir, "references", "layout.md"),
      "Layout reference",
      "utf8",
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("lists skill resources without dumping the instruction body", async () => {
    const registry = createDynamicToolRegistry();
    registerSkillLoadTools(registry, {
      discoverSkills: () => discoverSkills({ skillsDir, skipSystemDirs: true, forceRefresh: true }),
    });

    const result = await registry.execute("skill_resource_list", {
      skillName: "onepager",
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        skillName: "onepager",
        displayName: "onepager",
        resources: expect.arrayContaining([
          expect.objectContaining({
            kind: "skill",
            path: path.join(skillsDir, "onepager", "SKILL.md"),
          }),
          expect.objectContaining({
            kind: "reference",
            path: path.join(skillsDir, "onepager", "references", "layout.md"),
          }),
        ]),
      },
    });
    expect(JSON.stringify(result)).not.toContain("Follow the onepager workflow.");
  });

  it("loads selected skill instruction with provenance hashes", async () => {
    const registry = createDynamicToolRegistry();
    registerSkillLoadTools(registry, {
      discoverSkills: () => discoverSkills({ skillsDir, skipSystemDirs: true, forceRefresh: true }),
    });

    const result = await registry.execute("skill_load", { skillName: "onepager" });

    expect(result).toMatchObject({
      ok: true,
      result: {
        skillName: "onepager",
        instruction: "Follow the onepager workflow.",
        manifestHash: expect.stringMatching(/^sha256:/),
        resources: expect.arrayContaining([
          expect.objectContaining({
            kind: "skill",
            sha256: expect.stringMatching(/^sha256:/),
          }),
        ]),
      },
    });
  });
});
