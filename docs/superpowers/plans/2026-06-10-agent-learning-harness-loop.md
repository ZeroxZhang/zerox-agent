# Agent Learning Harness Loop P3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the P3 learning harness loop: reviewable eval candidates from real runs, local fixture promotion, adversarial eval sensors, Tool ACI policy checks, layered context policy, and score/UI integration.

**Architecture:** Reuse the existing local-first stores and IPC pattern. Eval candidates mirror the reviewed learning architecture, promoted fixtures remain local `userData/config` artifacts, eval runner combines built-in and promoted fixtures, and ACI/context improvements start as deterministic policy sensors before broad runtime rewrites.

**Tech Stack:** TypeScript shared contracts, Electron main process JSON stores, React renderer panels, Vitest, existing trajectory/eval fixtures, Node scripts, README/.zerox harness docs.

---

## Source Spec

Implement:

```text
docs/superpowers/specs/2026-06-10-agent-learning-harness-loop-design.md
```

## Scope Check

This plan covers P3.1 through P3.5 from the spec:

- eval candidate store and lifecycle
- run-to-candidate service and IPC
- Runs, Eval Review, and Overview surfaces
- local promoted fixture pack
- built-in + promoted eval loading
- deterministic adversarial eval
- Tool ACI Poka-Yoke policy report
- layered context profile policy
- docs and verification

It deliberately does not implement DAG workflows, cloud sync, automatic skill rewriting, stochastic live pass^k, or multi-level Agent swarms.

## File Structure

- `src/shared/agentEvalCandidate.ts`
  Extend status types, list options, promoted fixture store contracts, and IPC result types.

- `src/main/agentEvalCandidateStore.ts`
  JSON store for `agent-eval-candidates.json`; create/list/status/dedupe.

- `src/main/agentEvalCandidateStore.test.ts`
  Store lifecycle tests.

- `src/main/agentEvalCandidateService.ts`
  Loads runs and trajectories, creates candidates for terminal runs, promotes accepted candidates.

- `src/main/agentEvalCandidateService.test.ts`
  Service tests with fake run/trajectory stores.

- `src/main/eval/agentPromotedEvalFixtures.ts`
  JSON store helpers for `agent-promoted-eval-fixtures.json` and `createCombinedAgentEvalFixtures()`.

- `src/main/eval/agentPromotedEvalFixtures.test.ts`
  Promotion pack tests.

- `src/main/eval/agentEvalAdversary.ts`
  Deterministic invalid fixture mutations and adversarial eval runner.

- `src/main/eval/agentEvalAdversary.test.ts`
  Mutation and rejection tests.

- `src/shared/toolAciPolicy.ts`
  Poka-Yoke policy report over native descriptors and tool definitions.

- `src/shared/toolAciPolicy.test.ts`
  ACI policy tests.

- `src/shared/agentContextProfile.ts`
  Core/hot/cold context profile and task-intent memory-kind selection.

- `src/shared/agentContextProfile.test.ts`
  Context profile tests.

- `src/main/eval/agentEvalRunner.ts`
  Keep deterministic runner; used by combined and adversarial modes.

- `scripts/run-agent-evals.mjs`
  Load promoted fixtures when `--config-dir` or `BUILDING_AGENT_CONFIG_DIR` is present.

- `scripts/run-harness-score.mjs`
  Include promoted evals, adversarial evals, pending eval count, and ACI report.

- `src/main/main.ts`
  Instantiate candidate store/service; add IPC handlers.

- `src/preload/index.ts`
  Expose eval candidate APIs.

- `src/renderer/components/RunsPanel.tsx`
  Add selected-run Eval Candidate card.

- `src/renderer/components/EvalReviewPanel.tsx`
  New review/promotion UI for eval candidates.

- `src/renderer/components/OverviewPanel.tsx`
  Load pending eval candidates and pass the real count into `computeAgentCapabilityScore`.

- `src/shared/navigation.ts`, `src/shared/appMeta.ts`, `src/shared/materialNavigation.ts`
  Add the Eval Review navigation section.

- `src/renderer/materialDesign.test.ts`
  Static UI guards for Eval Review and Runs candidate card.

- `docs/architecture/agent-learning-loop.md`, `README.md`, `.zerox/feature_list.json`, `.zerox/progress.md`
  Document the new lifecycle and verification evidence.

---

## Task 1: Eval Candidate Store Lifecycle

**Files:**

- Modify: `src/shared/agentEvalCandidate.ts`
- Create: `src/main/agentEvalCandidateStore.ts`
- Create: `src/main/agentEvalCandidateStore.test.ts`

- [ ] **Step 1: Write the failing store tests**

Create `src/main/agentEvalCandidateStore.test.ts`:

```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentEvalCandidateStore } from "./agentEvalCandidateStore";
import type { AgentEvalCandidate } from "../shared/agentEvalCandidate";

describe("agent eval candidate store", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(path.join(os.tmpdir(), "building-agent-eval-candidates-"));
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  it("creates reviewable eval candidates and persists them", async () => {
    const store = createAgentEvalCandidateStore({ configDir });
    const candidate = await store.create(createCandidate("run_1"));

    expect(candidate).toMatchObject({
      id: "eval_candidate_run_1",
      status: "pending_review",
      sourceRunId: "run_1",
      createdAt: "2026-06-10T00:00:00.000Z",
      updatedAt: "2026-06-10T00:00:00.000Z",
    });
    await expect(store.list({ status: "pending_review" })).resolves.toEqual([
      candidate,
    ]);

    const raw = await readFile(
      path.join(configDir, "agent-eval-candidates.json"),
      "utf8",
    );
    expect(JSON.parse(raw)).toEqual({
      schemaVersion: 1,
      candidates: [candidate],
    });
  });

  it("dedupes candidates by source run and fixture id", async () => {
    const store = createAgentEvalCandidateStore({ configDir });
    const first = await store.create(createCandidate("run_1"));
    const second = await store.create(createCandidate("run_1"));

    expect(second).toEqual(first);
    await expect(store.list()).resolves.toHaveLength(1);
  });

  it("updates status and preserves fixture evidence", async () => {
    const store = createAgentEvalCandidateStore({
      configDir,
      now: createSteppedClock("2026-06-10T00:00:00.000Z"),
    });
    const candidate = await store.create(createCandidate("run_1"));

    const accepted = await store.setStatus(candidate.id, "accepted");

    expect(accepted).toMatchObject({
      id: candidate.id,
      status: "accepted",
      updatedAt: "2026-06-10T00:01:00.000Z",
      fixture: { id: "episode-run-1" },
    });
    await expect(store.list({ status: "pending_review" })).resolves.toEqual([]);
    await expect(store.list({ status: "accepted" })).resolves.toEqual([accepted]);
  });

  it("returns null when updating a missing candidate", async () => {
    const store = createAgentEvalCandidateStore({ configDir });

    await expect(store.setStatus("missing", "rejected")).resolves.toBeNull();
    await expect(store.list()).resolves.toEqual([]);
  });
});

function createCandidate(runId: string): AgentEvalCandidate {
  return {
    id: `eval_candidate_${runId}`,
    sourceRunId: runId,
    status: "pending_review",
    rationale: "Generated from test evidence.",
    createdAt: "2026-06-10T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:00.000Z",
    fixture: {
      id: `episode-${runId.replace(/_/g, "-")}`,
      description: `Episode candidate from ${runId}`,
      events: [],
      requiredEventTypes: ["final_summary"],
    },
  };
}

function createSteppedClock(start: string): () => Date {
  let offset = 0;
  const startMs = new Date(start).getTime();
  return () => {
    const value = new Date(startMs + offset * 60_000);
    offset += 1;
    return value;
  };
}
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- src/main/agentEvalCandidateStore.test.ts
```

