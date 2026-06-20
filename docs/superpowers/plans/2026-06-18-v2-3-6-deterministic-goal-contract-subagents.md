# v2.3.6 Deterministic Goal Contract Subagent Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Coordinate the v2.3.6 iteration with independent subagents so deterministic local artifact goals are contract-driven, provenance-verified, and finally accepted only by an independent computer-use UI validation subagent.

**Architecture:** The parent agent remains the integration owner. Explorers map code boundaries first, workers then implement disjoint slices, reviewers gate each worker output, and a final acceptance subagent launches the local packaged app through computer-use and creates a real user task from the UI. The final acceptance subagent is the release gate: if it fails, v2.3.6 is not complete.

**Tech Stack:** TypeScript, Vitest, Electron, local Goal Mode stores, ToolAuthorizationService, AgentGoalPlanner/Controller/Acceptance, computer-use desktop automation.

---

## Scope

v2.3.6 is not a Chrome-bookmark-only patch. It introduces the first deterministic local artifact goal path:

```text
natural-language goal
  -> structured task contract
  -> unified location/resource resolution
  -> capability/pipeline execution
  -> artifact provenance manifest
  -> provenance-backed acceptance
  -> independent packaged-app UI validation
```

The first golden path is:

```text
获取 Chrome 书签 -> 按类型/文件夹整理 -> Markdown -> 放到桌面 -> 由本次 run provenance 验收
```

The second non-Chrome regression path is:

```text
读取本地 JSON 或文件夹清单 -> Markdown artifact -> 指定本地位置 -> provenance 验收
```

## Non-Goals

- Do not solve reliability by adding more shell fallbacks.
- Do not make `maxReplans` or `maxToolCalls` the primary fix.
- Do not bypass `ToolAuthorizationService` or workspace sandbox checks.
- Do not let stale `file_exists` checks prove goal completion.
- Do not let the final UI acceptance subagent inspect implementation details as a substitute for using the product.

## Parent Agent Responsibilities

The parent agent owns coordination, integration, conflict resolution, and final completion claims.

- [ ] Keep the worktree cleanly staged by feature slice.
- [ ] Spawn only focused subagents with explicit file ownership.
- [ ] Never dispatch two worker subagents that edit the same production files in parallel.
- [ ] Run `./init.sh` before development and after major integration points.
- [ ] After implementation, require all reviewer gates and the final computer-use acceptance gate to pass before declaring v2.3.6 complete.
- [ ] Update `.zerox/feature_list.json` and `.zerox/progress.md` with changed files and command evidence.

## Subagent Roster

### Agent A: Contract Cartographer

**Type:** explorer  
**Phase:** Read-only, first wave, parallel  
**Purpose:** Map where a structured task contract should enter Goal creation, planning, runtime dispatch, and stored goal records.

**Read Scope:**

- `src/shared/agentGoal.ts`
- `src/main/goalChatService.ts`
- `src/main/agentGoalPlanner.ts`
- `src/main/agentGoalController.ts`
- `src/main/goalRuntimeEngine.ts`
- `src/main/container.ts`
- `src/main/goalChatService.test.ts`
- `src/main/agentGoalPlanner.test.ts`
- `docs/architecture/agent-goal-mode.md`

**Output Required:**

- Proposed `AgentTaskContract` fields.
- Exact production files that need contract threading.
- Tests that should fail before implementation.
- Risks where contract storage could break old goal JSON.

**Do Not:**

- Edit files.
- Design artifact provenance.
- Design UI acceptance.

**Prompt:**

```text
You are Contract Cartographer for Zerox Agent v2.3.6. Read only the listed files. Map how to add a structured AgentTaskContract for deterministic local artifact goals. Return proposed fields, exact files to touch, focused failing tests, and backward-compatibility risks. Do not edit files.
```

### Agent B: Location And Sandbox Cartographer

**Type:** explorer  
**Phase:** Read-only, first wave, parallel  
**Purpose:** Map all current path/location normalization and sandbox acceptance inconsistencies, especially `~`, `~/Desktop`, `桌面`, Desktop, and explicit absolute paths.

**Read Scope:**

