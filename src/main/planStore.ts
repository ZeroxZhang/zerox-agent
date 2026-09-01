import { createHash, randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type {
  PlanProjection,
  PlanRecord,
} from "../shared/planMode";
import type { Storage } from "../shared/storageContract";
import {
  isGoalContractRef,
  isGoalContractSnapshot,
} from "../shared/goalPlanContract";
import {
  ensurePlanGoalContract,
  goalContractMatchesRef,
} from "./goalPlanContractService";
import { createPublicSkillSnapshot } from "../shared/skills";
import { sanitizePlanRecordDiagnostics } from "../shared/planDiagnostics";
import {
  createPlanArtifactWriter,
  describePlanProjection,
  describeStoredPlanProjection,
  type PlanArtifactWriter,
  type PreparedPlanProjection,
} from "./planArtifactWriter";
import {
  decodePersistedPlanRecord,
  InvalidPersistedPlanRecordError,
} from "./planRecordDecoder";

export type PlanStoreEvent = {
  id: string;
  planId: string;
  type: string;
  revision: number;
  payload?: Record<string, unknown>;
  createdAt: string;
};

export type PlanStore = {
  create(plan: PlanRecord): Promise<PlanRecord>;
  get(planId: string): Promise<PlanRecord | null>;
  save(
    plan: PlanRecord,
    expectedRevision: number,
    eventType: string,
    payload?: Record<string, unknown>,
  ): Promise<PlanRecord>;
  saveProjectionIntent(
    plan: PlanRecord,
    expectedRevision: number,
    projection: PreparedPlanProjection,
    eventType: string,
    payload?: Record<string, unknown>,
  ): Promise<PlanRecord>;
  finalizeProjectionIntent(
    planId: string,
    expectedRevision: number,
    projection: PlanProjection,
    eventType: string,
    payload?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<PlanRecord>;
  abandonProjectionIntent(
    planId: string,
    expectedRevision: number,
    status: "discarded" | "canceled",
    eventType: string,
    payload?: Record<string, unknown>,
  ): Promise<PlanRecord>;
  listBySession(sessionId: string): Promise<PlanRecord[]>;
  listAll(): Promise<PlanRecord[]>;
  getLatestBySession(sessionId: string): Promise<PlanRecord | null>;
};

const SESSION_INDEX_FILENAME = "session-index.json";
const SQLITE_PLAN_SELECT_COLUMNS =
  "id, session_id, mode, status, action_gate, revision, payload, created_at, updated_at";

type SqlitePlanRow = {
  id: string;
  session_id: string;
  mode: string;
  status: string;
  action_gate: string;
  revision: number;
  payload: string;
  created_at: string;
  updated_at: string;
};

type PlanStorageEnvelope = {
  id: string;
  sessionId?: string;
  mode?: string;
  status?: string;
  actionGate?: string;
  revision?: number;
  createdAt?: string;
  updatedAt?: string;
};

type SessionPlanIndex = {
  version: 1;
  sessions: Record<string, { planId: string; updatedAt: string }>;
};

export class PlanVersionConflictError extends Error {
  constructor(
    public readonly planId: string,
    public readonly expectedRevision: number,
    public readonly actualRevision: number,
  ) {
    super(
      `计划版本冲突：期望 ${expectedRevision}，实际 ${actualRevision}。`,
    );
  }
}

export function createPlanStore(options: {
  configDir: string;
  storage?: Storage;
  now?: () => string;
  createId?: () => string;
}): PlanStore {
  const plansDir = path.join(options.configDir, "plans");
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? (() => randomUUID());
  const queues = new Map<string, Promise<void>>();
  const activeRunIds = new Set<string>();
  const projectionRecoveryWriter: PlanArtifactWriter = createPlanArtifactWriter({
    now,
  });
  let sessionIndexQueue = Promise.resolve();

  function planPath(planId: string) {
    return path.join(plansDir, `${safePlanId(planId)}.json`);
  }

  function eventPath(planId: string) {
    return path.join(plansDir, `${safePlanId(planId)}.events.jsonl`);
  }

  function sessionIndexPath() {
    return path.join(plansDir, SESSION_INDEX_FILENAME);
  }

  async function migrateDiagnosticProjection(
    plan: PlanRecord,
  ): Promise<PlanRecord> {
    if (!plan.projection) return plan;
    const next = describeStoredPlanProjection(plan);
    const durableIntent = validatePlanRecord({
      ...plan,
      status: "drafting",
      actionGate: "blocked",
      projectionIntent: createProjectionIntent(plan, next, now()),
    });
    // This is the first durable migration write. It retains the exact old
    // digest and exact sanitized replay bytes, so a crash or offline workspace
    // cannot strand a legacy projection after its authority was detached.
    await writePlan(durableIntent);
    return recoverProjectionIntent(durableIntent);
  }

  async function readSqlitePlanPayload(
    row: SqlitePlanRow,
    recoverProjection = true,
  ): Promise<PlanRecord> {
    const { parsed, diagnosticSafe, validated } = decodeAndValidatePlan(
      row.payload,
      {
        id: row.id,
        sessionId: row.session_id,
        mode: row.mode,
        status: row.status,
        actionGate: row.action_gate,
        revision: row.revision,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    );
    const diagnosticsChanged = !recordsEqual(parsed, diagnosticSafe);
    let migrated = validated;
    if (diagnosticsChanged && options.storage) {
      if (validated.projection) {
        migrated = await migrateDiagnosticProjection(validated);
      } else {
        writeSqlitePlan(options.storage, validated);
      }
    } else if (options.storage && !recordsEqual(parsed, validated)) {
      writeSqlitePlan(options.storage, validated);
    }
    const recovered = recoverProjection
      ? await recoverProjectionIntent(migrated)
      : migrated;
    return recoverInterruptedPlanRecord(recovered, activeRunIds);
  }

  async function readPlan(
    planId: string,
    recoverProjection = true,
  ): Promise<PlanRecord | null> {
    let normalizedPlanId: string;
    try {
      normalizedPlanId = safePlanId(planId);
    } catch {
      throw new InvalidPersistedPlanRecordError("$.id");
    }
    if (options.storage) {
      const row = options.storage.db
        .prepare(
          `SELECT ${SQLITE_PLAN_SELECT_COLUMNS} FROM plan_records WHERE id = ?`,
        )
        .get<SqlitePlanRow>(normalizedPlanId);
      if (!row) return null;
      return readSqlitePlanPayload(row, recoverProjection);
    }
    try {
      const { parsed, diagnosticSafe, validated } = decodeAndValidatePlan(
        await readFile(planPath(normalizedPlanId), "utf8"),
        { id: normalizedPlanId },
      );
      const diagnosticsChanged = !recordsEqual(parsed, diagnosticSafe);
      let migrated = validated;
      if (diagnosticsChanged) {
        if (validated.projection) {
          migrated = await migrateDiagnosticProjection(validated);
        } else {
          await writePlan(validated);
        }
      } else if (!recordsEqual(parsed, validated)) {
        await writePlan(validated);
      }
      const recovered = recoverProjection
        ? await recoverProjectionIntent(migrated)
        : migrated;
      return recoverInterruptedPlanRecord(recovered, activeRunIds);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async function writePlan(plan: PlanRecord) {
    if (options.storage) {
      writeSqlitePlan(options.storage, plan);
      return;
    }
    await mkdir(plansDir, { recursive: true });
    const destination = planPath(plan.id);
    const temp = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(temp, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(plan, null, 2)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      await rename(temp, destination);
      const directory = await open(plansDir, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } catch (error) {
      await handle.close().catch(() => undefined);
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async function appendEvent(event: PlanStoreEvent) {
    if (options.storage) {
      writeSqliteEvent(options.storage, event);
      return;
    }
    await mkdir(plansDir, { recursive: true });
    await appendFile(eventPath(event.planId), `${JSON.stringify(event)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  }

  async function persistPlanAndEvent(
    plan: PlanRecord,
    event: PlanStoreEvent,
  ): Promise<void> {
    if (options.storage) {
      writeSqlitePlanAndEvent(options.storage, plan, event);
      return;
    }
    await writePlan(plan);
    await appendEvent(event);
    await updateSessionIndex(plan);
  }

  async function recoverProjectionIntent(plan: PlanRecord): Promise<PlanRecord> {
    const intent = plan.projectionIntent;
    if (!intent) return plan;
    let published: PlanProjection;
    try {
      const prepared = intentProjection(intent);
      published = await projectionRecoveryWriter.writePrepared(
        plan,
        prepared,
      );
    } catch {
      // A pending intent is a valid, non-confirmable recovery state. Workspace
      // drift/offline errors must not make the Plan store unreadable.
      return plan;
    }
    if (
      published.path !== intent.nextPath
      || published.sha256 !== intent.nextSha256
    ) {
      return plan;
    }
    const recovered = validatePlanRecord({
      ...plan,
      status: intent.targetStatus,
      actionGate: intent.targetActionGate,
      projection: published,
      projectionIntent: undefined,
    });
    const event: PlanStoreEvent = {
      id: `plan_event_${createId()}`,
      planId: recovered.id,
      type: "plan_projection_recovered",
      revision: recovered.revision,
      createdAt: now(),
    };
    // Storage failures are systemic and must remain observable. Only the
    // workspace publication boundary above is recoverable as a pending intent.
    await persistPlanAndEvent(recovered, event);
    return recovered;
  }

  function decodeAndValidatePlan(
    payload: string,
    envelope?: PlanStorageEnvelope,
  ): {
    parsed: unknown;
    diagnosticSafe: PlanRecord;
    validated: PlanRecord;
  } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      throw new InvalidPersistedPlanRecordError("$");
    }
    try {
      const diagnosticSafe = decodePersistedPlanRecord(parsed);
      const validated = validatePlanRecord(diagnosticSafe);
      if (
        envelope
        && !planMatchesStorageEnvelope(validated, envelope)
      ) {
        throw new InvalidPersistedPlanRecordError("$.storageEnvelope");
      }
      return {
        parsed,
        diagnosticSafe,
        validated,
      };
    } catch (error) {
      if (error instanceof InvalidPersistedPlanRecordError) throw error;
      throw new InvalidPersistedPlanRecordError("$");
    }
  }

  async function readSessionIndex(): Promise<SessionPlanIndex> {
    try {
      const parsed = JSON.parse(
        await readFile(sessionIndexPath(), "utf8"),
      ) as Partial<SessionPlanIndex>;
      if (
        parsed.version !== 1 ||
        !parsed.sessions ||
        typeof parsed.sessions !== "object" ||
        Array.isArray(parsed.sessions)
      ) {
        return { version: 1, sessions: {} };
      }
      return {
        version: 1,
        sessions: parsed.sessions as SessionPlanIndex["sessions"],
      };
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code === "ENOENT" ||
        error instanceof SyntaxError
      ) {
        return { version: 1, sessions: {} };
      }
      throw error;
    }
  }

  function updateSessionIndex(plan: PlanRecord): Promise<void> {
    const operation = sessionIndexQueue.then(async () => {
      await mkdir(plansDir, { recursive: true });
      const index = await readSessionIndex();
      const existing = index.sessions[plan.sessionId];
      if (existing && existing.updatedAt > plan.updatedAt) {
        return;
      }
      index.sessions[plan.sessionId] = {
        planId: plan.id,
        updatedAt: plan.updatedAt,
      };
      const destination = sessionIndexPath();
      const temp = `${destination}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temp, `${JSON.stringify(index, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temp, destination);
    });
    sessionIndexQueue = operation.catch(() => undefined);
    return operation;
  }

  function serialize<T>(planId: string, operation: () => Promise<T>): Promise<T> {
    const previous = queues.get(planId) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    queues.set(planId, tail);
    void tail.finally(() => {
      if (queues.get(planId) === tail) {
        queues.delete(planId);
      }
    });
    return result;
  }

  return {
    create(plan) {
      return serialize(plan.id, async () => {
        const existing = await readPlan(plan.id);
        if (existing) {
          throw new Error(`计划 ${plan.id} 已存在。`);
        }
        const candidate = {
          ...structuredClone(plan),
          revision: Math.max(1, plan.revision),
        };
        const diagnosticSafe = sanitizePlanRecordDiagnostics(candidate);
        const validated = validatePlanRecord(diagnosticSafe);
        const created = !recordsEqual(candidate, diagnosticSafe)
          ? await migrateDiagnosticProjection(validated)
          : validated;
        const event: PlanStoreEvent = {
          id: `plan_event_${createId()}`,
          planId: created.id,
          type: "plan_created",
          revision: created.revision,
          createdAt: now(),
        };
        trackActiveRunIds(created, activeRunIds);
        if (options.storage) {
          writeSqlitePlanAndEvent(options.storage, created, event);
        } else {
          await writePlan(created);
          await appendEvent(event);
          await updateSessionIndex(created);
        }
        return structuredClone(created);
      });
    },

    get(planId) {
      return readPlan(planId);
    },

    save(plan, expectedRevision, eventType, payload) {
      return serialize(plan.id, async () => {
        const existing = await readPlan(plan.id);
        if (!existing) {
          throw new Error(`计划 ${plan.id} 不存在。`);
        }
        if (existing.projectionIntent) {
          throw new Error("计划投影仍在等待恢复，不能推进 Plan revision。");
        }
        if (existing.revision !== expectedRevision) {
          throw new PlanVersionConflictError(
            plan.id,
            expectedRevision,
            existing.revision,
          );
        }
        const candidate = {
          ...structuredClone(plan),
          revision: expectedRevision + 1,
          updatedAt: now(),
        };
        const diagnosticSafe = sanitizePlanRecordDiagnostics(candidate);
        const validated = validatePlanRecord(diagnosticSafe);
        const updated = !recordsEqual(candidate, diagnosticSafe)
          ? await migrateDiagnosticProjection(validated)
          : validated;
        const event: PlanStoreEvent = {
          id: `plan_event_${createId()}`,
          planId: updated.id,
          type: eventType,
          revision: updated.revision,
          ...(payload ? { payload: structuredClone(payload) } : {}),
          createdAt: now(),
        };
        trackActiveRunIds(updated, activeRunIds);
        if (options.storage) {
          writeSqlitePlanAndEvent(options.storage, updated, event);
        } else {
          await writePlan(updated);
          await appendEvent(event);
          await updateSessionIndex(updated);
        }
        return structuredClone(updated);
      });
    },

    saveProjectionIntent(
      plan,
      expectedRevision,
      projection,
      eventType,
      payload,
    ) {
      return serialize(plan.id, async () => {
        const existing = await readPlan(plan.id);
        if (!existing) throw new Error(`计划 ${plan.id} 不存在。`);
        if (existing.projectionIntent) {
          throw new Error("计划投影仍在等待恢复，不能覆盖其持久化 intent。");
        }
        if (existing.revision !== expectedRevision) {
          throw new PlanVersionConflictError(
            plan.id,
            expectedRevision,
            existing.revision,
          );
        }
        const target = sanitizePlanRecordDiagnostics({
          ...structuredClone(plan),
          revision: expectedRevision + 1,
          updatedAt: now(),
          projection: existing.projection,
        });
        if (!target.finalArtifact) {
          throw new Error("计划缺少可发布的终版投影。");
        }
        const canonicalProjection = await describePlanProjection(
          target,
          target.finalArtifact,
        );
        if (!preparedProjectionsEqual(projection, canonicalProjection)) {
          throw new Error("计划投影 intent 与规范化终版不一致。");
        }
        const candidate = validatePlanRecord({
          ...target,
          status: "drafting",
          actionGate: "blocked",
          projectionIntent: createProjectionIntent(
            existing,
            projection,
            now(),
            {
              targetStatus: plan.status,
              targetActionGate: plan.actionGate,
            },
          ),
        });
        const event: PlanStoreEvent = {
          id: `plan_event_${createId()}`,
          planId: candidate.id,
          type: `${eventType}_projection_prepared`,
          revision: candidate.revision,
          ...(payload ? { payload: structuredClone(payload) } : {}),
          createdAt: now(),
        };
        trackActiveRunIds(candidate, activeRunIds);
        await persistPlanAndEvent(candidate, event);
        return structuredClone(candidate);
      });
    },

    finalizeProjectionIntent(
      planId,
      expectedRevision,
      projection,
      eventType,
      payload,
      signal,
    ) {
      return serialize(planId, async () => {
        const existing = await readPlan(planId, false);
        if (!existing) throw new Error(`计划 ${planId} 不存在。`);
        if (!existing.projectionIntent) {
          if (
            existing.revision === expectedRevision
            && existing.projection?.path === projection.path
            && existing.projection.sha256 === projection.sha256
          ) {
            return structuredClone(existing);
          }
          throw new Error("计划不存在可提交的投影 intent。");
        }
        if (existing.revision !== expectedRevision) {
          throw new PlanVersionConflictError(
            planId,
            expectedRevision,
            existing.revision,
          );
        }
        const intent = existing.projectionIntent;
        if (
          projection.path !== intent.nextPath
          || projection.sha256 !== intent.nextSha256
        ) {
          throw new Error("计划投影提交结果与持久化 intent 不一致。");
        }
        // This single read is the cancellation linearization point. An abort
        // observed before it commits canceled/blocked; an abort arriving after
        // it is too late for this already-committing projection revision and
        // must not make the caller report a cancellation that was not stored.
        const canceledAtCommit = signal?.aborted === true;
        const finalized = validatePlanRecord({
          ...existing,
          status: canceledAtCommit ? "canceled" : intent.targetStatus,
          actionGate: canceledAtCommit ? "blocked" : intent.targetActionGate,
          projection,
          projectionIntent: undefined,
        });
        const event: PlanStoreEvent = {
          id: `plan_event_${createId()}`,
          planId,
          type: canceledAtCommit ? "plan_canceled" : eventType,
          revision: finalized.revision,
          ...(canceledAtCommit
            ? { payload: { afterProjection: true } }
            : payload
              ? { payload: structuredClone(payload) }
              : {}),
          createdAt: now(),
        };
        trackActiveRunIds(finalized, activeRunIds);
        await persistPlanAndEvent(finalized, event);
        return structuredClone(finalized);
      });
    },

    abandonProjectionIntent(planId, expectedRevision, status, eventType, payload) {
      return serialize(planId, async () => {
        const existing = await readPlan(planId, false);
        if (!existing) throw new Error(`计划 ${planId} 不存在。`);
        if (!existing.projectionIntent) {
          throw new Error("计划不存在可放弃的投影 intent。");
        }
        if (existing.revision !== expectedRevision) {
          throw new PlanVersionConflictError(
            planId,
            expectedRevision,
            existing.revision,
          );
        }
        const abandoned = validatePlanRecord({
          ...existing,
          status,
          actionGate: "blocked",
          revision: expectedRevision + 1,
          updatedAt: now(),
          projection: undefined,
          projectionIntent: undefined,
        });
        const event: PlanStoreEvent = {
          id: `plan_event_${createId()}`,
          planId,
          type: eventType,
          revision: abandoned.revision,
          ...(payload ? { payload: structuredClone(payload) } : {}),
          createdAt: now(),
        };
        trackActiveRunIds(abandoned, activeRunIds);
        await persistPlanAndEvent(abandoned, event);
        return structuredClone(abandoned);
      });
    },

    async listBySession(sessionId) {
      if (options.storage) {
        const rows = options.storage.db
          .prepare(
            `SELECT ${SQLITE_PLAN_SELECT_COLUMNS} FROM plan_records WHERE session_id = ? ORDER BY updated_at DESC`,
          )
          .all<SqlitePlanRow>(sessionId);
        return collectValidPlans(
          rows.map((row) => readSqlitePlanPayload(row)),
        );
      }
      try {
        const names = await readdir(plansDir);
        const plans = await collectValidPlans(
          names
            .filter(
              (name) =>
                name !== SESSION_INDEX_FILENAME &&
                name.endsWith(".json") &&
                !name.endsWith(".events.json"),
            )
            .map((name) => readPlan(name.slice(0, -".json".length))),
        );
        return plans
          .filter(
            (plan): plan is PlanRecord =>
              Boolean(plan && plan.sessionId === sessionId),
          )
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return [];
        }
        throw error;
      }
    },

    async listAll() {
      if (options.storage) {
        const rows = options.storage.db
          .prepare(
            `SELECT ${SQLITE_PLAN_SELECT_COLUMNS} FROM plan_records ORDER BY updated_at DESC`,
          )
          .all<SqlitePlanRow>();
        return collectValidPlans(
          rows.map((row) => readSqlitePlanPayload(row)),
        );
      }
      try {
        const names = await readdir(plansDir);
        const plans = await collectValidPlans(
          names
            .filter(
              (name) =>
                name !== SESSION_INDEX_FILENAME &&
                name.endsWith(".json") &&
                !name.endsWith(".events.json"),
            )
            .map((name) => readPlan(name.slice(0, -".json".length))),
        );
        return plans
          .filter((plan): plan is PlanRecord => Boolean(plan))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return [];
        }
        throw error;
      }
    },

    async getLatestBySession(sessionId) {
      if (options.storage) {
        const rows = options.storage.db
          .prepare(
            `SELECT ${SQLITE_PLAN_SELECT_COLUMNS} FROM plan_records WHERE session_id = ? ORDER BY updated_at DESC`,
          )
          .all<SqlitePlanRow>(sessionId);
        return (await collectValidPlans(
          rows.map((row) => readSqlitePlanPayload(row)),
        ))[0] ?? null;
      }
      await sessionIndexQueue;
      const entry = (await readSessionIndex()).sessions[sessionId];
      if (entry) {
        try {
          const indexed = await readPlan(entry.planId);
          if (indexed?.sessionId === sessionId) return indexed;
        } catch (error) {
          if (!isCorruptPlanRecordError(error)) throw error;
          // The authoritative record scan below isolates a corrupt/stale index
          // target instead of turning one entry into a session-wide outage.
        }
      }
      const latest = (await this.listBySession(sessionId))[0] ?? null;
      if (latest) {
        await updateSessionIndex(latest);
      }
      return latest;
    },
  };
}

async function collectValidPlans(
  reads: Array<Promise<PlanRecord | null>>,
): Promise<PlanRecord[]> {
  const settled = await Promise.allSettled(reads);
  const plans: PlanRecord[] = [];
  for (const result of settled) {
    if (result.status === "rejected") {
      if (isCorruptPlanRecordError(result.reason)) continue;
      throw result.reason;
    }
    if (result.value) plans.push(result.value);
  }
  return plans;
}

function isCorruptPlanRecordError(
  error: unknown,
): error is InvalidPersistedPlanRecordError {
  return error instanceof InvalidPersistedPlanRecordError;
}

function createProjectionIntent(
  current: PlanRecord,
  projection: PreparedPlanProjection,
  preparedAt: string,
  target?: {
    targetStatus: PlanRecord["status"];
    targetActionGate: PlanRecord["actionGate"];
  },
): NonNullable<PlanRecord["projectionIntent"]> {
  return {
    kind: projection.kind,
    renderVersion: projection.renderVersion,
    expectedSha256: current.projection?.sha256 ?? null,
    nextPath: projection.path,
    nextSha256: projection.sha256,
    body: projection.body,
    targetStatus: target?.targetStatus ?? current.status,
    targetActionGate: target?.targetActionGate ?? current.actionGate,
    preparedAt,
  };
}

function intentProjection(
  intent: NonNullable<PlanRecord["projectionIntent"]>,
): PreparedPlanProjection {
  return {
    kind: intent.kind,
    renderVersion: intent.renderVersion,
    path: intent.nextPath,
    sha256: intent.nextSha256,
    body: intent.body,
  };
}

function preparedProjectionsEqual(
  left: PreparedPlanProjection,
  right: PreparedPlanProjection,
): boolean {
  return left.kind === right.kind
    && left.renderVersion === right.renderVersion
    && left.path === right.path
    && left.sha256 === right.sha256
    && left.body === right.body;
}

function writeSqlitePlan(storage: Storage, plan: PlanRecord): void {
  storage.db
    .prepare(
      `INSERT INTO plan_records
        (id, session_id, mode, status, action_gate, revision, payload, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         session_id=excluded.session_id,
         mode=excluded.mode,
         status=excluded.status,
         action_gate=excluded.action_gate,
         revision=excluded.revision,
         payload=excluded.payload,
         updated_at=excluded.updated_at`,
    )
    .run(
      plan.id,
      plan.sessionId,
      plan.mode,
      plan.status,
      plan.actionGate,
      plan.revision,
      JSON.stringify(plan),
      plan.createdAt,
      plan.updatedAt,
    );
}

function writeSqliteEvent(storage: Storage, event: PlanStoreEvent): void {
  storage.db
    .prepare(
      `INSERT INTO plan_events
        (id, plan_id, type, revision, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      event.id,
      event.planId,
      event.type,
      event.revision,
      event.payload ? JSON.stringify(event.payload) : null,
      event.createdAt,
    );
}

function writeSqlitePlanAndEvent(
  storage: Storage,
  plan: PlanRecord,
  event: PlanStoreEvent,
): void {
  storage.db.exec("BEGIN IMMEDIATE");
  try {
    writeSqlitePlan(storage, plan);
    writeSqliteEvent(storage, event);
    storage.db.exec("COMMIT");
  } catch (error) {
    storage.db.exec("ROLLBACK");
    throw error;
  }
}

export function assertSafePlanId(planId: string): void {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(planId)) {
    throw new Error("计划 ID 非法。");
  }
}

function safePlanId(planId: string): string {
  assertSafePlanId(planId);
  return planId;
}

function recordsEqual(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function planMatchesStorageEnvelope(
  plan: PlanRecord,
  envelope: PlanStorageEnvelope,
): boolean {
  return safePlanId(envelope.id) === plan.id
    && (envelope.sessionId === undefined
      || envelope.sessionId === plan.sessionId)
    && (envelope.mode === undefined || envelope.mode === plan.mode)
    && (envelope.status === undefined || envelope.status === plan.status)
    && (envelope.actionGate === undefined
      || envelope.actionGate === plan.actionGate)
    && (envelope.revision === undefined
      || envelope.revision === plan.revision)
    && (envelope.createdAt === undefined
      || envelope.createdAt === plan.createdAt)
    && (envelope.updatedAt === undefined
      || envelope.updatedAt === plan.updatedAt);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
    return `{${entries.map(([key, entry]) =>
      `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function validatePlanRecord(plan: PlanRecord): PlanRecord {
  plan = sanitizePlanRecordDiagnostics(plan);
  plan = plan.selectedSkill
    ? {
        ...plan,
        selectedSkill: createPublicSkillSnapshot(plan.selectedSkill),
      }
    : plan;
  if (!plan.id || !plan.sessionId || !plan.sourceMessage) {
    throw new Error("计划记录缺少必要字段。");
  }
  assertSafePlanId(plan.id);
  if (plan.mode !== "direct" && plan.mode !== "debate") {
    throw new Error("计划模式非法。");
  }
  const validStatuses = new Set<PlanRecord["status"]>([
    "drafting",
    "paused",
    "awaiting_input",
    "awaiting_confirmation",
    "confirmed_pending_execution",
    "executing",
    "steps_completed",
    "completed",
    "superseded",
    "discarded",
    "canceled",
    "failed",
  ]);
  const validActionGates = new Set<PlanRecord["actionGate"]>([
    "ready",
    "needs_input",
    "blocked",
  ]);
  if (!validStatuses.has(plan.status) || !validActionGates.has(plan.actionGate)) {
    throw new Error("计划状态或执行门禁非法。");
  }
  if (plan.projectionIntent) {
    const intent = plan.projectionIntent;
    if (
      plan.status !== "drafting"
      || plan.actionGate !== "blocked"
      || (intent.kind !== "artifact" && intent.kind !== "tombstone")
      || (intent.kind === "artifact" && !plan.finalArtifact)
      || !plan.workspaceRoot
      || intent.renderVersion !== 1
      || !validStatuses.has(intent.targetStatus)
      || !validActionGates.has(intent.targetActionGate)
      || typeof intent.nextPath !== "string"
      || !path.isAbsolute(intent.nextPath)
      || !/^[a-f0-9]{64}$/.test(intent.nextSha256)
      || typeof intent.body !== "string"
      || createHash("sha256").update(intent.body).digest("hex")
        !== intent.nextSha256
      || (intent.expectedSha256 !== null
        && !/^[a-f0-9]{64}$/.test(intent.expectedSha256))
      || intent.expectedSha256 !== (plan.projection?.sha256 ?? null)
    ) {
      throw new Error("计划投影 intent 非法。");
    }
  }
  if (
    plan.autonomyMode !== undefined &&
    plan.autonomyMode !== "standard" &&
    plan.autonomyMode !== "auto"
  ) {
    throw new Error("计划自主模式非法。");
  }
  const schemaVersion = plan.schemaVersion ?? 1;
  if (schemaVersion !== 1 && schemaVersion !== 2 && schemaVersion !== 3) {
    throw new Error("计划 Schema 版本非法。");
  }
  if (
    schemaVersion === 2 &&
    (!plan.taskProfile ||
      !plan.planningBrief ||
      !Array.isArray(plan.planningStages))
  ) {
    throw new Error("v2 计划记录缺少任务画像、调查摘要或阶段记录。");
  }
  const compatible = ensurePlanGoalContract(
    schemaVersion === plan.schemaVersion
      ? plan
      : { ...plan, schemaVersion },
  );
  if (
    !isGoalContractSnapshot(compatible.goalContractSnapshot) ||
    !isGoalContractRef(compatible.goalContractRef) ||
    !goalContractMatchesRef(
      compatible.goalContractSnapshot,
      compatible.goalContractRef,
    )
  ) {
    throw new Error("计划的 GoalContract 快照或哈希非法。");
  }
  if (schemaVersion === 3) {
    if (
      !compatible.taskProfile ||
      !compatible.planningBrief ||
      !Array.isArray(compatible.planningStages)
    ) {
      throw new Error("v3 计划记录缺少任务画像、调查摘要或阶段记录。");
    }
    if (
      (compatible.purpose !== "initial" &&
        compatible.purpose !== "runtime_replan") ||
      !Number.isInteger(compatible.goalPlanVersion) ||
      Number(compatible.goalPlanVersion) < 1 ||
      !compatible.trigger ||
      !Array.isArray(compatible.criterionBindings) ||
      !Array.isArray(compatible.goalContractIssues)
    ) {
      throw new Error("v3 计划记录缺少 Goal 谱系或成功标准绑定。");
    }
    if (
      compatible.purpose === "runtime_replan" &&
      (compatible.mode !== "direct" ||
        !compatible.goalId ||
        !compatible.parentPlanRef)
    ) {
      throw new Error("运行期结构性重规划必须是关联父 Plan 的 Direct 计划。");
    }
  }
  return compatible;
}

function trackActiveRunIds(plan: PlanRecord, activeRunIds: Set<string>): void {
  const current = [
    ...plan.rounds
      .filter((round) => round.status === "running")
      .map((round) => round.runId),
    ...(plan.planningStages ?? [])
      .filter((stage) => stage.status === "running")
      .map((stage) => stage.runId),
  ];
  for (const runId of current) activeRunIds.add(runId);
}

function recoverInterruptedPlanRecord(
  plan: PlanRecord,
  activeRunIds: ReadonlySet<string>,
): PlanRecord {
  const interruptedRoundIds = new Set(
    plan.rounds
      .filter(
        (round) =>
          round.status === "running" && !activeRunIds.has(round.runId),
      )
      .map((round) => round.id),
  );
  const interruptedStageIds = new Set(
    (plan.planningStages ?? [])
      .filter(
        (stage) =>
          stage.status === "running" && !activeRunIds.has(stage.runId),
      )
      .map((stage) => stage.id),
  );
  if (interruptedRoundIds.size === 0 && interruptedStageIds.size === 0) {
    return plan;
  }
  return {
    ...plan,
    status: "paused",
    actionGate: "blocked",
    rounds: plan.rounds.map((round) =>
      interruptedRoundIds.has(round.id)
        ? {
            ...round,
            status: "failed" as const,
            error: "应用在该规划轮次运行期间中断，请从此轮重试。",
          }
        : round,
    ),
    planningStages: (plan.planningStages ?? []).map((stage) =>
      interruptedStageIds.has(stage.id)
        ? {
            ...stage,
            status: "failed" as const,
            error: "应用在该规划阶段运行期间中断，请从此阶段重试。",
          }
        : stage,
    ),
  };
}
