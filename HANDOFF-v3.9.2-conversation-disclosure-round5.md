# v3.9.2 Conversation Disclosure Round5 Handoff

## Resume Point

Resume at `R5-0`. Do not restart P104-P107 or mutate any Round1-Round4 frozen
file.

## Current State

- Branch: `codex/3.9.2`.
- P107A/CD03A remains the only unfinished Feature/workstream.
- Round4 policy:
  `sha256:c4b40e8dd31554b3bd25ccf1c1d3d1671291e8f52c41286d9cd729ebb8fa4843`.
- Round4 policy serialized byte SHA-256:
  `sha256:f920a1f17b28b7ed63f0196f3447fbb87641fe6198e8059623f43bc4f68fb303`.
- Round4 snapshot:
  `sha256:7e3f075ac63abd39ce9e4a9ab6a3780e864c5397ddb40ecaef0d3a541febf740`.
- Round4 snapshot serialized byte SHA-256:
  `sha256:0b1625d7646eb40e3c9c9091ad85cb1e0bfab3ab3e6ebc25793d86c179a3a8c3`.
- Round4 snapshot coverage: `90 frozen`, `4 transition payload`, `12 baseline`,
  `23 absent`, `6 review-output absent`.
- Round4 governance failed receipt canonical digest:
  `sha256:c09c4c3140545e4acfd8e7e2827b0f98b77304c97e3f4d87501b826373458a9d`.
- Failed receipt byte SHA-256:
  `sha256:e9f632a950128048c30f4809ffab050c7db832cd76809ca5bdd249034b7e950e`.
- Round4 contract/runtime receipts remain absent because those reviews were
  stopped after the first FAIL.
- Round4 manifest, attestation, anchor, journal, and main-tree transition remain
  absent.

## Round4 Finding

`R4-GOV-001` is Major. Final evidence validation omits semantic bindings:

- empty or malformed checker/harness candidate result sets can pass;
- future attestation time is not rejected;
- manifest, attestation, and anchor roots are not compared completely;
- anchor head values are not exact and can overclaim P108 completion.

See
`.zerox/decisions/CD03A-round5-final-evidence-trust-head.md`.

## Accepted Round4 Implementation Evidence

- R4-1 focused contract/policy/runtime/governance: `50/50`.
- Final V4 focused slice: `9 files / 66 tests`.
- Test type coverage: `328/328`.
- State-aware full test orchestration:
  - current tree: `321 files / 3679 tests`, plus existing stress skips;
  - reconstructed Round3 contract/manifest/freezer: `37/37`;
  - V3 policy: `6/6`, with one original-repository-anchor-bound historical
    production case explicitly skipped;
  - Round4 Program/package targets: `77/77`.
- Standard all-to `npm run verify`: PASS, including build, Agent `26/26`, and
  Memory `2/2`.
- Source and all-to production smoke: PASS.
- Isolated V4 transaction: fresh PASS, completed replay PASS, `after-journal`
  injected failure followed by forward recovery PASS.
- Isolated anchored checker and authoritative harness: PASS.
- Round23 historical checker and Round3 protected `26/26`: PASS.
- V4 syntax, whitespace, and credential-shape scans: PASS.

These results establish a strong implementation baseline but cannot override
the Round4 Major finding.

## R5-0

1. Rehash the Round4 policy, snapshot, governance failed receipt, all `90`
   frozen files, four payloads, and the Round3 `26` protected files.
2. Confirm Round4 contract/runtime receipts, manifest, attestation, anchor, and
   journal remain absent.
3. Add only new V5/Round5 files and extend the P107A roster.
4. Build a deterministic Round4 review-rejection witness.
5. Add mutation tests before implementation for empty/reordered/extra candidate
   results, future time, stale dispatch, stale runner/validator/parent/
   rejection roots, altered final manifest, and every anchor-head field.
6. Re-run the state-aware current/historical/target suite and transaction fault
   matrix before any Round5 policy publication.

## Prohibitions

- No reset, clean, checkout, commit, push, release, or main-tree transition.
- No browser or provider credential use before CD09.
- No claim of reviewer identity beyond caller-attested `not-signed` metadata.
- No Round5 policy/snapshot/review publication until all pre-freeze gates pass.