Expected: FAIL because `createAgentEvalCandidateStore` does not exist and `updatedAt/promoted` are not in the shared type.

- [ ] **Step 3: Extend shared eval candidate contracts**

Modify `src/shared/agentEvalCandidate.ts`:

```ts
export type AgentEvalCandidateStatus =
  | "pending_review"
  | "accepted"
  | "rejected"
  | "promoted";

export type AgentEvalCandidateListOptions = {
  status?: AgentEvalCandidateStatus;
};

export type AgentEvalCandidate = {
  id: string;
  sourceRunId: string;
  status: AgentEvalCandidateStatus;
  rationale: string;
  fixture: AgentEvalCandidateFixture;
  createdAt: string;
  updatedAt: string;
};
```

Update `src/main/agentEvalCandidateGenerator.ts` to include:

```ts
updatedAt: input.createdAt,
```

- [ ] **Step 4: Implement the JSON store**

Create `src/main/agentEvalCandidateStore.ts`:

```ts
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
};

export function createAgentEvalCandidateStore(options: {
  configDir: string;
  now?: () => Date;
}): AgentEvalCandidateStore {
  const candidatesPath = path.join(options.configDir, "agent-eval-candidates.json");
  const now = options.now ?? (() => new Date());

  async function readStored(): Promise<StoredAgentEvalCandidates> {
    try {
      const raw = await readFile(candidatesPath, "utf8");
      const stored = JSON.parse(raw) as StoredAgentEvalCandidates;
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

  async function writeStored(stored: StoredAgentEvalCandidates) {
    await mkdir(options.configDir, { recursive: true });
    await writeFile(candidatesPath, `${JSON.stringify(stored, null, 2)}\n`, {
      encoding: "utf8",
    });
  }

  return {
    async create(candidate) {
      const stored = await readStored();
      const existing = stored.candidates.find(
        (item) =>
          item.sourceRunId === candidate.sourceRunId &&
          item.fixture.id === candidate.fixture.id,
      );
      if (existing) {
        return existing;
      }

      await writeStored({
        schemaVersion: 1,
        candidates: [...stored.candidates, candidate],
      });
      return candidate;
    },

    async list(listOptions) {
      const stored = await readStored();
      return stored.candidates.filter((candidate) =>
        listOptions?.status ? candidate.status === listOptions.status : true,
      );
    },

    async setStatus(candidateId, status) {
      const stored = await readStored();
      let updatedCandidate: AgentEvalCandidate | null = null;
      const candidates = stored.candidates.map((candidate) => {
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

      await writeStored({ schemaVersion: 1, candidates });
      return updatedCandidate;
    },
  };
}
```

- [ ] **Step 5: Verify green**

Run:

```bash
npm test -- src/main/agentEvalCandidateStore.test.ts src/main/agentEvalCandidateGenerator.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/agentEvalCandidate.ts src/main/agentEvalCandidateGenerator.ts src/main/agentEvalCandidateStore.ts src/main/agentEvalCandidateStore.test.ts
git commit -m "feat: add eval candidate review store"
```

---

## Task 2: Eval Candidate Service And IPC

**Files:**

- Create: `src/main/agentEvalCandidateService.ts`
- Create: `src/main/agentEvalCandidateService.test.ts`
- Modify: `src/main/main.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/global.d.ts` only if inferred preload types need explicit imports.

- [ ] **Step 1: Write the failing service tests**

Create `src/main/agentEvalCandidateService.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createAgentEvalCandidateService } from "./agentEvalCandidateService";
import type { AgentRunRecord } from "../shared/agentRuns";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";

describe("agent eval candidate service", () => {
  it("generates a candidate for a terminal run", async () => {
    const candidateStore = createMemoryCandidateStore();
    const service = createAgentEvalCandidateService({
      runStore: { get: vi.fn(async () => createRun("succeeded")) },
      trajectoryStore: { list: vi.fn(async () => createTrajectory()) },
      candidateStore,
      promotedFixtureStore: createMemoryPromotedFixtureStore(),
      now: () => new Date("2026-06-10T00:00:00.000Z"),
    });

    const result = await service.generateForRun("run_1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.candidate).toMatchObject({
        sourceRunId: "run_1",
        status: "pending_review",
        fixture: { requiredEventTypes: ["tool_call", "tool_result", "final_summary"] },
      });
    }
    await expect(candidateStore.list({ status: "pending_review" })).resolves.toHaveLength(1);
  });

  it("rejects running runs because their evidence is incomplete", async () => {
    const service = createAgentEvalCandidateService({
      runStore: { get: vi.fn(async () => createRun("running")) },
      trajectoryStore: { list: vi.fn(async () => createTrajectory()) },
      candidateStore: createMemoryCandidateStore(),
      promotedFixtureStore: createMemoryPromotedFixtureStore(),
      now: () => new Date("2026-06-10T00:00:00.000Z"),
    });

    await expect(service.generateForRun("run_1")).resolves.toEqual({
      ok: false,
      message: "只有已结束的运行可以生成 eval candidate。",
    });
  });

  it("promotes accepted candidates and marks them promoted", async () => {
    const candidateStore = createMemoryCandidateStore();
    const accepted = await candidateStore.create({
      ...createCandidate(),
      status: "accepted",
    });
    const promotedFixtureStore = createMemoryPromotedFixtureStore();
    const service = createAgentEvalCandidateService({
      runStore: { get: vi.fn() },
      trajectoryStore: { list: vi.fn() },
      candidateStore,
      promotedFixtureStore,
      now: () => new Date("2026-06-10T00:01:00.000Z"),
    });

    const result = await service.promoteAccepted(accepted.id);

    expect(result.ok).toBe(true);
    await expect(promotedFixtureStore.list()).resolves.toEqual([accepted.fixture]);
    await expect(candidateStore.list({ status: "promoted" })).resolves.toHaveLength(1);
  });
});
```

