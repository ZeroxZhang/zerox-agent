import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  AgentRole,
  MultiAgentSession,
  MultiAgentSessionStatus,
} from "../shared/agentWorkspace";
import type {
  SessionRecord,
  SessionRepository,
  Storage,
  StorageBackend,
} from "../shared/storageContract";
import type { PersistenceQueueDrainOptions } from "./failureVisibleSerialQueue";
import {
  createAuthoritativeStoreBackend,
  writeStoreJsonAtomically,
} from "./storage/authoritativeStore";
import { createSessionRepository } from "./storage/repositories/sessionRepository";

type StoredMultiAgentSessions = {
  schemaVersion: 1;
  sessions: MultiAgentSession[];
};

const mutationQueues = new Map<string, Promise<void>>();

export type MultiAgentSessionInput = {
  title: string;
  workspaceId: string;
  rootRunId?: string;
};

export type MultiAgentSessionStore = {
  get(id: string): Promise<MultiAgentSession | null>;
  list(): Promise<MultiAgentSession[]>;
  create(input: MultiAgentSessionInput): Promise<MultiAgentSession>;
  appendChildRun(
    sessionId: string,
    runId: string,
    role: AgentRole,
  ): Promise<MultiAgentSession | null>;
  setStatus(
    sessionId: string,
    status: MultiAgentSessionStatus,
  ): Promise<MultiAgentSession | null>;
  flushShadowWrites(options?: PersistenceQueueDrainOptions): Promise<void>;
};

