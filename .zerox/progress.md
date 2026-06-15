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

## 2026-06-15 v2.1.0 release closeout

- Request:
  - Close out this iteration as version `2.1.0`.
- Implementation:
  - Bumped package metadata from `1.9.5` to `2.1.0` in `package.json` and `package-lock.json`.
  - Updated README English and Chinese release copy to describe the command-first agent stage, modular renderer CSS, wider session rail, large composer, and conditional progress/context panel.
  - Updated README package examples from `Zerox.Agent-1.9.5-arm64.dmg` to `Zerox.Agent-2.1.0-arm64.dmg`.
  - Updated README verification counts to 110 Vitest files / 539 tests after adding release metadata coverage.
  - Added tests that keep package metadata, lockfile metadata, README release version, download asset name, and test counts aligned with v2.1.0.
- Changed files:
  - `README.md`
  - `package.json`
  - `package-lock.json`
  - `src/shared/packageScripts.test.ts`
  - `src/shared/readme.test.ts`
  - `.zerox/progress.md`
- TDD and verification evidence:
  - `./init.sh` -> harness check passed; `src/shared/packageScripts.test.ts` passed under the initial v1.9.5 state.
  - `npm test -- src/shared/packageScripts.test.ts src/shared/readme.test.ts` -> RED with expected failures for package version `1.9.5`, README asset `Zerox.Agent-1.9.5-arm64.dmg`, and old test count.
  - `npm version 2.1.0 --no-git-tag-version` -> updated package metadata without creating a git tag.
  - `npm test -- src/shared/packageScripts.test.ts src/shared/readme.test.ts` -> 2 files / 9 tests passed.
  - `rg -n "1\.9\.5|535 tests|535 个测试|538 tests|538 个测试|Zerox\.Agent-1\.9\.5|v1\.9\.5" README.md package.json package-lock.json src/shared/readme.test.ts src/shared/packageScripts.test.ts` -> no matches.
  - `npm run verify` -> 110 files / 539 tests passed, build passed, agent eval 21/21, memory eval 2/2.
  - `npm run harness:check` -> passed.
  - `npm run harness:score` -> overall 9.2, ACI passed, context passed, eval 21/21, goal eval 6/6, adversarial checked 59 with no escapes.
  - `git diff --check` -> passed.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
- Packaging and release-prep evidence:
  - `gh --version && gh auth status` -> GitHub CLI 2.93.0 authenticated as `ZeroxZhang`.
  - `git fetch origin --tags --prune` -> remote refs and tags synced; no existing `v2.1.0` tag or GitHub release was found.
  - `npm run verify` -> 110 files / 539 tests passed, build passed, agent eval 21/21, memory eval 2/2.
  - `npm run harness:check` -> passed.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - `npm run dist:mac` -> generated unsigned macOS arm64 `.dmg`, `.zip`, blockmaps, and `latest-mac.yml` for v2.1.0.
  - `release/mac-arm64/Zerox Agent.app/Contents/Info.plist` -> `CFBundleShortVersionString=2.1.0`, `CFBundleVersion=2.1.0`.
  - `release/latest-mac.yml` -> version `2.1.0`.
  - Release assets prepared:
    - `release/Zerox Agent-2.1.0-arm64.dmg` -> 118M.
    - `release/Zerox Agent-2.1.0-arm64.dmg.blockmap` -> 127K.
    - `release/Zerox Agent-2.1.0-arm64-mac.zip` -> 329M.
    - `release/Zerox Agent-2.1.0-arm64-mac.zip.blockmap` -> 331K.
    - `release/latest-mac.yml` -> 517B.
- Remote release evidence:
  - `git push origin main` -> remote `main` advanced from `0d6246b` to `7c57f01`.
  - `git push -u origin release/2.1.0` -> created remote release branch at `7c57f01`.
  - `git push origin v2.1.0` -> created annotated release tag; `v2.1.0^{}` resolves to `7c57f01`.
  - `gh release create v2.1.0 ... --latest` -> published `https://github.com/ZeroxZhang/zerox-agent/releases/tag/v2.1.0`.
  - `gh api repos/ZeroxZhang/zerox-agent/releases/latest --jq '{tag_name, name, draft, prerelease, html_url}'` -> `tag_name=v2.1.0`, `draft=false`, `prerelease=false`.
  - v2.1.0 assets uploaded: `latest-mac.yml`, `Zerox.Agent-2.1.0-arm64.dmg`, `Zerox.Agent-2.1.0-arm64.dmg.blockmap`, `Zerox.Agent-2.1.0-arm64-mac.zip`, `Zerox.Agent-2.1.0-arm64-mac.zip.blockmap`.

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

## 2026-06-13 Goal Progress Visibility Follow-up

- Clarified session-native goal planning state in the chat surface: a newly created goal now reads as `已规划，待启动` instead of implying active execution.
- Added a visible `开始执行` action for planning goals on both the Goal Contract Bar and Goal Detail Drawer.
- Reworked the progress drawer from raw goal fields into status, next action, metrics, and translated milestone rows.
- Refreshed active goal detail when opening progress and after chat goal responses so the drawer does not show stale detail.
- Changed files:
  - `src/renderer/goalProgressViewModel.ts`
  - `src/renderer/goalProgressViewModel.test.ts`
  - `src/renderer/components/AgentChatPanel.tsx`
  - `src/renderer/components/GoalContractBar.tsx`
  - `src/renderer/components/GoalDetailDrawer.tsx`
  - `src/renderer/materialDesign.test.ts`
  - `src/renderer/styles.css`
  - `.zerox/progress.md`
- TDD and verification evidence:
  - `npm test -- src/renderer/goalProgressViewModel.test.ts` -> RED, missing view-model module; then 1 file / 2 tests passed.
  - `npm test -- src/renderer/materialDesign.test.ts` -> RED, missing progress handlers and drawer sections; then passed after wiring.
  - `npm test -- src/renderer/goalProgressViewModel.test.ts src/renderer/materialDesign.test.ts` -> 2 files / 21 tests passed.
  - `npm run harness:check` -> passed.
  - `npm run verify` -> 106 Vitest files / 509 tests passed, build passed, agent eval 21/21, memory eval 2/2.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - Browser preview at `http://127.0.0.1:5173/#chat` -> shell, chat heading, and composer rendered; console warnings/errors were empty.
  - Electron dev app check -> active goal bar showed `已规划，待启动`, `开始执行`, and the progress drawer showed next action, progress, budget metrics, and translated `待执行` milestone state.

## 2026-06-13 Goal Execution Runtime Follow-up

