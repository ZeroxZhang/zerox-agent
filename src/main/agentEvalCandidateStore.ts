import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  AgentEvalCandidate,
  AgentEvalCandidateListOptions,
  AgentEvalCandidateStatus,
} from "../shared/agentEvalCandidate";
import type {
  EvalCandidateRepository,
  Storage,
  StorageBackend,
} from "../shared/storageContract";
import type { PersistenceQueueDrainOptions } from "./failureVisibleSerialQueue";
import {
  createAuthoritativeStoreBackend,
  writeStoreJsonAtomically,
} from "./storage/authoritativeStore";
import { createEvalCandidateRepository } from "./storage/repositories";

type StoredAgentEvalCandidates = {
  schemaVersion: 1;
  candidates: AgentEvalCandidate[];
};

export type AgentEvalCandidateStore = {
  create(candidate: AgentEvalCandidate): Promise<AgentEvalCandidate>;
  list(options?: AgentEvalCandidateListOptions): Promise<AgentEvalCandidate[]>;
  setStatus(
    candidateId: string,
    status: AgentEvalCandidateStatus,
  ): Promise<AgentEvalCandidate | null>;
  transitionStatus(
    candidateId: string,
    expectedStatus: AgentEvalCandidateStatus,
    nextStatus: AgentEvalCandidateStatus,
  ): Promise<AgentEvalCandidate | null>;
  flushShadowWrites(options?: PersistenceQueueDrainOptions): Promise<void>;
};

export type AgentEvalCandidateStoreSqliteAccess = {
  storage: Storage;
  get(candidateId: string): AgentEvalCandidate | null;
  transitionStatus(
    candidateId: string,
    expectedStatus: AgentEvalCandidateStatus,
    nextStatus: AgentEvalCandidateStatus,
  ): AgentEvalCandidate | null;
  assertWritable(): void;
  enqueueShadowSnapshot(): void;
};

const sqliteAccessByStore = new WeakMap<
  AgentEvalCandidateStore,
  AgentEvalCandidateStoreSqliteAccess
>();

export function getAgentEvalCandidateStoreSqliteAccess(
  store: AgentEvalCandidateStore,
): AgentEvalCandidateStoreSqliteAccess | null {
  return sqliteAccessByStore.get(store) ?? null;
}

