// registerWorkflowAsSkill (contracts v1.4 §6 Patch 24, P7 implements).
//
// Packages a workflow as a discoverable skill: writes a SKILL.md (mode:"agent"
// preferred — prompt-based, no arbitrary code) to the app-local skillsDir under
// a path-guarded slug, and registers a dynamic entry in the workflow catalog.
// Path-guard: the slug must not escape skillsDir (no `../`, no absolute paths).

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { WorkflowRuntime } from "./workflowRuntime";

export interface SkillMeta {
  name: string; // slug, ^[a-z0-9][a-z0-9-]*$
  displayName: string;
  description: string;
  mode: "agent" | "script";
  agentPrompt?: string;
  workflowScript?: string;
  permissions: Record<string, unknown>;
  tools?: string[];
  sourceRunIds: string[];
}

export interface RegisterWorkflowAsSkillResult {
  skillId: string;
  skillPath: string;
  workflowId: string;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

export async function registerWorkflowAsSkill(
  workflowRuntime: WorkflowRuntime,
  workflowName: string,
  skillMeta: SkillMeta,
  options?: { skillsDir?: string },
): Promise<RegisterWorkflowAsSkillResult> {
  // Path-guard: validate the slug; reject traversal / absolute paths.
  if (!SLUG_RE.test(skillMeta.name)) {
    throw new Error(`registerWorkflowAsSkill: invalid skill name "${skillMeta.name}" (must match ${SLUG_RE})`);
  }
  if (skillMeta.name.includes("..") || path.isAbsolute(skillMeta.name)) {
    throw new Error(`registerWorkflowAsSkill: skill name must not escape skillsDir`);
  }

  const skillsDir = options?.skillsDir ?? path.join(process.cwd(), "skills", "distilled");
  const skillDir = path.join(skillsDir, skillMeta.name);
  const skillPath = path.join(skillDir, "SKILL.md");
  // Final containment check (defence in depth).
  const resolved = path.resolve(skillPath);
  const resolvedRoot = path.resolve(skillsDir);
  if (!resolved.startsWith(resolvedRoot + path.sep) && resolved !== resolvedRoot) {
    throw new Error("registerWorkflowAsSkill: resolved path escapes skillsDir");
  }

  await mkdir(skillDir, { recursive: true });
  const frontmatter = [
    "---",
    `name: ${skillMeta.name}`,
    `description: ${escapeYaml(skillMeta.description)}`,
    `mode: ${skillMeta.mode}`,
    ...(skillMeta.tools?.length ? [`tools: ${JSON.stringify(skillMeta.tools)}`] : []),
    `sourceRunIds: ${JSON.stringify(skillMeta.sourceRunIds)}`,
    "---",
  ].join("\n");
  const body = skillMeta.mode === "agent"
    ? (skillMeta.agentPrompt ?? skillMeta.description)
    : (skillMeta.workflowScript ?? "");
  const content = `${frontmatter}\n\n# ${skillMeta.displayName}\n\n${body}\n`;
  await writeFile(skillPath, content, "utf8");

  // Register a dynamic workflow entry so the workflow tool can list/run it.
  workflowRuntime.register(`skill:${skillMeta.name}`, async () => ({
    skillId: skillMeta.name,
    mode: skillMeta.mode,
    packagedAt: new Date().toISOString(),
  }));

  return {
    skillId: skillMeta.name,
    skillPath,
    workflowId: `skill:${skillMeta.name}`,
  };
}

function escapeYaml(value: string): string {
  return value.replace(/"/g, '\\"');
}

// Re-export the workflowId generator for callers that need to list distilled skills.
export function distilledSkillWorkflowId(name: string): string {
  return `skill:${name}`;
}

export { randomUUID };
