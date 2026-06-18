# v2.3.6 Deterministic Goal Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement v2.3.6 so deterministic local artifact goals are compiled into task contracts, executed with canonical location resources, verified with artifact provenance, and accepted only after packaged-app computer-use validation.

**Architecture:** Add the deterministic path as a narrow layer beside existing Goal Mode instead of replacing Goal Mode. `GoalChatService` compiles an optional `AgentTaskContract`, `AgentGoalPlanner` consumes that contract, shared location resolution canonicalizes user-facing destinations before sandbox/tool/acceptance use, and provenance-backed acceptance prevents stale artifacts from proving completion.

**Tech Stack:** TypeScript, Vitest, Electron Goal Mode, `ToolAuthorizationService`, shared run context sandboxing, local JSON goal stores, trajectory/run graph evidence, computer-use packaged-app validation.

---

## Wave 0 Findings

- Contract boundary: compile `AgentTaskContract` in `src/main/goalChatService.ts` before milestone planning; store it as optional `Goal.taskContract` for backward compatibility.
- Location boundary: replace ad hoc `~`, `Desktop`, `桌面`, and absolute-path handling with one shared resolver before paths enter `extraReadRoots`, `extraWriteRoots`, native artifact writers, or acceptance.
- Provenance boundary: current artifact vocabulary is not a gate; add sidecar manifests and acceptance checks for run/goal identity, canonical destination, and content hash.
- Verification boundary: command-line checks are required but insufficient; final acceptance is an independent packaged-app `computer-use` subagent verdict.

## File Structure

- Create `src/shared/agentTaskContract.ts`
  - Defines `AgentTaskContract`, deterministic local artifact contract types, compiler, and guards.
- Create `src/shared/agentTaskContract.test.ts`
  - Tests Chrome bookmark/Desktop Markdown detection and conservative fallback.
- Modify `src/shared/agentGoal.ts`
  - Adds optional `taskContract?: AgentTaskContract` on `Goal`.
- Modify `src/main/goalChatService.ts`
  - Compiles and stores task contracts for chat-created goals.
- Modify `src/main/agentGoalPlanner.ts`
  - Accepts contract-aware planning and replaces the current Chrome regex shortcut with a contract plan.
- Modify `src/main/agentGoalPlanner.test.ts`, `src/main/goalChatService.test.ts`, `src/main/agentGoalStore.test.ts`
  - Cover contract persistence, planning, and old-goal compatibility.
- Create `src/shared/locationResource.ts`
  - Canonical resolver for workspace, home, desktop, downloads, home-relative, and absolute resources.
- Create `src/shared/locationResource.test.ts`
  - Tests `~/Desktop`, `Desktop`, `桌面`, and absolute Desktop equivalence.
- Modify `src/shared/agentWorkspace.ts`, `src/main/goalOutputRoots.ts`, `src/main/agentGoalAcceptance.ts`, `src/main/agentToolExecutor.ts`, `src/main/goalRuntimeEngine.ts`, `src/shared/toolPermissions.ts`
  - Thread canonical paths through sandbox roots, tool args, artifact roots, and acceptance.
- Create `src/shared/agentArtifactProvenance.ts`
  - Manifest types/helpers for sidecar paths, SHA-256, write, read, and verify.
- Create `src/shared/agentArtifactProvenance.test.ts`
  - Tests sidecar writing and stale/mismatched verification failures.
- Modify `src/main/agentToolExecutor.ts`, `src/main/agentGoalAcceptance.ts`, `src/shared/agentTrajectory.ts`, `src/shared/runGraph.ts`
  - Write provenance for deterministic artifacts and require it during deterministic artifact acceptance.
- Create `src/main/agentDeterministicGoalPipeline.ts`
  - Executes the first contract-driven local artifact pipeline.
- Create `src/main/agentDeterministicGoalPipeline.test.ts`
  - Tests deterministic pipeline success and fallback avoidance.
