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

## 2026-06-11 P4.1 Dynamic MCP and Skill Tool Authorization

- Implemented the first P4 runtime-core slice: dynamic skill and MCP tools can be authorized through explicit task policy tool names or registered tool sources instead of failing the closed built-in tool switch.
- Changed files:
  - `src/shared/toolPermissions.ts`
  - `src/shared/toolPermissions.test.ts`
  - `src/main/dynamicToolRegistry.ts`
  - `src/main/dynamicToolRegistry.test.ts`
  - `src/main/agentLoop.ts`
  - `src/main/agentLoop.test.ts`
  - `src/main/agentRuntimeEngine.ts`
  - `src/main/agentRuntimeEngine.test.ts`
  - `src/main/main.ts`
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`
- TDD and verification evidence:
  - `npm test -- src/shared/toolPermissions.test.ts` -> RED, 3 expected failures for missing dynamic tool policy seeding and authorization.
  - `npm test -- src/shared/toolPermissions.test.ts` -> 1 file / 22 tests passed.
  - `npm test -- src/main/dynamicToolRegistry.test.ts src/main/agentLoop.test.ts` -> RED, missing registry source lookup and source forwarding.
  - `npm test -- src/main/dynamicToolRegistry.test.ts src/main/agentLoop.test.ts src/shared/toolPermissions.test.ts` -> 3 files / 31 tests passed.
  - `npm test -- src/main/agentRuntimeEngine.test.ts` -> RED, runtime authorization did not receive dynamic tool source.
  - `npm test -- src/main/agentRuntimeEngine.test.ts src/main/dynamicToolRegistry.test.ts src/main/agentLoop.test.ts src/shared/toolPermissions.test.ts` -> 4 files / 47 tests passed.
  - `npm test -- src/shared/toolPermissions.test.ts src/main/dynamicToolRegistry.test.ts src/main/agentLoop.test.ts src/main/agentRuntimeEngine.test.ts src/main/toolAuthorizationService.test.ts src/main/agentToolExecutor.test.ts` -> 6 files / 71 tests passed.
  - `npm run build` -> passed.
  - `npm run harness:check` -> passed.
  - `node -e "JSON.parse(require('fs').readFileSync('.zerox/feature_list.json','utf8')); console.log('feature_list json ok')"` -> feature_list json ok.
  - `npm run verify` -> 94 Vitest files / 436 tests, build passed, agent eval 11/11, memory eval 2/2.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - `git diff --check` -> passed.

## 2026-06-11 P4.2 Runtime Tool Failure Observation Recovery

- Implemented the second P4 runtime-core slice: recoverable tool execution failures now remain in the model conversation as failed tool observations, with reflection evidence recorded before the model retries or finalizes.
- Changed files:
  - `src/main/agentRuntimeEngine.ts`
  - `src/main/agentRuntimeEngine.test.ts`
  - `src/main/eval/agentEvalFixtures.ts`
  - `src/main/eval/agentEvalRunner.test.ts`
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`
- TDD and verification evidence:
  - `npm test -- src/main/agentRuntimeEngine.test.ts` -> RED, recoverable `file_read` failure still failed the run before the model could retry.
  - `npm test -- src/main/agentRuntimeEngine.test.ts` -> 1 file / 17 tests passed.
  - `npm test -- src/main/eval/agentEvalRunner.test.ts` -> RED, `reflection-after-test-failure` fixture still required `failure_classified` instead of recovered `final_summary`.
  - `npm test -- src/main/agentRuntimeEngine.test.ts src/main/eval/agentEvalRunner.test.ts` -> 2 files / 22 tests passed.
  - `npm test -- src/main/agentRuntimeEngine.test.ts src/main/eval/agentEvalRunner.test.ts src/main/eval/agentEvalAdversary.test.ts` -> 3 files / 26 tests passed.
  - `node scripts/run-agent-evals.mjs` -> agent eval 11/11.
  - `npm run build` -> passed.
  - `npm run verify` -> 94 Vitest files / 437 tests, build passed, agent eval 11/11, memory eval 2/2.
  - `npm run harness:check` -> passed.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - `git diff --check` -> passed.

## 2026-06-12 P4.3 Runtime Retry Budget and Duplicate Retry Visibility

