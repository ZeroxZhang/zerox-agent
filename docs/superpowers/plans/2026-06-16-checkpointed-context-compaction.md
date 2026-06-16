# Checkpointed Context Compaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add P8.1 checkpoint-backed context compaction primitives that can preserve long-task recoverability before older context is pruned or summarized.

**Architecture:** Add a local kernel checkpoint store that writes full pre-compaction message snapshots under userData-style config directories. Add a compaction engine that estimates token pressure, writes a checkpoint before pruning, preserves never-compact goal continuity anchors and recent turns, replaces older bulky tool results with checkpoint refs, and emits kernel checkpoint/compaction events.

**Tech Stack:** TypeScript, Vitest, local JSON checkpoint files, existing `ChatMessage` and `ContextManager` utilities, P8.0 `KernelEventBus`.

---

## File Structure

- Create `src/main/kernel/checkpointStore.ts`
  - Local JSON checkpoint persistence and `rebuild(ref)` for full message recovery.
- Create `src/main/kernel/checkpointStore.test.ts`
  - Write/read/rebuild, missing refs, and path traversal guard tests.
- Create `src/main/kernel/compactionEngine.ts`
  - Triggered compaction with checkpoint-first writes, goal-anchor preservation, recent-turn preservation, tool-result checkpoint refs, and kernel events.
- Create `src/main/kernel/compactionEngine.test.ts`
  - Trigger behavior, preserved anchors/recent turns, rebuild equality, and no-op behavior below threshold.
- Modify `.zerox/feature_list.json`
  - Add the P8.1 plan and focused test files to the feature metadata, then mark P8.1 done after verification.
- Modify `.zerox/progress.md`
  - Record changed files and command evidence after verification.

## Task 1: Checkpoint Store

- [ ] **Step 1: Write failing tests**

Add `src/main/kernel/checkpointStore.test.ts` asserting:

- `writeCheckpoint` stores full `ChatMessage[]` and returns a local relative ref.
- `rebuild(ref)` returns the original messages.
- missing refs return `null`.
- refs outside the checkpoint root return `null`.

- [ ] **Step 2: Run RED**

Run: `npm test -- src/main/kernel/checkpointStore.test.ts`

Expected: FAIL because `checkpointStore.ts` does not exist.

- [ ] **Step 3: Implement checkpoint store**

Create `createKernelCheckpointStore({ configDir, createId, now })` with local JSON files under `kernel-checkpoints/<runId>/<ref>.json`.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- src/main/kernel/checkpointStore.test.ts`

Expected: PASS.

## Task 2: Compaction Engine

- [ ] **Step 1: Write failing tests**

Add `src/main/kernel/compactionEngine.test.ts` asserting:

- triggered compaction writes checkpoint before shrinking messages.
- goal continuity anchors containing `[Goal continuity checkpoint - never compact]` remain unchanged.
- recent tail turns remain unchanged.
- older bulky tool result content is replaced by a checkpoint ref.
- `checkpointStore.rebuild(ref)` restores the original bulky tool result.
- below-threshold inputs return unchanged messages and write no checkpoint.

- [ ] **Step 2: Run RED**

Run: `npm test -- src/main/kernel/compactionEngine.test.ts`

Expected: FAIL because `compactionEngine.ts` does not exist.

- [ ] **Step 3: Implement compaction engine**

Create `compactKernelContext(ctx, cfg)` with checkpoint-first compaction and event publication through an optional `KernelEventBus`.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- src/main/kernel/compactionEngine.test.ts src/main/kernel/checkpointStore.test.ts src/main/kernel/eventBus.test.ts`

Expected: PASS.

## Task 3: Feature Evidence And Verification

- [ ] **Step 1: Update feature metadata**

Add the P8.1 plan and test files to `.zerox/feature_list.json`; mark P8.1 `done` only after verification passes.

- [ ] **Step 2: Record progress**

Append changed files and command evidence to `.zerox/progress.md`.

- [ ] **Step 3: Run required checks**

Run:

```bash
npm test -- src/main/kernel/checkpointStore.test.ts src/main/kernel/compactionEngine.test.ts src/main/kernel/eventBus.test.ts src/shared/kernelContract.test.ts
npm run build
npm run verify
npm run harness:check
git diff --check
```

Expected: all pass. `npm run smoke:prod` is not required because P8.1 adds main-process primitives without renderer changes.