- Modify `src/main/agentGoalController.ts`, `src/main/goalRuntimeEngine.ts`, `src/shared/agentToolCapabilities.ts`
  - Route eligible deterministic contracts through the pipeline without bypassing authorization/sandboxing.
- Modify `src/main/eval/agentEvalFixtures.ts`, `src/main/eval/agentEvalRunner.test.ts`
  - Add deterministic artifact/provenance eval and forbidden fallback assertions.
- Modify `README.md`, `src/shared/readme.test.ts`, `src/shared/packageScripts.test.ts`, `.zerox/feature_list.json`, `.zerox/progress.md`
  - Document and record v2.3.6 evidence.

## Task 1: Task Contract Compiler

**Subagent:** Agent E: Task Contract Worker  

**Files:**
- Create: `src/shared/agentTaskContract.ts`
- Create: `src/shared/agentTaskContract.test.ts`
- Modify: `src/shared/agentGoal.ts`
- Modify: `src/main/goalChatService.ts`
- Modify: `src/main/agentGoalPlanner.ts`
- Test: `src/main/goalChatService.test.ts`
- Test: `src/main/agentGoalPlanner.test.ts`
- Test: `src/main/agentGoalStore.test.ts`

- [ ] **Step 1: Write failing shared contract tests**

Add tests equivalent to:

```ts
import { describe, expect, it } from "vitest";
import { compileAgentTaskContract } from "./agentTaskContract";

describe("compileAgentTaskContract", () => {
  it("detects Chrome bookmarks Markdown delivery to Desktop", () => {
    const contract = compileAgentTaskContract({
      description:
        "先去获取我 Chrome 浏览器的书签，按照类型分类，然后整理成一份 markdown 格式的文件，然后放在我的桌面上。",
      chatSessionId: "session_1",
      originMessageId: "message_1",
    });

    expect(contract?.taskKind).toBe("local_data_to_artifact");
    expect(contract?.mode).toBe("deterministic");
    expect(contract?.source.type).toBe("chrome_bookmarks");
    expect(contract?.transform.type).toBe("grouped_markdown");
    expect(contract?.deliverable.destination.kind).toBe("desktop");
    expect(contract?.acceptance.provenanceRequired).toBe(true);
    expect(contract?.capabilities.map((capability) => capability.toolName)).toContain(
      "chrome_bookmarks_read",
    );
  });

  it("does not force open-ended goals into deterministic contracts", () => {
    expect(
      compileAgentTaskContract({
        description: "帮我研究一下这个产品方向是否值得做",
      }),
    ).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
npm test -- src/shared/agentTaskContract.test.ts
```

Expected: FAIL because `src/shared/agentTaskContract.ts` does not exist.

- [ ] **Step 3: Implement the shared model and compiler**

Create `src/shared/agentTaskContract.ts` with:

```ts
import type { AcceptanceCheck } from "./agentGoal";

export type AgentTaskContractMode = "deterministic" | "agentic" | "hybrid";

export type AgentTaskContract = {
  schemaVersion: 1;
  id: string;
  taskKind: "local_data_to_artifact";
  mode: AgentTaskContractMode;
  source: { type: "chrome_bookmarks"; profile?: string };
  transform: { type: "grouped_markdown" };
  deliverable: {
    artifactId: "bookmark_list";
    artifactRef: "artifact:bookmark_list";
    mediaType: "text/markdown";
    destination: { kind: "desktop"; filename: "bookmark_list.md" };
  };
  capabilities: Array<{ id: string; toolName: "chrome_bookmarks_read" }>;
  acceptance: {
    evidenceRefs: ["artifact:bookmark_list", "artifact:goalEvidence"];
    provenanceRequired: true;
    checks: AcceptanceCheck[];
  };
  createdFrom: {
    description: string;
    chatSessionId?: string;
    originMessageId?: string;
  };
};

export function compileAgentTaskContract(input: {
  description: string;
  chatSessionId?: string;
  originMessageId?: string;
}): AgentTaskContract | undefined {
  const description = input.description.trim();
  const lower = description.toLowerCase();
  const wantsChromeBookmarks =
    /chrome|谷歌|浏览器/i.test(description) && /书签|bookmark/i.test(description);
  const wantsMarkdown = /markdown|md|markdowng/i.test(lower);
  const wantsDesktop = /桌面|desktop|~\/desktop/i.test(lower);

  if (!wantsChromeBookmarks || !wantsMarkdown || !wantsDesktop) {
    return undefined;
  }

  return {
    schemaVersion: 1,
    id: `contract_${hashContractSeed(description)}`,
    taskKind: "local_data_to_artifact",
    mode: "deterministic",
    source: { type: "chrome_bookmarks" },
    transform: { type: "grouped_markdown" },
    deliverable: {
      artifactId: "bookmark_list",
      artifactRef: "artifact:bookmark_list",
      mediaType: "text/markdown",
      destination: { kind: "desktop", filename: "bookmark_list.md" },
    },
    capabilities: [{ id: "read_chrome_bookmarks", toolName: "chrome_bookmarks_read" }],
    acceptance: {
      evidenceRefs: ["artifact:bookmark_list", "artifact:goalEvidence"],
      provenanceRequired: true,
      checks: [
        {
          id: "check_bookmark_list_artifact",
          kind: "file_exists",
          description: "Complete Chrome bookmark Markdown artifact exists.",
          params: {
            path: "Desktop/bookmark_list.md",
            artifactRef: "artifact:bookmark_list",
            requireProvenance: true,
          },
          requiresEvidence: true,
        },
      ],
    },
    createdFrom: {
      description,
      ...(input.chatSessionId ? { chatSessionId: input.chatSessionId } : {}),
      ...(input.originMessageId ? { originMessageId: input.originMessageId } : {}),
    },
  };
}

function hashContractSeed(value: string): string {
  let hash = 5381;
  for (const char of value) {
    hash = (hash * 33) ^ char.charCodeAt(0);
  }
  return Math.abs(hash >>> 0).toString(36);
}
```

- [ ] **Step 4: Thread the optional contract through Goal**

Modify `src/shared/agentGoal.ts`:

```ts
import type { AgentTaskContract } from "./agentTaskContract";

export type Goal = {
  ...
  taskContract?: AgentTaskContract;
  ...
};
```

- [ ] **Step 5: Add planner/chat tests**

Add focused tests:

```ts
expect(createdGoal.taskContract?.taskKind).toBe("local_data_to_artifact");
expect(createdGoal.taskContract?.deliverable.destination.kind).toBe("desktop");
expect(plannerInput.taskContract?.source.type).toBe("chrome_bookmarks");
```

In `agentGoalPlanner.test.ts`, assert a contract-aware plan produces one native milestone and does not require a model request.

- [ ] **Step 6: Implement planner integration**

Compile the contract in `GoalChatService` before calling `planGoalMilestones`, store it on the goal, and extend planner options:

```ts
plan(input: {
  goalDescription: string;
  tools: AgentToolDefinition[];
  taskContract?: AgentTaskContract;
}): Promise<Milestone[]>
```

When `taskContract?.taskKind === "local_data_to_artifact"`, emit the Chrome bookmark native milestone from the contract instead of relying on description regex.

- [ ] **Step 7: Run GREEN**

Run:

```bash
npm test -- src/shared/agentTaskContract.test.ts src/main/goalChatService.test.ts src/main/agentGoalPlanner.test.ts src/main/agentGoalStore.test.ts
npm run harness:check
git diff --check
```

Expected: all pass.

## Task 2: Unified Location Resource Resolver

**Subagent:** Agent F: Location Resource Worker

