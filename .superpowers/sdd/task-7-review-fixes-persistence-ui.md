# Task 7 review fixes — persistence and renderer truthfulness

## Scope

- Finding 5: every `completed_unverified` record is certificate-free at JSON and SQLite write/read boundaries, including historical and migrated records.
- Finding 7: final-acceptance renderer results are fenced by goal identity and a known canonical status; copy is derived from the returned outcome.
- Minor 1: backoff UI shows the upcoming attempt, while an active request shows the current attempt.
- Minor 2: P43 `files` is the exact committed feature range, guarded by `packageScripts.test.ts`.

## Root cause

- Certificate stripping was conditional on a valid manual attestation, so ordinary or historical `completed_unverified` records could retain certificate bytes.
- The renderer result fence checked only the goal ID, then used optimistic fallback copy for every unhandled status.
- Retry presentation rendered the last failed attempt during a scheduled backoff, while controller events correctly announced the upcoming attempt.
- The feature manifest listed design-era paths instead of the exact `79af895..HEAD` changed-file set.

## TDD evidence

### RED

`npm test -- --run src/main/agentGoalStore.test.ts src/main/storage/repositories/repositories.test.ts src/renderer/goalAcceptanceInteraction.test.ts src/renderer/goalProgressViewModel.test.ts src/renderer/materialDesign.test.ts`

- Failed 12 assertions across JSON/SQLite certificate sanitation, result classification, retry attempt display, and component wiring.

`npm test -- --run src/shared/packageScripts.test.ts`

- Failed the exact P43 file-manifest assertion before `.zerox/feature_list.json` was corrected.

### GREEN

`npm test -- --run src/main/agentGoalStore.test.ts src/main/storage/repositories/repositories.test.ts src/renderer/goalAcceptanceInteraction.test.ts src/renderer/goalProgressViewModel.test.ts src/renderer/materialDesign.test.ts`

- 5 files, 196 tests passed.

`npm test -- --run src/main/storage/migrateRoundTrip.test.ts`

- 1 file, 1 JSON → SQLite → JSON migration test passed; imported and rolled-back manual completion has no certificate.

## Final verification

- `npm test -- --run src/main/agentGoalStore.test.ts src/main/storage/repositories/repositories.test.ts src/main/storage/migrateRoundTrip.test.ts src/renderer/goalAcceptanceInteraction.test.ts src/renderer/goalProgressViewModel.test.ts src/renderer/materialDesign.test.ts src/shared/packageScripts.test.ts` — 7 files, 205 tests passed.
- `npx tsc -p tsconfig.renderer.json --noEmit` — passed.
- `npx tsc -p tsconfig.electron.json --noEmit` — passed.
- `npm run harness:check` — passed.
- `git diff --check` — passed.
- P43 manifest parity before commit: 52 expected paths, 52 listed paths, no missing or extra entries for `79af895..HEAD` plus this scoped commit.
