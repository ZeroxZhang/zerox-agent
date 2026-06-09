# Agent Capability P2 Native Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first shippable P2.1 slice: typed native capability descriptors, code-engineering native tools, native trajectory evidence, Agent Capability Score, and a code golden-path eval.

**Architecture:** Extend the existing `DynamicToolRegistry` and `AgentToolExecutor` instead of replacing them. Native tools remain main-process executors with shared typed descriptors, task/workspace permission checks, trajectory evidence, and renderer-visible capability scoring. P2.1 deliberately covers code-engineering tools first; research tools, reflection policy, and child handoff get separate P2 implementation plans.

**Tech Stack:** Electron main process, TypeScript shared contracts, Vitest, Node `child_process.execFile`, existing trajectory/eval stores, React Overview panel.

---

## Scope

This plan implements the first implementation slice from [2026-06-10-agent-capability-p2-design.md](../specs/2026-06-10-agent-capability-p2-design.md):

- shared native tool descriptor types
- main-process registry metadata
- `code_search`, `git_status`, `git_diff`, and `test_run`
- permission policy support for those tools
- trajectory events for native tool invocation/observation
- Overview Agent Capability Score
- code engineering golden-path eval

It does not implement research writing tools, citation storage, reflection retry policy, or child-agent handoff. Those are separate implementation plans after P2.1 lands.

## File Structure

- `src/shared/nativeCapabilities.ts`  
  Shared descriptor, score, and capability coverage types. Pure functions only.

- `src/shared/nativeCapabilities.test.ts`  
  Tests descriptor normalization and Agent Capability Score behavior.

- `src/shared/toolPermissions.ts`  
  Extend `AgentToolName` and authorization for `code_search`, `git_status`, `git_diff`, `test_run`.

- `src/shared/toolPermissions.test.ts`  
  Permission tests for native code tools and test command policy.

- `src/shared/agentTrajectory.ts`  
  Add `native_tool_invocation` and `native_tool_observation` event types.

- `src/main/dynamicToolRegistry.ts`  
  Store optional `NativeToolDescriptor` metadata next to existing OpenAI tool definitions.

- `src/main/dynamicToolRegistry.test.ts`  
  New tests for descriptor registration, discovery, and duplicate safety.

- `src/main/nativeCodeTools.ts`  
  `code_search` implementation using `rg` through `execFile`, with Node fallback for environments without `rg`.

- `src/main/nativeGitTools.ts`  
  `git_status` and `git_diff` implementations using `git -C <workspace>`.

- `src/main/nativeTestRunTool.ts`  
  `test_run` implementation using a bounded child process in the run workspace with structured output.

- `src/main/nativeCodeTools.test.ts`, `src/main/nativeGitTools.test.ts`, `src/main/nativeTestRunTool.test.ts`  
  Focused tool tests with temporary directories/repos.

- `src/main/agentToolExecutor.ts`  
  Register native descriptors and delegate to the new native tool modules.

- `src/main/agentToolExecutor.test.ts`  
  Integration checks that the executor exposes native descriptors and runs native code tools.

- `src/shared/agentProtocol.ts`  
  Include new native tools in tool definitions and system prompt guidance.

- `src/main/agentRuntimeEngine.ts`  
  Emit native tool trajectory events around descriptor-backed tools.

- `src/main/agentRuntimeEngine.test.ts`  
  Prove `native_tool_invocation` and `native_tool_observation` events are recorded.

- `src/main/chatAgentEvidence.ts` and `src/main/chatService.ts`  
  Include native tool metadata in chat evidence when descriptor-backed tools run.

- `src/main/chatService.test.ts`  
  Prove chat evidence records native metadata for a native tool call.

- `src/renderer/components/OverviewPanel.tsx`  
  Show Agent Capability Score alongside Harness score.

- `src/renderer/materialDesign.test.ts`  
  Static renderer guard for the new Overview score.

- `src/main/eval/agentEvalFixtures.ts` and `src/main/eval/agentEvalRunner.test.ts`  
  Add a code-engineering golden-path fixture that requires native tools before summary.

- `.zerox/feature_list.json`, `.zerox/progress.md`, `README.md`  
  Record the P2.1 capability slice and verification commands.

---

## Task 1: Shared Native Capability Contracts

**Files:**

- Create: `src/shared/nativeCapabilities.ts`
- Create: `src/shared/nativeCapabilities.test.ts`
- Modify: `src/shared/toolPermissions.ts`
- Modify: `src/shared/agentTrajectory.ts`

- [ ] **Step 1: Write failing native capability score tests**

Create `src/shared/nativeCapabilities.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  computeAgentCapabilityScore,
  defineNativeToolDescriptor,
  type NativeToolDescriptor,
} from "./nativeCapabilities";

describe("native capabilities", () => {
  it("normalizes native descriptors with stable defaults", () => {
    const descriptor = defineNativeToolDescriptor({
      id: "git_status",
      kind: "git",
      label: "Git status",
      description: "Read workspace git status.",
      riskLevel: "low",
      permissionScope: { files: "read", shell: "none", web: "none" },
      observableEvents: ["native_tool_invocation", "native_tool_observation"],
    });

    expect(descriptor).toEqual<NativeToolDescriptor>({
      id: "git_status",
      kind: "git",
      label: "Git status",
      description: "Read workspace git status.",
      riskLevel: "low",
      permissionScope: { files: "read", shell: "none", web: "none" },
      observableEvents: ["native_tool_invocation", "native_tool_observation"],
      enabled: true,
    });
  });

  it("scores native capability coverage and review backlog", () => {
    const score = computeAgentCapabilityScore({
      nativeToolCount: 4,
      expectedNativeToolCount: 8,
      evalPassRate: 1,
      retrySuccessRate: 0.5,
      childHandoffSuccessRate: 0,
      pendingEvalCandidates: 3,
      pendingLearningCandidates: 2,
    });

    expect(score.categories.map((category) => category.id)).toEqual([
      "native_tool_coverage",
      "verification",
      "retry_recovery",
      "handoff",
      "review_governance",
    ]);
    expect(score.categories).toContainEqual(
      expect.objectContaining({
        id: "native_tool_coverage",
        score: 5,
      }),
    );
    expect(score.summary).toContain("4/8 native tools");
    expect(score.tone).toBe("warn");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- src/shared/nativeCapabilities.test.ts
```

Expected: FAIL because `src/shared/nativeCapabilities.ts` does not exist.

- [ ] **Step 3: Implement shared native capability contracts**

Create `src/shared/nativeCapabilities.ts`:

```ts
import type { AgentTrajectoryEventType } from "./agentTrajectory";
import type { AgentToolName } from "./toolPermissions";

export type NativeToolKind =
  | "code"
  | "file"
  | "git"
  | "test"
  | "web"
  | "citation"
  | "report"
  | "orchestration";

export type NativeToolRiskLevel = "low" | "medium" | "high";

export type NativeToolPermissionScope = {
  files: "none" | "read" | "write";
  shell: "none" | "approved_command";
  web: "none" | "search" | "fetch";
};

export type NativeToolDescriptor = {
  id: AgentToolName;
  kind: NativeToolKind;
  label: string;
  description: string;
  riskLevel: NativeToolRiskLevel;
  permissionScope: NativeToolPermissionScope;
  observableEvents: AgentTrajectoryEventType[];
  enabled: boolean;
};

export type AgentCapabilityScoreCategoryId =
  | "native_tool_coverage"
  | "verification"
  | "retry_recovery"
  | "handoff"
  | "review_governance";

export type AgentCapabilityScoreTone = "bad" | "good" | "warn";

export type AgentCapabilityScoreInput = {
  nativeToolCount: number;
  expectedNativeToolCount: number;
  evalPassRate: number;
  retrySuccessRate: number;
  childHandoffSuccessRate: number;
  pendingEvalCandidates: number;
  pendingLearningCandidates: number;
};

export type AgentCapabilityScoreCategory = {
  id: AgentCapabilityScoreCategoryId;
  label: string;
  score: number;
};

export type AgentCapabilityScore = {
  overall: number;
  tone: AgentCapabilityScoreTone;
  summary: string;
  categories: AgentCapabilityScoreCategory[];
};

export function defineNativeToolDescriptor(
  descriptor: Omit<NativeToolDescriptor, "enabled"> & { enabled?: boolean },
): NativeToolDescriptor {
  return {
    ...descriptor,
    enabled: descriptor.enabled ?? true,
  };
}

export function computeAgentCapabilityScore(
  input: AgentCapabilityScoreInput,
): AgentCapabilityScore {
  const categories: AgentCapabilityScoreCategory[] = [
    {
      id: "native_tool_coverage",
      label: "Native tool coverage",
      score: ratioToScore(input.nativeToolCount, input.expectedNativeToolCount),
    },
    {
      id: "verification",
      label: "Verification",
      score: ratioToScore(input.evalPassRate, 1),
    },
    {
      id: "retry_recovery",
      label: "Retry recovery",
      score: ratioToScore(input.retrySuccessRate, 1),
    },
    {
      id: "handoff",
      label: "Handoff",
      score: ratioToScore(input.childHandoffSuccessRate, 1),
    },
    {
      id: "review_governance",
      label: "Review governance",
      score: scoreReviewGovernance(
        input.pendingEvalCandidates + input.pendingLearningCandidates,
      ),
    },
  ].map((category) => ({ ...category, score: roundScore(category.score) }));
  const overall = roundScore(
    categories.reduce((sum, category) => sum + category.score, 0) /
      categories.length,
  );

  return {
    overall,
    tone: getTone(overall),
    summary: `${input.nativeToolCount}/${input.expectedNativeToolCount} native tools; ${input.pendingEvalCandidates} eval candidates pending.`,
    categories,
  };
}

function ratioToScore(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(10, (numerator / denominator) * 10));
}

function scoreReviewGovernance(pendingReviewItems: number): number {
  if (pendingReviewItems > 10) return 5;
  if (pendingReviewItems > 5) return 7;
  if (pendingReviewItems > 0) return 8;
  return 9;
}

function getTone(score: number): AgentCapabilityScoreTone {
  if (score >= 8) return "good";
  if (score >= 6) return "warn";
  return "bad";
}

function roundScore(value: number): number {
  return Number(value.toFixed(2));
}
```

- [ ] **Step 4: Add native tool names and trajectory event types**

Modify `src/shared/toolPermissions.ts` `AgentToolName`:

```ts
export type AgentToolName =
  | "file_list"
  | "file_stat"
  | "file_search"
  | "file_read"
  | "file_write"
  | "code_search"
  | "git_status"
  | "git_diff"
  | "test_run"
  | "memory_search"
  | "conversation_search"
  | "web_search"
  | "web_fetch"
  | "shell_exec";
```

Modify `src/shared/agentTrajectory.ts` `AgentTrajectoryEventType`:

```ts
export type AgentTrajectoryEventType =
  | "run_context_created"
  | "state_transition"
  | "model_request"
  | "model_response"
  | "tool_call"
  | "tool_result"
  | "native_tool_invocation"
  | "native_tool_observation"
  | "checkpoint_written"
  | "artifact_created"
  | "workspace_escape_denied"
  | "child_run_scheduled"
  | "failure_classified"
  | "final_summary";
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm test -- src/shared/nativeCapabilities.test.ts
npm test -- src/shared/toolPermissions.test.ts
npm test -- src/main/eval/agentEvalRunner.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/nativeCapabilities.ts src/shared/nativeCapabilities.test.ts src/shared/toolPermissions.ts src/shared/agentTrajectory.ts
git commit -m "feat: add native capability contracts"
```

---

## Task 2: Native Descriptor Metadata In Dynamic Registry

**Files:**

- Modify: `src/main/dynamicToolRegistry.ts`
- Create: `src/main/dynamicToolRegistry.test.ts`

- [ ] **Step 1: Write failing registry metadata tests**

Create `src/main/dynamicToolRegistry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createDynamicToolRegistry } from "./dynamicToolRegistry";
import { defineNativeToolDescriptor } from "../shared/nativeCapabilities";

describe("dynamic tool registry", () => {
  it("stores native descriptors next to tool definitions", async () => {
    const registry = createDynamicToolRegistry();
    const descriptor = defineNativeToolDescriptor({
      id: "git_status",
      kind: "git",
      label: "Git status",
      description: "Read status.",
      riskLevel: "low",
      permissionScope: { files: "read", shell: "none", web: "none" },
      observableEvents: ["native_tool_invocation", "native_tool_observation"],
    });

    registry.register(
      {
        type: "function",
        function: {
          name: "git_status",
          description: "Read status.",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      async () => ({ ok: true, result: { clean: true } }),
      "native",
      descriptor,
    );

    expect(registry.getNativeDescriptors()).toEqual([descriptor]);
    expect(registry.getNativeDescriptor("git_status")).toEqual(descriptor);
    await expect(registry.execute("git_status", {})).resolves.toEqual({
      ok: true,
      result: { clean: true },
    });
  });

  it("removes native descriptors when a tool is unregistered", () => {
    const registry = createDynamicToolRegistry();
    registry.register(
      {
        type: "function",
        function: {
          name: "git_diff",
          description: "Read diff.",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      async () => ({ ok: true, result: {} }),
      "native",
      defineNativeToolDescriptor({
        id: "git_diff",
        kind: "git",
        label: "Git diff",
        description: "Read diff.",
        riskLevel: "low",
        permissionScope: { files: "read", shell: "none", web: "none" },
        observableEvents: ["native_tool_invocation", "native_tool_observation"],
      }),
    );

    expect(registry.unregister("git_diff")).toBe(true);
    expect(registry.getNativeDescriptors()).toEqual([]);
    expect(registry.getNativeDescriptor("git_diff")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm test -- src/main/dynamicToolRegistry.test.ts
```