- Root-caused failed chat goals to the milestone runtime only recording a placeholder run; model-review acceptance then rejected the run because it had no evidence references, causing repeated replans and terminal `failed`.
- Extracted `goalRuntimeEngine` so goal milestones now run through the shared agent loop with the existing tool executor, tool authorization service, model profile, run store, trajectory store, and offload store.
- Changed chat-created goal acceptance from empty `model_review` checks to deterministic progress artifacts:
  - milestone acceptance checks `milestoneProgress.hasRun`.
  - goal acceptance checks `goalProgress.allMilestonesAccepted`.
- Added persisted milestone run metadata (`lastRunStatus`, `lastRunSummary`) so acceptance can distinguish successful runs from mere run IDs.
- Added recovery behavior for terminal active goals: continuing a failed/canceled/stopped goal recreates it from the same description and immediately starts the new goal.
- Added visible recovery UI: terminal goals now show `重新开始`, while planned goals still show `开始执行`.
- Refreshed session summaries when loading persisted sessions so switching away and back does not drop the active goal bar.
- Changed files:
  - `src/main/goalRuntimeEngine.ts`
  - `src/main/goalRuntimeEngine.test.ts`
  - `src/main/chatService.ts`
  - `src/main/chatService.test.ts`
  - `src/main/goalChatService.ts`
  - `src/main/goalChatService.test.ts`
  - `src/main/agentGoalController.ts`
  - `src/main/main.ts`
  - `src/shared/agentGoal.ts`
  - `src/renderer/goalProgressViewModel.ts`
  - `src/renderer/goalProgressViewModel.test.ts`
  - `src/renderer/components/AgentChatPanel.tsx`
  - `src/renderer/components/GoalContractBar.tsx`
  - `src/renderer/components/GoalDetailDrawer.tsx`
  - `src/renderer/materialDesign.test.ts`
  - `.zerox/progress.md`
- TDD and verification evidence:
  - `npm test -- src/main/goalRuntimeEngine.test.ts src/main/goalChatService.test.ts` -> RED, missing runtime module and chat goal still using `model_review`; then 2 files / 5 tests passed.
  - `npm test -- src/renderer/materialDesign.test.ts` -> RED, persisted session loading did not refresh session summaries; then passed after `refreshSessions(sessionIdToLoad)`.
  - `npm test -- src/main/chatService.test.ts -t "recreates and starts"` -> RED, terminal goals resumed the failed ID directly and emitted no goal execution status event; then passed after recreate-and-start routing and status emission.
  - `npm test -- src/renderer/goalProgressViewModel.test.ts -t "restart"` -> RED, failed goals offered only `失败状态`; then passed after `重新开始` next action.
  - `npm test -- src/renderer/goalProgressViewModel.test.ts src/main/chatService.test.ts src/main/goalRuntimeEngine.test.ts src/main/goalChatService.test.ts src/renderer/materialDesign.test.ts` -> 5 files / 46 tests passed.
  - `npm run build` -> passed.
  - Browser preview at `http://127.0.0.1:5173/#chat` -> shell, chat heading, composer rendered, no framework overlay, console warnings/errors empty.
  - Electron dev app check -> failed active goal now shows `重新开始`.
  - `npm run harness:check` -> passed.
  - `npm run verify` -> 107 Vitest files / 512 tests passed, build passed, agent eval 21/21, memory eval 2/2.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.

## 2026-06-13 Goal Mode Realization + Main Process Decoupling + UX Closure (A/B/C)

- Phase A: made Goal Mode runtime and planning real.
  - A1 Workspace sandbox: goal acceptance and runtime now resolve workspace through `AgentWorkspaceService` instead of a hard-coded home directory.
  - A2 Goal-aware runtime: `goalRuntimeEngine` calls `AgentGoalContext.assemble`, returns inferred tokens, and emits `checkpoint_written` trajectory evidence.
  - A3 Chat planner integration: chat-created goals now call the planner; if planning fails they fall back to a single deterministic milestone with a `file_exists` artifact check.
- Phase B: decoupled the main process.
  - Extracted all IPC handlers from `src/main/main.ts` into `src/main/ipc/index.ts` organized by domain (app/tasks/tools/runs/workspaces/multi-agent/goals/evals/memory/learning/model-settings/chat).
  - Introduced `src/main/container.ts` as the explicit DI container: lazy service factories, shared tool executor, MCP lifecycle, and high-level operations like `runAgentTask`, `runGoalOperation`, and `runMemoryEvals`.
  - Rewrote `src/main/main.ts` to window/tray/lifecycle/validation orchestration only; it creates the container and registers IPC handlers.
- Phase C: closed the goal UX loop.
  - C1 Real-time progress streaming: added `GoalProgressEvent`, container-level pub/sub, `goal:progressEvent` IPC broadcast, preload `onGoalProgressEvent`, and chat-panel listener that refreshes the active goal detail and session rail live.
  - C2 Evidence-backed review gate: `GoalDetailDrawer` now shows success-criteria acceptance checks with evidence requirements and `通过并继续 / 拒绝并重新规划 / 终止目标` actions; the inline review gate card uses the same resolve handler.
  - C3 Failure/stall/budget recovery: added `goal:increaseBudget`, `goal:replan`, and `goal:retry` IPC paths backed by `GoalChatService` methods; recovery actions render in both `GoalContractBar` and `GoalDetailDrawer` for `failed`, `stopped_stalled`, and `stopped_budget` goals.
- Changed files:
  - `src/main/container.ts` (new)
  - `src/main/ipc/index.ts` (new)
  - `src/main/main.ts` (rewritten)
  - `src/main/agentGoalController.ts`
  - `src/main/goalRuntimeEngine.ts`
  - `src/main/goalChatService.ts`
  - `src/shared/chat.ts`
  - `src/preload/index.ts`
  - `src/renderer/components/AgentChatPanel.tsx`
  - `src/renderer/components/GoalContractBar.tsx`
  - `src/renderer/components/GoalDetailDrawer.tsx`
- TDD and verification evidence:
  - `npm test` -> 107 Vitest files / 512 tests passed.
  - `npm run build` -> passed.
  - `npm run verify` -> 107 files / 512 tests passed, build passed, agent eval 21/21, memory eval 2/2.
  - `npm run harness:score` -> overall 9.20, eval 21/21, ACI passed, context passed, adversarial checked with no escapes.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - `git diff --check` -> passed.

## 2026-06-13 v1.9.0 Release Packaging

- Bumped package version: `package.json` and `package-lock.json` `1.8.0 -> 1.9.0`.
- Updated `README.md` release notes, verification counts, artifact names, and both English/Chinese feature descriptions for v1.9.0.
- Updated `src/shared/readme.test.ts` to expect `Zerox.Agent-1.9.0-arm64.dmg`.
- Added completed feature entry `P6.1-goal-mode-realization-architecture` to `.zerox/feature_list.json`.
- Built macOS release artifacts:
  - `release/Zerox Agent-1.9.0-arm64.dmg`
  - `release/Zerox Agent-1.9.0-arm64-mac.zip`
  - `release/latest-mac.yml`
