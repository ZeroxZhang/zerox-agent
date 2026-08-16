import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type {
  AgentRole,
  MultiAgentSession,
  MultiAgentSessionStatus,
} from "../shared/agentWorkspace";

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
};

export function createMultiAgentSessionStore(options: {
  configDir: string;
  createId?: () => string;
  now?: () => Date;
}): MultiAgentSessionStore {
  const sessionsPath = path.join(options.configDir, "multi-agent-sessions.json");
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());

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
    await mkdir(options.configDir, { recursive: true });
    const temporaryPath = `${sessionsPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(
        temporaryPath,
        `${JSON.stringify(stored, null, 2)}\n`,
        {
          encoding: "utf8",
          mode: 0o600,
        },
      );
      await rename(temporaryPath, sessionsPath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
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

      await writeStored({ schemaVersion: 1, sessions });
      return updatedSession;
    });
  }

  return {
    async get(id) {
      await awaitPendingMutations();
      const stored = await readStored();
      return stored.sessions.find((session) => session.id === id) ?? null;
    },

    async list() {
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
      return serializeMutation(async () => {
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
        const stored = await readStored();
        await writeStored({
          schemaVersion: 1,
          sessions: [...stored.sessions, session],
        });
        return session;
      });
    },

    appendChildRun(sessionId, runId, role) {
      return updateSession(sessionId, (session) => {
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

    setStatus(sessionId, status) {
      return updateSession(sessionId, (session) => ({
        ...session,
        status,
        updatedAt: now().toISOString(),
      }));
    },
  };
}
