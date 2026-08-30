# Findings and Decisions: Zerox Agent v3.9.2 Conversation Disclosure

## CD05 Chat surface findings

- CD05 cannot add a new main-process authority boundary: its declared surface
  is shared/preload/renderer only. It therefore projects the existing
  sanitized Chat status stream and leaves CD04 materializer/evidence authority
  for later cross-surface work.
- Generic phase events cannot use `turnId` alone as stable row identity because
  workspace, model, and other phases in one turn would collapse. The stable
  fallback is `requestId + state`; Tool rows continue to use invocation
  identity so call/result updates replace one row.
- The V13 trust head freezes `src/shared/conversationDisclosure*` and the five
  transition targets. P109-specific mode parsing must live outside that frozen
  set, and the reviewed package test bytes must remain exact even though their
  trailing blank line makes an unscoped `git diff --check` report an inherited
  warning. CD05's own changed-file whitespace gate is clean.
- Browser MCP navigation reached the local URL but its AX snapshot lost the
  loaded-page association and screenshot capture timed out. The repository's
  local Electron `capturePage` path produced deterministic desktop and narrow
  visual evidence instead.

## CD04 V13 closure

- The v9 reviewed delta trust head is complete: snapshot
  `sha256:8ffc69be873f30d7ca8c0c4c35fd6139ece6292f6b9277ef52694d3edb626631`,
  manifest
  `sha256:c13d8cea8a113deb20e75886fa55d2dcd1928a63904532cf51f26d08a607672f`,
  and external anchor
  `sha256:99b8b7af27e24d2c44e2bb3b2433ada877fd68aeac2d1de80427931de15c01ef`.
- Descriptor-relative transition and final capture-ledger postflight converge
  on the exact five target bytes. The caller-owned journal is private,
  canonical, and monotonic from applying to completed.
- P108 is now immutable completed history. P109/CD05 may change only its
  declared Chat surface, preload, shared disclosure, feature/program, and
  planning/evidence files while preserving the CD04 trust head.

## CD04 V8 rejected review findings

- V8 replay and integration passed `0C/0M/0m`; security rejected at
  `0C/2M/0m`. Both findings were independently confirmed.
- Four direct imports executed by the V13 harness checks were outside the
  frozen closure: runtime, Kernel, storage, and release Program checkers.
- Evidence anchor issuance signed sensitivity from the caller-supplied
  snapshot, while current-object matching omitted sensitivity. A caller could
  downgrade a restricted item before issuance or retain a stale lower
  sensitivity after the current item became restricted.
- V9 freezes all four direct harness checkers and binds the current item's
  sensitivity to the anchor before and after backend access.

## CD04 V7 rejected review findings

- V7 security passed `0C/0M/0m`; replay returned `0C/1M/0m` and integration
  returned `0C/3M/0m`. Two validators confirmed the three correctness roots;
  one confirmed and one downgraded the historical timeout as a latent risk.
- Workspace Tool facts were initially loaded under `workspaceRunId`, then
  remapped to the logical AgentRun while cleanup removed only logical-run
  candidates. The valid raw Workspace candidate survived and produced a false
  incompatible cut.
- V13 delegated to the live V12 runner and dynamically discovered historical
  tests without freezing the executable/test/archive closure. Parent evidence
  proved historical bytes but did not rehash the live files V13 executed.
- Receipt chronology was enforced, but manifest and anchor validators accepted
  completion timestamps before snapshot freeze and review completion.
- V12's historical V3 roster omitted RunnerV3. Once added as a V13
  supplemental lane, its 20-second child budget required an explicit 15-second
  Vitest budget instead of the default five seconds.
- V8 removes raw remapped Workspace candidates, freezes the historical gate
  closure, enforces receipt-to-manifest-to-anchor chronology, and executes the
  missing V3 runner with the explicit historical timeout.

## CD04 V6 rejected review finding

- V6 security and integration passed `0C/0M/0m`; replay rejected at
  `0C/1M/0m`. Two independent validators confirmed the finding.
- Tool candidate conflict grouping treated `updatedAt + status` as the
  revision, then used lexical status ordering as a tie-breaker. Equal-time
  terminal conflicts such as completed versus aborted could therefore select a
  success state instead of producing an incompatible cut.
- V7 treats `updatedAt` alone as the revision and status/ok as revision-body
  semantics. Equal-time disagreement is now incompatible and covered by a
  direct negative regression.

## CD04 V5 rejected review findings

- V5 replay and integration passed `0C/0M/0m`; security rejected the exact
  snapshot at `0C/2M/0m`. Two independent validators confirmed both roots.
- The V13 freezer, builder, checker, and transition runner imported the
  Round12 runtime-I/O helper, but the v5 frozen set did not bind the helper's
  current byte digest. The parent anchor proves its historical byte, not the
  live dependency executed by V13.
- The external transition journal accepted an `applying` object by comparing a
  field subset. A same-identity document with extra keys or non-canonical bytes
  could be replaced by a clean `completed` document, erasing evidence of a
  third state.
- Preserve v5 as rejected history. V6 directly freezes the runtime-I/O helper
  and accepts journal evolution only when the existing bytes exactly equal the
  one canonical applying document.

## CD04 V4 rejected review findings

- All three v4 lanes verified snapshot
  `sha256:c874b4447b2318a53fa6d60a7cdc69d8d1a0406132c3597ac2b843bb1b9c9049`
  and returned `FAIL`: replay `0C/2M/0m`, security `0C/1M/0m`, integration
  `0C/6M/0m`. Two fresh validators independently confirmed all eight merged
  Major roots; the cross-source Tool conflict was reported by both replay and
  integration.
- V13 path safety remains incomplete. Descriptor-bound reads protect the
  bytes while an fd is open, but neither the transition nor the final checker
  proves that the active pathname still resolves to that inode immediately
  before authoritative receipt publication. Parent or leaf replacement can
  therefore leave a third-state live path after reviewed bytes were read.
- Required Tool resolution stops after the first valid Workspace candidate
  and scans Trajectory only when unresolved. A Workspace/Trajectory identity
  or lifecycle conflict can therefore publish a complete successful snapshot
  and fail only when evidence is later expanded.
- Trajectory owner rejection removes its facts but does not feed
  `trajectoryReadIsComplete`; Tool items can report
  `contributorsComplete=true` with zero accepted contributors and an
  incompatible Trajectory cut.
- The production read-set constructs context and usage only from the Chat
  transcript. Goal/Plan/execution usage and context authorities are omitted
  without an honest unavailable/partial cut, and a missing
  `Goal.activePlanRef` target likewise leaves coverage complete.
- The parity artifact bypasses production owning stores and the container
  loader by injecting an in-memory read-set against a golden in the same
  script. It cannot detect the discovered wiring omissions or cross-source
  conflicts and therefore is not yet completion evidence.
- The performance artifact labels the bytes of the last replayed delta tail as
  `ringBytes`; it does not measure the complete retained materializer ring, so
  the one-MiB gate does not constrain the claimed resource.
- The manifest binds the bytes of
  `CD04-shadow-parity-review.md` without validating its verdict or counts.
  Empty or explicit-FAIL review prose can be hashed into an otherwise valid
  manifest.
- Preserve v4 as immutable rejected evidence. V5 must repair all eight roots,
  add direct negative regressions, regenerate parity/performance evidence, run
  source and target gates, and receive three fresh exact-digest reviews before
  any transition.

## CD04 final review restart findings

- The fresh three-lane review rejected the candidate with `0 Critical / 12
  Major / 0 Minor`; P108 remains open and no V13 cutover is authorized.
- Replay correctness found four root gaps: terminal preservation can mask a
  same-revision incompatible cut, primary regression can incorrectly degrade
  an independently monotonic contributor set, `localeCompare` makes canonical
  tie-breaking locale-dependent, and a causal approval ref has no negative
  obligation when the approval row is absent.
- Evidence/security found four concrete boundary gaps plus one conflict-policy
  question: Goal evidence needs post-read current-owner authorization,
  causally linked Workspace owners must bind back to the trusted causal
  session/request, non-Basic/Bearer Authorization schemes leak their token,
  and the legacy JSON Chat read must use one no-follow descriptor rather than
  lstat followed by path read. Cross-store Tool history must be checked against
  the intended lifecycle semantics before changing its older-record policy.
- Adapter/performance/governance review found three additional roots:
  Workspace/Scheduled/Tool rows need intrinsic scope validation at the adapter
  boundary, performance artifact updates need an exact required fixture and
  metric roster instead of deriving acceptance shape from worker output, and
  the V13 runner/cutover must be admitted by a separately reviewed P108 delta
  trust head rather than directly changing the V12-governed live files.

## CD04 bounded source and adapter implementation

- Final independent re-review exposed eleven Major issues across four root
  families: trajectory evidence could stand in for a Run owner; guided-input
  settlement matching omitted its full causal identity; parity/performance
  acceptance could omit required facts or retain fabricated measurements;
  cached evidence snapshots and latest-only scans could miss authority drift;
  equal revisions, removed terminal sources, optional contributor regression,
  and partial contributor sources were not modeled monotonically. The first
  independent validator reproduced all eleven against current bytes.
- Final adapter/performance review reproduced four additional Major defects:
  repeated required Chat-message obligations were collapsed with `.some()`;
  Workspace witnesses did not validate the event's embedded
  `workspaceRunId`; worker samples were reduced to medians before aggregate
  p95/max computation; and one lifecycle mismatch was also counted as a body
  mismatch. Each requires a focused negative regression and fresh artifacts.
- Follow-up replay/evidence/adapter reviews found that three-way conflict
  selection must ignore already-merged contributors, contributor paging must
  consume the projector's selected conflict group, `completed_unverified`
  must permit only a monotonic verified-success upgrade, every required
  settlement/run obligation needs a full causal key, owner-bearing pages and
  records must agree, and relative paths must be redacted and audited too.
- Resume audit found a Stage 3 consistency defect before formal evidence
  generation: `createDelta` detects `attemptSettlements` changes but emits an
  empty `attemptControls` array, so the shared reducer cannot reproduce the
  projected settlement state. Materializer publication must either emit the
  exact attempt controls or rotate generation; it may not publish a delta
  whose returned snapshot diverges from the freshly projected snapshot.
- The first five-process performance run correctly failed its absolute safety
  gate: the 160-record 2 KiB-summary fixture measured about 2.14 seconds p95,
  while 500 ordinary items and bounded 10k/25k history tails remained in the
  single-digit millisecond range. The defect is isolated to long-summary
  sanitization/projection and must be optimized rather than hidden by a larger
  threshold.
- Independent CD04 review found that a valid page cut with `nextCursor` was
  being treated as complete projection coverage. The adapter now distinguishes
  source integrity from materialization completeness:
  `partial / source_page_incomplete` is retained until every required witness
  is found or a source-specific exact lookup resolves it.
- Required causal identities are negative obligations as well as join hints.
  Missing accepted/user messages, committed Chat settlements, exact Workspace
  settlement events, or Tool Invocation refs now create required unavailable
  cuts; prepared Workspace event ids never satisfy a committed witness.
- Evidence anchors now bind the complete canonical projection scope and the
  primary source revision plus status. Contributor anchors bind the
  materializer generation and contributor-set revision; pagination checks
  generation inside the same per-scope serial operation.
- Tool Invocation evidence uses a bounded 256-page cursor walk for exact
  on-demand lookup, and required invocations use the same path to supplement
  the ordinary first materialization page. Ordinary unconsumed pages remain
  explicitly partial rather than causing unbounded refresh work.
- Fact-level source cuts must bind the owning `authorityRef`. Reusing a
  session/run fallback merged distinct Chat or Plan records and could mark
  valid mixed revisions incompatible. Page-level cuts continue to bind their
  store source id independently.
- Store paging uses one shared source/query/revision-bound cursor contract.
  Cursors are continuity tokens, not authorization capabilities; evidence
  authorization remains a separate main-process boundary.
- SQLite Chat activity and Trajectory pages capture a query-local high-water
  mark and issue an indexed `LIMIT` query. A changed cut rejects cursor reuse
  instead of comparing opaque revisions.
- JSONL Trajectory and Workspace pages read fixed chunks from one no-follow
  file descriptor, cap page and record bytes, bind device/inode/size/time
  identity, surface corruption as partial, and propagate abort.
- Legacy JSON Chat cannot prove complete history because only the latest 80
  activity records survive. Its page is therefore always
  `partial / legacy_chat_activity_tail`; an oversized or damaged monolithic
  source is unavailable rather than silently treated as empty.
- Adapter review found two existing pure-projector weaknesses that CD04 must
  close before materialization: source cuts currently collapse by fact kind
  instead of authority identity, and opaque revisions are selected
  lexicographically. Older deltas also need exact replay evidence rather than
  unconditional duplicate acceptance.
- Tool `resultRef` is internal storage identity and must not appear in the
  public projected payload. Evidence anchors/cursors require a distinct
  current-authorization boundary.

## Round12 recovery implementation audit

- `./init.sh` still fails only at the documented completed-CD03 external-anchor
  gate; the direct caller-pinned Round23 check remains the recovery authority.
- The initial V12 focused probe passed `80/87` tests and exposed seven inherited
  fixture/root failures, not a production behavior regression.
- The V12 self-contained runner still carried Round10 policy, snapshot,
  receipt, finding, forbidden-output, count, and round constants after its
  mechanical V11-to-V12 copy. It must bind the immutable Round11 evidence
  before it can become a review subject.
- Round11 receipt canonical roots match the handoff, but the serialized file
  roots are contract `sha256:22912a96...310b1`, runtime
  `sha256:c9116376...6ad4`, and governance `sha256:1d096811...1a8a`.
  The inherited constants incorrectly used a different serialization root.
- Round11 has three completed receipts. Only its closure manifest and external
  attestation remain forbidden outputs; the V12 admission fixture must not
  classify the completed runtime receipt as absent.
- The V12 archive fixture must identify Round12, the completion artifact count
  is `88`, and the state-aware orchestrator must use current Round12 target
  roots plus the Round11 baseline archive.
- The V12 orchestrator currently reconstructs V3, V4, V7, V8, V9, and V10 but
  omits the immutable Round11 historical lane required by the program.
- Runtime source changes now admit only an exact two-link journal/marker inode,
  compare journal-recorded publication parent identity during convergence, and
  pin Node executable realpath/device/inode/mode/owner/link-count/digest around
  candidate execution. Executable adversarial regressions are still required.

## Round6 adversarial rejection and Round7 requirements

- Round6 policy, archive, snapshot, exact-byte dispatch, and review-pre checker
  were internally consistent, but governance rejected the candidate with two
  Major findings before any transition.
- The inherited rejected-output class omitted the three Round1 forbidden
  outputs. They remained absent in the live tree, but the Round6 snapshot and
  checker did not make that absence part of the current review contract.
- CD03A completion artifacts contained intentionally absent rejected
  manifests, attestations, and interrupted receipts. The pure lifecycle
  validator could accept `anchored_planned` without proving this list was
  satisfiable.
- The Round6 target `program:check` replaced the preserved conversation program
  checker with a diagnostic-only continuation harness. This kept ordinary
  target verification green but did not independently enforce completion
  artifact existence.