The helper functions in this test should be in-memory fakes with the same method names as the real stores. Keep them at the bottom of the test file so the production service is tested through interfaces.

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- src/main/agentEvalCandidateService.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement the service result contracts**

Add these exports in `src/shared/agentEvalCandidate.ts`:

```ts
export type GenerateEvalCandidateForRunResult =
  | { ok: true; candidate: AgentEvalCandidate; existing: boolean }
  | { ok: false; message: string };

export type PromoteEvalCandidateResult =
  | { ok: true; candidate: AgentEvalCandidate; fixtureId: string }
  | { ok: false; message: string };
```

- [ ] **Step 4: Implement `createAgentEvalCandidateService`**

Create `src/main/agentEvalCandidateService.ts`:

```ts
import type { AgentRunRecord } from "../shared/agentRuns";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";
import type {
  AgentEvalCandidate,
  GenerateEvalCandidateForRunResult,
  PromoteEvalCandidateResult,
} from "../shared/agentEvalCandidate";
import { createEvalCandidateFromEpisode } from "./agentEvalCandidateGenerator";
import type { AgentEvalCandidateStore } from "./agentEvalCandidateStore";
import type { PromotedAgentEvalFixtureStore } from "./eval/agentPromotedEvalFixtures";

type RunStoreLike = {
  get(runId: string): Promise<AgentRunRecord | null>;
};

type TrajectoryStoreLike = {
  list(runId: string): Promise<AgentTrajectoryEvent[]>;
};

export type AgentEvalCandidateService = {
  generateForRun(runId: string): Promise<GenerateEvalCandidateForRunResult>;
  promoteAccepted(candidateId: string): Promise<PromoteEvalCandidateResult>;
};

export function createAgentEvalCandidateService(options: {
  runStore: RunStoreLike;
  trajectoryStore: TrajectoryStoreLike;
  candidateStore: AgentEvalCandidateStore;
  promotedFixtureStore: PromotedAgentEvalFixtureStore;
  now?: () => Date;
}): AgentEvalCandidateService {
  const now = options.now ?? (() => new Date());

  return {
    async generateForRun(runId) {
      const run = await options.runStore.get(runId);
      if (!run) {
        return { ok: false, message: "运行记录不存在。" };
      }
      if (!isTerminalRun(run)) {
        return { ok: false, message: "只有已结束的运行可以生成 eval candidate。" };
      }

      const trajectory = await options.trajectoryStore.list(runId);
      const candidate = createEvalCandidateFromEpisode({
        run,
        trajectory,
        createdAt: now().toISOString(),
      });
      const created = await options.candidateStore.create(candidate);

      return {
        ok: true,
        candidate: created,
        existing: created.createdAt !== candidate.createdAt,
      };
    },

    async promoteAccepted(candidateId) {
      const candidates = await options.candidateStore.list();
      const candidate = candidates.find((item) => item.id === candidateId);
      if (!candidate) {
        return { ok: false, message: "Eval candidate 不存在。" };
      }
      if (candidate.status !== "accepted") {
        return { ok: false, message: "只有已接受的 eval candidate 可以晋升。" };
      }

      await options.promotedFixtureStore.upsert(candidate.fixture);
      const promoted = await options.candidateStore.setStatus(candidate.id, "promoted");
      if (!promoted) {
        return { ok: false, message: "Eval candidate 状态更新失败。" };
      }

      return { ok: true, candidate: promoted, fixtureId: candidate.fixture.id };
    },
  };
}

function isTerminalRun(run: AgentRunRecord): boolean {
  return (
    run.status === "succeeded" ||
    run.status === "failed" ||
    run.status === "cancelled"
  );
}
```

- [ ] **Step 5: Add IPC handlers and preload APIs**

In `src/main/main.ts`, add lazy globals next to learning store/service:

```ts
let agentEvalCandidateStore: AgentEvalCandidateStore | null = null;
let agentEvalCandidateService: AgentEvalCandidateService | null = null;
let promotedAgentEvalFixtureStore: PromotedAgentEvalFixtureStore | null = null;
```

Add IPC handlers near `agentQuality:getEvalReport`:

```ts
ipcMain.handle("agentEvalCandidates:list", (_event, options?: AgentEvalCandidateListOptions) =>
  getAgentEvalCandidateStore().list(options),
);
ipcMain.handle("agentEvalCandidates:generateForRun", (_event, runId: string) =>
  getAgentEvalCandidateService().generateForRun(runId),
);
ipcMain.handle("agentEvalCandidates:accept", (_event, candidateId: string) =>
  getAgentEvalCandidateStore().setStatus(candidateId, "accepted"),
);
ipcMain.handle("agentEvalCandidates:reject", (_event, candidateId: string) =>
  getAgentEvalCandidateStore().setStatus(candidateId, "rejected"),
);
ipcMain.handle("agentEvalCandidates:promote", (_event, candidateId: string) =>
  getAgentEvalCandidateService().promoteAccepted(candidateId),
);
```

In `src/preload/index.ts`, expose matching methods:

```ts
listEvalCandidates: (options?: AgentEvalCandidateListOptions): Promise<AgentEvalCandidate[]> =>
  ipcRenderer.invoke("agentEvalCandidates:list", options),
generateEvalCandidateForRun: (runId: string): Promise<GenerateEvalCandidateForRunResult> =>
  ipcRenderer.invoke("agentEvalCandidates:generateForRun", runId),
acceptEvalCandidate: (candidateId: string): Promise<AgentEvalCandidate | null> =>
  ipcRenderer.invoke("agentEvalCandidates:accept", candidateId),
rejectEvalCandidate: (candidateId: string): Promise<AgentEvalCandidate | null> =>
  ipcRenderer.invoke("agentEvalCandidates:reject", candidateId),
promoteEvalCandidate: (candidateId: string): Promise<PromoteEvalCandidateResult> =>
  ipcRenderer.invoke("agentEvalCandidates:promote", candidateId),
```

- [ ] **Step 6: Verify green**

Run:

```bash
npm test -- src/main/agentEvalCandidateService.test.ts
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/agentEvalCandidate.ts src/main/agentEvalCandidateService.ts src/main/agentEvalCandidateService.test.ts src/main/main.ts src/preload/index.ts
git commit -m "feat: generate eval candidates from stored runs"
```

---

## Task 3: Runs, Eval Review, And Overview UI

**Files:**

- Create: `src/renderer/components/EvalReviewPanel.tsx`
- Modify: `src/renderer/components/RunsPanel.tsx`
- Modify: `src/renderer/components/OverviewPanel.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/shared/navigation.ts`
- Modify: `src/shared/appMeta.ts`
- Modify: `src/shared/materialNavigation.ts`
- Modify: `src/renderer/materialDesign.test.ts`

- [ ] **Step 1: Write failing static UI tests**

Add these tests to `src/renderer/materialDesign.test.ts`:

```ts
it("surfaces eval candidate generation in Runs", () => {
  expect(runsPanelSource).toContain("Eval Candidate");
  expect(runsPanelSource).toContain("generateEvalCandidateForRun");
});

it("has an Eval Review panel for candidate governance", () => {
  const evalReviewSource = readFileSync(
    path.join(process.cwd(), "src/renderer/components/EvalReviewPanel.tsx"),
    "utf8",
  );
  expect(evalReviewSource).toContain("listEvalCandidates");
  expect(evalReviewSource).toContain("promoteEvalCandidate");
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
npm test -- src/renderer/materialDesign.test.ts
```

Expected: FAIL because the panel and UI strings do not exist.

- [ ] **Step 3: Add navigation section**

Extend `NavigationSectionId` in `src/shared/navigation.ts` with:

```ts
| "evals"
```

Add section:

```ts
{
  id: "evals",
  label: "评测",
  module: "审核",
  summary: "审核真实运行生成的 eval candidates，并晋升为本地回归样本。",
  details: [
    "查看待审核、已接受、已晋升和已拒绝的 eval candidates。",
    "把真实 episode 晋升为本地 promoted fixture，而不是静默修改源码 fixture。",
    "用审核积压影响 Agent Capability score。",
  ],
}
```

Update `src/shared/appMeta.ts` modules to include `"评测"`.

Add an icon mapping in `src/shared/materialNavigation.ts` for `"evals"` using an existing simple glyph consistent with the file.

- [ ] **Step 4: Implement `EvalReviewPanel`**

Create `src/renderer/components/EvalReviewPanel.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { AgentEvalCandidate } from "../../shared/agentEvalCandidate";

type EvalReviewStatus =
  | { kind: "idle"; message: string }
  | { kind: "loading"; message: string }
  | { kind: "error"; message: string };

export function EvalReviewPanel() {
  const [candidates, setCandidates] = useState<AgentEvalCandidate[]>([]);
  const [status, setStatus] = useState<EvalReviewStatus>({
    kind: "loading",
    message: "正在加载评测候选...",
  });

  useEffect(() => {
    void loadCandidates();
  }, []);

  async function loadCandidates() {
    if (!window.buildingAgent) {
      setCandidates([]);
      setStatus({ kind: "idle", message: "浏览器预览模式暂无评测候选。" });
      return;
    }

    setStatus({ kind: "loading", message: "正在加载评测候选..." });
    try {
      const loaded = await window.buildingAgent.listEvalCandidates();
      setCandidates(sortCandidates(loaded));
      setStatus({
        kind: "idle",
        message: loaded.length ? "评测候选已加载。" : "暂无待审核评测候选。",
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "无法加载评测候选。",
      });
    }
  }

  async function setCandidateStatus(
    candidate: AgentEvalCandidate,
    action: "accept" | "reject",
  ) {
    if (!window.buildingAgent) return;
    setStatus({ kind: "loading", message: "正在更新评测候选..." });
    const updated =
      action === "accept"
        ? await window.buildingAgent.acceptEvalCandidate(candidate.id)
        : await window.buildingAgent.rejectEvalCandidate(candidate.id);
    if (!updated) {
      setStatus({ kind: "error", message: "评测候选不存在或已被更新。" });
      return;
    }
    setCandidates((current) =>
      sortCandidates(current.map((item) => (item.id === updated.id ? updated : item))),
    );
    setStatus({ kind: "idle", message: "评测候选状态已更新。" });
  }

  async function promoteCandidate(candidate: AgentEvalCandidate) {
    if (!window.buildingAgent) return;
    setStatus({ kind: "loading", message: "正在晋升本地 fixture..." });
    const result = await window.buildingAgent.promoteEvalCandidate(candidate.id);
    if (!result.ok) {
      setStatus({ kind: "error", message: result.message });
      return;
    }
    setCandidates((current) =>
      sortCandidates(
        current.map((item) =>
          item.id === result.candidate.id ? result.candidate : item,
        ),
      ),
    );
    setStatus({ kind: "idle", message: `已晋升 ${result.fixtureId}。` });
  }

  return (
    <section className="memory-panel">
      <div className="panel-heading">
        <div>
          <h2>评测审核</h2>
          <p>把真实运行沉淀为本地回归样本，先审核，再晋升。</p>
        </div>
        <span className={`settings-state is-${status.kind}`}>
          {candidates.filter((candidate) => candidate.status === "pending_review").length} 个待审
        </span>
      </div>

      <div className="memory-grid">
        {candidates.map((candidate) => (
          <article className="memory-card" key={candidate.id}>
            <div className="memory-card-heading">
              <span>{translateStatus(candidate.status)}</span>
              <strong>{candidate.fixture.id}</strong>
            </div>
            <h3>{candidate.fixture.description}</h3>
            <p>{candidate.rationale}</p>
            <dl className="inspector-dl">
              <div>
                <dt>来源运行</dt>
                <dd>{candidate.sourceRunId}</dd>
              </div>
              <div>
                <dt>必需事件</dt>
                <dd>{candidate.fixture.requiredEventTypes.join(", ") || "无"}</dd>
              </div>
              <div>
                <dt>断言</dt>
                <dd>{candidate.fixture.assertions?.length ?? 0} 条</dd>
              </div>
            </dl>
            {candidate.status === "pending_review" ? (
              <div className="button-row">
                <button className="secondary-action" type="button" onClick={() => void setCandidateStatus(candidate, "reject")}>
                  拒绝
                </button>
                <button className="primary-action" type="button" onClick={() => void setCandidateStatus(candidate, "accept")}>
                  接受
                </button>
              </div>
            ) : null}
            {candidate.status === "accepted" ? (
              <button className="primary-action" type="button" onClick={() => void promoteCandidate(candidate)}>
                晋升为本地 fixture
              </button>
            ) : null}
          </article>
        ))}
      </div>
      {!candidates.length ? <div className="empty-state">暂无评测候选。</div> : null}
      <p className={`settings-message is-${status.kind}`}>{status.message}</p>
    </section>
  );
}

function sortCandidates(candidates: AgentEvalCandidate[]): AgentEvalCandidate[] {
  const order = { pending_review: 0, accepted: 1, promoted: 2, rejected: 3 };
  return [...candidates].sort((left, right) => order[left.status] - order[right.status]);
}

function translateStatus(status: AgentEvalCandidate["status"]): string {
  if (status === "pending_review") return "待审核";
  if (status === "accepted") return "已接受";
  if (status === "promoted") return "已晋升";
  return "已拒绝";
}
```

