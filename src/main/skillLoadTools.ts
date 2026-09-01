import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { DynamicToolRegistry } from "./dynamicToolRegistry";
import {
  createPublicSkillManifestSha256,
  createPublicSkillSnapshot,
  createPublicSkillSnapshotSha256,
  type SkillDiscoveryResult,
  type SkillRecord,
} from "../shared/skills";
import { verifySkillRecordFilesystemAuthority } from "./skillRegistry";

export type SkillLoadResourceKind = "skill" | "reference" | "asset" | "script";

export type SkillLoadResource = {
  kind: SkillLoadResourceKind;
  path: string;
  sizeBytes?: number;
  sha256?: string;
};

export type SkillLoadToolsOptions = {
  discoverSkills: () => Promise<SkillDiscoveryResult>;
};

export function registerSkillLoadTools(
  registry: DynamicToolRegistry,
  options: SkillLoadToolsOptions,
) {
  registry.register(
    {
      type: "function",
      function: {
        name: "skill_resource_list",
        description:
          "List a local skill's resource inventory and provenance without loading the instruction body.",
        parameters: {
          type: "object",
          properties: {
            skillName: { type: "string", description: "Skill manifest name." },
          },
          required: ["skillName"],
        },
      },
    },
    async (args) => listSkillResources(args, options),
    "built-in",
  );

  registry.register(
    {
      type: "function",
      function: {
        name: "skill_load",
        description:
          "Load a selected local skill's instruction body with manifest and resource provenance.",
        parameters: {
          type: "object",
          properties: {
            skillName: { type: "string", description: "Skill manifest name." },
          },
          required: ["skillName"],
        },
      },
    },
    async (args) => loadSkill(args, options),
    "built-in",
  );
}

async function listSkillResources(
  args: Record<string, unknown>,
  options: SkillLoadToolsOptions,
) {
  const skill = await resolveSkill(args, options);
  if (!skill.ok) {
    return skill;
  }

  const resources = await collectSkillResources(skill.skill, { includeHashes: false });
  if (!(await verifySkillRecordFilesystemAuthority(skill.skill))) {
    return { ok: false as const, error: "Skill changed while resources were being listed." };
  }
  return {
    ok: true as const,
    result: {
      skillName: skill.skill.manifest.name,
      displayName: skill.skill.manifest.displayName,
      description: skill.skill.manifest.description,
      rootDir: skill.skill.rootDir,
      resources,
    },
  };
}

async function loadSkill(
  args: Record<string, unknown>,
  options: SkillLoadToolsOptions,
) {
  const skill = await resolveSkill(args, options);
  if (!skill.ok) {
    return skill;
  }

  const resources = await collectSkillResources(skill.skill, { includeHashes: true });
  if (!(await verifySkillRecordFilesystemAuthority(skill.skill))) {
    return { ok: false as const, error: "Skill changed while it was being loaded." };
  }
  const publicSkill = createPublicSkillSnapshot(skill.skill);
  return {
    ok: true as const,
    result: {
      skillName: skill.skill.manifest.name,
      displayName: skill.skill.manifest.displayName,
      description: skill.skill.manifest.description,
      version: skill.skill.manifest.version,
      rootDir: skill.skill.rootDir,
      skillFile: skill.skill.skillFile,
      manifest: publicSkill.manifest,
      manifestHash: `sha256:${createPublicSkillManifestSha256(skill.skill)}`,
      instruction: skill.skill.body,
      resources,
    },
  };
}

async function resolveSkill(
  args: Record<string, unknown>,
  options: SkillLoadToolsOptions,
): Promise<
  | { ok: true; skill: SkillRecord }
  | { ok: false; error: string; errorDetails?: Record<string, unknown> }
> {
  const skillName = String(args.skillName ?? "").trim();
  if (!skillName) {
    return { ok: false, error: "skillName is required." };
  }

  const discovery = await options.discoverSkills();
  const skill = discovery.skills.find(
    (candidate) => candidate.manifest.name === skillName,
  );
  if (!skill) {
    return {
      ok: false,
      error: `Skill "${skillName}" was not found.`,
      errorDetails: {
        availableSkills: discovery.skills.map((candidate) => candidate.manifest.name),
      },
    };
  }

  if (!(await verifySkillRecordFilesystemAuthority(skill))) {
    return {
      ok: false,
      error: `Skill "${skillName}" changed after discovery. Refresh and select it again.`,
    };
  }
  const expectedSnapshot = String(args.skillSnapshotSha256 ?? "").trim();
  if (
    expectedSnapshot &&
    createPublicSkillSnapshotSha256(skill) !== expectedSnapshot
  ) {
    return {
      ok: false,
      error: `Skill "${skillName}" no longer matches the authorized snapshot.`,
    };
  }

  return { ok: true, skill };
}

async function collectSkillResources(
  skill: SkillRecord,
  options: { includeHashes: boolean },
): Promise<SkillLoadResource[]> {
  const resources: SkillLoadResource[] = [];
  await walkSkillRoot(skill.rootDir, resources, options);
  if (options.includeHashes) {
    const skillResource = resources.find((resource) => resource.kind === "skill");
    if (skillResource) {
      const publicSkill = createPublicSkillSnapshot(skill);
      skillResource.sha256 = `sha256:${hashString(JSON.stringify({
        manifest: publicSkill.manifest,
        instruction: publicSkill.body,
      }))}`;
    }
  }
  return resources.sort((left, right) => {
    if (left.kind === "skill" && right.kind !== "skill") return -1;
    if (right.kind === "skill" && left.kind !== "skill") return 1;
    return left.path.localeCompare(right.path);
  });
}

async function walkSkillRoot(
  directory: string,
  resources: SkillLoadResource[],
  options: { includeHashes: boolean },
) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const entryPath = path.join(directory, entry.name);
    const canonicalEntry = await realpath(entryPath);
    if (
      canonicalEntry !== entryPath ||
      !canonicalEntry.startsWith(`${path.resolve(directory)}${path.sep}`)
    ) {
      throw new Error("Skill resources may not contain symbolic links.");
    }
    if (entry.isDirectory()) {
      await walkSkillRoot(entryPath, resources, options);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    const fileStat = await stat(entryPath);
    const resource: SkillLoadResource = {
      kind: classifySkillResource(entryPath),
      path: entryPath,
      sizeBytes: fileStat.size,
    };
    if (options.includeHashes && resource.kind !== "skill") {
      resource.sha256 = `sha256:${hashString(await readFile(entryPath, "utf8"))}`;
    }
    resources.push(resource);
  }
}

function classifySkillResource(filePath: string): SkillLoadResourceKind {
  const normalized = filePath.split(path.sep);
  const fileName = normalized.at(-1);
  if (fileName === "SKILL.md") {
    return "skill";
  }
  if (normalized.includes("assets")) {
    return "asset";
  }
  if (normalized.includes("scripts")) {
    return "script";
  }
  return "reference";
}

function hashString(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
