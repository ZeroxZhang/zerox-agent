import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AgentEvalCandidate,
  AgentEvalCandidateStatus,
} from "../shared/agentEvalCandidate";
import type { AgentLearningCandidateInput } from "../shared/agentLearning";
import type {
  Storage,
  StorageBackend,
} from "../shared/storageContract";
import { createAgentEvalCandidateService } from "./agentEvalCandidateService";
import {
  createAgentEvalCandidateStore,
  type AgentEvalCandidateStore,
} from "./agentEvalCandidateStore";
import { createAgentLearningStore } from "./agentLearningStore";
import {
  createPromotedAgentEvalFixtureStore,
  type PromotedAgentEvalFixtureStore,
} from "./eval/agentPromotedEvalFixtures";
import type { AgentEvalFixture } from "./eval/agentEvalFixtures";
import {
  createInMemoryStorage,
  createStorageImpl,
} from "./storage/storageDb";

const backends = ["json", "sqlite", "dual"] satisfies StorageBackend[];
const roots: string[] = [];
const storages = new Set<Storage>();

afterEach(async () => {
  for (const storage of storages) {
    storage.close();
  }
  storages.clear();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe.each(backends)("SC06 reviewed learning/eval %s contract", (backend) => {
  it("preserves filtering, idempotency, CAS, fixture order, and dual shadows", async () => {
    const root = await createRoot();
    const storage = await createBackendStorage(backend);
    let learningId = 0;
    const learningStore = createAgentLearningStore({
      configDir: root,
      backend,
      ...(storage ? { storage } : {}),
      createId: () => `learning_${++learningId}`,
      now: createSteppedClock("2026-08-16T03:00:00.000Z"),
    });
    const procedural = await learningStore.create(
      createLearningInput("procedural_memory", "run_learning_1"),
    );
    const failure = await learningStore.create(
      createLearningInput("failure_lesson", "run_learning_2"),
    );
    await learningStore.create(
      createLearningInput("procedural_memory", "run_learning_3"),
    );
    await learningStore.setStatus(procedural.id, "accepted");
    await learningStore.setStatus(failure.id, "accepted");

    await expect(
      learningStore.list({
        status: "accepted",
        type: "procedural_memory",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: procedural.id,
        status: "accepted",
        type: "procedural_memory",
      }),
    ]);
    await expect(
      learningStore.list({
        status: "pending_review",
        type: "failure_lesson",
      }),
    ).resolves.toEqual([]);

    const candidateStore = createAgentEvalCandidateStore({
      configDir: root,
      backend,
      ...(storage ? { storage } : {}),
      now: createSteppedClock("2026-08-16T04:00:00.000Z"),
    });
    const first = await candidateStore.create(
      createCandidate("candidate_1", "run_eval_1", "fixture_1"),
    );
    await expect(
      candidateStore.create(
        createCandidate("candidate_1", "run_other", "fixture_other"),
      ),
    ).resolves.toEqual(first);
    await expect(
      candidateStore.create(
        createCandidate("candidate_other", "run_eval_1", "fixture_1"),
      ),
    ).resolves.toEqual(first);
    const competing = await candidateStore.create(
      createCandidate("candidate_2", "run_eval_2", "fixture_2"),
    );
    const transitions = await Promise.all([
      candidateStore.transitionStatus(
        competing.id,
        "pending_review",
        "accepted",
      ),
      candidateStore.transitionStatus(
        competing.id,
        "pending_review",
        "rejected",
      ),
    ]);
    expect(transitions.filter(Boolean)).toHaveLength(1);
    await expect(candidateStore.list()).resolves.toHaveLength(2);

    const fixtureStore = createPromotedAgentEvalFixtureStore({
      configDir: root,
      backend,
      ...(storage ? { storage } : {}),
      now: createSteppedClock("2026-08-16T05:00:00.000Z"),
    });
    const fixtureOne = createFixture("promoted_1", "First");
    const fixtureTwo = createFixture("promoted_2", "Second");
    const replacement = createFixture("promoted_1", "Replacement");
    await fixtureStore.upsert(fixtureOne);
    await fixtureStore.upsert(fixtureTwo);
    await fixtureStore.upsert(replacement);
    await expect(fixtureStore.list()).resolves.toEqual([
      replacement,
      fixtureTwo,
    ]);

    await Promise.all([
      learningStore.flushShadowWrites({ close: true }),
      candidateStore.flushShadowWrites({ close: true }),
      fixtureStore.flushShadowWrites({ close: true }),
    ]);
    if (backend === "dual") {
      const learningShadow = await readJson<{
        candidates: AgentEvalCandidate[];
      }>(root, "agent-learning-candidates.json");
      const candidateShadow = await readJson<{
        candidates: AgentEvalCandidate[];
      }>(root, "agent-eval-candidates.json");
      const fixtureShadow = await readJson<{
        fixtures: AgentEvalFixture[];
      }>(root, "agent-promoted-eval-fixtures.json");
      expect(learningShadow.candidates).toHaveLength(3);
      expect(candidateShadow.candidates).toHaveLength(2);
      expect(fixtureShadow.fixtures).toEqual([replacement, fixtureTwo]);
    }
  });
});

describe("SC06 SQLite concurrency and promotion", () => {
  it("deduplicates creates and lets only one cross-instance CAS win", async () => {
    const root = await createRoot();
    const dbPath = path.join(root, "zerox.db");
    const firstStorage = trackStorage(createStorageImpl({ dbPath }));
    const secondStorage = trackStorage(createStorageImpl({ dbPath }));
    const first = createAgentEvalCandidateStore({
      configDir: root,
      backend: "sqlite",
      storage: firstStorage,
      now: () => new Date("2026-08-16T06:01:00.000Z"),
    });
    const second = createAgentEvalCandidateStore({
      configDir: root,
      backend: "sqlite",
      storage: secondStorage,
      now: () => new Date("2026-08-16T06:02:00.000Z"),
    });

    const created = await first.create(
      createCandidate("candidate_a", "run_shared", "fixture_shared"),
    );
    const duplicate = await second.create(
      createCandidate("candidate_b", "run_shared", "fixture_shared"),
    );
    expect(duplicate).toEqual(created);
    await expect(first.list()).resolves.toHaveLength(1);

    const transitions = await Promise.all([
      first.transitionStatus(created.id, "pending_review", "accepted"),
      second.transitionStatus(created.id, "pending_review", "rejected"),
    ]);
    expect(transitions.filter(Boolean)).toHaveLength(1);
    expect((await first.list())[0]?.status).toBe(
      transitions.find(Boolean)?.status,
    );
  });

  it("promotes in one transaction and rolls candidate status back on fixture failure", async () => {
    const root = await createRoot();
    const storage = trackStorage(await createInMemoryStorage());
    const candidateStore = createAgentEvalCandidateStore({
      configDir: root,
      backend: "sqlite",
      storage,
      now: () => new Date("2026-08-16T07:01:00.000Z"),
    });
    const fixtureStore = createPromotedAgentEvalFixtureStore({
      configDir: root,
      backend: "sqlite",
      storage,
      now: () => new Date("2026-08-16T07:01:00.000Z"),
    });
    const accepted = await candidateStore.create(
      createCandidate(
        "candidate_success",
        "run_success",
        "fixture_success",
        "accepted",
      ),
    );
    const failing = await candidateStore.create(
      createCandidate(
        "candidate_failure",
        "run_failure",
        "fixture_failure",
        "accepted",
      ),
    );
    const service = createPromotionService(candidateStore, fixtureStore);

    await expect(service.promoteAccepted(accepted.id)).resolves.toMatchObject({
      ok: true,
      candidate: {
        id: accepted.id,
        status: "promoted",
      },
      fixtureId: accepted.fixture.id,
    });
    storage.db.exec(`
      CREATE TRIGGER fail_sc06_fixture_insert
      BEFORE INSERT ON promoted_eval_fixtures
      WHEN NEW.id = 'fixture_failure'
      BEGIN
        SELECT RAISE(ABORT, 'fixture promotion failed');
      END;
    `);

    await expect(service.promoteAccepted(failing.id)).rejects.toThrow(
      "fixture promotion failed",
    );
    expect(
      (await candidateStore.list()).find(
        (candidate) => candidate.id === failing.id,
      )?.status,
    ).toBe("accepted");
    expect(
      (await fixtureStore.list()).some(
        (fixture) => fixture.id === failing.fixture.id,
      ),
    ).toBe(false);
  });

  it("publishes both dual shadows only after the promotion transaction commits", async () => {
    const root = await createRoot();
    const storage = trackStorage(await createInMemoryStorage());
    const candidateStore = createAgentEvalCandidateStore({
      configDir: root,
      backend: "dual",
      storage,
      now: () => new Date("2026-08-16T07:10:00.000Z"),
    });
    const fixtureStore = createPromotedAgentEvalFixtureStore({
      configDir: root,
      backend: "dual",
      storage,
      now: () => new Date("2026-08-16T07:10:00.000Z"),
    });
    const accepted = await candidateStore.create(
      createCandidate(
        "candidate_dual",
        "run_dual",
        "fixture_dual",
        "accepted",
      ),
    );
    const service = createPromotionService(candidateStore, fixtureStore);

    await expect(service.promoteAccepted(accepted.id)).resolves.toMatchObject({
      ok: true,
      candidate: {
        id: accepted.id,
        status: "promoted",
      },
    });
    await Promise.all([
      candidateStore.flushShadowWrites({ close: true }),
      fixtureStore.flushShadowWrites({ close: true }),
    ]);

    const candidateShadow = await readJson<{
      candidates: AgentEvalCandidate[];
    }>(root, "agent-eval-candidates.json");
    const fixtureShadow = await readJson<{
      fixtures: AgentEvalFixture[];
    }>(root, "agent-promoted-eval-fixtures.json");
    expect(candidateShadow.candidates).toEqual([
      expect.objectContaining({
        id: accepted.id,
        status: "promoted",
      }),
    ]);
    expect(fixtureShadow.fixtures).toEqual([accepted.fixture]);
  });

  it("keeps promoted sort order and created_at when replacing a fixture", async () => {
    const root = await createRoot();
    const storage = trackStorage(await createInMemoryStorage());
    const fixtureStore = createPromotedAgentEvalFixtureStore({
      configDir: root,
      backend: "sqlite",
      storage,
      now: createSteppedClock("2026-08-16T08:00:00.000Z"),
    });
    await fixtureStore.upsert(createFixture("fixture_1", "First"));
    await fixtureStore.upsert(createFixture("fixture_2", "Second"));
    await fixtureStore.upsert(createFixture("fixture_1", "Replacement"));

    expect(
      storage.db
        .prepare(
          `SELECT id, created_at, sort_order
             FROM promoted_eval_fixtures
            ORDER BY sort_order ASC`,
        )
        .all(),
    ).toEqual([
      {
        id: "fixture_1",
        created_at: "2026-08-16T08:00:00.000Z",
        sort_order: 1,
      },
      {
        id: "fixture_2",
        created_at: "2026-08-16T08:01:00.000Z",
        sort_order: 2,
      },
    ]);
    await expect(fixtureStore.list()).resolves.toEqual([
      createFixture("fixture_1", "Replacement"),
      createFixture("fixture_2", "Second"),
    ]);
  });
});

describe.each(["sqlite", "dual"] satisfies StorageBackend[])(
  "SC06 %s restart authority",
  (backend) => {
    it("recovers all three domains from SQLite even if dual JSON is stale", async () => {
      const root = await createRoot();
      const dbPath = path.join(root, "zerox.db");
      const firstStorage = trackStorage(createStorageImpl({ dbPath }));
      const learningStore = createAgentLearningStore({
        configDir: root,
        backend,
        storage: firstStorage,
        createId: () => "learning_restart",
      });
      const candidateStore = createAgentEvalCandidateStore({
        configDir: root,
        backend,
        storage: firstStorage,
      });
      const fixtureStore = createPromotedAgentEvalFixtureStore({
        configDir: root,
        backend,
        storage: firstStorage,
      });
      const learning = await learningStore.create(
        createLearningInput("skill_improvement", "run_restart"),
      );
      await learningStore.setStatus(learning.id, "accepted");
      const candidate = await candidateStore.create(
        createCandidate(
          "candidate_restart",
          "run_restart",
          "fixture_restart",
          "accepted",
        ),
      );
      await fixtureStore.upsert(candidate.fixture);
      await Promise.all([
        learningStore.flushShadowWrites({ close: true }),
        candidateStore.flushShadowWrites({ close: true }),
        fixtureStore.flushShadowWrites({ close: true }),
      ]);
      closeStorage(firstStorage);

      if (backend === "dual") {
        await writeFile(
          path.join(root, "agent-learning-candidates.json"),
          '{"schemaVersion":1,"candidates":[]}\n',
          "utf8",
        );
        await writeFile(
          path.join(root, "agent-eval-candidates.json"),
          '{"schemaVersion":1,"candidates":[]}\n',
          "utf8",
        );
        await writeFile(
          path.join(root, "agent-promoted-eval-fixtures.json"),
          '{"schemaVersion":1,"fixtures":[]}\n',
          "utf8",
        );
      }

      const restartedStorage = trackStorage(createStorageImpl({ dbPath }));
      const restartedLearning = createAgentLearningStore({
        configDir: root,
        backend,
        storage: restartedStorage,
      });
      const restartedCandidate = createAgentEvalCandidateStore({
        configDir: root,
        backend,
        storage: restartedStorage,
      });
      const restartedFixture = createPromotedAgentEvalFixtureStore({
        configDir: root,
        backend,
        storage: restartedStorage,
      });
      await expect(restartedLearning.list()).resolves.toEqual([
        expect.objectContaining({
          id: learning.id,
          status: "accepted",
        }),
      ]);
      await expect(restartedCandidate.list()).resolves.toEqual([candidate]);
      await expect(restartedFixture.list()).resolves.toEqual([
        candidate.fixture,
      ]);
    });
  },
);

describe("SC06 dual shadow failures", () => {
  it("keeps every SQLite commit visible and closes further writes", async () => {
    const root = await createRoot();
    await Promise.all([
      mkdir(path.join(root, "agent-learning-candidates.json")),
      mkdir(path.join(root, "agent-eval-candidates.json")),
      mkdir(path.join(root, "agent-promoted-eval-fixtures.json")),
    ]);
    const storage = trackStorage(await createInMemoryStorage());
    const learningStore = createAgentLearningStore({
      configDir: root,
      backend: "dual",
      storage,
      createId: () => "learning_shadow",
    });
    const candidateStore = createAgentEvalCandidateStore({
      configDir: root,
      backend: "dual",
      storage,
    });
    const fixtureStore = createPromotedAgentEvalFixtureStore({
      configDir: root,
      backend: "dual",
      storage,
    });
    const learning = await learningStore.create(
      createLearningInput("failure_lesson", "run_shadow"),
    );
    const candidate = await candidateStore.create(
      createCandidate("candidate_shadow", "run_shadow", "fixture_shadow"),
    );
    await fixtureStore.upsert(candidate.fixture);

    await expect(
      learningStore.flushShadowWrites({ close: true }),
    ).rejects.toBeDefined();
    await expect(
      candidateStore.flushShadowWrites({ close: true }),
    ).rejects.toBeDefined();
    await expect(
      fixtureStore.flushShadowWrites({ close: true }),
    ).rejects.toBeDefined();
    await expect(learningStore.list()).resolves.toEqual([learning]);
    await expect(candidateStore.list()).resolves.toEqual([candidate]);
    await expect(fixtureStore.list()).resolves.toEqual([candidate.fixture]);
    await expect(
      learningStore.setStatus(learning.id, "accepted"),
    ).rejects.toThrow("Persistence queue is closed");
    await expect(
      candidateStore.setStatus(candidate.id, "accepted"),
    ).rejects.toThrow("Persistence queue is closed");
    await expect(
      fixtureStore.upsert(createFixture("new_fixture", "New")),
    ).rejects.toThrow("Persistence queue is closed");
  });
});

function createPromotionService(
  candidateStore: AgentEvalCandidateStore,
  fixtureStore: PromotedAgentEvalFixtureStore,
) {
  return createAgentEvalCandidateService({
    runStore: {
      async append(run) {
        return run;
      },
      async get() {
        return null;
      },
      async list() {
        return [];
      },
      async flushShadowWrites() {
        return;
      },
    },
    trajectoryStore: {
      async append(_runId, event) {
        return event;
      },
      async appendIfAbsent(_runId, _publicationKey, event) {
        return { appended: true, event };
      },
      async list() {
        return [];
      },
      async flushShadowWrites() {
        return;
      },
    },
    candidateStore,
    promotedFixtureStore: fixtureStore,
    now: () => new Date("2026-08-16T07:02:00.000Z"),
  });
}

function createLearningInput(
  type: AgentLearningCandidateInput["type"],
  sourceRunId: string,
): AgentLearningCandidateInput {
  return {
    type,
    sourceRunId,
    sourceTrajectoryEventIds: [`${sourceRunId}_event`],
    claim: `Claim for ${sourceRunId}`,
    recommendedAction: `Action for ${sourceRunId}`,
    risk: "Low",
  };
}

function createCandidate(
  id: string,
  sourceRunId: string,
  fixtureId: string,
  status: AgentEvalCandidateStatus = "pending_review",
): AgentEvalCandidate {
  return {
    id,
    sourceRunId,
    status,
    rationale: "Generated from durable evidence.",
    fixture: createFixture(fixtureId, `Fixture for ${sourceRunId}`),
    createdAt: "2026-08-16T00:00:00.000Z",
    updatedAt: "2026-08-16T00:00:00.000Z",
  };
}

function createFixture(id: string, description: string): AgentEvalFixture {
  return {
    id,
    description,
    events: [],
    requiredEventTypes: [],
  };
}

function createSteppedClock(start: string): () => Date {
  const startMs = new Date(start).getTime();
  let offset = 0;
  return () => new Date(startMs + offset++ * 60_000);
}

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "zerox-sc06-"));
  roots.push(root);
  return root;
}

async function createBackendStorage(
  backend: StorageBackend,
): Promise<Storage | undefined> {
  return backend === "json"
    ? undefined
    : trackStorage(await createInMemoryStorage());
}

function trackStorage(storage: Storage): Storage {
  storages.add(storage);
  return storage;
}

function closeStorage(storage: Storage): void {
  storage.close();
  storages.delete(storage);
}

async function readJson<T>(root: string, name: string): Promise<T> {
  return JSON.parse(await readFile(path.join(root, name), "utf8")) as T;
}