- Implemented the third P4 runtime-core slice: repeated recovery failures now terminate with structured reflection metadata visible on the failure_classified trajectory event.
- Changed files:
  - `src/main/agentRuntimeEngine.ts`
  - `src/main/agentRuntimeEngine.test.ts`
  - `src/main/eval/agentEvalFixtures.ts`
  - `src/main/eval/agentEvalRunner.test.ts`
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`
- TDD and verification evidence:
  - `npm test -- src/main/agentRuntimeEngine.test.ts` -> RED, duplicate retry and retry-budget failure messages lacked reflection failure class visibility.
  - `npm test -- src/main/agentRuntimeEngine.test.ts` -> 1 file / 19 tests passed.
  - `npm test -- src/main/eval/agentEvalRunner.test.ts` -> RED, `reflection-retry-budget-exhausted` fixture was missing from deterministic evals.
  - `npm test -- src/main/eval/agentEvalRunner.test.ts` -> 1 file / 5 tests passed.
  - `npm test -- src/shared/agentReflection.test.ts src/main/agentRuntimeEngine.test.ts src/main/eval/agentEvalRunner.test.ts src/main/eval/agentEvalAdversary.test.ts src/main/agentEvalCandidateGenerator.test.ts src/main/agentLearningExtractor.test.ts` -> 6 files / 36 tests passed.
  - `node scripts/run-agent-evals.mjs` -> agent eval 12/12.
  - `npm run build` -> passed.
  - `npm run verify` -> 94 Vitest files / 439 tests, build passed, agent eval 12/12, memory eval 2/2.
  - `npm run harness:check` -> passed.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - `node -e "JSON.parse(require('fs').readFileSync('.zerox/feature_list.json','utf8')); console.log('feature_list json ok')"` -> feature_list json ok.
  - `git diff --check` -> passed.

## 2026-06-12 P4.4 Active-loop Context Compaction

- Implemented the fourth P4 runtime-core slice: both active agent loops compact oversized message histories before model requests, and recoverable runtime runs emit `context_compacted` trajectory evidence.
- Changed files:
  - `src/main/contextManager.test.ts`
  - `src/main/agentLoop.ts`
  - `src/main/agentLoop.test.ts`
  - `src/main/agentRuntimeEngine.ts`
  - `src/main/agentRuntimeEngine.test.ts`
  - `src/main/eval/agentEvalFixtures.ts`
  - `src/main/eval/agentEvalRunner.test.ts`
  - `src/shared/agentTrajectory.ts`
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`
- TDD and verification evidence:
  - `npm test -- src/main/contextManager.test.ts src/main/agentLoop.test.ts src/main/agentRuntimeEngine.test.ts` -> RED, active loops sent uncompressed histories to the model.
  - `npm test -- src/main/contextManager.test.ts src/main/agentLoop.test.ts src/main/agentRuntimeEngine.test.ts` -> 3 files / 28 tests passed.
  - `npm test -- src/main/eval/agentEvalRunner.test.ts` -> RED, `context-compaction-before-model-request` fixture was missing from deterministic evals.
  - `npm test -- src/main/eval/agentEvalRunner.test.ts` -> 1 file / 5 tests passed.
  - `npm test -- src/main/contextManager.test.ts src/main/agentLoop.test.ts src/main/agentRuntimeEngine.test.ts src/main/eval/agentEvalRunner.test.ts src/main/agentEvalCandidateGenerator.test.ts src/main/agentEpisodeExporter.test.ts src/main/chatService.test.ts src/renderer/materialDesign.test.ts` -> 8 files / 63 tests passed.
  - `npm run build` -> passed.
  - `node scripts/run-agent-evals.mjs` -> agent eval 13/13.
  - `npm run verify` -> 95 Vitest files / 442 tests, build passed, agent eval 13/13, memory eval 2/2.
  - `npm run harness:check` -> passed.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - `node -e "JSON.parse(require('fs').readFileSync('.zerox/feature_list.json','utf8')); console.log('feature_list json ok')"` -> feature_list json ok.
  - `git diff --check` -> passed.

## 2026-06-12 P4.5 Tool-call Checkpoint Granularity

