# Agent Capability P2.2 Reflection And Episode Eval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first budgeted, evidence-based reflection layer and generate reviewable eval candidates from exported episodes.

**Architecture:** Keep P2.2 deterministic and local-first. Reflection is a shared pure policy that classifies failed tool observations and prevents identical retry loops; the runtime records `reflection_added` trajectory events before terminal failure. Episode export adds a reviewable eval-candidate artifact instead of silently mutating permanent fixtures.

**Tech Stack:** TypeScript shared contracts, Electron main process runtime/exporter, Vitest, existing trajectory/eval fixtures, README/.zerox harness docs.

---

## Scope

This plan implements the P2.2 slice from `docs/superpowers/specs/2026-06-10-agent-capability-p2-design.md`:

- `reflection_added` trajectory event type.
- Shared reflection policy and budget/fingerprint contracts.
- Runtime reflection evidence for failed native/tool calls.
- Duplicate retry prevention signal via deterministic argument fingerprints.
- Episode-to-eval candidate generation as an exported review artifact.
- Agent eval fixtures for reflection and eval-candidate generation.

This plan does not implement research citation tools or child-agent handoff; those remain P2.3/P2.4.

## File Structure

- `src/shared/agentReflection.ts`  
  Pure reflection contracts and `createToolFailureReflection()` classifier.

- `src/shared/agentReflection.test.ts`  
  Unit tests for classification, duplicate retry prevention, and budget exhaustion.

- `src/shared/agentTrajectory.ts`  
  Adds `reflection_added`.

- `src/main/agentRuntimeEngine.ts`  
  Appends `reflection_added` after failed tool/native observations and before throwing.

- `src/main/agentRuntimeEngine.test.ts`  
  Proves runtime records reflection evidence for failed `test_run`.

- `src/shared/agentEvalCandidate.ts`  
  Shared candidate type produced from episodes.

- `src/main/agentEvalCandidateGenerator.ts`  
  Converts run/checkpoint/trajectory into a reviewable eval candidate.

- `src/main/agentEvalCandidateGenerator.test.ts`  
  Tests candidate generation from reflection/native trajectory evidence.

- `src/main/agentEpisodeExporter.ts`  
  Adds `eval-candidate.json` to exported episode package.

- `src/main/agentEpisodeExporter.test.ts`  
  Updates package file-count and asserts the eval candidate artifact.

- `src/main/eval/agentEvalFixtures.ts` and `src/main/eval/agentEvalRunner.test.ts`  
  Adds reflection and eval-candidate contract fixtures.

- `.zerox/feature_list.json`, `.zerox/progress.md`, `README.md`  
  Documents P2.2 verification status.

---

## Task 1: Shared Reflection Contracts

**Files:**

- Create: `src/shared/agentReflection.ts`
- Create: `src/shared/agentReflection.test.ts`
- Modify: `src/shared/agentTrajectory.ts`

- [ ] **Step 1: Write failing reflection policy tests**

Create `src/shared/agentReflection.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createToolFailureReflection } from "./agentReflection";

describe("agent reflection policy", () => {
  it("classifies failed test runs as verification gaps with one retry", () => {
    const reflection = createToolFailureReflection({
      toolName: "test_run",
      args: { workspaceRoot: "/repo", command: "npm test -- src/a.test.ts" },
      error: "test_run failed with exit code 1.",
      errorDetails: { kind: "exit", stdout: "", stderr: "expected 1 to equal 2" },
      previousReflections: [],
      budget: { retryBudget: 1 },
    });

    expect(reflection).toMatchObject({
      failureClass: "verification_failed",
      suggestion: "retry",
      retryAllowed: true,
      citedEvidence: "test_run failed with exit code 1.",
    });
    expect(reflection.argumentFingerprint).toContain("test_run:");
  });

  it("blocks retrying identical failed tool arguments twice", () => {
    const first = createToolFailureReflection({
      toolName: "code_search",
      args: { workspaceRoot: "/repo", query: "missingSymbol" },
      error: "No matches.",
      previousReflections: [],
      budget: { retryBudget: 1 },
    });
    const second = createToolFailureReflection({
      toolName: "code_search",
      args: { workspaceRoot: "/repo", query: "missingSymbol" },
      error: "No matches.",
      previousReflections: [first],
      budget: { retryBudget: 1 },
    });

    expect(second).toMatchObject({
      failureClass: "duplicate_retry_blocked",
      suggestion: "abort",
      retryAllowed: false,
    });
  });

  it("does not broaden permission-denied failures automatically", () => {
    const reflection = createToolFailureReflection({
      toolName: "file_write",
      args: { path: "/private/out.md" },
      error: "file_write 被运行沙箱阻止：路径不在工作区或额外可写目录内。",
      previousReflections: [],
      budget: { retryBudget: 2 },
    });

    expect(reflection).toMatchObject({
      failureClass: "permission_denied",
      suggestion: "abort",
      retryAllowed: false,
    });
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- src/shared/agentReflection.test.ts
```