- Verification before packaging:
  - `npm test` -> 107 files / 512 tests passed.
  - `npm run dist:mac` -> build and packaging succeeded.

## 2026-06-13 v1.9.2 Follow-up Fixes (Async Goal Execution + Thinking Disclosure)

- Fixed goal execution appearing stuck / milestones not advancing:
  - `goalChatService.start/resume/retry` now initiate controller runs in the background and return immediately.
  - `AgentGoalController` tracks active runs to prevent duplicate execution and catches runtime errors, marking goals as failed.
  - `chatService.continue_goal` returns immediately after resuming, freeing the chat task status.
  - `buildMilestoneInstruction` now injects full success criteria and acceptance checks (including required file paths) into the milestone prompt so the model knows exactly what artifacts to produce.
- Added real-time milestone run event streaming:
  - `goalRuntimeEngine` emits `AgentRunEvent` via `onEvent`.
  - New IPC channel `goal:milestoneRunEvent` broadcasts milestone start, reasoning, tool call, tool result events to renderer.
  - `AgentChatPanel` displays a collapsible「里程碑运行过程」timeline above the composer.
- Added model thinking/thought process support:
  - `ModelSettingsInput` / `PublicModelSettings` now include `thinkingEnabled` and `thinkingBudgetTokens`.
  - `modelSettingsStore` persists thinking options.
  - `AgentModelProfile` and `ChatCompletionRequest` carry `thinking` options.
  - `openAiCompatibleClient` sends `thinking: { type: "enabled", budget_tokens }` in request body and extracts `reasoning_content/reasoning/thinking` from responses.
  - `ModelSettingsPanel` UI adds a checkbox to enable thinking and an input for budget tokens.
  - `TaskActivityStrip` shows a「最新思考」preview and expandable reasoning entries.
- Version bumped to v1.9.2: `package.json`, `package-lock.json`, `README.md`, `src/shared/readme.test.ts`.
- Changed files:
  - `src/main/agentGoalController.ts`
  - `src/main/agentRunnerService.ts`
  - `src/main/chatService.ts`
  - `src/main/goalChatService.ts`
  - `src/main/goalRuntimeEngine.ts`
  - `src/main/modelSettingsStore.ts`
  - `src/main/openAiCompatibleClient.ts`
  - `src/main/container.ts`
  - `src/preload/index.ts`
  - `src/renderer/components/AgentChatPanel.tsx`
  - `src/renderer/components/ModelSettingsPanel.tsx`
  - `src/renderer/styles.css`
  - `src/shared/agentTrajectory.ts`
  - `src/shared/modelSettings.ts`
  - `src/shared/readme.test.ts`
  - `src/renderer/demoAgentData.ts`
  - `src/shared/agentReadiness.test.ts`
- Verification:
  - `npm test` -> 107 files / 512 tests passed.
  - `npm run build` -> passed.
  - `npm run smoke:prod` -> passed.

## 2026-06-14 Goal Mode Tool Authorization Recovery

- Deep self-check found no unfinished feature in `.zerox/feature_list.json`; treated this as a regression fix for completed Goal Mode runtime.
- Root cause:
  - Goal milestones use virtual task IDs like `goal:<goalId>` when reusing `runAgentLoop`.
  - `ToolAuthorizationService` only knew how to load persisted scheduled tasks, so every goal tool call failed authorization with `Scheduled task was not found.`
  - The loop then returned failed tool observations for `web_search`, `web_fetch`, `shell_exec`, `memory_search`, `file_list`, etc., making independent tools look globally broken.
- Fix:
  - `ToolAuthorizationService` now accepts a runtime task policy for non-scheduled runs while preserving audit logging, user approval, and `runContext` sandbox checks.
  - `runAgentLoop` forwards runtime policy and run context into authorization and tool execution.
  - `goalRuntimeEngine` builds a goal milestone runtime policy scoped to the active workspace: workspace read/write, web search unless network is disabled, local memory read, and shell/web-fetch still requiring existing policy or approval.
  - Added regression coverage proving a goal milestone `web_search` is actually executed, receives the workspace run context, and writes a goal-scoped authorization audit event.
- Changed files:
  - `src/main/toolAuthorizationService.ts`
  - `src/main/agentLoop.ts`
  - `src/main/goalRuntimeEngine.ts`
  - `src/main/goalRuntimeEngine.test.ts`
  - `.zerox/progress.md`
- TDD and verification evidence:
  - `./init.sh` -> harness check passed; `src/shared/packageScripts.test.ts` 5 tests passed.
  - `npm test -- src/main/goalRuntimeEngine.test.ts` -> RED, expected `web_search` execution args but received `[]`.
  - `npm test -- src/main/goalRuntimeEngine.test.ts` -> 1 file / 2 tests passed.
  - `npm test -- src/main/agentLoop.test.ts src/main/toolAuthorizationService.test.ts src/main/agentRuntimeEngine.test.ts` -> 3 files / 37 tests passed.
  - `npm run harness:check` -> passed.
  - `npm run verify` -> 107 Vitest files / 513 tests passed, build passed, agent eval 21/21, memory eval 2/2.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - `npm run dist:mac` -> build and packaging succeeded.
- Release artifacts:
  - `release/Zerox Agent-1.9.2-arm64.dmg` -> 118M.
  - `release/Zerox Agent-1.9.2-arm64-mac.zip` -> 329M.

## 2026-06-14 v1.9.3 Release Version Bump

- Applied release-version discipline after the Goal Mode control/authorization fix:
  - Larger behavior fixes and upgrade iterations must receive a new version number before packaging.
  - Bumped the app release from `1.9.2` to `1.9.3`.
  - Updated README release text, quarantine examples, current-version roadmap labels, and README coverage assertions.
- Changed files:
  - `package.json`
  - `package-lock.json`
  - `README.md`
  - `src/shared/readme.test.ts`
  - `.zerox/progress.md`
- Verification evidence:
  - `npm test -- src/shared/readme.test.ts src/shared/appMeta.test.ts src/shared/packageScripts.test.ts` -> 3 files / 9 tests passed.
  - `npm run verify` -> 109 Vitest files / 521 tests passed, build passed, agent eval 21/21, memory eval 2/2.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - `npm run dist:mac` -> build and packaging succeeded.
- Release artifacts:
  - `release/Zerox Agent-1.9.3-arm64.dmg` -> 118M.
  - `release/Zerox Agent-1.9.3-arm64-mac.zip` -> 329M.
  - `release/latest-mac.yml` -> updated for v1.9.3.

## 2026-06-14 Goal Mode Control Bar + In-App Approval Fix