- Implemented the fifth P4 runtime-core slice: recoverable runtime checkpoints are now written after each executed tool observation, not only after the whole model turn finishes.
- Changed files:
  - `src/main/agentRuntimeEngine.ts`
  - `src/main/agentRuntimeEngine.test.ts`
  - `src/main/eval/agentEvalFixtures.ts`
  - `src/main/eval/agentEvalRunner.test.ts`
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`
- TDD and verification evidence:
  - `npm test -- src/main/agentRuntimeEngine.test.ts` -> RED, a same-turn two-tool response only wrote a single post-turn checkpoint with both tool observations.
  - `npm test -- src/main/agentRuntimeEngine.test.ts` -> 1 file / 21 tests passed.
  - `npm test -- src/main/eval/agentEvalRunner.test.ts` -> RED, `tool-result-checkpoint-before-next-tool` fixture was missing from deterministic evals.
  - `npm test -- src/main/eval/agentEvalRunner.test.ts` -> 1 file / 5 tests passed.
  - `npm test -- src/main/agentRuntimeEngine.test.ts src/main/eval/agentEvalRunner.test.ts src/main/agentEvalCandidateGenerator.test.ts src/main/agentEpisodeExporter.test.ts src/main/agentTrajectoryStore.test.ts` -> 5 files / 31 tests passed.
  - `npm run build` -> passed.
  - `node scripts/run-agent-evals.mjs` -> agent eval 14/14.
  - `npm run verify` -> 95 Vitest files / 443 tests, build passed, agent eval 14/14, memory eval 2/2.
  - `npm run harness:check` -> passed.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - `node -e "JSON.parse(require('fs').readFileSync('.zerox/feature_list.json','utf8')); console.log('feature_list json ok')"` -> feature_list json ok.
  - `git diff --check` -> passed.

## 2026-06-12 P4.6 Active-loop Model Request Retry

- Implemented the sixth P4 runtime-core slice: active chat and recoverable runtime model calls now retry transient model failures, and runtime retries are visible in trajectory evidence.
- Changed files:
  - `src/main/modelRetry.ts`
  - `src/main/agentLoop.ts`
  - `src/main/agentLoop.test.ts`
  - `src/main/agentRuntimeEngine.ts`
  - `src/main/agentRuntimeEngine.test.ts`
  - `src/main/eval/agentEvalFixtures.ts`
  - `src/main/eval/agentEvalRunner.test.ts`
  - `src/shared/agentTrajectory.ts`
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`
- TDD and verification evidence:
  - `npm test -- src/main/agentLoop.test.ts src/main/agentRuntimeEngine.test.ts` -> RED, transient model 500 failures failed active loops without retry.
  - `npm test -- src/main/agentLoop.test.ts src/main/agentRuntimeEngine.test.ts` -> 2 files / 30 tests passed.
  - `npm test -- src/main/eval/agentEvalRunner.test.ts` -> RED, `model-retry-before-response` fixture was missing from deterministic evals.
  - `npm test -- src/main/eval/agentEvalRunner.test.ts` -> 1 file / 5 tests passed.
  - `npm test -- src/main/agentLoop.test.ts src/main/agentRuntimeEngine.test.ts src/main/eval/agentEvalRunner.test.ts src/main/chatService.test.ts src/main/agentFailureClassifier.test.ts` -> 5 files / 53 tests passed.
  - `npm run build` -> passed.
  - `node scripts/run-agent-evals.mjs` -> agent eval 15/15.
  - `npm run verify` -> 95 Vitest files / 445 tests, build passed, agent eval 15/15, memory eval 2/2.
  - `npm run harness:check` -> passed.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - `node -e "JSON.parse(require('fs').readFileSync('.zerox/feature_list.json','utf8')); console.log('feature_list json ok')"` -> feature_list json ok.
  - `git diff --check` -> passed.

## 2026-06-12 P4.7 Runtime Trajectory Insights UI

