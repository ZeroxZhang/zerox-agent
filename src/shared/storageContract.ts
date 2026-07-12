// Storage contract types (iteration-roadmap §1 Storage Contract, `contracts v1.4`).
//
// These are the frozen cross-phase interfaces that P1 implements in
// `src/main/storage/` and that P2/P5/P6/P7 consume directly. They live in
// `src/shared/` so both the main process and tests can reference them without
// importing the better-sqlite3-backed implementation.
//
// Repository methods are SYNCHRONOUS (better-sqlite3 is synchronous, and
// contract §1.4 forbids async-ifying the hot path). Existing `*Store`
// factories keep their async public signatures and proxy to these repositories
// — that dual layering is P1's compatibility commitment (spec §3.1).

import type { AgentRunRecord, AgentRunStatus } from "./agentRuns";
import type {
  AgentTrajectoryEvent,
  AgentTrajectoryEventType,
} from "./agentTrajectory";
import type { Goal, ProgressLedgerEvent } from "./agentGoal";
import type {
  AgentRole,
  AgentSandboxPolicy,
  AgentWorkspace,
  AgentWorkspaceInput,
  MultiAgentSessionStatus,
} from "./agentWorkspace";
import type { ScheduledTask, ScheduledTaskInput } from "./scheduledTasks";
import type {
  AgentLearningCandidate,
  AgentLearningCandidateInput,
  AgentLearningCandidateStatus,
  AgentLearningListOptions,
} from "./agentLearning";
import type {
  AgentEvalCandidate,
  AgentEvalCandidateListOptions,
  AgentEvalCandidateStatus,
} from "./agentEvalCandidate";
import type {
  AgentArtifactProvenanceManifest,
  WriteArtifactProvenanceInput,
} from "./agentArtifactProvenance";
import type { ToolAuditEvent, ToolAuditEventInput } from "./toolPermissions";
import type {
  ChatMessageSearchOptions,
  ChatMessageSearchResult,
} from "./chat";
import type { AgentBootstrapValidationSnapshot } from "./agentBootstrap";
import type {
  MemoryKind,
  MemoryListOptions,
  MemoryRecord,
  MemorySearchOptions,
  MemorySearchResult,
} from "./memory";
import type { MemoryProfileDocument } from "./memoryProfile";

// ---------------------------------------------------------------------------
// Storage service (contract §1.3)
// ---------------------------------------------------------------------------

export interface Storage {
  /** better-sqlite3 handle, exposed read-only for repositories. */
  readonly db: StorageDatabase;
  /** Run pending migrations (idempotent). */
  migrate(): Promise<void>;
  /** Back up the database file, returning the backup path. */
  backup(): Promise<string>;
  /** Close the database handle. */
  close(): void;
}

/**
 * Minimal structural view of the better-sqlite3 `Database` used by repositories
 * and tests. The concrete type is `import("better-sqlite3").Database`; this
 * interface keeps `src/shared/` free of the native dependency.
 */
export interface StorageDatabase {
  prepare(sql: string): StorageStatement;
  exec(sql: string): void;
  pragma(sql: string): unknown;
  transaction<T>(fn: () => T): T;
  close(): void;
}

export interface StorageStatement {
  run(...params: unknown[]): StorageRunResult;
  get<T = unknown>(...params: unknown[]): T | undefined;
  all<T = unknown>(...params: unknown[]): T[];
}

export interface StorageRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

// ---------------------------------------------------------------------------
// Backend resolution (contract §1.4 / spec T1.4)
// ---------------------------------------------------------------------------

export type StorageBackend = "json" | "sqlite" | "dual";

// ---------------------------------------------------------------------------
// Run & Trajectory (contract §1.3, Exit Criteria §6.2)
// ---------------------------------------------------------------------------

export interface RunRepository {
  create(input: Omit<AgentRunRecord, "id"> & { id: string }): AgentRunRecord;
  get(runId: string): AgentRunRecord | null;
  list(options?: { limit?: number; taskId?: string }): AgentRunRecord[];
  updateStatus(runId: string, status: AgentRunStatus): void;
  appendTrajectory(
    runId: string,
    event: AgentTrajectoryEvent,
  ): AgentTrajectoryEvent;
  getTrajectory(
    runId: string,
    opts?: { fromSeq?: number },
  ): AgentTrajectoryEvent[];
}