Expected: FAIL because `register` does not accept a descriptor and `getNativeDescriptors` does not exist.

- [ ] **Step 3: Extend registry type and implementation**

Modify `src/main/dynamicToolRegistry.ts`:

```ts
import type { ToolDefinition } from "./openAiCompatibleClient";
import type { AgentToolName } from "../shared/toolPermissions";
import type { NativeToolDescriptor } from "../shared/nativeCapabilities";

export type AgentToolExecutionResult =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; error: string; errorDetails?: Record<string, unknown> };

export type ToolHandler = (
  args: Record<string, unknown>,
) => Promise<AgentToolExecutionResult>;

export type DynamicToolRegistry = {
  register(
    definition: ToolDefinition,
    handler: ToolHandler,
    source: string,
    descriptor?: NativeToolDescriptor,
  ): void;
  unregister(toolName: string): boolean;
  getDefinitions(): ToolDefinition[];
  getNativeDescriptors(): NativeToolDescriptor[];
  getNativeDescriptor(toolName: string): NativeToolDescriptor | null;
  execute(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<AgentToolExecutionResult>;
  listBySource(): Map<string, string[]>;
  has(toolName: string): boolean;
};
```

Inside `createDynamicToolRegistry()` add:

```ts
const nativeDescriptors = new Map<string, NativeToolDescriptor>();
```

Update `register`:

```ts
register(definition, handler, source, descriptor) {
  const name = definition.function.name;

  if (handlers.has(name)) {
    throw new Error(`Tool "${name}" is already registered.`);
  }

  definitions.set(name, definition);
  handlers.set(name, handler);
  sources.set(name, source);
  if (descriptor) {
    nativeDescriptors.set(name, descriptor);
  }
},
```

Update `unregister`:

```ts
nativeDescriptors.delete(toolName);
```

Add methods:

```ts
getNativeDescriptors() {
  return [...nativeDescriptors.values()];
},

getNativeDescriptor(toolName) {
  return nativeDescriptors.get(toolName) ?? null;
},
```

- [ ] **Step 4: Run registry tests**

Run:

```bash
npm test -- src/main/dynamicToolRegistry.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/dynamicToolRegistry.ts src/main/dynamicToolRegistry.test.ts
git commit -m "feat: track native tool descriptors"
```

---

## Task 3: Git Native Tools

**Files:**

- Create: `src/main/nativeGitTools.ts`
- Create: `src/main/nativeGitTools.test.ts`

- [ ] **Step 1: Write failing git native tool tests**

Create `src/main/nativeGitTools.test.ts`:

```ts
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readGitDiff, readGitStatus } from "./nativeGitTools";

const execFileAsync = promisify(execFile);

describe("native git tools", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await mkdtemp(path.join(os.tmpdir(), "zerox-native-git-"));
    await execFileAsync("git", ["init"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: repoDir,
    });
    await execFileAsync("git", ["config", "user.name", "Test User"], {
      cwd: repoDir,
    });
    await writeFile(path.join(repoDir, "README.md"), "hello\n", "utf8");
    await execFileAsync("git", ["add", "README.md"], { cwd: repoDir });
    await execFileAsync("git", ["commit", "-m", "initial"], { cwd: repoDir });
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  it("returns structured git status", async () => {
    await writeFile(path.join(repoDir, "notes.md"), "draft\n", "utf8");

    await expect(readGitStatus({ workspaceRoot: repoDir })).resolves.toEqual({
      ok: true,
      result: {
        workspaceRoot: repoDir,
        branch: "master",
        clean: false,
        entries: [
          {
            path: "notes.md",
            indexStatus: "?",
            worktreeStatus: "?",
          },
        ],
      },
    });
  });

  it("returns diff stats and raw diff text", async () => {
    await writeFile(path.join(repoDir, "README.md"), "hello\nworld\n", "utf8");

    const result = await readGitDiff({ workspaceRoot: repoDir });

    expect(result).toMatchObject({
      ok: true,
      result: {
        workspaceRoot: repoDir,
        filesChanged: 1,
      },
    });
    expect(result.ok ? result.result.rawDiff : "").toContain("+world");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- src/main/nativeGitTools.test.ts
```

Expected: FAIL because `nativeGitTools.ts` does not exist.

- [ ] **Step 3: Implement git native tools**

Create `src/main/nativeGitTools.ts`:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentToolExecutionResult } from "./dynamicToolRegistry";

const execFileAsync = promisify(execFile);

export async function readGitStatus(args: {
  workspaceRoot: string;
}): Promise<AgentToolExecutionResult> {
  if (!args.workspaceRoot) {
    return { ok: false, error: "git_status requires workspaceRoot." };
  }

  const branch = await git(args.workspaceRoot, ["branch", "--show-current"]);
  const status = await git(args.workspaceRoot, ["status", "--porcelain=v1"]);
  const entries = status.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => ({
      indexStatus: line.slice(0, 1).trim() || "?",
      worktreeStatus: line.slice(1, 2).trim() || "?",
      path: line.slice(3),
    }));

  return {
    ok: true,
    result: {
      workspaceRoot: args.workspaceRoot,
      branch: branch.stdout.trim(),
      clean: entries.length === 0,
      entries,
    },
  };
}

export async function readGitDiff(args: {
  workspaceRoot: string;
  staged?: boolean;
}): Promise<AgentToolExecutionResult> {
  if (!args.workspaceRoot) {
    return { ok: false, error: "git_diff requires workspaceRoot." };
  }

  const diffArgs = args.staged ? ["diff", "--cached"] : ["diff"];
  const statArgs = args.staged
    ? ["diff", "--cached", "--numstat"]
    : ["diff", "--numstat"];
  const [diff, stat] = await Promise.all([
    git(args.workspaceRoot, diffArgs),
    git(args.workspaceRoot, statArgs),
  ]);
  const statRows = stat.stdout.split("\n").filter(Boolean);

  return {
    ok: true,
    result: {
      workspaceRoot: args.workspaceRoot,
      staged: Boolean(args.staged),
      filesChanged: statRows.length,
      rawDiff: diff.stdout,
      numstat: statRows.map((row) => {
        const [added, deleted, filePath] = row.split("\t");
        return { added, deleted, path: filePath };
      }),
    },
  };
}

async function git(cwd: string, args: string[]) {
  try {
    return await execFileAsync("git", args, {
      cwd,
      maxBuffer: 1024 * 1024 * 4,
    });
  } catch (error) {
    const typed = error as Error & {
      stdout?: string;
      stderr?: string;
      code?: number;
    };
    throw new Error(
      `git ${args.join(" ")} failed: ${typed.stderr || typed.message}`,
    );
  }
}
```

- [ ] **Step 4: Run git native tool tests**

Run:

```bash
npm test -- src/main/nativeGitTools.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/nativeGitTools.ts src/main/nativeGitTools.test.ts
git commit -m "feat: add native git tools"
```

---

## Task 4: Code Search Native Tool

**Files:**

- Create: `src/main/nativeCodeTools.ts`
- Create: `src/main/nativeCodeTools.test.ts`

- [ ] **Step 1: Write failing code search tests**

Create `src/main/nativeCodeTools.test.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { searchCode } from "./nativeCodeTools";

