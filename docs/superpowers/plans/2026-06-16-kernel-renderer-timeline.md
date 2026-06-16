# Kernel Renderer Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add P8.5 renderer-facing kernel event subscription and a Runs-panel timeline surface for ARK events.

**Architecture:** Keep preload thin by exposing a typed `onKernelEvent` listener and IPC helper names from `kernelContract`. Add a shared reducer that derives `RunView` state from `KernelEvent[]`. Render selected-run kernel event cards in Runs without making renderer the source of truth.

**Tech Stack:** TypeScript, Electron preload, React, Vitest static material design checks, existing Runs panel styles.

---

## File Structure

- Create `src/shared/kernelEventView.ts`
  - Reduce `KernelEvent[]` into `RunView[]` and summarize event cards.
- Create `src/shared/kernelEventView.test.ts`
  - RunView derivation and readable event summary tests.
- Modify `src/preload/index.ts`
  - Add `onKernelEvent`, `resumeKernelRun`, `updateKernelPermissionRules`, and `respondKernelPermission` bridge methods using `KERNEL_IPC`.
- Modify `src/main/container.ts` and `src/main/main.ts`
  - Expose one process-local kernel event bus from the container and forward its events to renderer windows.
- Modify `src/main/toolAuthorizationService.ts`
  - Read runtime permission rules from the container-owned rule set so updates still flow through the authorization service and audit log.
- Modify `src/renderer/components/RunsPanel.tsx`
  - Subscribe to kernel events, use preview demo events, and render selected-run kernel event cards in the inspector.
- Modify `src/renderer/styles/cards.css` and `src/renderer/styles/legacy.css`
  - Add compact kernel event card styles.
- Modify `src/renderer/materialDesign.test.ts`
  - Assert the preload bridge, Runs panel, and styles are present.
- Modify `.zerox/feature_list.json`
  - Add P8.5 plan/test files and mark P8.5 done after verification.
- Modify `.zerox/progress.md`
  - Record changed files and command evidence.

## Task 1: Shared Kernel Event View

- [x] **Step 1: Write failing tests**

Add `src/shared/kernelEventView.test.ts` asserting:

- turn/retry/judge/run_end events reduce into one `RunView`.
- event summaries include compaction, retry, checkpoint, and judge labels.

- [x] **Step 2: Run RED**

Run: `npm test -- src/shared/kernelEventView.test.ts`

Expected: FAIL because `kernelEventView.ts` does not exist.

- [x] **Step 3: Implement reducer**

Create pure shared functions with no renderer or Electron imports.

- [x] **Step 4: Run GREEN**

Run: `npm test -- src/shared/kernelEventView.test.ts src/shared/kernelContract.test.ts`

Expected: PASS.

## Task 2: Preload And Runs UI

- [x] **Step 1: Write failing static tests**

Extend `src/renderer/materialDesign.test.ts` to assert:

- preload imports `KERNEL_IPC` and exposes `onKernelEvent`.
- Runs panel imports `summarizeKernelEventForTimeline` and renders `kernel-event-card`.
- styles define `.kernel-event-card` and `.kernel-event-list`.

- [x] **Step 2: Run RED**

Run: `npm test -- src/renderer/materialDesign.test.ts`

Expected: FAIL because bridge and UI strings are missing.

- [x] **Step 3: Implement bridge and UI**

Add the preload methods and compact Runs inspector section. Use demo kernel events in browser preview so the surface is visible during frontend QA.

- [x] **Step 4: Run GREEN**

Run: `npm test -- src/renderer/materialDesign.test.ts src/shared/kernelEventView.test.ts`

Expected: PASS.

## Task 3: Feature Evidence And Verification

- [x] **Step 1: Update feature metadata**

Add P8.5 plan/test files to `.zerox/feature_list.json`; mark P8.5 `done` only after verification passes.

- [x] **Step 2: Record progress**

Append changed files and command evidence to `.zerox/progress.md`.

- [x] **Step 3: Run required checks**

Run:

```bash
npm test -- src/shared/kernelEventView.test.ts src/renderer/materialDesign.test.ts src/shared/kernelContract.test.ts
npm run build
npm run verify
npm run harness:check
npm run smoke:prod
git diff --check
```

Expected: all pass. Because this changes rendered UI, validate the Runs flow in Browser or an approved fallback.
