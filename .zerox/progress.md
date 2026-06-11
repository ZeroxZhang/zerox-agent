# Zerox Harness Progress

## 2026-06-10 Baseline

- Active iteration: Agent Capability P2.4 lightweight child handoff review gate.
- Branch: `codex/memory-runtime-p0`.
- Starting point includes passing `npm run verify` and `npm run smoke:prod` from the planning pass.
- Repo harness files, runtime state fidelity, shell workspace governance, chat evidence, episode export, contract evals, harness scoring, and native code engineering tools are implemented.
- Native code engineering tools now cover `code_search`, `git_status`, `git_diff`, and `test_run`, with task permission checks, workspace sandbox checks, registry descriptors, runtime/chat native trajectory evidence, Overview Agent Capability score, and a deterministic code-engineering eval fixture.
- Reflection policy now classifies failed tool observations, blocks duplicate retries, writes `reflection_added` trajectory evidence, and episode export includes reviewable `eval-candidate.json`.
- Research writing tools now cover `web_fetch_document`, `citation_record`, `citation_coverage_check`, and `markdown_report_write`, with citation coverage gates, separate `.citations.json` evidence sidecars, native descriptors, and a deterministic research-writing eval fixture.
- Lightweight handoff now adds researcher/executor/reviewer contracts, `child_handoff_created` / `child_handoff_completed` / `child_handoff_reviewed` trajectory evidence, and Runs review gate cards.
- Latest focused checks:
  - `npm test -- src/shared/researchWriting.test.ts src/main/nativeResearchTools.test.ts src/shared/toolPermissions.test.ts src/shared/agentProtocol.test.ts src/main/agentToolExecutor.test.ts src/main/eval/agentEvalRunner.test.ts` → 6 files / 62 tests
  - `npm run harness:check`
  - `npm run verify` → 88 Vitest files / 393 tests, agent eval 11/11, memory eval 2/2
  - `npm run harness:score` → score 9.31/10, agent eval 11/11
  - `npm run smoke:prod` → renderer rendered agent chat UI
  - `npm test -- src/shared/agentHandoff.test.ts src/main/multiAgentCoordinator.test.ts src/main/eval/agentEvalRunner.test.ts src/renderer/materialDesign.test.ts` → 4 files / 22 tests
- Current focus: P2 closeout.

## 2026-06-10 P3 Agent Learning Harness Loop - Worker 2

- Implemented Task 2 refined scope: eval candidate service, promoted eval fixture store, IPC handlers, and preload APIs.
- Changed files:
  - `src/shared/agentEvalCandidate.ts`
  - `src/main/agentEvalCandidateService.ts`
  - `src/main/agentEvalCandidateService.test.ts`
  - `src/main/eval/agentPromotedEvalFixtures.ts`
  - `src/main/eval/agentPromotedEvalFixtures.test.ts`
  - `src/main/main.ts`
  - `src/preload/index.ts`
- TDD evidence:
  - `npm test -- src/main/agentEvalCandidateService.test.ts` → RED, no test file found before creation.
  - `npm test -- src/main/agentEvalCandidateService.test.ts src/main/eval/agentPromotedEvalFixtures.test.ts` → RED, missing service/store modules after tests were added.
  - `npm test -- src/main/agentEvalCandidateService.test.ts src/main/eval/agentPromotedEvalFixtures.test.ts src/main/agentEvalCandidateStore.test.ts` → 3 files / 10 tests passed.
  - `npm run build` → passed.
  - `git diff --check` → passed.
  - `npm run harness:check` → passed.

## 2026-06-11 P3 Agent Learning Harness Loop - Worker 3

- Implemented Task 3 scope: Runs eval-candidate generation, eval review/promotion UI, Overview pending eval candidate attention and capability score input, and `evals` navigation.
- Changed files:
  - `src/renderer/components/EvalReviewPanel.tsx`
  - `src/renderer/components/RunsPanel.tsx`
  - `src/renderer/components/OverviewPanel.tsx`
  - `src/renderer/App.tsx`
  - `src/shared/navigation.ts`
  - `src/shared/materialNavigation.ts`
  - `src/shared/appMeta.ts`
  - `src/renderer/materialDesign.test.ts`
  - `src/shared/navigation.test.ts`
  - `src/shared/appMeta.test.ts`
- TDD and verification evidence:
  - `npm test -- src/renderer/materialDesign.test.ts` → RED, 3 expected failures for missing Runs eval generation, missing EvalReviewPanel, and hardcoded Overview pending eval count.
  - `npm test -- src/renderer/materialDesign.test.ts` → 1 file / 11 tests passed.
  - `npm test -- src/renderer/materialDesign.test.ts src/shared/navigation.test.ts src/shared/materialNavigation.test.ts` → 3 files / 16 tests passed.
  - `npm test -- src/shared/appMeta.test.ts` → 1 file / 1 test passed.
  - `npm run build` → passed.
  - `git diff --check` → passed.
  - `npm run harness:check` → passed.

## 2026-06-11 P3 Task 3 Review Follow-up

- Hardened eval candidate UI rejection handling after code review:
  - Eval review accept/reject/promote mutations recover from rejected preload calls with an error status.
  - Runs eval-candidate generation recovers from rejected preload calls with an error status.
  - Overview pending eval candidate loading falls back to `[]` without failing the whole dashboard.
- Changed files:
  - `src/renderer/components/EvalReviewPanel.tsx`
  - `src/renderer/components/RunsPanel.tsx`
  - `src/renderer/components/OverviewPanel.tsx`
  - `src/renderer/materialDesign.test.ts`
