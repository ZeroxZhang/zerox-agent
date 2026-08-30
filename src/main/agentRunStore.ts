import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  AgentRunRevisionConflictError,
  classifyAgentRunRevisionWrite,
  projectSecretSafeAgentRun,
  resolveAgentRunExecutionRevision,
  type AgentRunRecord,
} from "../shared/agentRuns";
import type { StorageBackend, RunRepository, Storage } from "../shared/storageContract";
import { createRunRepository } from "./storage/repositories/runRepository";
import { readRecoverableJsonl } from "./jsonlRecovery";
import {
  createFailureVisibleSerialQueue,
  type PersistenceQueueDrainOptions,
} from "./failureVisibleSerialQueue";

export type AgentRunStore = {
  append(run: AgentRunRecord): Promise<AgentRunRecord>;
  get(runId: string): Promise<AgentRunRecord | null>;
  list(options?: { limit?: number; taskId?: string }): Promise<AgentRunRecord[]>;
  flushShadowWrites(options?: PersistenceQueueDrainOptions): Promise<void>;
};

export interface AgentRunStoreOptions {
  configDir: string;
  /** Storage backend (default "json" — legacy behavior, zero regression). */
  backend?: StorageBackend;
  /** Storage instance required when backend is sqlite/dual. */
  storage?: Storage;
}

const appendQueuesByAuthority = new Map<string, Promise<void>>();