Expected: FAIL because `src/shared/agentReflection.ts` does not exist.

- [ ] **Step 3: Implement shared reflection contracts**

Create `src/shared/agentReflection.ts` with:

```ts
import type { AgentToolName } from "./toolPermissions";

export type AgentReflectionFailureClass =
  | "permission_denied"
  | "verification_failed"
  | "network_failed"
  | "tool_failed"
  | "duplicate_retry_blocked"
  | "budget_exhausted";

export type AgentReflectionSuggestion = "retry" | "skip" | "abort";

export type AgentRunBudget = {
  retryBudget: number;
};

export type AgentReflectionDecision = {
  failureClass: AgentReflectionFailureClass;
  suggestion: AgentReflectionSuggestion;
  retryAllowed: boolean;
  argumentFingerprint: string;
  citedEvidence: string;
  adjustedApproach: string;
};

export function createToolFailureReflection(input: {
  toolName: AgentToolName;
  args: Record<string, unknown>;
  error: string;
  errorDetails?: Record<string, unknown>;
  previousReflections: AgentReflectionDecision[];
  budget: AgentRunBudget;
}): AgentReflectionDecision {
  const argumentFingerprint = `${input.toolName}:${stableStringify(input.args)}`;
  if (
    input.previousReflections.some(
      (reflection) => reflection.argumentFingerprint === argumentFingerprint,
    )
  ) {
    return buildDecision(input, {
      argumentFingerprint,
      failureClass: "duplicate_retry_blocked",
      suggestion: "abort",
      retryAllowed: false,
      adjustedApproach:
        "Do not retry the exact same tool arguments again; change the query, path, command, or ask the user for direction.",
    });
  }

  if (input.previousReflections.length >= input.budget.retryBudget) {
    return buildDecision(input, {
      argumentFingerprint,
      failureClass: "budget_exhausted",
      suggestion: "abort",
      retryAllowed: false,
      adjustedApproach:
        "Retry budget is exhausted; return a partial result with the evidence already collected.",
    });
  }

  const failureClass = classifyFailure(input.toolName, input.error, input.errorDetails);
  const retryAllowed = failureClass !== "permission_denied";

  return buildDecision(input, {
    argumentFingerprint,
    failureClass,
    suggestion: retryAllowed ? "retry" : "abort",
    retryAllowed,
    adjustedApproach: retryAllowed
      ? "Retry once with changed arguments based on the cited observation."
      : "Stop and ask for approval or a narrower authorized target.",
  });
}

function classifyFailure(
  toolName: AgentToolName,
  error: string,
  errorDetails?: Record<string, unknown>,
): AgentReflectionFailureClass {
  const kind = String(errorDetails?.kind ?? "");
  if (/permission|权限|沙箱|workspace/i.test(error)) {
    return "permission_denied";
  }
  if (toolName === "test_run" || kind === "exit") {
    return "verification_failed";
  }
  if (/network|fetch|ENOTFOUND|ECONNRESET|timeout/i.test(error)) {
    return "network_failed";
  }
  return "tool_failed";
}

function buildDecision(
  input: { error: string },
  fields: Omit<AgentReflectionDecision, "citedEvidence">,
): AgentReflectionDecision {
  return {
    ...fields,
    citedEvidence: input.error,
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}
```

Modify `src/shared/agentTrajectory.ts` to add:

```ts
  | "reflection_added"
```

- [ ] **Step 4: Run reflection tests**

Run:

```bash
npm test -- src/shared/agentReflection.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/agentReflection.ts src/shared/agentReflection.test.ts src/shared/agentTrajectory.ts
git commit -m "feat: add reflection policy contracts"
```

## Task 2: Runtime Reflection Evidence

**Files:**

- Modify: `src/main/agentRuntimeEngine.ts`
- Modify: `src/main/agentRuntimeEngine.test.ts`

- [ ] **Step 1: Write failing runtime reflection test**

Add a test to `src/main/agentRuntimeEngine.test.ts`:

```ts
it("records reflection evidence before failing a test_run tool failure", async () => {
  const trajectoryEvents: AgentTrajectoryEvent[] = [];
  const engine = createAgentRuntimeEngine({
    taskStore: createTaskStore(createTask()),
    runStore: createMemoryRunStore(),
    executionStore: createMemoryExecutionStore([]),
    trajectoryStore: createMemoryTrajectoryStore(trajectoryEvents),
    resolveSkill: async () => createSkillRecord(),
    chatClient: createChatClient([
      toolCallResponse("test_run", {
        workspaceRoot: "/repo",
        command: "npm test -- src/failing.test.ts",
      }),
    ]),
    getModelProfile: async () => createModelProfile(),
    toolAuthorizationService: createAuthorizationService(true),
    toolExecutor: {
      async execute() {
        return {
          ok: false,
          error: "test_run failed with exit code 1.",
          errorDetails: { kind: "exit", stderr: "expected true to be false" },
        };
      },
    },
    createId: createSequentialId("reflection"),
    now: createSteppedClock("2026-06-07T00:00:00.000Z"),
  });

  await engine.startTask("task_123");

  expect(trajectoryEvents).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "reflection_added",
        payload: expect.objectContaining({
          toolName: "test_run",
          failureClass: "verification_failed",
          suggestion: "retry",
          retryAllowed: true,
        }),
      }),
    ]),
  );
});
```

- [ ] **Step 2: Run failing runtime test**

Run:

```bash
npm test -- src/main/agentRuntimeEngine.test.ts
```

Expected: FAIL because `reflection_added` is not emitted.

- [ ] **Step 3: Implement runtime reflection event**

In `src/main/agentRuntimeEngine.ts`, import `createToolFailureReflection` and keep a local `reflectionDecisions` array inside `runFromCheckpoint()`. After `toolExecutor.execute()` returns a failed result, call:

```ts
const reflection = createToolFailureReflection({
  toolName,
  args,
  error: result.error,
  errorDetails: result.errorDetails,
  previousReflections: reflectionDecisions,
  budget: { retryBudget: 1 },
});
reflectionDecisions.push(reflection);
await appendTrajectory(current.runId, "reflection_added", {
  toolCallId: toolCall.id,
  toolName,
  ...reflection,
}, {
  containsApiKey: false,
  containsFileContent: false,
  containsUserText: false,
}, current.runContext);
```

- [ ] **Step 4: Run runtime tests**

Run:

```bash
npm test -- src/main/agentRuntimeEngine.test.ts src/shared/agentReflection.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/agentRuntimeEngine.ts src/main/agentRuntimeEngine.test.ts
git commit -m "feat: record runtime reflection evidence"
```

## Task 3: Episode Eval Candidate Artifact

**Files:**

- Create: `src/shared/agentEvalCandidate.ts`
- Create: `src/main/agentEvalCandidateGenerator.ts`
- Create: `src/main/agentEvalCandidateGenerator.test.ts`
- Modify: `src/main/agentEpisodeExporter.ts`
- Modify: `src/main/agentEpisodeExporter.test.ts`

- [ ] **Step 1: Write failing eval candidate generator test**

Create `src/main/agentEvalCandidateGenerator.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createEvalCandidateFromEpisode } from "./agentEvalCandidateGenerator";
import type { AgentRunRecord } from "../shared/agentRuns";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";

describe("agent eval candidate generator", () => {
  it("creates a reviewable fixture candidate from native and reflection evidence", () => {
    const run: AgentRunRecord = {
      id: "run_eval",
      taskId: "task_eval",
      taskName: "Fix failing test",
      skillName: "code-engineering",
      status: "failed",
      summary: "test_run failed after reflection.",
      events: [],
      startedAt: "2026-06-10T00:00:00.000Z",
      finishedAt: "2026-06-10T00:01:00.000Z",
      failureClass: "tool_execution_failed",
    };
    const trajectory = createEvents("run_eval", [
      ["tool_call", { toolName: "test_run" }],
      ["native_tool_invocation", { toolName: "test_run", nativeKind: "test" }],
      ["native_tool_observation", { toolName: "test_run", ok: false }],
      ["tool_result", { toolName: "test_run", ok: false }],
      ["reflection_added", { toolName: "test_run", failureClass: "verification_failed" }],
      ["failure_classified", { failureClass: "tool_execution_failed" }],
    ]);

    const candidate = createEvalCandidateFromEpisode({
      run,
      trajectory,
      createdAt: "2026-06-10T00:02:00.000Z",
    });

    expect(candidate).toMatchObject({
      id: "eval_candidate_run_eval",
      status: "pending_review",
      sourceRunId: "run_eval",
      fixture: {
        id: "episode-run-eval",
        requiredEventTypes: [
          "tool_call",
          "tool_result",
          "reflection_added",
          "failure_classified",
        ],
      },
    });
    expect(candidate.fixture.assertions).toContainEqual({
      type: "reflection_added",
      payload: { failureClass: "verification_failed" },
      after: "tool_result",
    });
  });
});

function createEvents(
  runId: string,
  entries: Array<[AgentTrajectoryEvent["type"], Record<string, unknown>]>,
): AgentTrajectoryEvent[] {
  return entries.map(([type, payload], index) => ({
    id: `${runId}_${index + 1}`,
    runId,
    type,
    sequence: index + 1,
    payload,
    redaction: {
      containsApiKey: false,
      containsFileContent: false,
      containsUserText: false,
    },
    createdAt: "2026-06-10T00:00:00.000Z",
  }));
}
```

