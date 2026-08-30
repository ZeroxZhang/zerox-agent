import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  createConversationSourcePage,
  createConversationSourceQueryHash,
  normalizeConversationSourcePageLimit,
  parseConversationSourceCursor,
  type ConversationSourcePage,
  type ConversationSourcePageOptions,
} from "../shared/conversationEvidence";
import {
  readRecoverableJsonl,
  readRecoverableJsonlPage,
} from "./jsonlRecovery";
import {
  createWorkspaceRunEvent,
  getNextWorkspaceRunEventSeq,
  projectChatTrajectoryEvents,
  type ChatTrajectoryEvent,
  type WorkspaceRun,
  type WorkspaceRunEvent,
  type WorkspaceRunEventInput,
  type WorkspaceRunLifecycleSettlementInput,
  type WorkspaceRunLifecycleSettlementResult,
  type WorkspaceRunStatus,
  type WorkspaceRunTerminalStatus,
  canTransitionWorkspaceRunStatus,
  isWorkspaceRunTerminalStatus,
} from "../shared/workspaceRunLedger";

export type CreateWorkspaceRunInput = {
  workspaceRunId?: string;
  sessionId: string;
  requestId: string;
  workspaceId?: string;
  workspaceRoot?: string;
  selectedSkillName?: string;
  status?: Extract<WorkspaceRunStatus, "queued" | "running">;
  createdAt?: string;
};

export type WorkspaceRunStore = {
  createRun(input: CreateWorkspaceRunInput): Promise<WorkspaceRun>;
  ensureRun(input: CreateWorkspaceRunInput & { workspaceRunId: string }): Promise<{
    run: WorkspaceRun;
    disposition: "created" | "existing";
  }>;
  getRun(workspaceRunId: string): Promise<WorkspaceRun | null>;
  appendEvent(
    workspaceRunId: string,
    event: WorkspaceRunEventInput,
  ): Promise<WorkspaceRunEvent>;
  listEvents(workspaceRunId: string): Promise<WorkspaceRunEvent[]>;
  getEventPage?(
    workspaceRunId: string,
    options?: ConversationSourcePageOptions,
  ): Promise<ConversationSourcePage<WorkspaceRunEvent>>;
  listChatTrajectory(sessionId: string): Promise<ChatTrajectoryEvent[]>;
  settleLifecycle(
    input: WorkspaceRunLifecycleSettlementInput,
  ): Promise<WorkspaceRunLifecycleSettlementResult>;
  finishRun(
    workspaceRunId: string,
    status: WorkspaceRunTerminalStatus,
    summary?: string,
  ): Promise<WorkspaceRun>;
};

export class WorkspaceRunEnvelopeConflictError extends Error {}

