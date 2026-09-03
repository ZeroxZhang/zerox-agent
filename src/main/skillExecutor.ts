import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import path from "node:path";
import type { SkillRecord, SkillToolDefinition } from "../shared/skills";
import { verifySkillRecordFilesystemAuthority } from "./skillRegistry";

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

/**
 * Skill code never executes in the Electron main process: script-mode runs
 * and skill tools are both dispatched to a restricted child worker over IPC.
 * The worker imports the skill entrypoint itself, so a crashing or hostile
 * skill cannot take down the app process. Execution is bounded by an
 * abort signal and a hard timeout.
 */
const SKILL_WORKER_DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

type SkillWorkerRequest =
  | {
      kind: "execute";
      entrypointPath: string;
      taskInput: Record<string, unknown>;
    }
  | {
      kind: "tool";
      entrypointPath: string;
      args: Record<string, unknown>;
      skillRootDir: string;
    };

type SkillWorkerResponse =
  | { kind: "result"; ok: true; result: SkillExecutionResult }
  | { kind: "result"; ok: false; error: string }
  | { kind: "log"; message: string; data?: Record<string, unknown> };

// CommonJS worker body executed as `node -e` in a detached child. It imports
// the skill entrypoint by absolute path (containment is verified in the
// parent before dispatch) and streams logs back over the IPC channel.
const isolatedSkillWorkerSource = String.raw`
const { pathToFileURL } = require("node:url");
const send = (payload, callback) => process.send?.(payload, callback);
process.on("message", async (request) => {
  try {
    const imported = await import(pathToFileURL(request.entrypointPath).href);
    const handler = imported.default ?? imported.execute;
    if (typeof handler !== "function") {
      throw new Error("Skill entrypoint does not export a function.");
    }
    const context = request.kind === "execute"
      ? {
          taskInput: request.taskInput,
          log(message, data) { send({ kind: "log", message, data }); },
        }
      : {
          args: request.args,
          skillRootDir: request.skillRootDir,
          log(message, data) { send({ kind: "log", message, data }); },
        };
    const result = await handler(context);
    if (!result || typeof result.ok !== "boolean") {
      throw new Error("Skill returned an invalid result.");
    }
    send({ kind: "result", ok: true, result }, () => process.exit(0));
  } catch (error) {
    send({
      kind: "result",
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, () => process.exit(1));
  }
});
`;

export function createSkillExecutor(): SkillExecutor {
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
      try {
        if (
          skill.rootIdentity &&
          !(await verifySkillRecordFilesystemAuthority(skill))
        ) {
          throw new Error("Skill changed after authorization.");
        }
        if (skill.manifest.execution.mode !== "script") {
          throw new Error(`Skill "${skill.manifest.name}" does not support script execution.`);
        }

        if (!skill.manifest.execution.entrypoint) {
          throw new Error(`Skill "${skill.manifest.name}" has no entrypoint configured.`);
        }

        const entrypointPath = await resolveEntrypoint(
          skill.rootDir,
          skill.manifest.execution.entrypoint,
        );
        const outcome = await runSkillWorker({
          request: {
            kind: "execute",
            entrypointPath,
            taskInput: context.taskInput,
          },
          onLog: context.log,
        });
        return outcome;
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
        if (
          skill.rootIdentity &&
          !(await verifySkillRecordFilesystemAuthority(skill))
        ) {
          throw new Error("Skill changed after authorization.");
        }
        const toolPath = await resolveEntrypoint(skill.rootDir, tool.entrypoint);
        const outcome = await runSkillWorker({
          request: {
            kind: "tool",
            entrypointPath: toolPath,
            args: context.args,
            skillRootDir: context.skillRootDir,
          },
          signal: context.signal,
          onLog: context.log,
        });
        if (!outcome || typeof outcome.ok !== "boolean") {
          return {
            ok: false,
            error: `Skill tool "${tool.name}" returned an invalid result.`,
          };
        }
        return outcome;
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
      return async (
        args: Record<string, unknown>,
        options?: { signal?: AbortSignal },
      ) =>
        this.executeSkillTool(skill, tool, {
          args,
          skillRootDir: skill.rootDir,
          ...(options?.signal ? { signal: options.signal } : {}),
          log: () => {},
        });
    },
  };
}

async function runSkillWorker(input: {
  request: SkillWorkerRequest;
  signal?: AbortSignal;
  timeoutMs?: number;
  onLog?: (message: string, data?: Record<string, unknown>) => void;
}): Promise<SkillExecutionResult> {
  const timeoutMs = input.timeoutMs ?? SKILL_WORKER_DEFAULT_TIMEOUT_MS;
  const signal = input.signal;
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("Skill execution aborted.");
  }
  const child = spawn(process.execPath, ["-e", isolatedSkillWorkerSource], {
    detached: process.platform !== "win32",
    env: buildSkillWorkerChildEnv(process.env),
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  return new Promise<SkillExecutionResult>((resolve, reject) => {
    let response: SkillExecutionResult | null = null;
    let abortReason: Error | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      signal?.removeEventListener("abort", abortHandler);
      operation();
    };
    const killGroup = (killSignal: NodeJS.Signals) => {
      try {
        if (process.platform !== "win32" && child.pid) {
          process.kill(-child.pid, killSignal);
        } else {
          child.kill(killSignal);
        }
      } catch {
        // The process may already have exited between the state check and kill.
      }
    };
    const abortHandler = () => {
      abortReason =
        signal?.reason instanceof Error
          ? signal.reason
          : new Error("Skill execution aborted.");
      killGroup("SIGTERM");
      forceKillTimer = setTimeout(() => killGroup("SIGKILL"), 1_000);
      forceKillTimer.unref?.();
    };

    child.on("message", (message: unknown) => {
      const payload = message as SkillWorkerResponse;
      if (payload.kind === "log") {
        input.onLog?.(payload.message, payload.data);
        return;
      }
      response = payload.ok ? payload.result : { ok: false, error: payload.error };
    });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("exit", () => {
      finish(() => {
        if (abortReason) {
          reject(abortReason);
        } else if (response) {
          resolve(response);
        } else {
          reject(new Error("Skill subprocess exited without a result."));
        }
      });
    });
    if (signal?.aborted) {
      abortHandler();
    } else {
      signal?.addEventListener("abort", abortHandler, { once: true });
    }
    if (!abortReason) {
      timeoutTimer = setTimeout(() => {
        abortReason = new Error(`Skill execution timed out after ${Math.round(timeoutMs / 1000)}s.`);
        killGroup("SIGTERM");
        forceKillTimer = setTimeout(() => killGroup("SIGKILL"), 1_000);
        forceKillTimer.unref?.();
      }, timeoutMs);
      timeoutTimer.unref?.();
      child.send(input.request);
    }
  });
}

function buildSkillWorkerChildEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: "1" };
  for (const key of ["HOME", "LANG", "LC_ALL", "PATH", "SHELL", "TMPDIR", "USER"] as const) {
    if (env[key] !== undefined) childEnv[key] = env[key];
  }
  return childEnv;
}