- `src/shared/agentWorkspace.ts`
- `src/shared/toolPermissions.ts`
- `src/main/goalOutputRoots.ts`
- `src/main/agentGoalAcceptance.ts`
- `src/main/agentToolExecutor.ts`
- `src/main/goalRuntimeEngine.ts`
- `src/main/goalOutputRoots.test.ts`
- `src/shared/agentWorkspace.test.ts`
- `src/shared/toolPermissions.test.ts`
- `src/main/agentGoalAcceptance.test.ts`

**Output Required:**

- Single resolver boundary recommendation.
- Exact places currently doing independent path interpretation.
- Test cases for `~/Desktop`, `桌面`, and absolute Desktop equivalence.
- Sandbox risks and permission-gate requirements.

**Do Not:**

- Edit files.
- Recommend bypassing workspace or authorization checks.

**Prompt:**

```text
You are Location And Sandbox Cartographer for Zerox Agent v2.3.6. Read only the listed files. Find every independent path/location interpretation that affects goal output roots, extraWriteRoots, tool artifact writes, and acceptance. Return the recommended single resolver boundary and concrete failing tests for Desktop/home path equivalence. Do not edit files.
```

### Agent C: Provenance Cartographer

**Type:** explorer  
**Phase:** Read-only, first wave, parallel  
**Purpose:** Map artifact creation, artifact refs, evidence refs, trajectory evidence, and acceptance so provenance can become a real completion gate.

**Read Scope:**

- `src/shared/agentRuns.ts`
- `src/shared/agentTrajectory.ts`
- `src/shared/runGraph.ts`
- `src/main/agentToolExecutor.ts`
- `src/main/agentGoalAcceptance.ts`
- `src/main/agentEpisodeExporter.ts`
- `src/main/agentLoop.ts`
- `src/main/agentToolExecutor.test.ts`
- `src/main/agentGoalAcceptance.test.ts`
- `src/main/agentEpisodeExporter.test.ts`
- `src/shared/runGraph.test.ts`

**Output Required:**

- Proposed artifact provenance manifest shape.
- Where provenance should be written.
- Where provenance should be loaded for acceptance.
- Tests that prevent stale artifacts from passing.

**Do Not:**

- Edit files.
- Expand the feature into a general artifact database.

**Prompt:**

```text
You are Provenance Cartographer for Zerox Agent v2.3.6. Read only the listed files. Map the smallest artifact provenance manifest that can prove current-run source, destination, generatedAt, and content hash for deterministic local artifact goals. Return exact files and tests. Do not edit files.
```

### Agent D: Test Strategy Cartographer

**Type:** explorer  
**Phase:** Read-only, first wave, parallel  
**Purpose:** Design the verification ladder for unit, integration, eval, smoke, and final UI acceptance, including how the final computer-use subagent should run.

**Read Scope:**

- `package.json`
- `src/main/eval/agentEvalFixtures.ts`
- `src/main/eval/agentEvalRunner.test.ts`
- `src/shared/packageScripts.test.ts`
- `src/main/smokeMode.ts`
- `src/main/smokeMode.test.ts`
- `scripts/run-agent-evals.mjs`
- `docs/architecture/agent-goal-mode.md`

**Output Required:**

- Focused test commands per implementation slice.
- One new deterministic eval fixture proposal.
- Final packaged-app UI acceptance script outline.
- Evidence the final subagent must collect.

**Do Not:**

- Edit files.
- Treat CLI tests as a substitute for final computer-use UI acceptance.

**Prompt:**

```text
You are Test Strategy Cartographer for Zerox Agent v2.3.6. Read only the listed files. Design the verification ladder for deterministic local artifact goals and specify the final independent computer-use packaged-app acceptance protocol. Do not edit files.
```

### Agent E: Task Contract Worker

**Type:** worker  
**Phase:** Implementation wave 1  
**Write Ownership:**

- `src/shared/agentTaskContract.ts`
- `src/shared/agentTaskContract.test.ts`
- `src/shared/agentGoal.ts`
- `src/main/goalChatService.ts`
- `src/main/agentGoalPlanner.ts`
- `src/main/goalChatService.test.ts`
- `src/main/agentGoalPlanner.test.ts`

**Purpose:** Add the structured contract model and conservative compiler for deterministic local artifact goals.

**Required Behavior:**

- Detect Chrome-bookmark-to-Markdown-to-Desktop goals as `local_data_to_artifact`.
- Represent source, transform, deliverable, destination, and acceptance requirements.
- Store the contract on goal records without breaking old goal JSON.
- Keep non-deterministic/open-ended goals on the existing planner path.