- Round7 therefore needs one explicit transitive Round1 absence union, an exact
  satisfiable CD03A completion-artifact list, a mutation rule rejecting any
  overlap with rejected outputs, and a target `program:check` that executes the
  preserved checker with the caller-pinned Round23 anchor.

## Round7 runtime rejection and Round8 requirements

- Round7 governance passed, but runtime rejected the candidate with four Major
  findings. A PASS lane and a FAIL lane are both immutable completed review
  evidence; the Round8 rejection witness must describe them as
  `completedReceipts`, not falsely label both as failed.
- The copied self-contained V7 runner still hard-coded V6 round numbers and
  Round5 roots. Versioned tests must assert every current/rejected round value
  and every predecessor policy, snapshot, receipt, finding, and absence root.
- Completed Program checking cannot stop at file existence. Review state may be
  checked locally, but completed/active P107A state must require a
  caller-supplied continuation anchor and run the full continuation checker.
- An absence check followed by ordinary `rename` is not no-replace. The
  descriptor-anchored runner must use the platform atomic no-replace primitive
  for every originally absent output.
- A random hard-link temporary makes the link-before-unlink crash window
  unrecoverable. Private publication needs a digest-derived deterministic temp
  and explicit recovery of both temp-only and exact two-link temp/output states.

## Round8 runtime rejection and Round9 requirements

- Round8 governance passed, but runtime rejected with five Major findings.
  Path-based cleanup remained outside the anchored directory descriptor, and
  existing-file transition still lacked original-inode binding.
- An absence-only no-replace fix is insufficient for existing targets. Round9
  uses atomic exchange, verifies both resulting inode identities, and prevents
  a raced third state from being silently overwritten.
- A completed marker whose filename names the journal inode must itself retain
  that inode. Round9 completes the journal through a same-inode hard-link
  handoff and validates the marker's own device/inode on replay.
- Program review state must prove all four live bytes are all-from and all four
  staged targets are exact. Completed or active state must require both base
  and continuation anchor pins and invoke the full continuation checker.
- Base-anchor custody is caller-owned. No `/private/tmp` path may be compiled
  into the completed-state program checker.
- The first all-to full-verify attempt exposed a state-orchestration gap:
  target `package.json` invokes V9, but the V9 current lane still assumed the
  invoking tree was all-from. V9 now validates the exact four-file state and,
  when invoked all-to, reconstructs the current all-from lane from the immutable
  Round8 archive while retaining the original all-to target lane.
- The reconstructed current lane must use a short canonical macOS temp root.
  A deep per-user temp path makes the unchanged `sourceImportCasing.test.ts`
  exceed its 15-second budget because that test walks root-to-leaf components.

## Round9 contract rejection and Round10 requirements

- Round9 governance passed, but contract rejected the frozen candidate with
  five Major findings. Two independent validation lanes reproduced every
  finding with temporary mutation probes, so all five are high-confidence.
- Review receipts validate only timestamp syntax. Round10 must require
  `snapshot.frozenAt <= completedAt <= trusted verifier time`, and bind
  `snapshotFileCount` plus `validatorDigest` to the exact frozen snapshot and
  checker executable.
- Candidate result validation is optional in the V9 attestation validator, and
  the ordinary checker omits the binding. Round10 must derive the exact ordered
  checker/harness results from trusted execution evidence and require equality.
- The V9 checker trusts final-manifest-selected validator/runner paths and
  derives the expected pending projection from the same final object. Round10
  must pin canonical paths and digests from policy/constants and rebuild the
  pending projection from independently captured policy, snapshot, receipts,
  and runner evidence.
- `policy.programId` is only required to be nonempty. Round10 must bind it
  exactly to `closedWorld.programRootDefinition.programId` and the live Program
  root.

## Round10 contract rejection and Round11 requirement

- Round10 closed all five Round9 findings, but contract review found one
  remaining predecessor-link gap: the embedded Round9 rejection witness
  `programId` was validated as nonempty rather than equal to the Round10 policy
  and closed-world Program root.
- Two independent mutation probes changed only the embedded predecessor
  `programId`, recomputed the enclosing canonical digests, and reproduced an
  authoritative contract/checker PASS. The self-contained runner already
  rejects the same mutation, proving a contract/checker semantic mismatch.
- Round11 therefore adds one explicit equality at the shared policy contract
  and matching checker assertions. No V10/Round10 byte may be changed.

## Round11 runtime rejection and Round12 requirements

- Round11 contract and governance passed, but runtime rejected with three Major
  findings. Two independent read-only probes reproduced all three.
- Journal completion can crash after the marker hard link is durable but before
  the journal name is removed. Both names then have `nlink=2`, while recovery
  currently rejects each before reaching its two-link convergence logic.
- Each publication records `parentIdentityDigest`, but execution and recovery
  reopen the pathname's current parent without comparing that identity to the
  journal. A replaced parent can therefore redirect an otherwise valid replay.
- The runner hashes `process.execPath` only at startup. Candidate checker and
  harness launches need immediate pre/post device, inode, and digest checks so
  a user-writable Node binary cannot be swapped during the execution window.

## Round4 recovery audit

- Recovery resumed on branch `codex/3.9.2` at baseline commit
  `942712279426601c1a5162dabc6fb9b663262e07`; the existing dirty worktree is
  intentional and must remain intact.
- `./init.sh` reached the disclosure harness and failed only because completed
  CD03 requires the caller to supply its repository-external closure anchor.
  This is the documented fail-closed contract, not a product regression.
- The original Round23 anchor is still present at its canonical
  `/private/tmp/zerox-cd03-r23.YkhhKk/...` path as a user-owned, single-link,
  mode-`0600` regular file. Its raw byte SHA is not the recorded canonical JSON
  digest; authoritative recovery must use the direct checker with the recorded
  canonical digest instead of comparing the two representations.
- R4-0 closed without drift: all `26` Round3 protected bytes match the frozen
  snapshot/policy/receipt roots, the four live transition files are exactly
  all-from, all ten V4 pause hashes match, and every formal/forbidden output is
  still absent.

## Round4 shared contract audit

- Runtime I/O already implements one concrete API:
  `createCaptureLedgerV4`, stable/private present capture,
  `captureRequiredAbsentV4`, complete-ledger postflight, and private exact
  publication. The contract and ADR still describe the abandoned generic
  `capturePresent/captureAbsent/postflight` adapter, so that duplicate semantic
  surface must be removed rather than shimmed.
- `CONTINUATION_V4_ADMISSION_CLASSES` is the correct ordered six-value source,
  but the policy schema does not yet carry `admissionClassSet` plus its
  canonical digest. Omit/extra/duplicate mutations therefore are not hard-root
  policy failures yet.
- Governance's only failing test requires a contract-owned exact four-file
  transition map and validator that accepts all-from or all-to and rejects
  every mixed/third state. Lifecycle phases, baseline archive, and review
  snapshot schemas must likewise move into shared V4 contract exports before
  freezer/checker/runner code is added.
- The safe V3 reuse boundary is structural only: deterministic gzip archive
  entries, exact snapshot evidence partitions, policy-digest bindings, and
  lifecycle profile selection. V4 must add the Round3 rejection digest and
  six-class set/digest roots, switch all targets to Round4 paths, and retain its
  caller-attested/not-signed review schema rather than importing V3 reviewer
  identity claims.
- The interrupted dispatch schema had a causal impossibility: a dispatch set
  created before review contained `receiptCanonicalDigest`, which cannot exist
  until the reviewer finishes. V4 now pre-pins `instructionDigest`, challenge,
  lane, claimed task slot, and review context; each receipt binds the canonical
  dispatch-set and entry digests, while the later manifest binds receipt
  canonical digests.
- The V4 transaction runner is derived mechanically from the already
  adversarially hardened self-contained V3 state machine so descriptor-anchored
  publication, deterministic journal recovery, completed markers, and staged
  candidate isolation are retained. Only the copied V4 file receives schema,
  rejection-chain, dispatch-assurance, target, and evidence changes.

## Round4 adversarial rejection and Round5 requirement

- The frozen Round4 policy and snapshot are internally consistent at
  `sha256:c4b40e8dd31554b3bd25ccf1c1d3d1671291e8f52c41286d9cd729ebb8fa4843`
  and
  `sha256:7e3f075ac63abd39ce9e4a9ab6a3780e864c5397ddb40ecaef0d3a541febf740`.
- Governance review rejected the subject with one Major:
  `validateContinuationExternalAttestationV4` accepts an empty candidate result
  set and future completion time, while
  `validateContinuationExternalAnchorV4` does not bind exact head semantics or
  all manifest/attestation roots. The ordinary checker consequently can accept
  a structurally canonical but semantically incomplete external evidence
  chain.
- Round5 must require exactly ordered checker/harness PASS results, trusted
  verifier time for attestation and anchor, exact runner/validator/parent/
  rejection/dispatch bindings across manifest-attestation-anchor, and an exact
  `successor-admission / externally_attested / CD03A / P107A` head that still
  leaves P108 completion unrepresentable.

## Round5 recovery audit

- R5-0 resumed on `codex/3.9.2` at baseline
  `942712279426601c1a5162dabc6fb9b663262e07`.
- Round4 remains pre-transition: all four live files match their exact source
  roots, all `90` frozen files and four target payloads match the rejected
  snapshot, and contract/runtime receipts plus manifest/attestation remain
  absent.
- Recomputed serialized roots are policy
  `sha256:f920a1f17b28b7ed63f0196f3447fbb87641fe6198e8059623f43bc4f68fb303`
  and snapshot
  `sha256:0b1625d7646eb40e3c9c9091ad85cb1e0bfab3ab3e6ebc25793d86c179a3a8c3`.
  The policy byte root is independently embedded in the rejected snapshot.
- The original Round23 caller-pinned checker still passes. Round5 must keep
  this historical trust chain independent of its new final-evidence semantics.
- R5-3 roster audit found that P107A currently contains `120` unique paths and
  misses `33` paths required by the V5 closed-world builder. The exact
  successor roster must therefore become `153` unique paths before policy
  generation.
- The four Round5 transition payloads are already the intended V5 targets, but
  the contract still contains the Round4 target digests. Their actual
  serialized SHA-256 roots are package `68755273...159fa`, harness
  `e254c4e5...7b182`, Program test `056213fc...3aa1`, and package-scripts test
  `399467de...ba00`; only the V5 trust-root constants must change.
- The first real-shape freezer run exposed that V5 inherited only the Round2
  forbidden-output list directly from V3 and therefore dropped the rejected
  Round3 manifest/attestation absences. Successor rounds must inherit the full
  predecessor rejected-output set transitively before adding the newly
  rejected round.
- The first state-aware V5 run proved its current lane (`331` files / `3753`
  tests) but exposed a copied-orchestrator error: it executed immutable V3 tests
  after restoring Round4 definitions. Historical test lanes must restore the
  exact version under test, so V5 keeps the V4 orchestrator's Round3
  reconstruction and changes only the target lane to Round5.
- The next target-lane run proved the Round5 Program target cannot depend on
  the not-yet-published Round5 archive. Its historical harness reconstruction
  remains bound to the already published Round4 archive; the corrected target
  byte root is `sha256:2cbb1957...f56fd5`.
- The all-to fixture must live at a short canonical path. The existing
  `sourceImportCasing.test.ts` walks every absolute path component for every
  import candidate; a deep macOS per-user temp path reproducibly exceeds its
  15-second budget even though the same tree passes from the repository root.
  `/private/tmp` preserves the test contract without weakening its timeout.
- Coze has no existing `building-agent` cloud project. Upload/import is
  intentionally not used because this repository's local-first boundary
  forbids adding a cloud worker to the trust-sensitive continuation work.

## CD03A append-only successor trust head

### Round3 adversarial rejection and Round4 requirements

- Round3 was frozen consistently, but consistency was not execution
  reachability. The runner's admission-class allow-list omitted
  `rejected_output_absent`, so every fresh or recovered external transaction
  would reject the exact frozen policy before transition. This Critical makes
  the round unsalvageable even though the local pre-transition checker passed.
- The checker absence helper returned `false` when a supposedly absent file was
  present, while its Round1/Round2 callers ignored the return value. Absence
  must be a throwing capture primitive whose successful observations are part
  of the postflight ledger; boolean conventions are too easy to misuse at a
  trust boundary.
- The manifest builder protected each individual read but never rehashed the
  complete earlier capture set before output. A manifest can therefore combine
  stale frozen/baseline/payload/receipt observations from different repository
  moments. Round4 needs one global capture ledger and output-time postflight.
- Policy and snapshot are published private, but later checker/runner/manifest
  stages did not reject a `chmod` permission third state. Digest equality alone
  is insufficient where the policy declares private custody.
- Round3's ADR documented five coverage classes while its actual frozen
  contract required six. Because the ADR itself is frozen, even this Minor
  documentation drift requires a new append-only round.
- Review receipts can bind three unique self-reported task/agent strings, but
  local JSON cannot prove those identities came from three platform-enforced
  independent reviewers. Round4 must separate what is machine-verifiable
  (snapshot, challenge, transcript bytes, caller pins, task labels) from the
  procedural independence assertion, disclose `not-signed` assurance, and
  avoid claiming that a local validator proves platform identity.
- The platform thread limit prevented three brand-new task paths in this run;
  three distinct existing subagents were reused in new cross-lane review turns.
  Their findings are valid rejection evidence, but this constraint further
  confirms that fresh independence must remain an externally reviewed
  procedure rather than a self-certified local property.

### Round4 integrated architecture decision

- Round4 is a new append-only trust head, not a repair of Round3. Its rejection
  witness binds the exact Round3 policy, snapshot, and three failed receipts by
  both serialized-byte SHA-256 and canonical digest, and records the Round3
  manifest/attestation paths as repository-scoped forbidden outputs. It does
  not make an unverifiable claim that no matching external file exists
  anywhere; instead any external anchor whose subject is the rejected Round3
  policy/snapshot is semantically inadmissible.
- Admission coverage has one shared six-value enum used by the contract,
  freezer, checker, manifest, and runner. The runner may hard-root the enum
  digest but must derive its accepted set from a validated policy instead of
  maintaining a second incomplete allow-list.
- All stable reads and required absences feed one capture ledger. Required
  absence succeeds only on `ENOENT`, throws on every present object, and is
  rechecked at postflight. Policy, snapshot, rejection, receipts, manifest,
  attestation, anchor, journal, and marker are private evidence and therefore
  require effective-user ownership, one link, and mode `0600`.
- Fresh execution, crash recovery, and completed replay share a single derived
  transaction plan and the same validation path. Once a private journal is
  durably published, recovery is forward-only; a second permissive recovery
  contract is not allowed.
- The caller creates a private no-replace dispatch set outside the repository
  before review. It binds the three ordered lanes, task-slot claims, unique
  challenges, and instruction digests. Receipts may prove consistency with
  those pins, but task and agent labels remain unsigned claims. Every emitted
  artifact must state `identityAssurance: not-signed` and must not imply a
  platform signature or cryptographically proven independence.
