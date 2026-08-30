# CD03A Round6 Review-Integrity Trust Head

## Status

Accepted for append-only implementation after the Round5 governance rejection.
Round5 policy, archive, snapshot, and failed governance receipt are immutable.
No Round5 manifest, attestation, anchor, journal, or transition exists.

## Rejected Parent

- policy canonical:
  `sha256:96836e23520f240e59139aab3d54074c11a53a1ac51b59e614c4cc994bdabb6b`;
- policy bytes:
  `sha256:a5c09998dbe27d5bbe3570e530235dcb74cbcb8abd472e5e68b77f30c288e63a`;
- snapshot canonical:
  `sha256:265f8d761f26c9ea80f2fe3cd60bdf5990fa24a96b087cdac776b2dce9d926c3`;
- snapshot bytes:
  `sha256:399ec2c66cad17cf8aa72e0e7af570eaf70f07fd8fed12f0f5753964b449a67a`;
- governance failed receipt canonical:
  `sha256:bd7d71875ef9bcfed39fe67376eb52bfa4bd2b9900ca596db1c85375d433e91f`;
- governance failed receipt bytes:
  `sha256:6da9db98e02231d768b2457eb222ed323496227cd47cc9ce4084332fba7c0c88`.

The contract and runtime reviews were stopped after the first rejecting
verdict. Their receipts and every downstream Round5 closure output must remain
absent.

## Round5 Findings

1. `R5-GOV-001` Critical: the external instruction artifacts had a trailing
   newline that was omitted from the dispatch `instructionDigest`, so the
   reviewer could not reproduce the caller pin.
2. `R5-GOV-002` Major: the successor verification rewrite matched only the V3
   checker string and left the rejected V4 checker in the P108 definition.
3. `R5-GOV-003` Major: the state-aware V5 orchestrator reconstructed Round3
   only; V4 tests still observed the live Round5 Feature definition instead of
   the frozen Round4 definition.

## Round6 Contract

Round6 must:

1. generate each external instruction artifact and hash the exact bytes that
   are written, including the final newline;
2. publish the instruction artifacts and dispatch set as current-user-owned,
   single-link `0600` files with no-replace/idempotent semantics;
3. replace any predecessor continuation-checker verification command with the
   exact V6 checker command before hashing the P108 successor definition;
4. run V3 tests in a reconstructed Round3 tree, V4 tests in a separate
   reconstructed Round4 tree, current tests in the current tree, and Program/
   package tests against all four Round6 targets;
5. preserve the strict V5 candidate-result, trusted-time,
   manifest-attestation-anchor, and exact-head semantics unchanged;
6. keep P108 `done` unrepresentable until the externally anchored Round6
   successor-admission transaction completes.

## Boundaries

- Do not modify any Round1-Round5 frozen byte.
- Any Round6 Critical, Major, or Minor finding rejects Round6 before
  transition.
- Review identity remains caller-attested and `not-signed`.
- Browser/provider credential acceptance remains deferred to CD09.
