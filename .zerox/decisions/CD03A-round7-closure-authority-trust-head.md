# CD03A Round7 Closure Authority Trust Head

## Status

Accepted for append-only implementation after the Round6 governance rejection.

## Context

Round6 was internally consistent and passed every pre-freeze gate, but the
governance review returned `0 Critical / 2 Major / 0 Minor`:

1. The transitive rejected-output class omitted the three Round1 forbidden
   outputs, so review-pre checking did not prove their continued absence.
2. CD03A listed intentionally absent rejected artifacts as completion
   artifacts, while the staged `program:check` used only a diagnostic harness.
   The pure lifecycle validator could therefore accept `anchored_planned`
   without proving that the declared completion artifacts existed.

Round6 policy, archive, snapshot, dispatch, and governance receipt are immutable
rejected evidence. Round6 cannot produce a manifest, attestation, anchor,
journal, or transition.

## Decision

Round7 is a new append-only trust head.

- The rejected-output class is the unique sorted union of every inherited
  rejected output, all three Round1 forbidden outputs, and the four forbidden
  Round6 downstream outputs.
- CD03A completion artifacts are an exact set containing only durable evidence
  that exists before closure or must exist at successful Round7 closure.
  Rejected manifests, attestations, and interrupted receipts are forbidden from
  that set.
- V7 governance rejects any CD03A completion-artifact drift in every lifecycle
  phase.
- The Round7 package target restores the preserved conversation program checker
  to `program:check` with the caller-pinned Round23 anchor. The diagnostic
  continuation harness remains supplemental and cannot replace the program
  checker.
- The external runner remains the only authority that can publish the final
  Round7 attestation, manifest, and repository-external continuation anchor.
- P108 completion remains unrepresentable. Successful Round7 closure may only
  authorize the exact P108 admission head.

## Consequences

- Round1 through Round6 bytes remain immutable.
- Round7 must repeat production-shape, state-aware, all-to verify, source and
  all-to smoke, historical rehash, syntax, whitespace, and credential gates.
- Three caller-dispatched reviewers must return zero-finding PASS receipts on
  one frozen Round7 snapshot before any transition.