- Round4 tests must accept exactly the all-source and all-target four-file
  states, reject all mixed states, keep P108 completion unrepresentable, and
  exercise the complete builder-to-freezer-to-checker-to-manifest-to-runner
  production shape in an isolated control tree before any repository
  publication.

### Round2 pre-freeze rejection and Round3 recovery

- The real Round2 policy was published no-replace at canonical digest
  `sha256:aa9fa6893b20b16ccab49cbe41af65a46b9719a334691ef6174722ffb1f2edc7`
  and serialized byte digest
  `sha256:0f082ee8000cf58a428073bfcd10151919ddb3eecc46dea6531422b01865e3ff`.
  Its first authoritative freeze failed before snapshot publication.
- The failure is a formal contradiction for each of four staged targets. The
  snapshot authority validator requires the target in `frozenFiles`, while the
  coverage validator then derives both `frozen_file` and `transition_target`
  and requires exactly one. Removing the target fails the first obligation;
  retaining it fails the second. No snapshot field mutation can satisfy both.
- The synthetic freezer and contract fixtures omitted staged targets from the
  admission Feature even though the production policy builder requires them.
  They later appended those targets to `frozenFiles`, hiding the double-class
  defect. A real-shape builder-to-freezer round trip is now a required gate.
- Two independent read-only agents reproduced the impossibility and agreed
  that patching v2, overwriting the policy, or hand-authoring a snapshot would
  violate the published trust root. Round2 therefore ends as a pre-freeze
  rejection, not as an independent review round.
- Round3 keeps every Round2/v2 byte immutable and adds a deterministic rejection
  witness. Coverage becomes an explicit policy array; snapshot evidence splits
  `transitionPayloadFiles` from `frozenFiles`, so target evidence is present
  without becoming a second semantic coverage class.
- The six forbidden Round2 downstream outputs are also members of the expanded
  P107A roster. Treating them as ordinary `frozen_file` paths creates a second
  contradiction because they must remain absent. Round3 therefore has a sixth
  explicit `rejected_output_absent` class, distinct from current-round review
  outputs and from the older Round1 authority absences.
- Reusing Round2 bookkeeping byte baselines also made the production freezer
  unreachable: Program, Feature, and progress files legitimately changed while
  recording rejection and recovery. Round3 inherits only the exact authority
  structure, validator, and allowed phases; after the stable semantic hard
  roots pass, it rebinds six explicit present paths with stable no-follow reads
  and continues to require three explicit absent paths.
- Historical test fixtures cannot use `process.cwd()` as their baseline after
  a forward transition. V2 reconstructs its admission definition from the
  immutable Round2 policy; V3 reconstructs all four source bytes from the
  validated Round3 archive. The same suites now pass in both pre-transition
  and policy-present post-transition states.
- The production-shape builder-to-freezer-to-snapshot-validator round trip now
  passes with `58` frozen, `4` disjoint payload, `24` absent, and `6` rejected
  paths. The fresh four-target stage then passed `17/287`, type coverage
  `319/319`, full verify (`318 + 1` files, `3733 + 6` tests), build/evals, and
  Electron/SQLite smoke. A final policy digest is intentionally deferred until
  the mutable planning evidence is stable.

### Round2 pre-freeze hardening results

- The first three Round2 pre-freeze audits all failed, which correctly stopped
  the freeze. Their common roots were mutable live controls authorizing P107A,
  incomplete Round1 rejection binding, a shallow manifest builder, runner
  TOCTOU/journal/mode/fsync gaps, and an impossible fifth completion phase.
- Round2 now hard-codes the exact ordered `55`-path P107A file set plus its full
  stable Feature and CD03A workstream definitions. It also freezes a stable
  Program root while excluding only lifecycle pointers, workstream state, and
  accumulating scenario acceptance evidence. Candidate-controlled live JSON
  cannot enlarge its own authority.
- Round1 rejection is part of the trust root rather than explanatory history:
  the exact policy, snapshot, and three failed receipt bytes/canonical digests
  are required, while all Round1 manifest/attestation/anchor outputs must stay
  absent. Byte drift or a preplanted PASS output fails policy construction.
- The lifecycle has exactly four accepted profiles: review before transition,
  review after transition, externally anchored planned, and authorized active.
  P108 completion is deliberately unrepresentable under P107A; CD04 must add a
  separately reviewed next-version delta trust head.
- Runner recovery is forward-only once its journal is published. Every resume
  revalidates repository identity, the full control set, caller pins, policy,
  archive, snapshot, receipts/challenges, staged targets, candidate results,
  file modes, and journal canonical digest. Successful publication fsyncs the
  parent directory and is covered across the rename-before-fsync crash window.
- A post-transition test-fixture defect was found only in the fresh four-target
  stage: the policy-builder fixture copied migrated live files even though it
  was validating the archived pre-transition baseline. Restoring those four
  bytes from the deterministic archive makes the tests valid both before and
  after migration; the fresh stage then passed all focused and full gates.
- No-argument or `--diagnostic-only` harness output remains local and
  non-authoritative. Before real policy/snapshot publication it is expected to
  fail on those missing inputs; only fully caller-pinned external execution may
  become acceptance evidence.

### Round1 rejection and Round2 root contract

- All three independent Round1 lanes rejected the same 19-file snapshot. The
  contract lane found `1 Critical / 4 Major`, runtime `2 / 5`, and governance
  `3 / 9`; the failed receipts are retained as machine-readable rejection
  evidence and cannot be treated as closure PASS receipts.
- The continuation validator needs a closed-world model, not named spot checks:
  the exact CD01-CD09 plus CD03A roster, dependency/order/status invariants,
  exact active/next Feature, and the only unfinished Feature must all be bound.
- Admission needs a pre-admission baseline independent of Round23 coverage.
  Existing non-Round23 files require exact baseline hashes, new executable or
  evidence files require proven absence, and bookkeeping paths require a
  separate non-authoritative class; none may silently enlarge P108 authority.
- Governance transitions require explicit source and target states. A frozen
  source hash proves preflight while a frozen staged target proves postflight;
  post-transition validation must not also demand the old source bytes.
- Executable trust cannot self-certify. The external caller must pin the runner
  and all executable dependencies plus every independent receipt/challenge;
  the harness must verify its import closure before importing it.
- The external closure is one crash-recoverable transaction spanning staged
  control capture, package/harness/test transitions, attestation, final
  manifest, external anchor, and completed marker. In-process rollback is not
  sufficient because SIGKILL and retry must converge from every boundary.
- A continuation head inherits the complete Round23 evidence chain, not just
  its snapshot digest. Round2 must revalidate the artifact, manifest, three
  receipts, attestation, publication/freeze markers, and caller-held anchor.
- Timestamps are evidence inputs: review, attestation, and anchor times must be
  rejected when later than trusted runner time plus a bounded clock skew.

- The initial P108 activation exposed a governance coupling before any protected
  P108 byte changed: Round23 correctly rehashes all 101 P107 files, while P108
  must evolve 13 overlaps. A fixture bug caused three positive closure tests to
  fail, but fixing only the fixture would leave real implementation blocked.
- Reopening CD03/P107 or replacing the accepted artifact was independently
  rejected because externally attested completion is monotonic. Round23 was
  restored unchanged and revalidated with its caller-pinned anchor.
- A live Feature allowlist is not authority: program and Feature controls are
  post-review mutable and could authorize their own checker or product drift.
  Admission must be static, externally anchored, exact, and established before
  the first protected P108 edit.
- The selected model is `Round23 base -> CD03A continuation anchor -> P108
  authorized_unreviewed -> P108 reviewed delta anchor`. Each later Feature gets
  a new link; an older successor allowlist never becomes a permanent ability.
- Ordinary P108 drift can cover only anchored non-trust-root overlaps. Package,
  harness, checker, review contract, freezer, external runner, continuation
  validator, and governance evidence require exact reviewed hashes. Package and
  harness may migrate once only as a separately anchored trust-root version
  bump owned by P107A.
- `authorized_unreviewed` proves admission boundary, not correctness. It must
  report every before/after hash and cannot be described as current Round23
  acceptance. P108 still requires focused/full/smoke/parity and independent
  review before its delta advances the trusted head.

## P108/CD04 bounded adapter architecture

- Three independent read-only routes converged on a read adapter architecture:
  causal lineage selects related records; owning stores supply bounded facts;
  the accepted pure projector builds items; a per-scope materializer owns
  generation/cursor/replay; evidence is loaded separately with current
  main-process authorization. No domain hot-write path or renderer is changed.
- SQLite Chat has a complete event log, while JSON compatibility retains only
  the 80-event activity tail. Treating both as complete would corrupt parity;
  P108 adds a bounded page contract whose JSON cut is explicitly partial.
- Trajectory and Workspace event queries must be bounded at their stores. A
  full `list()` followed by `slice()` is not a valid evidence or performance
  boundary.
- Kernel history is a 1,000-entry process-local ring and therefore remains an
  ephemeral contributor. Causal Kernel refs join identity but never upgrade
  that history to durable or recoverable owner truth.
- Evidence requests bind scope/query/generation/item/target, and each page is
  reauthorized from trusted main-process context. Tool Audit proves an
  authorization decision, not execution; Tool Invocation execution state comes
  from its owning Trajectory/Workspace observations.
- Opaque source cursors have no universal ordering. P108 publication order may
  replace a cut, but must not select a “newer” hash/UUID by lexical comparison.
  Coverage recovery rotates generation rather than improving a live cut.
- Current projection micro-characterization shows linear growth: roughly 59KB
  for 80 items, 371KB for 500, and 1.49MB for 2,000. These are diagnostic data,
  not budgets; CD04 freezes absolute limits from repeatable multi-process
  samples and keeps DOM claims tied to real renderer measurement.
- P108 research and the CD04 ADR remain accepted, but activation is deferred
  behind CD03A. No IPC, projected renderer, browser/API credential run, commit,
  push, or release is part of the trust-head bootstrap.

## P107 Round 23 accepted closure

- Contract, runtime, and governance reviewers independently accepted the same
  `101`-file frozen snapshot at
  `sha256:e1a5300d6015543e0a6a8e8f09f2a13fcb955111b87c08545e0f882bb786796b`
  with zero Critical, Major, or Minor findings. Their exact challenge-bound
  receipts are the only review evidence accepted by the Round23 manifest.
- The repository-external runner independently rebuilt the checker and harness
  control trees, produced a passed attestation, upgraded the closure manifest to
  `externally_attested`, and published a caller-custody anchor. This separates
  candidate-local green state from the external event required for completion.
- P107 is `done`, CD03 is `completed`, and the causal-shadow artifact is
  `accepted`. Completed-state validation intentionally fails closed unless the
  caller supplies `/tmp/zerox-cd03-r23.YkhhKk/CD03-round23-external-anchor.json`
  and canonical digest
  `sha256:e81f0afb3d10b12976b74d1499870b837595ffbc3b452c7f1f78fff67be8f102`.
- The anchor is outside repository custody and currently under `/tmp`; its exact
  path and digest are therefore a recovery dependency, not a repository-owned
  durable fact. Do not silently copy, regenerate, or replace it after closure.
- Browser/real-provider acceptance remains correctly deferred to CD09. No
  supplied API credential, external model request, commit, push, or release was
  used to close CD03.

## P107 Round 22 rejection and Round 23 owner-first terminal contract

- `commitAdmittedAgentRun` already defines the authoritative order: append the
  secret-safe terminal `AgentRunRecord`, then settle the exact executionRevision
  lease; fallible derivatives belong after this boundary.
- Both callers violated that contract in the same way. Recoverable
  `finishScheduledRun` and legacy `runInternal` awaited episodic-memory creation
  before calling the shared commit. A never-resolving memory promise leaves the
  causal admission started, while memory success followed by run append failure
  or process exit leaves an orphan source ref.
- The correction is systemic rather than UI-local: both paths must construct
  the exact owner, commit it, settle the lease, and only then execute memory,
  its post-terminal live notice, task-bookkeeping, and learning callbacks. Tests must hold memory
  pending while observing a durable terminal owner/lease and prove owner failure
  produces zero memory side effects.
- Contract independently verified Round22 bytes and returned `FAIL`, `0
  Critical / 1 Major`; the other two lanes were interrupted. No Round22 receipt,
  manifest, attestation, or anchor exists.
- Round23 now routes both terminal implementations through the shared owner
  commit and exact lease settlement before memory. A held-open memory promise
  proves the owner and revision-1 terminal lease are already durable; owner
  append and lease-settle failures each prove zero derivative calls. Because
  the commit helper persists a secret-safe projected clone, later memory notices
  can remain in return/live projection without mutating the authoritative row.
- Independent root gates pass `46/1193` focused, `4/164` governance,
  `304/304` test types, full verify `303/1` files and `3522/6` tests, production
  smoke, program, harness, syntax, bridge equality, whitespace, blind-path, and
  credential-shape scans.
- The Round23 canonical subject is `101` immutable files at
  `sha256:e1a5300d6015543e0a6a8e8f09f2a13fcb955111b87c08545e0f882bb786796b`.
  All hashes, embedded artifact equality, exact ordered `108`-file Feature
  digest, and the unique private completed-marker byte/device/inode binding
  independently match. An idempotent rerun is byte- and inode-stable; only the
  absent pending manifest blocks closure.

## P107 Round 21 rejection and Round 22 temp durability root contract

- A deterministic temp becomes real immediately after `open(O_CREAT|O_EXCL)`,
  not after its first successful write. A crash in that window leaves an empty,
  metadata-valid temp; Round21 required `0 < size`, so retry permanently failed.
- Exact bytes do not prove file-content durability. If the final write completed
  but the process died before `fsync(temp_fd)`, Round21 saw the replacement
  digest and skipped both continuation and fsync before rename. Directory fsync
  cannot substitute for first establishing the temp file's content durability.
- These are one state-model root family: every metadata-valid empty or strict
  prefix state must resume on the same inode, and every pre-existing exact temp
  must be reopened, fsynced, then identity/digest revalidated before commit.
- Runtime independently matched the Round21 digest and all `101/101` files,
  reproduced both windows against each byte-identical bridge in a temporary
  directory, and returned `FAIL`, `0 Critical / 1 Major`. Other lanes were
  interrupted; no Round21 receipt, manifest, attestation, or anchor exists.
- Round22 implements the complete temp durability state machine in both
  publication paths with one byte-identical 20,352-byte bridge. Empty,
  strict-prefix, and exact states are reopened with `O_NOFOLLOW`, captured on
  one descriptor, and accepted only as a private regular single-link file owned
  by the effective user. Empty/prefix bytes continue on that inode; every
  pre-existing exact temp is re-fsynced and then recaptured before commit.
- The new real fault points cover create-before-first-write,
  final-write-before-fsync, and recovered-exact-after-fsync. Freezer and runner
  tests verify zero-byte metadata plus exact-temp device/inode continuity and
  idempotent final convergence. Independent root gates pass `164/164`
  governance tests, `46/1192` focused tests, `304/304` type coverage, full
  verify `303/1` files and `3521/6` tests, production smoke, program, harness,
  syntax, bridge equality, whitespace, and blind-path scans.
