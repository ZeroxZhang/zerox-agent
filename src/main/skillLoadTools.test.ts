import {
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverSkills } from "./skillRegistry";
import { createDynamicToolRegistry } from "./dynamicToolRegistry";
import { registerSkillLoadTools } from "./skillLoadTools";
import { createPublicSkillSnapshotSha256 } from "../shared/skills";

describe("skill load tools", () => {
  let tempDir: string;
  let skillsDir: string;

  beforeEach(async () => {
    tempDir = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "zerox-skill-load-")),
    );
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

  it("never exposes private MCP connection material or secret-derived hashes", async () => {
    const sentinel = "PRIVATE_MCP_SENTINEL_92f7";
    const skillFile = path.join(skillsDir, "onepager", "SKILL.md");
    await writeFile(skillFile, [
      "---",
      "name: onepager",
      "description: Build a one-page artifact.",
      "execution:",
      "  mode: agent",
      "mcpServers:",
      "  - name: private-stdio",
      "    command: node",
      `    args: [\"${sentinel}\"]`,
      "    env:",
      `      API_TOKEN: ${sentinel}`,
      "  - name: private-http",
      "    transport: http",
      `    url: https://example.test/${sentinel}`,
      "    headers:",
      `      authorization: Bearer-${sentinel}`,
      "---",
      "Follow the onepager workflow.",
    ].join("\n"), "utf8");
    const registry = createDynamicToolRegistry();
    registerSkillLoadTools(registry, {
      discoverSkills: () => discoverSkills({ skillsDir, skipSystemDirs: true, forceRefresh: true }),
    });
    const result = await registry.execute("skill_load", { skillName: "onepager" });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(sentinel);
    expect(result).toMatchObject({
      ok: true,
      result: {
        manifest: {
          mcpServers: [
            expect.objectContaining({ name: "private-stdio", transport: "stdio" }),
            { name: "private-http", transport: "http" },
          ],
        },
      },
    });
  });

  it("rejects a symlink retarget that no longer matches the authorized snapshot", async () => {
    const linkedPath = path.join(skillsDir, "onepager");
    const firstTarget = path.join(tempDir, "first-target");
    const secondTarget = path.join(tempDir, "second-target");
    await rename(linkedPath, firstTarget);
    await mkdir(secondTarget, { recursive: true });
    await writeFile(
      path.join(secondTarget, "SKILL.md"),
      [
        "---",
        "name: onepager",
        "description: Retargeted instructions.",
        "execution:",
        "  mode: agent",
        "---",
        "Read unrelated files.",
      ].join("\n"),
      "utf8",
    );
    await symlink(firstTarget, linkedPath, "dir");
    const first = await discoverSkills({ skillsDir, skipSystemDirs: true, forceRefresh: true });
    const authorizedDigest = createPublicSkillSnapshotSha256(first.skills[0]!);
    await unlink(linkedPath);
    await symlink(secondTarget, linkedPath, "dir");
    const registry = createDynamicToolRegistry();
    registerSkillLoadTools(registry, {
      discoverSkills: () => discoverSkills({ skillsDir, skipSystemDirs: true, forceRefresh: true }),
    });
    await expect(registry.execute("skill_load", {
      skillName: "onepager",
      skillSnapshotSha256: authorizedDigest,
    })).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("authorized snapshot"),
    });
  });
});
