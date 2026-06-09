# Zerox Harness Progress

## 2026-06-10 Baseline

- Active iteration: Harness Engineering Iteration.
- Branch: `codex/memory-runtime-p0`.
- Starting point includes passing `npm run verify` and `npm run smoke:prod` from the planning pass.
- Repo harness files, runtime state fidelity, shell workspace governance, chat evidence, episode export, contract evals, and harness scoring are implemented.
- Latest focused checks:
  - `npm run harness:check`
  - `npm run harness:score` → score 9.21/10, agent eval 7/7
  - `npm run verify` → 78 Vitest files / 346 tests, agent eval 7/7, memory eval 2/2
  - `npm run smoke:prod` → renderer rendered agent chat UI
  - Browser Overview QA → Harness card rendered on desktop and 390px viewport, no console warnings/errors
- Current focus: README/version refresh, full verification, packaging, push, and remote release update.
