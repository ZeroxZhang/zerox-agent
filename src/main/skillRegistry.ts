import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  parseSkillMarkdown,
  publicSkillSnapshotsEqual,
  type SkillDiscoveryError,
  type SkillDiscoveryResult,
  type SkillMcpRemoteServerConfig,
  type SkillMcpStdioServerConfig,
  type SkillRecord,
  type SkillFilesystemIdentity,
  type SkillSnapshotSource,
} from "../shared/skills";

export type SkillGraph = {
  skills: SkillRecord[];
  order: string[];
  errors: SkillDiscoveryError[];
};

export type McpServerInitConfig =
  | (Omit<SkillMcpStdioServerConfig, "readRoots"> & {
      sourceSkill: string;
      readRoots: string[];
    })
  | (SkillMcpRemoteServerConfig & {
      sourceSkill: string;
    });

export type SkillRegistryResult = SkillDiscoveryResult & {
  mcpServers: McpServerInitConfig[];
  graph: Map<string, string[]>;
};

export function shouldAutoInitializeSkillMcp(
  env: Record<string, string | undefined>,
): boolean {
  return (
    env.ZEROX_ENABLE_SKILL_MCP === "1" &&
    readTrustedSkillMcpAllowlist(env).size > 0
  );
}

export function readTrustedSkillMcpAllowlist(
  env: Record<string, string | undefined>,
): ReadonlySet<string> {
  const entries = (env.ZEROX_SKILL_MCP_ALLOWLIST ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return new Set(
    entries.filter((entry) =>
      /^[a-z0-9][a-z0-9-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(entry),
    ),
  );
}

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
  skipSystemDirs?: boolean;
  trustedServers: ReadonlySet<string>;
}): Promise<McpServerInitConfig[]> {
  const { skills } = await discoverSkills({
    skillsDir: options.skillsDir,
    extraDirs: options.extraDirs,
    skipSystemDirs: options.skipSystemDirs,
    forceRefresh: true,
  });
  const seen = new Set<string>();
  const configs: McpServerInitConfig[] = [];

  for (const skill of skills) {
    if (skill.manifest.mcpServers) {
      for (const server of skill.manifest.mcpServers) {
        if (
          !options.trustedServers.has(
            trustedSkillMcpServerKey(skill.manifest.name, server.name),
          )
        ) {
          continue;
        }
        if (seen.has(server.name)) continue;
        seen.add(server.name);
        configs.push(
          server.transport === "stdio"
            ? {
                ...server,
                sourceSkill: skill.manifest.name,
                readRoots: resolveMcpReadRoots(
                  skill.rootDir,
                  server.readRoots ?? [],
                ),
              }
            : {
                ...server,
                sourceSkill: skill.manifest.name,
              },
        );
      }
    }
  }

  return configs;
}

export function trustedSkillMcpServerKey(
  skillName: string,
  serverName: string,
): string {
  return `${skillName}/${serverName}`;
}

function resolveMcpReadRoots(
  skillRoot: string,
  configuredRoots: readonly string[],
): string[] {
  const canonicalSkillRoot = path.resolve(skillRoot);
  const roots = configuredRoots.map((root) => {
    const resolved = path.isAbsolute(root)
      ? path.resolve(root)
      : path.resolve(canonicalSkillRoot, root);
    if (
      !path.isAbsolute(root) &&
      resolved !== canonicalSkillRoot &&
      !resolved.startsWith(`${canonicalSkillRoot}${path.sep}`)
    ) {
      throw new Error(
        `MCP read root escapes Skill directory: ${root}`,
      );
    }
    return resolved;
  });
  return [...new Set([canonicalSkillRoot, ...roots])];
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

    const entryPath = path.join(skillsDir, entry.name);

    try {
      const rootDir = await realpath(entryPath);
      const rootStat = await stat(rootDir, { bigint: true });
      if (!rootStat.isDirectory()) continue;
      const skillFile = await realpath(path.join(rootDir, "SKILL.md"));
      if (!isPathInside(rootDir, skillFile)) {
        throw new Error("SKILL.md escapes the canonical Skill root.");
      }
      const skillFileStat = await stat(skillFile, { bigint: true });
      if (!skillFileStat.isFile()) continue;
      const markdown = await readFile(skillFile, "utf8");
      const parsed = parseSkillMarkdown(markdown);
      const skill: SkillRecord = {
        ...parsed,
        rootDir,
        skillFile,
        rootIdentity: filesystemIdentity(rootStat),
        skillFileIdentity: filesystemIdentity(skillFileStat),
      };
      skills.push(skill);
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

export async function verifySkillRecordFilesystemAuthority(
  skill: SkillSnapshotSource,
): Promise<boolean> {
  if (!skill.rootIdentity || !skill.skillFileIdentity) return false;
  try {
    const canonicalRoot = await realpath(skill.rootDir);
    const canonicalSkillFile = await realpath(skill.skillFile);
    if (
      canonicalRoot !== skill.rootDir ||
      canonicalSkillFile !== skill.skillFile ||
      !isPathInside(canonicalRoot, canonicalSkillFile)
    ) {
      return false;
    }
    const [rootStat, skillFileStat, markdown] = await Promise.all([
      stat(canonicalRoot, { bigint: true }),
      stat(canonicalSkillFile, { bigint: true }),
      readFile(canonicalSkillFile, "utf8"),
    ]);
    const parsed = parseSkillMarkdown(markdown);
    const current: SkillRecord = {
      ...parsed,
      rootDir: canonicalRoot,
      skillFile: canonicalSkillFile,
      rootIdentity: filesystemIdentity(rootStat),
      skillFileIdentity: filesystemIdentity(skillFileStat),
    };
    return (
      rootStat.isDirectory() &&
      skillFileStat.isFile() &&
      identitiesEqual(skill.rootIdentity, filesystemIdentity(rootStat)) &&
      identitiesEqual(skill.skillFileIdentity, filesystemIdentity(skillFileStat)) &&
      publicSkillSnapshotsEqual(current, skill)
    );
  } catch {
    return false;
  }
}

function filesystemIdentity(value: { dev: bigint; ino: bigint }): SkillFilesystemIdentity {
  return { dev: value.dev.toString(), ino: value.ino.toString() };
}

function identitiesEqual(
  left: SkillFilesystemIdentity,
  right: SkillFilesystemIdentity,
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function isPathInside(rootDir: string, candidate: string): boolean {
  return candidate === rootDir || candidate.startsWith(`${rootDir}${path.sep}`);
}
