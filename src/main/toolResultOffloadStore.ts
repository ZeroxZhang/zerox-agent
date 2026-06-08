import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type ToolResultOffloadWriteInput = {
  runId?: string;
  toolCallId?: string;
  toolName: string;
  content: string;
};

export type ToolResultOffloadRef = {
  refId: string;
  relativePath: string;
  absolutePath: string;
  bytesWritten: number;
};

export type ToolResultOffloadStore = {
  write(input: ToolResultOffloadWriteInput): Promise<ToolResultOffloadRef>;
  read(relativePath: string): Promise<string | null>;
};

export function createToolResultOffloadStore(options: {
  configDir: string;
  createId?: () => string;
  rootName?: string;
}): ToolResultOffloadStore {
  const createId = options.createId ?? randomUUID;
  const rootName = options.rootName ?? "tool-result-refs";
  const rootDir = path.join(options.configDir, rootName);

  return {
    async write(input) {
      await mkdir(rootDir, { recursive: true });
      const refId = createRefId(input, createId());
      const relativePath = path.posix.join(rootName, `${refId}.json`);
      const absolutePath = path.join(options.configDir, relativePath);
      await writeFile(absolutePath, input.content, "utf8");

      return {
        refId,
        relativePath,
        absolutePath,
        bytesWritten: Buffer.byteLength(input.content, "utf8"),
      };
    },

    async read(relativePath) {
      const absolutePath = path.resolve(options.configDir, relativePath);
      const allowedRoot = path.resolve(rootDir);
      if (
        absolutePath !== allowedRoot &&
        !absolutePath.startsWith(`${allowedRoot}${path.sep}`)
      ) {
        return null;
      }

      try {
        return await readFile(absolutePath, "utf8");
      } catch {
        return null;
      }
    },
  };
}

function createRefId(
  input: ToolResultOffloadWriteInput,
  suffix: string,
): string {
  return [
    input.runId,
    input.toolCallId,
    input.toolName,
    suffix,
  ]
    .filter(Boolean)
    .map((part) => sanitizeRefSegment(String(part)))
    .join("_")
    .slice(0, 180);
}

function sanitizeRefSegment(value: string): string {
  const sanitized = value
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return sanitized || "ref";
}