- Implemented the seventh P4 runtime-core slice: recovery, model retry, and context compaction trajectory events now have compact user-facing insight cards in the Runs trajectory inspector.
- Changed files:
  - `src/shared/agentTrajectoryInsights.ts`
  - `src/shared/agentTrajectoryInsights.test.ts`
  - `src/renderer/components/RunTrajectoryPanel.tsx`
  - `src/renderer/materialDesign.test.ts`
  - `src/renderer/styles.css`
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`
- TDD and verification evidence:
  - `npm test -- src/shared/agentTrajectoryInsights.test.ts src/renderer/materialDesign.test.ts` -> RED, missing trajectory insight summarizer and UI classes.
  - `npm test -- src/shared/agentTrajectoryInsights.test.ts src/renderer/materialDesign.test.ts` -> 2 files / 17 tests passed.
  - `npm test -- src/shared/agentTrajectoryInsights.test.ts src/renderer/materialDesign.test.ts src/shared/agentHandoff.test.ts src/main/agentRuntimeEngine.test.ts` -> 4 files / 44 tests passed.
  - `npm run build` -> passed.
  - `npm run verify` -> 96 Vitest files / 448 tests, build passed, agent eval 15/15, memory eval 2/2.
  - `npm run harness:check` -> passed.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - `node -e "JSON.parse(require('fs').readFileSync('.zerox/feature_list.json','utf8')); console.log('feature_list json ok')"` -> feature_list json ok.
  - `git diff --check` -> passed.

## 2026-06-12 v1.6.0 Runtime Core Upgrade Release Acceptance

- Accepted the P4 runtime-core iteration and prepared v1.6.0 for release.
- Release documentation/version updates:
  - `package.json` and `package-lock.json` bumped to `1.6.0`.
  - `README.md` now documents the v1.6.0 runtime-core upgrade, current verification counts, Quick Start `./init.sh` / `AGENTS.md` flow, and v1.6.0 macOS artifact names.
  - `src/shared/readme.test.ts` now asserts the v1.6.0 quarantine example.
- Final verification and packaging evidence:
  - `npm run verify` -> 96 Vitest files / 448 tests passed, build passed, agent eval 15/15, memory eval 2/2.
  - `npm run harness:check` -> Harness check passed.
  - `npm run harness:score` -> overall 9.20, eval 15/15, ACI passed, context passed, adversarial checked 34 with no escapes.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - `npm run dist:mac` -> generated `release/Zerox Agent-1.6.0-arm64.dmg` and `release/Zerox Agent-1.6.0-arm64-mac.zip`.
  - `node -e "JSON.parse(require('fs').readFileSync('.zerox/feature_list.json','utf8')); console.log('feature_list.json ok')"` -> feature_list.json ok.
  - `git diff --check` -> passed.

## 2026-06-12 Goal Mode A1 Bounded Autonomy Contract

- Started the Goal Mode planning iteration from `/tmp/codex-remote-attachments/019ebab7-245f-73c3-9e29-c28c45571dae/779C0DB6-83A3-4C16-8D42-FF5118163FE1/1-2026-06-12-agent-goal-mode.md`.
- `.zerox/feature_list.json` had no unfinished entries, so this round selected exactly one unfinished slice from the attached plan: A1 Encode Bounded Autonomy.
- Encoded the product boundary before runtime implementation: autonomous goal runs must be budgeted, inspectable, interruptible, recoverable, evidence-backed, and review-gated.
- Changed files:
  - `docs/product/zerox-positioning.md`
  - `README.md`
  - `src/shared/readme.test.ts`
  - `.zerox/progress.md`
- TDD and verification evidence:
  - `./init.sh` -> harness check passed; `src/shared/packageScripts.test.ts` 1 file / 5 tests passed.
  - `npm test -- src/shared/readme.test.ts` -> RED, missing `Autonomous goal run` positioning contract.
  - `npm test -- src/shared/readme.test.ts` -> 1 file / 2 tests passed.
  - `npm run harness:check` -> passed.
  - `npm run verify` -> 96 Vitest files / 448 tests passed, build passed, agent eval 15/15, memory eval 2/2.
  - `npm run harness:check` after progress update -> passed.
  - `git diff --check` -> passed.
  - `npm test` after progress update -> 96 Vitest files / 448 tests passed.
  - `npm run smoke:prod` not run because this slice changed docs and a docs contract test only, with no UI/runtime behavior change.

## 2026-06-12 Goal Mode P5.0 CI Workflow

- Implemented the Goal Mode prerequisite CI gate before starting P5.1 domain model work.
- Added a GitHub Actions workflow that runs deterministic local checks on pull requests and pushes to `main`: `npm ci`, `npm run verify`, and `npm run harness:check`.
- Kept display-dependent Electron smoke commands out of CI; `npm run verify` remains test/build/deterministic eval only.
- Changed files:
  - `.github/workflows/verify.yml`
  - `src/shared/ciWorkflow.test.ts`
  - `.zerox/progress.md`
- TDD and verification evidence:
  - `npm test -- src/shared/ciWorkflow.test.ts` -> RED, missing `.github/workflows/verify.yml`.
  - `npm test -- src/shared/ciWorkflow.test.ts` -> 1 file / 2 tests passed.
  - `npm run verify` -> 97 Vitest files / 450 tests passed, build passed, agent eval 15/15, memory eval 2/2.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.
  - `npm run smoke:prod` not run because this slice changed CI configuration and a CI contract test only, with no UI/runtime behavior change.

## 2026-06-12 Goal Mode P5.1 Domain Model

- Added the bounded Goal Mode shared domain model, review policy type, goal status state machine, and deterministic draft validation helpers.
- Linked recoverable runtime checkpoints back to optional goal and milestone provenance without changing runtime behavior.
- Changed files:
  - `src/shared/agentGoal.ts`
  - `src/shared/agentGoalReview.ts`
  - `src/shared/agentGoal.test.ts`
  - `src/shared/agentExecution.ts`
  - `src/shared/agentExecution.test.ts`
  - `.zerox/progress.md`
- TDD and verification evidence:
  - `npm test -- src/shared/agentGoal.test.ts src/shared/agentExecution.test.ts` -> RED, missing `./agentGoal` module.
  - `npm test -- src/shared/agentGoal.test.ts src/shared/agentExecution.test.ts` -> 2 files / 8 tests passed.
  - `npm run verify` -> 98 Vitest files / 454 tests passed, build passed, agent eval 15/15, memory eval 2/2.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.
  - `npm run smoke:prod` not run because this slice changed shared types/tests only, with no UI/runtime behavior change.

## 2026-06-12 Goal Mode P5.2 Persistence And Progress Ledger

- Added a local-first goal store under `agent-goals/{goalId}.json` and append-only progress ledgers under `agent-goals/{goalId}.ledger.jsonl`.
- Covered active-goal reload after restart, status/budget/milestone updates, terminal-status filtering, missing directory behavior, and ledger append/read ordering.
- Changed files:
  - `src/main/agentGoalStore.ts`
  - `src/main/agentGoalStore.test.ts`
  - `.zerox/progress.md`
- TDD and verification evidence:
  - `npm test -- src/main/agentGoalStore.test.ts` -> RED, missing `./agentGoalStore` module.
  - `npm test -- src/main/agentGoalStore.test.ts` -> 1 file / 7 tests passed.
  - `npm run verify` -> 99 Vitest files / 461 tests passed, build passed, agent eval 15/15, memory eval 2/2.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.
  - `npm run smoke:prod` not run because this slice changed main-process persistence code and tests only, with no UI/runtime-affecting behavior wired yet.

## 2026-06-12 Goal Mode P5.3 Planner

- Added an injected-model goal planner that decomposes natural-language goals into acceptance-bearing milestones without real model calls in tests.
- Reused P5.1 draft validation, added deterministic dependency-cycle rejection, one repair re-prompt for invalid plans, and replan behavior that preserves accepted milestones while incrementing `planVersion` and `budgetUsage.replans`.
- Changed files:
  - `src/main/agentGoalPlanner.ts`
  - `src/main/agentGoalPlanner.test.ts`
  - `.zerox/progress.md`
- TDD and verification evidence:
  - `npm test -- src/main/agentGoalPlanner.test.ts` -> RED, missing `./agentGoalPlanner` module.
  - `npm test -- src/main/agentGoalPlanner.test.ts` -> 1 file / 4 tests passed.
  - `npm run verify` -> 100 Vitest files / 465 tests passed, build passed, agent eval 15/15, memory eval 2/2.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.
  - `npm run smoke:prod` not run because this slice changed planner code and tests only, with no UI/runtime-affecting behavior wired yet.

## 2026-06-12 Goal Mode P5.4 Acceptance Engine

- Added a deterministic-first acceptance engine for milestone and goal-level success criteria.
- Covered `file_exists`, `command_exit_code`, `test_passes`, structured artifact `assertion`, model-review evidence gating, deterministic-before-inferential ordering, and `acceptance_checked` trajectory evidence.
- Changed files:
  - `src/main/agentGoalAcceptance.ts`
  - `src/main/agentGoalAcceptance.test.ts`
  - `src/shared/agentTrajectory.ts`
  - `.zerox/progress.md`
- TDD and verification evidence:
  - `npm test -- src/main/agentGoalAcceptance.test.ts` -> RED, missing `./agentGoalAcceptance` module.
  - `npm test -- src/main/agentGoalAcceptance.test.ts` -> 1 file / 7 tests passed.
  - `npm run verify` -> 101 Vitest files / 472 tests passed, build passed, agent eval 15/15, memory eval 2/2.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.
  - `npm run smoke:prod` not run because this slice changed main-process acceptance code and shared trajectory types only, with no UI/runtime-affecting behavior wired yet.

## 2026-06-12 Goal Mode P5.5 Bounded Orchestration Loop

- Added the bounded autonomous goal controller with injected runtime, planner, acceptance, goal store, and trajectory store dependencies.
- Covered goal acceptance, budget stop-before-next-dispatch, stalled-goal stop, rejection-driven replan, review-gate suspension/resolution, accepted-milestone resume idempotence, and per-milestone goal checkpoint trajectory evidence.
- Added goal-level trajectory event kinds: `goal_planned`, `milestone_started`, `goal_replanned`, `goal_review_requested`, and `goal_stopped`.
- Changed files:
  - `src/main/agentGoalController.ts`
  - `src/main/agentGoalController.test.ts`
  - `src/shared/agentGoalReview.ts`
  - `src/shared/agentTrajectory.ts`
  - `.zerox/progress.md`
- TDD and verification evidence:
  - `npm test -- src/main/agentGoalController.test.ts src/main/agentRuntimeEngine.test.ts` -> RED, missing `./agentGoalController` module.
  - `npm test -- src/main/agentGoalController.test.ts src/main/agentRuntimeEngine.test.ts` -> 2 files / 28 tests passed.
  - `npm run verify` -> 102 Vitest files / 478 tests passed, build passed, agent eval 15/15, memory eval 2/2.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.

## 2026-06-12 Goal Mode P5.6 Goal-aware Context Compaction

- Added a goal context assembler that preserves never-compact goal anchors: goal description, success criteria, latest progress ledger summary, accepted milestone conclusions, and evidence refs.
- Summarizes accepted milestones while keeping running/pending milestone detail, preserves offloaded tool-result refs as context anchors, and emits `context_compacted` trajectory evidence when compaction occurs.
- Changed files:
  - `src/main/agentGoalContext.ts`
  - `src/main/agentGoalContext.test.ts`
  - `src/main/contextManager.ts`
  - `.zerox/progress.md`
- TDD and verification evidence:
  - `npm test -- src/main/agentGoalContext.test.ts src/main/contextManager.test.ts` -> RED, missing `./agentGoalContext` module.
  - `npm test -- src/main/agentGoalContext.test.ts src/main/contextManager.test.ts` -> RED, offloaded tool-result ref was compacted away by generic history compression.
  - `npm test -- src/main/agentGoalContext.test.ts src/main/contextManager.test.ts` -> 2 files / 5 tests passed.
  - `npm run verify` -> 103 Vitest files / 482 tests passed, build passed, agent eval 15/15, memory eval 2/2.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.
  - `npm run smoke:prod` not run because this slice added an unwired goal context helper and token estimation export only.

## 2026-06-12 Goal Mode P5.7 Review Gates And UI

- Added review-policy evaluation for per-milestone, key milestone, final-only, and high-risk review gates.
- Wired local-first Goal Mode IPC into the main process and preload API for create/start/resume/cancel/list/resolve-review operations backed by `agentGoalStore`.
- Added the Goals navigation section, Overview alerting for goals waiting on review, and a Goal Mode panel with bounded budget inputs, active goal list, milestone tree, and approve/modify/terminate review-gate controls.
- Changed files:
  - `src/shared/agentGoalReview.ts`
  - `src/shared/agentGoalReview.test.ts`
  - `src/main/main.ts`
  - `src/preload/index.ts`
  - `src/shared/navigation.ts`
  - `src/shared/navigation.test.ts`
  - `src/shared/materialNavigation.ts`
  - `src/renderer/App.tsx`
  - `src/renderer/components/GoalPanel.tsx`
  - `src/renderer/components/OverviewPanel.tsx`
  - `src/renderer/materialDesign.test.ts`
  - `src/renderer/styles.css`
- TDD and verification evidence:
  - `npm test -- src/shared/agentGoalReview.test.ts src/renderer/materialDesign.test.ts src/shared/navigation.test.ts src/shared/materialNavigation.test.ts` -> RED, missing `shouldRequestReview`, missing `GoalPanel`, and missing Goals navigation.
  - `npm test -- src/shared/agentGoalReview.test.ts src/renderer/materialDesign.test.ts src/shared/navigation.test.ts src/shared/materialNavigation.test.ts` -> 4 files / 25 tests passed.
  - `npm run verify` -> 104 Vitest files / 487 tests passed, build passed, agent eval 15/15, memory eval 2/2.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - `BUILDING_AGENT_SMOKE=1 BUILDING_AGENT_SMOKE_READY_SELECTOR='.goal-panel' BUILDING_AGENT_SMOKE_REQUIRED_TEXTS='Goal Mode|有边界自治目标|创建目标|审核策略' ELECTRON_RENDERER_URL='http://127.0.0.1:5173/#goals' ./node_modules/.bin/electron .` -> passed.
  - `BUILDING_AGENT_SMOKE=1 BUILDING_AGENT_SMOKE_READY_SELECTOR='.goal-panel' BUILDING_AGENT_SMOKE_REQUIRED_TEXTS='Goal Mode|有边界自治目标|创建目标|审核策略' BUILDING_AGENT_SMOKE_VIEWPORT='390x844' ELECTRON_RENDERER_URL='http://127.0.0.1:5173/#goals' ./node_modules/.bin/electron .` -> passed.

## 2026-06-12 Goal Mode P5.8 Eval, Harness, And Docs

- Added six deterministic Goal Mode eval fixtures covering achieved-within-budget, budget stop-before-dispatch, stall detection, replan on acceptance failure, review-gate blocking, and compaction anchor retention.
- Extended adversarial eval generation with goal-specific budget tampering and removed acceptance-check mutations.
- Integrated goal-mode pass rate and fixture count into `npm run harness:score`; latest score was 9.20 with goal 6/6 and adversarial 59/59 rejected.
- Added `docs/architecture/agent-goal-mode.md`, updated README testing/roadmap language, and added P5.* done entries to `.zerox/feature_list.json`.
- Fixed the Goal controller to consume the shared review policy matrix, so `review_final_only` pauses after the final accepted milestone before goal-level acceptance.
- Changed files:
  - `src/main/agentGoalController.ts`
  - `src/main/agentGoalController.test.ts`
  - `src/main/eval/agentEvalFixtures.ts`
  - `src/main/eval/agentEvalRunner.test.ts`
  - `src/main/eval/agentEvalAdversary.ts`
  - `src/main/eval/agentEvalAdversary.test.ts`
  - `src/shared/harnessScore.ts`
  - `src/shared/harnessScore.test.ts`
  - `scripts/run-harness-score.mjs`
  - `docs/architecture/agent-goal-mode.md`
  - `README.md`
  - `src/shared/readme.test.ts`
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`
- TDD and verification evidence:
  - `./init.sh` -> harness check passed; `src/shared/packageScripts.test.ts` 1 file / 5 tests passed.
  - `npm test -- src/main/agentGoalController.test.ts src/main/eval/agentEvalRunner.test.ts src/main/eval/agentEvalAdversary.test.ts src/shared/harnessScore.test.ts src/shared/readme.test.ts` -> RED, missing goal fixtures, goal adversary mutations, harness goal pass-rate summary, architecture doc/feature-list entry, and shared review-policy use in the controller.
  - `npm test -- src/main/agentGoalController.test.ts src/main/eval/agentEvalRunner.test.ts src/main/eval/agentEvalAdversary.test.ts src/shared/harnessScore.test.ts src/shared/readme.test.ts` -> 5 files / 24 tests passed.
  - `npm run verify` -> 104 Vitest files / 492 tests passed, build passed, agent eval 21/21, memory eval 2/2.
  - `node scripts/run-agent-evals.mjs` -> 21/21 passed.
  - `npm run harness:check` -> passed.
  - `node -e "JSON.parse(require('fs').readFileSync('.zerox/feature_list.json','utf8')); console.log('feature_list.json ok')"` -> feature_list.json ok.
  - `git diff --check` -> passed.
  - `npm run harness:score` -> overall 9.20, goal 6/6, adversarial 59 checked with no escapes.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.