- The canonical Round22 snapshot is
  `sha256:ad395edcd16c29d262bc193c5b753d99804adb2e8385a1ddf53c64c3ee6f11a5`
  over `101` immutable files. All hashes, embedded artifact equality, exact
  ordered `108`-file Feature digest, and the single private completed-marker
  byte/device/inode binding independently match. Re-freezing is byte- and
  inode-stable; only the intentionally absent pending manifest blocks closure.

## P107 Round 20 rejection and Round 21 leaf-bound publication root contract

- Directory identity does not bind a directory entry after its validation fd is
  closed. Round20 still performed basename replace/unlink after leaf inspection;
  swapping that leaf in the remaining window can discard a different inode,
  then fail post-check after the original is already lost. Recovery consequently
  cannot converge from either the recorded original or replacement bytes.
- Exact complete deterministic temps bypassed the owner/mode checks used only
  for partial bytes. A correct-digest mode-0666 temp could therefore become the
  final governance output, including the outside caller anchor, while completed
  validation checked bytes and link count but not owner/mode.
- Round21 must treat file publication as a leaf state machine: every temp and
  output has identical metadata constraints; every move is no-replace or
  exchange based; displaced originals live under deterministic recovery names;
  and each crash/interleaving either finishes the exact replacement or restores
  the exact original without deleting an unverified inode.
- Round21 now uses one byte-identical 18,563-byte OS bridge in the freezer and
  external runner. Darwin `renameatx_np` and Linux `renameat2` provide atomic
  exchange/no-replace transitions relative to an already opened directory;
  unsupported platforms fail closed. No blind `os.unlink` or `os.replace`
  remains in either publication bridge.
- The terminal transaction state is an immutable private completed marker, not
  absence. Its name binds canonical bytes plus device/inode; closure requires
  exactly one marker with the complete prepared-v1 transaction schema,
  canonical digest, and every currently re-provable snapshot/output binding.
  Missing, duplicate, minimal, stale, weak-mode, hardlinked, or same-bytes
  new-inode markers fail closed.
- The repository-external runner validates the live freeze marker before
  candidate execution, rebuilds an equivalent marker with the staging inode in
  each isolated checker/harness tree, and validates both staged and live marker
  identity again after execution. This closes the otherwise hidden gap where a
  copied marker's inode can never equal the live filename binding.
- Root verification passes: governance `4/160`, focused `46/1188`, type coverage
  `304/304`, full verify `303/1` files and `3517/6` tests, Agent `26/26`, Memory
  `2/2`, production Electron `42.3.3` / ABI `146` / SQLite `3.53.2`, program,
  syntax, bridge equality, whitespace, and blind-path scan. Pre-freeze harness
  rejects only the expected stale Round20 checker hash until canonical freeze.
- The canonical Round21 freeze contains `101` immutable files at
  `sha256:6a0e89b10433dd3cd7d287859e9557d6eafe29b3852ec227a5426e5ff84f2252`.
  All `101/101` hashes, embedded equality, the exact ordered `108`-file Feature
  digest, the one private transaction-marker identity, program, and harness
  pass. An idempotent rerun preserves snapshot/artifact bytes and the marker
  inode. Official closure mode rejects only the intentionally absent pending
  manifest; no review receipt or downstream closure output exists yet.
- Round20 is rejected with `0 Critical / 2 Major`; the other two review lanes
  were interrupted and no closure artifacts were generated.

## P107 Round 19 rejection and Round 20 atomic-path root contract

- A deterministic temp filename is useful for recovery only if partial bytes are
  an explicit recoverable state. Treating any unexpected temp bytes as permanent
  conflict converts an ordinary write crash into a round-ending manual repair.
- Parent pre/post checks do not protect the commit itself when `rename` or
  `unlink` re-resolves a pathname. The operation must be relative to an already
  opened directory identity, or an equivalent primitive that cannot follow a
  replacement parent between validation and commit.
- Round20 now opens the final parent with `O_DIRECTORY | O_NOFOLLOW`, validates
  its device/inode, and passes that descriptor to a fixed root-owned system
  Python bridge. The bridge performs descriptor-relative `replace`/`unlink`,
  fsyncs the held directory, and verifies its identity before returning. Darwin
  lacks a usable `/dev/fd/<dirfd>/child` pathname for Node, so direct Python
  `dir_fd` operations are the portable fail-closed bridge used here.
- A stale deterministic temp is recoverable only when it is a regular,
  single-link, effective-user-owned mode-0600 file whose nonempty bytes are a
  strict prefix of the exact replacement. Random same-name bytes and outside
  hardlink aliases remain preserved and rejected.
- Round19 is rejected on these two Majors; the other review lanes were
  interrupted and produced no acceptance evidence.

## P107 Round 18 rejection and Round 19 closure root contract

- Immutable bytes and canonical JSON do not prove an external event occurred.
  Because all completed artifacts were locally constructible, the checker could
  validate consistency while still accepting a locally synthesized history.
  Round19 must add an actually external anchor input or explicitly signed
  closure fact; mutable in-repository digests alone cannot establish provenance.
- Multi-file publication is a protocol, not two writes. Both freeze and final
  attestation need atomic per-file replacement plus an idempotent recovery state
  for crashes between publications; truncation in place is not acceptable.
- A regular file may still be a hardlink to an outside inode, and preflight
  parent checks can become stale. Closure writes must reject link-count aliases,
  revalidate parent identity around operations, and avoid mutating existing
  inodes when atomic replacement can publish a new one.
- Temporal binding belongs before publication. An attestation earlier than a
  bound receipt must fail without creating either output, rather than being
  discovered later by the completed checker.
- Round19 resolves these as one protocol: an outside-repository anchor plus a
  caller-pinned digest binds the unsigned consistency evidence; canonical
  journals make freeze and attestation/manifest/anchor publication restartable;
  atomic rename avoids mutating aliases; link-count and parent/inode checks
  constrain path identity; exact time validation precedes candidate execution.
- The resulting Round19 review subject is `101` immutable files at
  `sha256:010a29abb57c37f9aae44ca80bc3575f4ec2995053e7bd83032fdd659b2639d5`,
  with no residual freeze transaction and an exact ordered 108-file Feature
  boundary digest.
- Since governance returned four Majors, the valid Round18 snapshot is rejected
  and no other lane or receipt can close it.

## P107 Round 17 invalid freeze and Round 18 root correction

- A self-consistent snapshot is not necessarily a contract-valid snapshot.
  Round17 matched its own digest and all 99 immutable file hashes, yet its
  `featureFileSetDigest` covered the wrong collection. The closure checker
  correctly rejected it against the exact ordered 106-file Feature boundary.
- The root cause is process architecture: snapshot creation was an ad hoc manual
  command while validation lived in the official checker. Round18 makes freeze
  construction a tested repository tool that shares the canonical contract,
  so immutable byte selection and complete Feature-boundary identity cannot be
  silently conflated again.
- The new freezer refuses overwrite by default, binds the requested round/path
  to the active pending artifact, rejects symlinked inputs, and permits explicit
  replacement only before any receipt/manifest/attestation exists and when the
  standalone and embedded pending snapshots are already exact and valid.
- Round18's canonical subject contains `101` immutable files at
  `sha256:0e5f714c1e6755741bc24813b8e21cd1eb3cb26e029fa92d068ec5691ab28869`.
  The Feature-set digest now independently matches the exact ordered `108`-file
  P107 list; closure mode has no snapshot defect and stops only because review
  receipts and their pending manifest do not yet exist.
- Because the first independent reviewer returned one Major, Round17 is
  rejected; the other lanes were interrupted and no review receipts exist.

## P107 Round 17 remediation result before freeze

- Revision reconciliation now requires exact owner/admission continuity; a
  missing, skipped, higher, or same-revision-divergent fact stops startup before
  later recovery. Ordinary shadow I/O remains failure-visible at explicit drain
  without masquerading as a version conflict.
- Successful terminal settlement is a three-step protocol: causal prepare
  freezes exact Chat and Workspace identities, Workspace commits idempotently
  with readback, then causal authority atomically commits acceptance plus refs.
  An uncertain final commit pauses for reconciliation and never reruns work.
- Credential safety is attempt-scoped and structure-aware across recursive
  encoding, multiline assignment, tool/status boundaries, guided input, model
  notices, AgentRun records, legacy recovery, and memory projections.
- Closure governance no longer executes candidate programs in one shared stage.
  Checker and harness receive independent byte-verified control trees, and a
  locally passed review can only become complete after a repository-external
  runner publishes the exact digest-bound attestation.
- All pre-freeze gates pass. The exact Round17 review subject is `99` immutable
  files at `sha256:538682d1014da5aed3ac03a99fbcb2516f15603c0f50af864a84c320cfae02b9`;
  the remaining uncertainty is independent behavior review of that frozen
  subject followed by external attestation. Local green tests are candidacy
  evidence, not closure.

## P107 Round 16 rejection and Round 17 root contract

- Round16 passed every local gate and froze `97` files, but all three independent
  lanes still returned FAIL: `0 Critical`, `10 Major`. Green tests again proved
  candidacy, not behaviorally complete closure.
- Revision continuity is part of AgentRun authority. Startup may reconcile only
  a provable next revision; a latest-owner snapshot cannot authorize skipped
  causal admissions, and a higher shadow conflict must stop later recovery.
- Cross-domain success needs a failure-atomic protocol. Irreversibly committing
  Workspace before assistant acceptance, or accepting the assistant before a
  fallible Workspace commit, merely chooses which domain will lie after failure.
- Public stream redaction must be attempt-scoped across tool/status boundaries;
  per-batch sanitization is insufficient when the renderer concatenates deltas.
- Credential grammar must be recursively normalized and multiline-aware, and
  every public/durable structure—including guided inputs, model notices, and
  memory identity—must use a safe projection distinct from internal authority.
- Captured bytes are not frozen if one candidate executable can mutate the tree
  used by the next. Each executable needs an isolated fresh tree plus staged
  pre/post verification.
- `review_passed_pending_external_anchor` is not a completion state. A final
  exact attestation artifact, bound to the runner/snapshot/receipts/results, must
  be consumed by the completed-state checker.

## P107 Round 14 systemic findings

- Terminal UI truth is a commit projection, not a best-effort event: Chat,
  Workspace, and causal receipts must settle before a decisive terminal becomes
  publishable.
- Recovery order is part of the persistence protocol. Required settlements and
  AgentRun ownership must converge before approvals and active attempts can be
  interrupted safely, and all of them must precede IPC admission.
- Attempt identity and AgentRun execution revision solve different races. The
  former fences accepted assistant content; the latter fences owner lifecycle
  writes across pause/resume, backends, migration, and exports.
- Approval safety requires atomic intent/ref creation and inclusion of
  `approvalId` in every normalized persistent identity, not merely a durable
  approval row.
- Local hashes prove internal consistency only. Independent closure needs
  unique external challenges, immutable receipt files, and a runner whose own
  identity is anchored outside the candidate repository; even then reviewer
  subject identity remains unsigned and must be disclosed honestly.

## P107 Round 13 frozen review — rejected

- All three lanes independently reproduced the exact `67`-file digest
  `sha256:1605f85450d925ab12ad3fd92882f306a9783c1a53684e1eb85aa187bb3fe8ce`
  with no drift, then returned `FAIL / FAIL / FAIL` (`0 Critical`). The green
  local gates therefore did not prove the causal lifecycle contract.
- The findings merge into one architectural defect: creation, durability,
  recovery, publication, and acceptance of a cross-domain fact are still
  controlled by different owners. The system can publish a terminal before
  its receipts commit, restart with a `preparing` settlement or `started`
  AgentRun that nobody reconciles, resume a paused owner without updating its
  causal admission, and create an approval intent before its causal ref.
- Attempt truth is not monotonic. An older interrupted assistant attempt can be
  accepted after a newer attempt exists or after a failed/canceled settlement
  commits. Required settlement recovery also repairs only selected sinks,
  leaving Chat, Workspace, and causal state permanently split.
- Failure projection is not a shared boundary. Raw model, Workspace, AgentRun,
  and memory exceptions can enter durable/public summaries; legacy observer
  exceptions can prevent owner persistence. Every public/durable failure needs
  the same secret-safe classifier, while observers must be non-authoritative.
- Exact identity is incomplete: `approvalId` is semantically persisted by the
  Chat event contract but omitted from normalization and fingerprinting, so a
  changed approval owner can replay as the same required fact. Failed causal
  settlements also need a mandatory typed `failureCode` at the store boundary.
- Local review closure is self-asserted. Mutable artifact reviewer objects can
  be fabricated, and replacing both local checker and harness defeats their
  circular integrity check. Round 14 must record digest-bound review receipts
  and use a repository-external trusted entrypoint/attestation; the artifact
  must not claim that purely local code can prove its own identity.
- Round 14 is therefore a transaction-and-recovery redesign, not another set of
  renderer flags: one settlement owner, startup reconciliation for every
  unresolved owner/ref pair, monotonic attempt CAS, secret-safe projection, and
  externally anchored closure evidence.

## P107 Round 13 — systemic remediation result

- Root self-audit revoked the first Round 13 digest before any reviewer verdict:
  prepare had frozen only a partial event identity, and AgentRun lease settlement
  still sat behind fallible task/learning projections. The corrected boundary
  fingerprints the complete normalized persisted Chat event after attaching its
  deterministic settlement id, and one shared AgentRun commit helper enforces
  owner persistence before lease settlement and best-effort projections.
- A second root audit revoked replacement digest `8cf09a...f105` before any
  reviewer verdict. ProductionKernelDriver caught a causal lease rejection
  raised after AgentRun owner persistence and re-entered `settleFailed`, which
  could append a second conflicting terminal record. Post-commit settlement
  rejection is now a typed secret-safe error; Kernel records one sanitized
  failed terminal and skips failure settlement re-entry.

- The eight Round 12 families reduced to one missing abstraction: no single
  protocol owned admission, exact attempt identity, cross-domain receipt
  settlement, and publication proof from request entry through terminal state.
  Round 13 introduces that protocol instead of adding renderer flags or local
  catches.
- Request classification now precedes Kernel construction. Legacy session-only
  rows cannot be upgraded, and concurrent duplicates/conflicts create no
  status, Workspace, AgentRun, or Kernel owner lifecycle.
- Assistant records now persist `turnId`, `causalAttempt`, and
  `causalAttemptId`. Replay consults those witnesses before mutation and can
  reconcile only the original active/interrupted attempt. Missing-witness
  legacy messages require an already receipt-owned attempt or remain read-only.
- AgentRun admission is an owning lease: stable run id, admission fact, and
  causal ref are atomic and precede every run event or execution dependency.
  The lease settles once with the real succeeded/paused/failed/canceled status,
  which Chat result, status, assistant, and causal state preserve unchanged.
- Required states now use one coordinator with frozen required domains,
  settlement ids, idempotent Chat/Workspace sinks, mandatory receipts, and
  committed/failed journals. Kernel fallback failures use the same path before
  claiming `requiredStatePersisted`.
- Guided-input recovery accepts only exact committed waiting ownership.
  Chat-first/Workspace-failed writes receive a failed tombstone; a cold-start
  `preparing` row becomes `RECOVERY_INCOMPLETE` plus a route-only recovery
  tombstone; a `processing` lease never replays. The adversarial tests assert
  zero model/Workspace execution after restart.
