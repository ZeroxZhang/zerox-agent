# Agent Runtime Kernel 2.3 Design

## Goal

Zerox Agent 2.3.0 introduces an Agent Runtime Kernel (ARK) as the shared execution foundation for chat runs, recoverable task runs, and Goal Mode. The target is long-task reliability: context does not overflow silently, stop decisions are evidence-backed, transient provider failures recover, kernel events are observable, and permission decisions remain explicit and local-first.

The attached 2.3.0 roadmap is treated as the approved product direction for this iteration. This spec narrows the first implementation slice to a strangler-style foundation that can land without changing existing runtime behavior.

## Scope

The full 2.3.0 iteration is split into P8 features in `.zerox/feature_list.json`:

- P8.0: shared ARK contract, main-process event bus, and runtime-kernel skeleton.
- P8.1: checkpoint-backed compaction and rebuild.
- P8.2: retry-after-aware resilience and dynamic turn budgeting.
- P8.3: evidence-driven stop policy.
- P8.4: rule-based permission engine integrated with existing approval flow.
- P8.5: renderer timeline and preload bridge for kernel events.
- P8.6: release acceptance, long-task evals, documentation, and independent test-engineer review.

Per `AGENTS.md`, only one unfinished feature is implemented at a time. P8.0 is the first feature.

## P8.0 Architecture

P8.0 adds the minimum ARK foundation:

- `src/shared/kernelContract.ts` is the cross-process contract source for versioned `KernelEvent`, `StopDecision`, `RunView`, `PermissionRule`, and IPC channel constants.
- `src/main/kernel/eventBus.ts` is a small typed publish/subscribe bus with immutable history and async stream support. It has no Electron dependency, so it can be unit-tested and later bridged to IPC.
- `src/main/kernel/kernelTypes.ts` defines internal `RunContext`, `TurnResult`, `StopPolicy`, and runtime-kernel dependency types.
- `src/main/kernel/runtimeKernel.ts` provides a skeleton run loop that emits `turn_start` and `run_end`, calls an injected turn runner, and delegates stopping to a `StopPolicy`.

Existing `agentLoop.ts`, `agentRuntimeEngine.ts`, and `goalRuntimeEngine.ts` stay behavior-compatible in P8.0. Later P8 features move behavior behind the kernel one capability at a time.

## Boundaries

- No cloud workers.
- No unreviewed self-modification.
- No bypass around `ToolAuthorizationService` or workspace sandbox checks.
- Kernel events are local-only typed data and do not upload transcripts or tool results.
- Renderer state will subscribe to kernel events in P8.5; P8.0 only defines the shared contract and main-process primitives.

## Reference Notes

MiMo-Code informed the shape, not the implementation:

- `packages/opencode/src/bus/index.ts` uses a typed PubSub with wildcard subscription.
- `packages/opencode/src/session/goal.ts` keeps stop-condition judging separate from the working agent.
- `packages/opencode/src/session/retry.ts` centralizes retryable transient error and retry-after delay handling.
- `packages/opencode/src/session/compaction.ts` keeps recent turns protected and compacts older context progressively.

Zerox keeps its own Electron, TypeScript, local storage, checkpoint, trajectory, and authorization architecture.

## P8.0 Acceptance

- Shared contract tests cover event versioning, run-view projection shape, permission rule shape, and IPC constants.
- Event bus tests cover publish, subscribe, unsubscribe, event history, filtered async streams, and subscriber isolation.
- Runtime-kernel tests cover chat turn-limit completion, goal stop-policy completion, impossible stop decisions, cancellation, and emitted event ordering.
- Existing runtime tests continue to pass because P8.0 is additive.
- `.zerox/progress.md` records changed files and command evidence.
