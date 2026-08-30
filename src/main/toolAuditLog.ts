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
  redactCredentialString,
  redactCredentials,
} from "../shared/credentialRedaction";
import { createConversationRequestFingerprint } from "../shared/conversationCausalSpine";
import {
  createFailureVisibleSerialQueue,
  type PersistenceQueueDrainOptions,
} from "./failureVisibleSerialQueue";

export type ToolAuditLog = {
  append(input: ToolAuditEventInput): Promise<ToolAuditEvent>;
  get(id: string): Promise<ToolAuditEvent | null>;
  verifyAuthorizationReceipt(input: {
    auditEventId: string;
    taskId: string;
    request: ToolAuditEventInput["request"];
  }): Promise<boolean>;
  consumeAuthorizationReceipt(input: {
    auditEventId: string;
    taskId: string;
    request: ToolAuditEventInput["request"];
  }): Promise<boolean>;
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
  const receiptClaimsDir = path.join(options.configDir, "tool-audit-receipt-claims");
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());

  // v3.6.0: Maximum length for sensitive fields in audit log (SEC-18).
  const MAX_AUDIT_FIELD_LENGTH = 200;

  function buildEvent(input: ToolAuditEventInput): ToolAuditEvent {
    return {
      taskId: redactCredentialString(input.taskId),
      request: {
        toolName: input.request.toolName,
        ...(input.request.source
          ? { source: redactCredentialString(input.request.source) }
          : {}),
        args: sanitizeAuditArgs(input.request.args),
      },
      decision: {
        allowed: input.decision.allowed,
        reason: truncateAuditString(
          redactCredentialString(input.decision.reason),
        ),
      },
      id: createId(),
      createdAt: now().toISOString(),
      requestFingerprint: fingerprintAuthorizationRequest(input.taskId, input.request),
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
  async function jsonGet(id: string): Promise<ToolAuditEvent | null> {
    return (await jsonList({ limit: Number.MAX_SAFE_INTEGER }))
      .find((event) => event.id === id) ?? null;
  }

  async function verifyAuthorizationReceipt(input: {
    auditEventId: string;
    taskId: string;
    request: ToolAuditEventInput["request"];
  }, getEvent: (id: string) => Promise<ToolAuditEvent | null>): Promise<boolean> {
    const event = await getEvent(input.auditEventId);
    return Boolean(
      event
      && event.decision.allowed
      && event.taskId === input.taskId
      && event.request.toolName === input.request.toolName
      && event.requestFingerprint
        === fingerprintAuthorizationRequest(input.taskId, input.request),
    );
  }

  function buildReceiptConsumptionEvent(input: {
    auditEventId: string;
    taskId: string;
    request: ToolAuditEventInput["request"];
  }): ToolAuditEvent {
    const requestFingerprint = fingerprintAuthorizationRequest(
      input.taskId,
      input.request,
    );
    return {
      ...buildEvent({
        taskId: input.taskId,
        request: {
          toolName: "authorization_receipt_dispatch",
          args: {
            auditEventId: input.auditEventId,
            requestFingerprint,
          },
        },
        decision: {
          allowed: true,
          reason: "Authorization receipt was consumed for one dispatch.",
        },
      }),
      id: `audit_dispatch_${createConversationRequestFingerprint({
        schemaVersion: 1,
        auditEventId: input.auditEventId,
      })}`,
    };
  }

  async function claimReceiptConsumption(
    claim: ToolAuditEvent,
  ): Promise<boolean> {
    // A pre-marker dual build wrote the deterministic claim to its JSONL
    // shadow. Honor that durable evidence before creating the shared marker so
    // a backend downgrade cannot revive an already consumed receipt.
    if (await jsonGet(claim.id)) return false;
    await mkdir(receiptClaimsDir, { recursive: true });
    try {
      await writeFile(
        path.join(receiptClaimsDir, `${claim.id}.json`),
        `${JSON.stringify(claim)}\n`,
        { encoding: "utf8", flag: "wx", mode: 0o600 },
      );
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  }

  if (backend === "json" || !options.storage) {
    return {
      append: jsonAppend,
      get: jsonGet,
      verifyAuthorizationReceipt(input) {
        return verifyAuthorizationReceipt(input, jsonGet);
      },
      async consumeAuthorizationReceipt(input) {
        if (!await verifyAuthorizationReceipt(input, jsonGet)) return false;
        const claim = buildReceiptConsumptionEvent(input);
        if (!await claimReceiptConsumption(claim)) return false;
        await writeJsonEvent(claim);
        return true;
      },
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
    async get(id) {
      return repo.get(id);
    },
    verifyAuthorizationReceipt(input) {
      return verifyAuthorizationReceipt(input, async (id) => repo.get(id));
    },
    async consumeAuthorizationReceipt(input) {
      if (!await verifyAuthorizationReceipt(input, async (id) => repo.get(id))) {
        return false;
      }
      const claim = buildReceiptConsumptionEvent(input);
      if (!await claimReceiptConsumption(claim)) return false;
      const consumed = repo.appendIfAbsent(claim);
      if (consumed && backend === "dual") {
        void shadowQueue.enqueue(() => writeJsonEvent(claim));
      }
      return consumed;
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

  function fingerprintAuthorizationRequest(
    taskId: string,
    request: ToolAuditEventInput["request"],
  ): string {
    return createConversationRequestFingerprint({
      schemaVersion: 1,
      taskId,
      request,
    });
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
