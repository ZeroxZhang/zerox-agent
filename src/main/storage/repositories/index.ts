// Remaining repositories (Exit Criteria §6.7): task, toolAudit, toolResult,
// workspace, artifact, learning, evalCandidate, validation, memoryProfile,
// promotedEvalFixture. Each stores the full record as `payload` with
// denormalized indexed columns.

import { randomUUID, createHash } from "node:crypto";
import { readFileSync, statSync, lstatSync } from "node:fs";
import type {
  AgentArtifactProvenanceManifest,
  WriteArtifactProvenanceInput,
} from "../../../shared/agentArtifactProvenance";
import type { AgentWorkspace, AgentWorkspaceInput } from "../../../shared/agentWorkspace";
import type { ScheduledTask, ScheduledTaskInput } from "../../../shared/scheduledTasks";
import {
  computeNextRunAt,
  normalizeScheduledTaskInput,
} from "../../../shared/scheduledTasks";
import type {
  AgentLearningCandidate,
  AgentLearningCandidateInput,
  AgentLearningCandidateStatus,
  AgentLearningListOptions,
} from "../../../shared/agentLearning";
import type {
  AgentEvalCandidate,
  AgentEvalCandidateListOptions,
  AgentEvalCandidateStatus,
} from "../../../shared/agentEvalCandidate";
import type { ToolAuditEvent, ToolAuditEventInput } from "../../../shared/toolPermissions";
import type { AgentBootstrapValidationSnapshot } from "../../../shared/agentBootstrap";
import type { MemoryProfileDocument } from "../../../shared/memoryProfile";
import type { AgentEvalFixture } from "../../eval/agentEvalFixtures";
import type {
  ArtifactRepository,
  EvalCandidateRepository,
  LearningRepository,
  MemoryProfileRepository,
  Storage,
  TaskRepository,
  ToolAuditRepository,
  ToolResultRepository,
  ValidationRepository,
  WorkspaceRepository,
} from "../../../shared/storageContract";
import { getPayloadRow, jsonify, parseJson, selectPayloadRows } from "../repositoryUtils";

// ---------------------------------------------------------------------------
// TaskRepository
// ---------------------------------------------------------------------------

export function createTaskRepository(storage: Storage): TaskRepository {
  const db = storage.db;
  const buildTask = (input: ScheduledTaskInput & { id?: string }): ScheduledTask => {
    const existing = input as ScheduledTaskInput & Partial<ScheduledTask>;
    const now = existing.createdAt ?? new Date().toISOString();
    const normalized = normalizeScheduledTaskInput(input);
    return {
      ...normalized,
      id: input.id ?? randomUUID(),
      createdAt: existing.createdAt ?? now,
      updatedAt: existing.updatedAt ?? now,
      lastRunAt: existing.lastRunAt ?? null,
      nextRunAt: existing.nextRunAt ?? (normalized.enabled
        ? computeNextRunAt(normalized.schedule, new Date(now))
        : null),
    };
  };
  const persist = (task: ScheduledTask) => {
    db.prepare(
      `INSERT INTO tasks (id, name, skill_name, enabled, next_run_at, payload, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name, skill_name=excluded.skill_name, enabled=excluded.enabled,
         next_run_at=excluded.next_run_at, payload=excluded.payload, updated_at=excluded.updated_at`,
    ).run(task.id, task.name, task.skillName, task.enabled ? 1 : 0, task.nextRunAt, jsonify(task), task.createdAt, task.updatedAt);
  };
  return {
    list(): ScheduledTask[] {
      return selectPayloadRows<ScheduledTask>(db, "SELECT payload FROM tasks ORDER BY created_at ASC");
    },
    get(taskId: string): ScheduledTask | null {
      return getPayloadRow<ScheduledTask>(db, "SELECT payload FROM tasks WHERE id = ?", [taskId]);
    },
    create(input: ScheduledTaskInput & { id?: string }): ScheduledTask {
      const task = buildTask(input);
      persist(task);
      return task;
    },
    recordRun(taskId: string, completedAt: Date): ScheduledTask | null {
      const existing = this.get(taskId);
      if (!existing) return null;
      const at = completedAt.toISOString();
      const updated: ScheduledTask = {
        ...existing,
        lastRunAt: at,
        nextRunAt: existing.enabled
          ? computeNextRunAt(existing.schedule, completedAt)
          : null,
        updatedAt: at,
      };
      persist(updated);
      return updated;
    },
    setEnabled(taskId: string, enabled: boolean, changedAt?: Date): ScheduledTask | null {
      const existing = this.get(taskId);
      if (!existing) return null;
      const at = (changedAt ?? new Date()).toISOString();
      const updated: ScheduledTask = {
        ...existing,
        enabled,
        nextRunAt: enabled ? computeNextRunAt(existing.schedule, new Date(at)) : null,
        updatedAt: at,
      };
      persist(updated);
      return updated;
    },
    delete(taskId: string): boolean {
      return db.prepare("DELETE FROM tasks WHERE id = ?").run(taskId).changes > 0;
    },
  };
}