- Fixed Goal Mode execution state regressions:
  - The composer status now stays in `目标执行中` while a background goal is still executing instead of showing `本轮已完成 · 回复已写入会话`.
  - The bottom interrupt control now targets an active executing goal and aborts the background run controller.
  - `goalChatService` tracks per-goal background `AbortController`s so pause/cancel can actually stop in-flight runtime work.
- Replaced global native authorization popups with in-app approval:
  - Added a main-process `ToolApprovalCoordinator` that routes approval requests to renderer IPC.
  - Added an in-app `ToolApprovalPanel` for pending tool authorization requests.
  - Added an auto-approval toggle in the bottom action bar.
  - When auto-approval is enabled, pending and future tool requests are approved automatically and recorded as tool approval decisions.
  - High/critical approval risks are classified centrally, and critical events are rendered in red for Goal Mode monitoring.
- Changed files:
  - `src/main/toolApprovalCoordinator.ts`
  - `src/main/toolApprovalCoordinator.test.ts`
  - `src/main/goalChatService.ts`
  - `src/main/goalChatService.test.ts`
  - `src/main/main.ts`
  - `src/main/container.ts`
  - `src/preload/index.ts`
  - `src/shared/toolApproval.ts`
  - `src/shared/toolApproval.test.ts`
  - `src/renderer/chatTaskActivity.ts`
  - `src/renderer/chatTaskActivity.test.ts`
  - `src/renderer/components/AgentChatPanel.tsx`
  - `src/renderer/materialDesign.test.ts`
  - `src/renderer/styles.css`
- TDD and verification evidence:
  - `npm test -- src/main/toolApprovalCoordinator.test.ts` -> RED, pending in-app approval did not resolve when auto approval was enabled.
  - `npm test -- src/main/toolApprovalCoordinator.test.ts` -> 1 file / 3 tests passed.
  - `npm test -- src/renderer/chatTaskActivity.test.ts src/shared/toolApproval.test.ts src/main/toolApprovalCoordinator.test.ts src/main/goalChatService.test.ts src/renderer/materialDesign.test.ts` -> 5 files / 34 tests passed.
  - `npm test -- src/main/toolAuthorizationService.test.ts src/main/goalRuntimeEngine.test.ts src/main/chatService.test.ts src/main/agentGoalController.test.ts src/main/toolApprovalDialog.test.ts` -> 5 files / 36 tests passed.
  - In-app Browser check at `http://127.0.0.1:5173/#chat` -> auto-approval toggle rendered, toggled from false to true, and console had no application errors.
  - `npm run build` -> passed.
  - `git diff --check` -> passed.
  - `npm run verify` -> 109 Vitest files / 521 tests passed, build passed, agent eval 21/21, memory eval 2/2.
  - `npm run harness:check` -> passed.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - `npm run dist:mac` -> build and packaging succeeded.
- Release artifacts:
  - `release/Zerox Agent-1.9.2-arm64.dmg` -> 118M.
  - `release/Zerox Agent-1.9.2-arm64-mac.zip` -> 329M.

## 2026-06-14 v1.9.4 Goal Mode Layout + Output Root Stabilization

- Fixed Goal Mode execution display regressions:
  - Starting a goal now closes the detail drawer so the active workspace is not covered by stale overlay layers.
  - `AgentWorkTimeline` uses bounded grid columns, line-clamps long milestone/status text, and keeps step cards from collapsing into vertical shards.
  - `GoalDetailDrawer` now renders through an in-app backdrop layer and keeps hooks stable across closed/open states.
- Fixed goal output path failures:
  - Added `goalOutputRoots` extraction for explicit absolute output folders in goal descriptions and acceptance checks.
  - Goal runtime policies now include only those explicit output roots as extra read/write roots.
  - Deterministic acceptance now checks files against the workspace plus the goal-scoped extra roots, so `/Volumes/Out/临时任务/...` can pass when the user explicitly requested that folder without globally allowing workspace escape.
- Version and release:
  - Bumped release from `1.9.3` to `1.9.4`.
  - Updated README release notes, quarantine examples, verification counts, and README assertions.
- Changed files:
  - `package.json`
  - `package-lock.json`
  - `README.md`
  - `src/main/goalOutputRoots.ts`
  - `src/main/goalRuntimeEngine.ts`
  - `src/main/goalRuntimeEngine.test.ts`
  - `src/main/agentGoalAcceptance.ts`
  - `src/main/agentGoalAcceptance.test.ts`
  - `src/main/container.ts`
  - `src/renderer/components/AgentChatPanel.tsx`
  - `src/renderer/components/GoalDetailDrawer.tsx`
  - `src/renderer/materialDesign.test.ts`
  - `src/renderer/styles.css`
  - `src/shared/readme.test.ts`
  - `.zerox/progress.md`
- TDD and verification evidence:
  - `./init.sh` -> harness check passed; `src/shared/packageScripts.test.ts` 5 tests passed.
  - `npm test -- src/renderer/materialDesign.test.ts src/main/agentGoalAcceptance.test.ts src/main/goalRuntimeEngine.test.ts` -> RED before implementation, then 3 files / 32 tests passed.
  - `npm run build` -> passed.
  - `npm test -- src/shared/readme.test.ts src/shared/appMeta.test.ts src/shared/packageScripts.test.ts` -> 3 files / 9 tests passed.
  - `npm run verify` -> 109 Vitest files / 524 tests passed, build passed, agent eval 21/21, memory eval 2/2.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - In-app Browser check at `http://127.0.0.1:5173/#chat` -> desktop and 390px mobile rendered without console errors or horizontal overflow; injected CSS contained compact timeline, drawer backdrop, and two-line clamp rules.
  - `npm run dist:mac` -> build and packaging succeeded.
- Release artifacts:
  - `release/Zerox Agent-1.9.4-arm64.dmg` -> 118M.
  - `release/Zerox Agent-1.9.4-arm64-mac.zip` -> 329M.
  - `release/latest-mac.yml` -> updated for v1.9.4.

## 2026-06-14 Goal Mode Stop-Gate Refactor + Kimi-Style Chat Shell

- Investigation evidence:
  - `./init.sh` passed, and `.zerox/feature_list.json` had no unfinished feature; treated the work as a regression/design fix for completed Goal Mode.
  - Existing open Zerox Agent 1.9.4 window showed repeated Goal Mode sessions stuck in `规划中` / `执行中` / `失败`, with an active yellow stalled strip reporting no ready milestone.
  - Reviewed MiMo Code `/goal` design from `XiaomiMiMo/MiMo-Code` at commit `42e7da3d51dba1129cd3abfa214e29f7385924a3`: `/goal` is a session stop condition, starts work immediately, and an independent judge blocks optimistic stops by injecting a synthetic continue turn when evidence is insufficient.
