# Harness Engineering Iteration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Zerox Agent into a more complete local AI Agent Harness with repo-local operating files, faithful runtime state transitions, stronger workspace governance, chat/task evidence parity, episode exports, contract evals, harness scoring, and reviewed learning improvements.

**Architecture:** Keep the current Electron + TypeScript + local JSON/JSONL storage architecture. Add a thin repo-local operating harness at the repository root, then harden the existing runtime and evidence stores rather than replacing them. Scheduled task runtime remains the source of truth; chat mode gains evidence parity through an adapter before any deeper merge.

**Tech Stack:** Electron main process, React renderer, TypeScript, Vitest, Vite, local JSON/JSONL stores, existing `AgentRuntimeEngine`, `AgentTrajectoryStore`, `AgentExecutionStore`, `ToolAuthorizationService`, `MemoryStore`, and `LearningReviewPanel`.

---

## File Structure

Create:

- `AGENTS.md`: compact repo map and operating rules for coding agents.
- `init.sh`: deterministic agent session bootstrap command.
- `.zerox/feature_list.json`: machine-readable scope list for this harness iteration.
- `.zerox/progress.md`: persistent handoff and verification log.
- `.zerox/golden-principles.md`: project-specific harness invariants.
- `scripts/check-harness-state.mjs`: verifies harness files and required npm scripts.
- `src/main/chatAgentEvidence.ts`: emits trajectory/checkpoint-like evidence for chat tool runs.
- `src/main/agentEpisodeExporter.ts`: builds deterministic episode packages.
- `src/shared/harnessScore.ts`: computes local seven-category harness score.

Modify:

- `package.json`: add `harness:check`, `episode:export`, and `harness:score` scripts.
- `src/shared/packageScripts.test.ts`: assert new scripts exist.
- `src/main/agentRuntimeEngine.ts`: step state updates, approval checkpoints, signal propagation.
- `src/main/agentRuntimeEngine.test.ts`: runtime state, approval, signal tests.
- `src/main/toolAuthorizationService.ts`: approval lifecycle callbacks.
- `src/main/toolAuthorizationService.test.ts`: approval callback tests.
- `src/shared/toolPermissions.ts`: enforce `workspace_only` shell paths.
- `src/shared/toolPermissions.test.ts`: shell workspace path tests.
- `src/main/chatService.ts`: route chat tool evidence through `chatAgentEvidence`.
- `src/main/chatService.test.ts`: chat trajectory/evidence tests.
- `src/main/eval/agentEvalFixtures.ts`: add payload/order assertions.
- `src/main/eval/agentEvalRunner.ts`: enforce contract assertions.
- `src/main/eval/agentEvalRunner.test.ts`: contract eval tests.
- `src/main/agentLearningExtractor.ts`: mine repeated failures and evaluator findings.
- `src/main/agentLearningExtractor.test.ts`: learning extraction tests.
- `src/renderer/components/OverviewPanel.tsx`: show harness score.
- `README.md`: link to repo-local harness and new verification commands.

---

## Task 1: Repo-Local Operating Harness

**Files:**

- Create: `AGENTS.md`
- Create: `init.sh`
- Create: `.zerox/feature_list.json`
- Create: `.zerox/progress.md`
- Create: `.zerox/golden-principles.md`
- Create: `scripts/check-harness-state.mjs`
- Modify: `package.json`
- Modify: `src/shared/packageScripts.test.ts`

- [ ] **Step 1: Write the failing package script test**

Add these expectations to `src/shared/packageScripts.test.ts`:

```ts
it("exposes harness engineering commands", () => {
  expect(packageJson.scripts).toMatchObject({
    "harness:check": "node scripts/check-harness-state.mjs",
    "harness:score": "node scripts/run-harness-score.mjs",
    "episode:export": "node scripts/export-agent-episode.mjs",
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm test -- src/shared/packageScripts.test.ts
```

Expected: FAIL because `harness:check`, `harness:score`, and `episode:export` do not exist yet.

- [ ] **Step 3: Add package scripts**

Modify `package.json` scripts:

```json
{
  "harness:check": "node scripts/check-harness-state.mjs",
  "harness:score": "node scripts/run-harness-score.mjs",
  "episode:export": "node scripts/export-agent-episode.mjs"
}
```

Keep existing scripts unchanged.

- [ ] **Step 4: Create the harness checker**

Create `scripts/check-harness-state.mjs`:

```js
import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const requiredFiles = [
  "AGENTS.md",
  "init.sh",
  ".zerox/feature_list.json",
  ".zerox/progress.md",
  ".zerox/golden-principles.md",
  "docs/superpowers/specs/2026-06-09-harness-engineering-iteration-spec.md",
  "docs/superpowers/plans/2026-06-09-harness-engineering-iteration.md",
];

const requiredScripts = [
  "test",
  "build",
  "verify",
  "smoke:prod",
  "eval:agent",
  "eval:memory",
  "harness:check",
];

const missing = [];
for (const file of requiredFiles) {
  try {
    await access(path.join(root, file));
  } catch {
    missing.push(file);
  }
}

const packageJson = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
for (const scriptName of requiredScripts) {
  if (!packageJson.scripts?.[scriptName]) {
    missing.push(`package.json scripts.${scriptName}`);
  }
}

if (missing.length) {
  console.error("Harness check failed:");
  for (const item of missing) console.error(`- ${item}`);
  process.exit(1);
}

console.log("Harness check passed.");
```

- [ ] **Step 5: Create `AGENTS.md`**

Create `AGENTS.md`:

```markdown
# Zerox Agent Operating Guide

## Mission

Zerox Agent is a local-first desktop control plane for permissioned, observable, recoverable agent runs.

## Fast Start

1. Run `./init.sh`.
2. Read `.zerox/feature_list.json`.
3. Pick exactly one unfinished feature.
4. Before editing, inspect the files named by that feature.
5. After editing, run the feature verification command plus `npm run harness:check`.
6. Update `.zerox/progress.md` with evidence.

## Core Commands

- `npm run harness:check`
- `npm test`
- `npm run build`
- `npm run verify`
- `npm run smoke:prod`

## Boundaries

- Preserve local-first trust, explicit permissions, observable trajectories, and reviewed learning.
- Do not add cloud workers or unreviewed self-modification in this iteration.
- Do not bypass `ToolAuthorizationService` or workspace sandbox checks.
- Prefer typed shared models and focused tests before runtime behavior changes.

## Done Criteria

- Focused tests pass.
- `npm run verify` passes.
- `npm run smoke:prod` passes for UI/runtime-affecting changes.
- `.zerox/progress.md` records changed files and command evidence.
```

- [ ] **Step 6: Create `init.sh`**

Create `init.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "Zerox Agent harness init"
node --version
npm --version
npm run harness:check
npm test -- src/shared/packageScripts.test.ts
```

Then run:

```bash
chmod +x init.sh
```

- [ ] **Step 7: Create `.zerox/feature_list.json`**

Create `.zerox/feature_list.json`:

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-06-09T00:00:00.000Z",
  "features": [
    {
      "id": "P0-repo-local-harness",
      "priority": 0,
      "status": "planned",
      "title": "Repo-local operating harness",
      "definitionOfDone": [
        "AGENTS.md exists",
        "init.sh exists and runs harness checks",
        "npm run harness:check passes"
      ],
      "verification": ["npm run harness:check", "npm test -- src/shared/packageScripts.test.ts"]
    },
    {
      "id": "P1-runtime-state-fidelity",
      "priority": 1,
      "status": "planned",
      "title": "Runtime state fidelity",
      "definitionOfDone": [
        "Step running/completed states are persisted",
        "Approval waiting state is checkpointed",
        "Abort signals reach tool execution"
      ],
      "verification": ["npm test -- src/main/agentRuntimeEngine.test.ts src/main/toolAuthorizationService.test.ts"]
    },
    {
      "id": "P1-shell-workspace-governance",
      "priority": 2,
      "status": "planned",
      "title": "Shell workspace governance",
      "definitionOfDone": [
        "workspace_only shell denies outside-workspace path arguments",
        "workspace denials emit evidence"
      ],
      "verification": ["npm test -- src/shared/toolPermissions.test.ts src/main/agentRuntimeEngine.test.ts"]
    }
  ]
}
```

- [ ] **Step 8: Create progress and golden principles files**

Create `.zerox/progress.md`:

```markdown
# Zerox Harness Progress

## 2026-06-09 Baseline

- `npm run verify` passed: 76 test files, 333 tests, build, agent evals, memory evals.
- `npm run smoke:prod` passed: production Electron startup rendered agent chat UI.
- Current focus: make the repository itself easier for fresh agents to operate safely.
```

Create `.zerox/golden-principles.md`:

```markdown
# Zerox Golden Principles