**Verification:**

```bash
npm test -- src/shared/agentTaskContract.test.ts src/main/goalChatService.test.ts src/main/agentGoalPlanner.test.ts
npm run harness:check
git diff --check
```

### Agent F: Location Resource Worker

**Type:** worker  
**Phase:** Implementation wave 1, may run after Agent B output is reviewed  
**Write Ownership:**

- `src/shared/locationResource.ts`
- `src/shared/locationResource.test.ts`
- `src/shared/agentWorkspace.ts`
- `src/shared/agentWorkspace.test.ts`
- `src/main/goalOutputRoots.ts`
- `src/main/goalOutputRoots.test.ts`
- `src/main/agentGoalAcceptance.ts`
- `src/main/agentGoalAcceptance.test.ts`

**Purpose:** Introduce one canonical location/resource resolver and thread it through goal output roots, sandbox roots, and acceptance.

**Required Behavior:**

- Normalize `~`, `~/Desktop`, `桌面`, `Desktop`, and absolute Desktop paths to the same canonical destination on macOS.
- Ensure `extraWriteRoots` never contains literal `~`.
- Keep workspace boundary checks strict.
- Keep explicit user-requested external roots permissioned, observable, and accepted only when authorized.

**Verification:**

```bash
npm test -- src/shared/locationResource.test.ts src/shared/agentWorkspace.test.ts src/main/goalOutputRoots.test.ts src/main/agentGoalAcceptance.test.ts
npm run harness:check
git diff --check
```

### Agent G: Artifact Provenance Worker

**Type:** worker  
**Phase:** Implementation wave 2, depends on Agent E and Agent F integration  
**Write Ownership:**

- `src/shared/agentArtifactProvenance.ts`
- `src/shared/agentArtifactProvenance.test.ts`
- `src/main/agentToolExecutor.ts`
- `src/main/agentToolExecutor.test.ts`
- `src/main/agentGoalAcceptance.ts`
- `src/main/agentGoalAcceptance.test.ts`
- `src/shared/agentTrajectory.ts`
- `src/shared/runGraph.ts`
- `src/shared/runGraph.test.ts`

**Purpose:** Record and verify provenance for deterministic artifacts so stale files cannot satisfy completion.

**Required Behavior:**

- Write a sidecar manifest for deterministic artifacts.
- Include `runId`, `goalId`, `artifactId`, `source.type`, optional `source.hash`, canonical destination, content hash, and `generatedAt`.
- Acceptance must fail when the target file exists but the manifest is missing, stale, from another run, or points to a different destination.
- Trajectory/run graph should expose provenance evidence refs without becoming a new artifact database.

**Verification:**

```bash
npm test -- src/shared/agentArtifactProvenance.test.ts src/main/agentToolExecutor.test.ts src/main/agentGoalAcceptance.test.ts src/shared/runGraph.test.ts
npm run harness:check
git diff --check
```

### Agent H: Deterministic Pipeline Worker

**Type:** worker  
**Phase:** Implementation wave 3, depends on Agents E, F, and G  
**Write Ownership:**

- `src/main/agentDeterministicGoalPipeline.ts`
- `src/main/agentDeterministicGoalPipeline.test.ts`
- `src/main/agentGoalController.ts`
- `src/main/agentGoalController.test.ts`
- `src/main/goalRuntimeEngine.ts`
- `src/main/goalRuntimeEngine.test.ts`
- `src/main/agentToolExecutor.ts`
- `src/main/agentToolExecutor.test.ts`
- `src/shared/agentToolCapabilities.ts`
- `src/shared/agentToolCapabilities.test.ts`

**Purpose:** Add the first L1 deterministic local artifact pipeline so eligible tasks execute as contract-driven capability chains rather than open-ended replan loops.

**Required Behavior:**

- Chrome bookmark artifact goals execute with one native bookmark read/write path and no shell/file parser fallback.
- Pipeline writes the user-requested deliverable plus provenance evidence.
- Pipeline returns a concise final result to Chat/Goal Mode.
- Non-eligible goals continue through existing Goal Mode behavior.
- Add at least one non-Chrome deterministic local artifact fixture or test path so the design is not hardcoded to bookmarks.