- [ ] **Step 2: Run failing generator test**

Run:

```bash
npm test -- src/main/agentEvalCandidateGenerator.test.ts
```

Expected: FAIL because generator files do not exist.

- [ ] **Step 3: Implement shared candidate type and generator**

Create `src/shared/agentEvalCandidate.ts`:

```ts
import type { AgentEvalFixture } from "../main/eval/agentEvalFixtures";

export type AgentEvalCandidateStatus = "pending_review" | "accepted" | "rejected";

export type AgentEvalCandidate = {
  id: string;
  sourceRunId: string;
  status: AgentEvalCandidateStatus;
  rationale: string;
  fixture: AgentEvalFixture;
  createdAt: string;
};
```

Create `src/main/agentEvalCandidateGenerator.ts`:

```ts
import type { AgentEvalCandidate } from "../shared/agentEvalCandidate";
import type { AgentRunRecord } from "../shared/agentRuns";
import type { AgentTrajectoryEvent, AgentTrajectoryEventType } from "../shared/agentTrajectory";

export function createEvalCandidateFromEpisode(input: {
  run: AgentRunRecord;
  trajectory: AgentTrajectoryEvent[];
  createdAt: string;
}): AgentEvalCandidate {
  const requiredEventTypes = selectRequiredEventTypes(input.trajectory);
  const reflection = input.trajectory.find((event) => event.type === "reflection_added");
  const assertions = reflection
    ? [
        {
          type: "reflection_added" as const,
          payload: { failureClass: String(reflection.payload.failureClass ?? "") },
          after: "tool_result" as const,
        },
      ]
    : [];

  return {
    id: `eval_candidate_${input.run.id}`,
    sourceRunId: input.run.id,
    status: "pending_review",
    rationale:
      "Generated from an exported episode. Review before promoting to permanent eval fixtures.",
    createdAt: input.createdAt,
    fixture: {
      id: `episode-${slugify(input.run.id)}`,
      description: `Episode candidate from run ${input.run.id}: ${input.run.taskName}`,
      events: input.trajectory,
      requiredEventTypes,
      ...(assertions.length ? { assertions } : {}),
      recoverabilityRequired: input.run.status !== "succeeded",
    },
  };
}

function selectRequiredEventTypes(
  trajectory: AgentTrajectoryEvent[],
): AgentTrajectoryEventType[] {
  const ordered: AgentTrajectoryEventType[] = [
    "tool_call",
    "native_tool_invocation",
    "native_tool_observation",
    "tool_result",
    "reflection_added",
    "failure_classified",
    "final_summary",
  ];
  const available = new Set(trajectory.map((event) => event.type));
  return ordered.filter((type) => available.has(type));
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
```

- [ ] **Step 4: Add eval candidate file to episode package**

In `src/main/agentEpisodeExporter.ts`, import `createEvalCandidateFromEpisode`, update `fileCount` to 7, and add:

```ts
"eval-candidate.json": `${JSON.stringify(
  createEvalCandidateFromEpisode({
    run: input.run,
    trajectory: input.trajectory,
    createdAt: input.exportedAt,
  }),
  null,
  2,
)}\n`,
```

- [ ] **Step 5: Update exporter tests**

Update `src/main/agentEpisodeExporter.test.ts` to expect `eval-candidate.json` in package files and metadata `fileCount: 7`.

- [ ] **Step 6: Run candidate/exporter tests**

Run:

```bash
npm test -- src/main/agentEvalCandidateGenerator.test.ts src/main/agentEpisodeExporter.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/agentEvalCandidate.ts src/main/agentEvalCandidateGenerator.ts src/main/agentEvalCandidateGenerator.test.ts src/main/agentEpisodeExporter.ts src/main/agentEpisodeExporter.test.ts
git commit -m "feat: generate eval candidates from episodes"
```

