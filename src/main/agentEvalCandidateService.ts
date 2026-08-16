import { createEvalCandidateFromEpisode } from "./agentEvalCandidateGenerator";
import {
  getAgentEvalCandidateStoreSqliteAccess,
  type AgentEvalCandidateStore,
} from "./agentEvalCandidateStore";
import type { AgentRunStore } from "./agentRunStore";
import type { AgentTrajectoryStore } from "./agentTrajectoryStore";
import {
  getPromotedAgentEvalFixtureStoreSqliteAccess,
  type PromotedAgentEvalFixtureStore,
} from "./eval/agentPromotedEvalFixtures";
import type {
  AgentEvalCandidate,
  GenerateEvalCandidateForRunResult,
  PromoteEvalCandidateResult,
} from "../shared/agentEvalCandidate";
import type { AgentRunStatus } from "../shared/agentRuns";

export type AgentEvalCandidateService = {
  generateForRun(runId: string): Promise<GenerateEvalCandidateForRunResult>;
  acceptCandidate(candidateId: string): Promise<AgentEvalCandidate | null>;
  rejectCandidate(candidateId: string): Promise<AgentEvalCandidate | null>;
  promoteAccepted(candidateId: string): Promise<PromoteEvalCandidateResult>;
};

export function createAgentEvalCandidateService(options: {
  runStore: AgentRunStore;
  trajectoryStore: AgentTrajectoryStore;
  candidateStore: AgentEvalCandidateStore;
  promotedFixtureStore: PromotedAgentEvalFixtureStore;
  now?: () => Date;
}): AgentEvalCandidateService {
  const now = options.now ?? (() => new Date());
  let reviewQueue: Promise<unknown> = Promise.resolve();

  return {
    async generateForRun(runId) {
      const run = await options.runStore.get(runId);
      if (!run) {
        return {
          ok: false,
          message: "运行记录不存在。",
        };
      }

      if (!isTerminalRunStatus(run.status)) {
        return {
          ok: false,
          message: "只有已结束的运行可以生成 eval candidate。",
        };
      }

      const trajectory = await options.trajectoryStore.list(runId);
      const candidate = createEvalCandidateFromEpisode({
        run,
        trajectory,
        createdAt: now().toISOString(),
      });
      const existing = await findExistingCandidate(options.candidateStore, candidate);
      if (existing) {
        return {
          ok: true,
          candidate: existing,
          existing: true,
        };
      }

      return {
        ok: true,
        candidate: await options.candidateStore.create(candidate),
        existing: false,
      };
    },

    async acceptCandidate(candidateId) {
      return enqueueReviewMutation(
        reviewQueue,
        (nextQueue) => {
          reviewQueue = nextQueue;
        },
        () =>
          options.candidateStore.transitionStatus(
            candidateId,
            "pending_review",
            "accepted",
          ),
      );
    },

    async rejectCandidate(candidateId) {
      return enqueueReviewMutation(
        reviewQueue,
        (nextQueue) => {
          reviewQueue = nextQueue;
        },
        () =>
          options.candidateStore.transitionStatus(
            candidateId,
            "pending_review",
            "rejected",
          ),
      );
    },

    async promoteAccepted(candidateId) {
      return enqueueReviewMutation(
        reviewQueue,
        (nextQueue) => {
          reviewQueue = nextQueue;
        },
        async () => {
          const candidateSqlite =
            getAgentEvalCandidateStoreSqliteAccess(options.candidateStore);
          const fixtureSqlite =
            getPromotedAgentEvalFixtureStoreSqliteAccess(
              options.promotedFixtureStore,
            );
          if (candidateSqlite || fixtureSqlite) {
            if (
              !candidateSqlite ||
              !fixtureSqlite ||
              candidateSqlite.storage !== fixtureSqlite.storage
            ) {
              throw new Error(
                "SQLite eval promotion requires candidate and fixture stores to share one storage instance.",
              );
            }

            candidateSqlite.assertWritable();
            fixtureSqlite.assertWritable();
            const promote = candidateSqlite.storage.db.transaction(() => {
              const candidate = candidateSqlite.get(candidateId);
              if (!candidate) {
                return {
                  ok: false,
                  message: "eval candidate 不存在。",
                } as const;
              }
              if (candidate.status !== "accepted") {
                return {
                  ok: false,
                  message: "只有已接受的 eval candidate 可以晋升。",
                } as const;
              }

              const promoted = candidateSqlite.transitionStatus(
                candidate.id,
                "accepted",
                "promoted",
              );
              if (!promoted) {
                return {
                  ok: false,
                  message: "只有已接受的 eval candidate 可以晋升。",
                } as const;
              }

              fixtureSqlite.upsert(candidate.fixture, candidate.id);
              return {
                ok: true,
                candidate: promoted,
                fixtureId: candidate.fixture.id,
              } as const;
            });
            const result = promote();
            if (result.ok) {
              candidateSqlite.enqueueShadowSnapshot();
              fixtureSqlite.enqueueShadowSnapshot();
            }
            return result;
          }

          const candidate = await findCandidate(options.candidateStore, candidateId);
          if (!candidate) {
            return {
              ok: false,
              message: "eval candidate 不存在。",
            };
          }

          if (candidate.status !== "accepted") {
            return {
              ok: false,
              message: "只有已接受的 eval candidate 可以晋升。",
            };
          }

          await options.promotedFixtureStore.upsert(candidate.fixture);
          const promoted = await options.candidateStore.transitionStatus(
            candidate.id,
            "accepted",
            "promoted",
          );
          if (!promoted) {
            return {
              ok: false,
              message: "只有已接受的 eval candidate 可以晋升。",
            };
          }

          return {
            ok: true,
            candidate: promoted,
            fixtureId: candidate.fixture.id,
          };
        },
      );
    },
  };
}

function enqueueReviewMutation<T>(
  queue: Promise<unknown>,
  setQueue: (nextQueue: Promise<unknown>) => void,
  operation: () => Promise<T>,
): Promise<T> {
  const result = queue.then(operation, operation);
  setQueue(
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  return result;
}

function isTerminalRunStatus(status: AgentRunStatus): boolean {
  const statusValue = status as string;
  return (
    statusValue === "succeeded" ||
    statusValue === "failed" ||
    statusValue === "canceled" ||
    statusValue === "cancelled"
  );
}

async function findCandidate(
  candidateStore: AgentEvalCandidateStore,
  candidateId: string,
): Promise<AgentEvalCandidate | null> {
  const candidates = await candidateStore.list();
  return candidates.find((candidate) => candidate.id === candidateId) ?? null;
}

async function findExistingCandidate(
  candidateStore: AgentEvalCandidateStore,
  candidate: AgentEvalCandidate,
): Promise<AgentEvalCandidate | null> {
  const candidates = await candidateStore.list();
  return (
    candidates.find(
      (item) =>
        item.id === candidate.id ||
        (item.sourceRunId === candidate.sourceRunId &&
          item.fixture.id === candidate.fixture.id),
    ) ?? null
  );
}
