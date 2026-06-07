import { readdir, readFile, lstat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  parseSkillMarkdown,
  type SkillDiscoveryError,
  type SkillDiscoveryResult,
  type SkillRecord,
} from "../shared/skills";

export type SkillGraph = {
  skills: SkillRecord[];
  order: string[];
  errors: SkillDiscoveryError[];
};

export type McpServerInitConfig = {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  sourceSkill: string;
};

export type SkillRegistryResult = SkillDiscoveryResult & {
  mcpServers: McpServerInitConfig[];
  graph: Map<string, string[]>;
};

function getDefaultSkillDirs(): string[] {
  const home = os.homedir();
  return [
    path.join(home, ".claude", "skills"),
    path.join(home, ".agents", "skills"),
  ];
}

let cachedResult: SkillDiscoveryResult | null = null;
let cacheTimestamp = 0;
const cacheTtlMs = 30_000; // 30-second cache

export async function discoverSkills(options: {
  skillsDir: string;
  extraDirs?: string[];
  forceRefresh?: boolean;
  skipSystemDirs?: boolean;
}): Promise<SkillDiscoveryResult> {
  const now = Date.now();
  if (!options.forceRefresh && cachedResult && (now - cacheTimestamp) < cacheTtlMs) {
    return cachedResult;
  }

  const systemDirs = options.skipSystemDirs ? [] : getDefaultSkillDirs();
  const dirs = [options.skillsDir, ...(options.extraDirs ?? []), ...systemDirs];
  const uniqueDirs = [...new Set(dirs.map((d) => path.resolve(d)))];
  const { skills, errors } = await scanSkillDirectories(uniqueDirs);
  cachedResult = { skills, errors };
  cacheTimestamp = now;
  return cachedResult;
}

export async function buildSkillGraph(options: {
  skillsDir: string;
  extraDirs?: string[];
}): Promise<SkillGraph> {
  const { skills, errors } = await discoverSkills(options);

  const skillMap = new Map<string, SkillRecord>();
  for (const skill of skills) {
    // First-come wins (app-local overrides system)
    if (!skillMap.has(skill.manifest.name)) {
      skillMap.set(skill.manifest.name, skill);
    }
  }

  const order = resolveDependencyOrder(skillMap);

  return { skills: [...skillMap.values()], order, errors };
}

export async function collectSkillMcpConfigs(options: {
  skillsDir: string;
  extraDirs?: string[];
}): Promise<McpServerInitConfig[]> {
  const { skills } = await discoverSkills(options);
  const seen = new Set<string>();
  const configs: McpServerInitConfig[] = [];

  for (const skill of skills) {
    if (skill.manifest.mcpServers) {
      for (const server of skill.manifest.mcpServers) {
        if (seen.has(server.name)) continue;
        seen.add(server.name);
        configs.push({
          name: server.name,
          command: server.command,
          args: server.args,
          env: server.env,
          sourceSkill: skill.manifest.name,
        });
      }
    }
  }

  return configs;
}

function resolveDependencyOrder(
  skillMap: Map<string, SkillRecord>,
): string[] {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const order: string[] = [];

  function visit(name: string) {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      return; // circular dependency, skip
    }

    visiting.add(name);

    const skill = skillMap.get(name);
    if (skill?.manifest.dependencies) {
      for (const dep of skill.manifest.dependencies) {
        if (skillMap.has(dep)) {
          visit(dep);
        }
      }
    }

    visiting.delete(name);
    visited.add(name);
    order.push(name);
  }

  for (const name of skillMap.keys()) {
    visit(name);
  }

  return order;
}

async function scanSkillDirectories(
  dirs: string[],
): Promise<{ skills: SkillRecord[]; errors: SkillDiscoveryError[] }> {
  const allSkills: SkillRecord[] = [];
  const allErrors: SkillDiscoveryError[] = [];
  const seenNames = new Set<string>();

  for (const skillsDir of dirs) {
    const { skills, errors } = await scanOneDirectory(skillsDir);

    for (const skill of skills) {
      // Deduplicate: app-local skills override system skills
      if (!seenNames.has(skill.manifest.name)) {
        seenNames.add(skill.manifest.name);
        allSkills.push(skill);
      }
    }
    allErrors.push(...errors);
  }

  return {
    skills: allSkills.sort((a, b) =>
      a.manifest.displayName.localeCompare(b.manifest.displayName),
    ),
    errors: allErrors,
  };
}

async function scanOneDirectory(
  skillsDir: string,
): Promise<{ skills: SkillRecord[]; errors: SkillDiscoveryError[] }> {
  const skills: SkillRecord[] = [];
  const errors: SkillDiscoveryError[] = [];

  let entries: Array<{ isDirectory: () => boolean; isSymbolicLink: () => boolean; name: string }>;

  try {
    const rawEntries = await readdir(skillsDir, { withFileTypes: true });
    entries = rawEntries.map((entry) => ({
      isDirectory: () => entry.isDirectory() || entry.isSymbolicLink(),
      isSymbolicLink: () => entry.isSymbolicLink(),
      name: String(entry.name),
    }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { skills, errors };
    }
    throw error;
  }

  for (const entry of entries) {
    // Skip hidden files and non-directories
    if (entry.name.startsWith(".") || entry.name === "output") {
      continue;
    }

    if (!entry.isDirectory()) {
      continue;
    }

    let rootDir = path.join(skillsDir, entry.name);

    // Resolve symlinks to get the real directory
    if (entry.isSymbolicLink()) {
      try {
        const linkStat = await lstat(rootDir);
        if (linkStat.isSymbolicLink()) {
          const realPath = await readFile(rootDir, "utf8").catch(() => "");
          // Use readlink via lstat; for symlink dirs, construct the real path
          rootDir = path.resolve(skillsDir, entry.name);
        }
      } catch {
        // If we can't resolve, try the path as-is
      }
    }

    const skillFile = path.join(rootDir, "SKILL.md");

    try {
      const markdown = await readFile(skillFile, "utf8");
      const parsed = parseSkillMarkdown(markdown);
      skills.push({
        ...parsed,
        rootDir,
        skillFile,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }

      errors.push({
        folderName: entry.name,
        message:
          error instanceof Error ? error.message : "Unable to parse skill.",
      });
    }
  }

  return { skills, errors };
}
