# CD03A Round3 Recovery Trust Head

## Status

Accepted for implementation; Round3 evidence remains unpublished.

## Context

Round23 remains the completed historical CD03/P107 closure. Round1 is a
three-receipt rejected review candidate. Round2 advanced further: its exact
policy was atomically published, but its first authoritative freeze failed
before snapshot publication.

The Round2 policy requires each of four staged governance targets to be present
in `snapshot.frozenFiles`. The same validator then derives both `frozen_file`
and `transition_target` for each target and requires exactly one class. Removing
a target violates the first rule; retaining it violates the second. Therefore
no exact-schema Round2 snapshot exists.

Round2 policy canonical digest:
`sha256:aa9fa6893b20b16ccab49cbe41af65a46b9719a334691ef6174722ffb1f2edc7`.
Serialized policy byte SHA-256:
`sha256:0f082ee8000cf58a428073bfcd10151919ddb3eecc46dea6531422b01865e3ff`.

## Decision

Round2 is rejected before snapshot publication and remains append-only
historical evidence. Its policy, archive, v2 executable witnesses, and four
staged targets are never modified, deleted, renamed, or reused as the Round3
authority. No Round2 snapshot, review receipt, manifest, attestation, or anchor
may be fabricated.

Round3 introduces new paths and a new trust head. A deterministic pre-freeze
rejection witness binds:

- the exact Round2 policy and archive bytes;
- the exact five v2 policy trust-root executables and four Round2 staged target
  payloads;
- the fact that all four live transition files still equal their `fromSha256`;
- absence of the Round2 snapshot, three receipts, manifest, and attestation;
- a recomputable contradiction over all four staged target paths.

The rejection witness is a retrospective deterministic diagnosis, not a review
receipt and not evidence that an external Round2 anchor is globally absent.

## Round3 coverage model

The policy owns one explicit, sorted, exact-once `admissionCoverage` array. Its
classes are:

- `frozen_file`;
- `transition_live`;
- `transition_payload`;
- `post_review_mutable`;
- `review_output_absent`.

The snapshot records distinct evidence arrays:

- `frozenFiles`;
- `transitionPayloadFiles`;
- `baselineFiles`;
- `absentPaths`;
- `reviewOutputAbsentPaths`.

Every staged target belongs only to `transition_payload`, appears exactly once
in `transitionPayloadFiles`, equals its transition `toSha256`, and is forbidden
from all other evidence arrays. Coverage class comes from the policy, never
from incidental membership in a snapshot evidence array.

## Lifecycle and authority

Round3 preserves the four allowed phases: `review_pre_transition`,
`review_post_transition`, `anchored_planned`, and `authorized_active`. P108
`done` remains unauthorized until CD04 supplies a separately reviewed
next-version delta trust head.

P108 authority remains exactly `17 modify / 12 create / 9 bookkeeping` paths.
The four package/harness/test transitions remain separately governed and may
execute only after three zero-finding Round3 receipts bind one exact snapshot.
After a transaction journal is published, recovery is forward-only.

## Acceptance gates

1. The Round2 rejection witness rehashes every bound byte, rechecks all four
   live `fromSha256` states, reproduces the contradiction, and proves all
   repository Round2 downstream outputs absent.
2. The exact Round3 P107A roster, CD03A definition, stable Program root, P108
   descriptor, path authorities, archive, and all target/executable bytes are
   hard-bound independently of live candidate controls.
3. A real-shape `policy builder -> freezer -> validator` regression passes and
   mutations for target omission, duplicate classification, digest drift,
   mixed transition state, and forged Round2 output fail closed.
4. Four Round3 target bytes pass focused tests, type coverage, full verify,
   production smoke, syntax, historical-anchor, and whitespace gates in an
   isolated stage.
5. One private no-replace Round3 snapshot receives three fresh independent
   `PASS` receipts with zero Critical, Major, and Minor findings. Any finding
   rejects the round and requires a later new round.
6. A repository-external private v3 runner caller-pins Node, Round23 anchor,
   Round3 policy/archive/snapshot, receipts/challenges, pending manifest, staged
   control tree, and publication identity before emitting attestation, final
   manifest, external anchor, and completion marker.
7. P107A/CD03A may close, and P108/CD04 may activate, only after the caller-pinned
   v3 checker and harness both pass the externally anchored planned state.

## Prohibitions

- Do not patch a v2 executable and continue under the Round2 policy.
- Do not overwrite, delete, rename, or alias Round2 evidence.
- Do not hand-author a Round2 snapshot or PASS receipt.
- Do not treat local diagnostic output as external acceptance.
- Do not execute any governance transition before three Round3 PASS receipts.
- Do not use browser/provider credentials during CD03A trust-head recovery.