- [ ] **Step 5: Wire the panel in `App.tsx`**

Import `EvalReviewPanel` and render it when `activeSection.id === "evals"` using the same conditional rendering pattern as existing sections.

- [ ] **Step 6: Add Runs candidate card**

In `RunsPanel`, add state:

```ts
const [evalCandidates, setEvalCandidates] = useState<AgentEvalCandidate[]>([]);
```

Load candidates with runs:

```ts
window.buildingAgent.listEvalCandidates()
```

Pass selected candidate into `RunInspector`, and add a button that calls:

```ts
const result = await window.buildingAgent.generateEvalCandidateForRun(selectedRun.id);
```

Only enable it for terminal run statuses. The inspector card label must include `Eval Candidate` for the static test.

- [ ] **Step 7: Update Overview**

Extend `OverviewData`:

```ts
evalCandidates: AgentEvalCandidate[];
```

Add to `Promise.all`:

```ts
window.buildingAgent.listEvalCandidates({ status: "pending_review" })
```

Pass:

```ts
pendingEvalCandidates: data.evalCandidates.length,
```

Add an attention item that navigates to `"evals"` when pending eval candidates exist.

- [ ] **Step 8: Verify green**

Run:

```bash
npm test -- src/renderer/materialDesign.test.ts src/shared/navigation.test.ts
npm run build
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/components/EvalReviewPanel.tsx src/renderer/components/RunsPanel.tsx src/renderer/components/OverviewPanel.tsx src/renderer/App.tsx src/shared/navigation.ts src/shared/appMeta.ts src/shared/materialNavigation.ts src/renderer/materialDesign.test.ts
git commit -m "feat: add eval candidate review UI"
```

---

## Task 4: Local Promoted Fixtures And Eval Loading

**Files:**

- Create: `src/main/eval/agentPromotedEvalFixtures.ts`
- Create: `src/main/eval/agentPromotedEvalFixtures.test.ts`
- Modify: `src/main/eval/agentEvalRunner.test.ts`
- Modify: `scripts/run-agent-evals.mjs`
- Modify: `scripts/run-harness-score.mjs`
- Modify: `src/main/main.ts`

- [ ] **Step 1: Write failing promoted fixture tests**

Create `src/main/eval/agentPromotedEvalFixtures.test.ts`:

```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createCombinedAgentEvalFixtures,
  createPromotedAgentEvalFixtureStore,
} from "./agentPromotedEvalFixtures";

describe("promoted agent eval fixtures", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(path.join(os.tmpdir(), "building-agent-promoted-fixtures-"));
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  it("upserts promoted fixtures and persists a local fixture pack", async () => {
    const store = createPromotedAgentEvalFixtureStore({ configDir });
    const fixture = createFixture("episode-run-1");

    await store.upsert(fixture);
    await store.upsert({ ...fixture, description: "Updated" });

    await expect(store.list()).resolves.toEqual([{ ...fixture, description: "Updated" }]);
    const raw = await readFile(
      path.join(configDir, "agent-promoted-eval-fixtures.json"),
      "utf8",
    );
    expect(JSON.parse(raw).fixtures).toHaveLength(1);
  });

  it("combines built-in and promoted fixtures without duplicating ids", () => {
    const builtIn = [createFixture("built-in"), createFixture("episode-run-1")];
    const promoted = [{ ...createFixture("episode-run-1"), description: "Local" }];

    expect(createCombinedAgentEvalFixtures(builtIn, promoted)).toEqual([
      createFixture("built-in"),
      { ...createFixture("episode-run-1"), description: "Local" },
    ]);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- src/main/eval/agentPromotedEvalFixtures.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement promoted fixture store**

Create `src/main/eval/agentPromotedEvalFixtures.ts`:

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentEvalFixture } from "./agentEvalFixtures";

type StoredPromotedAgentEvalFixtures = {
  schemaVersion: 1;
  fixtures: AgentEvalFixture[];
};

export type PromotedAgentEvalFixtureStore = {
  list(): Promise<AgentEvalFixture[]>;
  upsert(fixture: AgentEvalFixture): Promise<AgentEvalFixture>;
};

export function createPromotedAgentEvalFixtureStore(options: {
  configDir: string;
}): PromotedAgentEvalFixtureStore {
  const fixturesPath = path.join(options.configDir, "agent-promoted-eval-fixtures.json");

  async function readStored(): Promise<StoredPromotedAgentEvalFixtures> {
    try {
      const raw = await readFile(fixturesPath, "utf8");
      const stored = JSON.parse(raw) as StoredPromotedAgentEvalFixtures;
      return {
        schemaVersion: 1,
        fixtures: Array.isArray(stored.fixtures) ? stored.fixtures : [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { schemaVersion: 1, fixtures: [] };
      }
      throw error;
    }
  }

  async function writeStored(stored: StoredPromotedAgentEvalFixtures) {
    await mkdir(options.configDir, { recursive: true });
    await writeFile(fixturesPath, `${JSON.stringify(stored, null, 2)}\n`, {
      encoding: "utf8",
    });
  }

  return {
    async list() {
      const stored = await readStored();
      return stored.fixtures;
    },

    async upsert(fixture) {
      const stored = await readStored();
      const withoutExisting = stored.fixtures.filter((item) => item.id !== fixture.id);
      await writeStored({
        schemaVersion: 1,
        fixtures: [...withoutExisting, fixture],
      });
      return fixture;
    },
  };
}

export function createCombinedAgentEvalFixtures(
  builtIn: AgentEvalFixture[],
  promoted: AgentEvalFixture[],
): AgentEvalFixture[] {
  const byId = new Map<string, AgentEvalFixture>();
  for (const fixture of builtIn) byId.set(fixture.id, fixture);
  for (const fixture of promoted) byId.set(fixture.id, fixture);
  return [...byId.values()];
}
```

