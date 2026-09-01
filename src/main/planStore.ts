import { randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { PlanRecord } from "../shared/planMode";
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
import { rewriteSanitizedPlanProjection } from "./planArtifactWriter";

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
  listBySession(sessionId: string): Promise<PlanRecord[]>;
  listAll(): Promise<PlanRecord[]>;
  getLatestBySession(sessionId: string): Promise<PlanRecord | null>;
};

const SESSION_INDEX_FILENAME = "session-index.json";

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

  function detachProjection(plan: PlanRecord): PlanRecord {
    const { projection: _projection, ...detached } = plan;
    return detached;
  }

  async function migrateDiagnosticProjection(
    plan: PlanRecord,
  ): Promise<PlanRecord> {
    if (!plan.projection) return plan;
    const detached = detachProjection(plan);
    if (!plan.workspaceRoot) return detached;
    try {
      return await rewriteSanitizedPlanProjection(plan, now);
    } catch {
      // The persistent record must remain readable and content-free when an
      // old workspace is offline, removed, read-only, or no longer canonical.
      // Detaching the unverified projection also keeps IPC consumers from
      // treating a legacy diagnostic artifact as authoritative.
      return detached;
    }
  }

  async function readSqlitePlanPayload(payload: string): Promise<PlanRecord> {
    const parsed = JSON.parse(payload) as PlanRecord;
    const diagnosticSafe = sanitizePlanRecordDiagnostics(parsed);
    const diagnosticsChanged = !recordsEqual(parsed, diagnosticSafe);
    const validated = validatePlanRecord(diagnosticSafe);
    let migrated = validated;
    if (diagnosticsChanged && options.storage) {
      const detached = detachProjection(validated);
      writeSqlitePlan(options.storage, detached);
      migrated = await migrateDiagnosticProjection(validated);
      if (!recordsEqual(detached, migrated)) {
        writeSqlitePlan(options.storage, migrated);
      }
    } else if (options.storage && !recordsEqual(parsed, validated)) {
      writeSqlitePlan(options.storage, validated);
    }
    return recoverInterruptedPlanRecord(migrated, activeRunIds);
  }

  async function readPlan(planId: string): Promise<PlanRecord | null> {
    safePlanId(planId);
    if (options.storage) {
      const row = options.storage.db
        .prepare("SELECT payload FROM plan_records WHERE id = ?")
        .get<{ payload: string }>(planId);
      if (!row) return null;
      return readSqlitePlanPayload(row.payload);
    }
    try {
      const parsed = JSON.parse(
        await readFile(planPath(planId), "utf8"),
      ) as PlanRecord;
      const diagnosticSafe = sanitizePlanRecordDiagnostics(parsed);
      const diagnosticsChanged = !recordsEqual(parsed, diagnosticSafe);
      const validated = validatePlanRecord(diagnosticSafe);
      let migrated = validated;
      if (diagnosticsChanged) {
        const detached = detachProjection(validated);
        await writePlan(detached);
        migrated = await migrateDiagnosticProjection(validated);
        if (!recordsEqual(detached, migrated)) {
          await writePlan(migrated);
        }
      } else if (!recordsEqual(parsed, validated)) {
        await writePlan(validated);
      }
      return recoverInterruptedPlanRecord(migrated, activeRunIds);
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
    await writeFile(temp, `${JSON.stringify(plan, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temp, destination);
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

    async listBySession(sessionId) {
      if (options.storage) {
        const rows = options.storage.db
          .prepare(
            "SELECT payload FROM plan_records WHERE session_id = ? ORDER BY updated_at DESC",
          )
          .all<{ payload: string }>(sessionId);
        return Promise.all(
          rows.map((row) => readSqlitePlanPayload(row.payload)),
        );
      }
      try {
        const names = await readdir(plansDir);
        const plans = await Promise.all(
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
          .prepare("SELECT payload FROM plan_records ORDER BY updated_at DESC")
          .all<{ payload: string }>();
        return Promise.all(
          rows.map((row) => readSqlitePlanPayload(row.payload)),
        );
      }
      try {
        const names = await readdir(plansDir);
        const plans = await Promise.all(
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
        const row = options.storage.db
          .prepare(
            "SELECT payload FROM plan_records WHERE session_id = ? ORDER BY updated_at DESC LIMIT 1",
          )
          .get<{ payload: string }>(sessionId);
        return row ? await readSqlitePlanPayload(row.payload) : null;
      }
      await sessionIndexQueue;
      const entry = (await readSessionIndex()).sessions[sessionId];
      if (entry) {
        const indexed = await readPlan(entry.planId);
        if (indexed?.sessionId === sessionId) {
          return indexed;
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
  const normalized = planId.trim();
  assertSafePlanId(normalized);
  return normalized;
}

function recordsEqual(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
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
  if (plan.mode !== "direct" && plan.mode !== "debate") {
    throw new Error("计划模式非法。");
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
