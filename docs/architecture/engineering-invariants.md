# Engineering Invariants (2026-09-03)

This file records hard constraints discovered empirically while working on this
repository. Treat it as the first thing to read before deleting, moving,
renaming, or re-formatting **any tracked file**, and before judging test or
governance failures as "environment noise".

> Validation note: every claim below was reproduced locally on 2026-09-03 at
> HEAD `9c6b500` / follow-up commits. Where a claim says "breaks X", reverting
> the change made X pass again.

## 1. Root-level process artifacts are pinned by active governance

The following tracked files must stay present **at their exact root paths**:

- `findings.md`, `progress.md`, `task_plan.md` — they are listed in the frozen
  successor-program closed world as `postReviewMutablePaths` (content may
  change after review; **existence may not**). Deleting them made 6
  `conversationDisclosureProgram.test.ts` cases fail with `ENOENT` (observed).
  Archiving them into `docs/...` also breaks the CD09 local-package source
  manifest (new paths leave the manifest's planning-path exclusion).
- `HANDOFF-v3.9.2-conversation-disclosure*.md` (rounds 5-12, main doc,
  release blocker) — read at runtime as CD03A completion artifacts by
  `scripts/check-conversation-disclosure-successor-program.mjs`; moving or
  deleting them adds 9 new program-check errors (observed).
- `.superpowers/**` (21 tracked files) — included in the CD09 source-manifest
  digest (`scripts/local-candidate-source-manifest.mjs` hashes every tracked
  file plus untracked non-ignored files); removal flips
  `CD09 local package source manifest is stale` (observed).

Rule of thumb: **do not delete or move tracked files without running the
follow-up checks below.** Even "clearly dead" files may be manifest-pinned.

## 2. Tracked-file change protocol

Before removing/moving/formatting any tracked path:

1. `grep -rn '<path>' src scripts .zerox --include=*.ts --include=*.mjs --include=*.json`
   (tests, checkers, evidence JSONs may reference it).
2. Run the digest/root-sensitive suites locally:
   - `npx vitest run --run src/shared/conversationDisclosureProgram.test.ts` (66 cases)
   - `node scripts/check-conversation-disclosure-successor-program.mjs`
   - Compare npm-test failure sets before/after (see §4) — never rely on a
     single green/red run alone.
3. If a program check needs caller-pinned identities (Node/npm pins,
   `ZEROX_*_DIGEST` env) and you are not on the acceptance host, treat the
   check as "cannot run locally" rather than "failing because of my change":
   use the failure-set-equivalence method instead.

## 3. .gitignore drift traps

- 122 tracked files still match ignore rules (checked 2026-09-03):
  `.superpowers/` (21, tracked by design) and `docs/design` (48),
  `docs/superpowers` (49). `docs/architecture` was drifted too until
  `.gitignore` gained `!docs/architecture/` on 2026-09-03 — new files under
  `docs/architecture` are now tracked normally.
- Consequence: `git add docs/design/...` **silently ignores new files** there.
  Tracked files in those directories keep working (ignore rules do not apply
  to already-tracked files), but do not "un-ignore" the directories casually:
  the whitelist exists to keep new iteration junk out of git.
- `.tmp_*` is ignored: use it for scratch/report files that must not pollute
  `git status`.

## 4. Local test baseline (macOS, Node 24 nvm)

- `npm test` on a Node 24 local install has a known pre-existing failure set
  (~19 unique cases) caused by the environment (Seatbelt
  `process_sandbox_unavailable` family, storage round-trips), not by code.
- CI and acceptance run Node 22 (see `.nvmrc`, `engines`). Native modules
  (`better-sqlite3`) are ABI-bound to the Node used for `npm ci`; running
  `npm test` under a different Node without reinstalling produces hundreds of
  spurious failures — do not diagnose those as code regressions.
- Acceptance method for a change: capture `npm test` failing-test sets before
  and after; the change is clean if the sets are equal (or strictly smaller),
  and any targeted suite affected by the change passes.

## 5. Governance vs. development gates

- `npm run program:check` / `npm run harness:check` require acceptance-host
  caller pins at completed-program state (observed baseline of 7 env-bound
  complaints at HEAD `9c6b500`). They are authoritative on the acceptance
  host / CI with secrets, not on a plain laptop.
- CI runs `npm test` only on pull requests; direct `main` pushes run a
  reduced gate (kept in sync with this file's date — verify current
  `.github/workflows/verify.yml`).

## 6. Toolchain

- Pin Node 22: `.nvmrc` = `22`, `engines.node` = `>=22.0.0 <23`.
  CI (`verify.yml`, `release.yml`) uses `setup-node 22`.
