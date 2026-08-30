# CD03A Round9 Descriptor Transaction Trust Head

## Status

Accepted for append-only implementation after the Round8 runtime rejection.

## Context

Round8 corrected version roots, no-replace creation, deterministic private
temporary names, and completed-state closure entry. Governance passed, but
runtime rejected the frozen candidate with five Major findings:

- private publication still used pathname link/unlink operations;
- replacement of an existing live file did not bind the original inode and
  could overwrite a raced third state;
- a completed marker did not retain the prepared journal inode named by it;
- review-state Program checking did not reject mixed transition bytes;
- completed-state checking hard-coded the temporary Round23 anchor location.

Round8 policy, archive, snapshot, dispatch, governance receipt, and runtime
receipt are immutable rejected evidence.

## Decision

Round9 is a new append-only trust head.

- Private publication runs entirely through a descriptor-relative helper using
  a digest-derived temp and no-replace hard-link commit.
- Existing-file transition uses atomic exchange and validates both replacement
  and displaced-original inode identities before retirement.
- Journal completion hard-links the exact journal inode to its digest/dev/ino
  marker before retiring the journal name; marker-only replay validates the
  marker's own inode against its filename.
- Review-state Program checking verifies all four live source and staged target
  digests. Completed/active checking requires caller-supplied base and
  continuation anchor paths and digests and invokes the full V9 checker.
- P108 completion remains unrepresentable.

## Consequences

- Round1 through Round8 bytes remain immutable.
- Round9 must pass focused mutation coverage, state-aware tests including
  reconstructed Round7 and Round8 lanes, all-to verify, smoke, historical
  rehash, and three independent zero-finding reviews.