- Root causes fixed:
  - `/目标 ...` only created a planning goal and did not immediately execute it.
  - Chat-created goals used a synthetic `goal-<id>-result.md` `file_exists` acceptance check, so real goal success was not judged from evidence.
  - Background goal start had a planning/executing race because the controller run was launched with `void` and the UI could reread the goal before the controller persisted `executing`.
  - Default chat goals requested review after every milestone, interrupting autonomous goal completion.
  - Goal runtime shell policy had no approved local verification command templates.
- Fix:
  - Chat goal creation now starts/resumes the goal immediately and records `goal_started`.
  - Chat-created goals now use an evidence-backed `model_review` stop condition with `artifact:goalEvidence`.
  - Acceptance model review prompts now include the goal condition and serialized artifact evidence, not just evidence ref names.
  - `GoalChatService` queues planning goals as `executing` before launching the background controller run.
  - Default chat goal review policy is `review_high_risk_only`.
  - Goal runtime policy now allows explicit project verification command templates including `npm test`, `npm test -- *`, `npm run harness:check`, `npm run verify`, `npm run build`, `npm run smoke:prod`, `node *`, `git status`, and `git diff`.
  - Chat UI was reshaped toward the Kimi reference: left session rail, center conversation workspace, right progress/context cards, compact top title, Kimi-like composer, desktop and mobile responsive checks.
- Changed files:
  - `src/main/goalChatService.ts`
  - `src/main/goalChatService.test.ts`
  - `src/main/chatService.ts`
  - `src/main/chatService.test.ts`
  - `src/main/agentGoalAcceptance.ts`
  - `src/main/agentGoalAcceptance.test.ts`
  - `src/main/goalRuntimeEngine.ts`
  - `src/main/goalRuntimeEngine.test.ts`
  - `src/main/container.ts`
  - `src/renderer/components/AgentChatPanel.tsx`
  - `src/renderer/materialDesign.test.ts`
  - `src/renderer/styles.css`
  - `.zerox/progress.md`
- TDD and verification evidence:
  - `npm test -- src/main/goalChatService.test.ts src/main/chatService.test.ts src/main/agentGoalAcceptance.test.ts src/main/goalRuntimeEngine.test.ts` -> RED with 6 expected failures before implementation.
  - Same focused command -> 4 files / 37 tests passed after implementation.
  - `npm test -- src/shared/agentGoal.test.ts src/shared/agentGoalReview.test.ts src/main/agentGoalStore.test.ts src/main/agentGoalPlanner.test.ts src/main/agentGoalAcceptance.test.ts src/main/agentGoalController.test.ts src/main/goalRuntimeEngine.test.ts src/main/goalChatService.test.ts src/main/chatService.test.ts src/renderer/goalProgressViewModel.test.ts src/renderer/materialDesign.test.ts` -> 11 files / 88 tests passed.
  - `npm test -- src/renderer/materialDesign.test.ts src/renderer/chatTaskActivity.test.ts src/main/chatService.test.ts src/main/goalChatService.test.ts src/main/agentGoalAcceptance.test.ts src/main/goalRuntimeEngine.test.ts` -> 6 files / 62 tests passed after Kimi-style UI shell changes.
  - `npm run build` -> passed.
  - Browser QA at `http://localhost:5174/#chat` -> desktop rendered nonblank, right progress/context panel present, no console warn/error; 390x844 mobile rendered nonblank with composer present and no console warn/error. First IAB attempt to `127.0.0.1` crashed on `about:blank`; retry on `localhost` succeeded.
  - `npm test` -> 109 files / 526 tests passed.
  - `npm run verify` -> 109 files / 526 tests passed, build passed, agent eval 21/21, memory eval 2/2.
  - `npm run harness:check` -> passed.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.

## 2026-06-15 Goal Mode Artifact Evidence Hotfix

- Root cause found from the live packaged-app trajectories and user screenshots:
  - Goal planners emitted `model_review` checks with refs such as `artifact:execution_plan`, `artifact:research_notes`, `artifact:report_outline`, and `artifact:final_report_file`.
  - Runtime agents wrote real files such as `/Volumes/Out/临时任务/execution_plan.md` and `/Volumes/Out/临时任务/research_notes.md`.
  - Acceptance only looked inside `ctx.artifacts`, so those valid files were presented to the judge as `artifact:*: missing`. This caused false milestone rejection, repeated replans, and eventual `Milestone rejected and replan budget exhausted`.
  - Failed-goal recovery UX also exposed two similar actions: a top "restart" path that sent chat continuation and created a new goal attempt, and a recovery "retry" path over IPC. The wording made a new attempt look like the failed goal had randomly resumed.
- Fix:
  - `model_review` evidence now resolves missing `artifact:*` refs from trusted workspace/goal output roots by convention (`artifact_name`, `.md`, `.markdown`, `.txt`, `.json`) and passes file path, size, and content preview to the independent judge.
  - Missing required artifact evidence now fails before calling the judge, so a model cannot accidentally accept a missing artifact.
  - Milestone runtime instructions now include an explicit artifact evidence contract, e.g. `artifact:research_notes -> /target/research_notes.md`, so future runs materialize the files acceptance will read.
  - Failed goal UI now points to the explicit recovery path instead of offering a top-level restart button; manual chat continuation of a terminal goal now says it creates a new retry attempt.
- Changed files:
  - `src/main/agentGoalAcceptance.ts`
  - `src/main/agentGoalAcceptance.test.ts`
  - `src/main/goalRuntimeEngine.ts`
  - `src/main/goalRuntimeEngine.test.ts`
  - `src/main/chatService.ts`
  - `src/main/chatService.test.ts`
  - `src/renderer/goalProgressViewModel.ts`
  - `src/renderer/goalProgressViewModel.test.ts`
  - `src/renderer/components/GoalDetailDrawer.tsx`
  - `src/renderer/components/AgentChatPanel.tsx`
  - `.zerox/progress.md`
