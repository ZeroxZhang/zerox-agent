import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  PromotedEvalFixtureRepository,
  Storage,
  StorageBackend,
} from "../../shared/storageContract";
import type { PersistenceQueueDrainOptions } from "../failureVisibleSerialQueue";
import {
  createAuthoritativeStoreBackend,
  writeStoreJsonAtomically,
} from "../storage/authoritativeStore";
import { createPromotedEvalFixtureRepository } from "../storage/repositories";
import type { AgentEvalFixture } from "./agentEvalFixtures";

type StoredPromotedAgentEvalFixtures = {
  schemaVersion: 1;
  fixtures: AgentEvalFixture[];
};

export type PromotedAgentEvalFixtureStore = {
  list(): Promise<AgentEvalFixture[]>;
  upsert(fixture: AgentEvalFixture): Promise<AgentEvalFixture>;
  flushShadowWrites(options?: PersistenceQueueDrainOptions): Promise<void>;
};

export type PromotedAgentEvalFixtureStoreSqliteAccess = {
  storage: Storage;
  upsert(
    fixture: AgentEvalFixture,
    sourceCandidateId: string,
  ): AgentEvalFixture;
  assertWritable(): void;
  enqueueShadowSnapshot(): void;
};

const sqliteAccessByStore = new WeakMap<
  PromotedAgentEvalFixtureStore,
  PromotedAgentEvalFixtureStoreSqliteAccess
>();

export function getPromotedAgentEvalFixtureStoreSqliteAccess(
  store: PromotedAgentEvalFixtureStore,
): PromotedAgentEvalFixtureStoreSqliteAccess | null {
  return sqliteAccessByStore.get(store) ?? null;
}

export function createCombinedAgentEvalFixtures(
  builtIn: AgentEvalFixture[],
  promoted: AgentEvalFixture[],
): AgentEvalFixture[] {
  const builtInIds = new Set(builtIn.map((fixture) => fixture.id));
  const promotedOnly = promoted.filter((fixture) => !builtInIds.has(fixture.id));

  return [...builtIn, ...promotedOnly];
}

export function createPromotedAgentEvalFixtureStore(options: {
  configDir: string;
  now?: () => Date;
  backend?: StorageBackend;
  storage?: Storage;
}): PromotedAgentEvalFixtureStore {
  const fixturesPath = path.join(
    options.configDir,
    "agent-promoted-eval-fixtures.json",
  );
  const now = options.now ?? (() => new Date());
  const authoritativeBackend = createAuthoritativeStoreBackend({
    backend: options.backend,
    storage: options.storage,
    domain: "Promoted agent eval fixture",
  });
  const repository: PromotedEvalFixtureRepository | null =
    authoritativeBackend.storage
      ? createPromotedEvalFixtureRepository(authoritativeBackend.storage)
      : null;
  let mutationQueue: Promise<unknown> = Promise.resolve();

  async function readStored(): Promise<StoredPromotedAgentEvalFixtures> {
    if (authoritativeBackend.backend !== "json") {
      return {
        schemaVersion: 1,
        fixtures: repository!.list(),
      };
    }

    try {
      const raw = await readFile(fixturesPath, "utf8");
      const stored = JSON.parse(raw) as Partial<StoredPromotedAgentEvalFixtures>;
      if (stored.schemaVersion !== 1 || !Array.isArray(stored.fixtures)) {
        throw new Error("Malformed promoted agent eval fixture store.");
      }

      return {
        schemaVersion: 1,
        fixtures: stored.fixtures,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { schemaVersion: 1, fixtures: [] };
      }

      throw error;
    }
  }

  async function writeStored(stored: StoredPromotedAgentEvalFixtures) {
    await writeStoreJsonAtomically({
      directory: options.configDir,
      filePath: fixturesPath,
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

  function enqueueFixtureSnapshot(): void {
    authoritativeBackend.enqueueShadow(() =>
      writeStoreJsonAtomically({
        directory: options.configDir,
        filePath: fixturesPath,
        value: {
          schemaVersion: 1,
          fixtures: repository!.list(),
        } satisfies StoredPromotedAgentEvalFixtures,
      }),
    );
  }

  const store: PromotedAgentEvalFixtureStore = {
    async list() {
      if (authoritativeBackend.backend !== "json") {
        return repository!.list();
      }
      await awaitPendingMutations();
      const stored = await readStored();
      return stored.fixtures;
    },

    async upsert(fixture) {
      if (authoritativeBackend.backend !== "json") {
        authoritativeBackend.assertWritable();
        const upserted = repository!.upsert(fixture, {
          createdAt: now().toISOString(),
        });
        enqueueFixtureSnapshot();
        return upserted;
      }

      return enqueueMutation(async () => {
        const stored = await readStored();
        const existingIndex = stored.fixtures.findIndex(
          (item) => item.id === fixture.id,
        );
        const fixtures =
          existingIndex === -1
            ? [...stored.fixtures, fixture]
            : stored.fixtures.map((item, index) =>
                index === existingIndex ? fixture : item,
              );

        await writeStored({ schemaVersion: 1, fixtures });
        return fixture;
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
      upsert: (fixture, sourceCandidateId) =>
        repository.upsert(fixture, {
          sourceCandidateId,
          createdAt: now().toISOString(),
        }),
      assertWritable: () => authoritativeBackend.assertWritable(),
      enqueueShadowSnapshot: enqueueFixtureSnapshot,
    });
  }

  return store;
}
