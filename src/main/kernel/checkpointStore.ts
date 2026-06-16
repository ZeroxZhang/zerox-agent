import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ChatMessage } from "../openAiCompatibleClient";

export type KernelCheckpoint = {
  ref: string;
  runId: string;
  turn: number;
  fullMessages: ChatMessage[];
  goalContinuity?: string;
  planSnapshot?: unknown;
  createdAt: string;
};

export type KernelCheckpointWriteInput = {
  runId: string;
  turn: number;
  fullMessages: ChatMessage[];
  goalContinuity?: string;
  planSnapshot?: unknown;
};

export type KernelCheckpointRebuild = {
  checkpoint: KernelCheckpoint;
  messages: ChatMessage[];
};

export type KernelCheckpointStore = {
  writeCheckpoint(input: KernelCheckpointWriteInput): Promise<KernelCheckpoint>;
  readCheckpoint(ref: string): Promise<KernelCheckpoint | null>;
  rebuild(ref: string): Promise<KernelCheckpointRebuild | null>;
};

export function createKernelCheckpointStore(options: {
  configDir: string;
  createId?: () => string;
  now?: () => string;
  rootName?: string;
}): KernelCheckpointStore {
  const createId = options.createId ?? (() => `checkpoint_${Date.now()}`);
  const now = options.now ?? (() => new Date().toISOString());
  const rootName = options.rootName ?? "kernel-checkpoints";
  const rootDir = path.join(options.configDir, rootName);

  async function readKernelCheckpoint(ref: string): Promise<KernelCheckpoint | null> {
    const absolutePath = resolveCheckpointPath(options.configDir, rootName, ref);
    if (!absolutePath) {
      return null;
    }

    try {
      const raw = await readFile(absolutePath, "utf8");
      return JSON.parse(raw) as KernelCheckpoint;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }

      throw error;
    }
  }

  return {
    async writeCheckpoint(input) {
      await mkdir(path.join(rootDir, sanitizePathSegment(input.runId)), {
        recursive: true,
      });
      const ref = path.posix.join(
        rootName,
        sanitizePathSegment(input.runId),
        `${sanitizePathSegment(createId())}.json`,
      );
      const absolutePath = resolveCheckpointPath(options.configDir, rootName, ref);
      if (!absolutePath) {
        throw new Error("Unable to resolve kernel checkpoint path.");
      }

      const checkpoint: KernelCheckpoint = {
        ref,
        runId: input.runId,
        turn: input.turn,
        fullMessages: input.fullMessages,
        ...(input.goalContinuity ? { goalContinuity: input.goalContinuity } : {}),
        ...(input.planSnapshot !== undefined
          ? { planSnapshot: input.planSnapshot }
          : {}),
        createdAt: now(),
      };
      await writeFile(absolutePath, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
      return checkpoint;
    },

    readCheckpoint(ref) {
      return readKernelCheckpoint(ref);
    },

    async rebuild(ref) {
      const checkpoint = await readKernelCheckpoint(ref);
      if (!checkpoint) {
        return null;
      }

      return {
        checkpoint,
        messages: checkpoint.fullMessages,
      };
    },
  };
}

function resolveCheckpointPath(
  configDir: string,
  rootName: string,
  ref: string,
): string | null {
  const allowedRoot = path.resolve(configDir, rootName);
  const absolutePath = path.resolve(configDir, ref);
  if (
    absolutePath !== allowedRoot &&
    !absolutePath.startsWith(`${allowedRoot}${path.sep}`)
  ) {
    return null;
  }

  return absolutePath;
}

function sanitizePathSegment(value: string): string {
  const sanitized = value
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return sanitized || "checkpoint";
}