- [ ] **Step 4: Integrate main process eval report**

Modify `agentQuality:getEvalReport` in `src/main/main.ts`:

```ts
ipcMain.handle("agentQuality:getEvalReport", async (): Promise<AgentEvalReport> => {
  const promoted = await getPromotedAgentEvalFixtureStore().list();
  return runAgentEvals(
    createCombinedAgentEvalFixtures(createAgentEvalFixtures(), promoted),
  );
});
```

- [ ] **Step 5: Update scripts**

In `scripts/run-agent-evals.mjs`, parse `--config-dir`, import `createPromotedAgentEvalFixtureStore` and `createCombinedAgentEvalFixtures`, then run:

```js
const promoted = configDir
  ? await createPromotedAgentEvalFixtureStore({ configDir }).list()
  : [];
const report = await runAgentEvals(
  createCombinedAgentEvalFixtures(createAgentEvalFixtures(), promoted),
);
```

In `scripts/run-harness-score.mjs`, reuse the same combined fixture path for the normal eval report.

- [ ] **Step 6: Verify green**

Run:

```bash
npm test -- src/main/eval/agentPromotedEvalFixtures.test.ts src/main/eval/agentEvalRunner.test.ts
npm run build
node scripts/run-agent-evals.mjs
```

Expected: PASS and 11/11 or more if a config dir with promoted fixtures is used.

- [ ] **Step 7: Commit**

```bash
git add src/main/eval/agentPromotedEvalFixtures.ts src/main/eval/agentPromotedEvalFixtures.test.ts src/main/eval/agentEvalRunner.test.ts scripts/run-agent-evals.mjs scripts/run-harness-score.mjs src/main/main.ts
git commit -m "feat: load promoted local eval fixtures"
```

---

## Task 5: Adversarial Eval Sensor

**Files:**

- Create: `src/main/eval/agentEvalAdversary.ts`
- Create: `src/main/eval/agentEvalAdversary.test.ts`
- Modify: `scripts/run-harness-score.mjs`

- [ ] **Step 1: Write failing adversarial eval tests**

Create `src/main/eval/agentEvalAdversary.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createAgentEvalFixtures } from "./agentEvalFixtures";
import {
  createAdversarialAgentEvalCases,
  runAdversarialAgentEvals,
} from "./agentEvalAdversary";

describe("agent eval adversary", () => {
  it("creates deterministic invalid mutations from contract fixtures", () => {
    const cases = createAdversarialAgentEvalCases(createAgentEvalFixtures());

    expect(cases.map((item) => item.mutation)).toContain("remove_required_event");
    expect(cases.map((item) => item.mutation)).toContain("wrong_payload");
    expect(cases.map((item) => item.mutation)).toContain("wrong_order");
  });

  it("passes only when invalid mutations are rejected by the eval runner", async () => {
    const report = await runAdversarialAgentEvals(createAgentEvalFixtures());

    expect(report.passed).toBe(true);
    expect(report.checked).toBeGreaterThan(0);
    expect(report.escaped).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- src/main/eval/agentEvalAdversary.test.ts
```

Expected: FAIL because the adversary module does not exist.

- [ ] **Step 3: Implement adversarial mutations**

Create `src/main/eval/agentEvalAdversary.ts`:

```ts
import type { AgentEvalReport } from "../../shared/agentEval";
import type { AgentEvalFixture } from "./agentEvalFixtures";
import { runAgentEvals } from "./agentEvalRunner";

export type AgentEvalAdversarialMutation =
  | "remove_required_event"
  | "wrong_payload"
  | "wrong_order";

export type AgentEvalAdversarialCase = {
  sourceFixtureId: string;
  mutation: AgentEvalAdversarialMutation;
  fixture: AgentEvalFixture;
};

export type AgentEvalAdversarialReport = {
  passed: boolean;
  checked: number;
  escaped: Array<{ fixtureId: string; mutation: AgentEvalAdversarialMutation }>;
  evalReport: AgentEvalReport;
};

export function createAdversarialAgentEvalCases(
  fixtures: AgentEvalFixture[],
): AgentEvalAdversarialCase[] {
  const cases: AgentEvalAdversarialCase[] = [];

  for (const fixture of fixtures) {
    const required = fixture.requiredEventTypes[0];
    if (required) {
      cases.push({
        sourceFixtureId: fixture.id,
        mutation: "remove_required_event",
        fixture: {
          ...fixture,
          id: `${fixture.id}__adv_missing_${required}`,
          events: fixture.events.filter((event) => event.type !== required),
        },
      });
    }

    const payloadAssertion = fixture.assertions?.find(
      (assertion) => assertion.payload && Object.keys(assertion.payload).length,
    );
    if (payloadAssertion) {
      const [key] = Object.keys(payloadAssertion.payload ?? {});
      cases.push({
        sourceFixtureId: fixture.id,
        mutation: "wrong_payload",
        fixture: {
          ...fixture,
          id: `${fixture.id}__adv_wrong_payload`,
          assertions: fixture.assertions?.map((assertion) =>
            assertion === payloadAssertion
              ? { ...assertion, payload: { ...assertion.payload, [key]: "__invalid__" } }
              : assertion,
          ),
        },
      });
    }

    const orderedAssertion = fixture.assertions?.find((assertion) => assertion.after);
    if (orderedAssertion) {
      cases.push({
        sourceFixtureId: fixture.id,
        mutation: "wrong_order",
        fixture: {
          ...fixture,
          id: `${fixture.id}__adv_wrong_order`,
          events: moveEventBeforeDependency(
            fixture.events,
            orderedAssertion.type,
            orderedAssertion.after!,
          ),
        },
      });
    }
  }

  return cases;
}

export async function runAdversarialAgentEvals(
  fixtures: AgentEvalFixture[],
): Promise<AgentEvalAdversarialReport> {
  const cases = createAdversarialAgentEvalCases(fixtures);
  const mutatedFixtures = cases.map((item) => item.fixture);
  const evalReport = await runAgentEvals(mutatedFixtures);
  const escaped = cases
    .filter((item) => !evalReport.failures.some((failure) => failure.fixtureId === item.fixture.id))
    .map((item) => ({ fixtureId: item.sourceFixtureId, mutation: item.mutation }));

  return {
    passed: escaped.length === 0,
    checked: cases.length,
    escaped,
    evalReport,
  };
}

function moveEventBeforeDependency(
  events: AgentEvalFixture["events"],
  eventType: string,
  dependencyType: string,
): AgentEvalFixture["events"] {
  const eventIndex = events.findIndex((event) => event.type === eventType);
  const dependencyIndex = events.findIndex((event) => event.type === dependencyType);
  if (eventIndex < 0 || dependencyIndex < 0 || eventIndex < dependencyIndex) {
    return events;
  }

  const copy = [...events];
  const [event] = copy.splice(eventIndex, 1);
  copy.splice(dependencyIndex, 0, event);
  return copy.map((item, index) => ({ ...item, sequence: index + 1 }));
}
```

