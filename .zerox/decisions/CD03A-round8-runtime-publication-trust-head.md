# CD03A Round8 Runtime Publication Trust Head

## Status

Accepted for append-only implementation after the Round7 runtime rejection.

## Context

Round7 closed the Round1 absence and completion-artifact definition gaps.
Governance passed, but runtime rejected the frozen candidate with four Major
findings:

1. The self-contained V7 runner retained predecessor round constants and roots.
2. Completed Program checking did not require the caller-pinned continuation
   closure chain.
3. An absent-output commit used replacing rename after an absence check.
4. Private publication could strand a two-link inode after a crash between
   linking the output and removing its temporary name.

Round7 policy, archive, snapshot, dispatch, governance receipt, and runtime
receipt are immutable rejected evidence. Round7 cannot produce a manifest,
attestation, anchor, journal, or transition.

## Decision

Round8 is a new append-only trust head.

- The V8 runner hard-roots Round7 policy, snapshot, both completed receipts,
  rejection findings, and all V8 schema/round values.
- Every absent-output commit uses an atomic no-replace primitive.
- Private evidence publication uses a digest-derived deterministic temporary
  name and recovers both a complete temp and the exact two-link
  temp/output crash state.
- The V8 completion checker accepts review state locally, but completed or
  active P107A state requires caller-supplied continuation-anchor path and
  digest and runs the full V8 continuation checker.
- CD03A completion artifacts remain exact and satisfiable; Round7 rejected
  downstream outputs remain absent.
- P108 completion remains unrepresentable without a separately reviewed delta.

## Consequences

- Round1 through Round7 bytes are immutable.
- V8 tests must exercise deterministic-temp recovery, no-replace publication,
  exact V8 runner constants, and caller-pinned completed-state checking.
- Full verification and three zero-finding independent reviews remain mandatory
  before the external transaction.