- Configured Workspace initialization is fail-closed and secret-safe. Missing
  optional adapters remain partial. Raw failure canaries are absent from Chat,
  Workspace, stream, result, Kernel, and causal persistence.
- Durable publication now requires explicit `domainStateAvailable:true` on
  status, stream, and successful result. False/absent provenance remains
  non-adoptable in renderer result and stream consumers.
- Closure governance now freezes the complete executable chain and exact
  schemas, including undeclared safety aliases. The old Round 12 artifact is
  intentionally rejected until Round 13 gates finish and a new digest is
  generated.

## P107 twelfth frozen review — boundary synthesis

- The twelfth snapshot is rejected: three independent lanes returned
  `FAIL / FAIL / FAIL`, with `0 Critical`, eleven reviewer Major findings
  merged into eight root families, and one governance Minor. All 64 frozen
  files and digest `sha256:947f798e00355561fdd475b2f56b46684915b26ab36e3146131afaa5822085d9`
  matched, so these are behavioral/governance defects rather than review drift.
- Request admission is path-specific instead of request-scoped. Guided input
  creates a separate emitter and can upgrade a current-v2 session-only claim,
  publish adoptable pending state without exact binding, and recover a partial
  continuation after Workspace failure. Concurrent duplicates act as failed
  owners instead of non-mutating observers.
- Assistant acceptance is not attempt-provable. A durable assistant lacks an
  attempt identity, so after cold-start interruption message-first repair can
  attach attempt-1 output to newly allocated attempt 2.
- Domain terminal truth is inferred from adapter return success. A Scheduled
  runner may return an owning record whose status is failed, paused, or
  canceled, while Chat receipt, Workspace, and Kernel are all settled as
  succeeded.
- Required settlement is not one saga. Workspace initialization can degrade to
  null while required pauses remain recoverable; guided-input Chat writes can
  survive a failed Workspace settlement; Kernel fallback can copy a raw
  storage exception into stream, Chat, Kernel, and rejection surfaces.
- AgentRun admission split “ref before work” from “ref points to an owning
  fact.” The ref may be committed before any AgentRunRecord, while container
  publishes active-execution state before the inner gate. The next protocol
  must reserve one owning record first, durably link the same stable run id,
  then publish/start execution; admission failure must settle or remove the
  reservation without claiming work began.
- Legacy/session-only handling occurs after some Kernel/ref/coverage writes.
  Route-only compatibility must be classified before any domain admission, not
  repaired after an owning run already exists.
- Completion governance is self-referential. Replacing only the disclosure
  checker or only package aliases with no-op code can make both declared npm
  gates green. A closure runner must invoke candidate entrypoints directly and
  cross-check single-file executable drift; a repository cannot defend against
  simultaneous replacement of every local verifier without an external
  digest/signature/CI trust anchor.
- Snapshot file entries should also use an exact `{path, sha256}` schema. The
  current artifact has no extra entry keys, so this is hardening rather than a
  demonstrated integrity drift.
- The thirteenth design must therefore unify five boundaries before code:
  request/attempt admission, owning-fact/ref creation, cross-domain settlement
  saga, owning-status projection, and review trust anchoring. Fixing individual
  event flags or catches would repeat the same defect class.

## P107 sixth frozen review — root-cause consolidation

- The sixth candidate is not accepted: independent reviewers confirmed `0 Critical / 3 Major` even though focused, type, program, harness, and whitespace gates passed.
- All three findings share one ordering defect: an owning runtime fact may exist before its causal ref or terminal settlement is persisted.
- A request-fingerprint conflict returns before the real Kernel invocation ref is attached, so the Kernel event bus can contain a `run_end` with no matching `kernel_run` causal ref.
- An accepted-assistant/receipt conflict returns without status or terminal output. The Kernel wrapper then fabricates an `unpersisted` fallback even though the request claim already adopted the durable session.
- A Scheduled AgentRun exists before assistant persistence, but its `agent_run` ref is currently written only after assistant append and acceptance. An assistant-persistence crash therefore leaves a durable AgentRun permanently orphaned from the causal record.
- The systemic correction is: record each owning fact/ref immediately when it becomes authoritative; route every claim-owned early return through one durable terminal-settlement boundary; prove both with crash/early-return mutation tests.
- Current code confirms the ordering mechanically: request conflict emits a stream terminal at `chatService.ts:822-830`, while `kernel_run` is added only at `832-838`; persisted-assistant acceptance conflict returns at `929-937` without either status or terminal; Scheduled success passes `executedRunId` into `persistAssistantReply`, whose ref write occurs only after assistant append and receipt acceptance.
- The existing stale-session test checks durable failure routing and one final `run_end`, but does not compare the number and ids of Kernel `run_end` events with the record's `kernel_run` refs. The existing Scheduled test proves the final happy-path ref only, not assistant-persistence failure.
- `ConversationCausalStore.acceptAssistant` deterministically returns `conflict` for a previously accepted attempt whose replay receipt fingerprint differs, so a production-level fixture can construct the state through public APIs without weakening the store contract.
- `sendRequired({state:"failed"})` is suitable for the shared early-failure boundary: it drains prior ordinary persistence, awaits required Chat/Workspace persistence, and only then publishes; the terminal helper then drains the same queue before emitting the stream terminal.
- The Scheduled run branch receives `executedRun.id` before calling `persistAssistantReply`; moving `addRefs(agent_run)` to that seam closes the assistant-append crash window while retaining Chat as safe legacy behavior if the optional causal sink itself is unavailable.

## P107 seventh frozen review — wrapper/ownership boundary

- All three reviewers rejected the seventh candidate. The sixth-round fixes themselves passed: receipt conflict settles the actual session, existing-claim Kernel refs match `run_end`, and Scheduled AgentRun refs survive assistant persistence failure.
- New root 1: input validation still runs inside the Production Kernel wrapper. Empty message, invalid attachment, and Plan-image rejection can therefore produce a real failed `run_end` before any causal claim exists, making a one-to-one `kernel_run` ref impossible.
- New root 2: an existing claim may be durable but not yet bound to a session after a user-message crash. Its duplicate failure terminal still inherits the caller routing session; Kernel then tries to persist failure there. A missing caller session rejects without `run_end`, while an unrelated existing caller session is polluted.
- Correct boundary: validate and prepare execution input before constructing a Kernel run; only validated work enters the wrapper. Within the wrapper, a session is durable only when the claim owns it and required persistence succeeds. Otherwise terminal identity must be explicitly unpersisted and Kernel must not write activity to it.
- Required regressions: invalid input produces neither Kernel run nor causal record; unbound duplicate with caller absent/present, missing Chat store, and failed activity persistence produces one unpersisted terminal plus one `run_end`, no caller activity, no model rerun, and a matching causal Kernel ref.
- `ProcessedChatAttachments` is already a typed boundary, so preflight can return the validated attachment bundle, normalized user/model messages, attachment flag, and preexisting Plan routing record once; `executeMessageInternal` need not reparse or re-read Plan state.
- Kernel settlement validation already accepts `noDomainStateCreated` for failed/canceled outcomes. The missing piece is to normalize the reserved unpersisted terminal identity back to `undefined` before `persistTerminalActivity`, including the `settleFailed` recovery path.
- The implementation now prepares the normalized request once before checking `productionKernelDriver`; invalid/canceled input returns before `createChatKernelRunId` and `runChatKernelSegment`, while valid non-Kernel execution reuses the same prepared value.
- `settleClaimOwnedFailure` now attempts required persistence only for a claim-owned session plus available Chat activity adapter. Missing/unbound/failed persistence records degraded coverage, switches the stream envelope to the reserved unpersisted identity, and lets Kernel validate `noDomainStateCreated` without touching caller routing state.
- The first preflight refactor exposed a compatibility detail: normal non-Kernel calls historically keep an omitted `input.requestId` omitted even though the internal turn has a generated id. Normalizing it before the no-Kernel branch caused fixed-clock follow-up tests to enter durable replay. Request-id injection must therefore remain a Kernel-only wrapper concern after preflight.

## P107 eighth frozen review — explicit durability proof

- All three reviewers rejected the eighth candidate. Preflight rejection before Kernel and the original unbound-duplicate caller pollution were fixed, but four deeper proof failures remain.
- Async preflight cancellation is edge-triggered only at entry. Aborting while `getInputRoutingPlan` is awaited still permits claim, model, assistant, and succeeded Kernel completion. Cancellation must be checked again after every async preflight boundary and immediately before Kernel construction.
- The string `"unpersisted"` cannot prove absence of domain state because Chat session ids are unrestricted strings. A real durable session with that id is misclassified as `noDomainStateCreated`. The settlement wrapper needs explicit domain-state availability separate from the event's routing/session string.
- Chat store absence can still return no user message while `bindRequest` accepts the caller session id. That turns routing into false durable ownership, then assistant/activity failure can leave a `kernel_run` ref without `run_end`.
- An unbound claim still looks up a persisted turn in the caller session. A foreign session can plant the same request id and assistant, which the claim accepts as its receipt. Reconciliation must require the claim-owned session; an unbound claim has no authorized Chat turn source.
- Kernel ref persistence currently occurs inside execution after `run_start` and swallows `addRefs` failure. This makes one-to-one parity unprovable and may leave coverage falsely complete. The wrapper must pre-register its actual run id successfully before entering `runChatKernelSegment`; configured causal failure blocks Kernel admission.
- The remediation separates three previously conflated facts: a transport routing id, a claim-owned durable Chat session, and permission to enter Kernel. Durable-session identity now arrives through an internal proof callback after an existing claim adoption or successful user-message persistence/binding; the stream marks route-only terminals with `domainStateAvailable: false`, and Kernel never infers durability from a magic string.
- Kernel admission now performs preflight, rechecks asynchronous cancellation, claims the request, and commits the exact `kernel_run` ref before invoking the Production Kernel driver. A ref write error starts no Kernel event. Once admitted, the internal executor receives the same prepared input and preclaimed record rather than racing a second claim.
- Causal binding now requires a real persisted user-message id. Missing Chat persistence with a configured causal store fails before model/tool execution. Replay lookup uses only `requestClaim.value.sessionId`; an unbound claim cannot inspect the caller session, and a bound claim with a user-message-id mismatch fails closed.
- The new regression set proves async Plan-preflight abort, configured ref-write rejection, caller-planted assistant rejection, first-and-duplicate no-Chat-store failure without model execution, route-only terminal metadata, and a real durable session literally named `unpersisted`.

## P107 ninth frozen review — transport metadata consumer boundary

- Two independent reviewers accepted the ninth candidate, but the renderer/governance reviewer found one cross-layer Major, so P107 remains open.
- Main and shared contracts correctly mark an unpersistable terminal with `domainStateAvailable: false`, yet `AgentChatPanel` previously assigned every matching stream event's `sessionId` to both `activeStatusSessionIdRef` and React `sessionId`.
- A new-session user-message persistence failure therefore could not execute the model and retained Kernel run/ref parity, but its provisional runtime routing id still became the renderer's active session. Later requests or refresh logic could route through an id absent from `ChatSessionStore`.
- The systemic rule is now enforced at the consumer boundary: `getDurableChatStreamSessionId` returns null for route-only terminals and the panel updates durable session state only for non-null results. The terminal still reaches the stream reducer to finalize transient UI.
- A pure reducer test distinguishes a route-only runtime id from a real durable session literally named `unpersisted`; a component wiring assertion prevents the panel from bypassing the helper.

## Current Requirements

- Research first; development planning and implementation begin only after external, DeepSeek Harness, and Zerox baselines are deep enough to support architecture decisions.
- Use phased execution with explicit definition of done and acceptance evidence for every phase.
- Study leading Agent products' dynamic conversation disclosure mechanisms using current primary sources where possible.
- Study `/Users/zeorx/Documents/trae_projects/deepseek_harness` at architecture and code depth, not only UI screenshots.
- Use subagents for bounded parallel research and later use independent subagents for adversarial review and acceptance.
- Prefer a real running application/browser acceptance pass after development.
- Treat the provided model endpoint credential as a secret: ephemeral use only, no repository persistence or disclosure.

## Initial Research Findings