**Files:**
- Create: `src/shared/locationResource.ts`
- Create: `src/shared/locationResource.test.ts`
- Modify: `src/shared/agentWorkspace.ts`
- Modify: `src/shared/toolPermissions.ts`
- Modify: `src/main/goalOutputRoots.ts`
- Modify: `src/main/agentGoalAcceptance.ts`
- Modify: `src/main/agentToolExecutor.ts`
- Modify: `src/main/goalRuntimeEngine.ts`
- Test: `src/shared/agentWorkspace.test.ts`
- Test: `src/shared/toolPermissions.test.ts`
- Test: `src/main/goalOutputRoots.test.ts`
- Test: `src/main/agentGoalAcceptance.test.ts`
- Test: `src/main/agentToolExecutor.test.ts`

- [ ] **Step 1: Write failing resolver tests**

Add tests equivalent to:

```ts
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createLocationResolver } from "./locationResource";

describe("locationResource", () => {
  const resolver = createLocationResolver({
    homeDir: "/Users/demo",
    workspaceRoot: "/workspace",
    platform: "darwin",
  });

  it.each([
    "~/Desktop/bookmark_list.md",
    "Desktop/bookmark_list.md",
    "桌面/bookmark_list.md",
    "/Users/demo/Desktop/bookmark_list.md",
  ])("resolves %s to the canonical Desktop file", (input) => {
    const resource = resolver.resolve(input, {
      base: "workspace",
      expected: "file",
      allowNamedLocations: true,
    });
    expect(resource.absolutePath).toBe("/Users/demo/Desktop/bookmark_list.md");
    expect(resource.root.absolutePath).toBe("/Users/demo/Desktop");
    expect(resource.kind).toBe("desktop");
  });

  it("keeps ordinary relative paths workspace-relative", () => {
    expect(
      resolver.resolve("reports/out.md", {
        base: "workspace",
        expected: "file",
        allowNamedLocations: true,
      }).absolutePath,
    ).toBe(path.join("/workspace", "reports/out.md"));
  });
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
npm test -- src/shared/locationResource.test.ts
```

Expected: FAIL because the resolver does not exist.

- [ ] **Step 3: Implement resolver**

Create `src/shared/locationResource.ts` with canonical path output:

```ts
export type LocationKind =
  | "workspace"
  | "home"
  | "desktop"
  | "downloads"
  | "home_relative"
  | "absolute";

export type LocationResource = {
  raw: string;
  kind: LocationKind;
  absolutePath: string;
  canonicalPath: string;
  displayPath: string;
  root: { kind: LocationKind; absolutePath: string; canonicalPath: string };
};
```

Implement exact named-location matching:

- `~/Desktop`, `Desktop/...`, `桌面/...`, and absolute home Desktop -> desktop.
- `~/Downloads`, `Downloads/...`, `下载/...`, and absolute home Downloads -> downloads.
- Other relative paths -> workspace when `base === "workspace"`.
- `~` and `~/...` -> real home path.

- [ ] **Step 4: Thread resolver into output roots and run context**

Update `goalOutputRoots` so `applyGoalOutputRootsToRunContext` stores canonical absolute roots only. `extraWriteRoots` must never contain literal `~`.

- [ ] **Step 5: Thread resolver into acceptance and tool artifact writes**

Update `agentGoalAcceptance` path resolution and `agentToolExecutor` artifact output root handling so Desktop aliases resolve to the same canonical path.

- [ ] **Step 6: Preserve sandbox permissions**

Update permission/path tests so task policy allow plus run-context deny remains deny. Do not add Desktop as a global write root.

- [ ] **Step 7: Run GREEN**

Run:

```bash
npm test -- src/shared/locationResource.test.ts src/shared/agentWorkspace.test.ts src/shared/toolPermissions.test.ts src/main/goalOutputRoots.test.ts src/main/agentGoalAcceptance.test.ts src/main/agentToolExecutor.test.ts
npm run harness:check
git diff --check
```

Expected: all pass.

