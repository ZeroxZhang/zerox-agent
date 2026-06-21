import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ReadToolResultRefOptions,
  ToolResultRefReadCapability,
} from "../shared/toolResultRefs";

export type ToolResultOffloadWriteInput = {
  runId?: string;
  sessionId?: string;
  requestId?: string;
  workspaceRunId?: string;
  toolCallId?: string;
  toolName: string;
  content: string;
};

export type { ToolResultRefReadCapability };
export type ToolResultOffloadReadScope = ReadToolResultRefOptions;

export type ToolResultOffloadRef = {
  refId: string;
  relativePath: string;
  absolutePath: string;
  bytesWritten: number;
};

export type ToolResultOffloadStore = {
  write(input: ToolResultOffloadWriteInput): Promise<ToolResultOffloadRef>;
  read(
    relativePath: string,
    scope?: ToolResultOffloadReadScope,
  ): Promise<string | null>;
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
      await writeMetadata(absolutePath, input);

      return {
        refId,
        relativePath,
        absolutePath,
        bytesWritten: Buffer.byteLength(input.content, "utf8"),
      };
    },

    async read(relativePath, scope) {
      const absolutePath = path.resolve(options.configDir, relativePath);
      const allowedRoot = path.resolve(rootDir);
      if (
        absolutePath !== allowedRoot &&
        !absolutePath.startsWith(`${allowedRoot}${path.sep}`)
      ) {
        return null;
      }

      if (!(await canReadRef(absolutePath, relativePath, scope))) {
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

type ToolResultOffloadMetadata = {
  runId?: string;
  sessionId?: string;
  requestId?: string;
  workspaceRunId?: string;
  toolCallId?: string;
  toolName: string;
};

async function writeMetadata(
  absolutePath: string,
  input: ToolResultOffloadWriteInput,
): Promise<void> {
  const metadata: ToolResultOffloadMetadata = {
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.workspaceRunId ? { workspaceRunId: input.workspaceRunId } : {}),
    ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
    toolName: input.toolName,
  };

  await writeFile(metadataPath(absolutePath), JSON.stringify(metadata), "utf8");
}

async function canReadRef(
  absolutePath: string,
  relativePath: string,
  scope: ToolResultOffloadReadScope | undefined,
): Promise<boolean> {
  const metadata = await readMetadata(absolutePath);
  if (!metadata) {
    return true;
  }
  if (scope?.capability && capabilityAllowsRef(scope.capability, relativePath)) {
    return true;
  }

  return matchesScope(metadata, scope);
}

async function readMetadata(
  absolutePath: string,
): Promise<ToolResultOffloadMetadata | null> {
  try {
    return JSON.parse(
      await readFile(metadataPath(absolutePath), "utf8"),
    ) as ToolResultOffloadMetadata;
  } catch {
    return null;
  }
}

function metadataPath(absolutePath: string): string {
  return `${absolutePath}.meta.json`;
}

function capabilityAllowsRef(
  capability: ToolResultRefReadCapability,
  relativePath: string,
): boolean {
  return capability.kind === "tool_result_ref_read" && capability.ref === relativePath;
}

function matchesScope(
  metadata: ToolResultOffloadMetadata,
  scope: ToolResultOffloadReadScope | undefined,
): boolean {
  const keys = ["runId", "sessionId", "requestId", "workspaceRunId"] as const;
  for (const key of keys) {
    if (metadata[key] && metadata[key] !== scope?.[key]) {
      return false;
    }
  }

  return true;
}

function createRefId(
  input: ToolResultOffloadWriteInput,
  suffix: string,
): string {
  return [
    input.runId,
    input.sessionId,
    input.requestId,
    input.workspaceRunId,
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