export function createAgentEvalCandidateStore(options: {
  configDir: string;
  now?: () => Date;
  backend?: StorageBackend;
  storage?: Storage;
}): AgentEvalCandidateStore {
  const candidatesPath = path.join(options.configDir, "agent-eval-candidates.json");
  const now = options.now ?? (() => new Date());
  const authoritativeBackend = createAuthoritativeStoreBackend({
    backend: options.backend,
    storage: options.storage,
    domain: "Agent eval candidate",
  });
  const repository: EvalCandidateRepository | null =
    authoritativeBackend.storage
      ? createEvalCandidateRepository(authoritativeBackend.storage)
      : null;
  let mutationQueue: Promise<unknown> = Promise.resolve();

  async function readStored(): Promise<StoredAgentEvalCandidates> {
    if (authoritativeBackend.backend !== "json") {
      return {
        schemaVersion: 1,
        candidates: repository!.list(),
      };
    }

    try {
      const raw = await readFile(candidatesPath, "utf8");
      const stored = JSON.parse(raw) as Partial<StoredAgentEvalCandidates>;
      if (stored.schemaVersion !== 1 || !Array.isArray(stored.candidates)) {
        throw new Error("Malformed agent eval candidate store.");
      }

      return {
        schemaVersion: 1,
        candidates: stored.candidates,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { schemaVersion: 1, candidates: [] };
      }

      throw error;
    }
  }

  async function writeStored(stored: StoredAgentEvalCandidates) {
    await writeStoreJsonAtomically({
      directory: options.configDir,
      filePath: candidatesPath,
      value: stored,
    });
  }

  function enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function awaitPendingMutations(): Promise<void> {
    await mutationQueue;
  }

  function enqueueCandidateSnapshot(): void {
    authoritativeBackend.enqueueShadow(() =>
      writeStoreJsonAtomically({
        directory: options.configDir,
        filePath: candidatesPath,
        value: {
          schemaVersion: 1,
          candidates: repository!.list(),
        } satisfies StoredAgentEvalCandidates,
      }),
    );
  }

  const store: AgentEvalCandidateStore = {
    async create(candidate) {
      if (authoritativeBackend.backend !== "json") {
        authoritativeBackend.assertWritable();
        const created = repository!.create(candidate);
        enqueueCandidateSnapshot();
        return created;
      }

      return enqueueMutation(async () => {
        const stored = await readStored();
        const existing = stored.candidates.find(
          (item) =>
            item.id === candidate.id ||
            (item.sourceRunId === candidate.sourceRunId &&
              item.fixture.id === candidate.fixture.id),
        );
        if (existing) {
          return existing;
        }

        await writeStored({
          schemaVersion: 1,
          candidates: [...stored.candidates, candidate],
        });
        return candidate;
      });
    },

    async list(listOptions) {
      if (authoritativeBackend.backend !== "json") {
        return repository!.list(listOptions);
      }
      await awaitPendingMutations();
      const stored = await readStored();
      return stored.candidates.filter((candidate) => {
        if (listOptions?.status && candidate.status !== listOptions.status) {
          return false;
        }

        return true;
      });
    },

    async setStatus(candidateId, status) {
      const updatedAt = now().toISOString();
      if (authoritativeBackend.backend !== "json") {
        authoritativeBackend.assertWritable();
        const updated = repository!.setStatus(
          candidateId,
          status,
          updatedAt,
        );
        if (updated) {
          enqueueCandidateSnapshot();
        }
        return updated;
      }

      return enqueueMutation(async () => {
        const stored = await readStored();
        const { candidates, updatedCandidate } = updateCandidateStatus(
          stored.candidates,
          candidateId,
          status,
          updatedAt,
        );

        if (!updatedCandidate) {
          return null;
        }

        await writeStored({ schemaVersion: 1, candidates });
        return updatedCandidate;
      });
    },

    async transitionStatus(candidateId, expectedStatus, nextStatus) {
      const updatedAt = now().toISOString();
      if (authoritativeBackend.backend !== "json") {
        authoritativeBackend.assertWritable();
        const updated = repository!.transitionStatus(
          candidateId,
          expectedStatus,
          nextStatus,
          updatedAt,
        );
        if (updated) {
          enqueueCandidateSnapshot();
        }
        return updated;
      }

      return enqueueMutation(async () => {
        const stored = await readStored();
        const current = stored.candidates.find(
          (candidate) => candidate.id === candidateId,
        );
        if (!current || current.status !== expectedStatus) {
          return null;
        }

        const { candidates, updatedCandidate } = updateCandidateStatus(
          stored.candidates,
          candidateId,
          nextStatus,
          updatedAt,
        );
        await writeStored({ schemaVersion: 1, candidates });
        return updatedCandidate;
      });
    },

    async flushShadowWrites(flushOptions) {
      if (authoritativeBackend.backend === "json") {
        await awaitPendingMutations();
      }
      await authoritativeBackend.flushShadowWrites(flushOptions);
    },
  };

  if (authoritativeBackend.storage && repository) {
    sqliteAccessByStore.set(store, {
      storage: authoritativeBackend.storage,
      get: (candidateId) => repository.get(candidateId),
      transitionStatus: (candidateId, expectedStatus, nextStatus) =>
        repository.transitionStatus(
          candidateId,
          expectedStatus,
          nextStatus,
          now().toISOString(),
        ),
      assertWritable: () => authoritativeBackend.assertWritable(),
      enqueueShadowSnapshot: enqueueCandidateSnapshot,
    });
  }

  return store;
}

function updateCandidateStatus(
  candidates: AgentEvalCandidate[],
  candidateId: string,
  status: AgentEvalCandidateStatus,
  updatedAt: string,
): {
  candidates: AgentEvalCandidate[];
  updatedCandidate: AgentEvalCandidate | null;
} {
  let updatedCandidate: AgentEvalCandidate | null = null;
  const updatedCandidates = candidates.map((candidate) => {
    if (candidate.id !== candidateId) {
      return candidate;
    }

    updatedCandidate = {
      ...candidate,
      status,
      updatedAt,
    };
    return updatedCandidate;
  });

  return {
    candidates: updatedCandidates,
    updatedCandidate,
  };
}