- Live baseline is branch `codex/3.9.2` at `9427122`, identical to `main` and `origin/main`; package version and completed release program are v3.9.1.
- `./init.sh` passed the harness and package-script checks: all existing runtime/kernel/storage/release programs are closed with zero active workstreams.
- The workspace already has unrelated untracked P70/P71 planning and packaged acceptance directories. They are preserved and excluded from this feature's product changes.
- The live DeepSeek Harness reference checkout is `/Users/zeorx/Documents/trae_projects/deepseek_harness` on `master` at `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`, with a pre-existing modified `.gitignore` and untracked `scripts/macos-app/`; the study is read-only and must not disturb them.
- The attachment cites a different `/Volumes/Out/.../deepseek-harness` checkout. Its paths and line numbers are therefore leads that must be remapped to the live monorepo.
- The live reference is a broad pnpm monorepo with separate session persistence/projection/stats, transport/client/runtime, UI conversation/tool/trajectory, plugin, CLI, Web, and SDK packages. This supports architectural tracing but also means selective copying of React components would miss their upstream contracts.
- DeepSeek Harness's own operating guide defines “everything is a plugin”; new behavior belongs on extension points, and a capability spans Definition, Provider, and Consumer roles. Conversation definitions, views, tool presentation, and projections must be evaluated as plugins over the product spine.
- Its durability invariant is `model-visible iff logged`: any input that reaches a model must be reconstructable from the session log. Unknown required-on-read event types cause older builds to refuse the log unless the event is explicitly `ignorable`, which is a stronger compatibility stance than a generic unknown-UI fallback.
- Tool UI render intent (`generic`, `terminal`, `diff`, locations) is part of tool design and presentation methods are pure functions of arguments. This explains why its Host can recompute view models without changing logged tool facts.
- DeepSeek Harness is explicitly pre-release and rejects old on-disk formats rather than promising compatibility. Zerox v3.9.2 cannot inherit this stance because it already has persisted user sessions, Goals, Plans, checkpoints, and release compatibility obligations.
- User-visible behavior in the reference requires a keyless snapshot through a real assembled runnable example in addition to unit tests. This is a transferable acceptance pattern for Zerox's real application transcript and browser checks.
- The live architecture document defines one turn as zero or more steps and one step as one model request plus its tool executions. Durable turn/step/user/assistant/tool events are distinct from live agent/capability extension events, making lifecycle grouping a domain fact rather than a renderer guess.
- `SessionEventMap` is merge-extensible and lossless JSON with contiguous seq values. It stores both raw assistant chunks for replay/UI fidelity and final assembled assistant messages for model history; request headers/context, todo snapshots, tool calls/results, and lifecycle brackets remain typed events.
- `tool/result.meta` is durable, JSON-validated, tool-owned presentation context intended to reproduce result-time cards such as diffs on replay. Although the Host may recompute `ToolEventView`, not all presentation evidence is intentionally ephemeral; the attachment's drift warning requires this qualification.
- The client Session buffers live events during history load, installs one history window, seeds Host projections, drops seq overlap, repairs seq gaps by refetching the tail without a loading flash, then routes semantic publication as `none`, `animation-frame`, or `immediate`.
- `ProjectionValueStore` documents Host-only computation. It stores complete per-key values under higher-seq-wins, lets a tail baseline clear older absent keys, and truncates projection rows beyond a durable reconnect baseline after Host restart. Clients do not independently fold domain projections.
- Deep code review qualifies the durability wording: `SessionEvent` is the normative logical log, but append commits to the in-memory log and disk persistence is write-behind. Model dispatch, top-level tool side effects, and other semantic checkpoints force a fail-closed flush; a hard crash can still lose the uncheckpointed tail.
- Host projections remain non-authoritative and rebuildable, yet may have a durable cache. The cache is valid only when its event cut cannot lead the flushed fact log. “Projection is not a fact” must not be simplified to “projection is never persisted.”
- This provides a precise transfer target: replay/reconnect correctness depends on causal sequence and authoritative baselines before any Chat/Trajectory UI hierarchy. Zerox cannot solve stale or contradictory disclosure only with React state.
- The reference's current history install has an uncovered internal-gap risk: draining the live buffer removes overlap but neither sorts nor accepts only an adjacent prefix. A buffered `N+1, N+3` sequence can advance past missing `N+2`. Zerox must test overlap, duplicate, out-of-order, malformed-drop, and internal-gap repair rather than copying the algorithm verbatim.
- The reference connection degrades after a three-second race timeout instead of strictly waiting for both streams; disclosure of connection/replay health is therefore part of correctness, not merely transport plumbing.
- `ConversationNodeAssembler` incrementally maps a contiguous event window into stable business Contexts and separately registered view snapshots. It tracks dirty/revised/dependent Contexts, rebuilds on rare registry changes, and applies target-specific upserts without rescanning every sibling.
- Publication labels require precise translation: `animation` batches to the next frame, `immediate` batches in a microtask, and only `notifyNow` is synchronous. Zerox should define observable scheduling semantics instead of reusing labels with different guarantees.
- Once a view node has materialized, a definition may not silently withdraw it; it must retain the same key and change visibility to hidden. Unknown/unmatched content has a generic JSON fallback. These rules prevent streaming layout identity loss while preserving evidence.
- `ChatNodeSeat` subscribes by stable node key and routes one discriminated node through a keyed renderer slot, so a streaming row does not force sibling rows to re-render.
- DeepSeek's Chat optimizes target-row updates and reparses only trailing Markdown blocks, but maps the entire loaded window and has no list virtualization. Its Trajectory virtualizes DOM beyond a threshold while snapshot, layout, and search still scan all loaded records. Neither is proof of arbitrary long-session performance.
- Actual `ReasoningRow` behavior contradicts the HTML report's generic “running auto-expanded” prescription: it starts collapsed in both states, shows the latest line while running and the first line after settlement, and exposes full reasoning only on user expansion.
- `StatsLine` assigns each fact one UI home, prefers durable Host projections so history paging/compaction do not change totals, and uses a window-derived fallback only when the projection capability is absent. The Context meter separately labels occupancy as approximate and distinguishes provider capacity from heuristic composition.
- The transferable principle is semantic publication and stable identity, not DeepSeek's exact visual defaults. Zerox should freeze its own default-open policy from observed user tasks and actionable states.
- The reference transport makes answerable approvals/questions explicit transient requests with reusable RPC identity, while resolution frames settle the same pending object across refresh/reconnect.
- The queue uses authoritative complete snapshots because an unclaimed item is not yet model-visible/durable. Placement separates user-visible queued and steering items from pending context that remains invisible until claimed. Background jobs likewise use complete process-local snapshots and emit an explicit empty list on the transition to none.
- DeepSeek Todo is only a standing list for the current turn and clears at the next turn. It cannot be mapped onto Zerox Goal, Plan, and acceptance semantics, which are durable cross-turn contracts.
- `ToolEventView` is computed through the currently scoped presenter for both live events and history pages. Missing cross-page call pairing, malformed arguments, missing presenter, or presenter exceptions fail soft to a generic card without dropping the underlying event.
- Tool summary selection is domain-aware but deterministic (for example Bash description/command, file path, search query), and workspace-rooted paths are shortened only for display. Presentation must not mutate authorization or fact identity.
- History tool presentation has a verified cross-page weakness: the Host re-derives a result view using only the current history page when looking back for its call, so a call/result page split falls back to generic. Zerox needs a session-level correlation index, widened association read, or versioned durable presentation summary before promising live/replay parity.
- Trajectory is a separately registered conversation view with its own timeline, ledger, search/fold projection, history paging, scroll anchoring, virtualization, selected request/record, resizable inspector, and per-record tab set.
- Cross-view inspection is causal rather than textual: a Chat callId locates the Trajectory record, opens collapsed ancestors, selects Summary, scrolls after render, and remains pending until older history loads if the record is not yet present.
- The inspector's raw/options/usage/timing/schema/input/output/diff tabs are technical/audit surfaces. They should not replace concise user-facing failure, approval, recovery, or completion disclosure.
- The Markdown attachment's central model is a shared fact stream projected into four disclosure layers: default Chat narrative, inline disclosure, Trajectory/process audit, and raw Inspector evidence.
- The attachment distinguishes four authority/lifecycle classes: persisted `SessionEvent`, transient control frames, Host-derived projections, and renderer-only view state. This is an architectural claim to verify against the live DeepSeek Harness checkout.
- The attachment reports two independent views over the same continuous event window: Chat answers “what the user and agent are doing,” while Trajectory answers “what the system actually executed.” Trajectory must not parse Chat DOM.
- It also reports `none` / `animation-frame` / `immediate` publication classes, stable keyed nodes, sequence-based deduplication/gap repair, projection higher-sequence-wins semantics, and fail-soft tool presenters. These are candidate transferable invariants, not yet accepted Zerox design decisions.
- The HTML attachment is 337 KB but `textutil` returned an empty body, suggesting script-rendered or nonstandard embedded content; it requires raw-resource or browser inspection before conclusions.
- The Markdown attachment defines six disclosure levels: persistent environment/run status; primary conversation narrative; one-line collapsed reasoning/context/tool summaries; inline expansion; a separate Trajectory ledger; and a record-specific Inspector.
- Its default-surface criterion is task-oriented rather than protocol-oriented: show current state, interruption/completion, participating tools, and actionable blockers without mixing tool protocol into assistant Markdown.
- A collapsed summary is useful only if it lets the user decide whether to expand: state, meaningful argument/path/source, latest reasoning position, count, or first error line. A generic “details” affordance is insufficient.
- The reported Chat-to-Trajectory `Inspect` handoff preserves identity by call id, switches view, expands the owning record, and opens the inspector. This direct evidence navigation is more important than merely adding another diagnostics page.
- Reasoning disclosure is a security/product policy boundary, not a CSS choice. Provider generation, Host persistence, Client delivery, summary visibility, and full-detail authorization must remain separable.
- Recomputed tool presentation improves forward evolution and fail-soft behavior but prevents pixel-identical historical replay unless a presentation version or export snapshot is also preserved.
- Renderer-only disclosure/search/selection state is appropriately transient for ordinary reading, but deep links, collaborative diagnosis, or reproducible audits would require selected state to move into URL/session-scoped view state.
- The HTML attachment identifies itself as “AI Agent 流式输出与选择性披露调研” / “桌面端 AI Agent 流式输出与选择性披露调研报告” and visibly includes Codex plus dimensions such as answer/reasoning/tool/file streams, continuous tool execution, pause/resume, steering, and summarized tool status. Its detailed product claims remain unverified pending browser/runtime extraction.
- Raw inspection recovered the HTML report's core abstraction: `raw runtime events -> user-visible progress semantics -> final answer`. It argues that a normalization/merge boundary between raw and semantic events matters more than the folding widget itself.
- The HTML report proposes protocol-first disclosure, grouped continuous tool execution, sentence-like tool summaries, automatic folding with summaries after completion, a bulk expand/full-process escape hatch, explicit permission elevation, and observability-driven tuning.
- Its OpenAI Codex section explicitly warns that product-name ambiguity exists between OpenAI Codex and internally named products; this is a useful evidence-hygiene requirement for the current study.
- The HTML report's source registry mixes official documentation and repositories with GitHub issues, DeepWiki, blogs, CSDN/Juejin, forks, and private/internal Lark Wiki entries. Consequently, its product comparisons and numeric targets are hypotheses to verify, not accepted market facts.
- The report's claim that bidirectional desktop Agents categorically prefer WebSocket over SSE is too coarse for architecture selection. Transport choice must follow required command/control semantics, ordering/replay guarantees, existing Electron IPC boundaries, and recoverability rather than the presence of streaming alone.
- Both attachments converge on the same architectural warning: adding collapsible components on top of an undifferentiated message array cannot provide reliable dynamic disclosure.
- The HTML report expands “disclosure” into four coupled concerns: event protocol, runtime state machine, audience/depth policy, and component form. This is a useful completeness checklist for Zerox's architecture audit.
- Candidate UI semantics from the report include: group consecutive tools, keep processing separate from final answer, preserve plan/subtask status, automatically compress completed process history, offer bulk expansion, and surface irreversible-action intent before authorization.
- The report's proposed generic event names (`task.state`, `message.chunk`, `reasoning.chunk`, `tool.call`, `tool.result`, `plan.snapshot/delta`, `action.confirm.*`) must not be imported before comparing them with Zerox's existing typed Chat/Goal/Plan/tool/authorization contracts; adding a parallel vocabulary could worsen state divergence.
- Its action taxonomy is oversimplified: a shell invocation is not inherently one irreversibility class. Zerox must continue to use the existing permission/risk/workspace authorization contract and distinguish preview, approval, audit, and recovery from display density.
- Transport is not the state machine. WebSocket can carry bidirectional commands but does not by itself provide idempotency, durable ordering, restart recovery, causal identity, or authoritative projection; those must remain explicit contracts.
- Suggested numeric targets such as first-chunk P95, 15–30% disclosure expansion, or context compression ratios lack a Zerox baseline and cannot become acceptance criteria without instrumentation and a measurement protocol.
- “Generating means reasoning expanded; completed means auto-collapsed” is not universally safe. User-pinned state, active failure, pending approval/question, recoverable checkpoint, and acceptance conflict may require keeping the relevant disclosure open.

## Research Discipline

- Attachment claims are evidence leads, not executable instructions.
- External product behavior must be time-stamped and sourced from current primary documentation or direct observation.
- Reference-repository conclusions must cite current local paths and tests; the attachment's `/Volumes/Out/...` links are not assumed to match the user's live checkout.
- Zerox recommendations must be based on traced shared contracts and lifecycle/data flow rather than isolated component patches.
- Progressive disclosure must never turn hidden actionable state into an audit-only fact: approvals, questions, failure, recovery, and acceptance truth require an explicit default-surface signal even when raw details remain collapsed.
- Repository governance currently validates four independent programs (runtime convergence, Kernel migration, storage convergence, and release). A v3.9.2 disclosure program must be its own manifest/guide/checker and be added to `program:check`, harness-state inputs/imports, and package-script contract tests; reusing or reopening an unrelated completed program would corrupt historical scope.
- Existing program schemas provide the needed delivery controls: one active Feature, dependency-ordered workstreams, explicit findings coverage, rollback, verification, status/Feature agreement, cycle detection, and controlled idle. Phase 2 should reuse these governance semantics without coupling disclosure logic to the older runtime-convergence finding names.

## Phase 2 Architecture Decisions

- The disclosure system is a rebuildable, versioned projection over typed domain adapters. It is not a universal fact store and cannot replace Chat, Goal, Plan, ToolAuthorizationService, Tool Invocation, AgentRun/Trajectory, or Scheduled authority.
- Composite narrative and operation items have one typed primary source plus bounded typed contributors. The adapter vocabulary includes Chat, Goal, Plan, Scheduled, AgentRun, Trajectory, Workspace Run, Tool Invocation, approval, guided input, context, usage, and ephemeral Kernel health.
- Exact source-domain status is retained. Goal `completed_unverified`, stopped/blocked states, Plan `steps_completed` and action gates, and Tool recovered/aborted states cannot be flattened into generic success/failure.
- Snapshot and delta cursors are scoped by surface/session/query/version. Coverage and source-cut changes are typed; gap, generation mismatch, incompatible required facts, or unrepresentable coverage changes force an atomic snapshot reset.
- Live answer assembly uses typed `(requestId, turnId, attempt)` begin/reset/supersede/accept controls. Only the canonical answer-delta channel renders live text; accepted final persistence is the reload authority.
- Approval durability separates window reload from main-process restart/cold start. Pending intent persists before publication and is idempotently queryable while the process survives; after process loss it is interrupted/aborted and requires a new explicit attempt, never privileged replay.
- Delivery is now ordered as fixture-driven pure projector, causal pause/retry/approval spine, bounded full-domain adapters plus accepted shadow parity/performance baseline, then default-off renderer surfaces. Projected mode cannot become the release default before hardening and independent real-app acceptance.
- The frozen matrix now contains 19 browser/hybrid scenarios, adding guided input, Goal review/acceptance, Plan confirmation/blocked gate, cancel/interruption/cold start, context/usage accuracy, and unknown requiredness to the original 13.
- The program checker must reject completed-before-dependency history, skipped stages, invalid implementation/post-gate boundaries, planned Feature registration, duplicate Feature ids, non-file/out-of-repository artifacts, missing required ADR/completion artifacts, missing implementation owners, and final acceptance without per-scenario evidence files.

## Current Primary-Source Product Findings

## P113/CD09 Final Review Findings — 2026-08-26

- A scenario receipt is not sufficient when it proves only the presence of a
  generic accessibility mechanism. S10 must observe the declared semantic
  states themselves: expanded controls, selected Run/evidence targets,
  blocking alerts, and computed reduced-motion behavior during a real trusted
  state change.
- Lifecycle files cannot simultaneously be immutable pre-transition inputs
  and transaction-owned completion outputs. Their active shape is checked by
  the runner and Program gates; their completed bytes are bound by the final
  anchor, while the stable source/input digest excludes exactly those two
  files.
- A committed publication journal is a durable success witness, not a reason
  to restart publication. Recovery must validate the caller pins and complete
  output set before deleting the journal and returning the existing anchor.
- A committed guided-input processing settlement is an interruption candidate,
  not proof of interruption. A committed assistant acceptance on its owning
  attempt is the durable success fence and must prevent startup compensation.
- Final identity closure must happen after the last candidate-controlled
  checker/harness process. Repository file checks alone do not cover the
  caller-held runner, Node, npm CLI/tree, headers, or Electron cache.
- A committed processing settlement and a committed assistant acceptance can
  coexist by design. Startup recovery must resolve that apparent ambiguity
  from the owning attempt: accepted is success; only non-accepted processing
  is interrupted.
- The same accepted fence is required on demand, not only during startup.
  A duplicate renderer/preload response can otherwise rediscover persisted
  processing and write contradictory failure facts after accepted success.
- Candidate command isolation must protect host confidentiality and egress,
  not only repository integrity. Default-deny file roots, a private TMPDIR,
  and network denial are required; online audit is a narrow separate lane.