export interface TrajectoryRepository {
  getTrajectory(
    runId: string,
    opts?: { fromSeq?: number; types?: AgentTrajectoryEventType[] },
  ): AgentTrajectoryEvent[];
  scanByTypes(
    types: AgentTrajectoryEventType[],
    opts?: { runId?: string; limit?: number },
  ): AgentTrajectoryEvent[];
}

// ---------------------------------------------------------------------------
// Checkpoint (contract §1.3, Exit Criteria §6.3)
// ---------------------------------------------------------------------------

export type CheckpointKind = "runtime" | "checkpoint" | "markdown";

export interface CheckpointRecord {
  id: string;
  runId: string;
  kind: CheckpointKind;
  ref: string;
  payload: unknown;
  createdAt: string;
}

export interface CheckpointRepository {
  write(runId: string, kind: CheckpointKind, data: unknown): string;
  latest(runId: string, kind?: CheckpointKind): CheckpointRecord | null;
  list(runId: string): CheckpointRecord[];
  read<T = unknown>(ref: string): T | null;
  listActive(): CheckpointRecord[];
  delete(runId: string): boolean;
}

// ---------------------------------------------------------------------------
// Memory (contract §7, Exit Criteria §6.4)
// ---------------------------------------------------------------------------

export type MemoryScope = "project" | "global" | "session";

export type MemoryArchiveReason =
  | "consolidated"
  | "superseded"
  | "stale"
  | "user_archived";

export interface MemoryRepository {
  write(record: Omit<MemoryRecord, "id"> & { id: string }): string;
  get(id: string): MemoryRecord | null;
  search(query: MemorySearchOptions): MemorySearchResult[];
  archive(
    id: string,
    consolidatedInto?: string,
    reason?: MemoryArchiveReason,
  ): void;
  listByScope(scope: MemoryScope): MemoryRecord[];
  list(options?: MemoryListOptions): MemoryRecord[];
  delete(id: string): boolean;
}

// ---------------------------------------------------------------------------
// Goal (contract §8, Exit Criteria §6.5)
// ---------------------------------------------------------------------------

export interface GoalRepository {
  save(goal: Goal): Goal;
  saveIfStatus(
    goal: Goal,
    expectedStatus: Goal["status"],
  ): { saved: boolean; goal: Goal | null };
  get(goalId: string): Goal | null;
  listActive(): Goal[];
  listByChatSession(chatSessionId: string): Goal[];
  delete(goalId: string): boolean;
  appendLedger(goalId: string, event: ProgressLedgerEvent): void;
  readLedger(goalId: string): ProgressLedgerEvent[];
}

// ---------------------------------------------------------------------------
// Session & Actor (contract §1.3, Exit Criteria §6.6)
// ---------------------------------------------------------------------------

export type SessionKind = "chat" | "goal" | "scheduled" | "multi_agent";

