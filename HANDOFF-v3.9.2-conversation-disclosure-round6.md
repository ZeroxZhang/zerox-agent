# v3.9.2 Conversation Disclosure Round6 Handoff

## Resume Point

Resume at `R6-0`. Do not mutate any Round1-Round5 frozen file.

## Current State

- Branch: `codex/3.9.2`.
- P107A/CD03A is the only active Feature/workstream.
- Round5 is rejected after governance returned `1 Critical / 2 Major / 0
  Minor`.
- Round5 contract/runtime reviews were stopped and are not evidence.
- Round5 manifest, attestation, anchor, journal, and transition remain absent.
- The four live transition files remain at their source roots.

## Round5 Trust Roots

- policy canonical:
  `sha256:96836e23520f240e59139aab3d54074c11a53a1ac51b59e614c4cc994bdabb6b`;
- policy bytes:
  `sha256:a5c09998dbe27d5bbe3570e530235dcb74cbcb8abd472e5e68b77f30c288e63a`;
- archive canonical:
  `sha256:569ff796c4f215ea980a3fadee3bea6240491b7e1c8d8ce2278c752eba9e191a`;
- archive bytes:
  `sha256:6cd50ccc291a185cbb3306931f5447b6f85dbe31931758a474fd01dc276f3d95`;
- snapshot canonical:
  `sha256:265f8d761f26c9ea80f2fe3cd60bdf5990fa24a96b087cdac776b2dce9d926c3`;
- snapshot bytes:
  `sha256:399ec2c66cad17cf8aa72e0e7af570eaf70f07fd8fed12f0f5753964b449a67a`;
- governance receipt canonical:
  `sha256:bd7d71875ef9bcfed39fe67376eb52bfa4bd2b9900ca596db1c85375d433e91f`;
- governance receipt bytes:
  `sha256:6da9db98e02231d768b2457eb222ed323496227cd47cc9ce4084332fba7c0c88`.

## Required Work

1. Rehash Round5 policy/archive/snapshot/receipt and its `121` frozen, four
   payload, and `12` baseline paths; confirm forbidden outputs remain absent.
2. Add only V6/Round6 files and extend the exact P107A roster.
3. Build and publish a deterministic Round5 review-rejection witness.
4. Add an exact-byte external dispatch builder and mutation tests.
5. Rewrite the successor verification command from any predecessor checker to
   the V6 checker.
6. Add a separate reconstructed Round4 historical test lane.
7. Repeat production-shape fresh/replay/recovery, state-aware full tests,
   all-to verify, source/all-to smoke, historical rehash, syntax, type,
   whitespace, and credential gates.
8. Publish Round6 policy/snapshot, dispatch three independent lanes, and
   transition only after three zero-finding PASS receipts.

## Prohibitions

- No reset, clean, checkout, commit, push, or release.
- No browser/provider credential use before CD09.
- No review identity claim beyond caller-attested `not-signed`.
- No Round6 policy/snapshot publication before all pre-freeze gates pass.
