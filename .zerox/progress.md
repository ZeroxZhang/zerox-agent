# Zerox Harness Progress

## 2026-06-10 Baseline

- Active iteration: Agent Capability P2.1 native code tools.
- Branch: `codex/memory-runtime-p0`.
- Starting point includes passing `npm run verify` and `npm run smoke:prod` from the planning pass.
- Repo harness files, runtime state fidelity, shell workspace governance, chat evidence, episode export, contract evals, harness scoring, and native code engineering tools are implemented.
- Native code engineering tools now cover `code_search`, `git_status`, `git_diff`, and `test_run`, with task permission checks, workspace sandbox checks, registry descriptors, runtime/chat native trajectory evidence, Overview Agent Capability score, and a deterministic code-engineering eval fixture.
- Latest focused checks:
  - `npm run harness:check`
  - `node scripts/run-agent-evals.mjs` → agent eval 8/8, tool success 0.8889
  - `npm run build`
  - `npm run harness:score` → last recorded score 9.21/10 before P2.1 full rerun
  - `npm run verify` → previous baseline 78 Vitest files / 346 tests, agent eval 7/7, memory eval 2/2
  - `npm run smoke:prod` → renderer rendered agent chat UI
  - Browser Overview QA → Harness card rendered on desktop and 390px viewport, no console warnings/errors
- Current focus: P2.1 docs refresh, full verification, Browser Overview QA for Agent Capability, then audit remaining Agent Capability P2 scope.
