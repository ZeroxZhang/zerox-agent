import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AgentEvalCandidate,
  AgentEvalCandidateListOptions,
  AgentEvalCandidateStatus,
} from "../shared/agentEvalCandidate";

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
};

export function createAgentEvalCandidateStore(options: {
  configDir: string;
  now?: () => Date;
}): AgentEvalCandidateStore {
  const candidatesPath = path.join(options.configDir, "agent-eval-candidates.json");
  const now = options.now ?? (() => new Date());
  let mutationQueue: Promise<unknown> = Promise.resolve();

  async function readStored(): Promise<StoredAgentEvalCandidates> {
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
    await mkdir(options.configDir, { recursive: true });
    await writeFile(candidatesPath, `${JSON.stringify(stored, null, 2)}\n`, {
      encoding: "utf8",
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

  return {
    async create(candidate) {
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
      const stored = await readStored();
      return stored.candidates.filter((candidate) => {
        if (listOptions?.status && candidate.status !== listOptions.status) {
          return false;
        }

        return true;
      });
    },

    async setStatus(candidateId, status) {
      return enqueueMutation(async () => {
        const stored = await readStored();
        const { candidates, updatedCandidate } = updateCandidateStatus(
          stored.candidates,
          candidateId,
          status,
          now().toISOString(),
        );

        if (!updatedCandidate) {
          return null;
        }

        await writeStored({ schemaVersion: 1, candidates });
        return updatedCandidate;
      });
    },

    async transitionStatus(candidateId, expectedStatus, nextStatus) {
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
          now().toISOString(),
        );
        await writeStored({ schemaVersion: 1, candidates });
        return updatedCandidate;
      });
    },
  };
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
