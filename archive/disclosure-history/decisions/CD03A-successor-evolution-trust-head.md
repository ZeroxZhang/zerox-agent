# CD03A — Successor Evolution Trust Head

Status: Accepted for staged P107A implementation

Date: 2026-08-24

## Context

CD03 Round23 is a completed, externally attested historical closure. Its
caller-pinned external anchor binds snapshot
`sha256:e1a5300d6015543e0a6a8e8f09f2a13fcb955111b87c08545e0f882bb786796b`
through anchor
`sha256:e81f0afb3d10b12976b74d1499870b837595ffbc3b452c7f1f78fff67be8f102`.
The completion checker intentionally rehashes every protected P107 file. This
detects unreviewed drift, but it also means that CD04 cannot legitimately edit
the later P108 paths covered by the Round23 snapshot without a new trust head.

The completed CD03 state, artifact, receipts, manifest, attestation, snapshot,
and anchor are append-only history. They must not be reopened, rewritten, or
presented as proof that later live bytes were reviewed in Round23.

## Decision

Add CD03A/P107A as a separate trust-root version bump between CD03 and CD04.
It creates a caller-pinned continuation anchor before any protected P108 source
drift occurs. CD04 depends on completed CD03A.

The trust chain is:

```text
Round23 historical snapshot + external anchor
  -> P107A exact continuation policy and governance migration
  -> three independent PASS receipts + external continuation anchor
  -> P108 authorized_unreviewed live drift
  -> CD04 next-version independently reviewed P108 delta + external anchor
  -> next successor admission
```

The continuation policy binds all of the following by canonical SHA-256:

- the Round23 parent snapshot and caller-pinned anchor;
- the exact CD04 definition excluding only its lifecycle state;
- the exact P108 Feature definition excluding only its lifecycle status;
- an explicit ordered list of P108 paths that may differ from Round23;
- an immutable denylist for checker, harness, package, review contract,
  freezer, external runner, continuation validator, policy, and closure
  evidence;
- the exact before and after hashes of the one-time package/harness migration;
- the continuation validator and contract module bytes;
- the P107A review snapshot, three lane receipts, manifest, and external
  attestation.

Live `feature_list.json` and program fields are comparison inputs only. They
never create or enlarge authority. The validator recomputes the historical
Feature roster, stable Program root, scenario semantics, workstream definitions,
and lifecycle projection and compares them with the externally anchored digests.

## Bootstrap protocol

1. While all Round23 protected bytes remain unchanged, an external caller runs
   the original checker and harness with the original caller-pinned anchor.
2. Candidate continuation files and the target package/harness bytes are
   captured with regular-file, single-link, no-symlink, inode, parent-identity,
   and preflight/postflight checks.
3. Three independent reviewers evaluate the same frozen P107A digest across
   contract, runtime, and governance lanes.
4. A repository-external runner publishes a continuation attestation and anchor
   that bind the parent anchor, policy, exact governance transition, validator,
   snapshot, and receipts.
5. Only the exact anchored package/harness target bytes become the new live
   trust head. Before journal publication an unstarted attempt may be abandoned;
   after the durable journal exists, a partial transition fails closed and retry
   can only converge forward to the exact reviewed target bytes.

The old checker remains byte-identical as a historical verifier. The migrated
harness validates that byte against Round23, then delegates live successor
validation to the externally anchored continuation checker.

## Live successor semantics

- `CD04 planned`: P108 is unregistered and every Round23 protected file must
  still match.
- `CD04 in_progress`: P108 exists with `status=in_progress`, its complete
  definition matches the anchored digest, and only admitted non-trust-root
  overlap paths may drift.
- `CD04 completed`: it is not a valid P107A/Round2 checker phase. P108 may become
  `done` only after CD04 implements and independently closes a next-version
  reviewed delta trust head; the current head cannot express or validate it.
- Any other state/Feature mapping, definition drift, unauthorized path drift,
  trust-root drift, alias, symlink, hardlink, deletion, or capture/postflight
  identity change fails closed.

An admitted in-progress result is reported as `authorized_unreviewed`, with the
historical snapshot digest and every before/after drift hash. It is never
reported as current Round23 acceptance.

## Package boundary

`package.json` is not a normal P108 drift path. P107A may perform one exact
reviewed migration that:

- preserves all existing scripts byte-for-byte except the explicitly reviewed
  `program:check` target and addition of the fixed performance-baseline script;
- preserves dependencies, devDependencies, package manager configuration, and
  version identity;
- adds no install, prepare, preinstall, postinstall, or other lifecycle hook;
- remains independently invoked by direct external commands during acceptance.

Any later package or harness drift requires another externally anchored
trust-root version bump.

## P108 admission boundary

CD03A authorizes only CD04/P108. It does not pre-authorize CD05–CD09. The
admission includes the exact P108 ordered file list, definition of done, and
verification commands. `package.json` may appear in the Feature bookkeeping but
is excluded from ordinary source drift because its one allowed transition is
owned by P107A.

## Acceptance stages

1. **Historical integrity** — the complete Round23 evidence bundle and original
   external anchor revalidate; the Round2 baseline archive binds the exact 17
   modify baselines and four governance-transition sources.
2. **Contract and adversarial tests** — self-expansion, trust-root drift,
   structural package drift, replay, aliasing, partial migration, and TOCTOU are
   rejected; the four pristine review/planned/authorized-active fixtures behave
   as specified, while P108 `done` is rejected by this trust-head version.
3. **Repository gates** — focused tests, test type coverage, full verify,
   production smoke, direct base/continuation validation, harness, and
   whitespace pass.