1. Local-first data is the product boundary.
2. Tool access must be permissioned, audited, and workspace-scoped.
3. Agent runs must produce durable evidence before they affect learning.
4. Learning changes future behavior only after user review.
5. Runtime state types and runtime behavior must match.
6. Verification must be deterministic before it becomes inferential.
7. Documentation is useful only when a fresh agent can act on it.
```

- [ ] **Step 9: Run checks**

Run:

```bash
npm run harness:check
npm test -- src/shared/packageScripts.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add AGENTS.md init.sh .zerox package.json src/shared/packageScripts.test.ts scripts/check-harness-state.mjs
git commit -m "chore: add repo-local harness operating files"
```

---

## Task 2: Runtime State Fidelity

**Files:**

- Modify: `src/main/agentRuntimeEngine.ts`
- Modify: `src/main/toolAuthorizationService.ts`
- Test: `src/main/agentRuntimeEngine.test.ts`
- Test: `src/main/toolAuthorizationService.test.ts`

- [ ] **Step 1: Add failing success-state test**

Add to `src/main/agentRuntimeEngine.test.ts`:

```ts
it("marks the current runtime step completed when the run succeeds", async () => {
  const harness = createRuntimeHarness({
    chatResponses: [{ content: "done", toolCalls: [], finishReason: "stop" }],
  });

  const result = await harness.engine.startTask("task_123");

  expect(result.ok).toBe(true);
  const checkpoint = await harness.executionStore.get(
    result.ok ? result.run.id : "",
  );
  expect(checkpoint?.status).toBe("succeeded");
  expect(checkpoint?.steps[0]).toMatchObject({
    state: "completed",
    attempts: 1,
  });
});
```

- [ ] **Step 2: Add failing signal propagation test**

Add to `src/main/agentRuntimeEngine.test.ts`:

```ts
it("passes the abort signal to runtime tool execution", async () => {
  const controller = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  const harness = createRuntimeHarness({
    chatResponses: [
      {
        content: "",
        finishReason: "tool_calls",
        toolCalls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "shell_exec", arguments: "{\"command\":\"npm test\"}" },
          },
        ],
      },
    ],
    toolExecutor: {
      getRegistry: () => createTestToolRegistry(),
      hasTool: () => true,
      execute: async (_request, options) => {
        receivedSignal = options?.signal;
        controller.abort("pause");
        return { ok: false, error: "stopped" };
      },
    },
  });

  await harness.engine.startTask("task_123", { signal: controller.signal });

  expect(receivedSignal).toBe(controller.signal);
});
```

- [ ] **Step 3: Add approval lifecycle callback test**

Add to `src/main/toolAuthorizationService.test.ts`:

```ts
it("notifies callers when user approval is requested and resolved", async () => {
  const events: string[] = [];
  const service = createToolAuthorizationService({
    taskStore,
    auditLog,
    requestUserApproval: async () => ({ approved: true, reason: "approved" }),
  });

  await service.authorize(
    "task_1",
    { toolName: "file_write", args: { path: "/outside/report.md" } },
    {
      onApprovalRequested: async () => events.push("requested"),
      onApprovalResolved: async (result) =>
        events.push(result.approved ? "approved" : "rejected"),
    },
  );

  expect(events).toEqual(["requested", "approved"]);
});
```

- [ ] **Step 4: Extend authorization options**

Modify `src/main/toolAuthorizationService.ts`:

```ts
export type ToolAuthorizationOptions = {
  runContext?: AgentRunContext;
  onApprovalRequested?: (request: ToolUserApprovalRequest) => Promise<void>;
  onApprovalResolved?: (result: ToolUserApprovalResult) => Promise<void>;
};
```

Before `requestUserApproval` is called:

```ts
const approvalRequest = {
  taskId: task.id,
  taskName: task.name,
  request,
  deniedReason: decision.reason,
};
await authorizeOptions?.onApprovalRequested?.(approvalRequest);
const approval = await options.requestUserApproval(approvalRequest);
await authorizeOptions?.onApprovalResolved?.(approval);
```

- [ ] **Step 5: Add runtime step update helpers**

Add helpers to `src/main/agentRuntimeEngine.ts`:

```ts
function markCurrentStepRunning(
  steps: AgentExecutionStep[],
  currentStepId: string | undefined,
  nowIso: string,
): AgentExecutionStep[] {
  return steps.map((step) =>
    step.id === currentStepId
      ? {
          ...step,
          state: "running",
          attempts: step.attempts + 1,
          startedAt: step.startedAt ?? nowIso,
        }
      : step,
  );
}