- TDD and verification evidence:
  - `npm test -- src/main/agentGoalAcceptance.test.ts` -> RED: prompt contained `artifact:research_notes: missing` despite `research_notes.md` existing in an explicit output root.
  - `npm test -- src/main/goalRuntimeEngine.test.ts` -> RED: milestone instruction had no artifact evidence contract.
  - `npm test -- src/main/agentGoalAcceptance.test.ts` -> RED: missing artifact could be accepted if the fake judge returned accepted.
  - `npm test -- src/renderer/goalProgressViewModel.test.ts` -> RED: failed goals still exposed `重新开始` as next action.
  - `npm test -- src/main/chatService.test.ts` -> RED: terminal goal continuation still replied `已重新开始目标`.
  - `npm test -- src/main/agentGoalAcceptance.test.ts src/main/goalRuntimeEngine.test.ts src/main/chatService.test.ts src/renderer/goalProgressViewModel.test.ts src/renderer/materialDesign.test.ts` -> 5 files / 58 tests passed.
  - `npm run verify` -> 110 files / 535 tests passed, build passed, agent eval 21/21, memory eval 2/2.
  - `npm run harness:check` -> passed.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - Browser QA at `http://127.0.0.1:5174/#chat` -> desktop rendered `会话` / `进度` / `上下文`, no horizontal overflow, and console warn/error logs were empty.
  - Browser QA at 390x844 -> context panel hidden by breakpoint, send button visible, no horizontal overflow, and console warn/error logs were empty.
  - `npm run dist:mac` -> build and mac dmg/zip packaging passed.
  - Packaged app smoke: `BUILDING_AGENT_SMOKE=1 BUILDING_AGENT_SMOKE_REQUIRED_TEXTS='进度|上下文' "release/mac-arm64/Zerox Agent.app/Contents/MacOS/Zerox Agent"` -> passed.
  - `release/Zerox Agent-1.9.5-arm64.dmg` -> 118M, updated 2026-06-15 00:09 CST.
  - `release/Zerox Agent-1.9.5-arm64-mac.zip` -> 329M, updated 2026-06-15 00:09 CST.
  - Packaged `Info.plist` reports `CFBundleShortVersionString=1.9.5` and `CFBundleVersion=1.9.5`.
  - `git diff --check` -> passed.

### README follow-up

- Updated README to document the v1.9.5 Goal Mode artifact evidence hotfix in both English and Chinese:
  - Overview now mentions trusted output-root `artifact:*` resolution, the explicit artifact evidence contract, and missing artifact evidence files failing before model review.
  - Local data tables now include `agent-goals/*.json` and `agent-goals/*.ledger.jsonl`.
  - Chat/Goal Mode capability lists now explain that `artifact:research_notes`-style refs are judged from real local files.
  - Test counts now match the latest verification evidence: 110 Vitest files / 535 tests.
- Changed files:
  - `README.md`
  - `src/shared/readme.test.ts`
  - `.zerox/progress.md`
- Verification evidence:
  - `npm test -- src/shared/readme.test.ts` -> RED before README documented `artifact evidence contract`.
  - `npm test -- src/shared/readme.test.ts` -> 1 file / 3 tests passed.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.

## 2026-06-14 Goal Mode Completion Audit Follow-up

- Completion audit found two remaining Goal Mode design gaps:
  - Manual goals created through the Goal drawer/IPC still produced `model_review` checks with empty `params`, while the acceptance engine requires evidence refs. These goals could not pass final review because no `artifact:goalEvidence` was available to the judge.
  - Final goal-level acceptance failure stopped the whole goal as `failed`. MiMo Code's `/goal` gate instead treats an unsatisfied judge verdict as a reason to keep working, bounded by a retry/react budget.
- Fix:
  - `createGoalDraft` now creates evidence-backed `model_review` checks for both explicit manual success criteria and the blank-criteria fallback, with `condition` and `evidenceRefs: ["artifact:goalEvidence"]`.
  - `AgentGoalController` now replans and continues when all milestones are accepted but final goal acceptance says evidence is still insufficient, until the existing replan budget is exhausted.
- Changed files:
  - `src/main/container.ts`
  - `src/main/container.test.ts`
  - `src/main/agentGoalController.ts`
  - `src/main/agentGoalController.test.ts`
  - `.zerox/progress.md`
- TDD and verification evidence:
  - `npm test -- src/main/container.test.ts` -> RED: manual goal checks had `params: {}` instead of `condition` and `artifact:goalEvidence`.
  - `npm test -- src/main/container.test.ts` -> 1 file / 2 tests passed.
  - `npm test -- src/main/agentGoalController.test.ts` -> RED: final acceptance needing more evidence returned `failed` instead of `achieved`.
  - `npm test -- src/main/agentGoalController.test.ts` -> 1 file / 8 tests passed.
  - `npm test -- src/main/container.test.ts src/main/agentGoalAcceptance.test.ts src/main/goalChatService.test.ts src/main/chatService.test.ts src/main/goalRuntimeEngine.test.ts` -> 5 files / 39 tests passed.
  - `npm test` -> 110 files / 529 tests passed.
  - `npm run build` -> passed.
  - `npm run verify` -> 110 files / 529 tests passed, build passed, agent eval 21/21, memory eval 2/2.
  - `npm run harness:check` -> passed.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - Browser QA at `http://localhost:5174/#chat` -> desktop Kimi-style shell rendered with grid `220px 614px 300px`, right cards `进度` / `上下文`, composer accepted `/目标 浏览器端到端验证目标模式界面`, and console warn/error logs were empty.
  - Browser QA at 390x844 -> context panel hidden by breakpoint, composer and send button visible, no horizontal overflow, and console warn/error logs were empty.
  - `git diff --check` -> passed.

## 2026-06-14 v1.9.5 Goal Mode Release + Packaged Regression

- Release/version work:
  - Bumped package metadata to `1.9.5` with `npm version 1.9.5 --no-git-tag-version`.
  - Updated README release links and notes from `1.9.4` to `1.9.5`.
  - Updated README expectations in `src/shared/readme.test.ts`.
- Additional Goal Mode defects found during real packaged-app regression:
  - After a packaged Goal Mode run reached `已达成`, the main goal strip was green but the top/bottom work indicators could remain in a running state.
  - Session `activeGoal` summaries were not persisted when the background goal controller changed status to terminal states, so relaunching the packaged app could show stale `执行中` badges even when the goal store said `achieved`.
  - Existing stale summaries from earlier versions needed repair when chat sessions were loaded.
- Fix:
  - Goal progress events now map every goal status into chat UI state, not only `executing`; terminal states clear active request/work UI and disable interrupt.
  - `emitGoalProgressEvent` now syncs the goal store status back into the chat session summary before notifying UI listeners.
  - Container-level `listChatSessions()` and `getChatSession()` reconcile stale persisted active goal summaries from `agentGoalStore()` and write corrected summaries back only when changed.
- Changed files in this release follow-up:
  - `package.json`
  - `package-lock.json`
  - `README.md`
  - `src/shared/readme.test.ts`
  - `src/renderer/chatTaskActivity.ts`
  - `src/renderer/chatTaskActivity.test.ts`
  - `src/renderer/components/AgentChatPanel.tsx`
  - `src/main/container.ts`
  - `src/main/container.test.ts`
  - `src/main/ipc/index.ts`
  - `.zerox/progress.md`