- TDD and verification evidence:
  - `npm test -- src/renderer/materialDesign.test.ts` → RED, 3 expected failures for missing mutation catches, missing Runs generation catch, and missing Overview eval fallback.
  - `npm test -- src/renderer/materialDesign.test.ts` → 1 file / 14 tests passed.
  - `npm test -- src/renderer/materialDesign.test.ts src/shared/navigation.test.ts src/shared/materialNavigation.test.ts src/shared/appMeta.test.ts` → 4 files / 20 tests passed.
  - `npx tsc -p tsconfig.renderer.json --noEmit` → passed.
  - `git diff --check` → passed.
  - `npm run harness:check` → passed.

## 2026-06-11 P3 Agent Learning Harness Loop - Worker 4

- Implemented Task 4 scope: local promoted eval fixtures are combined with built-in agent eval fixtures for desktop reports, `run-agent-evals`, and harness scoring.
- Changed files:
  - `src/main/eval/agentPromotedEvalFixtures.ts`
  - `src/main/eval/agentPromotedEvalFixtures.test.ts`
  - `src/main/main.ts`
  - `scripts/run-agent-evals.mjs`
  - `scripts/run-harness-score.mjs`
- TDD and verification evidence:
  - `npm test -- src/main/eval/agentPromotedEvalFixtures.test.ts` -> RED, missing `createCombinedAgentEvalFixtures`.
  - `npm test -- src/main/eval/agentPromotedEvalFixtures.test.ts` -> 1 file / 3 tests passed.
  - `npm test -- src/main/eval/agentPromotedEvalFixtures.test.ts src/main/eval/agentEvalRunner.test.ts` -> 2 files / 8 tests passed.
  - `npm run build` -> passed.
  - `node scripts/run-agent-evals.mjs` -> agent eval 11/11.
  - `BUILDING_AGENT_CONFIG_DIR=<tmp> node scripts/run-agent-evals.mjs` -> promoted fixture loaded, agent eval 12/12.
  - `npm run harness:score` -> score 9.31/10, agent eval 11/11, promoted fixture count 0, pending eval candidates 0.
  - `BUILDING_AGENT_CONFIG_DIR=<tmp> node scripts/run-harness-score.mjs` -> promoted fixture count 1, pending eval candidates 1, agent eval 12/12.
  - `git diff --check` -> passed.
  - `npm run harness:check` -> passed.
  - `npm run verify` -> 91 Vitest files / 411 tests, agent eval 11/11, memory eval 2/2.

## 2026-06-11 P3 Agent Learning Harness Loop - Worker 5

- Implemented Task 5 scope: adversarial eval mutation helper, adversarial eval runner, and harness score integration.
- Changed files:
  - `src/main/eval/agentEvalAdversary.ts`
  - `src/main/eval/agentEvalAdversary.test.ts`
  - `scripts/run-harness-score.mjs`
  - `.zerox/progress.md`
- TDD and verification evidence:
  - `npm test -- src/main/eval/agentEvalAdversary.test.ts` -> RED, missing `agentEvalAdversary` module.
  - `npm test -- src/main/eval/agentEvalAdversary.test.ts` -> RED, harness score script missing adversarial wiring.
  - `npm test -- src/main/eval/agentEvalAdversary.test.ts` -> 1 file / 4 tests passed.
  - `npm test -- src/main/eval/agentEvalAdversary.test.ts src/main/eval/agentEvalRunner.test.ts` -> 2 files / 9 tests passed.
  - `npm run build` -> passed.
  - `npm run harness:score` -> score 9.31/10, agent eval 11/11, adversarial passed true with 23 checked and 0 escaped.
  - `npm run verify` -> 92 Vitest files / 415 tests, agent eval 11/11, memory eval 2/2.
  - `npm run harness:check` -> passed.

## 2026-06-11 P3 Agent Learning Harness Loop - Worker 6

- Implemented Task 6 scope: Tool ACI policy sensor, deterministic agent context profiles, and informational harness score ACI output.
- Changed files:
  - `src/shared/toolAciPolicy.ts`
  - `src/shared/toolAciPolicy.test.ts`
  - `src/shared/agentContextProfile.ts`
  - `src/shared/agentContextProfile.test.ts`
  - `scripts/run-harness-score.mjs`
  - `.zerox/progress.md`
- TDD and verification evidence:
  - `npm test -- src/shared/toolAciPolicy.test.ts src/shared/agentContextProfile.test.ts` -> RED, missing `toolAciPolicy` and `agentContextProfile` modules.
  - `node scripts/run-harness-score.mjs | node -e <aci assertion>` -> RED, missing top-level `aci` report before harness wiring.
  - `npm test -- src/shared/toolAciPolicy.test.ts src/shared/agentContextProfile.test.ts` -> 2 files / 6 tests passed.
  - `npm run build` -> passed.
  - `npm run harness:score` -> score 9.31/10, agent eval 11/11, adversarial passed true, ACI passed true with 0 findings.
  - `git diff --check` -> passed.
  - `npm run harness:check` -> passed.
  - `npm run verify` -> 94 Vitest files / 421 tests, agent eval 11/11, memory eval 2/2.

## 2026-06-11 P3 Agent Learning Harness Loop - Worker 7

- Implemented Task 7 scope: documented the eval candidate loop, updated README testing and roadmap sections in English and Chinese, marked the P3 feature done, and recorded final verification evidence.
- Changed files:
  - `docs/architecture/agent-learning-loop.md`
  - `README.md`
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`
- Verification evidence:
  - `npm run harness:check` -> passed.
  - `npm run verify` -> 94 Vitest files / 425 tests, build passed, agent eval 11/11, memory eval 2/2.
  - `npm run harness:score` -> score 9.31/10, ACI passed true with 0 findings, agent eval 11/11, adversarial passed true with 23 checked and 0 escaped, promoted fixture count 0, pending eval candidates 0.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - `git diff --check` -> passed.
