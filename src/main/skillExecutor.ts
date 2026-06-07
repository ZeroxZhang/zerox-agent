import path from "node:path";
import type { SkillRecord, SkillToolDefinition } from "../shared/skills";

export type SkillExecutionContext = {
  taskInput: Record<string, unknown>;
  log: (message: string, data?: Record<string, unknown>) => void;
};

export type SkillExecutionResult =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; error: string };

export type ToolExecutionContext = {
  args: Record<string, unknown>;
  skillRootDir: string;
  log: (message: string, data?: Record<string, unknown>) => void;
};

export type SkillExecutor = {
  executeSkill(
    skill: SkillRecord,
    context: SkillExecutionContext,
  ): Promise<SkillExecutionResult>;
  executeSkillTool(
    skill: SkillRecord,
    tool: SkillToolDefinition,
    context: ToolExecutionContext,
  ): Promise<SkillExecutionResult>;
  getToolHandler(
    skill: SkillRecord,
    tool: SkillToolDefinition,
  ): (args: Record<string, unknown>) => Promise<SkillExecutionResult>;
};

type SkillModule = {
  default?: (
    context: SkillExecutionContext,
  ) => Promise<SkillExecutionResult> | SkillExecutionResult;
  execute?: (
    context: SkillExecutionContext,
  ) => Promise<SkillExecutionResult> | SkillExecutionResult;
};

type ToolModule = {
  default?: (
    context: ToolExecutionContext,
  ) => Promise<SkillExecutionResult> | SkillExecutionResult;
  execute?: (
    context: ToolExecutionContext,
  ) => Promise<SkillExecutionResult> | SkillExecutionResult;
};

export function createSkillExecutor(): SkillExecutor {
  const moduleCache = new Map<string, unknown>();

  async function importModule(modulePath: string): Promise<unknown> {
    const cached = moduleCache.get(modulePath);
    if (cached) return cached;

    const imported = await import(modulePath);
    moduleCache.set(modulePath, imported);
    return imported;
  }

  function resolveEntrypoint(rootDir: string, entrypoint: string): string {
    if (entrypoint.startsWith("./") || entrypoint.startsWith("../")) {
      return path.resolve(rootDir, entrypoint);
    }
    if (path.isAbsolute(entrypoint)) {
      return entrypoint;
    }
    return path.resolve(rootDir, entrypoint);
  }

  return {
    async executeSkill(skill, context) {
      if (skill.manifest.execution.mode !== "script") {
        return {
          ok: false,
          error: `Skill "${skill.manifest.name}" does not support script execution.`,
        };
      }

      if (!skill.manifest.execution.entrypoint) {
        return {
          ok: false,
          error: `Skill "${skill.manifest.name}" has no entrypoint configured.`,
        };
      }

      const entrypointPath = resolveEntrypoint(
        skill.rootDir,
        skill.manifest.execution.entrypoint,
      );

      try {
        const module = (await importModule(entrypointPath)) as SkillModule;
        const handler = module.default ?? module.execute;

        if (typeof handler !== "function") {
          return {
            ok: false,
            error: `Skill "${skill.manifest.name}" entrypoint does not export a function.`,
          };
        }

        const result = await handler(context);

        if (!result || typeof result.ok !== "boolean") {
          return {
            ok: false,
            error: `Skill "${skill.manifest.name}" returned an invalid result.`,
          };
        }

        return result;
      } catch (error) {
        return {
          ok: false,
          error: `Skill "${skill.manifest.name}" execution failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        };
      }
    },

    async executeSkillTool(skill, tool, context) {
      const toolPath = resolveEntrypoint(skill.rootDir, tool.entrypoint);

      try {
        const module = (await importModule(toolPath)) as ToolModule;
        const handler = module.default ?? module.execute;

        if (typeof handler !== "function") {
          return {
            ok: false,
            error: `Skill tool "${tool.name}" does not export a function.`,
          };
        }

        const result = await handler(context);

        if (!result || typeof result.ok !== "boolean") {
          return {
            ok: false,
            error: `Skill tool "${tool.name}" returned an invalid result.`,
          };
        }

        return result;
      } catch (error) {
        return {
          ok: false,
          error: `Skill tool "${tool.name}" failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        };
      }
    },

    getToolHandler(skill, tool) {
      return async (args: Record<string, unknown>) =>
        this.executeSkillTool(skill, tool, {
          args,
          skillRootDir: skill.rootDir,
          log: () => {},
        });
    },
  };
}
