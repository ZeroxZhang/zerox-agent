# Engineering Invariants (2026-09-03, post-optimization)

Hard constraints discovered empirically while working on this repository.
Read before deleting, moving, renaming, or re-formatting any tracked file,
and before judging test or governance failures as environment noise.

> Rewritten on 2026-09-03 after the governance slimming plan (Phases 0-4):
> the conversation-disclosure successor machinery (round archives,
> orchestrators v1-v13, their checkers and state tests) was frozen under
> archive/disclosure-history/ (tag archive/disclosure-history-v3.9.2) and
> nothing in the live tree reads it. Every pin in this file was re-verified
> at HEAD 61062e0 on Node 22.23.2.

## 1. Toolchain and native ABI

- Pin Node 22: `.nvmrc` = 22, `engines.node` = ">=22.0.0 <23". CI
  (verify.yml, release.yml) uses setup-node 22. Local development must use
  Node 22 too (nvm use 22).
- better-sqlite3 is ABI-bound to the Node used for `npm ci`; switching
  Node versions without reinstalling produces hundreds of spurious native
  failures - run `npm rebuild better-sqlite3` after a Node switch and do
  not diagnose ABI noise as code regressions.
- `npm run native:build` compiles the unsigned zerox-safe-fs helper
  (native/macos/zerox-safe-fs.c) whose digest is pinned at packaging time
  by scripts/build-v392-acceptance-anchor.mjs CONTROL_DIGESTS.

## 2. Test entry and determinism

- `npm test` = `npm run native:build && vitest run`. It runs the live tree
  only: no repository copies, no historical state rewinding, no fixture
  restoration. Historical governance tests live inert under
  archive/disclosure-history/tests/.
- Local suite must be green on Node 22 (macOS). A small set of Seatbelt and
  storage round-trip tests are environment-sensitive by design; they run
  for real on the macos-14 CI runner. Do not use failure-set-equivalence
  acceptance - it was abolished with the v13 orchestrator.
- `npm run test:watch` (plain vitest) and `npm test` now share the same
  semantics; watch regressions are real regressions.

## 3. Governance surface

- Live governance files: `.zerox/feature_list.json` (feature ledger),
  `.zerox/progress.md` (change evidence), AGENTS.md, init.sh, and the four
  program records runtime-convergence / kernel-migration /
  storage-convergence / release under `.zerox/`. `npm run harness:check`
  verifies these product contracts plus the four program checkers and runs
  green locally without secrets. `npm run program:check` is the same set.
- `archive/` holds frozen records (disclosure archaeology, root process
  docs, CD decisions). Files there are reference material: move, never
  edit. Do not re-add archived paths to checkers or tests.
- `.tmp_*` is gitignored scratch space; use it for reports and probes.

## 4. CI gates

- PRs run `npm run verify` (typecheck:tests + npm test + build + offline
  evals). Sealed-main pushes and tag releases additionally run the full
  npm test suite (harness:check, npm test, typecheck:tests, stress:runtime,
  build, offline evals, smoke:prod on release) - locked by
  src/shared/ciWorkflow.test.ts, which asserts the exact command lists.
- verify.yml runs on macos-14 because native/main tests are darwin-only.
- The v3.9.2 release attestation digest secret is no longer consumed by
  the local harness (the successor check was archived); it remains for
  the external acceptance lane documented in .zerox/release-runbook.md.

## 5. Layering and hygiene

- tsconfig include allowlists enforce shared/main/preload/renderer
  layering (main+preload+shared in tsconfig.electron.json; renderer+shared
  in tsconfig.renderer.json); tests compile under tsconfig.tests.json.
  Shared code must not import main/renderer (enforced by include sets; a
  lint boundary is planned - see Phase 7 of the optimization plan).
- Decision literals in tool authorization carry a machine-readable kind
  (shared/toolPermissions.ts ToolAuthorizationDecision.kind); consent
  gates branch on kind, never on reason-text regexes. Keep it that way.
- Tracked files matching .gitignore: measured 0 at HEAD 61062e0 (method:
  git ls-files | while read f; do git check-ignore -q "$f"; done). If the
  count rises above 0, fix the .gitignore whitelist instead of force-adding.

## 6. Verified local baselines (2026-09-03)

- npm test (Node 22.23.2): 319 passed | 1 skipped (320 files),
  3814 passed | 6 skipped - green.
- npm run harness:check / program:check: exit 0, no secrets.
- Typechecks: tsconfig.electron / renderer / tests all clean.
- scripts/*.mjs: 41 files; .zerox/: 54 files.
