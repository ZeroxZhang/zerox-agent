# Agent Runtime Kernel Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the P8.0 Agent Runtime Kernel contract, event bus, and skeleton run loop without changing existing chat or Goal Mode behavior.

**Architecture:** Create a shared kernel contract in `src/shared`, then add main-process kernel primitives under `src/main/kernel`. The first runtime kernel is dependency-injected and additive: tests exercise the skeleton directly while legacy runtimes continue to run unchanged.

**Tech Stack:** TypeScript, Vitest, Electron shared/main process modules, local-first typed models.

---

## File Structure

- Create `src/shared/kernelContract.ts`
  - Defines `KERNEL_EVENT_VERSION`, `KernelEvent`, `StopDecision`, `RunView`, `PermissionRule`, and `KERNEL_IPC`.
- Create `src/shared/kernelContract.test.ts`
  - Contract shape and discriminated-union tests.
- Create `src/main/kernel/eventBus.ts`
  - Typed local event bus with publish, subscribe, history, and filtered async stream.
- Create `src/main/kernel/eventBus.test.ts`
  - Event order, unsubscribe, history copy, filtering, stream, and subscriber isolation tests.
- Create `src/main/kernel/kernelTypes.ts`
  - Internal runtime context and dependency types.
- Create `src/main/kernel/runtimeKernel.ts`
  - Skeleton run loop with turn start/end events and stop-policy delegation.
- Create `src/main/kernel/runtimeKernel.test.ts`
  - Turn-limit, evidence-policy stop, impossible stop, cancellation, and event ordering tests.
- Modify `.zerox/feature_list.json`
  - Add P8 feature list entries and keep P8.0 unfinished until verification passes.
- Modify `.zerox/progress.md`
  - Add P8.0 evidence after implementation and verification.

## Task 1: Shared Kernel Contract

- [ ] **Step 1: Write failing tests**

Add `src/shared/kernelContract.test.ts` with tests that import `KERNEL_EVENT_VERSION`, `KERNEL_IPC`, and typed helpers. Assert:

```ts
expect(KERNEL_EVENT_VERSION).toBe(1);
expect(KERNEL_IPC.event).toBe("kernel:event");
```

Create compile-time assignments for `turn_start`, `judge_verdict`, `retry`, and `run_end` events, plus `StopDecision` and `RunView`.

- [ ] **Step 2: Run RED**

Run: `npm test -- src/shared/kernelContract.test.ts`

Expected: FAIL because `src/shared/kernelContract.ts` does not exist.

- [ ] **Step 3: Implement contract**

Create `src/shared/kernelContract.ts` with the versioned event union, run view projection, permission rule type, and IPC constants.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- src/shared/kernelContract.test.ts`

Expected: PASS.

## Task 2: Kernel Event Bus

- [ ] **Step 1: Write failing tests**

Add `src/main/kernel/eventBus.test.ts` asserting:

- handlers receive events in publish order
- unsubscribe stops delivery
- history returns a defensive copy
- filtered stream only yields matching events
- one throwing subscriber does not block other subscribers

- [ ] **Step 2: Run RED**

Run: `npm test -- src/main/kernel/eventBus.test.ts`

Expected: FAIL because `src/main/kernel/eventBus.ts` does not exist.

- [ ] **Step 3: Implement event bus**

Create `src/main/kernel/eventBus.ts` with:

```ts
export class KernelEventBus {
  publish(event: KernelEvent): void;
  subscribe(handler: KernelEventHandler): () => void;
  history(): KernelEvent[];
  stream(filter?: (event: KernelEvent) => boolean): AsyncIterable<KernelEvent>;
}
```

- [ ] **Step 4: Run GREEN**

Run: `npm test -- src/main/kernel/eventBus.test.ts src/shared/kernelContract.test.ts`

Expected: PASS.

## Task 3: Runtime Kernel Skeleton

- [ ] **Step 1: Write failing tests**

Add `src/main/kernel/runtimeKernel.test.ts` with injected turn runners and stop policies. Assert:

- chat turn-limit policy runs until stop and emits `turn_start` before `run_end`
- evidence policy can stop with `judge_verdict`
- impossible decisions end with `status: "failed"`
- aborted runs return `status: "canceled"`

- [ ] **Step 2: Run RED**

Run: `npm test -- src/main/kernel/runtimeKernel.test.ts`

Expected: FAIL because `runtimeKernel.ts` and `kernelTypes.ts` do not exist.

- [ ] **Step 3: Implement kernel types and skeleton**

Create internal kernel types and `runRuntimeKernel(ctx, deps)`. Keep the implementation minimal: call `runTurn`, publish events, call `stopPolicy.shouldStop`, and return a typed result.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- src/main/kernel/runtimeKernel.test.ts src/main/kernel/eventBus.test.ts src/shared/kernelContract.test.ts`

Expected: PASS.

## Task 4: Feature Evidence And Verification

- [ ] **Step 1: Mark P8.0 done**

After focused tests pass, update `.zerox/feature_list.json` so P8.0 is `done` and P8.1 remains unfinished.

- [ ] **Step 2: Record progress**

Append changed files and command evidence to `.zerox/progress.md`.

- [ ] **Step 3: Run required checks**

Run:

```bash
npm test -- src/shared/kernelContract.test.ts src/main/kernel/eventBus.test.ts src/main/kernel/runtimeKernel.test.ts
npm run build
npm run verify
npm run harness:check
git diff --check
```

Expected: all pass. `npm run smoke:prod` is not required for P8.0 because this slice does not change UI/runtime behavior.