describe("native code tools", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "zerox-code-search-"));
    await mkdir(path.join(workspaceRoot, "src"));
    await writeFile(
      path.join(workspaceRoot, "src", "agent.ts"),
      "export function runAgent() { return 'ok'; }\n",
      "utf8",
    );
    await mkdir(path.join(workspaceRoot, "node_modules"));
    await writeFile(
      path.join(workspaceRoot, "node_modules", "ignored.ts"),
      "runAgent should not be returned\n",
      "utf8",
    );
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it("searches code content and skips dependency folders", async () => {
    await expect(
      searchCode({
        workspaceRoot,
        query: "runAgent",
        maxResults: 10,
      }),
    ).resolves.toEqual({
      ok: true,
      result: {
        workspaceRoot,
        query: "runAgent",
        results: [
          {
            path: path.join(workspaceRoot, "src", "agent.ts"),
            relativePath: "src/agent.ts",
            line: 1,
            preview: "export function runAgent() { return 'ok'; }",
          },
        ],
      },
    });
  });

  it("requires a query", async () => {
    await expect(
      searchCode({ workspaceRoot, query: "   " }),
    ).resolves.toEqual({
      ok: false,
      error: "code_search query is required.",
    });
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- src/main/nativeCodeTools.test.ts
```

Expected: FAIL because `nativeCodeTools.ts` does not exist.

- [ ] **Step 3: Implement code search**

Create `src/main/nativeCodeTools.ts`:

```ts
import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { AgentToolExecutionResult } from "./dynamicToolRegistry";

const execFileAsync = promisify(execFile);
const ignoredDirectories = new Set([
  ".git",
  "dist",
  "dist-electron",
  "node_modules",
  "release",
]);
const textFilePattern = /\.(cjs|css|html|js|json|jsx|md|mjs|ts|tsx|txt|yaml|yml)$/i;

export async function searchCode(args: {
  workspaceRoot: string;
  query: string;
  maxResults?: number;
}): Promise<AgentToolExecutionResult> {
  const workspaceRoot = String(args.workspaceRoot ?? "");
  const query = String(args.query ?? "").trim();
  const maxResults = Math.max(1, Math.min(Number(args.maxResults ?? 20), 100));

  if (!workspaceRoot) {
    return { ok: false, error: "code_search requires workspaceRoot." };
  }
  if (!query) {
    return { ok: false, error: "code_search query is required." };
  }

  const rgResult = await tryRipgrep(workspaceRoot, query, maxResults);
  if (rgResult) {
    return rgResult;
  }

  const results = await fallbackSearch(workspaceRoot, query, maxResults);
  return {
    ok: true,
    result: { workspaceRoot, query, results },
  };
}

async function tryRipgrep(
  workspaceRoot: string,
  query: string,
  maxResults: number,
): Promise<AgentToolExecutionResult | null> {
  try {
    const { stdout } = await execFileAsync(
      "rg",
      [
        "--line-number",
        "--no-heading",
        "--color",
        "never",
        "--glob",
        "!node_modules/**",
        "--glob",
        "!dist/**",
        "--glob",
        "!dist-electron/**",
        "--glob",
        "!release/**",
        query,
        workspaceRoot,
      ],
      { maxBuffer: 1024 * 1024 * 4 },
    );
    const results = stdout
      .split("\n")
      .filter(Boolean)
      .slice(0, maxResults)
      .map((line) => {
        const [absolutePath, lineNumber, ...previewParts] = line.split(":");
        return {
          path: absolutePath,
          relativePath: path.relative(workspaceRoot, absolutePath),
          line: Number(lineNumber),
          preview: previewParts.join(":").trim(),
        };
      });
    return {
      ok: true,
      result: { workspaceRoot, query, results },
    };
  } catch (error) {
    const code = (error as { code?: number | string }).code;
    if (code === 1) {
      return { ok: true, result: { workspaceRoot, query, results: [] } };
    }

    return null;
  }
}

async function fallbackSearch(
  workspaceRoot: string,
  query: string,
  maxResults: number,
) {
  const results: Array<{
    path: string;
    relativePath: string;
    line: number;
    preview: string;
  }> = [];

  async function visit(directory: string) {
    if (results.length >= maxResults) return;

    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= maxResults) return;
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) {
          await visit(path.join(directory, entry.name));
        }
        continue;
      }
      if (!entry.isFile() || !textFilePattern.test(entry.name)) {
        continue;
      }

      const filePath = path.join(directory, entry.name);
      const fileStat = await stat(filePath);
      if (fileStat.size > 1024 * 1024) {
        continue;
      }
      const content = await readFile(filePath, "utf8");
      content.split("\n").forEach((line, index) => {
        if (results.length < maxResults && line.includes(query)) {
          results.push({
            path: filePath,
            relativePath: path.relative(workspaceRoot, filePath),
            line: index + 1,
            preview: line.trim(),
          });
        }
      });
    }
  }

  await visit(workspaceRoot);
  return results;
}
```

- [ ] **Step 4: Run code search tests**

Run:

```bash
npm test -- src/main/nativeCodeTools.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/nativeCodeTools.ts src/main/nativeCodeTools.test.ts
git commit -m "feat: add native code search"
```

---

## Task 5: Test Run Native Tool

**Files:**

- Create: `src/main/nativeTestRunTool.ts`
- Create: `src/main/nativeTestRunTool.test.ts`

- [ ] **Step 1: Write failing test-run tool tests**

Create `src/main/nativeTestRunTool.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runNativeTestCommand } from "./nativeTestRunTool";