4. **Independent closure** — one frozen P107A digest receives contract, runtime,
   and governance PASS with zero unresolved Critical/Major/Minor findings, then
   a repository-external continuation anchor is published.

## Rollback

Before durable journal publication, an unactivated attempt may leave the live
repository untouched and CD04 remains planned behind CD03. Journal publication
is the forward-only boundary: after it exists, restoring captured package,
harness, or other old bytes is not a valid recovery operation. Retry must
idempotently complete the four reviewed transitions, repository attestation,
manifest, external anchor, and completed marker, or fail closed without
overwriting a third state.
Authoritative Chat, Goal, Plan, Run, Tool, approval, and causal data are never
rewritten by this governance transition.

## Round1 rejection and Round2 amendment

Round1 was frozen at
`sha256:e8f82a943cae4e6c06732936986229a2e85f7783e6b283cf0b6b431b4f1ff7e5`
and independently rejected by all three lanes. Its failed receipts report
contract `1 Critical / 4 Major`, runtime `2 Critical / 5 Major`, and governance
`3 Critical / 9 Major`. No PASS review set, continuation manifest,
attestation, or external anchor may be derived from that candidate.

Round2 replaces the Round1 contract instead of widening it. The authoritative
launcher is a caller-pinned, repository-external, self-contained runner. Local
checker and harness output is secondary evidence only after the launcher has
captured their complete import closure into a private external stage.

This Round2 amendment expressly supersedes the earlier Round1 assumptions in
this ADR: a merely `planned` descriptor is not admission, the old “13 overlaps”
model is not the Round2 coverage model, and recovery after journal publication
never restores captured old bytes. The authoritative Round2 P108 path authority
is exactly `17 modify / 12 create / 9 bookkeeping`, with the four governance
transitions governed separately.

### Closed-world lifecycle

The policy anchors the stable Program root: every non-lifecycle top-level field,
every scenario semantic except its accumulating `acceptanceEvidence`, and every
workstream definition except `state`. It also anchors the governed historical
Features and exactly four lifecycle profiles: review before transition, review
after transition, externally anchored planned, and authorized active. The
top-level `updatedAt`, `status`, `activeFeatureId`, and `nextFeatureId` remain
lifecycle projections rather than stable-root authority. Unknown workstreams,
duplicate or unknown governed
Features, any unknown unfinished Feature, dependency drift, and active/next
drift fail closed.

The P107A head authorizes P108 only through `in_progress`. It contains no
synthetic successor-delta digest and does not validate a `completed_pending_delta`
phase. P108 `done` requires CD04 to define and independently review a distinct
next-version delta trust head before that state can be expressed.

P107A itself remains a governed subject after completion. Every check recomputes
its stable workstream definition, Feature definition, ordered file-set digest,
and the exact path-classification coverage digest. A mutable live Feature list
cannot add authority.

### Path authorities and preserved baselines

Round2 separates four permission domains:

- `modify`: an exact existing byte baseline, sourced either from Round23 or the
  CD03A pre-admission capture;
- `create`: proven absent at freeze and still absent in every planned phase;
- `lifecycle`: program and Feature bytes may change only to a complete anchored
  lifecycle profile;
- `bookkeeping`: progress documents remain non-authoritative and can neither
  add executable paths nor satisfy acceptance.

Every implementation path belongs to exactly one class. Package, harness, and
the two legacy governance tests are excluded from P108 drift and belong to the
one-time governance transaction.

The exact Round2 P108 roster is 38 paths: 17 `modify`, 12 `create`, and 9
`bookkeeping`. Lifecycle state is validated through the four closed profiles;
it is not a fourth path-authority count. The four governance-transition live
paths are also governed outside that 38-path authority partition.

Because later admitted work legitimately changes Round23 paths, the Round2
head preserves deterministic compressed source bytes for every mutable
Round23 path, every CD03A pre-admission modify baseline, and every governance
transition source. Future validators reconstruct the full historical snapshot
from this exact archive plus unchanged live paths; they do not pretend changed
live bytes still equal Round23.

### Exact transition and publication transaction

The governance transaction contains full target bytes and exact `from`/`to`
hashes for `package.json`, `scripts/check-harness-state.mjs`,
`conversationDisclosureProgram.test.ts`, and `packageScripts.test.ts`.
Pre-transition validation accepts only all four `from` values; post-transition
and ordinary validation accept only all four `to` values. Mixed states are
never a valid checker profile.

The external runner performs no write before a private prepared journal is
durable. After journal publication it only moves forward, idempotently, through
the four transitions, repository attestation, pending-to-final manifest, caller
anchor, and one inode/digest-bound completed marker. Process failure at any
boundary must converge on retry; third-party bytes, parent swaps, aliases, or a
third digest remain fail-closed and are never overwritten.

The caller separately pins the runner, Node executable, base anchor, policy,
snapshot, pending manifest, and each review receipt digest and challenge. The
runner clears preload/loader environment, executes staged candidates with an
absolute Node executable and fixed timeout/output bounds, and rehashes the
captured repository and stage before and after execution.

### Round2 acceptance

Round2 is eligible for external closure only when all focused tests are green,
the complete Round23 evidence bundle revalidates, four-file staged transition
tests pass, crash injection converges at every journal/publication boundary,
and three fresh independent reviewers report zero Critical, Major, or Minor
findings on one Round2 snapshot. Until then CD03A/P107A remains active and
CD04/P108 remains planned and unregistered.

Repository-local `npm run program:check`, no-argument harness execution, and
`--diagnostic-only` harness execution are explicitly
`local_unpinned_diagnostic` with `authoritative:false`. They are useful local
core gates, but they are not external acceptance evidence and cannot substitute
for the complete caller pins, repository-external runner, independent receipts,
or external continuation anchor required above.