export function createWorkspaceRunStore(options: {
  configDir: string;
  createId?: () => string;
  now?: () => Date;
}): WorkspaceRunStore {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const rootDir = path.join(options.configDir, "workspace-runs");
  const eventsDir = path.join(rootDir, "events");
  const runsPath = path.join(rootDir, "runs.jsonl");
  let mutationQueue: Promise<void> = Promise.resolve();

  function eventPath(workspaceRunId: string): string {
    return path.join(eventsDir, `${encodeURIComponent(workspaceRunId)}.jsonl`);
  }

  async function appendRunSnapshot(run: WorkspaceRun): Promise<void> {
    await appendJsonl(rootDir, runsPath, run);
  }

  async function readRunSnapshots(): Promise<WorkspaceRun[]> {
    return readRecoverableJsonl<WorkspaceRun>(runsPath);
  }

  async function readLatestRun(
    workspaceRunId: string,
  ): Promise<WorkspaceRun | null> {
    const runs = await readRunSnapshots();
    for (let index = runs.length - 1; index >= 0; index -= 1) {
      if (runs[index].workspaceRunId === workspaceRunId) {
        return runs[index];
      }
    }

    return null;
  }

  async function readLatestRuns(): Promise<WorkspaceRun[]> {
    const byRunId = new Map<string, WorkspaceRun>();
    for (const run of await readRunSnapshots()) {
      byRunId.set(run.workspaceRunId, run);
    }

    return [...byRunId.values()];
  }

  async function readEvents(
    workspaceRunId: string,
  ): Promise<WorkspaceRunEvent[]> {
    return readRecoverableJsonl<WorkspaceRunEvent>(eventPath(workspaceRunId));
  }

  async function repairRunSnapshotFromEvents(
    run: WorkspaceRun,
  ): Promise<WorkspaceRun> {
    const latestLifecycleEvent = (await readEvents(run.workspaceRunId))
      .filter((event) => Boolean(
        event.lifecycleStatus ?? (event.type === "status" ? event.status : undefined),
      ))
      .at(-1);
    const latestLifecycleStatus = latestLifecycleEvent?.lifecycleStatus
      ?? (latestLifecycleEvent?.type === "status" ? latestLifecycleEvent.status : undefined);
    if (!latestLifecycleEvent || !latestLifecycleStatus || latestLifecycleStatus === run.status) {
      return run;
    }
    if (!canTransitionWorkspaceRunStatus(run.status, latestLifecycleStatus)) {
      return run;
    }
    const repaired = transitionRunSnapshot(
      run,
      latestLifecycleStatus,
      latestLifecycleEvent.createdAt,
      latestLifecycleEvent.message,
    );
    await appendRunSnapshot(repaired);
    return repaired;
  }

  return {
    async createRun(input) {
      return serializeMutation(mutationQueue, (nextQueue) => {
        mutationQueue = nextQueue;
      }, async () => {
        const workspaceRunId = input.workspaceRunId ?? `workspace_run_${createId()}`;
        const existing = await readLatestRun(workspaceRunId);
        if (existing) {
          throw new Error(`Workspace run "${workspaceRunId}" already exists.`);
        }

        const timestamp = input.createdAt ?? now().toISOString();
        const status = input.status ?? "running";
        const run: WorkspaceRun = {
          workspaceRunId,
          sessionId: input.sessionId,
          requestId: input.requestId,
          ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
          ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
          ...(input.selectedSkillName
            ? { selectedSkillName: input.selectedSkillName }
            : {}),
          status,
          createdAt: timestamp,
          updatedAt: timestamp,
          ...(status === "running" ? { startedAt: timestamp } : {}),
        };

        await appendRunSnapshot(run);
        return run;
      });
    },

    async ensureRun(input) {
      return serializeMutation(mutationQueue, (nextQueue) => {
        mutationQueue = nextQueue;
      }, async () => {
        const existing = await readLatestRun(input.workspaceRunId);
        if (existing) {
          if (!workspaceRunEnvelopeMatches(existing, input)) {
            throw new WorkspaceRunEnvelopeConflictError(
              `Workspace run "${input.workspaceRunId}" envelope conflicts with the existing run.`,
            );
          }
          return {
            run: await repairRunSnapshotFromEvents(existing),
            disposition: "existing" as const,
          };
        }
        const timestamp = input.createdAt ?? now().toISOString();
        const status = input.status ?? "running";
        const run = createRunSnapshot(input, status, timestamp);
        await appendRunSnapshot(run);
        return { run, disposition: "created" as const };
      });
    },

    async getRun(workspaceRunId) {
      return serializeMutation(mutationQueue, (nextQueue) => {
        mutationQueue = nextQueue;
      }, async () => {
        const run = await readLatestRun(workspaceRunId);
        return run ? repairRunSnapshotFromEvents(run) : null;
      });
    },

    async appendEvent(workspaceRunId, input) {
      return serializeMutation(mutationQueue, (nextQueue) => {
        mutationQueue = nextQueue;
      }, async () => {
        const run = await readLatestRun(workspaceRunId);
        if (!run) {
          throw new Error(`Workspace run "${workspaceRunId}" was not found.`);
        }

        const events = await readEvents(workspaceRunId);
        const event = createWorkspaceRunEvent({
          run,
          input,
          id: input.id ?? createId(),
          seq: getNextWorkspaceRunEventSeq(events),
          createdAt: input.createdAt ?? now().toISOString(),
        });

        await appendJsonl(eventsDir, eventPath(workspaceRunId), event);
        return event;
      });
    },

    async listEvents(workspaceRunId) {
      return readEvents(workspaceRunId);
    },

    async getEventPage(workspaceRunId, pageOptions) {
      return readWorkspaceEventPage(
        eventPath(workspaceRunId),
        workspaceRunId,
        pageOptions,
      );
    },

    async listChatTrajectory(sessionId) {
      const runs = (await readLatestRuns())
        .filter((run) => run.sessionId === sessionId)
        .sort(compareRunsByCreatedAtAsc);
      const eventsByRun = await Promise.all(
        runs.map((run) => readEvents(run.workspaceRunId)),
      );
      const events = eventsByRun.flat().sort(compareEventsForChatTrajectory);

      return projectChatTrajectoryEvents(events);
    },

    async settleLifecycle(input) {
      return serializeMutation(mutationQueue, (nextQueue) => {
        mutationQueue = nextQueue;
      }, async () => {
        const storedRun = await readLatestRun(input.workspaceRunId);
        if (!storedRun) {
          throw new Error(`Workspace run "${input.workspaceRunId}" was not found.`);
        }
        const run = await repairRunSnapshotFromEvents(storedRun);
        const events = await readEvents(input.workspaceRunId);
        const existingEvent = events.find((event) => event.id === input.event.id);
        const targetStatus = input.snapshotStatus
          ?? (input.event.type === "status" ? input.event.status : run.status);
        if (existingEvent) {
          const candidate = createWorkspaceRunEvent({
            run,
            input: {
              ...input.event,
              lifecycleStatus: targetStatus,
            },
            id: input.event.id,
            seq: existingEvent.seq,
            createdAt: input.event.createdAt,
          });
          if (!isDeepStrictEqual(existingEvent, candidate)) {
            throw new Error(
              `Workspace run event id conflict: ${input.event.id}.`,
            );
          }
          return {
            event: existingEvent,
            run,
            disposition: "duplicate" as const,
          };
        }
        if (!canTransitionWorkspaceRunStatus(run.status, targetStatus)) {
          throw new Error(
            `Workspace run "${input.workspaceRunId}" cannot transition from ${run.status} to ${targetStatus}.`,
          );
        }
        const event = createWorkspaceRunEvent({
          run,
          input: {
            ...input.event,
            lifecycleStatus: targetStatus,
          },
          id: input.event.id,
          seq: getNextWorkspaceRunEventSeq(events),
          createdAt: input.event.createdAt,
        });
        await appendJsonl(eventsDir, eventPath(input.workspaceRunId), event);
        const nextRun = run.status === targetStatus
          ? run
          : transitionRunSnapshot(
              run,
              targetStatus,
              input.event.createdAt,
              input.summary ?? input.event.message,
            );
        if (nextRun !== run) await appendRunSnapshot(nextRun);
        return { event, run: nextRun, disposition: "applied" as const };
      });
    },

    async finishRun(workspaceRunId, status, summary) {
      return serializeMutation(mutationQueue, (nextQueue) => {
        mutationQueue = nextQueue;
      }, async () => {
        const stored = await readLatestRun(workspaceRunId);
        if (!stored) {
          throw new Error(`Workspace run "${workspaceRunId}" was not found.`);
        }
        const existing = await repairRunSnapshotFromEvents(stored);

        if (!canTransitionWorkspaceRunStatus(existing.status, status)) {
          throw new Error(
            `Workspace run "${workspaceRunId}" cannot transition from ${existing.status} to ${status}.`,
          );
        }
        if (isWorkspaceRunTerminalStatus(existing.status)) {
          return existing;
        }
        const timestamp = now().toISOString();
        const run = transitionRunSnapshot(existing, status, timestamp, summary);

        await appendRunSnapshot(run);
        return run;
      });
    },
  };
}

