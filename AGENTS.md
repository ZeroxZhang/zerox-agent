# Zerox Agent Operating Guide

## Mission

Zerox Agent is a local-first desktop control plane for permissioned, observable, recoverable agent runs.

## Fast Start

1. Run `./init.sh`.
2. Read `.zerox/feature_list.json`.
3. Read the active program manifest. For the current iteration this is
   `.zerox/kernel-migration-program.json`.
4. Pick exactly one unfinished feature.
5. Before editing, inspect the files named by that feature.
6. After editing, run the feature verification command plus
   `npm run harness:check`.
7. Update `.zerox/progress.md` with evidence.

## Core Commands

- `npm run harness:check`
- `npm run program:check`
- `npm test`
- `npm run build`
- `npm run verify`
- `npm run smoke:prod`

## Boundaries

- Preserve local-first trust, explicit permissions, observable trajectories, and reviewed learning.
- Do not add cloud workers or unreviewed self-modification in this iteration.
- Do not bypass `ToolAuthorizationService` or workspace sandbox checks.
- During Kernel migration, preserve Chat stream/persistence parity and Goal
  checkpoint/acceptance parity before changing a production cutover flag.
- Keep Context event compaction, external subagent providers, and arbitrary
  Code Mode behind the deferral gates in the migration manifest.
- Prefer typed shared models and focused tests before runtime behavior changes.

## Done Criteria

- Focused tests pass.
- `npm run verify` passes.
- `npm run smoke:prod` passes for UI/runtime-affecting changes.
- `.zerox/progress.md` records changed files and command evidence.
