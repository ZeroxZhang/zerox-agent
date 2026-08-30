# CD03A Round4 Append-Only Recovery Trust Head

## Status

Accepted for implementation. Round4 policy, snapshot, receipts, manifest,
attestation, and anchor are not published by this decision.

## Context

Round23 remains the completed historical CD03/P107 authority. Round1 remains a
rejected review candidate. Round2 remains rejected before freeze by its
deterministic pre-freeze witness. Round3 reached a private policy and review
snapshot, then all three review lanes published schema-valid failed receipts.

The Round3 contract receipt records one Minor finding. The runtime receipt
records one Critical, two Major, and one Minor findings. The governance receipt
records one Major finding. Therefore Round3 is rejected with an aggregate of
one Critical, three Major, and two Minor findings. A later round must not patch,
replace, reinterpret, or complete the rejected Round3 trust head.

## Decision

Round4 is a new append-only trust head. A deterministic Round3 review-rejection
witness binds both the serialized byte SHA-256 and canonical JSON digest of the
Round3 policy, review snapshot, and all three failed receipts. It also binds the
exact six finding identifiers, aggregate counts, prior Round1 and Round2
rejection roots, and repository-scoped absence of the Round3 closure manifest
and external attestation.

The repository can prove that its two named Round3 downstream outputs are
absent. It cannot prove that no external Round3 anchor exists anywhere. Any
anchor whose subject is the rejected Round3 policy and snapshot is instead
semantically inadmissible, whether or not such an anchor is later supplied.

The witness is rejection evidence only. It is not a PASS receipt, manifest,
attestation, anchor, or authorization to execute a governance transition.

## Round4 coverage model

One shared ordered constant defines exactly six admission classes:

- `frozen_file`: present immutable bytes in the Round4 review subject,
  including all retained Round3 payloads, the Round3 policy and snapshot, and
  all three failed Round3 receipts;
- `transition_live`: the exact four live source files that must remain at their
  admitted `fromSha256` before the transaction;
- `transition_payload`: the exact four new Round4 staged target files that must
  equal their admitted `toSha256`;
- `post_review_mutable`: the exact six present governance bookkeeping files
  that may change only after a successful externally controlled transaction;
- `review_output_absent`: the exact six Round4 snapshot, receipt, manifest, and
  attestation paths that must be absent before their lifecycle publication;
- `rejected_output_absent`: the exact six forbidden Round2 downstream outputs
  plus the Round3 closure manifest and external attestation.

Every admission path has exactly one class. Absence is an affirmative runtime
capture: a present forbidden path is an error, never a false return value that a
caller may ignore.

## Review assurance

Round4 receipts bind one exact policy, snapshot, rejection witness, challenge,
lane, validator, and finding set. Receipt task paths and agent labels are
claimed origin metadata, not cryptographic identities.

The external caller supplies one ordered, pinned three-lane `dispatch set` that
binds each challenge and receipt canonical digest. Its assurance value is exactly
`caller-attested-not-signed`. Local code may prove byte consistency, exact lane
coverage, distinct caller-declared review contexts, and zero findings. It must
not claim to prove reviewer identity or independence. Reviewer independence is
an external program/process property asserted by the caller.

## Runtime I/O boundary

The contract exposes one concrete runtime module API:
`createCaptureLedgerV4`, `captureStableFileV4`,
`capturePrivateEvidenceV4`, `captureRequiredAbsentV4`,
`postflightCaptureLedgerV4`, and `publishPrivateExactV4`. There is no generic
adapter or second capture vocabulary. A present capture binds canonical
absolute path, byte SHA-256, device, inode, link count, owner, mode, size, and
parent identities. An absence capture is valid only for ENOENT. Postflight
must revalidate every ledger entry before publication or transition.

Runtime implementations must additionally reject symlinks, hard links,
private policy/snapshot/rejection mode drift, parent-directory replacement,
preload environment state, and source/target byte races. This ADR defines the
interface but does not publish or authorize a runtime implementation.

## Lifecycle

The allowed sequence is:

1. `rejection_recorded`: deterministically reconstruct the exact Round3
   rejection and verify repository-scoped forbidden outputs absent.
2. `policy_draft`: derive and validate new stable P107A, CD03A, Program, P108,
   path-authority, archive, executable, and exact finalized admission roster.
3. `policy_published`: privately publish one exact no-replace Round4 policy.
4. `review_pre_transition`: privately freeze one exact Round4 snapshot while
   all four live files remain at `fromSha256`.
5. `review_passed_pending_external_transaction`: accept exactly three
   caller-attested, not-signed, zero-finding receipts.
6. `review_post_transition`: run the forward-only external transaction and
   candidate gates over caller-pinned bytes.
7. `anchored_planned`: accept a caller-pinned external anchor for the completed
   Round4 subject.
8. `authorized_active`: close P107A and activate P108 only after anchored
   checker and harness gates pass.

The first three phases are evidence-construction states and
`review_passed_pending_external_transaction` is a review/publication state.
Only `review_pre_transition`, `review_post_transition`, `anchored_planned`, and
`authorized_active` materialize complete Program/Feature lifecycle profiles.

Any Critical, Major, or Minor Round4 finding rejects Round4 and requires a new
append-only round. P108 completion remains blocked until CD04 supplies its own
reviewed successor delta.

## Acceptance gates

1. The Round3 rejection witness rehashes all five present evidence files,
   validates their exact schemas and roots, aggregates the exact six findings,
   and fails if either forbidden repository output is present.
2. Mutation of either byte SHA or canonical digest for the policy, snapshot, or
   any receipt fails closed.
3. All six admission classes share one contract constant and the finalized
   roster/counts have exact-key,
   exact-once, mutation-rejection tests.
4. The stable P107A finalized file-set, Feature definition, CD03A Workstream definition,
   and Program root are recomputed from live planning state and caller-pinned
   before policy publication. No placeholder is publishable.
5. Receipt, caller-dispatch, manifest, attestation, and anchor validators use
   exact keys and say `not-signed`; no local identity proof is inferred.
6. The runtime capture ledger covers every present and absent authority and
   passes a complete postflight rehash before any output is published.
7. Focused Round4 contract/policy tests, syntax checks, full verification,
   production smoke, program, harness, and whitespace gates pass before review.

## Prohibitions

- Do not modify any Round1, Round2, or Round3 evidence byte.
- Do not publish a Round3 manifest, attestation, or anchor.
- Do not admit an external anchor bound to the rejected Round3 policy/snapshot.
- Do not claim global absence of external files or cryptographic reviewer
  identity without an external signature system.
- Do not accept self-reported task or agent strings as authorization.
- Do not execute any transition before three zero-finding Round4 receipts and
  exact caller pins bind one frozen Round4 subject.
- Do not publish a policy containing unresolved stable or executable roots.
- Do not use browser/provider credentials during CD03A recovery.
