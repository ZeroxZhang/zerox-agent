# RC03 Decision: Unified Tool Runtime Pipeline

Status: Accepted

Date: 2026-08-14

## Context

Tool execution currently has five production authorization and dispatch
implementations:

1. `runAgentLoop`
2. `AgentRunnerService`
3. `AgentRuntimeEngine`
4. the deterministic branch of `GoalRuntimeEngine`
5. the Goal acceptance executor adapter

All use `ToolAuthorizationService` and `AgentToolExecutor`, but they differ in
denial shaping, lifecycle evidence, context propagation, command proof
construction, and result handling. `AgentToolExecutor` additionally owns
run-context guards and timeout/quiescence, while `DynamicToolRegistry` owns
argument validation and handler exception normalization.

This distribution makes authorization bypass possible when a new production
caller invokes the low-level executor directly.

## Decision

Introduce `ToolRuntime` as the only production authorization-to-dispatch
orchestration boundary.

The pipeline is:

```text
prepare canonical request
  -> serial pre hooks
  -> serial monotonic guards
  -> ToolAuthorizationService guard
  -> dispatch lifecycle boundary
  -> AgentToolExecutor dispatch port
  -> canonical output validation
  -> serial post hooks
  -> deep-frozen result and outcome
```

`AgentToolExecutor` remains the low-level dispatch substrate for this
iteration. Its existing run-context guard, command proof defense, timeout, and
quiescence behavior remain unchanged. Moving those mechanisms behind new
sandbox/process providers belongs to RC04, not RC03.

## Invariants

1. Missing authorization dependencies fail closed.
2. The request authorized is the exact canonical request dispatched.
3. `runContext`, `runtimeTask`, signal, and approval callbacks are identical
   across authorization and dispatch.
4. Guards are monotonic: a denial terminates the pipeline and no later hook can
   convert it to allow.
5. The dispatch port is never called after input, policy, or authorization
   denial.
6. Command proof is derived from the authorized canonical command, not accepted
   from an untrusted caller.
7. Post hooks observe but cannot replace the canonical result.
8. Success output must be a record; failure output must contain a string error.
9. Returned request, result, and outcome are detached deep-frozen values.
10. Lifecycle hooks are serial and awaited.
11. Production source checks reject new direct authorization-plus-dispatch
    implementations outside `ToolRuntime`.

## Compatibility

- Existing tool definitions, names, arguments, permission policy, audit log,
  approval UI, timeout messages, and executor result union remain unchanged.
- Existing callers receive adapters while they migrate; raw executor unit tests
  remain valid.
- Denied calls remain non-dispatched and retain structured
  `authorization_denied` or `authorization_unavailable` details.
- AgentLoop invocation callbacks continue to observe waiting approval,
  authorized, running, completed, and error transitions.
- Result offload and model-facing serialization stay in their current owners
  during RC03.

## Rollout

1. Add the typed runtime and contract tests.
2. Migrate AgentLoop and Goal acceptance adapter.
3. Migrate AgentRunnerService, AgentRuntimeEngine, and deterministic Goal
   execution.
4. Add a production-source sensor for direct bypass.
5. Run focused parity tests, full verification, and production smoke.

Each migrated caller keeps its old result formatting and trajectory behavior.

## Rollback

The old `ToolAuthorizationService` and `AgentToolExecutor` APIs remain intact.
Rollback consists of restoring the caller-local authorize/execute sequence and
removing the runtime adapter. No persisted schema, permission rule, tool
definition, or user data changes are introduced.

## Deferred Work

- OS-enforced process sandbox: RC04.
- Chat event storage and projections: RC05.
- replay-safe context surface: RC06.
- safe ordered parallel scheduling: RC07.
- Code Mode and production Kernel convergence: RC08.