- TDD and verification evidence:
  - `npm test -- src/shared/readme.test.ts` -> RED before README release links were updated.
  - `npm test -- src/shared/readme.test.ts src/shared/appMeta.test.ts src/shared/packageScripts.test.ts` -> 3 files / 9 tests passed.
  - `npm test -- src/renderer/chatTaskActivity.test.ts` -> RED: achieved goals still displayed `目标状态已更新`.
  - `npm test -- src/renderer/chatTaskActivity.test.ts` -> 1 file / 5 tests passed.
  - `npm test -- src/main/container.test.ts` -> RED: background goal status changes left chat session summaries at stale `planning`; later RED again for missing session-load repair API.
  - `npm test -- src/main/container.test.ts` -> 1 file / 4 tests passed.
  - `npm test -- src/main/container.test.ts src/main/chatSessionStore.test.ts src/main/chatService.test.ts src/main/goalChatService.test.ts src/main/agentGoalController.test.ts src/renderer/chatTaskActivity.test.ts src/renderer/materialDesign.test.ts` -> 7 files / 68 tests passed.
  - `npm run verify` -> 110 files / 532 tests passed, build passed, agent eval 21/21, memory eval 2/2.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.
- Release artifact evidence:
  - `npm run dist:mac` -> build and packaging succeeded.
  - Packaged app smoke: `BUILDING_AGENT_SMOKE=1 BUILDING_AGENT_SMOKE_REQUIRED_TEXTS='进度|上下文' "release/mac-arm64/Zerox Agent.app/Contents/MacOS/Zerox Agent"` -> passed.
  - `release/mac-arm64/Zerox Agent.app/Contents/Info.plist` has `CFBundleShortVersionString=1.9.5` and `CFBundleVersion=1.9.5`.
  - `release/Zerox Agent-1.9.5-arm64.dmg` -> 118M.
  - `release/Zerox Agent-1.9.5-arm64-mac.zip` -> 329M.
  - `release/latest-mac.yml` -> updated at 2026-06-14 23:30.
- Real packaged-app regression evidence:
  - Opened `release/mac-arm64/Zerox Agent.app`; UI reported `v 1.9.5`.
  - Created a fresh session and submitted `/目标 请在本轮测试中回复一句：Goal Mode v1.9.5 packaged smoke ok。只要回复这句话就完成。`.
  - Packaged app replied `已设置并开始执行目标...`, created a single milestone, executed it, recorded evidence, and reached green `已达成 · 1/1 已完成`.
  - After the repair build and relaunch, the same packaged app automatically corrected stale session badges and right-side context from `执行中` to `已达成`, bottom activity showed `当前没有任务运行 · 待命`, and the interrupt button was disabled.

## 2026-06-15 v2.1.1 UI/runtime control release

- Request:
  - Fix the remaining UI framework issues, verify the iteration as test engineer, package, release, and push the corrected release as `2.1.1`.
- Implementation:
  - Integrated active work status into the right progress/context rail as `ContextActivityCard`; removed the redundant composer activity strip and main chat work timeline from the active chat surface.
  - Added balanced 28px padding to the right context rail and compact activity-card styling.
  - Switched the Electron main window to a macOS integrated `hiddenInset` titlebar with traffic light positioning and aligned app background; adjusted sidebar top padding and drag regions.
  - Made goal cancellation update local chat/session UI immediately so the stop button and status no longer stay stuck in terminating/executing.
  - Removed Goal Mode budget hard-stop dispatch checks and replan budget gates; `budgetUsage` remains audit telemetry only.
  - Reclassified legacy `stopped_budget` goals as directly recoverable, including UI copy, chat continue routing, status transitions, and eval fixtures.
  - Updated release metadata, README, and tests from `2.1.0` to `2.1.1`.
- Changed files:
  - `package.json`
  - `package-lock.json`
  - `README.md`
  - `docs/architecture/agent-goal-mode.md`
  - `src/main/agentGoalController.ts`
  - `src/main/goalChatService.ts`
  - `src/main/chatService.ts`
  - `src/main/desktopLifecycle.ts`
  - `src/main/eval/agentEvalAdversary.ts`
  - `src/main/eval/agentEvalFixtures.ts`
  - `src/renderer/App.tsx`
  - `src/renderer/chatTaskActivity.ts`
  - `src/renderer/components/AgentChatPanel.tsx`
  - `src/renderer/components/GoalDetailDrawer.tsx`
  - `src/renderer/components/GoalStatusStrip.tsx`
  - `src/renderer/goalProgressViewModel.ts`
  - `src/renderer/styles/app-shell.css`
  - `src/renderer/styles/chat.css`
  - `src/renderer/styles/composer.css`
  - `src/renderer/styles/sidebar.css`
  - focused tests under `src/main`, `src/renderer`, and `src/shared`
- TDD evidence:
  - `npm test -- src/main/agentGoalController.test.ts src/main/goalChatService.test.ts src/renderer/goalProgressViewModel.test.ts src/main/desktopLifecycle.test.ts src/renderer/materialDesign.test.ts src/main/eval/agentEvalRunner.test.ts src/main/eval/agentEvalAdversary.test.ts` -> RED with expected failures for budget hard stop, legacy budget resume, titlebar config, right-rail padding, and composer activity strip.
  - After implementation, `npm test -- src/main/agentGoalController.test.ts src/main/goalChatService.test.ts src/main/chatService.test.ts src/shared/agentGoal.test.ts src/renderer/chatTaskActivity.test.ts src/renderer/goalProgressViewModel.test.ts src/main/desktopLifecycle.test.ts src/renderer/materialDesign.test.ts src/main/eval/agentEvalRunner.test.ts src/main/eval/agentEvalAdversary.test.ts` -> 10 files / 89 tests passed.
  - After correcting release version to `2.1.1`, `npm test -- src/shared/packageScripts.test.ts src/shared/readme.test.ts src/main/agentGoalController.test.ts src/main/goalChatService.test.ts src/main/chatService.test.ts src/shared/agentGoal.test.ts src/renderer/chatTaskActivity.test.ts src/renderer/goalProgressViewModel.test.ts src/main/desktopLifecycle.test.ts src/renderer/materialDesign.test.ts src/main/eval/agentEvalRunner.test.ts src/main/eval/agentEvalAdversary.test.ts` -> 12 files / 98 tests passed.
- Verification evidence:
  - `npm test` -> 110 files / 544 tests passed.
  - `npm run verify` -> 110 files / 544 tests passed, build passed, agent eval 21/21, memory eval 2/2.
  - `npm run harness:check` -> passed.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - Browser QA at `http://127.0.0.1:5173/#chat` -> desktop DOM contained no `agent-work-timeline` and no `task-activity-strip`; sidebar top padding was `52px`; chat topbar was hidden in chat mode; mobile 390x844 had no horizontal overflow and composer width stayed within viewport.
  - `git diff --check` -> passed.
