# Memory Runtime P3/P4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the user-visible review and governance loop around the P0-P2 memory runtime.

**Architecture:** P3 exposes hidden runtime state: offloaded tool refs become inspectable from trajectories, and the persona profile becomes readable/editable from the memory panel. P4 adds deterministic local quality checks: memory retrieval evals and governance reports for duplicates, conflicts, and stale low-signal records.

**Tech Stack:** Electron main/preload IPC, React renderer, TypeScript shared helpers, Vitest, local JSON/Markdown stores under Electron `userData/config`.

---

## File Structure

- Create `src/shared/toolResultRefs.ts`: safe extraction and summarization helpers for tool-result refs.
- Test `src/shared/toolResultRefs.test.ts`.
- Modify `src/main/main.ts`: add IPC to read `tool-result-refs/*.json`.
- Modify `src/preload/index.ts`: expose `readToolResultRef`.
- Modify `src/renderer/components/RunTrajectoryPanel.tsx`: show a loadable ref viewer for trajectory events with `payload.resultRef`.
- Create `src/shared/memoryProfile.ts`: profile read/save result types.
- Modify `src/main/memoryProfileStore.ts`: add `read()` and `save()` while preserving `updateFromMemories()`.
- Test `src/main/memoryProfileStore.test.ts`.
- Modify `src/main/main.ts` and `src/preload/index.ts`: expose `memoryProfile:read` and `memoryProfile:save`.
- Modify `src/renderer/components/MemoryPanel.tsx`: add persona profile read/edit/save controls.
- Create `src/shared/memoryEval.ts`: deterministic retrieval eval helpers.
- Test `src/shared/memoryEval.test.ts`.
- Create `scripts/run-memory-evals.mjs`: CLI runner for deterministic memory eval fixtures.
- Modify `package.json`: include memory eval in `verify` and add `eval:memory`.
- Create `src/shared/memoryGovernance.ts`: duplicate, conflict, and stale-low-signal report helpers.
- Test `src/shared/memoryGovernance.test.ts`.
- Modify `src/main/memoryStore.ts`: expose `reviewGovernance()`.
- Modify `src/main/main.ts` and `src/preload/index.ts`: expose `memory:governance` and `memory:evaluate`.
- Modify `src/renderer/components/MemoryPanel.tsx`: add governance/eval buttons and reports.

## Task 1: Offloaded Tool Result Ref Viewer

- [ ] **Step 1: Write failing shared helper tests**

Create `src/shared/toolResultRefs.test.ts` with tests for extracting `payload.resultRef`, rejecting unsafe refs, and summarizing parsed JSON.

- [ ] **Step 2: Run red test**

Run: `npm test -- src/shared/toolResultRefs.test.ts`

Expected: FAIL because `toolResultRefs.ts` does not exist.

- [ ] **Step 3: Implement `src/shared/toolResultRefs.ts`**

Export `extractToolResultRef(value)`, `isSafeToolResultRef(ref)`, and `summarizeToolResultContent(raw)`.

- [ ] **Step 4: Wire IPC and trajectory UI**

Add `toolResults:readRef` in `main.ts`, `readToolResultRef` in preload, and a compact ref viewer in `RunTrajectoryPanel`.

- [ ] **Step 5: Run affected tests**

Run: `npm test -- src/shared/toolResultRefs.test.ts src/main/toolResultOffloadStore.test.ts`

Expected: PASS.

## Task 2: Persona Profile Review And Edit

- [ ] **Step 1: Write failing profile store tests**

Extend `src/main/memoryProfileStore.test.ts` to verify `read()` returns default markdown when missing and `save()` persists user-edited content.

- [ ] **Step 2: Run red test**

Run: `npm test -- src/main/memoryProfileStore.test.ts`

Expected: FAIL because `read()` and `save()` are not implemented.

- [ ] **Step 3: Implement profile read/save**

Create shared result types in `src/shared/memoryProfile.ts`, update `MemoryProfileStore`, and preserve the existing preference append behavior.

- [ ] **Step 4: Wire IPC and MemoryPanel controls**

Expose `readMemoryProfile()` and `saveMemoryProfile(content)` to the renderer. Add a textarea and save button in `MemoryPanel`.

- [ ] **Step 5: Run affected tests**

Run: `npm test -- src/main/memoryProfileStore.test.ts src/main/chatService.test.ts`

Expected: PASS.

## Task 3: Memory Retrieval Eval

- [ ] **Step 1: Write failing memory eval tests**

Create `src/shared/memoryEval.test.ts` proving expected memories must appear in the top results and rejected memories fail the case if retrieved.

- [ ] **Step 2: Run red test**

Run: `npm test -- src/shared/memoryEval.test.ts`

Expected: FAIL because `memoryEval.ts` does not exist.

- [ ] **Step 3: Implement deterministic eval helpers**

Export `runMemoryEvals(records, cases)`, `createDefaultMemoryEvalCases(records)`, and `createMemoryEvalFixtures()`.

- [ ] **Step 4: Add CLI and renderer access**

Add `scripts/run-memory-evals.mjs`, `eval:memory`, and `memory:evaluate` IPC. Show pass rate and failed case reasons in `MemoryPanel`.

- [ ] **Step 5: Run affected tests**

Run: `npm test -- src/shared/memoryEval.test.ts src/shared/packageScripts.test.ts`

Expected: PASS.

## Task 4: Memory Governance Report

- [ ] **Step 1: Write failing governance tests**

Create `src/shared/memoryGovernance.test.ts` proving duplicate title groups, conflicting preference groups, and stale low-importance records are reported.

- [ ] **Step 2: Run red test**

Run: `npm test -- src/shared/memoryGovernance.test.ts`

Expected: FAIL because `memoryGovernance.ts` does not exist.

- [ ] **Step 3: Implement governance report**

Export `createMemoryGovernanceReport(records, options)` with deterministic duplicate/conflict/stale detection.

- [ ] **Step 4: Wire store, IPC, and MemoryPanel**

Add `MemoryStore.reviewGovernance()`, `memory:governance` IPC/preload, and a report summary in `MemoryPanel`.

- [ ] **Step 5: Run affected tests**

Run: `npm test -- src/shared/memoryGovernance.test.ts src/main/memoryStore.test.ts`

Expected: PASS.

## Task 5: Full Verification And Commit

- [ ] **Step 1: Run diff check**

Run: `git diff --check`

Expected: PASS.

- [ ] **Step 2: Run all tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 3: Run build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 4: Run verify**

Run: `npm run verify`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add ... && git commit -m "feat: add memory review and governance p3 p4"`

Expected: commit succeeds; unrelated untracked files remain untouched.