## 2026-06-12 v1.7.0 Release Prep

- Bumped package metadata from `1.6.0` to `1.7.0`.
- Updated README release language, install quarantine examples, roadmap current version, and README coverage assertions for the Goal Mode foundation release.
- Built macOS release artifacts for GitHub Release upload:
  - `release/Zerox.Agent-1.7.0-arm64.dmg`
  - `release/Zerox.Agent-1.7.0-arm64-mac.zip`
- Changed files:
  - `README.md`
  - `package.json`
  - `package-lock.json`
  - `src/shared/readme.test.ts`
  - `.zerox/progress.md`
- Verification evidence:
  - `npm test -- src/shared/readme.test.ts src/shared/packageScripts.test.ts` -> 2 files / 8 tests passed.
  - `npm run verify` -> 104 Vitest files / 492 tests passed, build passed, agent eval 21/21, memory eval 2/2.
  - `npm run dist:mac` -> generated macOS DMG and ZIP artifacts for `1.7.0`.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.

## 2026-06-12 P6 Chat Session Native Goal Mode

- Reworked Goal Mode from a standalone page into a chat-session-native flow: chat sessions now persist active/historical goal linkage, Chat renders an active Goal Contract Bar, session badges, inline review gates, and an on-demand goal detail drawer.
- Collapsed low-frequency technical surfaces into Settings secondary sections and removed standalone Goals from the primary navigation; legacy `#goals` resolves to Chat.
- Added conservative chat goal intent routing for explicit goal creation, continuation, cancellation, and review modification, wired through `GoalChatService` and `AgentGoalController`.
- Removed the standalone `GoalPanel` route/file and changed Overview waiting-review attention items to open Chat.
- Updated README, `docs/architecture/agent-goal-mode.md`, and `.zerox/feature_list.json` with the P6 session-native Goal Mode status.
- Changed files:
  - `src/shared/chat.ts`
  - `src/main/chatSessionStore.ts`
  - `src/main/chatSessionStore.test.ts`
  - `src/shared/agentGoal.ts`
  - `src/main/agentGoalStore.ts`
  - `src/main/agentGoalStore.test.ts`
  - `src/shared/navigation.ts`
  - `src/shared/navigation.test.ts`
  - `src/renderer/App.tsx`
  - `src/renderer/components/AgentChatPanel.tsx`
  - `src/renderer/components/GoalContractBar.tsx`
  - `src/renderer/components/GoalDetailDrawer.tsx`
  - `src/renderer/components/OverviewPanel.tsx`
  - `src/renderer/components/GoalPanel.tsx`
  - `src/main/chatService.ts`
  - `src/main/chatService.test.ts`
  - `src/main/goalChatService.ts`
  - `src/main/goalChatService.test.ts`
  - `src/main/main.ts`
  - `src/renderer/materialDesign.test.ts`
  - `src/renderer/styles.css`
  - `README.md`
  - `docs/architecture/agent-goal-mode.md`
  - `src/shared/readme.test.ts`
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`
- TDD and verification evidence:
  - `./init.sh` -> harness check passed; `src/shared/packageScripts.test.ts` 1 file / 5 tests passed.
  - `npm test -- src/main/chatSessionStore.test.ts` -> RED, missing `attachGoal`/`clearActiveGoal`; then 1 file / 5 tests passed.
  - `npm test -- src/main/agentGoalStore.test.ts src/shared/agentGoal.test.ts` -> RED, missing `listByChatSession`; then 2 files / 12 tests passed.
  - `npm test -- src/shared/navigation.test.ts src/shared/materialNavigation.test.ts` -> 2 files / 6 tests passed.
  - `npm test -- src/renderer/materialDesign.test.ts src/shared/navigation.test.ts` -> 2 files / 23 tests passed after removing standalone Goals page.
  - `npm test -- src/main/chatService.test.ts` -> RED, goal intents fell through to ordinary chat; then 1 file / 16 tests passed.
  - `npm test -- src/main/goalChatService.test.ts src/main/agentGoalController.test.ts` -> RED, missing `goalChatService`; then 2 files / 10 tests passed.
  - `npm test -- src/shared/readme.test.ts` -> RED, docs still described standalone Goals UI; then 1 file / 3 tests passed.
  - `npm test -- src/main/chatService.test.ts src/main/chatSessionStore.test.ts src/main/agentGoalController.test.ts src/shared/navigation.test.ts src/renderer/materialDesign.test.ts src/shared/readme.test.ts` -> 6 files / 54 tests passed.
  - `npm run verify` -> 105 Vitest files / 503 tests passed, build passed, agent eval 21/21, memory eval 2/2.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.

## 2026-06-12 P6 Goal Slash Command Follow-up

- Added `/目标 ...` and `/goal ...` chat intent routing so slash-command input creates a session-native goal with the remaining user text as the goal description.
- Added chat goal pause routing: `暂停这个目标` / `暂停目标` now moves the active goal to `waiting_for_review`, records a `review_requested` ledger event, and keeps IPC `goal:pause` on the same `GoalChatService` path.
- Added a composer command menu that appears after typing `/` or pressing the composer command button, inserts `/目标 ` or wraps existing text as `/目标 <text>`, and keeps the goal command inside the chat flow instead of a standalone page.
- Reworked the composer command entry from a slash-looking icon to a Command-style icon, backed by a data-driven command list with Goal enabled and Tool/Permission entries reserved as disabled future commands.
- Hid the Goal Contract Bar pause action unless the active goal is executing, avoiding a planning-state pause control that cannot transition cleanly.
- Tuned composer icon buttons from 36px to 32px and raised the floating action group with a shared 14px right/bottom inset so the send circle aligns visually with the composer bottom-right corner.
- Corrected the composer toolbar semantics after review: the left input action is now "打开命令菜单" and no longer navigates to Tools/Settings; nested Settings routing remains available for Overview and other non-composer navigation.
- Fixed `#model-settings` startup routing so direct settings hashes resolve to Settings.
- Changed files:
  - `src/main/chatService.ts`
  - `src/main/chatService.test.ts`
  - `src/main/goalChatService.ts`
  - `src/main/goalChatService.test.ts`
  - `src/main/main.ts`
  - `src/shared/navigation.ts`
  - `src/shared/navigation.test.ts`
  - `src/renderer/App.tsx`
  - `src/renderer/components/AgentChatPanel.tsx`
  - `src/renderer/components/GoalContractBar.tsx`
  - `src/renderer/materialDesign.test.ts`
  - `src/renderer/styles.css`
  - `src/shared/readme.test.ts`
  - `README.md`
  - `package.json`
  - `package-lock.json`
  - `.zerox/progress.md`