- A final checker running from the canonical repository still consumes
  caller-held inputs. Its read-only Seatbelt profile must include the exact
  external runner, Electron cache, predecessor anchor, current acceptance
  anchor, npm tree, and Node headers; repository-only access makes the
  otherwise valid final check deterministically fail.
- Seatbelt does not isolate environment variables or captured stdio. Final
  checker processes must receive an explicit minimal environment rather than
  `process.env`, and command output must be rejected before forwarding when it
  contains any credential-class value present in that environment.
- macOS rejects nested `sandbox-exec` with `sandbox_apply EPERM`; widening
  filesystem rules does not change that kernel behavior. Authoritative
  verification therefore needs two explicit complementary lanes: candidate
  code remains under the outer default-deny profile with exactly 13 real
  nested-Seatbelt effects skipped, while only the caller-pinned runner's own
  hardcoded, non-candidate probes execute outside that profile. Directly
  running candidate test files outside Seatbelt is still a host-read boundary
  and is not acceptable.
- Exact review text prevents contradictory suffixes, but repository-owned
  `reviewerAgentId` and `challenge` values still self-authorize. Final
  acceptance must receive distinct caller-held code/security reviewer and
  challenge pins and compare the receipts against those values.
- A verified private snapshot is still writable while candidate-controlled
  gates execute. Rehashing only at command boundaries does not prevent a
  replace-run-restore sequence inside one command; execution needs an
  OS-enforced immutable source boundary or equivalent per-command isolated
  materialization.
- Generated evidence publication must survive both ordinary failure and process
  termination. In-memory rollback closes ordinary failures but does not close
  crash recovery; a durable caller-private journal is required.
- Hardlink publication has a distinct durable intermediate state: after
  `link(partial, output)` and before `unlink(partial)`, both names identify one
  inode with `nlink=2`. Prepared recovery may normalize only that exact state;
  any different inode, link count, symlink, or non-file is a fail-closed third
  state.
- The lockfile resolves Electron 42.9.0. The initially pinned 42.3.3 archive
  cannot satisfy offline smoke; the actual 42.9.0 cache archive has digest
  `sha256:d3ea4e248cdc22f5ac84207b01391bdeb3b52f1b41c8da89738c24d14a12c9a0`.
- Current CD05-CD07 captures load production renderer output without production
  preload and can fall back to demo records. A 19-row result assembled from
  aggregate captures and named unit tests is not direct execution of each
  declared fixture/action workflow.
- The first production-main/preload scenario harness generated structurally
  valid receipts but blank screenshots. DOM/API readiness alone is
  insufficient; direct scenario acceptance must wait for a painted visible
  window and reject near-uniform image buffers before receipt publication.

- OpenAI's Codex App positions each agent run as a separate project thread, supports parallel isolated worktrees, lets users review changes/diffs in the thread, and places completed Automations in a review queue. Default sandbox boundaries and explicit elevation requests are part of the supervision model, not merely a tool-card treatment. Source: https://openai.com/index/introducing-the-codex-app/ (accessed 2026-08-18).
- OpenAI's original hosted Codex description explicitly pairs real-time progress with terminal/test evidence citations and post-completion revision/PR/integration actions. Source: https://openai.com/index/introducing-codex/ (accessed 2026-08-18).
- OpenAI's current cross-device Codex description says the client reloads live state for threads, approvals, plugins, and project context while streaming screenshots, terminal output, diffs, test results, and approvals; trusted files/credentials remain on the machine. This is evidence for separating authoritative execution locality from remote projections. Source: https://openai.com/index/work-with-codex-from-anywhere/ (accessed 2026-08-18).
- OpenAI documents progress todos, improved tool/diff formatting, compacted long sessions, and three approval modes; its security write-up treats sandbox, approval policy, managed configuration, and agent-native telemetry/audit trails as one control system. Sources: https://openai.com/index/introducing-upgrades-to-codex/ and https://openai.com/index/running-codex-safely/ (accessed 2026-08-18).
- GitHub's agent session surface exposes real-time progress plus token usage and session length, provides a detailed session log of reasoning/tools/validation, permits mid-run steering, and links agent-authored commits back to session logs for audit. Source: https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents (accessed 2026-08-18).
- Cursor explicitly separates foreground and background control contracts: foreground CLI asks approval before terminal commands and can interrupt a running command, while Background Agents auto-run in remote internet-enabled VMs and document the resulting exfiltration risk. The background surface exposes status, follow-up, takeover, logs/resource usage, and desktop handoff. Sources: https://docs.cursor.com/en/cli/using, https://docs.cursor.com/background-agent, and https://docs.cursor.com/en/account/teams/dashboard (accessed 2026-08-18).
- Cursor's chat history is local SQLite while Background Agent conversations are remote; its review surface separately presents final diffs and selective file/line acceptance. This is direct evidence that execution mode and storage authority can legitimately change the disclosure/review surface. Sources: https://docs.cursor.com/en/agent/chat/history and https://docs.cursor.com/en/agent/review (accessed 2026-08-18).
- Anthropic's public Claude Code CLI contract exposes resumable sessions, plan permission mode, allowed/disallowed tool scopes, explicit unsafe bypass, verbose turn-by-turn output, and `stream-json`. This verifies control/output levels, but does not by itself prove any particular desktop visual disclosure hierarchy. Source: https://docs.anthropic.com/en/docs/claude-code/cli-usage (accessed 2026-08-18).

## Cross-Product Inferences to Test

- Disclosure policy should be keyed by execution mode and authority: local foreground, local autonomous Goal, scheduled/background, and remote/third-party execution do not have the same approval, storage, or audit contract.
- Default narrative, control-required state, reviewable artifacts/diffs, and forensic logs are separate products over one causal run; merging them into one transcript either overloads ordinary use or hides operational truth.
- A “review queue” or resumable session list is a disclosure surface for asynchronous work, not a substitute for in-session process projection.

## Zerox Live Baseline — Initial Map

- Zerox already has substantial disclosure-related contracts: `ChatStreamEvent`/`chatStreamReducer`, persisted Chat events and reconciliation, task activity restoration, Chat/Goal/Plan usage, Goal progress and terminal truth, Plan failure presentation, tool invocation ledger/audit, approval visibility, workspace run ledger, Runs trajectory, context compaction/checkpoints, and raw history search.
- These capabilities are spread across Chat, Goal, Plan/Debate, Runs, Memory, Scheduled Tasks, renderer-local reducers, shared projection helpers, and main-process stores/services. The research question is shared authority and causal identity, not whether another card can be added.
- `AgentChatPanel.tsx` is a large integration surface, while dedicated helpers such as `chatSessionWork.ts`, `chatTaskActivity.ts`, `goalProgressViewModel.ts`, `planFailurePresentation.ts`, `workspaceRunLedger.ts`, and `runRecordViewModel.ts` independently choose user-facing status/detail. This is a candidate convergence boundary to verify in code.
- Existing tests already state useful disclosure intent: raw provider errors stay in opt-in technical detail; Goal progress redacts secret-like detail; Runs summaries avoid raw English by default; material-design tests expect Chat command streams, approval blocks, usage/context, trajectory insight, and raw-history surfaces.
- Zerox has both a Chat-local process model and a Runs/workspace trajectory model. Their event identity, ordering, replay, and direct cross-navigation require specific examination before deciding whether to extend, unify, or retire either projection.
- `ChatStreamEvent` carries `sessionId`, `requestId`, a request-monotonic `sequence`, `turnId`, and optional assistant message identity across answer/thinking/tool preview/output/status/input/terminal events. This is a strong live causal envelope.
- Persisted `chat_session_events` use a separate session-mutation sequence and a coarse event vocabulary (`message_appended`, `activity_appended`, token usage, Goal attachment, archive/rename/delete). Final messages live in `chat_messages`; the repository maintains a session projection watermark and paged message transcript.
- `ChatSessionStore.appendActivityEvent` appends every activity mutation to the SQLite Chat event log, while the materialized session activity projection retains only the latest 80 status events. The facts are not simply deleted at 80, but current transcript/reload APIs expose the bounded projection and do not provide a full process cursor replay.
- `ChatSessionRecord` is message-centric and embeds Goal summaries, an activity snapshot, context, cumulative token usage, and final output parts. `projectChatSessionForTranscript` deliberately removes non-transcript output parts, so transcript replay and technical process disclosure already have different information policies.
- `deriveChatSessionWork` is an explicit shared arbitration rule: live Goal wins; otherwise the newest Chat activity may outrank a recoverable Goal; otherwise recovery Goal, Chat, or idle. This solves top-level status selection but is not a general process/event projection.
- Candidate root gap to verify: live request sequencing, persisted Chat mutation sequencing, Goal/Plan event references, and Runs trajectory identities may be parallel clocks rather than one replayable causal log. If confirmed, renderer consolidation alone cannot guarantee real-time/reload parity.
- A second durable path materially qualifies that candidate: `WorkspaceRunEvent` owns a per-run monotonic `seq` and covers status, message, tool call/invocation/result/denial, skill stage, checkpoint boundary, memory scope, history operation, and summary. It projects losslessly enough into `ChatTrajectoryEvent` with `sourceEventId`, `workspaceRunId`, session/request identity, and payload.
- `ToolInvocationRecord` separately models proposed → visible → waiting approval/authorized → running → terminal transitions with immutable history, arguments, result refs, and errors; it can emit a workspace-run invocation event.
- `ToolAuditLog` is a security audit surface, not a complete trajectory: it records sanitized/truncated request arguments and authorization decisions under its own storage backend. Disclosure must not accidentally use this redacted audit as execution truth or expose its technical payload by default.
- Refined root question: how Chat, Goal, Plan, Scheduled, Run/Trajectory, Workspace Run, and Tool Invocation facts can be causally referenced without promoting any one incomplete domain into a universal authority. Workspace Run is a useful evidence adapter, not the pre-existing global fact source.
- `chatService` does create a `ChatWorkspaceRunRecorder` for the normal Agent path and forwards task status into its ledger, while a distinct chat-agent evidence/trajectory recorder retains deeper model/tool evidence. Multiple run identities therefore exist by design and need explicit lineage.
- Workspace-run status writes are currently launched as a side effect and failures are swallowed (`void ...catch(() => undefined)`), whereas selected “required” Chat activity events are awaited. This is a candidate observability/recovery defect: the deeper process ledger may silently become incomplete while the concise activity surface appears valid.
- Production Chat normally resolves or creates a default workspace because the container always injects `AgentWorkspaceService` and `WorkspaceRunStore`. The truly runless boundaries are pre-admission abort, validation/workspace-resolution failure, idempotent replay that performs no new execution, and a soft-failed Workspace Run creation; test-only optional dependencies must not be generalized into normal production behavior.
- Model history authority is already main-process safe: when a session store exists, durable session state is authoritative and renderer-supplied history is only a compatibility fallback. v3.9.2 should preserve this trust boundary.
- Candidate lineage dimensions to map precisely are `sessionId`, `requestId`, `turnId`, assistant message id, workspace-run id, evidence run id, tool call/invocation id, Goal id/event ref, Plan id/revision, and scheduled execution run id.
- Chat text/reasoning deltas are already visibility-scheduled: consecutive same-type deltas batch into a 16 ms flush, non-text events first flush pending text, and terminal emission is de-duplicated. This can be reused instead of building a new token-level renderer scheduler.
- Renderer stream observers are explicitly best-effort. Final assistant output is persisted before the terminal stream event, and idempotent request replay returns an already persisted assistant turn. Real-time loss can therefore reconcile to final transcript, but not necessarily to full process history.
- Existing lineage is not absent: the runtime context snapshot links evidence `runId`, `workspaceRunId`, `sessionId`, and `requestId`, and publishes its summary into a Workspace Run status payload. The bridge is embedded payload data rather than typed first-class causal fields, and Workspace Run mapping still drops Chat sequence, turn id, and source event id.
- Workspace Run creation, append, and finish failures all soft-fall without a user-visible or durable health signal. This preserves Chat availability but can make an audit view incomplete without declaring its evidence coverage.
- Paused persistence splits into two confirmed defects. AgentLoop/provider pauses use `sendRequired`, which first awaits Chat activity and then republishes with `persist:false`; this bypasses `onPersistEvent`, so Workspace Run receives no paused event and its snapshot remains `running`. A paused status sent through ordinary `send` after recorder creation can append a paused event, but the snapshot still remains `running` because only terminal `finishRun` updates it.
- Existing Chat tests assert paused activity/continuation persistence but not either Workspace Run path. The accepted KM04 decision also says settlement follows all awaited workspace-run work, while ordinary Workspace Run writes remain fire-and-forget and the Kernel settlement receipt does not prove Workspace Run settlement. This is a decision/implementation drift requiring an explicit v3.9.2 durability decision.
- The Workspace Run authority is an append-only JSONL snapshot/event store under the app config directory. The storage guide explicitly keeps workspace-run ledgers as a file-backed boundary, so this is not an incomplete SQLite migration. The gap is lifecycle convergence: projection consumers must reconcile latest snapshot and latest event until a nonterminal status transition contract exists.
- Repository-wide search finds `listChatTrajectory` only in the Workspace Run store and its tests. The ledger is currently a persistence/export boundary with no production IPC/preload/renderer consumer; RunsPanel uses AgentRun/AgentTrajectory instead. The paused defects are latent blockers before v3.9.2 can project this ledger, not demonstrated current UI regressions.
- Streaming `tool_call_preview` arguments are not directly derived from the status-to-Workspace-Run adapter. Deeper evidence may live in the chat-agent evidence trajectory, so an Inspector needs a clear source and data-class/redaction policy rather than assuming the concise Run ledger contains raw tool arguments.
- Required interactive/recovery states (`waiting_for_input`, selected checkpoint transitions, Kernel terminal settlement) use awaited persistence. Ordinary progress status remains best-effort and capped, which is a defensible availability tradeoff only if the UI discloses evidence completeness and reconciliation state.
- The existing Chat surface already has a `ConversationProgressDisclosure`, but it is renderer-local and present only while top-level status is working or paused. It shows at most three items by default/eight when expanded, stores expansion in component state, and exposes no stable link to the source Workspace Run event or Runs inspector.
- The same process/status facts are rendered again in the right rail (`ContextRuntimeSummary`, `ContextActivityCard`, generic progress list), while Goal, Plan, approvals, guided input, context usage, and subagent state use separate cards. This confirms the user experience already has progressive-disclosure fragments; the architectural issue is policy/identity/replay convergence and duplicated projection choices.
- `AgentChatPanel.tsx` embeds disclosure policy (`status` gating, count caps, local expand state, filtering tool-like Goal events) directly alongside rendering. A v3.9.2 policy layer should extract deterministic decisions without moving authorization or lifecycle truth into the renderer.
- `buildTaskProcessItems` creates React-facing ids as `createdAt-state-index` after newest-first reversal. Each newly appended event shifts every prior index, so stable semantic events receive new UI keys; this defeats retained row identity and makes future per-item expansion/focus state fragile.
- The current “user relevant” filter drops `tool_call`, `tool_invocation`, `tool_result`, streaming, skill-load, history, and memory-scope events before the compact process projection. Tool status wording and labels still exist in the same helper but are unreachable through this projection. Tool evidence survives elsewhere, yet Chat's process view cannot explain what executed or provide a causal downlink.
- Reload restores process from the capped Chat activity snapshot, while live state arrives through a separate task-status subscription and message/reasoning/tool preview through `ChatStreamEvent`. This supports graceful final-message recovery, but process projection fidelity is limited by the 80-event mirror and lacks a disclosed coverage/baseline marker.
- The shared output model and assembler support command output, tool call/result, approval, input request, file reference, and ledger parts. `projectChatSessionForTranscript` destructively removes most of those types at the main-process transcript boundary, and `chatOutputModel` filters them again in the renderer even though `OutputPartRenderer` has renderers for the full union. Current tests explicitly lock this behavior.
- A normal Chat execution creates a separate evidence trajectory run, but the persisted final assistant message does not receive a stable executed/evidence run reference. After reload, the transcript can report an aggregate tool count while providing no causal path to the tool evidence that produced the answer.
- Zerox event domains have different envelopes: Chat stream has request sequence and turn identity; task status permits legacy-missing request/sequence and an open payload; Goal progress lacks stable event/run sequence; AgentRun uses loose data; Kernel has version/run id but not session/request/disclosure identity; Plan persists revisions/events without a read subscription. The gap is a versioned cross-domain activity envelope/projection adapter, not absence of all typed facts.
- Plan/Debate persists rich stage, round, model, usage, and error state but exposes no event subscription/cursor replay; Chat emits only coarse planning status while awaiting the complete result. Scheduled execution already has a streaming backend with backpressure, but `ScheduledTasksPanel` uses the blocking call and does not subscribe to it.
- Tool approval is a separate in-memory protocol with its own approval id and no pending snapshot/replay query. The renderer relies on real-time delivery, while the durable Tool Invocation ledger uses a different identity. Reload/transport loss can therefore hide an unresolved attention state even though abort/timeout/shutdown are tested.
- Kernel event history is an in-memory capped telemetry stream, not durable execution authority. Renderer attribution and deduplication infer surface/kind and use `runId:type:millisecond`, which can collide for valid same-millisecond events. It must not become the new conversation fact source.

