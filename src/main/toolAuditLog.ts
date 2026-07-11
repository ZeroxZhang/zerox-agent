import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ToolAuditEvent,
  ToolAuditEventInput,
} from "../shared/toolPermissions";
import type { StorageBackend, Storage, ToolAuditRepository } from "../shared/storageContract";
import { createToolAuditRepository } from "./storage/repositories/index";

export type ToolAuditLog = {
  append(input: ToolAuditEventInput): Promise<ToolAuditEvent>;
  list(options?: { limit?: number }): Promise<ToolAuditEvent[]>;
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

// v3.6.0: Shared shadowWriteError with failure counter (S2-22, QA-03).
let shadowWriteFailureCount = 0;
function shadowWriteError(error: unknown): void {
  shadowWriteFailureCount += 1;
  // eslint-disable-next-line no-console
  console.warn(
    `[storage] dual-write JSON shadow write failed (count=${shadowWriteFailureCount}):`,
    String(error),
  );
}

/** Return the total number of shadow write failures observed in this process. */
export function getShadowWriteFailureCount(): number {
  return shadowWriteFailureCount;
}

export function createToolAuditLog(options: ToolAuditLogOptions): ToolAuditLog {
  const backend: StorageBackend = options.backend ?? "json";
  const auditPath = path.join(options.configDir, "tool-audit.jsonl");
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());

  // v3.6.0: Maximum length for sensitive fields in audit log (SEC-18).
  const MAX_AUDIT_FIELD_LENGTH = 200;

  function buildEvent(input: ToolAuditEventInput): ToolAuditEvent {
    // v3.6.0: Truncate sensitive fields (command, content, url) in tool
    // audit log to prevent secrets or large payloads from being stored in
    // plaintext audit trails (SEC-18).
    const event = { ...input, id: createId(), createdAt: now().toISOString() };
    if (event.request) {
      const safeArgs: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(event.request.args ?? {})) {
        if (key === "command" || key === "content" || key === "url") {
          const str = String(value);
          safeArgs[key] = str.length > MAX_AUDIT_FIELD_LENGTH
            ? `${str.slice(0, MAX_AUDIT_FIELD_LENGTH)}...[truncated]`
            : str;
        } else {
          safeArgs[key] = value;
        }
      }
      event.request = { ...event.request, args: safeArgs };
    }
    return event;
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
    return { append: jsonAppend, list: jsonList };
  }

  // --- sqlite / dual ---
  const repo: ToolAuditRepository = createToolAuditRepository(options.storage);
  return {
    async append(input) {
      const event = buildEvent(input);
      repo.append(event); // sync, hot path
      if (backend === "dual") void writeJsonEvent(event).catch(shadowWriteError);
      return event;
    },
    async list(listOptions) {
      const limit = listOptions?.limit ?? 50;
      return repo.list({ limit });
    },
  };
}

export { shadowWriteError };
