# KM02 Decision: Mode-Aware Production Kernel Segment Contract

Status: Accepted

Date: 2026-08-14

## Context

`ProductionKernelDriver` currently hard-codes `scheduled_task` when it creates a
Kernel `RunContext`. That is safe for v3.8.2 but cannot represent Chat or Goal
without hiding the actual production surface.

The driver also supports pre-abort settlement, but an exception thrown by a
segment is immediately converted to failed `run_end` by `RuntimeKernel`.
Future Chat and Goal adapters must be able to persist failed surface state
before that event without swallowing the original execution error.

## Decision

1. Make `mode: KernelRunMode` required on every driver invocation.
2. Pass a frozen execution context containing `runId`, `mode`, and current
   Kernel `turn` to the segment adapter.
3. Add optional `settleFailed(error)` beside `settleAborted(status)`.
4. When execution throws and `settleFailed` exists:
   - await the failure settlement;
   - require the returned segment status to be `failed`;
   - let RuntimeKernel publish the single failed `run_end`;
   - validate Kernel/segment status and summary parity;
   - rethrow the original execution error to the caller.
5. If failure settlement itself fails, publish the settlement failure as the
   Kernel reason and rethrow that settlement error.
6. Keep the existing behavior for callers that do not provide
   `settleFailed`: publish one failed terminal event and rethrow the execution
   error.
7. If pause or cancellation settlement fails, publish one failed `run_end`
   instead of rejecting without a terminal event, then rethrow the settlement
   error from the driver.

## Invariants

- Segment adapters own domain persistence; Kernel owns terminal publication.
- No `run_end` may precede `settleAborted` or `settleFailed`.
- Success, pause, cancel, and explicit failed segment returns retain exact
  status and summary parity.
- Cancellation still wins over a stale successful segment.
- Invocation-local subscription remains the terminal cardinality authority;
  bounded event history is not consulted.
- The Scheduled Task production caller explicitly uses `scheduled_task` and
  retains byte-equivalent persistence behavior.
- Chat and Goal are not wired to the driver in KM02.

## Compatibility And Rollback

The only production caller is `agentRuntimeEngine`; it will pass
`mode: "scheduled_task"`. Existing `execute` implementations remain source
compatible because they may ignore the new second argument.

Rollback removes the required mode, execution context, and failure-settlement
hook, restoring the scheduled-only driver before any Chat or Goal adapter is
enabled. No storage or user data migration is involved.

## Verification

- all three Kernel modes reach the execution context unchanged;
- success, explicit failure, pause, and cancellation parity;
- failed settlement happens before `run_end` and original errors rethrow;
- failed settlement errors are not masked;
- pre-abort settlement and stale-success cancellation regression tests;
- Scheduled Task integration, full repository, verify, and product smoke.
