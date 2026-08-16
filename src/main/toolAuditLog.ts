import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ToolAuditEvent,
  ToolAuditEventInput,
} from "../shared/toolPermissions";
import type { StorageBackend, Storage, ToolAuditRepository } from "../shared/storageContract";
import { createToolAuditRepository } from "./storage/repositories/index";
import {
  redactCredentialText,
  redactCredentials,
} from "../shared/credentialRedaction";
import {
  createFailureVisibleSerialQueue,
  type PersistenceQueueDrainOptions,
} from "./failureVisibleSerialQueue";

export type ToolAuditLog = {
  append(input: ToolAuditEventInput): Promise<ToolAuditEvent>;
  list(options?: { limit?: number }): Promise<ToolAuditEvent[]>;
  flushShadowWrites(options?: PersistenceQueueDrainOptions): Promise<void>;
};

export interface ToolAuditLogOptions {
  configDir: string;
  createId?: () => string;
  now?: () => Date;
  /** Storage backend (default "json" — legacy behavior, zero regression). */
  backend?: StorageBackend;
  /** Storage instance required when backend is sqlite/dual. */
  storage?: Storage;
}

export function createToolAuditLog(options: ToolAuditLogOptions): ToolAuditLog {
  const backend: StorageBackend = options.backend ?? "json";
  const auditPath = path.join(options.configDir, "tool-audit.jsonl");
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());

  // v3.6.0: Maximum length for sensitive fields in audit log (SEC-18).
  const MAX_AUDIT_FIELD_LENGTH = 200;

  function buildEvent(input: ToolAuditEventInput): ToolAuditEvent {
    return {
      taskId: redactCredentialText(input.taskId),
      request: {
        toolName: input.request.toolName,
        ...(input.request.source
          ? { source: redactCredentialText(input.request.source) }
          : {}),
        args: sanitizeAuditArgs(input.request.args),
      },
      decision: {
        allowed: input.decision.allowed,
        reason: truncateAuditString(
          redactCredentialText(input.decision.reason),
        ),
      },
      id: createId(),
      createdAt: now().toISOString(),
    };
  }

  // --- legacy JSON implementation (unchanged) ---
  async function jsonAppend(input: ToolAuditEventInput): Promise<ToolAuditEvent> {
    const event = buildEvent(input);
    await writeJsonEvent(event);
    return event;
  }
  async function writeJsonEvent(event: ToolAuditEvent): Promise<void> {
    await mkdir(options.configDir, { recursive: true });
    await writeFile(auditPath, `${JSON.stringify(event)}\n`, { encoding: "utf8", flag: "a" });
  }
  async function jsonList(listOptions?: { limit?: number }): Promise<ToolAuditEvent[]> {
    const limit = listOptions?.limit ?? 50;
    try {
      const raw = await readFile(auditPath, { encoding: "utf8" });
      return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line) as ToolAuditEvent).reverse().slice(0, limit);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  if (backend === "json" || !options.storage) {
    return {
      append: jsonAppend,
      list: jsonList,
      async flushShadowWrites() {
        return;
      },
    };
  }

  // --- sqlite / dual ---
  const repo: ToolAuditRepository = createToolAuditRepository(options.storage);
  const shadowQueue = createFailureVisibleSerialQueue();
  return {
    async append(input) {
      shadowQueue.assertOpen();
      const event = buildEvent(input);
      repo.append(event); // sync, hot path
      if (backend === "dual") {
        void shadowQueue.enqueue(() => writeJsonEvent(event));
      }
      return event;
    },
    async list(listOptions) {
      const limit = listOptions?.limit ?? 50;
      return repo.list({ limit });
    },
    async flushShadowWrites(flushOptions) {
      await shadowQueue.drain(flushOptions);
    },
  };

  function sanitizeAuditArgs(args: Record<string, unknown>): Record<string, unknown> {
    const redacted = redactCredentials(args);
    if (!redacted || typeof redacted !== "object" || Array.isArray(redacted)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(redacted).map(([key, value]) => [
        key,
        truncateAuditValue(value),
      ]),
    );
  }

  function truncateAuditValue(value: unknown): unknown {
    if (typeof value === "string") {
      return truncateAuditString(value);
    }
    if (Array.isArray(value)) {
      return value.map(truncateAuditValue);
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          truncateAuditValue(item),
        ]),
      );
    }
    return value;
  }

  function truncateAuditString(value: string): string {
    return value.length > MAX_AUDIT_FIELD_LENGTH
      ? `${value.slice(0, MAX_AUDIT_FIELD_LENGTH)}...[truncated]`
      : value;
  }
}
