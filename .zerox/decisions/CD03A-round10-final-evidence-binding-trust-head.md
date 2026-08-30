# CD03A Round10 Final Evidence Binding Trust Head

## Status

Accepted for append-only implementation after the Round9 contract rejection.

## Context

Round9 fixed descriptor-relative publication, existing-file inode binding,
journal-marker identity, mixed review-state rejection, and caller-owned anchor
paths. Governance passed, but contract rejected the frozen candidate with five
Major findings:

- review receipt time was syntactic rather than trusted-time bounded;
- receipt snapshot count and validator digest were not semantically bound;
- external attestation candidate results were optional at the checker boundary;
- final-manifest roots and pending projection were derived from the final
  manifest itself;
- policy `programId` was not bound to the closed-world Program root.

Two independent read-only validation lanes reproduced every finding. Round9
policy, archive, snapshot, dispatch, contract receipt, and governance receipt
are immutable rejected evidence. Runtime was interrupted and produced no
receipt.

## Decision

Round10 is a new append-only trust head.

- Receipt validation requires
  `snapshot.frozenAt <= completedAt <= trusted verifier time` and exact
  `snapshotFileCount` plus checker `validatorDigest`.
- Attestation validation always receives the exact ordered candidate results
  captured from the external runner.
- Final-manifest and anchor validation use canonical paths and digests derived
  from policy, snapshot, receipts, constants, and runner evidence. The pending
  projection is rebuilt from those independent inputs, never from the final
  manifest under review.
- Policy `programId` must equal the closed-world Program root `programId`.
- P108 completion remains unrepresentable.

## Consequences

- Round1 through Round9 bytes remain immutable.
- Round10 must add mutation probes for every Round9 finding and preserve the
  exact all-from/all-to orchestration behavior introduced in Round9.
- No transition, manifest, attestation, or continuation anchor is permitted
  before three zero-finding Round10 reviews.
