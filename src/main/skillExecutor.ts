import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
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
  signal?: AbortSignal;
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
  ): (
    args: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ) => Promise<SkillExecutionResult>;
};

type SkillModule = {
  default?: (
    context: SkillExecutionContext,
  ) => Promise<SkillExecutionResult> | SkillExecutionResult;
  execute?: (
    context: SkillExecutionContext,
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

  async function resolveEntrypoint(
    rootDir: string,
    entrypoint: string,
  ): Promise<string> {
    if (path.isAbsolute(entrypoint)) {
      throw new Error("Skill entrypoint must be relative to the skill root.");
    }

    const canonicalRoot = await realpath(rootDir);
    const canonicalEntrypoint = await realpath(path.resolve(rootDir, entrypoint));
    const relative = path.relative(canonicalRoot, canonicalEntrypoint);
    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error("Skill entrypoint resolves outside the skill root.");
    }

    return canonicalEntrypoint;
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

      try {
        const entrypointPath = await resolveEntrypoint(
          skill.rootDir,
          skill.manifest.execution.entrypoint,
        );
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
      try {
        const toolPath = await resolveEntrypoint(skill.rootDir, tool.entrypoint);
        const result = await runIsolatedSkillTool(toolPath, context);

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
      return async (args: Record<string, unknown>, options?: { signal?: AbortSignal }) =>
        this.executeSkillTool(skill, tool, {
          args,
          skillRootDir: skill.rootDir,
          ...(options?.signal ? { signal: options.signal } : {}),
          log: () => {},
        });
    },
  };
}

const isolatedSkillToolWorkerSource = String.raw`
const { pathToFileURL } = require("node:url");
process.on("message", async (request) => {
  try {
    const imported = await import(pathToFileURL(request.entrypointPath).href);
    const handler = imported.default ?? imported.execute;
    if (typeof handler !== "function") {
      throw new Error("Skill tool entrypoint does not export a function.");
    }
    const result = await handler({
      args: request.args,
      skillRootDir: request.skillRootDir,
      log() {},
    });
    process.send?.({ ok: true, result }, () => process.exit(0));
  } catch (error) {
    process.send?.({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, () => process.exit(1));
  }
});
`;

async function runIsolatedSkillTool(
  entrypointPath: string,
  context: ToolExecutionContext,
): Promise<SkillExecutionResult> {
  if (context.signal?.aborted) {
    throw context.signal.reason instanceof Error
      ? context.signal.reason
      : new Error("Skill tool execution aborted.");
  }
  const child = spawn(process.execPath, ["-e", isolatedSkillToolWorkerSource], {
    detached: process.platform !== "win32",
    env: buildSkillToolChildEnv(process.env),
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  return new Promise<SkillExecutionResult>((resolve, reject) => {
    let response: SkillExecutionResult | null = null;
    let abortReason: Error | null = null;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      if (forceKillTimer) clearTimeout(forceKillTimer);
      context.signal?.removeEventListener("abort", abortHandler);
      operation();
    };
    const killGroup = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== "win32" && child.pid) {
          process.kill(-child.pid, signal);
        } else {
          child.kill(signal);
        }
      } catch {
        // The process may already have exited between the state check and kill.
      }
    };
    const abortHandler = () => {
      abortReason = context.signal?.reason instanceof Error
        ? context.signal.reason
        : new Error("Skill tool execution aborted.");
      killGroup("SIGTERM");
      forceKillTimer = setTimeout(() => killGroup("SIGKILL"), 1_000);
      forceKillTimer.unref?.();
    };

    child.on("message", (message: unknown) => {
      const payload = message as
        | { ok: true; result: SkillExecutionResult }
        | { ok: false; error: string };
      response = payload.ok
        ? payload.result
        : { ok: false, error: payload.error };
    });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("exit", () => {
      finish(() => {
        if (abortReason) {
          reject(abortReason);
        } else if (response) {
          resolve(response);
        } else {
          reject(new Error("Skill tool subprocess exited without a result."));
        }
      });
    });
    if (context.signal?.aborted) {
      abortHandler();
    } else {
      context.signal?.addEventListener("abort", abortHandler, { once: true });
    }
    if (!abortReason) {
      child.send({
        entrypointPath,
        args: context.args,
        skillRootDir: context.skillRootDir,
      });
    }
  });
}

function buildSkillToolChildEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: "1" };
  for (const key of ["HOME", "LANG", "LC_ALL", "PATH", "SHELL", "TMPDIR", "USER"] as const) {
    if (env[key] !== undefined) childEnv[key] = env[key];
  }
  return childEnv;
}