- Release artifact evidence:
  - `npm version 2.1.1 --no-git-tag-version` -> updated package metadata without creating a git tag.
  - `npm run dist:mac` -> generated unsigned macOS arm64 `.dmg`, `.zip`, blockmaps, and `latest-mac.yml` for v2.1.1.
  - `release/mac-arm64/Zerox Agent.app/Contents/Info.plist` -> `CFBundleShortVersionString=2.1.1`, `CFBundleVersion=2.1.1`.
  - `release/latest-mac.yml` -> version `2.1.1`.
  - Artifacts:
    - `release/Zerox Agent-2.1.1-arm64.dmg` -> 118M.
    - `release/Zerox Agent-2.1.1-arm64.dmg.blockmap` -> 127K.
    - `release/Zerox Agent-2.1.1-arm64-mac.zip` -> 329M.
    - `release/Zerox Agent-2.1.1-arm64-mac.zip.blockmap` -> 331K.

## 2026-06-15 Rollback to v1.9.5

- Request:
  - Roll back the v2.0.1 Kimi Work UI release to the previous version.
- Rollback strategy:
  - Used a non-destructive revert of `55c8c94 feat: release v2.0.1 kimi work ui`; no `reset --hard`, no force push, and no release/tag deletion.
  - Returned package metadata and README release copy to `1.9.5`.
  - Kept the v2.0.1 release record available for audit history and repointed GitHub latest release back to v1.9.5.
- Changed files:
  - `README.md`
  - `package.json`
  - `package-lock.json`
  - `src/renderer/App.tsx`
  - `src/renderer/components/AgentChatPanel.tsx`
  - `src/renderer/styles.css`
  - `src/renderer/materialDesign.test.ts`
  - `src/shared/packageScripts.test.ts`
  - `src/shared/readme.test.ts`
  - `.zerox/progress.md`
- Verification evidence:
  - `git revert --no-commit 55c8c94` -> applied cleanly with no conflicts.
  - `node -p "require('./package.json').version"` -> `1.9.5`.
  - `npm test -- src/renderer/materialDesign.test.ts src/shared/packageScripts.test.ts src/shared/readme.test.ts` -> 3 files / 29 tests passed.
  - `npm run verify` -> 110 files / 535 tests passed, build passed, agent eval 21/21, memory eval 2/2.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.
- Release artifact evidence:
  - `npm run dist:mac` -> build and packaging succeeded for v1.9.5.
  - `release/mac-arm64/Zerox Agent.app/Contents/Info.plist` reports `CFBundleShortVersionString=1.9.5` and `CFBundleVersion=1.9.5`.
  - `release/Zerox Agent-1.9.5-arm64.dmg` -> 118M.
  - `release/Zerox Agent-1.9.5-arm64-mac.zip` -> 329M.
  - `release/latest-mac.yml` -> version `1.9.5`; GitHub Release upload uses `Zerox.Agent-1.9.5-*` asset aliases to match README download guidance.
- GitHub release evidence:
  - `git push origin main` -> remote `main` advanced to rollback commit `9cae698`.
  - `git push origin v1.9.5` -> created rollback release tag.
  - `gh release create v1.9.5 ... --latest` -> published `https://github.com/ZeroxZhang/zerox-agent/releases/tag/v1.9.5`.
  - `gh api repos/ZeroxZhang/zerox-agent/releases/latest --jq '{tag_name, name, draft, prerelease, html_url}'` -> `tag_name=v1.9.5`, `draft=false`, `prerelease=false`.
  - v1.9.5 assets uploaded: `latest-mac.yml`, `Zerox.Agent-1.9.5-arm64.dmg`, `Zerox.Agent-1.9.5-arm64.dmg.blockmap`, `Zerox.Agent-1.9.5-arm64-mac.zip`, `Zerox.Agent-1.9.5-arm64-mac.zip.blockmap`.

## 2026-06-15 Command-first UI and shell refactor

- Request:
  - Optimize the interface UI and framework according to the attached UI feedback.
- Implementation:
  - Reworked Chat from a permanent Kimi-style three-column console into a command-first agent stage with an empty home hero, large composer, and conditional progress/context panel.
  - Moved session discovery into a wider workspace sidebar with New Chat, primary navigation, pinned entries, and recents.
  - Replaced Material 3 / Google-blue dominance with warm low-saturation desktop productivity tokens and dark body text for assistant output.
  - Split renderer styling into focused CSS modules with `legacy.css` retained as a compatibility layer for non-chat surfaces.
  - Hid idle task activity noise so the empty state shows only the main command surface and composer.
- Changed files:
  - `src/renderer/App.tsx`
  - `src/renderer/components/AgentChatPanel.tsx`
  - `src/renderer/materialDesign.test.ts`
  - `src/renderer/styles.css`
  - `src/renderer/styles/tokens.css`
  - `src/renderer/styles/base.css`
  - `src/renderer/styles/app-shell.css`
  - `src/renderer/styles/sidebar.css`
  - `src/renderer/styles/chat.css`
  - `src/renderer/styles/composer.css`
  - `src/renderer/styles/cards.css`
  - `src/renderer/styles/responsive.css`
  - `src/renderer/styles/legacy.css`
  - `.zerox/progress.md`
- TDD and verification evidence:
  - `npm test -- src/renderer/materialDesign.test.ts` -> RED with 6 expected failures for missing modular CSS imports, workspace sidebar, command-first home state, and conditional context panel.
  - `npm test -- src/renderer/materialDesign.test.ts` -> 1 file / 24 tests passed after implementation; reran after hiding idle activity strip with the same pass result.
  - `npm test -- src/renderer/materialDesign.test.ts src/shared/navigation.test.ts src/shared/materialNavigation.test.ts` -> 3 files / 30 tests passed.
  - `npm run build` -> TypeScript and Vite production build passed.
  - Browser QA at `http://127.0.0.1:5173/#chat` -> desktop DOM contained workspace sidebar, command hero, composer, and no idle context panel; console warn/error logs were empty.
  - Browser interaction QA -> clicking `把这个目标拆成可执行计划` populated the composer with that text and enabled the send button; console warn/error logs stayed empty.
  - Browser mobile QA at 390x844 -> hero and composer visible, right context panel hidden, `scrollWidth=390`, no horizontal overflow, console warn/error logs empty.
  - Screenshot evidence captured with Playwright after Browser screenshot timed out: `/tmp/zerox-chat-desktop.png` and `/tmp/zerox-chat-mobile.png`; both were inspected with `view_image`.
  - Accepted concept inspected with `view_image`: `/Users/zerox/.codex/generated_images/019eca98-53b7-7483-a25d-6f4c53cb809e/ig_0f0ecacd943c1222016a2fc671cef481918c4f6502c4419f04.png`.
  - `npm run verify` -> 110 files / 538 tests passed, build passed, agent eval 21/21, memory eval 2/2.
  - `npm run harness:check` -> passed.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - `git diff --check` -> passed.