**Verification:**

```bash
npm test -- src/main/agentDeterministicGoalPipeline.test.ts src/main/agentGoalController.test.ts src/main/goalRuntimeEngine.test.ts src/main/agentToolExecutor.test.ts src/shared/agentToolCapabilities.test.ts
npm run harness:check
git diff --check
```

### Agent I: Eval And Documentation Worker

**Type:** worker  
**Phase:** Implementation wave 4  
**Write Ownership:**

- `.zerox/feature_list.json`
- `.zerox/progress.md`
- `README.md`
- `src/shared/readme.test.ts`
- `src/shared/packageScripts.test.ts`
- `src/main/eval/agentEvalFixtures.ts`
- `src/main/eval/agentEvalRunner.test.ts`

**Purpose:** Register the v2.3.6 features, add deterministic eval coverage, update public docs, and record evidence.

**Required Behavior:**

- Add P11 feature entries for task contract, location resource model, provenance acceptance, deterministic pipeline, and packaged-app acceptance.
- Add eval coverage proving deterministic local artifact goals avoid redundant fallback loops.
- Update README with the v2.3.6 behavior only after the implementation is verified.
- Keep progress evidence concrete: commands, test counts, and black-box acceptance result.

**Verification:**

```bash
npm test -- src/main/eval/agentEvalRunner.test.ts src/shared/readme.test.ts src/shared/packageScripts.test.ts
node scripts/run-agent-evals.mjs
npm run harness:check
git diff --check
```

### Agent J: Per-Slice Spec Reviewer

**Type:** default or explorer  
**Phase:** After each worker  
**Purpose:** Review whether the worker output exactly satisfies its slice spec and did not underbuild or overbuild.

**Input Required:**

- Worker assignment text.
- Worker final summary.
- `git diff -- <worker-owned-files>`.
- Focused test output.

**Output Required:**

- `APPROVED` or `CHANGES_REQUIRED`.
- Missing requirements.
- Extra behavior that should be removed.
- Any evidence that tests are too narrow.

**Prompt:**

```text
You are the per-slice spec reviewer. Compare the worker's diff against the worker assignment only. Do not review style unless it affects spec compliance. Return APPROVED or CHANGES_REQUIRED with exact file/line references and required fixes.
```

### Agent K: Per-Slice Code Quality Reviewer

**Type:** default  
**Phase:** After Agent J approves each worker  
**Purpose:** Review implementation quality, maintainability, test robustness, and integration risk.

**Input Required:**

- Worker-owned diff.
- Passing focused test output.
- Any spec reviewer notes.

**Output Required:**

- `APPROVED` or `CHANGES_REQUIRED`.
- Bugs, race risks, boundary mistakes, or weak tests.
- Exact file/line references for each issue.

**Prompt:**

```text
You are the per-slice code quality reviewer. Review the approved spec diff for bugs, maintainability risks, weak tests, and integration hazards. Return APPROVED or CHANGES_REQUIRED with exact file/line references and fixes.
```

### Agent L: Command-Line Verification Gatekeeper

**Type:** worker or default  
**Phase:** After all implementation and documentation workers pass review  
**Purpose:** Run the full non-UI verification ladder and report exact evidence.

**Commands:**

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

**Output Required:**

- Command-by-command pass/fail.
- Test file and test count summary.
- Any flake, warning, or skipped behavior.
- Confirmation that command-line verification is not the final acceptance gate.

**Prompt:**

```text
You are the command-line verification gatekeeper for v2.3.6. Run the listed commands from a clean integrated worktree. Report exact pass/fail evidence and do not declare release acceptance; the final computer-use packaged-app subagent owns acceptance.
```

### Agent M: Independent Computer-Use Acceptance Subagent

**Type:** default  
**Phase:** Final release gate, after Agent L passes  
**Purpose:** Represent the user, launch the local packaged app, create a real task through the UI, approve required permissions, and decide whether v2.3.6 is acceptable.

**Required Capability:**

- Must use `computer-use:computer-use`.
- If computer-use tools are not visible, first use tool discovery for computer-use.
- Must call `mcp__computer_use.get_app_state` once before interacting with the app in each turn.
- Must create the task from the product UI, not by directly mutating goal JSON.

**Launch Protocol:**

```bash
npm run pack:mac
open "release/mac-arm64/Zerox Agent.app"
```