## P113 Production Scenario Findings

- A green main/preload receipt is insufficient when its action only lists
  generic Chat/Run authorities. S01 now proves a real `chat:sendMessage`
  request, answer delta, terminal event, assistant persistence, and compact
  operations DOM state through the production preload.
- S12 now executes two distinct production attempts. The first emits a
  rejected partial answer and a failed terminal; the second succeeds; after
  renderer reload the SQLite-backed session contains only the accepted answer
  and not the rejected partial.
- Disclosure compactness must be checked at the policy-owned group. Required
  attention/current-state groups may be expanded while the completed low-risk
  operations group remains collapsed.
- The Electron profile's prefix grants already cause the profile builder to
  add literal metadata traversal for every parent directory. Adding the whole
  Darwin user temp directory to `metadataRoots` therefore grants unnecessary
  subtree existence discovery. The correct boundary is literal parent
  traversal plus read/write/socket prefixes for `scoped_dir*` and read/write
  prefixes for `xcrun_db-*`, with a real Seatbelt sibling-`lstat` denial probe.

## P107 Causal Spine Findings And Decisions

- Required and ordinary status were two halves of one broken settlement protocol. The fix is one per-turn ordered persistence coordinator with required publication barriers, not separate pause patches.
- A global `requestId` plus exact bounded input fingerprint is the execution claim. Window/session identity is routing context; durable `sessionId` and user message identity bind only after Chat persistence.
- A duplicate claimed request with no accepted assistant reply must never cross the execution boundary. Accepted duplicates reconcile from the durable assistant message; conflicting input fails closed.
- Assistant persistence is the acceptance boundary: durable message first, role/request/turn/content-bound receipt second, Workspace terminal third, terminal stream last. A crash between message and receipt is replayed without model or tool execution.
- Workspace Run remains an owning evidence ledger rather than the universal source. `ensureRun` validates the original envelope; `settleLifecycle` provides stable event replay, nonterminal snapshot truth, terminal monotonicity, and event-first recovery.
- Approval is a privilege state machine, not ordinary observability. Intent persistence precedes renderer publication; decision CAS precedes resolution; any approved-decision persistence failure denies execution; cold start interrupts rather than resumes the privilege.
- Durable approval state is evidence only. No startup or executor code reads a stored approved intent as an authorization grant; only the live `ToolAuthorizationService` promise can release execution.
- Run identities must remain typed. A Trajectory run id is not an AgentRun id, and Tool Invocation identity is scoped by its owning run because provider tool-call ids can repeat.
- Streaming answer text must have one live channel. `answer_delta` owns live text; text output parts are durable reload material, while structured tool/approval/diagnostic parts can remain live.
- Buffered text must be flushed before a following status allocates its wire sequence; allocating status sequence first can produce a valid payload stream in invalid numeric order.
- Causal persistence stores only fingerprints, safe bounded approval summaries, coverage, controls, and stable refs. It does not copy prompts, assistant answers, tool arguments/results, private reasoning, or credentials.
- The first P107 candidate's green gates did not prove its claims. Three independent reviewers found four shared root families: incomplete execution identity, missing live retry control, non-authoritative approval reload, and status inference from message existence. P107 therefore stayed open.
- Exact request identity must cover all execution-affecting inputs, including Plan/autonomy/model bindings, workspace/history, and attachment content fingerprints. Metadata-only attachment identity can silently replay a different payload.
- A durable assistant message proves that content exists, not that the turn succeeded. The assistant and receipt now bind `succeeded | paused | failed`; only succeeded replay may repair Workspace success, while legacy missing status remains degraded.
- Workspace crash repair requires a store-owned lifecycle witness on every specialized event, not only a generic status event. Otherwise waiting approval can be appended while its failed snapshot write is unrecoverable.
- Retry truth must cross the process boundary. Durable causal begin/supersede/reset without an attempt-tagged Chat stream still leaves the renderer showing rejected partial text; transient answer, thinking, and tool previews now follow the same attempt control.
- Approval reload correctness is subscribe-first plus snapshot/revision merge, not a one-shot `did-finish-load` push. A terminal revision-2 tombstone must dominate stale revision-1 requests from either push or snapshot.
- Approval task labels are user-controlled durable input just like arguments. Both coordinator and causal-store boundaries redact credentials, collapse lines, and enforce a UTF-8 byte cap.
- An ambiguously committed approved decision is audit evidence but not a capability. The in-process waiter must resolve fail-closed even when readback shows the terminal approval was durably written.
- Git worktree creation cannot repair one bypass by introducing another. Authorization and dispatch now pass through `ToolRuntime`, which strips caller-supplied proof and injects the audit receipt from its own `ToolAuthorizationService` decision.
- The second green candidate also failed independent mutation review. A field-complete claim was still not exact because its canonical serializer conflated `undefined` with a string and bigint with a string, then compressed identity into 64-bit FNV. Exact execution claims now use type-tagged canonical bytes and SHA-256; compact disclosure/event hashes remain a separate non-authoritative concern.
- A ToolRuntime-provided audit id is not itself a capability when the destructive service accepts any nonempty string. Worktree creation now verifies the durable audit event is allowed and binds the fixed task, tool, and exact canonical name/repository/branch request before invoking Git; forged and request-reused receipts fail closed.
- Legacy assistant content without a durable business settlement is explicit `unknown`, not implicit success. Kernel and renderer conservatively present it as paused/reconciliation-required; paused and failed replays use their durable status even when no live `agentStatus` is present.
- Every Workspace terminal mutation is a repair boundary. `finishRun` must first apply the latest lifecycle witness, otherwise a failure call immediately after an event-first success crash can permanently overwrite the true terminal result.
- Retry transport gaps are semantic gaps. If `supersede` is lost but the next attempt begins, the renderer must reset transient text/thinking/previews on the sequence gap or attempt switch before accepting the new delta.
- Security normalization belongs at every durable write boundary. The causal store now re-sanitizes `safeArgsSummary` as well as `taskName`; a coordinator-produced “safe” label cannot be trusted as the only credential filter.
- A persistence identity algorithm is itself schema. Replacing the old 64-bit digest with type-tagged SHA-256 without a separate version makes every pre-upgrade request look conflicting. New claims now persist `sha256-type-tagged-v2`; old unversioned 16-hex claims are inferred as legacy, matched read-only, and may only reconcile an already durable result with degraded coverage.
- “Paused” needs an honest recovery proof. A true resumable route may report `continuationPersisted`; a legacy result with unknown settlement instead reports `reconciliationRequired`. Treating the latter as if a continuation existed would turn conservative UI status into false recoverability.
- An authorization receipt is a linear capability, not reusable evidence. Exact audit verification prevents forgery and argument substitution, but only atomic consume-before-effect prevents one approval from dispatching the same destructive operation twice across concurrency or restart.
- Linear capability consumption must use one coordination primitive across every supported storage backend. Separate JSON markers and SQLite uniqueness each work locally but split the authority during dual/JSON concurrency or backend fallback; all backends now acquire the same exclusive marker before their own audit append.
- Compatibility mode is an execution gate, not just a coverage label. A legacy claim without a durable assistant must be rejected before every execution route, including internal guided-input continuations that intentionally skip user-message append.
- Kernel settlement must consume the emitted durable lifecycle, not reconstruct it from a lossy success/error union. `waiting_for_input`, canceled terminals, and the resolved event session are authoritative; caller routing ids and error-code inference are fallbacks only when no lifecycle event exists.
- Authority adoption must precede disposition handling. Even a fingerprint conflict belongs to the existing request claim's durable session; publishing its failure before adopting that session can corrupt an unrelated caller session or fail settlement entirely.
- Stable-looking sanitized concatenation is not stable identity. Kernel run ids now use a per-invocation nonce plus type-tagged SHA-256, and production causal refs record the resulting Kernel id. AgentRun refs are written only for real owning `AgentRunRecord`s; Trajectory ids remain a different domain.

---

# Historical Findings and Decisions: P70

## Requirements

- Keep initial Direct and Debate behavior compatible with their existing stages, retries, model freezing, and quality gates.
- Introduce a stable Goal contract shared by all planning roles.
- Represent every structural runtime replan as a new Direct PlanRecord linked to the same Goal.
- Preserve initial Debate rounds and expose mode/version lineage without silently calling runtime Direct a Debate continuation.
- Keep Plan completion separate from Goal acceptance and certification.
- Upgrade legacy records lazily and preserve existing security boundaries.

## Research Findings

- Current primary flow is `chatService -> PlanDebateOrchestrator -> confirmPlan -> GoalChatService -> AgentGoalController`.
- Direct uses a `direct` round followed by an independent review and deterministic quality gate.
- Debate uses `A1 -> B1 -> A2 -> B2 -> C`, with downstream invalidation and frozen role bindings.
- Current confirmation translates `finalArtifact` into a new Goal and stores only one `sourcePlanRef`.
- Current runtime replanning mutates Goal milestones in place and increments `planVersion`; it does not create a PlanRecord.
- Plan status currently mirrors linked Goal terminal state, which conflates path completion and Goal acceptance.
- `chatSessionWork` is the shared source for active/recovery Goal session projection and must remain authoritative.
- `PlanStore` only accepts schema v1/v2 today, so v3 validation and lazy normalization must land together with the type changes.
- `AgentGoalStore` already has a normalization boundary suitable for deriving legacy Goal contracts and compacted lineage without bulk migration.
- Goal-to-Plan synchronization currently finds the first Plan by `executionGoalId`; multi-Plan lineage requires resolving the active Plan reference instead.
- Plan persistence already serializes per-record mutations and SQLite Plan/event writes atomically; Goal adoption still needs a cross-record coordinator because Goal JSON and Plan Store are separate durable boundaries.
- Goal terminal writes deliberately preserve certified acceptance state, so lineage updates must never weaken the existing protocol-v2 certificate checks.
- Shared code already contains a renderer-safe stable JSON/SHA-256 implementation, but it is private to runtime-context hashing; P70 will keep contract canonicalization in a dedicated module instead of coupling two unrelated contracts.
- `GoalAcceptanceCertificate` is currently v1 and identifies only `planVersion`; its backward-compatible extension should use optional GoalContract/active Plan references so old certificates remain verifiable.
- Existing planner fixtures legitimately paraphrase the artifact objective; Goal integrity is therefore enforced by the independently hashed contract and Goal creation from that contract, while criterion bindings remain an explicit persisted map to executable checks.
- Planner v3 continues using the proven v2 structured output schema; `schemaVersion: 3` upgrades persistence/lineage without forcing providers to learn an unrelated JSON response format.
- Goal progress delivery can race a caller immediately after Plan confirmation; awaiting the delivery queue after releasing the Plan confirmation lock provides a stable returned projection without deadlocking nested Plan synchronization.
- Runtime adoption cannot be physically atomic across JSON Goal storage and Plan storage, so the transaction uses Goal plan-version CAS, idempotent ledger publication keys, active-plan identity, and a recovery branch to converge after crashes.
- Adoption recovery must run before ordinary expected-revision/confirmable checks once the Goal already points at the candidate Plan; otherwise a crash after the Goal CAS leaves a permanently half-adopted lineage.
- Plan Markdown includes the planning revision. After confirmation, execution-status saves legitimately increment `PlanRecord.revision`, so projection verification must render against `confirmedRevision` while still hashing the actual file and final artifact.
- Existing Chat intent routing conflated `修改计划` with `调整目标`. P70 splits those commands: the former revises or creates a Direct Plan path, while explicit `修改目标：…` creates a user-approved Goal amendment proposal.

## Technical Decisions

| Decision | Rationale |
|----------|-----------|
| Add shared Goal contract module rather than reuse specialized `AgentTaskContract` | The latter supports narrow deterministic execution pipelines, not general Goal semantics |
| Store a Goal contract snapshot and hash on both Plan and Goal | Provides immutable prompt/confirmation input and restart-safe execution continuity |
| Keep full planning evidence in PlanRecord; Goal stores only lineage references | Prevents duplicate sources of truth |
| Runtime Plan adoption is a main-process optimistic transaction | Renderer state cannot switch writable execution paths |
| Contract issues are quality/input gates, not model-authorized mutations | Prevents silent objective or acceptance degradation |
| Keep planner output schema v2 under PlanRecord v3 | Separates provider JSON compatibility from durable lineage evolution |
| Await post-confirm progress reconciliation before returning | Prevents a confirmed caller from observing a stale Plan revision |
| Recover an adoption transaction from active Plan identity | Completes parent supersession, candidate linkage, resume, and ledger publication after any crash window |

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| Coze development skill would require external project context | User explicitly excluded Coze; implementation stays entirely local |
| Catchup helper documented `python`, but only `python3` exists | Used `python3` successfully |

## Resources

- `src/shared/planMode.ts`
- `src/shared/agentGoal.ts`
- `src/main/planDebateOrchestrator.ts`
- `src/main/container.ts`
- `src/main/goalChatService.ts`
- `src/shared/chatSessionWork.ts`
