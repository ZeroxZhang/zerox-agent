import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createWorkspaceRunEvent,
  getNextWorkspaceRunEventSeq,
  projectChatTrajectoryEvents,
  type ChatTrajectoryEvent,
  type WorkspaceRun,
  type WorkspaceRunEvent,
  type WorkspaceRunEventInput,
  type WorkspaceRunStatus,
  type WorkspaceRunTerminalStatus,
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
  appendEvent(
    workspaceRunId: string,
    event: WorkspaceRunEventInput,
  ): Promise<WorkspaceRunEvent>;
  listEvents(workspaceRunId: string): Promise<WorkspaceRunEvent[]>;
  listChatTrajectory(sessionId: string): Promise<ChatTrajectoryEvent[]>;
  finishRun(
    workspaceRunId: string,
    status: WorkspaceRunTerminalStatus,
    summary?: string,
  ): Promise<WorkspaceRun>;
};

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
    return readJsonl<WorkspaceRun>(runsPath);
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
    return readJsonl<WorkspaceRunEvent>(eventPath(workspaceRunId));
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

    async finishRun(workspaceRunId, status, summary) {
      return serializeMutation(mutationQueue, (nextQueue) => {
        mutationQueue = nextQueue;
      }, async () => {
        const existing = await readLatestRun(workspaceRunId);
        if (!existing) {
          throw new Error(`Workspace run "${workspaceRunId}" was not found.`);
        }

        const timestamp = now().toISOString();
        const run: WorkspaceRun = {
          ...existing,
          status,
          ...(summary ? { summary } : {}),
          updatedAt: timestamp,
          finishedAt: timestamp,
        };

        await appendRunSnapshot(run);
        return run;
      });
    },
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

async function readJsonl<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await readFile(filePath, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
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
