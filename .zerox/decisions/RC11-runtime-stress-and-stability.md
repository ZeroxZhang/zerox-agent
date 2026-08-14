# RC11 Decision: Runtime Stress And Stability Gate

Status: Accepted

Date: 2026-08-14

## Context

Runtime convergence and post-review hardening established correctness at unit
and integration scale. Release confidence still requires deterministic
large-volume evidence for:

- long context surfaces and Chat histories;
- bounded parallel tool admission and ordered commit;
- cancellation admission closure and quiescent drain;
- read-only Code Mode timeout and Worker recovery;
- SQLite trajectory volume and tail reads.

These scenarios should not make ordinary `npm test` slow or flaky.

## Decision

Add one explicit `npm run stress:runtime` gate. Its test file is collected by
Vitest but skipped unless `ZEROX_RUNTIME_STRESS=1`, so normal verification
retains its existing runtime.

The stress gate uses fixed, local-only workloads:

- 25,000 context source events followed by deterministic replay;
- 10,000 Chat message events with bounded projection payload and indexed
  search;
- 25,000 SQLite trajectory events followed by ordered tail reads;
- 5,000 parallel scheduler items with a 32-call high-water limit and ordered
  commit;
- 5,000 cancellation candidates where only the admitted 32 may start and all
  started work must settle;
- a 128-step Code Mode program with 16 active calls at timeout, followed by a
  healthy recovery program.

## Invariants

1. Stress data is deterministic and uses no network, model, or cloud service.
2. Parallel execution never exceeds its configured high-water limit.
3. Model-facing and commit order remains input order regardless of settlement.
4. Cancellation admits no queued work after abort and returns only after every
   started call settles.
5. Worker timeout returns only after active subcalls settle and a subsequent
   Worker run succeeds.
6. Chat projections stay message-free and bounded as history grows.
7. SQLite tail reads preserve exact sequence at volume.
8. Each scenario has a broad upper bound that detects hangs without enforcing
   machine-specific microbenchmarks.

## Rollback

Remove the stress script and test file. No production behavior, persistent
schema, feature flag, or user data is changed.

## Verification

- `npm run stress:runtime`;
- focused scheduler, Worker, context, Chat, and storage tests;
- full serial tests, build, verify, and production smoke;
- program, harness, and whitespace checks.
