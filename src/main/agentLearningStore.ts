import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  AgentLearningCandidate,
  AgentLearningCandidateInput,
  AgentLearningCandidateStatus,
  AgentLearningListOptions,
} from "../shared/agentLearning";
import type {
  LearningRepository,
  Storage,
  StorageBackend,
} from "../shared/storageContract";
import type { PersistenceQueueDrainOptions } from "./failureVisibleSerialQueue";
import {
  createAuthoritativeStoreBackend,
  writeStoreJsonAtomically,
} from "./storage/authoritativeStore";
import { createLearningRepository } from "./storage/repositories";

type StoredLearningCandidates = {
  schemaVersion: 1;
  candidates: AgentLearningCandidate[];
};

export type AgentLearningStore = {
  create(
    input: AgentLearningCandidateInput,
  ): Promise<AgentLearningCandidate>;
  list(options?: AgentLearningListOptions): Promise<AgentLearningCandidate[]>;
  setStatus(
    candidateId: string,
    status: AgentLearningCandidateStatus,
  ): Promise<AgentLearningCandidate | null>;
  flushShadowWrites(options?: PersistenceQueueDrainOptions): Promise<void>;
};

export function createAgentLearningStore(options: {
  configDir: string;
  createId?: () => string;
  now?: () => Date;
  backend?: StorageBackend;
  storage?: Storage;
}): AgentLearningStore {
  const learningPath = path.join(options.configDir, "agent-learning-candidates.json");
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const authoritativeBackend = createAuthoritativeStoreBackend({
    backend: options.backend,
    storage: options.storage,
    domain: "Agent learning",
  });
  const repository: LearningRepository | null = authoritativeBackend.storage
    ? createLearningRepository(authoritativeBackend.storage)
    : null;
  let mutationQueue: Promise<unknown> = Promise.resolve();

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

  async function readStored(): Promise<StoredLearningCandidates> {
    if (authoritativeBackend.backend !== "json") {
      return {
        schemaVersion: 1,
        candidates: repository!.list(),
      };
    }

    try {
      const raw = await readFile(learningPath, "utf8");
      const stored = JSON.parse(raw) as StoredLearningCandidates;
      return {
        schemaVersion: 1,
        candidates: Array.isArray(stored.candidates) ? stored.candidates : [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { schemaVersion: 1, candidates: [] };
      }

      throw error;
    }
  }

  async function writeStored(stored: StoredLearningCandidates) {
    await writeStoreJsonAtomically({
      directory: options.configDir,
      filePath: learningPath,
      value: stored,
    });
  }

  function enqueueLearningSnapshot(): void {
    authoritativeBackend.enqueueShadow(() =>
      writeStoreJsonAtomically({
        directory: options.configDir,
        filePath: learningPath,
        value: {
          schemaVersion: 1,
          candidates: repository!.list(),
        } satisfies StoredLearningCandidates,
      }),
    );
  }

  return {
    async create(input) {
      const timestamp = now().toISOString();
      const candidate: AgentLearningCandidate = {
        id: createId(),
        type: input.type,
        status: "pending_review",
        sourceRunId: input.sourceRunId,
        sourceTrajectoryEventIds: input.sourceTrajectoryEventIds,
        claim: input.claim,
        recommendedAction: input.recommendedAction,
        risk: input.risk,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      if (authoritativeBackend.backend !== "json") {
        authoritativeBackend.assertWritable();
        const created = repository!.create(candidate);
        enqueueLearningSnapshot();
        return created;
      }

      return enqueueMutation(async () => {
        const stored = await readStored();
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

        if (listOptions?.type && candidate.type !== listOptions.type) {
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
          enqueueLearningSnapshot();
        }
        return updated;
      }

      return enqueueMutation(async () => {
        const stored = await readStored();
        let updatedCandidate: AgentLearningCandidate | null = null;
        const updatedCandidates = stored.candidates.map((candidate) => {
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

        if (!updatedCandidate) {
          return null;
        }

        await writeStored({
          schemaVersion: 1,
          candidates: updatedCandidates,
        });
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
}