- [ ] **Step 4: Integrate harness score script**

In `scripts/run-harness-score.mjs`, import and run:

```js
const adversarial = await runAdversarialAgentEvals(fixtures);
```

Include it in JSON output:

```js
{
  score,
  eval: evalReport,
  adversarial,
}
```

Set failure:

```js
if (evalReport.failed > 0 || !adversarial.passed || score.tone === "bad") {
  process.exitCode = 1;
}
```

- [ ] **Step 5: Verify green**

Run:

```bash
npm test -- src/main/eval/agentEvalAdversary.test.ts src/main/eval/agentEvalRunner.test.ts
npm run harness:score
```

Expected: PASS, with adversarial report showing `passed: true`.

- [ ] **Step 6: Commit**

```bash
git add src/main/eval/agentEvalAdversary.ts src/main/eval/agentEvalAdversary.test.ts scripts/run-harness-score.mjs
git commit -m "feat: add adversarial eval sensor"
```

---

## Task 6: Tool ACI Policy And Context Profile Sensors

**Files:**

- Create: `src/shared/toolAciPolicy.ts`
- Create: `src/shared/toolAciPolicy.test.ts`
- Create: `src/shared/agentContextProfile.ts`
- Create: `src/shared/agentContextProfile.test.ts`
- Modify: `scripts/run-harness-score.mjs`

- [ ] **Step 1: Write failing ACI and context tests**

Create `src/shared/toolAciPolicy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { evaluateToolAciPolicy } from "./toolAciPolicy";
import { defineNativeToolDescriptor } from "./nativeCapabilities";

describe("tool ACI policy", () => {
  it("passes native descriptors with risk, permissions, and observable events", () => {
    const report = evaluateToolAciPolicy({
      nativeDescriptors: [
        defineNativeToolDescriptor({
          id: "git_status",
          kind: "git",
          label: "Git status",
          description: "Read workspace git status.",
          riskLevel: "low",
          permissionScope: { files: "read", shell: "none", web: "none" },
          observableEvents: ["native_tool_invocation", "native_tool_observation"],
        }),
      ],
    });

    expect(report).toEqual({ passed: true, findings: [] });
  });

  it("flags workspace tools without native observation events", () => {
    const report = evaluateToolAciPolicy({
      nativeDescriptors: [
        {
          id: "code_search",
          kind: "code",
          label: "Code search",
          description: "Search workspace code.",
          riskLevel: "low",
          permissionScope: { files: "read", shell: "approved_command", web: "none" },
          observableEvents: [],
          enabled: true,
        },
      ],
    });

    expect(report.passed).toBe(false);
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        toolName: "code_search",
        code: "missing_observable_events",
      }),
    );
  });
});
```

Create `src/shared/agentContextProfile.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createAgentContextProfile } from "./agentContextProfile";

describe("agent context profile", () => {
  it("prioritizes procedural memory for code tasks", () => {
    expect(createAgentContextProfile({ intent: "code" })).toMatchObject({
      memoryKinds: ["procedural", "semantic", "episodic"],
      hotTurnCount: 6,
    });
  });

  it("prioritizes semantic and episodic memory for research tasks", () => {
    expect(createAgentContextProfile({ intent: "research" }).memoryKinds).toEqual([
      "semantic",
      "episodic",
      "procedural",
    ]);
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
npm test -- src/shared/toolAciPolicy.test.ts src/shared/agentContextProfile.test.ts
```

Expected: FAIL because both modules do not exist.

- [ ] **Step 3: Implement Tool ACI policy**

Create `src/shared/toolAciPolicy.ts`:

```ts
import type { NativeToolDescriptor } from "./nativeCapabilities";
import type { AgentToolName } from "./toolPermissions";

export type ToolAciPolicyFindingCode =
  | "missing_permission_scope"
  | "missing_observable_events"
  | "missing_risk_level"
  | "ambiguous_description";

export type ToolAciPolicyFinding = {
  toolName: AgentToolName;
  code: ToolAciPolicyFindingCode;
  message: string;
};

export type ToolAciPolicyReport = {
  passed: boolean;
  findings: ToolAciPolicyFinding[];
};

export function evaluateToolAciPolicy(input: {
  nativeDescriptors: NativeToolDescriptor[];
}): ToolAciPolicyReport {
  const findings: ToolAciPolicyFinding[] = [];

  for (const descriptor of input.nativeDescriptors) {
    if (!descriptor.riskLevel) {
      findings.push({
        toolName: descriptor.id,
        code: "missing_risk_level",
        message: "Native descriptor must declare a risk level.",
      });
    }
    if (!descriptor.permissionScope) {
      findings.push({
        toolName: descriptor.id,
        code: "missing_permission_scope",
        message: "Native descriptor must declare a permission scope.",
      });
    }
    if (!descriptor.observableEvents.length) {
      findings.push({
        toolName: descriptor.id,
        code: "missing_observable_events",
        message: "Native descriptor must emit observable trajectory events.",
      });
    }
    if (/\bthing\b|\bstuff\b|\bdata\b/i.test(descriptor.description)) {
      findings.push({
        toolName: descriptor.id,
        code: "ambiguous_description",
        message: "Tool descriptions should use concrete parameter and artifact names.",
      });
    }
  }

  return { passed: findings.length === 0, findings };
}
```

