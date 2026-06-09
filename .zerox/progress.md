# Zerox Harness Progress

## 2026-06-10 Baseline

- Active iteration: Agent Capability P2.2 reflection and episode eval candidates.
- Branch: `codex/memory-runtime-p0`.
- Starting point includes passing `npm run verify` and `npm run smoke:prod` from the planning pass.
- Repo harness files, runtime state fidelity, shell workspace governance, chat evidence, episode export, contract evals, harness scoring, and native code engineering tools are implemented.
- Native code engineering tools now cover `code_search`, `git_status`, `git_diff`, and `test_run`, with task permission checks, workspace sandbox checks, registry descriptors, runtime/chat native trajectory evidence, Overview Agent Capability score, and a deterministic code-engineering eval fixture.
- Reflection policy now classifies failed tool observations, blocks duplicate retries, writes `reflection_added` trajectory evidence, and episode export includes reviewable `eval-candidate.json`.
- Latest focused checks:
  - `npm run harness:check`
  - `node scripts/run-agent-evals.mjs` → agent eval 10/10, tool success 0.8182
  - `npm run build`
  - `npm run harness:score` → score 9.24/10, agent eval 10/10
  - `npm run verify` → 85 Vitest files / 375 tests, agent eval 10/10, memory eval 2/2
  - `npm run smoke:prod` → renderer rendered agent chat UI
  - Targeted Overview QA → `.overview-panel` rendered on desktop and 390x844 smoke viewport with Harness, Agent Capability, native tools, and no horizontal overflow
- Current focus: full verification after P2.2, then audit P2.3/P2.4 scope.