## Task 3: Artifact Provenance Manifest And Acceptance

**Subagent:** Agent G: Artifact Provenance Worker

**Files:**
- Create: `src/shared/agentArtifactProvenance.ts`
- Create: `src/shared/agentArtifactProvenance.test.ts`
- Modify: `src/main/agentToolExecutor.ts`
- Modify: `src/main/agentToolExecutor.test.ts`
- Modify: `src/main/agentGoalAcceptance.ts`
- Modify: `src/main/agentGoalAcceptance.test.ts`
- Modify: `src/shared/agentTrajectory.ts`
- Modify: `src/shared/runGraph.ts`
- Test: `src/shared/runGraph.test.ts`
- Test: `src/main/agentEpisodeExporter.test.ts`

- [ ] **Step 1: Write failing provenance helper tests**

Add tests equivalent to:

```ts
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getArtifactProvenancePath,
  verifyArtifactProvenance,
  writeArtifactProvenance,
} from "./agentArtifactProvenance";

describe("agentArtifactProvenance", () => {
  it("writes and verifies the artifact sidecar", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "artifact-provenance-"));
    const artifactPath = path.join(root, "bookmark_list.md");
    await writeFile(artifactPath, "# Bookmarks\\n", "utf8");

    const manifestPath = await writeArtifactProvenance({
      artifactPath,
      artifactId: "bookmark_list",
      artifactRef: "artifact:bookmark_list",
      runId: "run_1",
      goalId: "goal_1",
      source: { type: "chrome_bookmarks" },
      generatedAt: "2026-06-18T00:00:00.000Z",
    });

    expect(manifestPath).toBe(getArtifactProvenancePath(artifactPath));
    await expect(
      verifyArtifactProvenance({
        artifactPath,
        artifactId: "bookmark_list",
        artifactRef: "artifact:bookmark_list",
        runId: "run_1",
        goalId: "goal_1",
      }),
    ).resolves.toMatchObject({ ok: true });

    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(manifest.destination.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
npm test -- src/shared/agentArtifactProvenance.test.ts
```

Expected: FAIL because helper does not exist.

- [ ] **Step 3: Implement manifest helpers**

Create sidecar helpers with schema:

```ts
export type AgentArtifactProvenanceManifest = {
  schemaVersion: 1;
  kind: "zerox.artifactProvenance";
  runId: string;
  goalId?: string;
  milestoneId?: string;
  artifactId: string;
  artifactRef: string;
  source: { type: string; path?: string; sha256?: string };
  destination: { path: string; sha256: string; sizeBytes: number };
  generatedAt: string;
};
```

- [ ] **Step 4: Write provenance during deterministic artifact writes**

Update Chrome bookmark artifact writing to produce:

- `bookmark_list.md.provenance.json`
- `goalEvidence.md.provenance.json`

Return `provenancePath` / `provenanceRef` fields in the tool result and include `provenance:*` refs in evidence refs.

- [ ] **Step 5: Require provenance for deterministic file checks**

In `agentGoalAcceptance`, when a `file_exists` check has `requireProvenance: true` or `artifactRef`, verify:

- sidecar exists
- run/goal id match current acceptance context when present
- artifact ref/id match
- canonical destination matches requested path
- current content hash matches manifest

- [ ] **Step 6: Project provenance evidence**

Update trajectory/run graph projection so `artifact_created` events create artifact nodes with provenance refs. Keep episode export as a consumer of trajectory/run-graph evidence, not a new database.

- [ ] **Step 7: Run GREEN**

Run:

```bash
npm test -- src/shared/agentArtifactProvenance.test.ts src/main/agentToolExecutor.test.ts src/main/agentGoalAcceptance.test.ts src/shared/runGraph.test.ts src/main/agentEpisodeExporter.test.ts
npm run harness:check
git diff --check
```

Expected: all pass.

## Task 4: Deterministic Local Artifact Pipeline