describe("native test run tool", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "zerox-test-run-"));
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it("returns structured output for a successful test command", async () => {
    const command = `${JSON.stringify(process.execPath)} -e "console.log('pass')"`;

    await expect(
      runNativeTestCommand({ workspaceRoot, command, timeoutMs: 5000 }),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        command,
        cwd: workspaceRoot,
        exitCode: 0,
        stdout: "pass\n",
        stderr: "",
      },
    });
  });

  it("returns structured diagnostics for a failing test command", async () => {
    const command = `${JSON.stringify(process.execPath)} -e "console.error('fail'); process.exit(2)"`;

    await expect(
      runNativeTestCommand({ workspaceRoot, command, timeoutMs: 5000 }),
    ).resolves.toMatchObject({
      ok: false,
      error: "test_run failed with exit code 2.",
      errorDetails: {
        kind: "exit",
        command,
        exitCode: 2,
        stderr: "fail\n",
      },
    });
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- src/main/nativeTestRunTool.test.ts
```

Expected: FAIL because `nativeTestRunTool.ts` does not exist.

- [ ] **Step 3: Implement test-run tool**

Create `src/main/nativeTestRunTool.ts`:

```ts
import { exec } from "node:child_process";
import type { AgentToolExecutionResult } from "./dynamicToolRegistry";

export async function runNativeTestCommand(args: {
  workspaceRoot: string;
  command: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<AgentToolExecutionResult> {
  const workspaceRoot = String(args.workspaceRoot ?? "");
  const command = String(args.command ?? "").trim();
  const timeoutMs = Math.max(1000, Math.min(Number(args.timeoutMs ?? 120000), 600000));

  if (!workspaceRoot) {
    return { ok: false, error: "test_run requires workspaceRoot." };
  }
  if (!command) {
    return { ok: false, error: "test_run command is required." };
  }

  return new Promise((resolve) => {
    const child = exec(
      command,
      {
        cwd: workspaceRoot,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024 * 8,
      },
      (error, stdout, stderr) => {
        const exitCode =
          typeof (error as NodeJS.ErrnoException | null)?.code === "number"
            ? Number((error as NodeJS.ErrnoException).code)
            : 0;
        if (error) {
          resolve({
            ok: false,
            error:
              (error as NodeJS.ErrnoException).killed
                ? `test_run timed out after ${timeoutMs} ms.`
                : `test_run failed with exit code ${exitCode}.`,
            errorDetails: {
              kind: (error as NodeJS.ErrnoException).killed ? "timeout" : "exit",
              command,
              cwd: workspaceRoot,
              exitCode,
              stdout,
              stderr,
              timeoutMs,
            },
          });
          return;
        }

        resolve({
          ok: true,
          result: {
            command,
            cwd: workspaceRoot,
            exitCode: 0,
            stdout,
            stderr,
            timeoutMs,
          },
        });
      },
    );

    args.signal?.addEventListener(
      "abort",
      () => {
        child.kill();
        resolve({
          ok: false,
          error: "test_run was canceled.",
          errorDetails: { kind: "canceled", command, cwd: workspaceRoot },
        });
      },
      { once: true },
    );
  });
}
```

- [ ] **Step 4: Run test-run tests**

Run:

```bash
npm test -- src/main/nativeTestRunTool.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/nativeTestRunTool.ts src/main/nativeTestRunTool.test.ts
git commit -m "feat: add native test runner tool"
```

---

## Task 6: Permission Policy For Native Code Tools

**Files:**

- Modify: `src/shared/toolPermissions.ts`
- Modify: `src/shared/toolPermissions.test.ts`

- [ ] **Step 1: Write failing permission tests**

Add to `src/shared/toolPermissions.test.ts`:

```ts
it("authorizes native code search and git tools through readable workspace paths", () => {
  const policy = getDefaultTaskPermissionPolicy();
  policy.files.read = ["/workspace/project"];

  expect(
    authorizeToolCall(policy, {
      toolName: "code_search",
      args: { workspaceRoot: "/workspace/project", query: "Agent" },
    }),
  ).toEqual({
    allowed: true,
    reason: "路径在已授权范围内。",
  });
  expect(
    authorizeToolCall(policy, {
      toolName: "git_status",
      args: { workspaceRoot: "/workspace/project" },
    }).allowed,
  ).toBe(true);
  expect(
    authorizeToolCall(policy, {
      toolName: "git_diff",
      args: { workspaceRoot: "/private/project" },
    }),
  ).toEqual({
    allowed: false,
    reason: "git_diff workspaceRoot 不在已授权可读目录内。",
  });
});

it("authorizes test_run only when the command matches shell policy", () => {
  const policy = getDefaultTaskPermissionPolicy();
  policy.files.read = ["/workspace/project"];
  policy.shell.commands = ["npm test -- *"];

  expect(
    authorizeToolCall(policy, {
      toolName: "test_run",
      args: {
        workspaceRoot: "/workspace/project",
        command: "npm test -- src/shared/nativeCapabilities.test.ts",
      },
    }).allowed,
  ).toBe(true);
  expect(
    authorizeToolCall(policy, {
      toolName: "test_run",
      args: {
        workspaceRoot: "/workspace/project",
        command: "npm install left-pad",
      },
    }),
  ).toEqual({
    allowed: false,
    reason: "test_run command 不匹配已授权测试模板。",
  });
});
```

- [ ] **Step 2: Run permission tests to verify failure**

Run:

```bash
npm test -- src/shared/toolPermissions.test.ts
```

Expected: FAIL because authorization does not handle the new tool names.

- [ ] **Step 3: Implement native permission cases**

In `authorizeToolCall` add cases:

```ts
case "code_search":
  return authorizeFilePath(
    String(request.args.workspaceRoot ?? ""),
    normalized.files.read,
    "code_search workspaceRoot 不在已授权可读目录内。",
  );
case "git_status":
  return authorizeFilePath(
    String(request.args.workspaceRoot ?? ""),
    normalized.files.read,
    "git_status workspaceRoot 不在已授权可读目录内。",
  );
case "git_diff":
  return authorizeFilePath(
    String(request.args.workspaceRoot ?? ""),
    normalized.files.read,
    "git_diff workspaceRoot 不在已授权可读目录内。",
  );
case "test_run": {
  const pathDecision = authorizeFilePath(
    String(request.args.workspaceRoot ?? ""),
    normalized.files.read,
    "test_run workspaceRoot 不在已授权可读目录内。",
  );
  if (!pathDecision.allowed) {
    return pathDecision;
  }

  const commandDecision = authorizeShellCommand(
    String(request.args.command ?? ""),
    normalized.shell.commands,
  );
  return commandDecision.allowed
    ? allow("test_run command 匹配已授权测试模板。")
    : deny("test_run command 不匹配已授权测试模板。");
}
```

Keep existing `authorizeRunContextToolCall` behavior: the run-context workspace checks should apply to these tools through `workspaceRoot`, using the same path-inside-run-context helper used for file tools.

- [ ] **Step 4: Run permission tests**

Run:

```bash
npm test -- src/shared/toolPermissions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/toolPermissions.ts src/shared/toolPermissions.test.ts
git commit -m "feat: authorize native code tools"
```

---

## Task 7: Register Native Tools In AgentToolExecutor And Protocol

**Files:**

- Modify: `src/main/agentToolExecutor.ts`
- Modify: `src/main/agentToolExecutor.test.ts`
- Modify: `src/shared/agentProtocol.ts`

- [ ] **Step 1: Write failing executor integration tests**

Add to `src/main/agentToolExecutor.test.ts`:

```ts
it("exposes descriptors for native code engineering tools", () => {
  const executor = createAgentToolExecutor();

  expect(
    executor
      .getRegistry()
      .getNativeDescriptors()
      .map((descriptor) => descriptor.id),
  ).toEqual(
    expect.arrayContaining([
      "code_search",
      "git_status",
      "git_diff",
      "test_run",
    ]),
  );
});

it("runs code_search through the executor registry", async () => {
  await writeFile(path.join(tempDir, "agent.ts"), "export const agent = true;\n", "utf8");
  const executor = createAgentToolExecutor();

  await expect(
    executor.execute({
      toolName: "code_search",
      args: { workspaceRoot: tempDir, query: "agent", maxResults: 5 },
    }),
  ).resolves.toMatchObject({
    ok: true,
    result: {
      workspaceRoot: tempDir,
      results: [
        {
          relativePath: "agent.ts",
          line: 1,
        },
      ],
    },
  });
});
```

- [ ] **Step 2: Run executor tests to verify failure**

Run:

```bash
npm test -- src/main/agentToolExecutor.test.ts
```

Expected: FAIL because descriptors and native tools are not registered.

- [ ] **Step 3: Register descriptors and handlers**

In `src/main/agentToolExecutor.ts`, import:

```ts
import { searchCode } from "./nativeCodeTools";
import { readGitDiff, readGitStatus } from "./nativeGitTools";
import { runNativeTestCommand } from "./nativeTestRunTool";
import { defineNativeToolDescriptor } from "../shared/nativeCapabilities";
```

Add registrations inside `registerBuiltinTools` before `shell_exec`:

```ts
registry.register(
  {
    type: "function",
    function: {
      name: "code_search",
      description:
        "Search code content in the run workspace with rg-style results. Prefer this over shell grep/rg.",
      parameters: {
        type: "object",
        properties: {
          workspaceRoot: { type: "string", description: "Workspace root path" },
          query: { type: "string", description: "Literal text to search" },
          maxResults: { type: "number", description: "Maximum results, 1-100" },
        },
        required: ["workspaceRoot", "query"],
      },
    },
  },
  async (args) =>
    searchCode({
      workspaceRoot: String(args.workspaceRoot ?? ""),
      query: String(args.query ?? ""),
      maxResults: Number(args.maxResults ?? 20),
    }),
  "native",
  defineNativeToolDescriptor({
    id: "code_search",
    kind: "code",
    label: "Code search",
    description: "Search code content inside the workspace.",
    riskLevel: "low",
    permissionScope: { files: "read", shell: "none", web: "none" },
    observableEvents: ["native_tool_invocation", "native_tool_observation"],
  }),
);
```

Repeat the same pattern for:

```ts
registry.register(
  {
    type: "function",
    function: {
      name: "git_status",
      description: "Read structured git status for the workspace.",
      parameters: {
        type: "object",
        properties: {
          workspaceRoot: { type: "string", description: "Workspace root path" },
        },
        required: ["workspaceRoot"],
      },
    },
  },
  async (args) => readGitStatus({ workspaceRoot: String(args.workspaceRoot ?? "") }),
  "native",
  defineNativeToolDescriptor({
    id: "git_status",
    kind: "git",
    label: "Git status",
    description: "Read structured git status.",
    riskLevel: "low",
    permissionScope: { files: "read", shell: "none", web: "none" },
    observableEvents: ["native_tool_invocation", "native_tool_observation"],
  }),
);
```

```ts
registry.register(
  {
    type: "function",
    function: {
      name: "git_diff",
      description: "Read structured git diff for the workspace.",
      parameters: {
        type: "object",
        properties: {
          workspaceRoot: { type: "string", description: "Workspace root path" },
          staged: { type: "boolean", description: "Read staged diff" },
        },
        required: ["workspaceRoot"],
      },
    },
  },
  async (args) =>
    readGitDiff({
      workspaceRoot: String(args.workspaceRoot ?? ""),
      staged: Boolean(args.staged),
    }),
  "native",
  defineNativeToolDescriptor({
    id: "git_diff",
    kind: "git",
    label: "Git diff",
    description: "Read structured git diff.",
    riskLevel: "low",
    permissionScope: { files: "read", shell: "none", web: "none" },
    observableEvents: ["native_tool_invocation", "native_tool_observation"],
  }),
);
```

```ts
registry.register(
  {
    type: "function",
    function: {
      name: "test_run",
      description:
        "Run an approved test command in the workspace with structured stdout/stderr and exit code.",
      parameters: {
        type: "object",
        properties: {
          workspaceRoot: { type: "string", description: "Workspace root path" },
          command: { type: "string", description: "Approved test command" },
          timeoutMs: { type: "number", description: "Timeout in milliseconds" },
        },
        required: ["workspaceRoot", "command"],
      },
    },
  },
  async (args) =>
    runNativeTestCommand({
      workspaceRoot: String(args.workspaceRoot ?? ""),
      command: String(args.command ?? ""),
      timeoutMs: Number(args.timeoutMs ?? 120000),
    }),
  "native",
  defineNativeToolDescriptor({
    id: "test_run",
    kind: "test",
    label: "Test run",
    description: "Run approved test commands with structured diagnostics.",
    riskLevel: "medium",
    permissionScope: { files: "read", shell: "approved_command", web: "none" },
    observableEvents: ["native_tool_invocation", "native_tool_observation"],
  }),
);
```

- [ ] **Step 4: Update protocol tool definitions and prompt**

In `src/shared/agentProtocol.ts`:

- Add the four tool names to `supportedTools`.
- Add four `ToolDefinition` objects matching the executor definitions.
- Update `buildAgentSystemPrompt()` to include:

```ts
"代码工程优先使用 code_search、git_status、git_diff、test_run；只有这些原生工具无法完成时再申请 shell_exec。",
```

- [ ] **Step 5: Run executor and protocol tests**

Run:

```bash
npm test -- src/main/agentToolExecutor.test.ts src/shared/packageScripts.test.ts
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/agentToolExecutor.ts src/main/agentToolExecutor.test.ts src/shared/agentProtocol.ts
git commit -m "feat: register native code tools"
```

---

## Task 8: Native Tool Trajectory Evidence

**Files:**

- Modify: `src/main/agentRuntimeEngine.ts`
- Modify: `src/main/agentRuntimeEngine.test.ts`
- Modify: `src/main/chatAgentEvidence.ts`
- Modify: `src/main/chatService.test.ts`

- [ ] **Step 1: Write failing runtime trajectory test**

Add to `src/main/agentRuntimeEngine.test.ts`:

```ts
it("emits native tool trajectory events for descriptor-backed tools", async () => {
  const trajectoryEvents: AgentTrajectoryEvent[] = [];
  const engine = createAgentRuntimeEngine({
    taskStore: createTaskStore(createTask()),
    runStore: createMemoryRunStore(),
    executionStore: createMemoryExecutionStore([]),
    trajectoryStore: createMemoryTrajectoryStore(trajectoryEvents),
    resolveSkill: async () => createSkillRecord(),
    chatClient: createChatClient([
      toolCallResponse("git_status", { workspaceRoot: "/workspace/project" }),
      finalResponse("Done"),
    ]),
    getModelProfile: async () => createModelProfile(),
    toolAuthorizationService: createAuthorizationService(true),
    toolExecutor: {
      async execute() {
        return { ok: true, result: { clean: true } };
      },
      getRegistry() {
        const registry = createDynamicToolRegistry();
        registry.register(
          {
            type: "function",
            function: {
              name: "git_status",
              description: "Read status.",
              parameters: { type: "object", properties: {}, required: [] },
            },
          },
          async () => ({ ok: true, result: { clean: true } }),
          "native",
          defineNativeToolDescriptor({
            id: "git_status",
            kind: "git",
            label: "Git status",
            description: "Read status.",
            riskLevel: "low",
            permissionScope: { files: "read", shell: "none", web: "none" },
            observableEvents: ["native_tool_invocation", "native_tool_observation"],
          }),
        );
        return registry;
      },
      hasTool(toolName: string) {
        return toolName === "git_status";
      },
    },
    createId: createSequentialId("native_trajectory"),
    now: createSteppedClock("2026-06-07T00:00:00.000Z"),
  });

  await engine.startTask("task_123");

  expect(trajectoryEvents).toContainEqual(
    expect.objectContaining({
      type: "native_tool_invocation",
      payload: expect.objectContaining({
        toolName: "git_status",
        nativeKind: "git",
      }),
    }),
  );
  expect(trajectoryEvents).toContainEqual(
    expect.objectContaining({
      type: "native_tool_observation",
      payload: expect.objectContaining({
        toolName: "git_status",
        ok: true,
      }),
    }),
  );
});
```

Add imports in the test file:

```ts
import { createDynamicToolRegistry } from "./dynamicToolRegistry";
import { defineNativeToolDescriptor } from "../shared/nativeCapabilities";
```

- [ ] **Step 2: Run runtime test to verify failure**

Run:

```bash
npm test -- src/main/agentRuntimeEngine.test.ts
```

Expected: FAIL because native trajectory events are not emitted.

- [ ] **Step 3: Emit native trajectory events in runtime**

In `src/main/agentRuntimeEngine.ts`, before executing a tool:

```ts
const nativeDescriptor = options.toolExecutor
  .getRegistry()
  .getNativeDescriptor(toolName);
if (nativeDescriptor) {
  await appendTrajectory(current.runId, "native_tool_invocation", {
    toolCallId: toolCall.id,
    toolName,
    nativeKind: nativeDescriptor.kind,
    riskLevel: nativeDescriptor.riskLevel,
  }, {
    containsApiKey: false,
    containsFileContent: false,
    containsUserText: true,
  }, current.runContext);
}
```

After `result` and before/after the existing `tool_result` event:

```ts
if (nativeDescriptor) {
  await appendTrajectory(current.runId, "native_tool_observation", {
    toolCallId: toolCall.id,
    toolName,
    nativeKind: nativeDescriptor.kind,
    ok: result.ok,
  }, {
    containsApiKey: false,
    containsFileContent: false,
    containsUserText: false,
  }, current.runContext);
}
```

- [ ] **Step 4: Add chat evidence native metadata**

In `src/main/chatAgentEvidence.ts`, extend the tool call/result recorder payloads to accept optional native metadata:

```ts
nativeKind?: string;
riskLevel?: string;
```

In `src/main/chatService.ts`, when calling the recorder, read:

```ts
const nativeDescriptor = toolExecutor.getRegistry().getNativeDescriptor(toolName);
```

and pass `nativeKind` / `riskLevel` into the evidence payload when present.

- [ ] **Step 5: Run focused evidence tests**

Run:

```bash
npm test -- src/main/agentRuntimeEngine.test.ts src/main/chatService.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/agentRuntimeEngine.ts src/main/agentRuntimeEngine.test.ts src/main/chatAgentEvidence.ts src/main/chatService.ts src/main/chatService.test.ts
git commit -m "feat: record native tool evidence"
```

---

## Task 9: Overview Agent Capability Score

**Files:**

- Modify: `src/renderer/components/OverviewPanel.tsx`
- Modify: `src/renderer/materialDesign.test.ts`
- Modify: `src/renderer/demoAgentData.ts`

- [ ] **Step 1: Write failing renderer static test**

Add to `src/renderer/materialDesign.test.ts`:

```ts
it("surfaces the agent capability score in Overview", () => {
  expect(overviewPanelSource).toContain("computeAgentCapabilityScore");
  expect(overviewPanelSource).toContain("Agent Capability");
  expect(overviewPanelSource).toContain("native tools");
});
```

- [ ] **Step 2: Run renderer test to verify failure**

Run:

```bash
npm test -- src/renderer/materialDesign.test.ts
```

Expected: FAIL because Overview does not use `computeAgentCapabilityScore`.

- [ ] **Step 3: Compute and render capability score**

In `src/renderer/components/OverviewPanel.tsx`, import:

```ts
import { computeAgentCapabilityScore } from "../../shared/nativeCapabilities";
```

Add memo near `harnessScore`:

```ts
const agentCapabilityScore = useMemo(
  () =>
    data
      ? computeAgentCapabilityScore({
          nativeToolCount: 4,
          expectedNativeToolCount: 8,
          evalPassRate: data.evalReport.passRate,
          retrySuccessRate: data.evalReport.toolSuccessRate,
          childHandoffSuccessRate: data.runs.some((run) => run.childRunIds?.length)
            ? 1
            : 0,
          pendingEvalCandidates: 0,
          pendingLearningCandidates: data.learningCandidates.length,
        })
      : null,
  [data],
);
```

Add a `HealthCard` after Harness:

```tsx
<HealthCard
  label="Agent Capability"
  status={
    agentCapabilityScore ? `${agentCapabilityScore.overall}/10` : "待加载"
  }
  tone={agentCapabilityScore?.tone ?? "warn"}
  value={agentCapabilityScore?.summary ?? "native tools"}
/>
```

- [ ] **Step 4: Run renderer tests and build**

Run:

```bash
npm test -- src/renderer/materialDesign.test.ts src/shared/nativeCapabilities.test.ts
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/OverviewPanel.tsx src/renderer/materialDesign.test.ts src/renderer/demoAgentData.ts
git commit -m "feat: show agent capability score"
```

---

## Task 10: Code Engineering Golden-Path Eval

**Files:**

- Modify: `src/main/eval/agentEvalFixtures.ts`
- Modify: `src/main/eval/agentEvalRunner.test.ts`

- [ ] **Step 1: Write failing eval test for native tool preference**

Add to `src/main/eval/agentEvalRunner.test.ts`:

```ts
it("fails when a code engineering fixture uses shell instead of native tools", async () => {
  const report = await runAgentEvals([
    {
      id: "bad-code-engineering-shell-fallback",
      description: "Code path should prefer native tools.",
      events: createEvents("bad-code-engineering-shell-fallback", [
        ["tool_call", { toolName: "shell_exec", command: "git status" }],
        ["tool_result", { toolName: "shell_exec", ok: true }],
        ["final_summary", { status: "succeeded" }],
      ]),
      requiredEventTypes: ["tool_call", "tool_result", "final_summary"],
      assertions: [
        { type: "native_tool_invocation", payload: { toolName: "git_status" } },
      ],
    },
  ]);

  expect(report.failures[0]).toEqual({
    fixtureId: "bad-code-engineering-shell-fallback",
    reason: 'Missing asserted event "native_tool_invocation".',
  });
});
```

- [ ] **Step 2: Run eval test to verify the assertion failure path**

Run:

```bash
npm test -- src/main/eval/agentEvalRunner.test.ts
```

Expected: PASS. The test proves the runner reports `Missing asserted event "native_tool_invocation".` for a shell-fallback code path.

- [ ] **Step 3: Add code engineering fixture**

In `src/main/eval/agentEvalFixtures.ts`, add this fixture before `multi-agent-lineage`:

```ts
{
  id: "code-engineering-native-tools",
  description:
    "A code engineering run inspects status, searches code, runs tests, and summarizes with native tools.",
  events: createEvents("code-engineering-native-tools", [
    ["run_context_created", { workspaceId: "workspace_eval" }],
    ["model_request", {}],
    ["model_response", {}],
    ["native_tool_invocation", { toolName: "git_status", nativeKind: "git" }],
    ["tool_call", { toolName: "git_status" }],
    ["tool_result", { toolName: "git_status", ok: true }],
    ["native_tool_observation", { toolName: "git_status", ok: true }],
    ["native_tool_invocation", { toolName: "code_search", nativeKind: "code" }],
    ["tool_call", { toolName: "code_search" }],
    ["tool_result", { toolName: "code_search", ok: true }],
    ["native_tool_observation", { toolName: "code_search", ok: true }],
    ["native_tool_invocation", { toolName: "test_run", nativeKind: "test" }],
    ["tool_call", { toolName: "test_run" }],
    ["tool_result", { toolName: "test_run", ok: true }],
    ["native_tool_observation", { toolName: "test_run", ok: true }],
    ["final_summary", { status: "succeeded", verified: true }],
  ]),
  requiredEventTypes: [
    "run_context_created",
    "native_tool_invocation",
    "native_tool_observation",
    "tool_call",
    "tool_result",
    "final_summary",
  ],
  assertions: [
    {
      type: "native_tool_invocation",
      payload: { toolName: "git_status" },
      after: "model_response",
    },
    {
      type: "native_tool_invocation",
      payload: { toolName: "code_search" },
      after: "tool_result",
    },
    {
      type: "native_tool_invocation",
      payload: { toolName: "test_run" },
      after: "tool_result",
    },
    {
      type: "final_summary",
      payload: { verified: true },
      after: "native_tool_observation",
    },
  ],
},
```

- [ ] **Step 4: Run agent evals**

Run:

```bash
npm test -- src/main/eval/agentEvalRunner.test.ts
npm run build
node scripts/run-agent-evals.mjs
```

Expected: PASS and agent eval report `failed: 0`. Total fixture count increases by 1.

- [ ] **Step 5: Commit**

```bash
git add src/main/eval/agentEvalFixtures.ts src/main/eval/agentEvalRunner.test.ts
git commit -m "test: add native code engineering eval"
```

---

## Task 11: Documentation And Harness State

**Files:**

- Modify: `README.md`
- Modify: `.zerox/feature_list.json`
- Modify: `.zerox/progress.md`

- [ ] **Step 1: Update feature list**

Add a new feature object to `.zerox/feature_list.json`:

```json
{
  "id": "P2.1-native-code-tools",
  "priority": 5,
  "status": "done",
  "title": "Native code engineering tools and capability score",
  "definitionOfDone": [
    "Native capability descriptors exist",
    "code_search, git_status, git_diff, and test_run are registered",
    "Native tool invocations emit trajectory evidence",
    "Overview shows Agent Capability Score",
    "Agent evals include the code engineering golden path"
  ],
  "verification": [
    "npm test -- src/shared/nativeCapabilities.test.ts src/main/nativeCodeTools.test.ts src/main/nativeGitTools.test.ts src/main/nativeTestRunTool.test.ts",
    "npm test -- src/main/agentRuntimeEngine.test.ts src/main/eval/agentEvalRunner.test.ts src/renderer/materialDesign.test.ts",
    "npm run verify",
    "npm run smoke:prod"
  ]
}
```

- [ ] **Step 2: Update README**

In the English “Recently shipped” list, add:

```md
- [x] Agent Capability P2.1: native code tools, native trajectory evidence, and Agent Capability Score
```

In the Chinese “近期已完成” list, add:

```md
- [x] Agent Capability P2.1：原生代码工具、native trajectory evidence 和 Agent Capability Score
```

- [ ] **Step 3: Update progress evidence**

Append to `.zerox/progress.md`:

```md
## Agent Capability P2.1

- Added native code-engineering tools: `code_search`, `git_status`, `git_diff`, `test_run`.
- Added native capability descriptors and Agent Capability Score.
- Added native trajectory evidence and code engineering eval fixture.
- Verification:
  - `npm run verify`
  - `npm run smoke:prod`
  - `npm run harness:check`
  - `npm run harness:score`
```

- [ ] **Step 4: Run documentation checks**

Run:

```bash
npm test -- src/shared/readme.test.ts src/shared/packageScripts.test.ts
npm run harness:check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md .zerox/feature_list.json .zerox/progress.md
git commit -m "docs: document native code tools"
```

---

## Task 12: Full Verification And Browser QA

**Files:**

- No required source edits unless verification finds failures.

- [ ] **Step 1: Run full verification**

Run:

```bash
npm run harness:check
npm run verify
npm run harness:score
npm run smoke:prod
```

Expected:

- `harness:check`: passed.
- `verify`: all Vitest files pass, build passes, agent evals pass, memory evals pass.
- `harness:score`: passed and reports a non-bad score.
- `smoke:prod`: `Smoke startup passed`.

- [ ] **Step 2: Browser QA Overview**

Start preview:

```bash
npm run dev:renderer
```

Use Browser to open `http://127.0.0.1:5173/#overview` and verify:

- Page title is `Zerox Agent`.
- Overview contains `Harness`.
- Overview contains `Agent Capability`.
- Browser console has no relevant `error` or `warn`.
- At `390x844`, `Agent Capability` card exists and `document.body.scrollWidth <= document.documentElement.clientWidth`.

Stop the preview server after QA.

- [ ] **Step 3: Final status check**

Run:

```bash
git status --short
git log --oneline -5
```

Expected:

- Only intentional untracked local files remain.
- Latest commits are the P2.1 task commits.

---

## Self-Review Checklist

- Spec coverage: P2.1 native descriptors, registry metadata, native code tools, trajectory events, capability score, and golden-path eval all have tasks.
- Deferred scope is explicit: research writing tools, reflection retry policy, and multi-agent handoff are not included in P2.1.
- Type consistency: `NativeToolDescriptor`, `AgentCapabilityScore`, `code_search`, `git_status`, `git_diff`, `test_run`, `native_tool_invocation`, and `native_tool_observation` use the same names throughout.
- Verification is concrete: focused tests, build, evals, harness checks, smoke, and Browser QA are listed with commands and expected outcomes.