export interface SessionRecord {
  id: string;
  kind: SessionKind;
  parentSessionId?: string;
  agentRole?: AgentRole;
  title?: string;
  rootRunId?: string;
  status?: MultiAgentSessionStatus;
  workspaceId?: string;
  childRunIds?: string[];
  roles?: Record<string, AgentRole>;
  payload: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface SessionInput {
  id: string;
  kind: SessionKind;
  parentSessionId?: string;
  agentRole?: AgentRole;
  title?: string;
  rootRunId?: string;
  status?: MultiAgentSessionStatus;
  workspaceId?: string;
  childRunIds?: string[];
  roles?: Record<string, AgentRole>;
  payload?: unknown;
  createdAt?: string;
  updatedAt?: string;
}

export interface AppendChatMessageInput {
  sessionId: string;
  role: string;
  content: unknown;
  createdAt?: string;
  message?: unknown;
}

export interface AppendChatMessageResult {
  messageId: string;
  sessionId: string;
  createdAt: string;
}

export interface SessionRepository {
  createSession(input: SessionInput): SessionRecord;
  getSession(id: string): SessionRecord | null;
  listSessions(options?: { kind?: SessionKind }): SessionRecord[];
  appendChildRun(
    sessionId: string,
    runId: string,
    role: AgentRole,
  ): SessionRecord | null;
  setSessionStatus(
    sessionId: string,
    status: MultiAgentSessionStatus,
  ): SessionRecord | null;
  appendMessage(input: AppendChatMessageInput): AppendChatMessageResult;
  searchMessages(
    options: ChatMessageSearchOptions,
  ): ChatMessageSearchResult[];
}

export type ActorStatus =
  | "spawning"
  | "running"
  | "done"
  | "canceled"
  | "error";

export interface ActorRecord {
  id: string;
  runId: string;
  parentActorId?: string;
  contextMode: "none" | "state" | "full";
  status: ActorStatus;
  task?: string;
  payload: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface ActorInput {
  id: string;
  runId: string;
  parentActorId?: string;
  contextMode: "none" | "state" | "full";
  status: ActorStatus;
  task?: string;
  payload?: unknown;
  createdAt?: string;
  updatedAt?: string;
}

export interface ActorRepository {
  create(input: Omit<ActorRecord, "id"> & { id: string }): string;
  get(actorId: string): ActorRecord | null;
  listByRun(runId: string): ActorRecord[];
  updateStatus(actorId: string, status: ActorStatus): void;
}

// ---------------------------------------------------------------------------
// Remaining repositories (Exit Criteria §6.7)
// ---------------------------------------------------------------------------

export interface TaskRepository {
  list(): ScheduledTask[];
  get(taskId: string): ScheduledTask | null;
  create(input: ScheduledTaskInput & { id?: string }): ScheduledTask;
  update(
    taskId: string,
    input: ScheduledTaskInput,
    changedAt?: Date,
  ): ScheduledTask | null;
  recordRun(taskId: string, completedAt: Date): ScheduledTask | null;
  setEnabled(
    taskId: string,
    enabled: boolean,
    changedAt?: Date,
  ): ScheduledTask | null;
  delete(taskId: string): boolean;
}

export interface ToolAuditRepository {
  append(input: ToolAuditEventInput): ToolAuditEvent;
  list(options?: { limit?: number }): ToolAuditEvent[];
}

export interface ToolResultRepository {
  write(input: {
    runId?: string;
    content: string;
    refId?: string;
  }): { refId: string; relativePath: string };
  read(relativePath: string): string | null;
}

export interface WorkspaceRepository {
  get(id: string): AgentWorkspace | null;
  list(): AgentWorkspace[];
  save(workspace: AgentWorkspace): AgentWorkspace;
  create(input: AgentWorkspaceInput): AgentWorkspace;
  touch(id: string): AgentWorkspace | null;
  delete(id: string): boolean;
}

export interface ArtifactRepository {
  writeProvenance(input: WriteArtifactProvenanceInput): AgentArtifactProvenanceManifest;
  get(artifactId: string): AgentArtifactProvenanceManifest | null;
  listByRun(runId: string): AgentArtifactProvenanceManifest[];
}

export interface LearningRepository {
  create(input: AgentLearningCandidateInput): AgentLearningCandidate;
  list(options?: AgentLearningListOptions): AgentLearningCandidate[];
  setStatus(
    candidateId: string,
    status: AgentLearningCandidateStatus,
  ): AgentLearningCandidate | null;
}

export interface EvalCandidateRepository {
  create(candidate: AgentEvalCandidate): AgentEvalCandidate;
  list(options?: AgentEvalCandidateListOptions): AgentEvalCandidate[];
  setStatus(
    candidateId: string,
    status: AgentEvalCandidateStatus,
  ): AgentEvalCandidate | null;
  transitionStatus(
    candidateId: string,
    expected: AgentEvalCandidateStatus,
    next: AgentEvalCandidateStatus,
  ): AgentEvalCandidate | null;
}

export interface ValidationRepository {
  load(): AgentBootstrapValidationSnapshot | null;
  save(snapshot: AgentBootstrapValidationSnapshot): AgentBootstrapValidationSnapshot;
}

export interface MemoryProfileRepository {
  read(): MemoryProfileDocument;
  save(content: string): MemoryProfileDocument;
}

// Re-export kinds consumed by repositories for caller convenience.
export type {
  MemoryKind,
  MemoryRecord,
  MemorySearchOptions,
  MemorySearchResult,
  MemoryListOptions,
} from "./memory";

// AgentSandboxPolicy re-exported so repository consumers can import policy
// shapes alongside the storage contract in a single module if desired.
export type { AgentSandboxPolicy } from "./agentWorkspace";
