# CD03A Round5 Final-Evidence Trust Head

## Status

Accepted for implementation after the Round4 governance rejection. No Round5
policy, snapshot, review receipt, manifest, attestation, anchor, journal, or
transition exists.

## Rejected Parent

Round4 is immutable rejected history:

- policy:
  `sha256:c4b40e8dd31554b3bd25ccf1c1d3d1671291e8f52c41286d9cd729ebb8fa4843`;
- snapshot:
  `sha256:7e3f075ac63abd39ce9e4a9ab6a3780e864c5397ddb40ecaef0d3a541febf740`;
- governance failed receipt:
  `sha256:c09c4c3140545e4acfd8e7e2827b0f98b77304c97e3f4d87501b826373458a9d`;
- finding: `R4-GOV-001`, `0 Critical / 1 Major / 0 Minor`.

The contract and runtime reviews were interrupted after the first rejecting
verdict and are not evidence. Round4 manifest, attestation, external anchor,
journal, and live transition remain absent.

## Root Cause

Round4 correctly bound files, transitions, review dispatch, and receipts, but
its final evidence validators were shape-heavy and semantics-light.

`validateContinuationExternalAttestationV4` accepted an empty candidate result
set and did not apply trusted-time ordering. The anchor validator accepted an
arbitrary head, including a false P108 completion claim. The ordinary checker
then compared only a subset of the policy, snapshot, attestation, runner, and
dispatch relationships.

## Round5 Contract

Round5 is append-only. It must bind the exact Round4 policy, snapshot, and
failed governance receipt by serialized-byte SHA-256 and canonical digest, and
must preserve the absent contract/runtime receipts and downstream closure
outputs as rejection evidence.

The final evidence validators must enforce:

1. exactly two ordered candidate results: `checker`, then `harness`;
2. each result is `passed`, uses its policy-declared path, and has SHA-256
   receipt/stdout/stderr digests;
3. attestation time is canonical, not later than caller trusted time, and not
   earlier than the snapshot or any accepted review receipt;
4. attestation exactly binds parent bundle, Round4 rejection, policy, snapshot,
   validator, runner, pending manifest, dispatch set, and candidate results;
5. final manifest preserves every pending-manifest field and changes only
   status plus the exact attestation digest;
6. anchor exactly repeats the attestation bindings and contains only the
   `successor-admission / externally_attested / CD03A / P107A` head with the
   policy's successor definition digests;
7. `P108 done` remains unrepresentable until a later CD04 reviewed delta;
8. the ordinary checker supplies all expected semantic bindings and trusted
   time to the validators rather than relying on shape checks.

## Boundaries

- Do not modify any Round1-Round4 frozen byte.
- Do not reinterpret the Round4 failed receipt as a PASS.
- Do not publish a Round5 policy or snapshot until current, historical, target,
  full verify, smoke, recovery, credential, and whitespace gates pass.
- Any Round5 Critical, Major, or Minor finding rejects Round5 before transition.
- Identity assurance remains exactly `not-signed`; caller dispatch consistency
  is not platform identity proof.
- Browser/provider credential acceptance remains deferred to CD09.
