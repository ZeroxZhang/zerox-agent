# CD03A Round11 Predecessor Identity Trust Head

## Status

Accepted for append-only implementation after the Round10 contract rejection.

## Context

Round10 bound receipt time, snapshot counts, validator identity, candidate
results, final-manifest roots, and policy Program identity. Contract review
still found one Major gap: the embedded Round9 rejection witness required only
a nonempty `programId`.

An attacker could change that predecessor `programId`, recompute the rejection,
policy, and snapshot digests, and pass the shared contract plus ordinary
checker. The self-contained runner already rejected the mismatch, so the
authorities disagreed.

## Decision

Round11 is a new append-only trust head.

- `validateContinuationPolicyV11` requires
  `policy.round10ReviewRejection.programId === policy.programId`.
- The self-contained runner and ordinary checker enforce the same equality.
- A mutation test changes only the embedded rejection `programId`, recomputes
  every enclosing canonical digest, and must fail.
- All Round10 evidence and V10 source bytes remain immutable.

## Consequences

- Round11 otherwise preserves the complete V10 final-evidence and transaction
  contract.
- No transition or closure publication is allowed before three zero-finding
  Round11 reviews.
- P108 completion remains unrepresentable.