async function readWorkspaceEventPage(
  filePath: string,
  workspaceRunId: string,
  options?: ConversationSourcePageOptions,
): Promise<ConversationSourcePage<WorkspaceRunEvent>> {
  const queryHash = createConversationSourceQueryHash({
    source: "workspace_run",
    sourceId: workspaceRunId,
    filters: null,
  });
  const cursor = parseConversationSourceCursor(options?.cursor, {
    source: "workspace_run",
    sourceId: workspaceRunId,
    queryHash,
  });
  if (cursor.kind === "incompatible") {
    return createConversationSourcePage({
      source: "workspace_run",
      sourceId: workspaceRunId,
      queryHash,
      sourceRevision: "jsonl:unknown",
      status: "incompatible",
      reasonCode: cursor.reasonCode,
      records: [],
    });
  }
  const pinned = cursor.kind === "position"
    ? parseJsonlRevision(cursor.sourceRevision)
    : undefined;
  if (cursor.kind === "position" && !pinned) {
    return createConversationSourcePage({
      source: "workspace_run",
      sourceId: workspaceRunId,
      queryHash,
      sourceRevision: "jsonl:unknown",
      status: "incompatible",
      reasonCode: "source_cursor_mismatch",
      records: [],
    });
  }
  try {
    const page = await readRecoverableJsonlPage<WorkspaceRunEvent>(
      filePath,
      {
        offset: cursor.position,
        limit: normalizeConversationSourcePageLimit(options?.limit),
        ...(pinned
          ? {
              endOffset: pinned.endOffset,
              expectedIdentity: {
                dev: pinned.dev,
                ino: pinned.ino,
              },
            }
          : {}),
        signal: options?.signal,
      },
    );
    if (
      cursor.kind === "position"
      && page.sourceRevision !== cursor.sourceRevision
    ) {
      return createConversationSourcePage({
        source: "workspace_run",
        sourceId: workspaceRunId,
        queryHash,
        sourceRevision: page.sourceRevision,
        status: "incompatible",
        reasonCode: "source_cursor_mismatch",
        records: [],
      });
    }
    return createConversationSourcePage({
      source: "workspace_run",
      sourceId: workspaceRunId,
      queryHash,
      sourceRevision: page.sourceRevision,
      status: page.status,
      ...(page.reasonCode ? { reasonCode: page.reasonCode } : {}),
      records: page.records,
      ...(page.nextOffset !== undefined
        ? { nextPosition: page.nextOffset }
        : {}),
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    return createConversationSourcePage({
      source: "workspace_run",
      sourceId: workspaceRunId,
      queryHash,
      sourceRevision: "unavailable",
      status: "unavailable",
      reasonCode: "jsonl_read_failed",
      records: [],
    });
  }
}

function parseJsonlRevision(value: string) {
  const match = /^jsonl:(\d+):(\d+):(\d+):\d+:\d+$/.exec(value);
  return match
    ? {
        dev: match[1]!,
        ino: match[2]!,
        endOffset: Number(match[3]),
      }
    : null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function createRunSnapshot(
  input: CreateWorkspaceRunInput & { workspaceRunId: string },
  status: Extract<WorkspaceRunStatus, "queued" | "running">,
  timestamp: string,
): WorkspaceRun {
  return {
    workspaceRunId: input.workspaceRunId,
    sessionId: input.sessionId,
    requestId: input.requestId,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
    ...(input.selectedSkillName ? { selectedSkillName: input.selectedSkillName } : {}),
    status,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...(status === "running" ? { startedAt: timestamp } : {}),
  };
}

function workspaceRunEnvelopeMatches(
  run: WorkspaceRun,
  input: CreateWorkspaceRunInput & { workspaceRunId: string },
): boolean {
  return run.workspaceRunId === input.workspaceRunId
    && run.sessionId === input.sessionId
    && run.requestId === input.requestId
    && run.workspaceId === input.workspaceId
    && run.workspaceRoot === input.workspaceRoot
    && run.selectedSkillName === input.selectedSkillName;
}

function transitionRunSnapshot(
  run: WorkspaceRun,
  status: WorkspaceRunStatus,
  timestamp: string,
  summary?: string,
): WorkspaceRun {
  return {
    ...run,
    status,
    ...(summary ? { summary } : {}),
    updatedAt: timestamp,
    ...(isWorkspaceRunTerminalStatus(status)
      ? { finishedAt: timestamp }
      : { finishedAt: undefined }),
  };
}

function serializeMutation<T>(
  currentQueue: Promise<void>,
  setQueue: (queue: Promise<void>) => void,
  operation: () => Promise<T>,
): Promise<T> {
  const result = currentQueue.then(operation, operation);
  setQueue(result.then(
    () => undefined,
    () => undefined,
  ));
  return result;
}

async function appendJsonl<T>(
  directory: string,
  filePath: string,
  value: T,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value)}\n`, {
    encoding: "utf8",
    flag: "a",
  });
}

function compareRunsByCreatedAtAsc(
  left: WorkspaceRun,
  right: WorkspaceRun,
): number {
  return (
    left.createdAt.localeCompare(right.createdAt) ||
    left.workspaceRunId.localeCompare(right.workspaceRunId)
  );
}

function compareEventsForChatTrajectory(
  left: WorkspaceRunEvent,
  right: WorkspaceRunEvent,
): number {
  return (
    left.createdAt.localeCompare(right.createdAt) ||
    left.workspaceRunId.localeCompare(right.workspaceRunId) ||
    left.seq - right.seq ||
    left.id.localeCompare(right.id)
  );
}