**Subagent:** Agent H: Deterministic Pipeline Worker

**Files:**
- Create: `src/main/agentDeterministicGoalPipeline.ts`
- Create: `src/main/agentDeterministicGoalPipeline.test.ts`
- Modify: `src/main/agentGoalController.ts`
- Modify: `src/main/agentGoalController.test.ts`
- Modify: `src/main/goalRuntimeEngine.ts`
- Modify: `src/main/goalRuntimeEngine.test.ts`
- Modify: `src/main/agentToolExecutor.ts`
- Modify: `src/main/agentToolExecutor.test.ts`
- Modify: `src/shared/agentToolCapabilities.ts`
- Modify: `src/shared/agentToolCapabilities.test.ts`

- [ ] **Step 1: Write failing pipeline tests**

Add a test that constructs a Chrome bookmark local artifact contract and asserts:

```ts
expect(result.status).toBe("succeeded");
expect(result.toolNames).toEqual(["chrome_bookmarks_read"]);
expect(result.artifacts.bookmarkList.path).toBe("/Users/demo/Desktop/bookmark_list.md");
expect(result.artifacts.bookmarkList.provenancePath).toBe(
  "/Users/demo/Desktop/bookmark_list.md.provenance.json",
);
expect(result.replans).toBe(0);
```

Add a second non-Chrome deterministic local artifact test using a small JSON input fixture transformed to Markdown so the pipeline is not bookmark-only.

- [ ] **Step 2: Run RED**

Run:

```bash
npm test -- src/main/agentDeterministicGoalPipeline.test.ts
```

Expected: FAIL because pipeline does not exist.

- [ ] **Step 3: Implement a narrow pipeline executor**

Create:

```ts
export async function executeDeterministicGoalPipeline(input: {
  contract: AgentTaskContract;
  runContext: AgentRunContext;
  executeTool: (toolName: string, args: Record<string, unknown>) => Promise<unknown>;
}): Promise<DeterministicGoalPipelineResult>
```

The pipeline must still call through existing tool execution/authorization boundaries; it must not read Chrome bookmark files directly.

- [ ] **Step 4: Route eligible contracts**

Controller/runtime should route only `taskContract.mode === "deterministic"` and known supported `taskKind` into this path. Unknown or unsupported contracts stay on existing Goal Mode execution.

- [ ] **Step 5: Block fallback parser loops**

Preserve existing guard behavior that prevents shell/file parser fallback after native bookmark success. Tests must assert no raw Chrome `Bookmarks` path parsing after native success.

- [ ] **Step 6: Run GREEN**

Run:

```bash
npm test -- src/main/agentDeterministicGoalPipeline.test.ts src/main/agentGoalController.test.ts src/main/goalRuntimeEngine.test.ts src/main/agentToolExecutor.test.ts src/shared/agentToolCapabilities.test.ts
npm run harness:check
git diff --check
```

Expected: all pass.

## Task 5: Eval, Metadata, And Documentation

**Subagent:** Agent I: Eval And Documentation Worker

**Files:**
- Modify: `.zerox/feature_list.json`
- Modify: `.zerox/progress.md`
- Modify: `README.md`
- Modify: `src/shared/readme.test.ts`
- Modify: `src/shared/packageScripts.test.ts`
- Modify: `src/main/eval/agentEvalFixtures.ts`
- Modify: `src/main/eval/agentEvalRunner.test.ts`

- [ ] **Step 1: Add feature metadata**

Add P11 feature entries:

- `P11.1-task-contract-compiler`
- `P11.2-location-resource-model`
- `P11.3-artifact-provenance-acceptance`
- `P11.4-deterministic-local-artifact-pipeline`
- `P11.5-packaged-app-computer-use-acceptance`

- [ ] **Step 2: Add eval fixture**

Add `deterministic-local-artifact-provenance-acceptance` with:

- `goal_planned` including contract payload
- native `chrome_bookmarks_read`
- `artifact_created` with provenance evidence
- `acceptance_checked` with `provenanceBacked: true`
- `goal_stopped` with `goal_accepted`
- forbidden or max-count assertion for `goal_replanned`, raw Chrome file parser fallback, and shell fallback after native success

- [ ] **Step 3: Update docs**

README must document:

- Deterministic local artifact goals.
- Location/resource canonicalization.
- Provenance-backed acceptance.
- Independent computer-use packaged-app acceptance as the final release gate.

- [ ] **Step 4: Run GREEN**

Run:

```bash
npm test -- src/main/eval/agentEvalRunner.test.ts src/shared/readme.test.ts src/shared/packageScripts.test.ts
node scripts/run-agent-evals.mjs
npm run harness:check
git diff --check
```

Expected: all pass.

## Task 6: Command-Line Verification Gate

**Subagent:** Agent L: Command-Line Verification Gatekeeper

**Files:**
- No production edits expected.
- May append final command evidence to `.zerox/progress.md` after pass.

- [ ] **Step 1: Run integrated verification**

Run:

```bash
./init.sh
npm test
npm run build
node scripts/run-agent-evals.mjs
node scripts/run-memory-evals.mjs
npm run verify
npm run smoke:prod
npm run harness:check
git diff --check
```

Expected: all pass.

- [ ] **Step 2: Report command evidence**

Return exact command statuses, test counts, and any warnings. Do not declare v2.3.6 complete.

## Task 7: Independent Packaged-App Computer-Use Acceptance

**Subagent:** Agent M: Independent Computer-Use Acceptance Subagent

**Files:**
- No source edits.
- Final evidence may be summarized into `.zerox/progress.md` by the parent after acceptance.

- [ ] **Step 1: Build and launch packaged app**

Run:

```bash
npm run pack:mac
open "release/mac-arm64/Zerox Agent.app"
```

If the `.app` path differs, inspect `release/` and launch the generated packaged app. Do not use `npm run dev`, `npm start`, or direct goal JSON edits.

- [ ] **Step 2: Use computer-use for UI task creation**

Before each UI interaction turn, call:

```text
mcp__computer_use.get_app_state
```

Through the product UI, enter:

```text
先去获取我 Chrome 浏览器的书签，按照类型分类，然后整理成一份 markdown 格式的文件，然后放在我的桌面上。
```

Approve only necessary Chrome bookmark/Desktop write permissions.

- [ ] **Step 3: Collect hard evidence**

Required evidence:

- packaged app screenshot/accessibility tree
- task entered through Chat/Goal UI
- permission prompts if shown
- final goal achieved/accepted UI state
- Desktop Markdown absolute path, mtime after task start, size, and content sanity
- provenance manifest path and fields
- content hash match
- ledger/trajectory current-run match
- tool summary proving no repeated replan/fallback loop

- [ ] **Step 4: Return verdict**

Return exactly one:

```text
ACCEPTED
```

or

```text
REJECTED
```

If rejected, include exact evidence and the smallest failing requirement. v2.3.6 is not complete unless this subagent returns `ACCEPTED`.

## Final Completion Checklist

- [ ] Task 1 reviewed by spec reviewer and code quality reviewer.
- [ ] Task 2 reviewed by spec reviewer and code quality reviewer.
- [ ] Task 3 reviewed by spec reviewer and code quality reviewer.
- [ ] Task 4 reviewed by spec reviewer and code quality reviewer.
- [ ] Task 5 reviewed by spec reviewer and code quality reviewer.
- [ ] Task 6 command-line gate passes.
- [ ] Task 7 independent computer-use gate returns `ACCEPTED`.
- [ ] `.zerox/progress.md` records command evidence and black-box acceptance evidence.
- [ ] `.zerox/feature_list.json` marks P11 entries done only after evidence exists.

If any item is missing, v2.3.6 remains incomplete.
