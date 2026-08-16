import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { ToolResultRefReadScope } from "../shared/toolResultRefs";

const TOOL_RESULT_REF_READ_CAPABILITY = Symbol("tool_result_ref_read_capability");

export type ToolResultOffloadWriteInput = {
  runId?: string;
  sessionId?: string;
  requestId?: string;
  workspaceRunId?: string;
  toolCallId?: string;
  toolName: string;
  content: string;
};

export type ToolResultRefReadCapability = {
  kind: "tool_result_ref_read";
  ref: string;
  issuedByRunId?: string;
  readonly [TOOL_RESULT_REF_READ_CAPABILITY]: true;
};

export type ToolResultOffloadReadScope = ToolResultRefReadScope & {
  capability?: unknown;
};

export function issueToolResultRefReadCapability(input: {
  ref: string;
  issuedByRunId?: string;
}): ToolResultRefReadCapability {
  return {
    kind: "tool_result_ref_read",
    ref: input.ref,
    ...(input.issuedByRunId ? { issuedByRunId: input.issuedByRunId } : {}),
    [TOOL_RESULT_REF_READ_CAPABILITY]: true,
  };
}

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
      await commitRefPair(absolutePath, input);

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

      const metadata = await readMetadata(absolutePath);
      if (!canReadRef(metadata, relativePath, scope)) {
        return null;
      }

      try {
        const content = await readFile(absolutePath, "utf8");
        if (
          metadata?.schemaVersion === 1 &&
          (
            metadata.bytesWritten !== Buffer.byteLength(content, "utf8") ||
            metadata.contentSha256 !== hashContent(content)
          )
        ) {
          return null;
        }
        return content;
      } catch {
        return null;
      }
    },
  };
}

type ToolResultOffloadMetadata = {
  schemaVersion?: 1;
  contentSha256?: string;
  bytesWritten?: number;
  runId?: string;
  sessionId?: string;
  requestId?: string;
  workspaceRunId?: string;
  toolCallId?: string;
  toolName: string;
};

async function commitRefPair(
  absolutePath: string,
  input: ToolResultOffloadWriteInput,
): Promise<void> {
  const metadata: ToolResultOffloadMetadata = {
    schemaVersion: 1,
    contentSha256: hashContent(input.content),
    bytesWritten: Buffer.byteLength(input.content, "utf8"),
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.workspaceRunId ? { workspaceRunId: input.workspaceRunId } : {}),
    ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
    toolName: input.toolName,
  };
  const transactionId = randomUUID();
  const contentTempPath = `${absolutePath}.${transactionId}.tmp`;
  const metadataTempPath = `${metadataPath(absolutePath)}.${transactionId}.tmp`;
  const writes = await Promise.allSettled([
    writeFile(contentTempPath, input.content, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    }),
    writeFile(metadataTempPath, JSON.stringify(metadata), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    }),
  ]);
  const writeFailure = writes.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (writeFailure) {
    await cleanupTempPair(contentTempPath, metadataTempPath);
    throw writeFailure.reason;
  }

  let metadataCommitted = false;
  try {
    await rename(metadataTempPath, metadataPath(absolutePath));
    metadataCommitted = true;
    await rename(contentTempPath, absolutePath);
  } catch (error) {
    if (metadataCommitted) {
      await rm(metadataPath(absolutePath), { force: true });
    }
    throw error;
  } finally {
    await cleanupTempPair(contentTempPath, metadataTempPath);
  }
}

function canReadRef(
  metadata: ToolResultOffloadMetadata | null,
  relativePath: string,
  scope: ToolResultOffloadReadScope | undefined,
): boolean {
  if (!metadata) {
    return scope === undefined;
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
    const parsed: unknown = JSON.parse(
      await readFile(metadataPath(absolutePath), "utf8"),
    );
    return isToolResultOffloadMetadata(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function metadataPath(absolutePath: string): string {
  return `${absolutePath}.meta.json`;
}

function isToolResultOffloadMetadata(
  value: unknown,
): value is ToolResultOffloadMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.toolName !== "string" ||
    candidate.toolName.length === 0
  ) {
    return false;
  }
  for (
    const key of [
      "runId",
      "sessionId",
      "requestId",
      "workspaceRunId",
      "toolCallId",
    ] as const
  ) {
    if (
      candidate[key] !== undefined &&
      (
        typeof candidate[key] !== "string" ||
        candidate[key].length === 0
      )
    ) {
      return false;
    }
  }

  if (candidate.schemaVersion === undefined) {
    return (
      candidate.contentSha256 === undefined &&
      candidate.bytesWritten === undefined
    );
  }
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.contentSha256 === "string" &&
    /^[a-f0-9]{64}$/.test(candidate.contentSha256) &&
    Number.isSafeInteger(candidate.bytesWritten) &&
    Number(candidate.bytesWritten) >= 0
  );
}

async function cleanupTempPair(
  contentTempPath: string,
  metadataTempPath: string,
): Promise<void> {
  await Promise.all([
    rm(contentTempPath, { force: true }),
    rm(metadataTempPath, { force: true }),
  ]);
}

function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function capabilityAllowsRef(
  capability: unknown,
  relativePath: string,
): boolean {
  if (!capability || typeof capability !== "object") {
    return false;
  }

  const candidate = capability as Partial<ToolResultRefReadCapability>;
  return (
    candidate.kind === "tool_result_ref_read" &&
    candidate.ref === relativePath &&
    candidate[TOOL_RESULT_REF_READ_CAPABILITY] === true
  );
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
