import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { DynamicToolRegistry } from "./dynamicToolRegistry";
import type { SkillDiscoveryResult, SkillRecord } from "../shared/skills";

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
  return {
    ok: true as const,
    result: {
      skillName: skill.skill.manifest.name,
      displayName: skill.skill.manifest.displayName,
      description: skill.skill.manifest.description,
      version: skill.skill.manifest.version,
      rootDir: skill.skill.rootDir,
      skillFile: skill.skill.skillFile,
      manifest: skill.skill.manifest,
      manifestHash: `sha256:${hashString(JSON.stringify(skill.skill.manifest))}`,
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

  return { ok: true, skill };
}

async function collectSkillResources(
  skill: SkillRecord,
  options: { includeHashes: boolean },
): Promise<SkillLoadResource[]> {
  const resources: SkillLoadResource[] = [];
  await walkSkillRoot(skill.rootDir, resources, options);
  return resources.sort((left, right) => left.path.localeCompare(right.path));
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
    if (options.includeHashes) {
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