If the packaged path differs, inspect `release/` and launch the generated `.app`. Do not use `npm run dev` for the final gate.

**Primary User Task:**

```text
先去获取我 Chrome 浏览器的书签，按照类型分类，然后整理成一份 markdown 格式的文件，然后放在我的桌面上。
```

**Required Acceptance Evidence:**

- Screenshot or accessibility evidence that the packaged app is running.
- Screenshot or accessibility evidence that the task was entered through Chat/Goal UI.
- Permission prompt evidence showing expected Chrome bookmark/Desktop write authorization, if prompted.
- Final UI evidence that the goal reached achieved/accepted state.
- Desktop file path, mtime, and size for the generated Markdown.
- Provenance manifest path and fields proving current run, correct source type, correct destination, and content hash.
- Goal ledger or trajectory evidence showing no repeated fallback loop.
- Tool usage summary showing no shell/file parser fallback for Chrome bookmarks unless the final implementation explicitly and safely permits a non-parser verification step.
- Final verdict: `ACCEPTED` or `REJECTED`.

**Hard Reject Conditions:**

- The app cannot be launched from the packaged local app.
- The task is not created through the UI.
- The output file is not on Desktop.
- The output can be satisfied by a stale pre-existing file.
- Provenance is missing, stale, or does not match the final file.
- The run enters repeated replans for this deterministic task.
- The implementation requires shell/file parsing of raw Chrome bookmark JSON after native bookmark capability succeeds.
- The final subagent cannot collect enough evidence to prove acceptance.

**Prompt:**

```text
You are the independent v2.3.6 acceptance subagent representing the user. You did not implement the feature. Your job is to launch the local packaged Zerox Agent app, use computer-use to create the Chrome-bookmarks-to-Desktop Markdown task through the UI, approve only the necessary permission prompts, and decide whether the release is acceptable. You must collect UI evidence, Desktop artifact evidence, provenance manifest evidence, and goal trajectory evidence. Return ACCEPTED only if all required evidence proves the task completed from the packaged app without stale artifact acceptance or repeated fallback loops. Otherwise return REJECTED with exact evidence.
```

## Dispatch Order

### Wave 0: Read-Only Parallel Exploration

- [x] Spawn Agent A, B, C, and D in parallel.
- [x] Parent reviews their outputs and resolves overlaps.
- [x] Parent creates the detailed implementation plan from their findings.

### Wave 1: Independent Primitives

- [ ] Spawn Agent E for task contract.
- [ ] Spawn Agent F for location resource model after Agent B output is reviewed.
- [ ] Review each with Agent J then Agent K before integration.

### Wave 2: Provenance

- [ ] Spawn Agent G after E and F pass review.
- [ ] Review with Agent J then Agent K.

### Wave 3: Deterministic Pipeline

- [ ] Spawn Agent H after E, F, and G pass review.
- [ ] Review with Agent J then Agent K.

### Wave 4: Eval, Documentation, And Metadata

- [ ] Spawn Agent I after implementation behavior is stable.
- [ ] Review with Agent J then Agent K.

### Wave 5: Verification Gates

- [ ] Spawn Agent L for command-line verification.
- [ ] Fix any failures through focused workers and repeat affected reviews.
- [ ] Spawn Agent M for independent computer-use packaged-app acceptance.
- [ ] Declare v2.3.6 complete only if Agent M returns `ACCEPTED`.

## Completion Standard

v2.3.6 is complete only when all of these are true:

- [ ] All implementation workers are spec-reviewed and code-quality-reviewed.
- [ ] `./init.sh` passes.
- [ ] Focused tests for every slice pass.
- [ ] `npm test` passes.
- [ ] `npm run build` passes.
- [ ] `node scripts/run-agent-evals.mjs` passes.
- [ ] `node scripts/run-memory-evals.mjs` passes.
- [ ] `npm run verify` passes.
- [ ] `npm run smoke:prod` passes.
- [ ] `npm run harness:check` passes.
- [ ] `git diff --check` passes.
- [ ] `.zerox/feature_list.json` and `.zerox/progress.md` record final evidence.
- [ ] Agent M launches the packaged local app and returns `ACCEPTED`.

If Agent M returns `REJECTED`, the iteration remains incomplete even if all command-line checks pass.
