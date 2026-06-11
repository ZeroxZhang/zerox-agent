# Zerox Agent Operating Guide

## Mission

Zerox Agent is a local-first desktop control plane for permissioned, observable, recoverable agent runs.

## Fast Start

1. Run `./init.sh`.
2. Read `.zerox/feature_list.json`.
3. Pick exactly one unfinished feature.
4. Before editing, inspect the files named by that feature.
5. After editing, run the feature verification command plus `npm run harness:check`.
6. Update `.zerox/progress.md` with evidence.

## Core Commands

- `npm run harness:check`
- `npm test`
- `npm run build`
- `npm run verify`
- `npm run smoke:prod`

## Boundaries

- Preserve local-first trust, explicit permissions, observable trajectories, and reviewed learning.
- Do not add cloud workers or unreviewed self-modification in this iteration.
- Do not bypass `ToolAuthorizationService` or workspace sandbox checks.
- Prefer typed shared models and focused tests before runtime behavior changes.

## Done Criteria

- Focused tests pass.
- `npm run verify` passes.
- `npm run smoke:prod` passes for UI/runtime-affecting changes.
- `.zerox/progress.md` records changed files and command evidence.