// ---------------------------------------------------------------------------
// ToolAuditRepository
// ---------------------------------------------------------------------------

export function createToolAuditRepository(storage: Storage): ToolAuditRepository {
  const db = storage.db;
  return {
    append(input: ToolAuditEventInput): ToolAuditEvent {
      const existing = input as ToolAuditEventInput & Partial<ToolAuditEvent>;
      const event: ToolAuditEvent = {
        ...input,
        id: existing.id ?? randomUUID(),
        createdAt: existing.createdAt ?? new Date().toISOString(),
      };
      const tool = input.request?.toolName ?? null;
      const runId = (input as { taskId?: string }).taskId ?? null;
      db.prepare(
        `INSERT INTO tool_audit (id, run_id, tool, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
      ).run(event.id, runId, tool, jsonify(event), event.createdAt);
      return event;
    },
    list(options?: { limit?: number }): ToolAuditEvent[] {
      const limit = options?.limit ?? 1000;
      return selectPayloadRows<ToolAuditEvent>(
        db,
        "SELECT payload FROM tool_audit ORDER BY created_at DESC, rowid DESC LIMIT ?",
        [limit],
      );
    },
  };
}

// ---------------------------------------------------------------------------
// ToolResultRepository (content is a raw string, not JSON)
// ---------------------------------------------------------------------------

export function createToolResultRepository(storage: Storage): ToolResultRepository {
  const db = storage.db;
  const ROOT = "tool-result-refs";
  return {
    write(input: { runId?: string; content: string; refId?: string }): {
      refId: string;
      relativePath: string;
    } {
      const refId = input.refId ?? randomUUID();
      const relativePath = `${ROOT}/${refId}.json`;
      db.prepare(
        `INSERT OR REPLACE INTO tool_results (ref_key, run_id, blob, created_at) VALUES (?, ?, ?, ?)`,
      ).run(refId, input.runId ?? null, input.content, new Date().toISOString());
      return { refId, relativePath };
    },
    read(relativePath: string): string | null {
      // Accept either a bare refId or a "tool-result-refs/<refId>.json" path.
      const refId = relativePath.replace(/^tool-result-refs\//, "").replace(/\.json$/, "");
      const row = db
        .prepare("SELECT blob FROM tool_results WHERE ref_key = ?")
        .get<{ blob: string }>(refId);
      return row ? row.blob : null;
    },
  };
}

// ---------------------------------------------------------------------------
// WorkspaceRepository
// ---------------------------------------------------------------------------

export function createWorkspaceRepository(storage: Storage): WorkspaceRepository {
  const db = storage.db;
  const toRow = (w: AgentWorkspace) => ({
    id: w.id,
    name: w.name,
    root_path: w.rootPath,
    kind: w.kind,
    sandbox_policy: null, // AgentWorkspace does not carry a sandbox policy; P6 may denormalize one here.
    git_metadata: w.git ? jsonify(w.git) : null,
    payload: jsonify(w),
    created_at: w.createdAt,
    updated_at: w.updatedAt,
    last_used_at: w.lastUsedAt ?? null,
  });
  const createFromInput = (input: AgentWorkspaceInput): AgentWorkspace => {
    const now = new Date().toISOString();
    return {
      id: randomUUID(),
      name: input.name,
      rootPath: input.rootPath,
      kind: input.kind,
      cleanup: input.cleanup,
      ...(input.git ? { git: input.git } : {}),
      createdAt: now,
      updatedAt: now,
      lastUsedAt: null,
    };
  };
  return {
    get(id: string): AgentWorkspace | null {
      return getPayloadRow<AgentWorkspace>(db, "SELECT payload FROM workspaces WHERE id = ?", [id]);
    },
    list(): AgentWorkspace[] {
      return selectPayloadRows<AgentWorkspace>(db, "SELECT payload FROM workspaces ORDER BY updated_at DESC");
    },
    save(workspace: AgentWorkspace): AgentWorkspace {
      const row = toRow(workspace);
      db.prepare(
        `INSERT INTO workspaces (id, name, root_path, kind, sandbox_policy, git_metadata, payload, created_at, updated_at, last_used_at)
         VALUES (@id, @name, @root_path, @kind, @sandbox_policy, @git_metadata, @payload, @created_at, @updated_at, @last_used_at)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, root_path=excluded.root_path, kind=excluded.kind,
           sandbox_policy=excluded.sandbox_policy, git_metadata=excluded.git_metadata,
           payload=excluded.payload, updated_at=excluded.updated_at, last_used_at=excluded.last_used_at`,
      ).run(row);
      return workspace;
    },
    create(input: AgentWorkspaceInput): AgentWorkspace {
      const ws = createFromInput(input);
      return this.save(ws);
    },
    touch(id: string): AgentWorkspace | null {
      const existing = this.get(id);
      if (!existing) return null;
      const now = new Date().toISOString();
      const updated: AgentWorkspace = { ...existing, lastUsedAt: now, updatedAt: now };
      return this.save(updated);
    },
    delete(id: string): boolean {
      return db.prepare("DELETE FROM workspaces WHERE id = ?").run(id).changes > 0;
    },
  };
}

// ---------------------------------------------------------------------------
// ArtifactRepository
// ---------------------------------------------------------------------------

export function createArtifactRepository(storage: Storage): ArtifactRepository {
  const db = storage.db;
  return {
    writeProvenance(input: WriteArtifactProvenanceInput): AgentArtifactProvenanceManifest {
      // Build the manifest synchronously (sha256 + sizeBytes from the artifact
      // file). The legacy async `writeArtifactProvenance` sidecar write stays at
      // its existing call site (agentToolExecutor); this repository indexes the
      // manifest into SQLite for cross-run queries.
      const stat = lstatSync(input.artifactPath);
      if (stat.isSymbolicLink()) {
        throw new Error("Artifact provenance path must not be a symlink.");
      }
      const buf = readFileSync(input.artifactPath);
      const sha256 = createHash("sha256").update(buf).digest("hex");
      const sizeBytes = statSync(input.artifactPath).size;
      const manifest: AgentArtifactProvenanceManifest = {
        schemaVersion: 1,
        kind: "zerox.artifactProvenance",
        runId: input.runId,
        ...(input.goalId ? { goalId: input.goalId } : {}),
        ...(input.milestoneId ? { milestoneId: input.milestoneId } : {}),
        artifactId: input.artifactId,
        artifactRef: input.artifactRef,
        source: input.source,
        destination: { path: input.artifactPath, sha256, sizeBytes },
        generatedAt: input.generatedAt ?? new Date().toISOString(),
      };
      db.prepare(
        `INSERT OR REPLACE INTO artifacts (id, run_id, goal_id, milestone_id, path, sha256, source, payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        manifest.artifactId,
        manifest.runId,
        manifest.goalId ?? null,
        manifest.milestoneId ?? null,
        manifest.destination.path,
        manifest.destination.sha256,
        jsonify(manifest.source),
        jsonify(manifest),
        manifest.generatedAt,
      );
      return manifest;
    },
    get(artifactId: string): AgentArtifactProvenanceManifest | null {
      return getPayloadRow<AgentArtifactProvenanceManifest>(
        db,
        "SELECT payload FROM artifacts WHERE id = ?",
        [artifactId],
      );
    },
    listByRun(runId: string): AgentArtifactProvenanceManifest[] {
      return selectPayloadRows<AgentArtifactProvenanceManifest>(
        db,
        "SELECT payload FROM artifacts WHERE run_id = ? ORDER BY created_at ASC",
        [runId],
      );
    },
  };
}

// ---------------------------------------------------------------------------
// LearningRepository
// ---------------------------------------------------------------------------

export function createLearningRepository(storage: Storage): LearningRepository {
  const db = storage.db;
  return {
    create(input: AgentLearningCandidateInput): AgentLearningCandidate {
      const existing = input as AgentLearningCandidateInput & Partial<AgentLearningCandidate>;
      const now = existing.createdAt ?? new Date().toISOString();
      const candidate: AgentLearningCandidate = {
        ...input,
        id: existing.id ?? randomUUID(),
        status: existing.status ?? "pending_review",
        createdAt: existing.createdAt ?? now,
        updatedAt: existing.updatedAt ?? now,
      };
      db.prepare(
        `INSERT INTO learning_candidates (id, source_run_id, type, status, payload, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           source_run_id=excluded.source_run_id, type=excluded.type, status=excluded.status,
           payload=excluded.payload, created_at=excluded.created_at, updated_at=excluded.updated_at`,
      ).run(
        candidate.id,
        candidate.sourceRunId,
        candidate.type,
        candidate.status,
        jsonify(candidate),
        candidate.createdAt,
        candidate.updatedAt,
      );
      return candidate;
    },
    list(options?: AgentLearningListOptions): AgentLearningCandidate[] {
      if (options?.status) {
        return selectPayloadRows<AgentLearningCandidate>(
          db,
          "SELECT payload FROM learning_candidates WHERE status = ? ORDER BY created_at DESC",
          [options.status],
        );
      }
      if (options?.type) {
        return selectPayloadRows<AgentLearningCandidate>(
          db,
          "SELECT payload FROM learning_candidates WHERE type = ? ORDER BY created_at DESC",
          [options.type],
        );
      }
      return selectPayloadRows<AgentLearningCandidate>(
        db,
        "SELECT payload FROM learning_candidates ORDER BY created_at DESC",
      );
    },
    setStatus(candidateId: string, status: AgentLearningCandidateStatus): AgentLearningCandidate | null {
      const existing = getPayloadRow<AgentLearningCandidate>(
        db,
        "SELECT payload FROM learning_candidates WHERE id = ?",
        [candidateId],
      );
      if (!existing) return null;
      const updated: AgentLearningCandidate = { ...existing, status, updatedAt: new Date().toISOString() };
      db.prepare("UPDATE learning_candidates SET status = ?, payload = ?, updated_at = ? WHERE id = ?").run(
        status,
        jsonify(updated),
        updated.updatedAt,
        candidateId,
      );
      return updated;
    },
  };
}

// ---------------------------------------------------------------------------
// EvalCandidateRepository (with transitionStatus CAS)
// ---------------------------------------------------------------------------

export function createEvalCandidateRepository(storage: Storage): EvalCandidateRepository {
  const db = storage.db;
  return {
    create(candidate: AgentEvalCandidate): AgentEvalCandidate {
      db.prepare(
        `INSERT OR REPLACE INTO eval_candidates (id, source_run_id, status, payload, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(candidate.id, candidate.sourceRunId, candidate.status, jsonify(candidate), candidate.createdAt, candidate.updatedAt);
      return candidate;
    },
    list(options?: AgentEvalCandidateListOptions): AgentEvalCandidate[] {
      if (options?.status) {
        return selectPayloadRows<AgentEvalCandidate>(
          db,
          "SELECT payload FROM eval_candidates WHERE status = ? ORDER BY created_at DESC",
          [options.status],
        );
      }
      return selectPayloadRows<AgentEvalCandidate>(
        db,
        "SELECT payload FROM eval_candidates ORDER BY created_at DESC",
      );
    },
    setStatus(candidateId: string, status: AgentEvalCandidateStatus): AgentEvalCandidate | null {
      const existing = getPayloadRow<AgentEvalCandidate>(
        db,
        "SELECT payload FROM eval_candidates WHERE id = ?",
        [candidateId],
      );
      if (!existing) return null;
      const updated: AgentEvalCandidate = { ...existing, status, updatedAt: new Date().toISOString() };
      db.prepare("UPDATE eval_candidates SET status = ?, payload = ?, updated_at = ? WHERE id = ?").run(
        status,
        jsonify(updated),
        updated.updatedAt,
        candidateId,
      );
      return updated;
    },
    transitionStatus(
      candidateId: string,
      expected: AgentEvalCandidateStatus,
      next: AgentEvalCandidateStatus,
    ): AgentEvalCandidate | null {
      // CAS: only update if current status matches expected.
      const existing = getPayloadRow<AgentEvalCandidate>(
        db,
        "SELECT payload FROM eval_candidates WHERE id = ?",
        [candidateId],
      );
      if (!existing || existing.status !== expected) return null;
      return this.setStatus(candidateId, next);
    },
  };
}

// ---------------------------------------------------------------------------
// ValidationRepository (singleton)
// ---------------------------------------------------------------------------

export function createValidationRepository(storage: Storage): ValidationRepository {
  const db = storage.db;
  return {
    load(): AgentBootstrapValidationSnapshot | null {
      return getPayloadRow<AgentBootstrapValidationSnapshot>(
        db,
        "SELECT payload FROM validation_snapshots WHERE id = 'latest'",
      );
    },
    save(snapshot: AgentBootstrapValidationSnapshot): AgentBootstrapValidationSnapshot {
      const now = snapshot.validatedAt;
      db.prepare(
        `INSERT OR REPLACE INTO validation_snapshots (id, payload, created_at) VALUES ('latest', ?, ?)`,
      ).run(jsonify(snapshot), now);
      return snapshot;
    },
  };
}

// ---------------------------------------------------------------------------
// MemoryProfileRepository (singleton markdown)
// ---------------------------------------------------------------------------

export function createMemoryProfileRepository(storage: Storage): MemoryProfileRepository {
  const db = storage.db;
  return {
    read(): MemoryProfileDocument {
      const row = db
        .prepare("SELECT content, updated_at FROM memory_profile WHERE id = 'singleton'")
        .get<{ content: string; updated_at: string }>();
      if (!row) return { content: "", updatedAt: new Date().toISOString() };
      return { content: row.content, updatedAt: row.updated_at };
    },
    save(content: string): MemoryProfileDocument {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT OR REPLACE INTO memory_profile (id, content, updated_at) VALUES ('singleton', ?, ?)`,
      ).run(content, now);
      return { content, updatedAt: now };
    },
  };
}

// ---------------------------------------------------------------------------
// PromotedEvalFixtureRepository
// ---------------------------------------------------------------------------

export interface PromotedEvalFixtureRepository {
  list(): AgentEvalFixture[];
  upsert(fixture: AgentEvalFixture): AgentEvalFixture;
}

export function createPromotedEvalFixtureRepository(
  storage: Storage,
): PromotedEvalFixtureRepository {
  const db = storage.db;
  return {
    list(): AgentEvalFixture[] {
      return selectPayloadRows<AgentEvalFixture>(
        db,
        "SELECT payload FROM promoted_eval_fixtures ORDER BY created_at ASC",
      );
    },
    upsert(fixture: AgentEvalFixture): AgentEvalFixture {
      db.prepare(
        `INSERT OR REPLACE INTO promoted_eval_fixtures (id, source_candidate_id, payload, created_at)
         VALUES (?, ?, ?, ?)`,
      ).run(fixture.id, null, jsonify(fixture), new Date().toISOString());
      return fixture;
    },
  };
}
