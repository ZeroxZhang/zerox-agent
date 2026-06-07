import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AgentLearningCandidate,
  AgentLearningCandidateInput,
  AgentLearningCandidateStatus,
  AgentLearningListOptions,
} from "../shared/agentLearning";

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
};

export function createAgentLearningStore(options: {
  configDir: string;
  createId?: () => string;
  now?: () => Date;
}): AgentLearningStore {
  const learningPath = path.join(options.configDir, "agent-learning-candidates.json");
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());

  async function readStored(): Promise<StoredLearningCandidates> {
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
    await mkdir(options.configDir, { recursive: true });
    await writeFile(learningPath, `${JSON.stringify(stored, null, 2)}\n`, {
      encoding: "utf8",
    });
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
      const stored = await readStored();
      await writeStored({
        schemaVersion: 1,
        candidates: [...stored.candidates, candidate],
      });
      return candidate;
    },

    async list(listOptions) {
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
      const stored = await readStored();
      let updatedCandidate: AgentLearningCandidate | null = null;
      const updatedCandidates = stored.candidates.map((candidate) => {
        if (candidate.id !== candidateId) {
          return candidate;
        }

        updatedCandidate = {
          ...candidate,
          status,
          updatedAt: now().toISOString(),
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
    },
  };
}