export function createMultiAgentSessionStore(options: {
  configDir: string;
  createId?: () => string;
  now?: () => Date;
  backend?: StorageBackend;
  storage?: Storage;
}): MultiAgentSessionStore {
  const sessionsPath = path.join(options.configDir, "multi-agent-sessions.json");
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const authoritativeBackend = createAuthoritativeStoreBackend({
    backend: options.backend,
    storage: options.storage,
    domain: "Multi-agent session",
  });
  const repository: SessionRepository | null = authoritativeBackend.storage
    ? createSessionRepository(authoritativeBackend.storage, {
        now: () => now().toISOString(),
      })
    : null;

  async function awaitPendingMutations(): Promise<void> {
    await (mutationQueues.get(sessionsPath) ?? Promise.resolve());
  }

  function serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = mutationQueues.get(sessionsPath) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    mutationQueues.set(sessionsPath, tail);
    void tail.finally(() => {
      if (mutationQueues.get(sessionsPath) === tail) {
        mutationQueues.delete(sessionsPath);
      }
    });
    return result;
  }

  async function readStored(): Promise<StoredMultiAgentSessions> {
    if (authoritativeBackend.backend !== "json") {
      return {
        schemaVersion: 1,
        sessions: repository!
          .listSessions({ kind: "multi_agent" })
          .map(toMultiAgentSession),
      };
    }

    try {
      const raw = await readFile(sessionsPath, "utf8");
      const stored = JSON.parse(raw) as StoredMultiAgentSessions;
      return {
        schemaVersion: 1,
        sessions: Array.isArray(stored.sessions) ? stored.sessions : [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { schemaVersion: 1, sessions: [] };
      }

      throw error;
    }
  }

  async function writeStored(stored: StoredMultiAgentSessions) {
    await writeStoreJsonAtomically({
      directory: options.configDir,
      filePath: sessionsPath,
      value: stored,
    });
  }

  function enqueueSessionSnapshot(): void {
    authoritativeBackend.enqueueShadow(() =>
      writeStoreJsonAtomically({
        directory: options.configDir,
        filePath: sessionsPath,
        value: {
          schemaVersion: 1,
          sessions: repository!
            .listSessions({ kind: "multi_agent" })
            .map(toMultiAgentSession),
        } satisfies StoredMultiAgentSessions,
      }),
    );
  }

  async function updateSession(
    sessionId: string,
    update: (session: MultiAgentSession) => MultiAgentSession,
  ): Promise<MultiAgentSession | null> {
    return serializeMutation(async () => {
      const stored = await readStored();
      let updatedSession: MultiAgentSession | null = null;
      const sessions = stored.sessions.map((session) => {
        if (session.id !== sessionId) {
          return session;
        }

        updatedSession = update(session);
        return updatedSession;
      });

      if (!updatedSession) {
        return null;
      }

      if (sessions.some((session, index) => session !== stored.sessions[index])) {
        await writeStored({ schemaVersion: 1, sessions });
      }
      return updatedSession;
    });
  }

  return {
    async get(id) {
      if (authoritativeBackend.backend !== "json") {
        const record = repository!.getSession(id);
        return record?.kind === "multi_agent"
          ? toMultiAgentSession(record)
          : null;
      }
      await awaitPendingMutations();
      const stored = await readStored();
      return stored.sessions.find((session) => session.id === id) ?? null;
    },

    async list() {
      if (authoritativeBackend.backend !== "json") {
        return repository!
          .listSessions({ kind: "multi_agent" })
          .map(toMultiAgentSession);
      }
      await awaitPendingMutations();
      const stored = await readStored();
      return [...stored.sessions].sort(
        (left, right) =>
          new Date(right.updatedAt).getTime() -
            new Date(left.updatedAt).getTime() ||
          right.id.localeCompare(left.id),
      );
    },

    async create(input) {
      const timestamp = now().toISOString();
      const session: MultiAgentSession = {
        id: createId(),
        title: input.title,
        ...(input.rootRunId ? { rootRunId: input.rootRunId } : {}),
        status: "running",
        workspaceId: input.workspaceId,
        createdAt: timestamp,
        updatedAt: timestamp,
        childRunIds: [],
        roles: {},
      };
      if (authoritativeBackend.backend !== "json") {
        authoritativeBackend.assertWritable();
        const existing = repository!.getSession(session.id);
        if (existing && existing.kind !== "multi_agent") {
          throw new Error(
            `Session "${session.id}" already belongs to "${existing.kind}".`,
          );
        }
        const created = repository!.createSession({
          ...session,
          kind: "multi_agent",
          payload: session,
        });
        enqueueSessionSnapshot();
        return toMultiAgentSession(created);
      }

      return serializeMutation(async () => {
        const stored = await readStored();
        await writeStored({
          schemaVersion: 1,
          sessions: [...stored.sessions, session],
        });
        return session;
      });
    },

    async appendChildRun(sessionId, runId, role) {
      if (authoritativeBackend.backend !== "json") {
        authoritativeBackend.assertWritable();
        const updated = repository!.appendChildRun(sessionId, runId, role);
        if (!updated) {
          return null;
        }
        enqueueSessionSnapshot();
        return toMultiAgentSession(updated);
      }

      return updateSession(sessionId, (session) => {
        if (
          session.childRunIds.includes(runId) &&
          session.roles[runId] === role
        ) {
          return session;
        }
        const timestamp = now().toISOString();
        const childRunIds = session.childRunIds.includes(runId)
          ? session.childRunIds
          : [...session.childRunIds, runId];

        return {
          ...session,
          updatedAt: timestamp,
          childRunIds,
          roles: {
            ...session.roles,
            [runId]: role,
          },
        };
      });
    },

    async setStatus(sessionId, status) {
      if (authoritativeBackend.backend !== "json") {
        authoritativeBackend.assertWritable();
        const updated = repository!.setSessionStatus(sessionId, status);
        if (!updated) {
          return null;
        }
        enqueueSessionSnapshot();
        return toMultiAgentSession(updated);
      }

      return updateSession(sessionId, (session) =>
        session.status === status
          ? session
          : {
              ...session,
              status,
              updatedAt: now().toISOString(),
            },
      );
    },

    async flushShadowWrites(flushOptions) {
      if (authoritativeBackend.backend === "json") {
        await awaitPendingMutations();
      }
      await authoritativeBackend.flushShadowWrites(flushOptions);
    },
  };
}

function toMultiAgentSession(record: SessionRecord): MultiAgentSession {
  return {
    id: record.id,
    title: record.title ?? "",
    ...(record.rootRunId ? { rootRunId: record.rootRunId } : {}),
    status: record.status ?? "running",
    workspaceId: record.workspaceId ?? "",
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    childRunIds: [...(record.childRunIds ?? [])],
    roles: { ...(record.roles ?? {}) },
  };
}