- [ ] **Step 4: Implement context profile**

Create `src/shared/agentContextProfile.ts`:

```ts
import type { MemoryKind } from "./memory";

export type AgentContextLayer = "core" | "hot" | "cold";
export type AgentTaskIntent = "code" | "research" | "writing" | "memory" | "general";

export type AgentContextProfile = {
  intent: AgentTaskIntent;
  coreBudgetTokens: number;
  hotTurnCount: number;
  coldSummaryBudgetTokens: number;
  memoryKinds: MemoryKind[];
};

export function createAgentContextProfile(input: {
  intent: AgentTaskIntent;
}): AgentContextProfile {
  return {
    intent: input.intent,
    coreBudgetTokens: 2_000,
    hotTurnCount: input.intent === "memory" ? 4 : 6,
    coldSummaryBudgetTokens: 1_200,
    memoryKinds: selectMemoryKinds(input.intent),
  };
}

function selectMemoryKinds(intent: AgentTaskIntent): MemoryKind[] {
  if (intent === "code") {
    return ["procedural", "semantic", "episodic"];
  }
  if (intent === "research" || intent === "writing") {
    return ["semantic", "episodic", "procedural"];
  }
  if (intent === "memory") {
    return ["core", "session", "semantic", "episodic", "procedural"];
  }
  return ["procedural", "semantic"];
}
```

- [ ] **Step 5: Integrate reports into harness score output**

In `scripts/run-harness-score.mjs`, import `createAgentToolExecutor` from the built main bundle and derive descriptors from the registry:

```js
const { createAgentToolExecutor } = await import(
  "../dist-electron/main/agentToolExecutor.js"
);
const nativeDescriptors = createAgentToolExecutor()
  .getRegistry()
  .getNativeDescriptors();
```

Then include:

```js
const aci = evaluateToolAciPolicy({ nativeDescriptors });
```

Output:

```js
{
  score,
  eval: evalReport,
  adversarial,
  aci,
}
```

Do not fail the CLI on ACI findings during P3 unless `score.tone === "bad"`. This keeps the first sensor informational while tests enforce the intended shape.

- [ ] **Step 6: Verify green**

Run:

```bash
npm test -- src/shared/toolAciPolicy.test.ts src/shared/agentContextProfile.test.ts
npm run harness:score
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/toolAciPolicy.ts src/shared/toolAciPolicy.test.ts src/shared/agentContextProfile.ts src/shared/agentContextProfile.test.ts scripts/run-harness-score.mjs
git commit -m "feat: add aci and context harness sensors"
```

---

## Task 7: Documentation And Final Verification

**Files:**

- Modify: `docs/architecture/agent-learning-loop.md`
- Modify: `README.md`
- Modify: `.zerox/feature_list.json`
- Modify: `.zerox/progress.md`

- [ ] **Step 1: Update architecture docs**

Add an `Eval Candidate Loop` section to `docs/architecture/agent-learning-loop.md`:

```md
## Eval Candidate Loop

Real agent runs can also become reviewable eval candidates. This path mirrors learning review but affects verification instead of prompt memory:

agent run -> trajectory events -> eval candidate -> user accept/reject -> promoted local fixture -> future eval runs

Eval candidates are stored in `userData/config/agent-eval-candidates.json`. Promoted fixtures are stored in `userData/config/agent-promoted-eval-fixtures.json`. Promotion never mutates source-controlled built-in fixtures.
```

- [ ] **Step 2: Update README**

In the release/status section, add P3 planning language:

```md
P3 introduces the Agent Learning Harness Loop: real runs can become reviewed eval candidates, accepted candidates can be promoted into local regression fixtures, and harness score can include promoted and adversarial eval signals.
```

In commands, document:

```bash
BUILDING_AGENT_CONFIG_DIR=/path/to/config npm run eval:agent
BUILDING_AGENT_CONFIG_DIR=/path/to/config npm run harness:score
```

- [ ] **Step 3: Update `.zerox/feature_list.json`**

Add a P3 feature entry:

```json
{
  "id": "p3-agent-learning-harness-loop",
  "status": "planned",
  "priority": "high",
  "summary": "Reviewable eval candidates, local fixture promotion, adversarial eval, and ACI/context harness sensors.",
  "verification": [
    "npm run verify",
    "npm run harness:score",
    "npm run smoke:prod"
  ]
}
```

- [ ] **Step 4: Update `.zerox/progress.md`**

Add a dated entry with this implementation plan path and the verification commands that must pass before release.

- [ ] **Step 5: Run full verification**

Run:

```bash
npm run harness:check
npm run verify
npm run harness:score
npm run smoke:prod
```

Expected: all commands pass.

- [ ] **Step 6: Commit**

```bash
git add docs/architecture/agent-learning-loop.md README.md .zerox/feature_list.json .zerox/progress.md
git commit -m "docs: document p3 agent learning harness loop"
```

---

## Final Completion Criteria

- `npm run verify` passes.
- `npm run harness:score` includes normal eval, promoted eval input when configured, adversarial eval, pending eval count, and ACI report.
- Runs can generate an eval candidate from a terminal run.
- Eval Review can accept, reject, and promote candidates.
- Overview uses real pending eval candidate count.
- Local promoted fixtures are loaded by desktop and CLI eval paths.
- Documentation explains that promoted fixtures are local and source fixtures are not mutated automatically.

## Execution Choice

Recommended execution mode:

1. **Subagent-Driven** for Tasks 1-7, one task per subagent, with review between tasks.
2. **Inline Execution** only if subagents are unavailable; use `superpowers:executing-plans` and keep the commits/checkpoints exactly as written.
