# KM09 Post-Migration Stress And Deferral Decisions

## Scope

KM09 repeats the runtime stress gate after Chat and Goal production Kernel
migration and records an explicit decision for every deferred capability. It
does not implement any deferred capability.

## Stress Evidence

Command:

```text
npm run stress:runtime
```

Result: 1 file / 6 tests passed.

| Scenario | Scale | Elapsed | Budget | Budget Used |
| --- | ---: | ---: | ---: | ---: |
| Context append, O(1) token reads, and replay | 25,000 events | 85 ms | 30,000 ms | 0.28% |
| Chat event persistence, projection, and search | 10,000 messages | 414 ms | 30,000 ms | 1.38% |
| SQLite trajectory append and ordered tail read | 25,000 events | 1,123 ms | 30,000 ms | 3.74% |
| Parallel scheduler bound and ordered commit | 5,000 calls, 32 active | 17 ms | 10,000 ms | 0.17% |
| Cancellation admission stop and started-work drain | 5,000 calls, 32 admitted | 4 ms | 10,000 ms | 0.04% |
| Worker timeout drain and next-run recovery | 128 timed calls, 64 recovery calls | 236 ms | 10,000 ms | 2.36% |

All scenarios preserved their correctness assertions:

- Context token estimation remained one call per appended event.
- Chat projection payload remained below 2,000 bytes and the final message was
  searchable.
- SQLite trajectory count and final ten sequence values were exact.
- Parallel execution reached but did not exceed 32 active calls and committed
  in source order.
- Cancellation admitted exactly 32 calls, drained all 32, and skipped every
  later call.
- Worker timeout drained all 16 active calls and the next 64-call run
  completed.

## Deferred Capability Decisions

### Context Event Compaction

Decision: `kept_deferred`.

The repeated 25,000-event Context case completed in 85 ms, with O(1) token
reads and exact replay. Chat and trajectory volume tests also remained far
inside their budgets. There is no measured nonlinear replay, memory, startup,
or user-visible latency pressure that justifies a new compaction format or
destructive pruning risk.

Reconsider only when repeatable stress or production telemetry breaches the
existing budget or attributes user-visible p95 latency to event volume.

### External Subagent Provider

Decision: `kept_deferred`.

There is still no approved product requirement to send delegated context to an
external service. User consent, data residency, credentials, provider cost,
observability, cancellation, and ToolRuntime-equivalent authorization remain
undecided trust boundaries.

Reconsider only through a separate program with an approved product and
security contract.

### Arbitrary Code Mode

Decision: `kept_deferred`.

Current Code Mode remains a typed read-only DAG executed by a bounded Worker
through workspace-scoped tools. No independent process-isolation design yet
proves syscall, filesystem, network, credential, child-process, timeout, kill,
audit, and capability-only I/O boundaries for model-authored arbitrary code.

Reconsider only through a separate isolation program with adversarial escape
tests. Do not add `eval`, `Function`, arbitrary shell, mutating nested tools,
or in-process model-authored execution.

## CI Stability Follow-Up

GitHub Actions run `31817696111` exposed a test-only polling deadline that used
50 zero-delay iterations. Under CI load, two controller tests timed out before
their expected state transition; their unfinished asynchronous work then
produced a misleading duplicate-terminal failure in a later test.

The helper now uses a real 5,000 ms deadline with 1 ms polling. The complete
112-test controller file and the full parallel verify gate pass after the
change. Production timeout and cancellation behavior is unchanged.

## Program Decision

All three capabilities remain deferred. No follow-up implementation is opened
from the Kernel migration program.

Closure evidence:

- runtime stress: 1 file / 6 scenarios;
- full serial and verify: 271 files / 2,773 tests;
- production build, Agent evaluations 26/26, and Memory evaluations 2/2;
- standard JSON fallback smoke and Electron SQLite smoke without fallback;
- Node ABI restoration and 4 files / 41 storage and dependency tests;
- dependency audit: zero vulnerabilities;
- active-state program, harness, and whitespace checks.

KM09 and the Chat and Goal Kernel Migration Program are complete.
