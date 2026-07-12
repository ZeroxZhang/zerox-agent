import { access, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SkillRecord, SkillToolDefinition } from "../shared/skills";
import { createSkillExecutor } from "./skillExecutor";

describe("skill executor entrypoint containment", () => {
  let tempDir: string;
  let skillRoot: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "zerox-skill-executor-"));
    skillRoot = path.join(tempDir, "safe-skill");
    await mkdir(skillRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("executes a script entrypoint contained in the canonical skill root", async () => {
    await writeModule(path.join(skillRoot, "entry.mjs"), "safe");

    const result = await createSkillExecutor().executeSkill(
      createSkill("./entry.mjs"),
      { taskInput: {}, log() {} },
    );

    expect(result).toEqual({ ok: true, result: { value: "safe" } });
  });

  it.each(["../outside.mjs", "absolute"])(
    "rejects an escaping script entrypoint: %s",
    async (entrypointKind) => {
      const outsidePath = path.join(tempDir, "outside.mjs");
      await writeModule(outsidePath, "outside");
      const entrypoint = entrypointKind === "absolute" ? outsidePath : entrypointKind;

      const result = await createSkillExecutor().executeSkill(
        createSkill(entrypoint),
        { taskInput: {}, log() {} },
      );

      expect(result).toMatchObject({ ok: false });
      expect(result.ok ? "" : result.error).toMatch(
        /must be relative|outside the skill root/,
      );
    },
  );

  it("rejects a contained symlink whose target escapes the skill root", async () => {
    const outsidePath = path.join(tempDir, "outside.mjs");
    await writeModule(outsidePath, "outside");
    await symlink(outsidePath, path.join(skillRoot, "linked.mjs"));

    const result = await createSkillExecutor().executeSkillTool(
      createSkill(null),
      createTool("./linked.mjs"),
      { args: {}, skillRootDir: skillRoot, log() {} },
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? "" : result.error).toContain("outside the skill root");
  });

  it("kills an isolated skill tool before a post-cancel side effect", async () => {
    const marker = path.join(tempDir, "late-side-effect.txt");
    await writeFile(
      path.join(skillRoot, "signal.mjs"),
      `import { writeFile } from "node:fs/promises";
export default async () => {
  await new Promise((resolve) => setTimeout(resolve, 200));
  await writeFile(${JSON.stringify(marker)}, "should-not-exist", "utf8");
  return { ok: true, result: { completed: true } };
};\n`,
      "utf8",
    );
    const controller = new AbortController();
    const completion = createSkillExecutor().getToolHandler(
      createSkill(null),
      createTool("./signal.mjs"),
    )({}, { signal: controller.signal });
    setTimeout(() => controller.abort(new Error("test cancellation")), 30);

    await expect(completion).resolves.toMatchObject({ ok: false });
    await new Promise((resolve) => setTimeout(resolve, 250));
    await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });

  function createSkill(entrypoint: string | null): SkillRecord {
    return {
      rootDir: skillRoot,
      skillFile: path.join(skillRoot, "SKILL.md"),
      body: "# Safe skill\n",
      manifest: {
        name: "safe-skill",
        displayName: "Safe Skill",
        description: "Containment fixture",
        version: "1.0.0",
        execution: { mode: "script", entrypoint },
        inputs: [],
        permissions: {
          files: { read: [], write: [] },
          shell: { commands: [] },
          web: { search: false, fetchDomains: [] },
          memory: { read: false, write: false },
        },
      },
    };
  }
});

function createTool(entrypoint: string): SkillToolDefinition {
  return {
    name: "safe_tool",
    description: "Containment fixture",
    parameters: { type: "object" },
    entrypoint,
  };
}

async function writeModule(filePath: string, value: string): Promise<void> {
  await writeFile(
    filePath,
    `export default () => ({ ok: true, result: { value: ${JSON.stringify(value)} } });\n`,
    "utf8",
  );
}