function markCurrentStepCompleted(
  steps: AgentExecutionStep[],
  currentStepId: string | undefined,
  nowIso: string,
): AgentExecutionStep[] {
  return steps.map((step) =>
    step.id === currentStepId
      ? {
          ...step,
          state: "completed",
          finishedAt: nowIso,
        }
      : step,
  );
}
```

- [ ] **Step 6: Use the helpers during runtime execution**

At the start of each model turn in `runFromCheckpoint`, save the running step state:

```ts
current = await saveCheckpoint(current, "running", {
  steps: markCurrentStepRunning(
    current.steps,
    current.currentStepId,
    now().toISOString(),
  ),
});
```

Before successful `finishRun`, set the completed step:

```ts
current = {
  ...current,
  messages: messages.map(toExecutionMessage),
  toolCallCount,
  steps: markCurrentStepCompleted(
    current.steps,
    current.currentStepId,
    now().toISOString(),
  ),
};
```

- [ ] **Step 7: Save approval waiting checkpoints**

When calling `toolAuthorizationService.authorize` in `AgentRuntimeEngine`, pass lifecycle callbacks:

```ts
const auth = await options.toolAuthorizationService.authorize(
  task.id,
  { toolName, args },
  {
    runContext: current.runContext,
    onApprovalRequested: async () => {
      current = await saveCheckpoint(current, "waiting_for_approval");
    },
    onApprovalResolved: async () => {
      current = await saveCheckpoint(current, "running");
    },
  },
);
```

- [ ] **Step 8: Pass abort signal to tools**

Change runtime tool execution:

```ts
const result = await options.toolExecutor.execute(
  { toolName, args },
  {
    runContext: current.runContext,
    ...(signal ? { signal } : {}),
  },
);
```

Also update compatibility `AgentRunnerService.executeToolCalls`:

```ts
const result = await options.toolExecutor.execute(
  { toolName: authResult.toolName as never, args: authResult.args },
  signal ? { signal } : undefined,
);
```

- [ ] **Step 9: Run focused tests**

Run:

```bash
npm test -- src/main/agentRuntimeEngine.test.ts src/main/toolAuthorizationService.test.ts src/main/agentRunnerService.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/main/agentRuntimeEngine.ts src/main/agentRuntimeEngine.test.ts src/main/toolAuthorizationService.ts src/main/toolAuthorizationService.test.ts src/main/agentRunnerService.ts src/main/agentRunnerService.test.ts
git commit -m "fix: align runtime checkpoints with execution state"
```

---

## Task 3: Shell Workspace Governance

**Files:**

- Modify: `src/shared/toolPermissions.ts`
- Test: `src/shared/toolPermissions.test.ts`
- Modify: `src/main/agentRuntimeEngine.ts`
- Test: `src/main/agentRuntimeEngine.test.ts`

- [ ] **Step 1: Add failing shell workspace tests**

Add to `src/shared/toolPermissions.test.ts`:

```ts
it("denies workspace_only shell commands that mention outside absolute paths", () => {
  const decision = authorizeToolCallWithinRunContext(
    {
      files: { read: [], write: [] },
      web: { search: false, fetchDomains: [] },
      shell: { commands: ["cat {{target}}"] },
      memory: { read: false, write: false },
    },
    { toolName: "shell_exec", args: { command: "cat /etc/passwd" } },
    buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: "/tmp/zerox-workspace",
      sandbox: {
        mode: "workspace_write",
        network: "task_policy",
        shell: "workspace_only",
        allowWorkspaceEscape: false,
        extraReadRoots: [],
        extraWriteRoots: [],
      },
    }),
  );

  expect(decision.allowed).toBe(false);
  expect(decision.reason).toContain("workspace_only");
});
```

- [ ] **Step 2: Implement path-token extraction**

Add to `src/shared/toolPermissions.ts`:

```ts
function extractPathLikeShellTokens(command: string): string[] {
  const matches = command.match(/(?:"[^"]+"|'[^']+'|[^\s]+)/g) ?? [];
  return matches
    .map((token) => token.replace(/^["']|["']$/g, ""))
    .filter((token) => token.startsWith("/") || token.startsWith("~/"));
}
```

- [ ] **Step 3: Enforce `workspace_only`**

Inside `authorizeToolCallWithinRunContext`, after shell disabled check:

```ts
if (
  request.toolName === "shell_exec" &&
  runContext.sandbox.shell === "workspace_only"
) {
  const command = String(request.args.command ?? "");
  const outsidePath = extractPathLikeShellTokens(command).find(
    (token) => !isPathInsideRunContext(token, runContext, "read"),
  );
  if (outsidePath) {
    return deny(
      `shell_exec 被 workspace_only 沙箱阻止：路径 ${outsidePath} 不在工作区或额外可读目录内。`,
    );
  }
}
```

- [ ] **Step 4: Emit workspace denial evidence for shell**

In `AgentRuntimeEngine`, when authorization denial reason contains `workspace_only` or `运行沙箱阻止`, keep using `workspace_escape_denied`:

```ts
if (/运行沙箱阻止|workspace|workspace_only/i.test(reason)) {
  await appendTrajectory(current.runId, "workspace_escape_denied", {
    toolCallId: toolCall.id,
    toolName,
    reason,
    ...(typeof args.command === "string" ? { command: args.command } : {}),
    ...(typeof args.path === "string" ? { path: args.path } : {}),
  }, {
    containsApiKey: false,
    containsFileContent: false,
    containsUserText: false,
  }, current.runContext);
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm test -- src/shared/toolPermissions.test.ts src/main/agentRuntimeEngine.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/toolPermissions.ts src/shared/toolPermissions.test.ts src/main/agentRuntimeEngine.ts src/main/agentRuntimeEngine.test.ts
git commit -m "fix: enforce workspace-only shell paths"
```

---

## Task 4: Chat Tool Evidence Bridge

**Files:**

- Create: `src/main/chatAgentEvidence.ts`
- Modify: `src/main/chatService.ts`
- Test: `src/main/chatService.test.ts`
- Modify: `src/shared/chat.ts`

- [ ] **Step 1: Add failing chat evidence test**

Add to `src/main/chatService.test.ts`:

```ts
it("emits trajectory evidence for chat tool runs", async () => {
  const trajectoryStore = createInMemoryTrajectoryStore();
  const service = createChatService({
    ...createChatHarnessOptions(),
    trajectoryStore,
  });

  const result = await service.sendMessage({ message: "读取下载目录" });

  expect(result.ok).toBe(true);
  expect(result.ok ? result.agentStatus?.runId : undefined).toBeTruthy();
  const events = await trajectoryStore.list(
    result.ok ? result.agentStatus!.runId! : "",
  );
  expect(events.map((event) => event.type)).toEqual(
    expect.arrayContaining(["model_request", "tool_call", "tool_result", "final_summary"]),
  );
});
```

- [ ] **Step 2: Extend chat agent status**

Modify `src/shared/chat.ts`:

```ts
export type ChatAgentStatus = {
  state: "completed" | "paused" | "failed" | "canceled";
  runId?: string;
  reason?: string;
  maxTurns?: number;
  toolCallsExecuted?: number;
  message?: string;
};
```

- [ ] **Step 3: Create chat evidence adapter**

Create `src/main/chatAgentEvidence.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { AgentTrajectoryStore } from "./agentTrajectoryStore";
import type { AgentTrajectoryEventType } from "../shared/agentTrajectory";

export type ChatAgentEvidenceRecorder = {
  runId: string;
  append(type: AgentTrajectoryEventType, payload: Record<string, unknown>): Promise<void>;
};

export function createChatAgentEvidenceRecorder(options: {
  trajectoryStore?: AgentTrajectoryStore;
  createId?: () => string;
  now?: () => Date;
}): ChatAgentEvidenceRecorder {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const runId = createId();
  let sequence = 0;

  return {
    runId,
    async append(type, payload) {
      if (!options.trajectoryStore) return;
      sequence += 1;
      await options.trajectoryStore.append(runId, {
        id: createId(),
        runId,
        type,
        sequence,
        payload,
        redaction: {
          containsApiKey: false,
          containsFileContent: type === "tool_result",
          containsUserText: type === "model_request" || type === "model_response",
        },
        createdAt: now().toISOString(),
      });
    },
  };
}
```

- [ ] **Step 4: Wire recorder into chat service**

Add optional `trajectoryStore` to `createChatService` options. Before `runAgentLoop`, create a recorder:

```ts
const evidence = createChatAgentEvidenceRecorder({
  trajectoryStore: options.trajectoryStore,
  createId,
  now: options.now,
});
```

Use callbacks:

```ts
onTurn(turn, phase) {
  void evidence.append("model_request", { turn, phase });
  // keep existing status emission
},
onToolCall(toolName, args) {
  void evidence.append("tool_call", { toolName, args });
  // keep existing status emission
},
onToolResult(toolName, ok) {
  void evidence.append("tool_result", { toolName, ok });
  // keep existing status emission
}
```

After completion:

```ts
await evidence.append("final_summary", {
  status: loopResult.status,
  toolCallsExecuted: loopResult.toolCallsExecuted,
});
agentStatus = {
  ...agentStatus,
  runId: evidence.runId,
};
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm test -- src/main/chatService.test.ts src/shared/chat.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/chatAgentEvidence.ts src/main/chatService.ts src/main/chatService.test.ts src/shared/chat.ts src/shared/chat.test.ts
git commit -m "feat: emit trajectory evidence for chat tool runs"
```

---

## Task 5: Episode Export And Contract Evals

**Files:**

- Create: `src/main/agentEpisodeExporter.ts`
- Test: `src/main/agentEpisodeExporter.test.ts`
- Create: `scripts/export-agent-episode.mjs`
- Modify: `src/main/eval/agentEvalFixtures.ts`
- Modify: `src/main/eval/agentEvalRunner.ts`
- Test: `src/main/eval/agentEvalRunner.test.ts`

- [ ] **Step 1: Write episode exporter test**

Create `src/main/agentEpisodeExporter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createAgentEpisodePackage } from "./agentEpisodeExporter";

describe("createAgentEpisodePackage", () => {
  it("packages run, checkpoint, trajectory, learning, and verification evidence", () => {
    const episode = createAgentEpisodePackage({
      run: { id: "run_1", status: "succeeded", summary: "done" } as never,
      checkpoint: { runId: "run_1", status: "succeeded" } as never,
      trajectory: [
        { id: "event_1", runId: "run_1", type: "final_summary", sequence: 1 } as never,
      ],
      learningCandidates: [],
      verification: { passed: true, checks: ["final_summary"] },
      exportedAt: "2026-06-09T00:00:00.000Z",
    });

    expect(Object.keys(episode.files).sort()).toEqual([
      "checkpoint.json",
      "learning-candidates.json",
      "metadata.json",
      "run.json",
      "trajectory.jsonl",
      "verification.json",
    ]);
    expect(episode.files["trajectory.jsonl"]).toContain("\"final_summary\"");
  });
});
```

- [ ] **Step 2: Implement episode exporter**

Create `src/main/agentEpisodeExporter.ts`:

```ts
import type { AgentExecutionCheckpoint } from "../shared/agentExecution";
import type { AgentLearningCandidate } from "../shared/agentLearning";
import type { AgentRunRecord } from "../shared/agentRuns";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";

export type AgentEpisodeVerification = {
  passed: boolean;
  checks: string[];
};

export type AgentEpisodePackage = {
  runId: string;
  exportedAt: string;
  files: Record<string, string>;
};

export function createAgentEpisodePackage(input: {
  run: AgentRunRecord;
  checkpoint: AgentExecutionCheckpoint | null;
  trajectory: AgentTrajectoryEvent[];
  learningCandidates: AgentLearningCandidate[];
  verification: AgentEpisodeVerification;
  exportedAt: string;
}): AgentEpisodePackage {
  const metadata = {
    runId: input.run.id,
    exportedAt: input.exportedAt,
    fileCount: 6,
    redaction: summarizeRedaction(input.trajectory),
  };

  return {
    runId: input.run.id,
    exportedAt: input.exportedAt,
    files: {
      "run.json": `${JSON.stringify(input.run, null, 2)}\n`,
      "checkpoint.json": `${JSON.stringify(input.checkpoint, null, 2)}\n`,
      "trajectory.jsonl": input.trajectory
        .map((event) => JSON.stringify(event))
        .join("\n")
        .concat(input.trajectory.length ? "\n" : ""),
      "learning-candidates.json": `${JSON.stringify(input.learningCandidates, null, 2)}\n`,
      "verification.json": `${JSON.stringify(input.verification, null, 2)}\n`,
      "metadata.json": `${JSON.stringify(metadata, null, 2)}\n`,
    },
  };
}

function summarizeRedaction(trajectory: AgentTrajectoryEvent[]) {
  return {
    containsApiKey: trajectory.some((event) => event.redaction.containsApiKey),
    containsFileContent: trajectory.some((event) => event.redaction.containsFileContent),
    containsUserText: trajectory.some((event) => event.redaction.containsUserText),
  };
}
```

- [ ] **Step 3: Upgrade eval fixture type**

Modify `src/main/eval/agentEvalFixtures.ts`:

```ts
export type AgentEvalEventAssertion = {
  type: AgentTrajectoryEventType;
  payload?: Record<string, unknown>;
  after?: AgentTrajectoryEventType;
};

export type AgentEvalFixture = {
  id: string;
  description: string;
  events: AgentTrajectoryEvent[];
  requiredEventTypes: AgentTrajectoryEventType[];
  assertions?: AgentEvalEventAssertion[];
  recoverabilityRequired?: boolean;
};
```

Add assertions to `workspace-escape-denied`:

```ts
assertions: [
  { type: "run_context_created" },
  { type: "workspace_escape_denied", after: "tool_call" },
  { type: "failure_classified", payload: { failureClass: "permission_denied" } },
],
```

- [ ] **Step 4: Enforce contract assertions**

Modify `src/main/eval/agentEvalRunner.ts`:

```ts
function findContractFailure(fixture: AgentEvalFixture): string | null {
  for (const assertion of fixture.assertions ?? []) {
    const eventIndex = fixture.events.findIndex((event) => event.type === assertion.type);
    if (eventIndex < 0) return `Missing asserted event "${assertion.type}".`;

    if (assertion.after) {
      const previousIndex = fixture.events.findIndex((event) => event.type === assertion.after);
      if (previousIndex < 0 || previousIndex >= eventIndex) {
        return `"${assertion.type}" must occur after "${assertion.after}".`;
      }
    }

    for (const [key, value] of Object.entries(assertion.payload ?? {})) {
      if (fixture.events[eventIndex]?.payload[key] !== value) {
        return `"${assertion.type}" payload.${key} expected ${String(value)}.`;
      }
    }
  }

  return null;
}
```

Call it after `findMissingRequiredEvent`.

- [ ] **Step 5: Add eval runner tests**

Add to `src/main/eval/agentEvalRunner.test.ts`:

```ts
it("fails when asserted event order is wrong", async () => {
  const report = await runAgentEvals([
    {
      id: "bad_order",
      description: "bad order",
      events: createEvents("bad_order", [
        ["workspace_escape_denied", {}],
        ["tool_call", {}],
      ]),
      requiredEventTypes: ["tool_call", "workspace_escape_denied"],
      assertions: [{ type: "workspace_escape_denied", after: "tool_call" }],
    },
  ]);

  expect(report.failed).toBe(1);
  expect(report.failures[0]?.reason).toContain("must occur after");
});
```

- [ ] **Step 6: Run tests**

Run:

```bash
npm test -- src/main/agentEpisodeExporter.test.ts src/main/eval/agentEvalRunner.test.ts
node scripts/run-agent-evals.mjs
```

Expected: PASS and agent eval report remains `passed: 7`.

- [ ] **Step 7: Commit**

```bash
git add src/main/agentEpisodeExporter.ts src/main/agentEpisodeExporter.test.ts src/main/eval/agentEvalFixtures.ts src/main/eval/agentEvalRunner.ts src/main/eval/agentEvalRunner.test.ts scripts/export-agent-episode.mjs package.json
git commit -m "feat: add episode export and contract evals"
```

---

## Task 6: Harness Score And Reviewed Learning Improvements

**Files:**

- Create: `src/shared/harnessScore.ts`
- Test: `src/shared/harnessScore.test.ts`
- Create: `scripts/run-harness-score.mjs`
- Modify: `src/main/agentLearningExtractor.ts`
- Test: `src/main/agentLearningExtractor.test.ts`
- Modify: `src/renderer/components/OverviewPanel.tsx`
- Test: `src/renderer/materialDesign.test.ts`

- [ ] **Step 1: Write harness score tests**

Create `src/shared/harnessScore.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeHarnessScore } from "./harnessScore";

describe("computeHarnessScore", () => {
  it("scores all seven harness categories", () => {
    const score = computeHarnessScore({
      hasInitScript: true,
      hasAgentGuide: true,
      hasTrajectoryStore: true,
      hasExecutionStore: true,
      evalPassRate: 1,
      recoverabilityRate: 1,
      pendingLearningCandidates: 0,
    });

    expect(score.categories).toHaveLength(7);
    expect(score.overall).toBeGreaterThan(8);
  });
});
```

- [ ] **Step 2: Implement harness score**

Create `src/shared/harnessScore.ts`:

```ts
export type HarnessScoreInput = {
  hasInitScript: boolean;
  hasAgentGuide: boolean;
  hasTrajectoryStore: boolean;
  hasExecutionStore: boolean;
  evalPassRate: number;
  recoverabilityRate: number;
  pendingLearningCandidates: number;
};

export type HarnessScoreCategory = {
  id:
    | "execution_environment"
    | "tool_interface"
    | "context_management"
    | "lifecycle_orchestration"
    | "observability"
    | "verification"
    | "governance";
  label: string;
  score: number;
};

export type HarnessScore = {
  overall: number;
  categories: HarnessScoreCategory[];
};

export function computeHarnessScore(input: HarnessScoreInput): HarnessScore {
  const categories: HarnessScoreCategory[] = [
    {
      id: "execution_environment",
      label: "Execution environment",
      score: average([input.hasInitScript ? 10 : 0, input.hasAgentGuide ? 10 : 0]),
    },
    { id: "tool_interface", label: "Tool interface", score: 8 },
    {
      id: "context_management",
      label: "Context management",
      score: input.hasAgentGuide ? 8 : 5,
    },
    {
      id: "lifecycle_orchestration",
      label: "Lifecycle/orchestration",
      score: input.hasExecutionStore ? 9 : 4,
    },
    {
      id: "observability",
      label: "Observability",
      score: input.hasTrajectoryStore ? 9 : 4,
    },
    {
      id: "verification",
      label: "Verification",
      score: average([input.evalPassRate * 10, input.recoverabilityRate * 10]),
    },
    {
      id: "governance",
      label: "Governance",
      score: input.pendingLearningCandidates > 10 ? 6 : 9,
    },
  ];

  return {
    overall: Number(average(categories.map((category) => category.score)).toFixed(2)),
    categories,
  };
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
```

- [ ] **Step 3: Add learning extraction for repeated failures**

Modify `src/main/agentLearningExtractor.ts`:

```ts
const repeatedFailure = findRepeatedToolFailure(events);
if (repeatedFailure) {
  candidates.push({
    type: "failure_lesson",
    sourceRunId: run.id,
    sourceTrajectoryEventIds: repeatedFailure.eventIds,
    claim: `Run repeated failing tool ${repeatedFailure.toolName} ${repeatedFailure.count} times.`,
    recommendedAction:
      "Before retrying the same tool call, inspect arguments, permissions, and the latest observation tail.",
    risk:
      "Low: this advice reduces repeated calls and encourages evidence-driven recovery.",
  });
}
```

Add helper:

```ts
function findRepeatedToolFailure(events: AgentTrajectoryEvent[]) {
  const failed = events.filter(
    (event) => event.type === "tool_result" && event.payload.ok === false,
  );
  const byTool = new Map<string, AgentTrajectoryEvent[]>();
  for (const event of failed) {
    const toolName = String(event.payload.toolName ?? "unknown");
    byTool.set(toolName, [...(byTool.get(toolName) ?? []), event]);
  }
  for (const [toolName, items] of byTool) {
    if (items.length >= 2) {
      return {
        toolName,
        count: items.length,
        eventIds: items.map((event) => event.id),
      };
    }
  }
  return null;
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test -- src/shared/harnessScore.test.ts src/main/agentLearningExtractor.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run full verification**

Run:

```bash
npm run harness:check
npm run verify
npm run smoke:prod
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/harnessScore.ts src/shared/harnessScore.test.ts src/main/agentLearningExtractor.ts src/main/agentLearningExtractor.test.ts src/renderer/components/OverviewPanel.tsx src/renderer/materialDesign.test.ts scripts/run-harness-score.mjs package.json
git commit -m "feat: add harness score and richer learning signals"
```

---

## Self-Review Checklist

- [ ] Spec coverage: every requirement in `docs/superpowers/specs/2026-06-09-harness-engineering-iteration-spec.md` maps to at least one task above.
- [ ] Specificity scan: the plan uses concrete file paths, commands, snippets, and expected outcomes throughout.
- [ ] Type consistency: `ChatAgentStatus.runId`, `HarnessScore`, `AgentEvalEventAssertion`, and authorization lifecycle callback names match across tasks.
- [ ] Verification coverage: each runtime behavior change has a focused test and at least one full verification command.
- [ ] Safety: no task grants broad unreviewed file, shell, web, or memory permissions.