## Task 4: P2.2 Eval Fixtures, Docs, And Verification

**Files:**

- Modify: `src/main/eval/agentEvalFixtures.ts`
- Modify: `src/main/eval/agentEvalRunner.test.ts`
- Modify: `.zerox/feature_list.json`
- Modify: `.zerox/progress.md`
- Modify: `README.md`

- [ ] **Step 1: Add failing eval fixture expectations**

In `src/main/eval/agentEvalRunner.test.ts`, update deterministic totals after adding two fixtures:

```ts
expect(report).toMatchObject({
  total: 10,
  passed: 10,
  failed: 0,
  passRate: 1,
  recoverabilityRate: 1,
});
```

Also assert fixture ids include:

```ts
"reflection-after-test-failure",
"episode-eval-candidate",
```

- [ ] **Step 2: Add fixtures**

Add to `createAgentEvalFixtures()`:

```ts
{
  id: "reflection-after-test-failure",
  description: "A failed test_run records reflection before failure classification.",
  events: createEvents("reflection-after-test-failure", [
    ["tool_call", { toolName: "test_run" }],
    ["tool_result", { toolName: "test_run", ok: false }],
    ["reflection_added", { toolName: "test_run", failureClass: "verification_failed" }],
    ["failure_classified", { failureClass: "tool_execution_failed" }],
  ]),
  requiredEventTypes: ["tool_call", "tool_result", "reflection_added", "failure_classified"],
  assertions: [
    { type: "reflection_added", payload: { failureClass: "verification_failed" }, after: "tool_result" },
  ],
  recoverabilityRequired: true,
},
{
  id: "episode-eval-candidate",
  description: "A completed episode records eval candidate artifact generation.",
  events: createEvents("episode-eval-candidate", [
    ["tool_call", { toolName: "code_search" }],
    ["tool_result", { toolName: "code_search", ok: true }],
    ["artifact_created", { artifactType: "eval_candidate" }],
    ["final_summary", { status: "succeeded" }],
  ]),
  requiredEventTypes: ["tool_call", "tool_result", "artifact_created", "final_summary"],
  assertions: [
    { type: "artifact_created", payload: { artifactType: "eval_candidate" }, after: "tool_result" },
  ],
},
```

- [ ] **Step 3: Run eval tests and script**

Run:

```bash
npm test -- src/main/eval/agentEvalRunner.test.ts
npm run build
node scripts/run-agent-evals.mjs
```

Expected: PASS, agent eval total 10/10.

- [ ] **Step 4: Update docs**

Update:

- `.zerox/feature_list.json`: add `P2.2-reflection-episode-eval`.
- `.zerox/progress.md`: record P2.2 focused checks.
- `README.md`: add P2.2 reflection/eval-candidate line to Recently shipped and testing paragraph.

- [ ] **Step 5: Run final focused checks**

Run:

```bash
npm test -- src/shared/agentReflection.test.ts src/main/agentRuntimeEngine.test.ts src/main/agentEvalCandidateGenerator.test.ts src/main/agentEpisodeExporter.test.ts src/main/eval/agentEvalRunner.test.ts src/shared/readme.test.ts
npm run harness:check
npm run verify
npm run harness:score
npm run smoke:prod
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/agentReflection.ts src/shared/agentReflection.test.ts src/shared/agentTrajectory.ts src/main/agentRuntimeEngine.ts src/main/agentRuntimeEngine.test.ts src/shared/agentEvalCandidate.ts src/main/agentEvalCandidateGenerator.ts src/main/agentEvalCandidateGenerator.test.ts src/main/agentEpisodeExporter.ts src/main/agentEpisodeExporter.test.ts src/main/eval/agentEvalFixtures.ts src/main/eval/agentEvalRunner.test.ts .zerox/feature_list.json .zerox/progress.md README.md
git commit -m "feat: add reflection and episode eval candidates"
```

## Self-Review

- Spec coverage: This plan covers P2.2 reflection events, duplicate retry prevention, retry budget policy, and episode-to-eval candidate generation. Research tools and child handoff remain explicitly deferred to P2.3/P2.4.
- Placeholder scan: No task contains TBD/TODO placeholders. Every implementation task has concrete paths, commands, and expected results.
- Type consistency: `reflection_added`, `AgentReflectionDecision`, `AgentEvalCandidate`, `createToolFailureReflection`, and `createEvalCandidateFromEpisode` use the same names across tasks.
