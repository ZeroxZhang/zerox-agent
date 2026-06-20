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

function shadowWriteError(error: unknown): void {
  // eslint-disable-next-line no-console
  console.warn("[storage] dual-write JSON shadow write failed:", String(error));
}

export function createToolAuditLog(options: ToolAuditLogOptions): ToolAuditLog {
  const backend: StorageBackend = options.backend ?? "json";
  const auditPath = path.join(options.configDir, "tool-audit.jsonl");
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());

  function buildEvent(input: ToolAuditEventInput): ToolAuditEvent {
    return { ...input, id: createId(), createdAt: now().toISOString() };
  }

  // --- legacy JSON implementation (unchanged) ---
  async function jsonAppend(input: ToolAuditEventInput): Promise<ToolAuditEvent> {
    const event = buildEvent(input);
    await mkdir(options.configDir, { recursive: true });
    await writeFile(auditPath, `${JSON.stringify(event)}\n`, { encoding: "utf8", flag: "a" });
    return event;
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
      repo.append(input); // sync, hot path
      if (backend === "dual") void jsonAppend(input).catch(shadowWriteError);
      return event;
    },
    async list(listOptions) {
      const limit = listOptions?.limit ?? 50;
      return repo.list({ limit });
    },
  };
}

export { shadowWriteError };