- TDD and verification evidence:
  - `npm test -- src/main/chatService.test.ts src/main/goalChatService.test.ts src/renderer/materialDesign.test.ts` -> RED, missing slash goal command, chat pause route, slash menu, and updated composer button sizing; then 3 files / 40 tests passed.
  - `npm test -- src/shared/navigation.test.ts src/renderer/materialDesign.test.ts` -> RED, `#model-settings` fell back to Chat and chat utility routing did not sync the Settings subsection; then 2 files / 24 tests passed.
  - `npm test -- src/renderer/materialDesign.test.ts` -> RED, composer still contained `onNavigate("tools")` and the old "工具权限" contract; then 1 file / 19 tests passed after changing the button to an in-input command trigger.
  - `npm test -- src/renderer/materialDesign.test.ts` -> RED, composer still used a slash icon, a single hardcoded command, and fixed 10px offsets; then 1 file / 19 tests passed after the Command icon, data-driven command list, and shared 14px inset landed.
  - `npm test -- src/renderer/materialDesign.test.ts src/shared/navigation.test.ts src/main/chatService.test.ts src/main/goalChatService.test.ts` -> 4 files / 46 tests passed.
  - `npm run build` -> passed.
  - Browser check at `http://127.0.0.1:5173/#chat` -> composer action inset token is 14px, measured right/bottom insets are both 14px, send button is 32x32, Command icon renders as `⌘`, the command menu exposes Goal as the only enabled command with Tool/Permission disabled as reserved entries, and selecting Goal changes the input to `/目标 `.
  - Dev app HMR after the composer command-button change reported no new compile error; an existing duplicate-key console error remains from duplicated `flowchart-generator-skill` entries and is unrelated to this interaction.
  - `npm run verify` -> 105 Vitest files / 507 tests passed, build passed, agent eval 21/21, memory eval 2/2.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.

## 2026-06-12 v1.8.0 Release Prep

- Bumped package metadata from `1.7.0` to `1.8.0`.
- Updated README release language, quarantine examples, verification counts, and roadmap status for the session-native Goal Command release.
- Built macOS release artifacts for GitHub Release upload:
  - `release/Zerox.Agent-1.8.0-arm64.dmg`
  - `release/Zerox.Agent-1.8.0-arm64-mac.zip`
- Verification evidence:
  - `npm test -- src/shared/readme.test.ts` -> 1 file / 3 tests passed.
  - `npm run verify` -> 105 Vitest files / 507 tests passed, build passed, agent eval 21/21, memory eval 2/2.
  - `npm run harness:check` -> passed.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - `npm run dist:mac` -> generated macOS DMG and ZIP artifacts for `1.8.0`.