export function createAgentRunStore(options: AgentRunStoreOptions): AgentRunStore {
  const backend: StorageBackend = options.backend ?? "json";
  const runsPath = path.join(options.configDir, "agent-runs.jsonl");
  const repo: RunRepository | null = options.storage
    ? createRunRepository(options.storage)
    : null;
  const appendAuthority = path.resolve(runsPath);

  function serializeAppend(
    operation: () => Promise<AgentRunRecord>,
  ): Promise<AgentRunRecord> {
    const previous = appendQueuesByAuthority.get(appendAuthority)
      ?? Promise.resolve();
    const result = previous.then(operation);
    const tail = result.then(() => undefined, () => undefined);
    appendQueuesByAuthority.set(appendAuthority, tail);
    void tail.finally(() => {
      if (appendQueuesByAuthority.get(appendAuthority) === tail) {
        appendQueuesByAuthority.delete(appendAuthority);
      }
    });
    return result;
  }

  async function drainAppendQueue(): Promise<void> {
    await (appendQueuesByAuthority.get(appendAuthority) ?? Promise.resolve());
  }

  async function appendWithRevisionFence(input: {
    run: AgentRunRecord;
    getCurrent: () => Promise<AgentRunRecord | null>;
    persist: (run: AgentRunRecord) => Promise<void> | void;
  }): Promise<AgentRunRecord> {
    const run = canonicalizeRun({
      ...input.run,
      executionRevision: resolveAgentRunExecutionRevision(input.run),
    });
    const current = await input.getCurrent();
    const normalizedCurrent = current
      ? canonicalizeRun({
          ...current,
          executionRevision: resolveAgentRunExecutionRevision(current),
        })
      : null;
    const disposition = classifyAgentRunRevisionWrite(
      normalizedCurrent,
      run,
      isDeepStrictEqual,
      isDeepStrictEqual,
    );
    if (disposition === "conflict") {
      throw new AgentRunRevisionConflictError();
    }
    if (disposition === "duplicate") return normalizedCurrent!;
    await input.persist(run);
    return run;
  }

  // --- legacy JSON implementation (unchanged) ---
  const jsonImpl = {
    async appendPhysical(run: AgentRunRecord): Promise<void> {
      await mkdir(options.configDir, { recursive: true });
      await writeFile(runsPath, `${JSON.stringify(run)}\n`, {
        encoding: "utf8",
        flag: "a",
      });
    },
    async list(listOptions?: { limit?: number; taskId?: string }): Promise<AgentRunRecord[]> {
      const limit = listOptions?.limit ?? 50;
      const newest = (await readRecoverableJsonl<AgentRunRecord>(runsPath))
        .filter((run) => (listOptions?.taskId ? run.taskId === listOptions.taskId : true))
        .reverse();
      const seen = new Set<string>();
      return newest
        .filter((run) => {
          if (seen.has(run.id)) return false;
          seen.add(run.id);
          return true;
        })
        .slice(0, limit)
        .map(canonicalizeRun);
    },
    async get(runId: string): Promise<AgentRunRecord | null> {
      const runs = await jsonImpl.list({ limit: Number.MAX_SAFE_INTEGER });
      return runs.find((run) => run.id === runId) ?? null;
    },
    async flushShadowWrites(): Promise<void> {
      return;
    },
  };

  if (backend === "json" || !repo) {
    return {
      append(run) {
        return serializeAppend(() => appendWithRevisionFence({
          run,
          getCurrent: () => jsonImpl.get(run.id),
          persist: (record) => jsonImpl.appendPhysical(record),
        }));
      },
      get: jsonImpl.get,
      list: jsonImpl.list,
      async flushShadowWrites() {
        await drainAppendQueue();
      },
    };
  }

  // --- sqlite / dual ---
  const shadowQueue = createFailureVisibleSerialQueue();
  let shadowConvergenceTail: Promise<void> = Promise.resolve();
  let authoritativeShadowConflict: AgentRunRevisionConflictError | undefined;

  async function convergeAuthoritativeShadow(
    authoritativeRun: AgentRunRecord,
  ): Promise<AgentRunRecord> {
    const authoritative = canonicalizeRun({
      ...authoritativeRun,
      executionRevision: resolveAgentRunExecutionRevision(authoritativeRun),
    });
    const authoritativeRevision = resolveAgentRunExecutionRevision(authoritative);
    if (
      !Number.isSafeInteger(authoritativeRevision)
      || authoritativeRevision < 1
    ) {
      throw new AgentRunRevisionConflictError();
    }
    const current = await jsonImpl.get(authoritative.id);
    if (!current) {
      await jsonImpl.appendPhysical(authoritative);
      return authoritative;
    }
    const normalizedCurrent = canonicalizeRun({
      ...current,
      executionRevision: resolveAgentRunExecutionRevision(current),
    });
    const currentRevision = resolveAgentRunExecutionRevision(normalizedCurrent);
    if (
      !Number.isSafeInteger(currentRevision)
      || currentRevision > authoritativeRevision
    ) {
      throw new AgentRunRevisionConflictError();
    }
    if (isDeepStrictEqual(normalizedCurrent, authoritative)) {
      return normalizedCurrent;
    }
    if (currentRevision === authoritativeRevision) {
      throw new AgentRunRevisionConflictError();
    }
    // A strictly stale JSON projection converges forward to SQLite authority.
    await jsonImpl.appendPhysical(authoritative);
    return authoritative;
  }

  function scheduleAuthoritativeShadowConvergence(
    authoritative: AgentRunRecord,
  ): Promise<void> {
    const admitted = shadowQueue.enqueue(async () => {
      try {
        await serializeAppend(
          () => convergeAuthoritativeShadow(authoritative),
        );
      } catch (error) {
        if (error instanceof AgentRunRevisionConflictError) {
          authoritativeShadowConflict ??= error;
        }
        throw error;
      }
    });
    shadowConvergenceTail = admitted;
    return admitted;
  }

  async function awaitAuthoritativeShadowConvergence(): Promise<void> {
    await shadowConvergenceTail;
    if (authoritativeShadowConflict) {
      throw authoritativeShadowConflict;
    }
  }

  if (backend === "dual") {
    for (const authoritative of repo.list({
      limit: Number.MAX_SAFE_INTEGER,
    })) {
      void scheduleAuthoritativeShadowConvergence(authoritative);
    }
  }

  return {
    async append(run) {
      if (backend === "dual") {
        await awaitAuthoritativeShadowConvergence();
      }
      return serializeAppend(async () => {
        shadowQueue.assertOpen();
        const authoritative = await appendWithRevisionFence({
          run,
          getCurrent: async () => repo.get(run.id),
          persist(record) {
            repo.create(record); // sync, hot path
          },
        });
        if (backend === "dual") {
          void scheduleAuthoritativeShadowConvergence(authoritative);
        }
        return authoritative;
      });
    },
    async get(runId) {
      const rawAuthoritative = repo.get(runId);
      const authoritative = rawAuthoritative
        ? canonicalizeRun(rawAuthoritative)
        : null;
      if (backend === "dual" && authoritative) {
        void scheduleAuthoritativeShadowConvergence(authoritative);
      }
      if (backend === "dual") {
        await awaitAuthoritativeShadowConvergence();
      }
      return authoritative;
    },
    async list(listOptions) {
      const limit = listOptions?.limit ?? 50;
      const authoritative = repo.list({
        limit,
        taskId: listOptions?.taskId,
      }).map(canonicalizeRun);
      if (backend === "dual") {
        authoritative.forEach((run) => {
          void scheduleAuthoritativeShadowConvergence(run);
        });
        await awaitAuthoritativeShadowConvergence();
      }
      return authoritative;
    },
    async flushShadowWrites(flushOptions) {
      await drainAppendQueue();
      await shadowQueue.drain(flushOptions);
    },
  };
}

function canonicalizeRun(run: AgentRunRecord): AgentRunRecord {
  return projectSecretSafeAgentRun(
    JSON.parse(JSON.stringify(run)) as AgentRunRecord,
  );
}
