# Zerox Harness Progress

## 2026-06-24 - v2.7.0 Task 6 Icon System And Visual Design Artifact

- Request: implement Task 6 from the 2.7.0 UI iteration brief: add a shared local renderer icon component, replace the requested chat/sidebar glyph controls, and create the approved 2.7.0 UI artifact covering required chat states.
- Changed files:
  - `src/renderer/components/Icon.tsx`
  - `src/renderer/components/AgentChatPanel.tsx`
  - `src/renderer/App.tsx`
  - `src/renderer/materialDesign.test.ts`
  - `src/renderer/styles/sidebar.css`
  - `src/renderer/styles/composer.css`
  - `docs/design/zerox-agent-2-7-0-ui-artifact.html`
  - `.superpowers/sdd/2026-06-23-v270-task-6-report.md`
  - `.zerox/progress.md`
- RED evidence:
  - `npm test -- src/renderer/materialDesign.test.ts -t "Icon component"` -> failed as expected with `ENOENT` for `src/renderer/components/Icon.tsx`, proving the new test was exercising the missing shared icon surface first.
- GREEN evidence:
  - `npm test -- src/renderer/materialDesign.test.ts` -> 1 file / 43 tests passed.
  - `npx tsc -p tsconfig.electron.json --noEmit --pretty false` -> passed.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.
- Implementation evidence:
  - Added `Icon.tsx` with typed local SVG names for renderer controls.
  - Replaced the chat composer `command` / `stop` / `send` controls, selected-skill dismiss action, sidebar new-chat action, and session more-menu trigger with the shared icon component.
  - Added `docs/design/zerox-agent-2-7-0-ui-artifact.html` as a standalone warm-neutral 2.7.0 review artifact covering empty chat, streaming, collapsed thinking, guided input, approval, paused, error, restored, and narrow layout states.

### 2026-06-24 Task 6 follow-up after quality review

- Request: fix the rejected artifact/icon review findings by adding missing material test coverage for `more` and `close`, and by making the design artifact render actual local icon affordances instead of text placeholders.
- Follow-up RED evidence:
  - `npm test -- src/renderer/materialDesign.test.ts -t "local icon"` -> failed as expected because `docs/design/zerox-agent-2-7-0-ui-artifact.html` did not yet contain actual icon markup classes or `currentColor`-stroked SVG stand-ins.
- Follow-up GREEN evidence:
  - `npm test -- src/renderer/materialDesign.test.ts -t "local icon"` -> passed.
  - `npm test -- src/renderer/materialDesign.test.ts` -> 1 file / 44 tests passed.
  - `npx tsc -p tsconfig.electron.json --noEmit --pretty false` -> passed.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.
- Follow-up implementation evidence:
  - Extended `src/renderer/materialDesign.test.ts` to assert `<Icon name="more"` in `App.tsx`, `<Icon name="close"` in `AgentChatPanel.tsx`, and actual artifact icon markup with `currentColor` SVG strokes.
  - Reworked `docs/design/zerox-agent-2-7-0-ui-artifact.html` to use inline SVG icon stand-ins for new chat and all composer action controls across the required states, removing the placeholder `+ New Chat`, `Cmd`, `Stop`, and `Send` text chips.

## 2026-06-23 - v2.7.0 UI/Interaction Planning

- Request: begin the 2.7.0 major iteration to全面优化/重构交互和界面, remove Overview from primary navigation, add streamed answer/thinking separation, support interactive/guided skills, optimize system icons, and complete planning/development/testing/independent acceptance with architect and subagent coordination.
- Approved direction: 方案1, Chat-first consumer experience with progressive disclosure.
- Changed files:
  - `.zerox/feature_list.json`
  - `docs/superpowers/specs/2026-06-23-zerox-agent-2-7-0-ui-interaction-design.md`
  - `docs/superpowers/plans/2026-06-23-zerox-agent-2-7-0-ui-interaction.md`
  - `.zerox/progress.md`
- Planning/design evidence:
  - Added feature `P16-v2.7.0-ui-interaction` as the only unfinished feature.
  - Top-level architecture, UI/UX, guided-skill interaction, and QA/acceptance subagent findings were folded into the approved spec.
  - Implementation plan defines TDD slices for navigation relocation, stream contracts, provider/agent-loop streaming, guided skill input, renderer UX, icon/design artifacts, and independent acceptance.
- Verification evidence:
  - `node -e "const f=require('./.zerox/feature_list.json'); const unfinished=f.features.filter(x=>x.status!=='done'); if (unfinished.length!==1 || unfinished[0].id!=='P16-v2.7.0-ui-interaction' || unfinished[0].status!=='planned') { console.error(JSON.stringify(unfinished,null,2)); process.exit(1); } console.log('feature_list ok:', unfinished[0].id, unfinished[0].status);"` -> `feature_list ok: P16-v2.7.0-ui-interaction planned`.
  - `rg -n "TODO|TBD|FIXME|PLACEHOLDER|\\[[^\\]]*(list|commands|scenario|focused|full|fill|paste|TODO)[^\\]]*\\]|If .*differ|If .*does not|optional" docs/superpowers/specs/2026-06-23-zerox-agent-2-7-0-ui-interaction-design.md docs/superpowers/plans/2026-06-23-zerox-agent-2-7-0-ui-interaction.md` -> no matches.
  - `npm install` -> up to date; audit reported 12 existing vulnerabilities.
  - `npm test` -> 165 files / 1077 tests passed.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.

## 2026-06-22 - v2.6.0 Hardening Release

- Request: assign a new version for the completed hardening iteration, update README/release metadata, package macOS artifacts, publish the release, and push.
- Changed files:
  - `package.json`, `package-lock.json`
  - `README.md`
  - `.zerox/feature_list.json`, `.zerox/progress.md`
  - `src/shared/packageScripts.test.ts`, `src/shared/readme.test.ts`
  - `docs/superpowers/plans/2026-06-21-zerox-agent-bug-hardening-iteration.md`
- Release metadata:
  - Version bumped from `2.5.0` to `2.6.0`.
  - Added feature-list entry `P15-hardening-release-2.6.0`.
  - README now documents v2.6.0 as the current release in English and Chinese.
- Verification evidence:
  - `npm test -- src/shared/packageScripts.test.ts src/shared/readme.test.ts` -> 2 files / 11 tests passed.
  - `npm run verify` -> 165 files / 1077 tests passed; build passed; agent eval 26/26; memory eval 2/2.
  - `npm run smoke:prod` -> passed; renderer rendered agent chat UI with expected better-sqlite3 ABI fallback to JSON.
  - `npm run harness:check` -> passed.
  - `npm run dist:mac` -> produced `release/Zerox Agent-2.6.0-arm64.dmg`, `release/Zerox Agent-2.6.0-arm64-mac.zip`, and blockmaps.
  - `npm run smoke:prod:built` -> passed with expected SQLite ABI fallback.

## 2026-06-21 - Task 6 Worker Isolation And Verification Efficiency

- Request: implement Task 6 from the bug-hardening SDD/TDD plan: production subprocess worker wiring, timed-out worker child recycling, configurable smoke readiness polling, clean-checkout migration coverage verification, and built-artifact script variants.
- Changed files:
  - `src/main/tools/toolWorker.ts`, `src/main/container.ts`, `src/main/smokeMode.ts`, `package.json`
  - `src/main/tools/toolWorker.test.ts`, `src/main/container.test.ts`, `src/main/smokeMode.test.ts`, `src/shared/packageScripts.test.ts`
  - `.superpowers/sdd/task-6-report.md`, `.zerox/progress.md`
- RED evidence:
  - `npm test -- src/main/container.test.ts src/main/tools/toolWorker.test.ts` -> failed: container did not expose/wire `toolWorker`; timed-out subprocess child poisoned the next request.
  - `npm test -- src/main/smokeMode.test.ts` -> failed: renderer readiness script still embedded `const timeoutMs = 4000`.
  - `npm test -- src/shared/packageScripts.test.ts` -> failed: built-artifact script variants were missing.
  - `npm test -- src/main/storage/migrateRoundTrip.test.ts` -> passed before Task 6 edits; existing Task 2 coverage already compiles migration scripts into a fresh temporary `dist-electron` instead of silently skipping.
- GREEN evidence:
  - `npm test -- src/main/container.test.ts src/main/tools/toolWorker.test.ts` -> 2 files / 17 tests passed.
  - `npm test -- src/main/smokeMode.test.ts` -> 1 file / 11 tests passed.
  - `npm test -- src/shared/packageScripts.test.ts` -> 1 file / 8 tests passed.
  - `npm test -- src/main/storage/migrateRoundTrip.test.ts` -> 1 file / 1 test passed.
  - `npm test -- src/main/container.test.ts src/main/tools/toolWorker.test.ts src/main/smokeMode.test.ts src/shared/packageScripts.test.ts` -> 4 files / 36 tests passed.
  - `npm run harness:check` -> passed.
  - `npm run verify` -> 165 files / 1077 tests passed; build passed; agent eval 26/26; memory eval 2/2.
  - `npm run smoke:prod` -> passed; renderer rendered agent chat UI with expected better-sqlite3 ABI fallback to JSON.
  - Built variants: `npm run eval:agent:built` -> 26/26 passed; `npm run eval:memory:built` -> 2/2 passed; `npm run harness:score:built` -> score 9.26 good; `npm run episode:export:built -- --help` -> passed; `npm run smoke:prod:built` -> passed with expected SQLite ABI fallback.

## 2026-06-21 - Task 5 Renderer/IPC/User-Visible State Coherence

- Request: implement Task 5 from the bug-hardening SDD/TDD plan: worktree approval gating, terminal-goal active link cleanup, live Runs panel refresh, and empty chat session list acceptance.
- Changed files:
  - `src/main/agentWorkspaceService.ts`, `src/main/container.ts`, `src/main/ipc/index.ts`, `src/main/chatService.ts`
  - `src/preload/index.ts`
  - `src/renderer/components/AgentChatPanel.tsx`, `src/renderer/components/RunsPanel.tsx`
  - `src/main/agentWorkspaceService.test.ts`, `src/preload/index.test.ts`, `src/main/chatService.test.ts`, `src/main/container.test.ts`, `src/renderer/materialDesign.test.ts`
  - `.superpowers/sdd/task-5-report.md`, `.zerox/progress.md`
- RED evidence:
  - `npm test -- src/main/agentWorkspaceService.test.ts src/preload/index.test.ts` -> failed: git worktree creation resolved without approval and preload still invoked the direct create channel.
  - `npm test -- src/main/chatService.test.ts src/main/goalChatService.test.ts src/renderer/chatTaskActivity.test.ts` -> failed: achieved review continuation did not clear the active chat goal link.
  - `npm test -- src/renderer/materialDesign.test.ts` -> failed: Runs had no run lifecycle subscription and empty chat session lists were ignored.
- GREEN evidence:
  - `npm test -- src/main/agentWorkspaceService.test.ts src/preload/index.test.ts` -> 2 files / 7 tests passed.
  - `npm test -- src/main/chatService.test.ts src/main/goalChatService.test.ts src/renderer/chatTaskActivity.test.ts` -> 3 files / 46 tests passed.
  - `npm test -- src/renderer/materialDesign.test.ts src/renderer/chatTaskActivityRestore.test.ts` -> 2 files / 37 tests passed.
  - `npm run harness:check` -> passed.
  - `npm test` -> 165 files / 1071 tests passed.
  - `npm run build` -> passed.

  - `npm run verify` -> 165 files / 1071 tests passed; build passed; agent eval 26/26; memory eval 2/2.
  - `npm run smoke:prod` -> passed; renderer rendered agent chat UI with expected SQLite ABI fallback to JSON.
  - `git diff --check` -> passed.

## 2026-06-21 Task 3 Follow-up Abort-aware Provider Timeout Race

- Request: fix the abort-aware fetch race where `fetchWithTimeout` aborted the underlying fetch before rejecting the local timeout promise, allowing `AbortError` to win and preventing `completeWithModelRetry` from retrying local provider timeouts.
- Changed files:
  - `src/main/fetchWithTimeout.ts`
  - `src/main/providers/providers.test.ts`
  - `src/main/modelRetry.test.ts`
  - `.superpowers/sdd/task-3-followup-report.md`
  - `.zerox/progress.md`
- RED evidence:
  - `npm test -- src/main/providers/providers.test.ts src/main/modelRetry.test.ts` -> failed as expected: abort-aware provider timeout and retry tests received `The operation was aborted.` instead of provider timeout messages.
- GREEN evidence:
  - `npm test -- src/main/providers/providers.test.ts src/main/modelRetry.test.ts` -> 2 files / 28 tests passed.
  - `npm test -- src/main/storage/storeProxy.test.ts src/main/agentTrajectoryStore.test.ts src/main/agentRunStore.test.ts` -> 3 files / 26 tests passed.
  - `npm run harness:check` -> passed.
  - `npm test` -> 164 files / 1056 tests passed.
  - `npm run build` -> passed.
  - `npm run verify` -> 164 files / 1056 tests passed; build passed; agent eval 26/26; memory eval 2/2.
  - `npm run smoke:prod` -> passed; renderer rendered agent chat UI, with designed JSON fallback for the local better-sqlite3 ABI mismatch.

## 2026-06-21 Task 2 SQLite/Migration/JSONL Recovery Integrity

- Request: implement Task 2 from the bug-hardening SDD/TDD plan: SQLite/dual storage parity, reviewed-learning migration fidelity, audit event identity, tolerant JSONL recovery, SQLite chat search parity, and rollback completeness.
- Changed files:
  - `src/main/taskStore.ts`, `src/main/toolAuditLog.ts`
  - `src/main/storage/repositories/index.ts`, `src/main/storage/repositories/sessionRepository.ts`
  - `src/main/jsonlRecovery.ts`
  - `src/main/workspaceRunStore.ts`, `src/main/agentRunStore.ts`, `src/main/agentTrajectoryStore.ts`, `src/main/agentGoalStore.ts`
  - `scripts/migrate-to-sqlite.mjs`, `scripts/rollback-sqlite-to-json.mjs`
  - Focused tests in `src/main/storage/storeProxy.test.ts`, `src/main/toolAuditLog.test.ts`, `src/main/storage/migrateRoundTrip.test.ts`, `src/main/storage/repositories/repositories.test.ts`, `src/main/workspaceRunStore.test.ts`, `src/main/agentRunStore.test.ts`, `src/main/agentTrajectoryStore.test.ts`, `src/main/agentGoalStore.test.ts`
- RED evidence:
  - `npm test -- src/main/storage/storeProxy.test.ts src/main/toolAuditLog.test.ts` -> failed: persisted SQLite/dual audit events had different ids/timestamps; disabled daily tasks reloaded with recomputed timestamps and non-null `nextRunAt`.
  - `npm test -- src/main/storage/repositories/repositories.test.ts src/main/chatSessionStore.test.ts` -> failed: SQLite search returned `[]` for `报告 markdown`.
  - `npm test -- src/main/workspaceRunStore.test.ts src/main/agentRunStore.test.ts src/main/agentTrajectoryStore.test.ts src/main/agentGoalStore.test.ts` -> failed: malformed JSONL lines threw `SyntaxError`.
  - `npm test -- src/main/storage/migrateRoundTrip.test.ts` -> failed: migrated learning candidates had regenerated ids, `pending_review` status, and new timestamps.
- GREEN evidence:
  - `npm test -- src/main/storage/storeProxy.test.ts src/main/toolAuditLog.test.ts src/main/storage/migrateRoundTrip.test.ts src/main/storage/repositories/repositories.test.ts src/main/storage/repositories/runRepository.test.ts src/main/chatSessionStore.test.ts src/main/workspaceRunStore.test.ts src/main/agentRunStore.test.ts src/main/agentTrajectoryStore.test.ts src/main/agentGoalStore.test.ts` -> 10 files / 86 tests passed.
  - `npm test` -> 164 files / 1046 tests passed.
  - `npm run build` -> passed.
  - `npm run verify` -> 164 files / 1046 tests passed; build passed; agent eval 26/26; memory eval 2/2.
  - `npm run smoke:prod` -> passed; renderer rendered agent chat UI, with designed JSON fallback for the local better-sqlite3 ABI mismatch.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.

## 2026-06-21 Task 1 Follow-up 2 Bare Shell Parent Path

- Request: fix production shell authorization when `ToolAuthorizationService` supplies a `ShellPlan` for `cat ..`; bare parent-directory operands were not included in `touchedPaths`, so sandbox authorization had nothing to inspect.
- Implementation:
  - `src/main/tools/shell/shellAnalyzer.ts`: classify exactly bare `..` as path-like while preserving ordinary bare-word args.
  - `src/main/tools/shell/shellAnalyzer.test.ts`: cover `cat ..`, `ls ..`, and quoted `..` operands.
  - `src/main/toolAuthorizationService.test.ts`: cover `authorizeToolCallWithinRunContext(..., { shellPlan: analyzeShell("cat ..") })` denying workspace escape.
- Verification evidence:
  - RED: `npm test -- src/main/tools/shell/shellAnalyzer.test.ts src/shared/toolPermissions.test.ts` failed before implementation with missing touched paths and authorization approval.
  - `npm test -- src/main/tools/shell/shellAnalyzer.test.ts src/shared/toolPermissions.test.ts src/main/toolAuthorizationService.test.ts` -> 3 files / 63 tests passed.
  - `npm run harness:check` -> passed.
  - `npm test` -> 164 files / 1035 tests passed.
  - `npm run build` -> passed.

## 2026-06-21 v2.5.0 Workspace-Bound Skill Execution

- Request: promote workspace into a first-class chat execution boundary, harden explicit skill invocation/execution, keep right-side process state recoverable, and ship a packaged v2.5.0 build for testing.
- Root cause fixed:
  - Chat sessions previously did not carry a workspace contract into model/tool execution, so the model had to infer paths and could spend many tool calls probing.
  - Explicit skill selection injected skill text, but chat execution did not yet carry a workspace-bound runtime task and dynamic skill/MCP tools could be registered on a different executor than chat used.
  - Right-rail status was recoverable from session activity, but long process history still needed a durable workspace-run ledger beyond the bounded UI cache.
- Implementation:
  - `src/shared/agentWorkspace.ts`, `src/shared/chat.ts`, `src/main/chatSessionStore.ts`: add/persist workspace contract identity and chat workspace summaries.
  - `src/renderer/components/AgentChatPanel.tsx`, `src/renderer/styles/composer.css`: add composer workspace selector, preserve restored session workspace, and send `workspaceId` with chat turns.
  - `src/main/chatService.ts`, `src/main/agentLoop.ts`, `src/main/agentToolExecutor.ts`, `src/shared/agentProtocol.ts`: resolve `AgentRunContext`, pass `taskId`/`runtimeTask` into chat agent loop, default native code-tool `workspaceRoot` from run context, and honor skill `execution.maxTurns`.
  - `src/shared/skillExecutionContract.ts`: add staged skill execution contract and transition tests.
  - `src/shared/workspaceRunLedger.ts`, `src/main/workspaceRunStore.ts`: add JSONL workspace-run ledger and dual-write chat status events for replay-grade process records.
  - `src/main/container.ts`: reuse a single dynamic tool executor so skill/MCP tools remain available after initialization; inject workspace and workspace-run services into chat.
  - Release metadata, README, and `.zerox/feature_list.json` updated to v2.5.0.
- Remaining tracked follow-ups:
  - `SkillExecutionService` as a first-class main-process service is still left in the plan for a later iteration; this release ships the shared contract plus chat/runtime integration.
  - Run Graph/episode export UI for workspace-run ledgers is not yet surfaced; ledger files are written locally and covered by store/projection tests.
- Test growth: 161 files / 1002 tests -> **164 files / 1019 tests** (+3 files, +17 tests). Zero regression.
- Verification evidence:
  - Focused workspace/skill/ledger tests: `npm test -- src/main/chatSessionStore.test.ts src/shared/skillExecutionContract.test.ts src/shared/workspaceRunLedger.test.ts src/main/workspaceRunStore.test.ts` -> 4 files / 26 tests passed.
  - Focused execution tests: `npm test -- src/main/chatService.test.ts src/main/agentToolExecutor.test.ts src/main/agentLoop.test.ts src/shared/agentProtocol.test.ts` -> 4 files / 89 tests passed.
  - Focused UI/activity tests: `npm test -- src/renderer/materialDesign.test.ts src/shared/skillMentions.test.ts src/renderer/chatTaskActivityRestore.test.ts` -> passed.
  - `npx tsc -p tsconfig.electron.json --noEmit --pretty false` -> passed.
  - `npm run verify` -> 164 files / 1019 tests passed; build passed; agent eval 26/26; memory eval 2/2.
  - `npm run smoke:prod` -> passed; renderer rendered agent chat UI. Source-tree smoke continues to fall back to JSON when the local better-sqlite3 binary targets a different ABI.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.
  - `npm run dist:mac` -> generated `release/Zerox Agent-2.5.0-arm64.dmg` and `release/Zerox Agent-2.5.0-arm64-mac.zip`; `better-sqlite3` rebuilt for Electron packaging and restored after packaging.
  - Packaged app version smoke: `BUILDING_AGENT_SMOKE=1 BUILDING_AGENT_SMOKE_REQUIRED_TEXTS='v2.5.0' "release/mac-arm64/Zerox Agent.app/Contents/MacOS/Zerox Agent"` -> passed.
  - Package metadata: `release/mac-arm64/Zerox Agent.app/Contents/Info.plist` reports `CFBundleShortVersionString=2.5.0` and `CFBundleVersion=2.5.0`.
- Artifacts:
  - `release/Zerox Agent-2.5.0-arm64.dmg` (122M, sha256 `e5180ae1d79845ed725658424fd9d99423fc5d9fa20aa6b5fd2482a60ee65bb2`)
  - `release/Zerox Agent-2.5.0-arm64.dmg.blockmap` (131K, sha256 `02c1acd141df33524c41fe36ce256dec760fbb9718fb002f754b08efa50f4a40`)
  - `release/Zerox Agent-2.5.0-arm64-mac.zip` (333M, sha256 `592f48bc8247d0ba22a635ac782b2f2e0cbba8f1473a21864d9f33ea781de344`)
  - `release/Zerox Agent-2.5.0-arm64-mac.zip.blockmap` (336K, sha256 `bfaa92782401e98728d8e1b39111c41eb1901d2c2c87703a66e976f3cd0e7a84`)

## 2026-06-20 v2.4.7 Tool Failure Recovery Hotfix

- Request: investigate the packaged-app `@onepager` run that stopped at "连续工具失败，等待确认" after repeated `file_read` / `file_list` failures, then ship a testable hotfix package.
- Root cause fixed:
  - `AgentLoop` paused immediately after three same-class tool failures. For long skill-driven project analysis, a few guessed or stale file paths could stop the run before the model got a chance to recover with a safer discovery strategy.
  - Tool-failure UI/status text only showed generic `工具失败：file_read/file_list` and the pause summary collapsed missing-path errors into `tool_error`, so the right rail did not expose the failed path or concrete reason.
- Implementation:
  - `src/main/agentLoop.ts`: gives the model one recovery turn after repeated same-class tool failures before pausing, resets the streak for that recovery turn, and includes the latest error/arguments in any later pause continuation and summary.
  - `src/main/agentLoop.ts`: classifies missing-path errors (`ENOENT`, "not found", "no such file", etc.) as `not_found` instead of generic `tool_error`.
  - `src/main/chatService.ts`: includes summarized tool execution errors in chat task status events so the right rail can show the actual failure reason.
  - Release metadata and README updated to v2.4.7.
- Test growth: 161 files / 1000 tests -> **161 files / 1002 tests** (+2 tests). Zero regression.
- Verification evidence:
  - Focused tests: `npm test -- src/main/agentLoop.test.ts src/main/chatService.test.ts src/shared/packageScripts.test.ts src/shared/readme.test.ts` -> 4 files / 51 tests passed.
  - `npm run build` -> TypeScript + Vite production build passed.
  - `npm test` -> 161 files / 1002 tests passed.
  - `npm run verify` -> 161 files / 1002 tests passed; build passed; agent eval 26/26; memory eval 2/2.
  - `npm run smoke:prod` -> passed; renderer rendered agent chat UI. better-sqlite3 ABI mismatch fell back to JSON as designed.
  - `npm run harness:check` -> passed.
  - `npm run dist:mac` -> generated `release/Zerox Agent-2.4.7-arm64.dmg` and `release/Zerox Agent-2.4.7-arm64-mac.zip`; `better-sqlite3` rebuilt for Electron packaging and restored for local Node after packaging.
  - Packaged app smoke: `BUILDING_AGENT_SMOKE=1 "release/mac-arm64/Zerox Agent.app/Contents/MacOS/Zerox Agent"` -> passed.
  - Packaged app version smoke: `BUILDING_AGENT_SMOKE=1 BUILDING_AGENT_SMOKE_REQUIRED_TEXTS='v2.4.7' "release/mac-arm64/Zerox Agent.app/Contents/MacOS/Zerox Agent"` -> passed.
  - Package metadata: `release/mac-arm64/Zerox Agent.app/Contents/Info.plist` reports `CFBundleShortVersionString=2.4.7` and `CFBundleVersion=2.4.7`.

## 2026-06-20 v2.4.6 Explicit Skill Invocation + Activity Recovery

- Request: fix chat turns that verbally request a skill but do not actually load/use that skill; add `@skill` fuzzy selection in the composer; restore the right-side progress/context modules after switching away from and back to a conversation.
- Root cause fixed:
  - Skill intent was only text inside the user message. Chat routing could infer and solve the task directly without converting the selected/named skill into an execution contract.
  - Chat task activity lived in renderer state only. When navigating to another section/session, the session reload rebuilt messages but dropped task status history, leaving the right rail empty.
- Implementation:
  - `src/shared/skillMentions.ts`: active `@` extraction, fuzzy matching, replacement, and natural-language skill request detection.
  - `src/renderer/components/AgentChatPanel.tsx` + `src/renderer/styles/composer.css`: `@skill` menu, highlighted selected-skill chip, send payload carrying `selectedSkillName`, and right-rail restore from persisted activity.
  - `src/main/chatService.ts`: resolves selected/named skills via discovery, emits `skill` status, injects the full `SKILL.md` body into the model context, skips task routing for skill requests, and records `skill_invoked` trajectory evidence.
  - `src/main/chatSessionStore.ts` + `src/shared/chat.ts`: persists bounded chat activity snapshots on the session record and normalizes them on reload.
  - Release metadata and README updated to v2.4.6.
- Test growth: 159 files / 992 tests -> **161 files / 1000 tests** (+2 files, +8 tests). Zero regression.
- Verification evidence:
  - Focused tests: `npm test -- src/shared/skillMentions.test.ts src/renderer/chatTaskActivityRestore.test.ts src/main/chatService.test.ts src/main/chatSessionStore.test.ts src/renderer/materialDesign.test.ts src/shared/packageScripts.test.ts src/shared/readme.test.ts` -> 7 files / 84 tests passed.
  - `npm run build` -> TypeScript + Vite production build passed.
  - `npm test` -> 161 files / 1000 tests passed.
  - `npm run verify` -> 161 files / 1000 tests passed; build passed; agent eval 26/26; memory eval 2/2.
  - `npm run smoke:prod` -> passed; renderer rendered agent chat UI. better-sqlite3 ABI mismatch fell back to JSON as designed.
  - `npm run harness:check` -> passed.
  - Rendered UI check: dev Electron at `127.0.0.1:5173` showed v2.4.6; DOM interaction with `@one` opened the skill menu, selecting the first candidate changed the input to `@onepager` and rendered the highlighted `@onepager` chip.
  - `npm run dist:mac` -> generated `release/Zerox Agent-2.4.6-arm64.dmg` and `release/Zerox Agent-2.4.6-arm64-mac.zip`; `better-sqlite3` rebuilt for Electron packaging and restored for local Node after packaging.
  - Packaged app smoke: `BUILDING_AGENT_SMOKE=1 "release/mac-arm64/Zerox Agent.app/Contents/MacOS/Zerox Agent"` -> passed.
  - Packaged app version smoke: `BUILDING_AGENT_SMOKE=1 BUILDING_AGENT_SMOKE_REQUIRED_TEXTS='v2.4.6' "release/mac-arm64/Zerox Agent.app/Contents/MacOS/Zerox Agent"` -> passed.

## 2026-06-20 v2.4.5 System Prompt Architecture Refactoring

- Request: Deep-research MiMo-Code's system prompt architecture and refactor zerox-agent's monolithic `buildAgentSystemPrompt()` into a layered, cache-aware, model-profiled system with runtime conditional injections.
- Priority order (user-confirmed): P0 = layered assembly + memory instructions + system-reminder injections; P1 = model-specific .txt files + date anchoring + multi-segment Anthropic system messages.
- Phase 1 (Layered Assembly): `src/shared/systemPromptLayer.ts`, `systemPromptAssembler.ts`, `systemPromptLayerProviders.ts` (7 providers). `buildAgentSystemPrompt()` delegates to assembler with byte-identical output. Fixed `agentRunnerService` missing modelId bug.
- Phase 2 (Memory Instructions): `src/shared/memorySystemInstructions.ts` (~60 lines Chinese). `agent.memory` layer (order=3.5) in agent/chat/goal modes.
- Phase 3 (System-Reminder): `src/shared/systemReminder.ts`, `src/main/systemReminderTriggers.ts` (6 triggers), `systemReminderRegistry.ts`. Injected into `agentLoop.ts` before each model call. All triggers default OFF.
- Phase 4 (Model-Specific Prompts): `prompts/*.txt` (6 files, 30-50 lines each). `src/main/promptFileLoader.ts` with cache/test injection. `electron-builder.yml` updated.
- Phase 5 (Cache): Date anchoring in all 5 callers. Multi-segment Anthropic system (`ZEROX_MULTI_SEGMENT_SYSTEM=1`, default off).
- Test growth: 153 files / 931 tests → **159 files / 992 tests** (+6 files, +61 tests). Zero regression.
- Verification: `npx tsc` passed (both configs). `npm test` 159/992 passed.

## 2026-06-19 2.4.0 iteration acceptance — all 8 phases delivered

- The 2.4.0 mega-iteration per `iteration-roadmap/` is complete. All eight
  phases (P1–P8) are implemented, each with co-located tests, behind feature
  flags (default conservative → zero regression), and verified.
- Phase delivery (commits): P1 9376b8f · P2 00be441 · P3 811da79 ·
  P4 4878079 · P5 4fa2173 · P6 c9662d7 · P7 c131903 · P8 f3cc94f.
- Test growth: 135 files / 767 tests → **149 files / 896 tests** (+14 files,
  +129 tests; zero regression — every pre-existing test still passes).
- Final acceptance gates:
  - `npm run verify` -> 149 files / 896 tests passed; build passed; agent eval
    26/26; memory eval 2/2.
  - `npm run harness:check` -> passed.
  - `npm run smoke:prod` -> build passed; smoke startup passed; renderer
    rendered agent chat UI. (The better-sqlite3 NODE_MODULE_VERSION mismatch
    under `electron .` is the P1-spec-flagged native-ABI scenario; the
    container's fault-tolerant `storage()` singleton fell back to JSON and the
    app still rendered — designed behavior. `@electron/rebuild` +
    `electron-builder.yml: npmRebuild: true` is the tracked packaged-build step.)
- Contract status: `contracts v1.4` consumed by all phases; every phase's
  downstream-blocking Exit Criteria delivered (frozen Repository interfaces,
  LLMProvider+CachePrefix, ToolWorker+ShellPlan, ActorRuntime v0/full,
  WorkflowRuntime, CompactionStrategy read-side, dream/distill, StreamProcessor
  + MaxMode + McpTransport). Additive trajectory events (29 → 48) and runGraph
  node kinds (11 → 17) are pure additions — existing projections untouched
  (runGraph parity test stays green).
- Activation model: each phase's runtime integration (loop rewiring, tool
  registration, event emission, scheduler hooks) is staged behind flags with
  the contracts and repos already live — incremental cutover with zero-regression
  defaults, tracked as per-phase open follow-ups above.

## 2026-06-19 P8 Max-mode / streaming tool-calling / MCP multi-transport

- Request:
  - Final phase of the 2.4.0 iteration. P8 = full-streaming tool-calling
    (StreamProcessor consuming LLMProvider.stream) + max-mode/best-of-N (judge
    + actor replay) + MCP multi-transport (http/sse + OAuth) + runGraph cost
    model. Terminal phase (no downstream consumer).
- Implementation:
  - `src/shared/runGraph.ts` — added `model_response`/`ensemble` node kinds +
    `candidate_of` edge + `RunGraphTokenUsage`/`totalUsage` aggregation
    (Patch 11); additive `model_response` projection aggregates usage across
    responses (existing kinds/projections untouched).
  - New `src/main/providers/streamProcessor.ts` — `processStream`: consumes
    contract StreamEvent variants (text_delta/tool_call_delta/thinking_delta/
    done/error), aggregates into a CompleteResponse field-equivalent to the
    non-streaming path (minimal-change loop migration); rethrows on error.
  - New `src/main/providers/maxMode.ts` — `MaxMode.runStep`: N parallel
    propose-only candidates (toolChoice:none, schema-only, no exec) → judge
    selects winner → winner tool calls replayed via P6 ephemeral state actor
    (Patch 13 executedViaActor); ensembleTokens tracked but not in context;
    ZEROX_MAX_MODE flag (default off).
  - New `src/main/mcpTransport.ts` — `McpTransport` interface (start/send/
    onNotification/close, Patch 12) + StreamableHttpTransport + SseTransport
    (Bearer/OAuth) + factory; stdio preserves the existing mcpClient path
    (backward compat). resolveTransportKind defaults to stdio.
  - Tests: StreamProcessor aggregation (text+tool+thinking+done, synthesize,
    error rethrow), MaxMode (N candidates + judge + actor replay + flag), MCP
    transports (kind resolution, http JSON-RPC round-trip, stdio legacy),
    runGraph model_response + totalUsage aggregation.
- Verification evidence:
  - `npx tsc -p tsconfig.electron.json --noEmit` -> passed.
  - `npm test` -> 149 files / 896 tests passed (was 148/886; +10).
  - `npm run verify` -> build passed; agent eval 26/26; memory eval 2/2.
  - `npm run harness:check` -> passed.
- Open follow-ups (non-blocking; activation cutover):
  - Rewire `agentLoop`/`agentRuntimeEngine` request path through
    `processStream` (streaming processor); preserve non-stream fallback.
  - Wire `MaxMode` behind ZEROX_MAX_MODE in the loop's model-request step.
  - Route MCP http/sse transports through `createMcpTransport` in
    `initializeMcpTools` (stdio unchanged); OAuth PKCE + local callback.
  - Emit `model_response` trajectory events with usage/cache fields from the
    provider CompleteResponse.

## 2026-06-19 P7 Dream / Distill self-improvement loop

- Request:
  - Continue the 2.4.0 iteration. P7 = dream (LLM/history-driven distillation of
    persistent project knowledge + stale pruning) + distill (cluster repeated
    workflows → package as skills via registerWorkflowAsSkill). Terminal phase
    (no downstream consumer except P8, which is independent).
- Implementation:
  - `src/shared/memory.ts` — added `MemorySource` dream/distill variants (Patch 23)
    + broadened `archiveReason` to `MemoryArchiveReason` union (Patch 22).
  - `src/shared/agentTrajectory.ts` — added dream_*/distill_* event types (41 → 48).
  - `src/shared/runGraph.ts` — added `dream`/`distill` node kinds + additive
    projection (Patch 25; existing kinds/projections untouched).
  - `src/main/storage/repositories/memoryRepository.ts` — dream/distill-sourced
    memories auto-assigned `scope:"project"` (others global).
  - New `src/main/actors/dreamService.ts` — `runDream`: background state actor
    (P6 ActorRuntime) read-only scans trajectory/sessions/memories → rule-based
    distill (recurring tool bigrams, failure patterns, stale detection) →
    auto-writes high-confidence findings (≥0.7) as project memories
    (source:{type:"dream"}) + prunes superseded/stale; low-confidence →
    learning_candidates queue (layered coexistence per spec).
  - New `src/main/actors/distillService.ts` — `runDistill`: clusters repeated
    3-tool sequences across runs → packages high-confidence clusters (≥0.7) as
    skills via registerWorkflowAsSkill; low-confidence → queue.
  - `src/main/workflow/registerWorkflowAsSkill.ts` — implemented (fills P6
    placeholder): path-guarded SKILL.md write to skillsDir (slug validation +
    traversal rejection + containment check) + dynamic workflow catalog entry.
  - Tests: dream auto-write+prune, low-confidence queue, ruleBasedDistill bigrams;
    distill cluster+package; registerWorkflowAsSkill write+path-guard; runGraph
    dream/distill additive projection.
- Verification evidence:
  - `npx tsc -p tsconfig.electron.json --noEmit` -> passed.
  - `npm test` -> 148 files / 886 tests passed (was 147/878; +8).
  - `npm run verify` -> build passed; agent eval 26/26; memory eval 2/2.
  - `npm run harness:check` -> passed.
- Open follow-ups (non-blocking; activation cutover):
  - Wire `runDream`/`runDistill` to the task scheduler (scheduled self-improvement)
    + `/dream` `/distill` commands.
  - Emit dream_*/distill_* trajectory events from the services.
  - LLM-backed `distill` override (rule-based is the reliable default).

## 2026-06-19 P6 Actor model full + Workflow runtime

- Request:
  - Continue the 2.4.0 iteration. P6 = actor model full (extends P5 v0 with
    send/inbox/background/outputSchema/contextMode:none|state/peer) + Workflow
    runtime (§6) + deep-research + runGraph actor/workflow nodes. Unblocks P7
    (dream/distill via background actors + workflow + registerWorkflowAsSkill)
    and P8 (max-mode replay via ephemeral state actors).
- Implementation:
  - ActorRuntime full: extended `spawn` with `background`/`outputSchema`/
    `parentActorId` + `send` (inbox) + outcome `value` (validated against
    outputSchema). v0 path (contextMode:"full", no send/background/outputSchema)
    frozen — parity-tested.
  - New `src/main/actors/`: `actorInbox.ts` (ActorInbox + MAX_PRE_REACT=4),
    `actorOutputSchema.ts` (lightweight JSON-Schema subset validator — no Ajv
    bundle risk per R10), `actorWorkflowOptions.ts` (ZEROX_ACTOR_RUNTIME
    full|v0|legacy + ZEROX_WORKFLOW_RUNTIME on|off).
  - New `src/main/workflow/`: `workflowRuntime.ts` (WorkflowRuntime +
    WorkflowSandbox host hooks agent/webfetch/websearch/parallel/pipeline;
    WORKFLOW_PARALLEL_MAX=8, AggregateError, failFast, deadline), `deepResearchWorkflow.ts`
    (plan→search→extract→group→3-voter verify REJECT_QUORUM=2→report, 15 source/
    25 fact caps), `registerWorkflowAsSkill.ts` (P7 placeholder, throws
    not-implemented per spec O7).
    - Deviation note (spec R1): QuickJS (`quickjs-emscripten`) WASM carries
      Electron-packaging cost; the spec permits a fallback. This runs registered
      workflow functions (not arbitrary eval) with a frozen host-hook surface —
      the orchestration value P7 needs. A QuickJS-backed sandbox can replace the
      executor behind the same WorkflowSandbox interface.
  - `src/shared/agentTrajectory.ts` — added actor_message_* + workflow_* event
    types (32 → 41).
  - `src/shared/runGraph.ts` — added `actor`/`workflow` node kinds +
    `spawned_by` edge + additive projection branches (existing 11 kinds / 29
    trajectory projections untouched; runGraph.test + parity test stay green).
  - `container.ts` — `workflowRuntime()` accessor (deep-research registered
    eagerly; host hooks delegate to actor runtime).
- Verification evidence:
  - `npx tsc -p tsconfig.electron.json --noEmit` -> passed.
  - `npm test` -> 147 files / 878 tests passed (was 146/861; +17: actor full
    send/background/outputSchema/contextMode-state, inbox, outputSchema,
    workflow parallel/pipeline/deep-research, runGraph actor/workflow additive,
    flags, placeholder).
  - `npm run verify` -> build passed; agent eval 26/26; memory eval 2/2.
  - `npm run harness:check` -> passed.
- Open follow-ups (non-blocking downstream; tool/registry activation cutover):
  - Register `actor`/`workflow` tools on `DynamicToolRegistry` + extend
    `AgentToolName` (operation run/spawn/status/wait/cancel/send; run/list).
  - Wire workflow host hooks webfetch/websearch to the real tool handlers.
  - Emit actor_message_*/workflow_* trajectory events from the runtime.
  - QuickJS-backed WorkflowSandbox (replace Node executor behind same interface).

## 2026-06-19 P5 Checkpoint-writer fork agent (ActorRuntime v0)

- Request:
  - Continue the 2.4.0 iteration. P5 = checkpoint-writer fork agent (contracts
    v1.4 §5): `ActorRuntime` v0 (spawn/wait/cancel/status) + `ForkContext`
    (byte-stable prompt-cache prefix reuse) + the fork actor that cold-reads
    the transcript and writes the 11-segment markdown checkpoint. Unblocks P6
    (extends ActorRuntime v0 → full) and P8 (max-mode replay via actor).
- Implementation:
  - New `src/main/actors/`:
    - `actorRuntime.ts` — `ActorRuntime` v0 (`spawn` contextMode:"full" only +
      `wait`/`cancel`/`status`), `SpawnInput`/`ForkContext`/`ActorOutcome`/
      `ActorHandle` types; records lifecycle in the P1 `actors` table
      (ActorRepository); delegates execution to an injected `runActor` callback
      (testable, no hard subprocess/LLM coupling).
    - `forkContext.ts` — `buildForkContext` wraps P3 `buildCachePrefix` (byte-
      stable); `frozenAt` = trajectory seq at capture (Patch 16).
    - `checkpointWriterActor.ts` — cold-reads trajectory via `RunRepository.
      getTrajectory` → distills 11-segment markdown-v1 (LLM-optional, cache-
      aligned to parent prefix; rule-based `buildGoalContinuityCheckpoint`
      fallback) → writes via `CheckpointRepository.write(runId,"markdown",
      {source:"p5-fork"})`. Always reliable (error → error outcome, never blocks).
    - `checkpointWriterOrchestrator.ts` — trigger coordination: buildForkContext
      → spawn → wait → outcome; honors `ZEROX_CHECKPOINT_WRITER` flag.
    - `checkpointWriterOptions.ts` — `resolveCheckpointWriterFlag`
      (`p5-fork`|`p2-transition`|`off`, default `p5-fork`).
  - `src/shared/agentWorkspace.ts` — exported `buildChildSandboxPolicy` (public
    wrapper of private `narrowSandboxPolicy`, Patch 15) for P5/P6 child-sandbox
    narrowing.
  - `src/shared/agentTrajectory.ts` — added `actor_spawned`/`actor_done` event
    types (30 → 32).
  - `container.ts` — `runRepository()`/`actorRuntime()`/
    `checkpointWriterOrchestrator()` accessors.
- Verification evidence:
  - `npx tsc -p tsconfig.electron.json --noEmit` -> passed.
  - `npm test` -> 146 files / 861 tests passed (was 145/849; +12: buildChildSandboxPolicy,
    actor runtime lifecycle/cancel/error/storage, forkContext byte-stability,
    checkpoint-writer actor cold-read+write, orchestrator, flag).
  - `npm run verify` -> build passed; agent eval 26/26; memory eval 2/2.
  - `npm run harness:check` -> passed.
- Open follow-ups (non-blocking downstream; activation cutover is incremental):
  - Trigger `checkpointWriterOrchestrator.maybeWriteCheckpoint` from the runtime
    compact path (when `CompactionStrategy.shouldCompact` fires) and from
    milestone_accepted/goal_replanned ledger events (proactive refresh).
  - Retire P2's `markdownCheckpointWriter` once P5 fork-agent triggering is live
    (Patch 9 handover; read-side unchanged).
  - Emit `actor_spawned`/`actor_done` trajectory events from the runtime +
    project them to runGraph (Patch 21).

## 2026-06-19 P2 Context rebuild (CompactionStrategy + RebuildFromCheckpoint)

- Request:
  - Continue the 2.4.0 iteration. P2 = context rebuild (contracts v1.4 §4):
    overflow-priority rebuild from a structured markdown checkpoint + project
    memories, replacing lossy-only summarization. Unblocks P5 (delivers the
    read-side consumption contract: RebuildFromCheckpoint + markdown-v1 format).
- Implementation:
  - New `src/shared/compactionMarkers.ts` — single source for
    `NEVER_COMPACT_MARKER`/`REBUILD_BOUNDARY_MARKER`/`CONTEXT_BUDGET_RATIO`
    (collapses the three duplicate marker literals).
  - New `src/main/kernel/compactionStrategy.ts` — `CompactionStrategy`/
    `CompactionContext`/`CompactionResult` + `SummarizeCompaction` (byte-
    equivalent wrapper over `contextManager.compressMessages` — the eval
    non-regression guarantee) + `RebuildFromCheckpoint` (reads
    `CheckpointRepository.latest(runId,"markdown")` + `MemoryRepository.search`,
    retains recent tail, microcompacts regenerable tool results, inserts
    `rebuildBoundary`) + `selectCompactionStrategy`/`resolveCompactionFlag`.
  - New `src/main/kernel/markdownCheckpointWriter.ts` — approved transition
    sole writer (source:"p2-transition") of 11-segment markdown-v1 checkpoints
    via `CheckpointRepository.write(runId,"markdown",...)`; P5 takes over and
    this module is deleted, read-side unchanged (Patch 9).
  - `src/shared/agentTrajectory.ts` — added `"context_rebuilt"` to the event
    union (29 → 30 types).
  - `container.ts` — `checkpointRepository()`/`memoryRepository()`/
    `compactionStrategy()` accessors (from the P1 Storage singleton).
- Verification evidence:
  - `npx tsc -p tsconfig.electron.json --noEmit` -> passed.
  - `npm test` -> 145 files / 849 tests passed (was 144/839; +10: markers,
    summarize byte-equivalence, rebuild from checkpoint, degrade, writer).
  - `npm run verify` -> build passed; agent eval 26/26; memory eval 2/2.
  - `npm run harness:check` -> passed.
- Open follow-ups (non-blocking downstream; activation cutover lands with P5):
  - Rewire `agentLoop.compactMessagesBeforeModelRequest` + `agentRuntimeEngine`
    compact path to route through `compactionStrategy` (opt-in `compactionDeps`;
    default `auto` degrades to summarize = current behavior — zero regression).
  - Trigger `markdownCheckpointWriter` from `goalRuntimeEngine` on goal-start +
    milestone-accepted/goal-replanned ledger events (P5 fork-agent takes over).
  - Emit `context_rebuilt` trajectory event from the rewired compact path.

## 2026-06-19 P4 Shell analysis + tool subprocess isolation

- Request:
  - Continue the 2.4.0 iteration. P4 = shell parsing + tool subprocess isolation
    (contracts v1.4 §3): `analyzeShell` → `ShellPlan` (single source of truth for
    shell permission decisions, replacing wildcard + naive-tokenizer matching)
    and `ToolWorker` (side-effect tools execute out-of-process). Unblocks P5
    (fork agent reuses ToolWorker fork/IPC) and P6 (actor isolation).
- Implementation:
  - New `src/main/tools/`:
    - `shell/shellAnalyzer.ts` — `analyzeShell(raw, {cwd})` → `ShellPlan`
      (commands with per-command readsPaths/writesPaths, touchedPaths union,
      controlOperators incl. `$()`/backtick/redirects, networkAccess). Robust
      tokenizer: control-operator splitting, command-substitution capture,
      redirection-target classification, `~`/`$VAR` expansion.
      - Deviation note (spec R1/Q4): tree-sitter bash grammar is a native
        module with Electron ABI packaging cost; the spec explicitly permits a
        fallback. This tokenizer captures the injection-detection security
        value without a second native dep. `ZEROX_SHELL_ANALYZER=legacy`
        falls back to the original regex behavior.
    - `toolWorkerProtocol.ts` — `WorkerRunContext` (serializable subset of
      AgentRunContext: workspaceRoot, sandbox, provenanceIdentity, runId),
      `WorkerRequest`/`WorkerResponse`, `ToolHandler`.
    - `toolWorker.ts` — `ToolWorker` interface + `createToolWorker({mode})`:
      `inproc` (handler-map dispatch) + `subprocess` (child_process.fork +
      IPC round-trip + timeout). Parent holds only the result.
    - `toolWorkerEntry.ts` — subprocess entry template (IPC dispatch, handler
      registry, no main-process singletons). P5/P6 actor entries extend this.
    - `toolWorkerOptions.ts` — `ZEROX_TOOL_WORKER` (inproc|subprocess) +
      `ZEROX_SHELL_ANALYZER` (legacy|shadow|plan) flags (Patch 7; honors
      BUILDING_AGENT_ legacy alias).
  - `container.ts` — `shellAnalyzer()` + `toolWorker()` accessors for P5/P6;
    existing side-effect tools run in-process unchanged (gradual cutover
    behind flags — zero regression).
- Verification evidence:
  - `npx tsc -p tsconfig.electron.json --noEmit` -> passed.
  - `npm test` -> 144 files / 839 tests passed (was 142/822; +17: 10 analyzer
    incl. injection-bypass cases, 7 toolWorker incl. real subprocess IPC).
  - `npm run verify` -> build passed; agent eval 26/26; memory eval 2/2.
  - `npm run harness:check` -> passed.
- Open follow-ups (non-blocking downstream):
  - Wire `ShellPlan` into the two permission layers (`permissionEngine` +
    `toolPermissions.authorizeToolCallWithinRunContext`) in `shadow` then `plan`
    mode (default `shadow`/`legacy` keeps current decisions — zero regression).
  - Route `shell_exec`/`file_write`/`file_apply_moves`/`test_run`/
    `chrome_bookmarks_read` through `ToolWorker` (default inproc; subprocess
    cutover behind `ZEROX_TOOL_WORKER`).
  - Unify the two divergent control-operator regexes onto `ShellPlan`.

## 2026-06-19 P3 Provider abstraction + native Anthropic/Gemini + prompt cache

- Request:
  - Continue the 2.4.0 iteration. P3 = model-layer abstraction (contracts
    v1.4 §2): frozen `LLMProvider` interface + `NormalizedMessage`/`NormalizedContent`
    + three providers (OpenAI-compatible / Anthropic / Gemini) + prompt-cache
    `CachePrefix` + real `countTokens` + `stream()` signature. Unblocks P5
    (fork-agent cache-prefix reuse) and P8 (streaming/max-mode).
- Implementation:
  - New `src/main/providers/`:
    - `provider.ts` — frozen `LLMProvider`/`ProviderCapabilities`/`NormalizedMessage`/
      `NormalizedContent` (contract §2.1 verbatim) + dependency types
      (`ProviderId`/`CompleteRequest`/`CompleteResponse`/`StreamEvent`/`CachePrefix`/
      `ToolCall`/`ToolDefinition`, §12 Patch 2/3 authoritative shape).
    - `normalize.ts` — lossless `ChatMessage` ⇄ `NormalizedMessage` round-trip
      (the key to zero-regression adapter routing).
    - `cachePrefix.ts` — pure byte-stable `buildCachePrefix` + `serializeCachePrefix`.
    - `openAiCompatibleProvider.ts` — wraps the existing client; maps low-level
      `content_delta`→contract `text_delta`; heuristic `countTokens`; 0 cache tokens.
    - `anthropicProvider.ts` — native Messages API (x-api-key + anthropic-version,
      tool_use/tool_result, thinking, `cache_control` breakpoint, `/v1/messages/count_tokens`).
    - `geminiProvider.ts` — native generateContent (x-goog-api-key, functionCall/
      functionResponse, thinkingConfig, cachedContent, `:countTokens`).
    - `providerFactory.ts` — dispatch by `providerId` (default `openai-compatible`).
    - `providerChatClient.ts` — adapter implementing `ChatClient & StreamingChatClient`,
      routing legacy consumers through a provider transparently.
  - `src/shared/modelSettings.ts` + `src/main/modelSettingsStore.ts` — added
    optional `providerId` (default `openai-compatible`); backward-compatible
    (absent on old `model-settings.json` → treated as default; no schemaVersion bump).
  - `src/main/container.ts` — `getProvider()` accessor (async, settings-driven)
    for P5/P8 consumption; existing `createOpenAiCompatibleClient` wiring unchanged
    (gradual migration via adapter — zero regression).
- Verification evidence:
  - `npx tsc -p tsconfig.electron.json --noEmit` -> passed.
  - `npm test` -> 142 files / 822 tests passed (was 141/810; +12 provider tests).
  - `npm run verify` -> build passed; agent eval 26/26; memory eval 2/2.
  - `npm run harness:check` -> passed.
- Open follow-ups (non-blocking downstream):
  - Rewire the 8 `createOpenAiCompatibleClient` container points to
    `createProviderChatClient(getProvider())` (gradual; default openai-compatible
    is behavior-identical, so this is a no-op until users pick anthropic/gemini).
  - Migrate `agentLoop`/`agentRuntimeEngine` to depend on `LLMProvider` directly.
  - `selectAgentPromptProfile(modelId, providerId?)` extension.
  - Live-API eval fixtures (anthropic-tooluse / gemini-functioncall / prompt-cache-hit)
    require provider API keys; mock-fetch unit tests cover the mapping for now.

## 2026-06-19 P1 SQLite unified storage layer (2.4.0 iteration)

- Request:
  - Begin the 2.4.0 mega-iteration per `iteration-roadmap/`. P1 = SQLite unified
    storage layer (contracts v1.4 §1). Deliver the frozen `Storage` + Repository
    interfaces that P2/P5/P6/P7 consume, plus a dual-write migration path off the
    legacy JSON/JSONL stores, without regressing the existing 767 tests / 26 eval.
- Registration:
  - Added P1 as the in-progress feature on the `codex/v2.3.5-run-graph-harness`
    branch. Repository layer is the downstream-blocking contract; store-by-store
    dual-write proxy conversion is incremental.
- Implementation:
  - Added deps: `better-sqlite3@^11`, `drizzle-orm@^0.36`, `drizzle-kit@^0.30`,
    `@types/better-sqlite3@^7`, `@electron/rebuild@^3` (native module rebuild for
    Electron packaging).
  - New `src/shared/storageContract.ts`: frozen `Storage` + Repository interfaces
    (Storage, Run/Trajectory, Checkpoint, Memory, Goal, Session+Actor, Task,
    ToolAudit, ToolResult, Workspace, Artifact, Learning, EvalCandidate,
    Validation, MemoryProfile) + `CheckpointKind`, `MemoryScope`,
    `MemoryArchiveReason`. Moved `ProgressLedgerEvent` → `shared/agentGoal.ts`
    and `AgentWorkspaceInput` → `shared/agentWorkspace.ts` (re-exported from main
    for backward compatibility) so the shared contract can reference them.
  - New `src/main/storage/`:
    - `storageDb.ts` — `Storage` service (WAL, foreign_keys, FTS5 self-check,
      eager idempotent migrations, `backup()`); `createInMemoryStorage` /
      `createTempFileStorage` test helpers.
    - `migrationBundle.ts` (auto-generated from `migrations/*.sql`) +
      `migrations/0000_initial.sql` (all §1.2 tables + v1.1 patch tables +
      FTS5 `memory_fts` + sync triggers + indexes) + `scripts/sync-migration-bundle.mjs`.
    - `repositories/` — 17 repositories implementing the frozen interfaces
      (run, trajectory, checkpoint, memory, goal, session, actor, task,
      toolAudit, toolResult, workspace, artifact, learning, evalCandidate,
      validation, memoryProfile, promotedEvalFixture). Payload-column parity.
    - `backendResolver.ts` — `ZEROX_STORAGE_BACKEND` (`json`|`sqlite`|`dual`).
  - Store dual-write proxies (public signatures unchanged; default `json` =
    zero regression): `agentRunStore`, `agentTrajectoryStore` converted; others
    remain on JSON pending cutover (repositories exist for downstream phases).
  - `container.ts` — fault-tolerant `storage()` singleton + `storageBackend()`;
    the two converted stores receive `backend` + `storage`. Falls back to `json`
    if better-sqlite3 fails to load.
  - `scripts/migrate-to-sqlite.mjs` (idempotent JSON→SQLite, `--dry-run`/
    `--verify`, per-file error isolation) + `scripts/rollback-sqlite-to-json.mjs`
    (SQLite→JSON, freezes existing JSON as `*.legacy.json`).
  - `src/main/storage/README.md` (flag runbook, parity invariant, schema
    evolution, migration/rollback runbook, native-module note).
- Parity (observability hard constraint, contract §1.5):
  - `src/main/storage/runGraphParity.test.ts` — a golden run covering all 11
    node/gate-producing trajectory types yields deep-equal `projectRunGraph`
    output from JSON vs SQLite; `fromSeq` tail parity.
- Verification evidence:
  - `npx tsc -p tsconfig.electron.json --noEmit` -> passed.
  - `npm test` -> 140 files / 808 tests passed (was 135 / 767; +41 from the new
    storage layer; zero regression — existing store tests run on `backend:"json"`).
  - `npm run verify` (full build + agent eval 26/26 + memory eval 2/2) -> see
    evidence below.
- Open follow-ups (non-blocking downstream; tracked for cutover):
  - Convert the remaining 15 stores to dual-write proxies (chatSessionStore,
    memoryStore, agentGoalStore, multiAgentSessionStore, agentExecutionStore,
    kernel/checkpointStore, taskStore, toolAuditLog, toolResultOffloadStore,
    agentWorkspaceStore, agentValidationStore, memoryProfileStore,
    agentLearningStore, agentEvalCandidateStore, agentPromotedEvalFixtures).
    Each repository already exists; the conversion is mechanical.
  - `electron-builder.yml: npmRebuild: true` + `@electron/rebuild` for packaged
    `dist:mac` builds (native better-sqlite3 ABI).
  - Switch runtime default from `dual` to `sqlite` after a shadow-read period
    (T1.13 cutover runbook in `src/main/storage/README.md`).

## 2026-06-18 v2.3.6 release metadata and distribution handoff

- Request:
  - Continue after the P11.6 acceptance gate by packaging, publishing, updating the release, and pushing the v2.3.6 work.
- Registration:
  - Added `P11.7-v2.3.6-release-metadata-and-distribution` as the single in-progress feature after P11.6 closed.
  - Scoped P11.7 to the final package metadata bump, README/test release status, fresh macOS distribution artifacts, git push/tag, and GitHub Release handoff.
- Baseline evidence:
  - `./init.sh` -> harness check passed; `src/shared/packageScripts.test.ts` 7 tests passed with package metadata still at `2.3.5`.
  - `gh auth status` -> authenticated as `ZeroxZhang`; default branch detected as `main`.
- Changed files planned:
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`
  - `package.json`
  - `package-lock.json`
  - `README.md`
  - `src/shared/packageScripts.test.ts`
  - `src/shared/readme.test.ts`
- Implementation:
  - Bumped `package.json` and `package-lock.json` from `2.3.5` to `2.3.6`.
  - Updated README English and Chinese current release/current version text, quarantine examples, testing status, deterministic artifact release notes, and roadmap to describe v2.3.6 as released instead of metadata-pending.
  - Updated package/readme tests to assert the v2.3.6 release state and the completed P11.7 handoff feature.
  - Rebuilt the macOS dmg/zip distribution artifacts and generated no-space aliases matching `release/latest-mac.yml`.
  - Marked `P11.7-v2.3.6-release-metadata-and-distribution` done before the source commit that will be pushed, tagged, and used for the GitHub Release.
- Changed files:
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`
  - `package.json`
  - `package-lock.json`
  - `README.md`
  - `src/shared/packageScripts.test.ts`
  - `src/shared/readme.test.ts`
- Verification evidence:
  - `npm test -- src/shared/packageScripts.test.ts src/shared/readme.test.ts` -> 2 files / 10 tests passed after the initial v2.3.6 metadata bump.
  - `npm run verify` -> 135 files / 767 tests passed, build passed, agent eval 26/26, memory eval 2/2.
  - `npm run harness:check` -> passed.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - `npm run dist:mac` -> built `release/mac-arm64/Zerox Agent.app`, `release/Zerox Agent-2.3.6-arm64.dmg`, and `release/Zerox Agent-2.3.6-arm64-mac.zip`.
  - Packaged app Info.plist reports `CFBundleShortVersionString=2.3.6` and `CFBundleVersion=2.3.6`.
  - `release/latest-mac.yml` reports `version: 2.3.6`.
  - SHA-256:
    - dmg: `bad3dbe073da62c43b4e84fc1a55d92471528c26d5effefb900e1006838cff44`
    - zip: `d6db3aad5bdef997d6f212c10b3735a0ee53f58ca28c21dc90b03175927172de`
  - No-space release asset aliases match the same SHA-256 values:
    - `release/Zerox-Agent-2.3.6-arm64.dmg`
    - `release/Zerox-Agent-2.3.6-arm64-mac.zip`
  - `git commit -m "feat: ship deterministic artifact goals v2.3.6"` -> commit `131a699`.
  - `git push -u origin codex/v2.3.5-run-graph-harness` -> pushed `131a699` to the remote branch.
  - `git tag -a v2.3.6 -m "Zerox Agent v2.3.6" 131a699 && git push origin v2.3.6` -> pushed the `v2.3.6` tag.
  - `gh release create v2.3.6 ...` -> created `https://github.com/ZeroxZhang/zerox-agent/releases/tag/v2.3.6`.
  - `gh release view v2.3.6 --json url,tagName,isDraft,isPrerelease,name,assets` -> release is not draft, not prerelease, and contains:
    - `Zerox.Agent-2.3.6-arm64.dmg` size `123643137`, digest `sha256:bad3dbe073da62c43b4e84fc1a55d92471528c26d5effefb900e1006838cff44`
    - `Zerox.Agent-2.3.6-arm64-mac.zip` size `344885866`, digest `sha256:d6db3aad5bdef997d6f212c10b3735a0ee53f58ca28c21dc90b03175927172de`
    - `Zerox.Agent-2.3.6-arm64.dmg.blockmap` size `131163`
    - `Zerox.Agent-2.3.6-arm64-mac.zip.blockmap` size `339293`
  - GitHub Release asset names are normalized to the existing `Zerox.Agent-*` convention, so README quarantine examples were updated to match the published download names.

## 2026-06-18 P11.6 Command-Line And Packaged Acceptance Gate

- Request:
  - Close the v2.3.6 iteration with full command-line verification plus an independent packaged-app computer-use acceptance gate before treating v2.3.6 as complete.
- Registration:
  - Added `P11.6-command-line-and-packaged-acceptance-gate` as the single unfinished feature after P11.5 closed.
  - Scoped P11.6 to command-line verification, production smoke, fresh macOS packaging, and independent packaged-app UI acceptance evidence.
  - Kept package metadata at `2.3.5` until the final v2.3.6 release metadata bump.
- RED evidence:
  - `./init.sh` -> RED in `src/shared/packageScripts.test.ts`: the test still expected `P11.5-eval-docs-release-metadata` to be `in_progress` even though P11.5 had been correctly closed.
- Implementation:
  - Moved the unfinished-final-gate metadata assertion from P11.5 to `P11.6-command-line-and-packaged-acceptance-gate`.
  - Updated README English and Chinese status text so P11.5 was documented as completed and P11.6 was the then-current final gate.
  - Updated README verification counts to the current `npm run verify` result: 135 Vitest files / 767 tests.
- Changed files:
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`
  - `README.md`
  - `src/shared/packageScripts.test.ts`
  - `src/shared/readme.test.ts`
- GREEN evidence before packaged-app acceptance:
  - `npm test -- src/shared/packageScripts.test.ts src/shared/readme.test.ts` -> 2 files / 10 tests passed.
  - `./init.sh` -> harness check passed; `src/shared/packageScripts.test.ts` 7 tests passed.
  - `npm run verify` -> 135 files / 767 tests passed, build passed, agent eval 26/26, memory eval 2/2.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - `npm run dist:mac` -> built `release/mac-arm64/Zerox Agent.app`, `release/Zerox Agent-2.3.5-arm64.dmg`, and `release/Zerox Agent-2.3.5-arm64-mac.zip`.
  - Packaged app Info.plist reports `CFBundleShortVersionString=2.3.5` and `CFBundleVersion=2.3.5`; this is expected until the final v2.3.6 release metadata bump.
  - SHA-256:
    - dmg: `0e32feaf96ae2534c1d9ea7a7a559c01a671ef60d7d5469b782e953319ba8c51`
    - zip: `874c361716e98b17b88741da845813bae09c9b70b95974b35f12985ffba9f917`
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.
- Packaged-app acceptance defect found after the rejected gate:
  - Parent launched the fresh packaged app with a separate user data dir and Chrome DevTools Protocol after Computer Use `get_app_state` continued timing out on Electron apps.
  - The packaged renderer was production/packaged and created a real Chrome bookmarks goal from the UI.
  - The deterministic pipeline wrote fresh `/Users/zerox/Desktop/bookmark_list.md` and `/Users/zerox/Desktop/bookmark_list.md.provenance.json` using `chrome_bookmarks_read`.
  - The run trajectory showed deterministic pipeline success with `chrome_bookmarks_read` and artifact provenance, but the goal still ended `failed` because final acceptance fell back to `model_review` and the packaged app had incomplete model settings.
- Acceptance defect RED evidence:
  - `npm test -- src/main/goalChatService.test.ts src/main/agentGoalPlanner.test.ts` -> RED with 2 expected failures: deterministic bookmark contract goals were routed to quick-action review instead of planning, and the native planner requested the model for deterministic artifact/provenance criteria.
- Acceptance defect implementation:
  - Added shared task-contract acceptance synthesis for Chrome bookmark artifact/provenance checks.
  - Chat goal creation now compiles the deterministic task contract before choosing success criteria, uses artifact/provenance checks when available, and bypasses the generic quick-action review gate for deterministic contracts.
  - The native Chrome bookmark planner now accepts deterministic artifact/provenance success criteria and avoids duplicating artifact checks when the goal already owns them.
- Acceptance defect changed files:
  - `src/shared/agentTaskContractAcceptance.ts`
  - `src/main/goalChatService.ts`
  - `src/main/goalChatService.test.ts`
  - `src/main/agentGoalPlanner.ts`
  - `src/main/agentGoalPlanner.test.ts`
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`
- Acceptance defect GREEN evidence:
  - `npm test -- src/main/goalChatService.test.ts src/main/agentGoalPlanner.test.ts` -> 2 files / 24 tests passed.
  - `npm test -- src/main/goalChatService.test.ts src/main/agentGoalPlanner.test.ts src/main/agentGoalController.test.ts src/main/goalRuntimeEngine.test.ts src/main/agentDeterministicGoalPipeline.test.ts src/main/agentGoalAcceptance.test.ts` -> 6 files / 83 tests passed.
  - `npm run build` -> passed.
  - `npm run verify` -> 135 files / 764 tests passed, build passed, agent eval 26/26, memory eval 2/2.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - `npm test -- src/shared/packageScripts.test.ts src/shared/readme.test.ts` -> 2 files / 10 tests passed after updating README verification counts.
  - `npm run harness:check` -> passed.
- Structured destination acceptance defect found after rebuilding the packaged app:
  - Parent CDP drove the fresh packaged app UI from `release/mac-arm64/Zerox Agent.app` with a clean user data dir and a fresh Desktop artifact backup.
  - The new goal no longer contained `model_review` checks and the deterministic pipeline wrote fresh Desktop artifact/provenance files.
  - The goal still ended `failed` because `file_exists` evaluated `path: "bookmark_list.md"` relative to the workspace and ignored the structured destination `{ kind: "desktop", filename: "bookmark_list.md" }`.
- Structured destination RED evidence:
  - `npm test -- src/main/agentGoalAcceptance.test.ts src/main/goalOutputRoots.test.ts` -> RED with 2 expected failures: file_exists did not resolve structured Desktop destinations, and output-root extraction ignored acceptance destination metadata.
- Structured destination implementation:
  - `file_exists` acceptance now resolves structured `desktop`, `downloads`, and absolute `path` destinations through the existing location/sandbox resolver before checking the filesystem and artifact provenance.
  - Goal output-root extraction now includes roots from structured acceptance destinations, so deterministic artifact checks grant the same reviewed Desktop/Downloads boundaries as text-derived output locations.
- Structured destination changed files:
  - `src/main/agentGoalAcceptance.ts`
  - `src/main/agentGoalAcceptance.test.ts`
  - `src/main/goalOutputRoots.ts`
  - `src/main/goalOutputRoots.test.ts`
  - `README.md`
  - `src/shared/readme.test.ts`
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`
- Structured destination GREEN evidence:
  - `npm test -- src/main/agentGoalAcceptance.test.ts src/main/goalOutputRoots.test.ts src/main/goalChatService.test.ts src/main/agentGoalPlanner.test.ts` -> 4 files / 77 tests passed.
  - `npm run verify` -> 135 files / 766 tests passed, build passed, agent eval 26/26, memory eval 2/2.
- Covered goal-acceptance defect found after evidence destination fix:
  - Parent CDP drove the fresh packaged app UI again. The milestone became `accepted` and both artifact checks passed with provenance.
  - Final goal acceptance still failed because the same goal-level artifact checks were re-evaluated with `runId = goal.id`, while the provenance sidecars correctly record the milestone run id.
  - The failed final acceptance then tried to replan and hit missing model settings, producing the packaged-app `failed` terminal status.
- Covered goal-acceptance RED evidence:
  - `npm test -- src/main/agentGoalController.test.ts` -> RED on the new provenance-artifact coverage case: the controller did not treat accepted milestone evidence as covering goal-level artifact/provenance checks.
- Covered goal-acceptance implementation:
  - Generalized covered-goal acceptance beyond model review, but only for provenance-backed `file_exists` artifact checks so ordinary assertion goals still require final goal-level acceptance.
  - Added a controller regression test proving covered artifact/provenance goals reach `achieved` without duplicate goal-level provenance validation.
- Covered goal-acceptance changed files:
  - `src/main/agentGoalController.ts`
  - `src/main/agentGoalController.test.ts`
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`
- Covered goal-acceptance GREEN evidence:
  - `npm test -- src/main/agentGoalController.test.ts` -> 1 file / 11 tests passed.
  - `npm test -- src/main/goalChatService.test.ts src/main/agentGoalPlanner.test.ts src/main/agentGoalController.test.ts src/main/goalRuntimeEngine.test.ts src/main/agentDeterministicGoalPipeline.test.ts src/main/agentGoalAcceptance.test.ts src/main/goalOutputRoots.test.ts` -> 7 files / 105 tests passed.
  - `npm run verify` -> 135 files / 767 tests passed, build passed, agent eval 26/26, memory eval 2/2.
- Final parent packaged-app CDP verification after fixes:
  - `npm test -- src/shared/packageScripts.test.ts src/shared/readme.test.ts` -> 2 files / 10 tests passed.
  - `npm run harness:check` -> passed.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - `npm run dist:mac` -> built fresh `release/mac-arm64/Zerox Agent.app`, `release/Zerox Agent-2.3.5-arm64.dmg`, and `release/Zerox Agent-2.3.5-arm64-mac.zip`.
  - Packaged app Info.plist reports `CFBundleShortVersionString=2.3.5` and `CFBundleVersion=2.3.5`; this remains expected until the final release metadata bump.
  - SHA-256:
    - dmg: `e165e86ba8ca3a240c27e082b8b56a195bbb99112ca0888ffb105fb4e01b7772`
    - zip: `014d4defa1ec4d27c6ba2842237ea6cf119248f538912ccb9239978857212ae6`
  - Parent launched the packaged app from `release/mac-arm64/Zerox Agent.app` with `rendererMode=production`, `isPackaged=true`, and clean user data dir `/tmp/zerox-v236-final-cdp-20260617T194849Z`.
  - Parent drove the real chat UI input and send button through CDP with `/目标 读取当前 Chrome 书签，按文件夹/分组整理成 Markdown，保存到桌面 bookmark_list.md。`.
  - Resulting goal file `/private/tmp/zerox-v236-final-cdp-20260617T194849Z/config/agent-goals/goal_20a8971b-8bdd-4570-a258-a8f019f74763.json` ended `status=achieved`, `stopReason=goal_accepted`.
  - Goal and milestone success checks were only `file_exists`; `model_review` was absent.
  - Milestone `milestone_1` ended `accepted` with `lastRunStatus=succeeded` and summary `Deterministic Chrome bookmark artifact pipeline completed.`.
  - Fresh Desktop artifacts:
    - `/Users/zerox/Desktop/bookmark_list.md` -> size `50489`, sha256 `f3ffa60e237fb4f58fcf845944cbc8519577f99ba3866625ce9475c004a12669`, mtime `2026-06-17T19:49:33.773Z`.
    - `/Users/zerox/Desktop/goalEvidence.md` -> size `355`, sha256 `f29863a3bf2ef71f8a44f994db9c043f583cf3763b9c6900e28c9e35e6b5c073`, mtime `2026-06-17T19:49:33.774Z`.
  - Provenance sidecars matched artifact paths, sizes, and sha256 values for both `artifact:bookmark_list` and `artifact:goalEvidence`.
  - `git diff --check` -> passed.
- Final independent packaged-app acceptance:
  - Agent Lagrange (`019ed722-cfcc-74a3-9ce9-8ec0a1ec86a6`) independently ran the final packaged-app acceptance and returned `ACCEPTED`.
  - Computer Use participation:
    - `tool_search` found `mcp__computer_use`.
    - `list_apps` successfully enumerated `Zerox Agent`.
    - `get_app_state` by app path returned `remoteConnection` without a usable AX tree/screenshot.
    - `get_app_state` by `Zerox Agent` name timed out after roughly 120s, matching the previously observed Electron AX limitation.
    - Because AX state remained unavailable, the acceptance agent used shell launch plus CDP to drive the real packaged renderer UI.
  - The independent agent moved stale Desktop artifacts to `/Users/zerox/Desktop/zerox-v236-acceptance-backup-20260618-035117`.
  - Packaged runtime evidence:
    - `userDataPath=/private/tmp/zerox-v236-independent-acceptance-20260617T195544Z`
    - `configDir=/private/tmp/zerox-v236-independent-acceptance-20260617T195544Z/config`
    - `isPackaged=true`
    - `rendererMode=production`
    - `appPath=/Volumes/Out/codex_projects/building agent/release/mac-arm64/Zerox Agent.app/Contents/Resources/app.asar`
  - The independent agent used the real UI through CDP input/click events to submit `/目标 读取当前 Chrome 书签，按文件夹/分组整理成 Markdown，保存到桌面 bookmark_list.md`.
  - Independent goal file `/private/tmp/zerox-v236-independent-acceptance-20260617T195544Z/config/agent-goals/goal_3a5d3710-17f4-4726-b5ed-d1875a8e799a.json` ended `status=achieved`, `stopReason=goal_accepted`.
  - Independent milestone evidence: `state=accepted`, `lastRunStatus=succeeded`, `lastRunSummary=Deterministic Chrome bookmark artifact pipeline completed.`
  - Independent success checks were deterministic `file_exists` only; `model_review` count was `0`.
  - Independent fresh artifacts:
    - `/Users/zerox/Desktop/bookmark_list.md` -> local mtime `Jun 18 03:56:34 2026`, size `50489`, sha256 `f3ffa60e237fb4f58fcf845944cbc8519577f99ba3866625ce9475c004a12669`.
    - `/Users/zerox/Desktop/goalEvidence.md` -> local mtime `Jun 18 03:56:34 2026`, size `355`, sha256 `f29863a3bf2ef71f8a44f994db9c043f583cf3763b9c6900e28c9e35e6b5c073`.
  - Independent provenance sidecars existed and matched `destination.path`, `sha256`, and `sizeBytes` for both artifacts.
  - Independent trajectory evidence included only `chrome_bookmarks_read` for the tool call path, with no `file_read` or `shell_exec` fallback calls, and `acceptance_checked` had `accepted=true`, `inferentialUsed=false`.
  - Marked `P11.6-command-line-and-packaged-acceptance-gate` done after this independent `ACCEPTED` verdict.
- Final closure verification:
  - `npm test -- src/shared/packageScripts.test.ts src/shared/readme.test.ts` -> 2 files / 10 tests passed after marking P11.6 done and updating README status.
  - `npm run harness:check` -> passed.
  - `npm run verify` -> 135 files / 767 tests passed, build passed, agent eval 26/26, memory eval 2/2.
  - `git diff --check` -> passed.

## 2026-06-18 P11.5 Eval Docs Release Metadata

- Parent closure evidence:
  - Code-quality re-review after fixes -> APPROVED.
  - Spec re-review after fixes -> APPROVED.
  - Parent reran `npm test -- src/main/eval/agentEvalRunner.test.ts src/shared/readme.test.ts src/shared/packageScripts.test.ts` -> 3 files / 20 tests passed.
  - Parent reran `npm run build` -> passed.
  - Parent reran `node scripts/run-agent-evals.mjs` -> 26/26 passed, `toolSuccessRate: 0.8333`, `recoverabilityRate: 1`.
  - Parent reran `npm run harness:check` -> passed.
  - Parent reran `git diff --check` -> passed.
  - Marked `P11.5-eval-docs-release-metadata` done in `.zerox/feature_list.json`.
  - Independent packaged-app computer-use acceptance remains the final v2.3.6 gate and is not marked complete here.

- Review-fix update:
  - Addressed CHANGES_REQUIRED feedback that fallback checks used synthetic `fallbackKind` markers and that task-contract coverage only asserted `contractMode` / `sourceType`.
  - Changed deterministic local artifact eval assertions to forbid real `tool_call` payloads for `{ toolName: "file_read" }` and `{ toolName: "shell_exec" }`.
  - Added deep partial payload matching in the eval runner so nested `taskContract` fields are executable eval assertions, not only fixture-shape expectations.
  - Strengthened the fixture and fixture-shape test to require deterministic contract fields: `taskKind`, `mode`, Chrome bookmark source, grouped Markdown transform, bookmark artifact deliverable, `chrome_bookmarks_read` capability, and provenance-required acceptance.
- Review-fix RED evidence:
  - `npm test -- src/main/eval/agentEvalRunner.test.ts src/shared/readme.test.ts src/shared/packageScripts.test.ts` -> RED with 2 expected failures: fixture assertions still used synthetic fallback markers and nested `taskContract` payload matching failed as shallow `[object Object]` equality.
- Review-fix GREEN evidence:
  - `npm test -- src/main/eval/agentEvalRunner.test.ts src/shared/readme.test.ts src/shared/packageScripts.test.ts` -> 3 files / 20 tests passed.
  - `npm run build` -> passed.
  - `node scripts/run-agent-evals.mjs` -> 26/26 passed, `toolSuccessRate: 0.8333`.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.
- Review-fix residual risk:
  - Independent packaged-app computer-use acceptance remains a later final gate and was intentionally not run or marked complete.

- Request:
  - Add deterministic local artifact provenance eval coverage and release documentation for v2.3.6 without claiming packaged-app computer-use acceptance has passed.
  - Keep package/README metadata honest: package release remains `2.3.5`; v2.3.6 deterministic path is implemented through P11.4 and still needs final command-line plus independent packaged-app acceptance gates.
- Implementation:
  - Added eval-runner max-count assertions so fixtures can forbid replan and fallback events.
  - Added `deterministic-local-artifact-provenance-acceptance` covering task-contract payload, native `chrome_bookmarks_read`, provenance-backed artifact evidence, acceptance, `goal_accepted`, and zero replan/raw-parser/shell fallback events.
  - Updated README English and Chinese docs for deterministic local artifact goals, location/resource canonicalization, provenance-backed acceptance, and final packaged-app computer-use acceptance as a pending release gate.
  - Updated README/package metadata tests to keep package version `2.3.5` and prevent claims that packaged-app acceptance has passed.
- Changed files:
  - `README.md`
  - `src/main/eval/agentEvalFixtures.ts`
  - `src/main/eval/agentEvalRunner.ts`
  - `src/main/eval/agentEvalRunner.test.ts`
  - `src/shared/packageScripts.test.ts`
  - `src/shared/readme.test.ts`
  - `.zerox/progress.md`
  - `.git/sdd/task-5-report.md`
- RED evidence:
  - `npm test -- src/main/eval/agentEvalRunner.test.ts src/shared/readme.test.ts src/shared/packageScripts.test.ts` -> RED with 4 expected failures: README still documented 25 fixtures, eval score still expected 25 fixtures, the new deterministic local artifact fixture was missing, and max-count assertions were ignored.
- GREEN evidence:
  - `npm test -- src/main/eval/agentEvalRunner.test.ts src/shared/readme.test.ts src/shared/packageScripts.test.ts` -> 3 files / 19 tests passed.
  - `npm run harness:check` -> passed.
  - `npm run build` -> passed.
  - `node scripts/run-agent-evals.mjs` after the fresh build -> 26/26 passed, `toolSuccessRate: 0.8333`.
  - `git diff --check` -> passed.
- Residual risks:
  - Independent packaged-app computer-use acceptance was intentionally not run and is still a final release gate.
  - `node scripts/run-agent-evals.mjs` reads `dist-electron`; pre-build runs can report stale fixture counts.

## 2026-06-17 v2.3.2 release preparation

- Request:
  - Update README, package the app, push the iteration, and publish a release.
- Implementation:
  - Bumped release metadata from `2.3.1` to `2.3.2` in `package.json` and `package-lock.json`.
  - Updated README English/Chinese current-version copy, release notes, verification count copy, roadmap entries, and Gatekeeper quarantine example to match the actual macOS artifact name.
  - Updated README and package metadata tests to assert v2.3.2.
  - Built unsigned macOS distribution artifacts with electron-builder.
- Changed files:
  - `package.json`
  - `package-lock.json`
  - `README.md`
  - `src/shared/packageScripts.test.ts`
  - `src/shared/readme.test.ts`
  - `.zerox/progress.md`
- Verification evidence:
  - `./init.sh` -> harness check passed; `src/shared/packageScripts.test.ts` 6 tests passed.
  - `npm test -- src/shared/packageScripts.test.ts src/shared/readme.test.ts` -> 2 files / 9 tests passed.
  - `npm run verify` -> 129 Vitest files / 665 tests passed, build passed, agent eval 25/25, memory eval 2/2.
  - `npm run harness:check` -> passed.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
- Release artifact evidence:
  - `npm run dist:mac` -> build and packaging succeeded for v2.3.2.
  - `release/mac-arm64/Zerox Agent.app/Contents/Info.plist` reports `CFBundleShortVersionString=2.3.2` and `CFBundleVersion=2.3.2`.
  - `release/Zerox Agent-2.3.2-arm64.dmg` -> 118M.
  - `release/Zerox Agent-2.3.2-arm64-mac.zip` -> 329M.
  - `release/latest-mac.yml` -> version `2.3.2`.
  - Packaged app smoke -> `Smoke startup passed: renderer rendered agent chat UI.`
  - SHA-256:
    - dmg: `d0572fd59524bd5a663ce446757c7611aaff4ca1ab391fbd4f0ab6b3c833eeb2`
    - zip: `cbb05e039559ad6a4ddbb6e06dc880ade9350056e6143ce677cb0143ac8a0945`

## 2026-06-16 P9.3 Goal Result Delivery And IPC Hardening

- Request:
  - Address user test feedback where a `/目标` Chrome bookmarks task finished as achieved but the chat transcript did not receive any final result.
  - Address raw Electron IPC output in the chat pane: `Error invoking remote method 'chat:sendMessage': SyntaxError: Unexpected end of JSON input`.
  - Fold the feedback into the broader architecture fixes from P9 instead of only optimizing one local-file workflow.
- Root cause:
  - Goal progress sync only attached the goal summary to the chat session; terminal Goal events did not append an assistant result message.
  - `agentGoalController.stopGoal` notified progress before saving the terminal goal status, so downstream sync could read stale goal state.
  - Goal acceptance context unconditionally loaded model settings even when all acceptance checks were deterministic.
  - Goal planner allowed evidence-backed `model_review` checks with empty evidence refs and did not explicitly forbid clarification-only milestones for concrete tasks.
  - `chat:sendMessage` did not catch thrown errors at the IPC boundary.
  - Existing local JSON state could be empty/corrupt, causing `chat-sessions.json` and individual goal reads to throw `Unexpected end of JSON input`.
  - Computer Use black-box validation showed the UI still did not display the terminal result because the renderer refreshed goal/sidebar state but did not reload active chat messages after terminal Goal progress.
  - The same black-box validation exposed a corrupt-file recovery race: concurrent readers could both parse the old corrupt file, then the second quarantine rename failed with ENOENT after the first reader had already moved it.
  - A second black-box run exposed the deeper architecture gap: Chrome bookmark inspection had no native browser-domain tool, so the model fell back to `file_read`, `tool_result_read`, generated scripts, and shell parsing for Chrome `Bookmarks` JSON.
  - A third black-box run showed the native Chrome bookmark tool was called, but an oversized result still led the model to request a high-risk `shell_exec` parser fallback instead of presenting the native result.
  - A fourth black-box run showed the model could still request `file_stat` on the raw Chrome `Bookmarks` file after the native tool succeeded, causing a repeated permission prompt instead of a final result.
  - A fifth black-box run showed the native tool wrote `bookmark_list.md`, but the model still requested high-risk shell (`wc/head/tail`) to inspect that artifact instead of presenting the result.
  - A sixth black-box run showed the model could read `bookmark_list.md` and `artifact:bookmark_list` back into the context, causing tool-result offload loops instead of finalizing.
  - A later black-box run showed `chrome_bookmarks_read` self-finalized the milestone, but the Goal stayed `executing` after `1/1` milestones because final goal acceptance re-reviewed already accepted evidence and replanned repeatedly.
  - A follow-up black-box run showed chat-created goals passed `availableTools: []` into planning, so the planner could not deterministically select the native Chrome bookmark plan and the model could still invent raw JSON parsing milestones.
  - Goal/chat JSON state was still written with direct `writeFile`, so concurrent reads could observe partial JSON and quarantine valid in-flight state as corrupt.
- Implementation:
  - Added planner normalization that injects `artifact:goalEvidence` for evidence-backed model reviews with missing/empty `evidenceRefs`.
  - Added planner prompt guidance to avoid clarification-only milestones when the user has already named a concrete target.
  - Added `chrome_bookmarks_read` as a native browser tool that scans Chrome profiles with `Bookmarks` files and returns structured bookmark rows, profile stats, truncation metadata, and Markdown for final presentation.
  - Added Chrome bookmark tool definitions, capability metadata, permission checks, approval summaries, and planner guidance so Chrome/browser bookmark goals use the native tool instead of `file_read` plus shell/python/jq parsing.
  - Capped inline Chrome bookmark detail rows at 25 while preserving total counts, requested limits, truncation metadata, and `answerPreview` Markdown so the model has a direct final-answer payload.
  - Prioritized `answerPreview`/`summary`/`markdown` in offloaded tool-result previews so large native observations still carry user-facing content into the next model turn.
  - Added an agent-loop guard that blocks `shell_exec`, `file_read`, `file_stat`, `file_list`, and `file_search` raw Chrome `Bookmarks` fallbacks after `chrome_bookmarks_read` succeeds, before those requests reach user authorization.
  - Changed `chrome_bookmarks_read` to write complete `artifact:bookmark_list` / `bookmark_list.md` during Goal execution and return only a compact 25-row chat preview with artifact path metadata.
  - Extended the agent-loop guard to block shell inspection of the generated `bookmark_list.md` artifact after the native tool succeeds.
  - Changed `chrome_bookmarks_read` to also write `artifact:goalEvidence` / `goalEvidence.md` during Goal execution.
  - Added native self-finalization for successful `chrome_bookmarks_read` results with `answerPreview` and artifact metadata so Goal execution does not re-enter the model for redundant artifact inspection.
  - Added deterministic final Goal convergence for evidence-backed `model_review` goals whose checks are already covered by accepted milestone evidence.
  - Added deterministic single-milestone native planning for Chrome bookmark goals when `chrome_bookmarks_read` is available.
  - Passed available native tool names from the container/tool registry into `GoalChatService` planning.
  - Upgraded chat session and goal JSON stores to serialize mutable state changes and atomically replace JSON via temp-file rename.
  - Added terminal Goal assistant result backfill with dedupe via `goal-terminal:<goalId>:<status>` and included both run summaries and acceptance summaries.
  - Moved terminal Goal persistence before progress notification and avoided model-profile loading for deterministic-only acceptance contexts.
  - Added structured `chat:sendMessage` failure conversion so IPC errors return `{ ok: false, message }` instead of surfacing raw Electron invoke errors.
  - Added corrupt local JSON quarantine for chat sessions and individual goal state files before recovering to empty/null state.
  - Made corrupt JSON quarantine idempotent when concurrent readers race to move the same file.
  - Refreshed the active chat transcript after terminal Goal progress events so the appended result appears in the visible chat.
  - Updated README verification counts to 129 Vitest files / 665 tests.
- Changed files:
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`

## 2026-06-18 v2.3.6 P11.3 artifact provenance review fixes

- Request:
  - Address CHANGES_REQUIRED findings for P11.3 only: first-class provenance identity, real runtime artifact trajectory evidence, symlink-safe artifact/provenance handling, structurally consistent run-graph provenance refs, and expanded acceptance mismatch coverage.
- Implementation:
  - Added explicit optional `runId`, `goalId`, and `milestoneId` fields to `AgentRunContext` and primary run-context construction.
  - Updated `GoalRuntimeEngine` to pass run-scoped context identity into the loop/tool executor after the real milestone run id is created.
  - Removed workspace/session fallback provenance identity from Chrome bookmark artifact writes; artifact provenance now requires a real `runId`.
  - Added runtime `artifact_created` trajectory events from actual successful artifact-producing tool results and preserved artifact/provenance refs on `tool_result` payloads.
  - Hardened provenance verification and Chrome artifact writes to reject symlink artifact/sidecar paths instead of following them.
  - Hardened run graph projection so provenance refs are only published when `artifactId`, `artifactRef`, `provenanceRef`, and provided paths are structurally consistent.
  - Added `src/main/goalRuntimeEngine.ts`, `src/main/goalRuntimeEngine.test.ts`, `src/shared/agentWorkspace.ts`, and `src/shared/agentWorkspace.test.ts` to the P11.3 feature file list because the reviewer identified real run identity and runtime provenance emission as necessary for this slice.
- RED evidence:
  - `npm test -- src/shared/agentArtifactProvenance.test.ts src/main/agentToolExecutor.test.ts src/main/agentGoalAcceptance.test.ts src/shared/runGraph.test.ts src/main/agentEpisodeExporter.test.ts src/main/goalRuntimeEngine.test.ts src/shared/agentWorkspace.test.ts` -> RED with 6 expected failures: missing explicit context identity, fallback Chrome provenance identity, symlink artifact overwrite, missing runtime run identity, symlink verifier following/missing-sidecar ordering, and spoofed run-graph provenance refs.
- Changed files:
  - `src/shared/agentArtifactProvenance.ts`
  - `src/shared/agentArtifactProvenance.test.ts`
  - `src/shared/agentWorkspace.ts`
  - `src/shared/agentWorkspace.test.ts`
  - `src/main/agentToolExecutor.ts`
  - `src/main/agentToolExecutor.test.ts`
  - `src/main/agentGoalAcceptance.test.ts`
  - `src/main/goalRuntimeEngine.ts`
  - `src/main/goalRuntimeEngine.test.ts`
  - `src/shared/runGraph.ts`
  - `src/shared/runGraph.test.ts`
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`
- Verification evidence:
  - `npm test -- src/shared/agentArtifactProvenance.test.ts src/main/agentToolExecutor.test.ts src/main/agentGoalAcceptance.test.ts src/shared/runGraph.test.ts src/main/agentEpisodeExporter.test.ts src/main/goalRuntimeEngine.test.ts src/shared/agentWorkspace.test.ts` -> GREEN after fixes: 7 files / 83 tests passed.
  - `npm run harness:check` -> passed.
  - `npm run build` -> passed after a TypeScript narrowing fix in runtime artifact evidence extraction.
  - `git diff --check` -> passed.
  - `README.md`
  - `src/main/agentGoalController.ts`
  - `src/main/agentGoalPlanner.ts`
  - `src/main/agentGoalPlanner.test.ts`
  - `src/main/agentLoop.ts`
  - `src/main/agentLoop.test.ts`
  - `src/main/agentToolExecutor.ts`
  - `src/main/agentToolExecutor.test.ts`
  - `src/main/agentGoalStore.ts`
  - `src/main/agentGoalStore.test.ts`
  - `src/main/chatSessionStore.ts`
  - `src/main/chatSessionStore.test.ts`
  - `src/main/container.ts`
  - `src/main/container.test.ts`
  - `src/main/goalChatService.ts`
  - `src/main/goalChatService.test.ts`
  - `src/main/goalRuntimeEngine.ts`
  - `src/main/goalRuntimeEngine.test.ts`
  - `src/main/ipc/index.ts`
  - `src/main/ipc/chatSendMessageError.ts`
  - `src/main/ipc/chatSendMessageError.test.ts`
  - `src/main/toolObservationOffload.ts`
  - `src/main/toolObservationOffload.test.ts`
  - `src/renderer/components/AgentChatPanel.tsx`
  - `src/renderer/components/ToolsPanel.tsx`
  - `src/renderer/materialDesign.test.ts`
  - `src/shared/agentProtocol.ts`
  - `src/shared/agentProtocol.test.ts`
  - `src/shared/agentToolCapabilities.ts`
  - `src/shared/agentToolCapabilities.test.ts`
  - `src/shared/nativeCapabilities.ts`
  - `src/shared/readme.test.ts`
  - `src/shared/toolApproval.ts`
  - `src/shared/toolPermissions.ts`
  - `src/shared/toolPermissions.test.ts`
- TDD and verification evidence:
  - `npm test -- src/main/agentGoalPlanner.test.ts` -> planner tests passed after adding evidence-ref normalization and clarification-only guard prompt expectations.
  - `npm test -- src/main/container.test.ts -t "appends a final assistant result"` -> RED, no `goal-terminal:*:achieved` assistant message was appended.
  - `npm test -- src/main/container.test.ts -t "appends a final assistant result"` -> passed after terminal result backfill, deterministic acceptance context, and stop-order fix.
  - `npm test -- src/main/ipc/chatSendMessageError.test.ts` -> RED, missing structured error conversion module.
  - `npm test -- src/main/ipc/chatSendMessageError.test.ts` -> 1 file / 2 tests passed.
  - `npm test -- src/main/chatSessionStore.test.ts src/main/agentGoalStore.test.ts` -> RED, corrupt JSON still threw `Unexpected end of JSON input`.
  - `npm test -- src/main/chatSessionStore.test.ts src/main/agentGoalStore.test.ts` -> 2 files / 16 tests passed.
  - Test engineer subagent Planck used Computer Use on the real Electron UI and returned FAIL: terminal Goal state was visible, but no bookmark result appeared in the chat transcript; a corrupt-session rename race produced ENOENT.
  - `npm test -- src/main/chatSessionStore.test.ts src/main/agentGoalStore.test.ts -t "concurrent corrupt"` -> RED, concurrent quarantine surfaced ENOENT.
  - `npm test -- src/main/chatSessionStore.test.ts src/main/agentGoalStore.test.ts -t "concurrent corrupt"` -> 2 files / 2 targeted tests passed.
  - `npm test -- src/renderer/materialDesign.test.ts -t "reloads the active chat transcript"` -> RED, renderer did not refresh messages on terminal Goal progress.
  - `npm test -- src/renderer/materialDesign.test.ts -t "reloads the active chat transcript"` -> 1 file / 1 targeted test passed.
  - `npm test -- src/main/agentToolExecutor.test.ts src/shared/agentProtocol.test.ts src/shared/toolPermissions.test.ts src/shared/agentToolCapabilities.test.ts src/main/agentGoalPlanner.test.ts -t "Chrome|tool definitions|prefers native"` -> RED for missing Chrome bookmark native tool/protocol/permission/capability support, then 4 files passed / 1 skipped with 5 targeted tests passed after implementation.
  - `npm test -- src/main/agentLoop.test.ts -t "blocks shell fallback after chrome_bookmarks_read"` -> RED, shell fallback was authorized/executed after the native tool; then passed after adding the pre-authorization fallback guard.
  - Black-box CDP validation with production Electron -> FAIL: after `chrome_bookmarks_read` authorization, the model requested `file_stat` on `/Users/zerox/Library/Application Support/Google/Chrome/Default/Bookmarks`, causing repeated authorization prompts.
  - `npm test -- src/main/agentLoop.test.ts -t "raw Chrome Bookmarks file probes"` -> RED, `file_stat` was authorized/executed after the native tool; then passed after extending the fallback guard to raw Chrome path probes.
  - Black-box CDP validation with production Electron -> FAIL: after `chrome_bookmarks_read` wrote `bookmark_list.md`, the model requested high-risk `shell_exec` with `wc/head/tail` to inspect the artifact.
  - `npm test -- src/main/agentLoop.test.ts -t "bookmark artifact"` -> RED, shell artifact inspection was authorized/executed after the native tool; then passed after blocking shell checks of `bookmark_list.md`.
  - Black-box CDP validation with production Electron -> FAIL: after `chrome_bookmarks_read`, the model read `bookmark_list.md` / `artifact:bookmark_list` and got stuck in offload loops.
  - `npm test -- src/main/agentLoop.test.ts -t "self-finalizes"` -> RED, `chrome_bookmarks_read` handed control back to the model; then passed after native self-finalization.
  - `npm test -- src/main/toolObservationOffload.test.ts -t "answerPreview"` -> RED, offloaded previews dropped late `answerPreview`; then passed after prioritizing user-facing preview fields.
  - `npm test -- src/main/agentLoop.test.ts src/main/agentToolExecutor.test.ts src/main/toolObservationOffload.test.ts -t "chrome_bookmarks_read|Chrome bookmark|answerPreview"` -> 3 files / 4 targeted tests passed.
  - `npm test -- src/main/agentToolExecutor.test.ts src/shared/agentProtocol.test.ts src/shared/toolPermissions.test.ts src/shared/agentToolCapabilities.test.ts src/main/agentGoalPlanner.test.ts src/shared/nativeCapabilities.test.ts src/shared/toolApproval.test.ts` -> 7 files / 81 tests passed.
  - `npm test -- src/main/agentGoalPlanner.test.ts src/main/container.test.ts src/main/ipc/chatSendMessageError.test.ts src/main/chatSessionStore.test.ts src/main/agentGoalStore.test.ts src/renderer/materialDesign.test.ts` -> 6 files / 63 tests passed.
  - `npm test -- src/main/agentGoalController.test.ts src/main/agentGoalStore.test.ts src/main/chatSessionStore.test.ts src/main/container.test.ts` -> 4 files / 35 tests passed after atomic JSON writes and covered model-review Goal convergence.
  - `npm test -- src/main/goalChatService.test.ts src/main/agentGoalPlanner.test.ts src/main/agentGoalController.test.ts` -> 3 files / 27 tests passed after available-tool injection and native Chrome bookmark planning.
  - `npm test` -> 129 files / 665 tests passed.
  - `npm run build` -> passed.
  - `npm run verify` -> 129 Vitest files / 665 tests passed, build passed, agent eval 25/25, memory eval 2/2.
  - `npm run harness:check` -> passed.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - Production Electron CDP black-box validation -> PASS: sent `/目标 帮我看一下我chrome浏览器的书签都有哪些`; one deterministic `extract_chrome_bookmarks` milestone ran; only one `chrome_bookmarks_read` approval appeared; no `shell_exec`, `file_read`, `file_stat`, raw Chrome path probe, or artifact reread fallback occurred; final chat showed `目标已达成`, `共找到 335 个书签，返回 25 个`, visible bookmark URLs, and `/Users/zerox/Library/Application Support/Zerox Agent/workspaces/default/bookmark_list.md`.
  - Artifact verification -> `bookmark_list.md` contains 335 Chrome bookmarks; `goalEvidence.md` records `Total bookmarks: 335`; latest goal JSON `goal_9143af48-5c10-4fb1-b8f1-027fe354edc2.json` is valid with `status: achieved`, `stopReason: goal_accepted`, and `replans: 0`.

## 2026-06-16 P9.2 Quick Action Workflow Runtime

- Continued the systemic optimization work beyond prompt/linter guardrails into executable runtime capabilities.
- Added a shared Workflow Catalog that maps task frames to runtime strategies, preferred native tools, guardrails, confirmation risks, and recovery tools across local files, code, web, data, writing, and research work.
- Added Quick Action plans that carry workflow id, canonical target refs, confirmation gate, native batch steps, and rollback tools for deterministic side-effect work.
- Added native local file organizer runtime with preview, transaction log, apply, verify, and rollback behavior. The runtime does not overwrite conflicts and does not use shell commands.
- Exposed file organization as built-in native tools: `file_inventory`, `file_move_plan`, `file_apply_moves`, `file_verify_moves`, and `file_rollback_moves`.
- Extended tool capabilities, protocol definitions, tool permissions, and run-context sandbox checks for the native organizer tools.
- Upgraded strategy guard behavior so Goal Runtime pauses on repeated fragmented non-batch tool calls, records `strategy_guard_triggered`, and surfaces a trajectory insight/UI warning.
- Added a deterministic eval fixture for strategy-guard fragmentation recovery and updated README verification counts.
- Changed files:
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`
  - `README.md`
  - `src/shared/agentWorkflowCatalog.ts`
  - `src/shared/agentWorkflowCatalog.test.ts`
  - `src/shared/agentQuickAction.ts`
  - `src/shared/agentQuickAction.test.ts`
  - `src/shared/agentToolCapabilities.ts`
  - `src/shared/agentToolCapabilities.test.ts`
  - `src/shared/agentProtocol.ts`
  - `src/shared/agentProtocol.test.ts`
  - `src/shared/toolPermissions.ts`
  - `src/shared/toolPermissions.test.ts`
  - `src/shared/chat.ts`
  - `src/shared/agentTrajectoryInsights.ts`
  - `src/shared/agentTrajectoryInsights.test.ts`
  - `src/main/localFileOrganizer.ts`
  - `src/main/localFileOrganizer.test.ts`
  - `src/main/agentToolExecutor.ts`
  - `src/main/agentToolExecutor.test.ts`
  - `src/main/agentLoop.ts`
  - `src/main/agentLoop.test.ts`
  - `src/main/goalRuntimeEngine.ts`
  - `src/main/goalRuntimeEngine.test.ts`
  - `src/main/goalChatService.ts`
  - `src/main/goalChatService.test.ts`
  - `src/main/eval/agentEvalFixtures.ts`
  - `src/main/eval/agentEvalRunner.test.ts`
  - `src/renderer/components/AgentChatPanel.tsx`
  - `src/renderer/components/ToolsPanel.tsx`
  - `src/shared/readme.test.ts`
- TDD and verification evidence:
  - `npm test -- src/main/agentLoop.test.ts` -> RED, `pauseOnStrategyGuard` did not pause fragmented tool-call execution.
  - `npm test -- src/main/agentLoop.test.ts` -> 1 file / 10 tests passed.
  - `npm test -- src/main/goalRuntimeEngine.test.ts` -> RED, Goal Runtime did not enable `pauseOnStrategyGuard`.
  - `npm test -- src/main/goalRuntimeEngine.test.ts` -> 1 file / 5 tests passed.
  - `npm test -- src/shared/agentTrajectoryInsights.test.ts` -> RED, `strategy_guard_triggered` did not produce an insight.
  - `npm test -- src/shared/agentTrajectoryInsights.test.ts` -> 1 file / 3 tests passed.
  - `npm test -- src/main/eval/agentEvalRunner.test.ts` -> RED before the strategy-guard fixture was added.
  - `npm test -- src/main/eval/agentEvalRunner.test.ts` -> 1 file / 7 tests passed.
  - `npm test -- src/shared/agentWorkflowCatalog.test.ts` -> RED, missing Workflow Catalog module.
  - `npm test -- src/shared/agentWorkflowCatalog.test.ts` -> 1 file / 3 tests passed.
  - `npm test -- src/shared/agentQuickAction.test.ts` -> RED, missing Quick Action plan module.
  - `npm test -- src/shared/agentQuickAction.test.ts` -> 1 file / 2 tests passed.
  - `npm test -- src/main/localFileOrganizer.test.ts` -> RED, missing local organizer runtime.
  - `npm test -- src/main/localFileOrganizer.test.ts` -> 1 file / 2 tests passed.
  - `npm test -- src/main/agentToolExecutor.test.ts` -> RED, missing native organizer tools and rollback tool.
  - `npm test -- src/main/agentToolExecutor.test.ts` -> 1 file / 22 tests passed.
  - `npm test -- src/shared/toolPermissions.test.ts` -> RED, organizer tools lacked authorization rules.
  - `npm test -- src/shared/toolPermissions.test.ts` -> 1 file / 24 tests passed.
  - `npm test -- src/shared/agentProtocol.test.ts` -> RED, protocol definitions did not expose organizer tools.
  - `npm test -- src/shared/agentProtocol.test.ts` -> 1 file / 16 tests passed.
  - `npm test -- src/shared/agentWorkflowCatalog.test.ts src/shared/agentQuickAction.test.ts src/shared/agentToolCapabilities.test.ts src/shared/toolPermissions.test.ts src/shared/agentProtocol.test.ts src/main/localFileOrganizer.test.ts src/main/agentToolExecutor.test.ts src/main/goalChatService.test.ts src/main/agentLoop.test.ts src/main/goalRuntimeEngine.test.ts src/shared/agentTrajectoryInsights.test.ts src/main/eval/agentEvalRunner.test.ts` -> 12 files / 106 tests passed.
  - `npm test` -> 128 files / 643 tests passed.
  - `npm run build` -> passed.
  - `npm run verify` -> 128 Vitest files / 643 tests passed, build passed, agent eval 25/25, memory eval 2/2.
  - `npm run harness:check` -> passed.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - `git diff --check` -> passed.

## 2026-06-16 P9.1 Runtime Strategy Enforcement

- Extended the P9 task-strategy work from prompt guidance into runtime enforcement and observable guardrails.
- Chat-created goals that classify as quick-action side-effect work now pause at review instead of calling the Goal planner immediately. This prevents small deterministic local mutations from being decomposed into long-running Goal Mode by default.
- Added a shared `agentToolCapabilities` registry describing tool side effects, batching/recursive support, result-size risk, platform sensitivity, confirmation needs, preferred operations, and anti-patterns.
- Strategy lint now warns when shell is used for a known native operation, such as running tests through `shell_exec` instead of `test_run`.
- Agent loop now emits `FRAGMENTED_TOOL_CALLS` strategy guard events when a non-batch tool such as `file_list` is called repeatedly in one loop.
- Goal runtime records strategy guard events into trajectory evidence as `strategy_guard_triggered` and surfaces a visible run event.
- Intent routing now preserves explicit filesystem paths before keyword fallbacks, so `/Users/bytedance/Downloads 这个文件夹` resolves to `/Users/bytedance/Downloads` instead of `~/Downloads` or a malformed path.
- Changed files:
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`
  - `src/shared/agentTaskStrategy.ts`
  - `src/shared/agentTaskStrategy.test.ts`
  - `src/shared/agentToolCapabilities.ts`
  - `src/shared/agentToolCapabilities.test.ts`
  - `src/shared/agentIntent.ts`
  - `src/shared/agentIntent.test.ts`
  - `src/shared/agentTrajectory.ts`
  - `src/main/agentGoalPlanner.ts`
  - `src/main/agentGoalPlanner.test.ts`
  - `src/main/goalChatService.ts`
  - `src/main/goalChatService.test.ts`
  - `src/main/agentLoop.ts`
  - `src/main/agentLoop.test.ts`
  - `src/main/goalRuntimeEngine.ts`
  - `src/main/goalRuntimeEngine.test.ts`
- TDD and verification evidence:
  - `npm test -- src/main/goalChatService.test.ts` -> RED, quick-action chat goal still called planner.
  - `npm test -- src/main/goalChatService.test.ts` -> 1 file / 8 tests passed.
  - `npm test -- src/shared/agentToolCapabilities.test.ts src/shared/agentTaskStrategy.test.ts` -> RED, missing `./agentToolCapabilities` and missing `PREFER_NATIVE_TOOL`.
  - `npm test -- src/shared/agentToolCapabilities.test.ts src/shared/agentTaskStrategy.test.ts` -> 2 files / 9 tests passed.
  - `npm test -- src/main/agentLoop.test.ts` -> RED, repeated non-batch tool calls did not emit a strategy guard event.
  - `npm test -- src/main/agentLoop.test.ts` -> 1 file / 9 tests passed.
  - `npm test -- src/main/goalRuntimeEngine.test.ts` -> RED, strategy guard events were not written to trajectory.
  - `npm test -- src/main/goalRuntimeEngine.test.ts` -> 1 file / 5 tests passed.
  - `npm test -- src/shared/agentIntent.test.ts` -> RED, explicit `/Users/bytedance/Downloads 这个文件夹` still resolved through the keyword fallback.
  - `npm test -- src/shared/agentIntent.test.ts` -> 1 file / 9 tests passed.
  - `npm test -- src/shared/agentTaskStrategy.test.ts src/shared/agentToolCapabilities.test.ts src/shared/agentIntent.test.ts src/main/agentGoalPlanner.test.ts src/main/goalChatService.test.ts src/main/agentLoop.test.ts src/main/goalRuntimeEngine.test.ts` -> 7 files / 47 tests passed.
  - `npm run build` -> passed.
  - `npm run verify` -> 125 Vitest files / 631 tests passed, build passed, agent eval 24/24, memory eval 2/2.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.

## 2026-06-16 P9.0 Task Strategy Guard

- Started the first systemic architecture slice after reviewing the v2.3.1 Downloads cleanup run failure pattern.
- Added a typed task strategy contract that classifies task domain, execution mode, side-effect risk, expected scale, target references, ambiguity, and recommended runtime.
- Added a reference resolver that strips natural-language path suffixes such as `这个文件夹` from canonical filesystem paths, preventing `/Users/bytedance/Downloads这个文件夹`-style artifacts.
- Added a strategy linter that rejects small deterministic work in Goal Mode, missing confirmation gates for side effects, shell-first deterministic plans, and fragmented repeated tool calls.
- Injected the task strategy frame into Goal planner prompts so milestone decomposition sees runtime-fit guidance before producing a plan.
- Changed files:
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`
  - `src/shared/agentTaskStrategy.ts`
  - `src/shared/agentTaskStrategy.test.ts`
  - `src/main/agentGoalPlanner.ts`
  - `src/main/agentGoalPlanner.test.ts`
- TDD and verification evidence:
  - `npm test -- src/shared/agentTaskStrategy.test.ts` -> RED, missing `./agentTaskStrategy`.
  - `npm test -- src/shared/agentTaskStrategy.test.ts` -> 1 file / 5 tests passed.
  - `npm test -- src/main/agentGoalPlanner.test.ts` -> RED, planning prompt did not include `Task strategy frame:`.
  - `npm test -- src/shared/agentTaskStrategy.test.ts src/main/agentGoalPlanner.test.ts` -> 2 files / 12 tests passed.
  - `npm run build` -> passed.
  - `npm run verify` -> 124 Vitest files / 623 tests passed, build passed, agent eval 24/24, memory eval 2/2.
  - `npm run harness:check` -> passed.

## 2026-06-16 GitHub Actions Shell CI Follow-up

- Investigated the red GitHub Actions `verify` run after v2.3.1 was released.
- Confirmed the same 4 `src/main/agentToolExecutor.test.ts` shell-related failures existed in the earlier v2.3.0 PR/main runs, so this was not introduced by the desktop preload hotfix.
- Root cause: `shell_exec` hardcoded `shell: "/bin/zsh"`, which is correct for the macOS desktop target but not portable to GitHub `ubuntu-latest`.
- Changed `shell_exec` shell selection to preserve `/bin/zsh` on macOS while using `$SHELL` or `/bin/sh` on non-macOS platforms.
- Added coverage for the shell selection contract.
- Changed files:
  - `.zerox/progress.md`
  - `README.md`
  - `src/main/agentToolExecutor.ts`
  - `src/main/agentToolExecutor.test.ts`
  - `src/shared/readme.test.ts`
- Verification evidence:
  - `npm test -- src/main/agentToolExecutor.test.ts` -> 1 file / 21 tests passed.
  - `npm run verify` -> 123 Vitest files / 617 tests passed, build passed, agent eval 24/24, memory eval 2/2.
  - `npm run harness:check` -> passed.

## 2026-06-16 v2.3.1 Desktop Preload And Window Drag Hotfix

- Fixed the packaged Electron app opening in browser preview/demo mode because the sandboxed preload failed to load after v2.3.0 added a runtime import from `../shared/kernelContract`.
- The preload now keeps kernel IPC channel names local and imports shared kernel types type-only, so `window.buildingAgent` is injected again in production and model settings can save through IPC.
- Hardened production smoke mode to fail when the desktop preload bridge is missing instead of only checking that the React shell rendered.
- Added a fixed `window-drag-strip` so the chat-first desktop shell still has a draggable region when the normal topbar is hidden.
- Bumped hotfix metadata to `2.3.1`, updated README release notes/download examples/test counts, and prepared new macOS distribution artifacts.
- Changed files:
  - `.zerox/progress.md`
  - `README.md`
  - `package.json`
  - `package-lock.json`
  - `src/preload/index.ts`
  - `src/preload/index.test.ts`
  - `src/main/smokeMode.ts`
  - `src/main/smokeMode.test.ts`
  - `src/renderer/App.tsx`
  - `src/renderer/styles/app-shell.css`
  - `src/renderer/materialDesign.test.ts`
  - `src/shared/packageScripts.test.ts`
  - `src/shared/readme.test.ts`
- Root-cause evidence:
  - `ELECTRON_ENABLE_LOGGING=1 BUILDING_AGENT_SMOKE=1 BUILDING_AGENT_SMOKE_REQUIRED_TEXTS='正式本地数据' npx electron .` -> RED before the fix with `Unable to load preload script` and `Error: module not found: ../shared/kernelContract`; renderer fell back to preview/demo mode.
  - Chat mode hid `.topbar`, while only `.topbar` had `-webkit-app-region: drag`, leaving the first screen without a draggable window region.
- TDD and verification evidence:
  - `npm test -- src/preload/index.test.ts` -> RED with the runtime `../shared/kernelContract` import identified.
  - `npm test -- src/preload/index.test.ts src/main/smokeMode.test.ts src/renderer/materialDesign.test.ts` -> RED with expected failures for missing desktop API smoke checks and missing `window-drag-strip`.
  - `npm test -- src/preload/index.test.ts src/main/smokeMode.test.ts src/renderer/materialDesign.test.ts` -> 3 files / 40 tests passed.
  - `npm version 2.3.1 --no-git-tag-version` -> updated package metadata without creating a git tag.
  - `npm test -- src/shared/packageScripts.test.ts src/shared/readme.test.ts src/preload/index.test.ts src/main/smokeMode.test.ts src/renderer/materialDesign.test.ts` -> 5 files / 49 tests passed.
  - `npm run build && ELECTRON_ENABLE_LOGGING=1 BUILDING_AGENT_SMOKE=1 BUILDING_AGENT_SMOKE_REQUIRED_TEXTS='正式本地数据' npx electron .` -> passed; no preload load failure.
  - `npm run pack:mac` -> packaged unsigned macOS `.app`.
  - `ELECTRON_ENABLE_LOGGING=1 BUILDING_AGENT_SMOKE=1 BUILDING_AGENT_SMOKE_REQUIRED_TEXTS='正式本地数据' "release/mac-arm64/Zerox Agent.app/Contents/MacOS/Zerox Agent"` -> packaged app smoke passed.
  - `npm run verify` -> 123 Vitest files / 616 tests passed, build passed, agent eval 24/24, memory eval 2/2.
  - `npm run smoke:prod` -> passed with desktop API smoke requirement.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.
- Independent QA evidence:
  - Test engineer subagent `Erdos` reviewed the hotfix and release metadata, ran focused tests, `npm run smoke:prod`, `npm run harness:check`, and `git diff --check`, and returned `PASS` with no release blockers.
- Release packaging evidence:
  - `npm run dist:mac` -> generated v2.3.1 macOS `.dmg`, `.zip`, blockmaps, and `release/latest-mac.yml`.
  - `release/mac-arm64/Zerox Agent.app/Contents/Info.plist` reports `CFBundleShortVersionString=2.3.1` and `CFBundleVersion=2.3.1`.
  - `release/latest-mac.yml` reports `version: 2.3.1`.
  - `release/Zerox Agent-2.3.1-arm64.dmg` -> 118M, SHA-256 `f5b6398eead07e5a5d760ee228cafc1ea88bf55151d5bf4ae0a78bcd4a2aad2f`.
  - `release/Zerox Agent-2.3.1-arm64-mac.zip` -> 329M, SHA-256 `0f99b0e1f14f9769ad51406630f2c14b5a37ff14a3d1fcdd90c107e3d3bc1a0d`.
  - `ELECTRON_ENABLE_LOGGING=1 BUILDING_AGENT_SMOKE=1 BUILDING_AGENT_SMOKE_REQUIRED_TEXTS='正式本地数据' "release/mac-arm64/Zerox Agent.app/Contents/MacOS/Zerox Agent"` -> packaged app smoke passed after v2.3.1 distribution build.

## 2026-06-16 P8.0 Agent Runtime Kernel Foundation

- Started the v2.3.0 Agent Runtime Kernel iteration from the attached roadmap by adding P8 feature entries to `.zerox/feature_list.json` and selecting the first unfinished slice, P8.0.
- Implemented the additive ARK foundation: shared kernel contract, main-process kernel event bus, and dependency-injected runtime-kernel skeleton. Existing chat, recoverable runtime, and Goal Mode behavior remain unchanged in this slice.
- Changed files:
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`
  - `docs/superpowers/specs/2026-06-16-agent-runtime-kernel-2-3-design.md`
  - `docs/superpowers/plans/2026-06-16-agent-runtime-kernel-foundation.md`
  - `src/shared/kernelContract.ts`
  - `src/shared/kernelContract.test.ts`
  - `src/main/kernel/eventBus.ts`
  - `src/main/kernel/eventBus.test.ts`
  - `src/main/kernel/kernelTypes.ts`
  - `src/main/kernel/runtimeKernel.ts`
  - `src/main/kernel/runtimeKernel.test.ts`
- TDD and verification evidence:
  - `./init.sh` -> harness check passed; `src/shared/packageScripts.test.ts` passed with 6 tests.
  - `npm test -- src/shared/kernelContract.test.ts` -> RED, missing `./kernelContract`.
  - `npm test -- src/shared/kernelContract.test.ts` -> 1 file / 3 tests passed.
  - `npm test -- src/main/kernel/eventBus.test.ts` -> RED, missing `./eventBus`.
  - `npm test -- src/main/kernel/eventBus.test.ts src/shared/kernelContract.test.ts` -> 2 files / 8 tests passed.
  - `npm test -- src/main/kernel/runtimeKernel.test.ts` -> RED, missing `./runtimeKernel`.
  - `npm test -- src/main/kernel/runtimeKernel.test.ts src/main/kernel/eventBus.test.ts src/shared/kernelContract.test.ts` -> 3 files / 12 tests passed.
  - `npm run build` -> passed.
  - `npm run verify` -> 115 Vitest files / 578 tests passed, build passed, agent eval 22/22, memory eval 2/2.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.

## 2026-06-16 P8.1 Checkpointed Context Compaction

- Implemented checkpoint-backed kernel compaction primitives for the v2.3.0 ARK iteration.
- Added a local `KernelCheckpointStore` that writes full pre-compaction `ChatMessage[]` snapshots under `kernel-checkpoints/<runId>/` and rebuilds those messages from a guarded local ref.
- Added `compactKernelContext`, which writes a checkpoint before compaction, preserves `[Goal continuity checkpoint - never compact]` anchors and recent tail turns, replaces bulky historical tool results with checkpoint refs, and emits `checkpoint_written` then `compaction` kernel events.
- Changed files:
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`
  - `docs/superpowers/plans/2026-06-16-checkpointed-context-compaction.md`
  - `src/main/kernel/checkpointStore.ts`
  - `src/main/kernel/checkpointStore.test.ts`
  - `src/main/kernel/compactionEngine.ts`
  - `src/main/kernel/compactionEngine.test.ts`
- TDD and verification evidence:
  - `npm test -- src/main/kernel/checkpointStore.test.ts` -> RED, missing `./checkpointStore`.
  - `npm test -- src/main/kernel/checkpointStore.test.ts` -> 1 file / 2 tests passed.
  - `npm test -- src/main/kernel/compactionEngine.test.ts` -> RED, missing `./compactionEngine`.
  - `npm test -- src/main/kernel/compactionEngine.test.ts src/main/kernel/checkpointStore.test.ts src/main/kernel/eventBus.test.ts` -> 3 files / 9 tests passed.
  - `npm test -- src/main/kernel/checkpointStore.test.ts src/main/kernel/compactionEngine.test.ts src/main/kernel/eventBus.test.ts src/shared/kernelContract.test.ts` -> 4 files / 12 tests passed.
  - `npm run build` -> passed.
  - `npm run verify` -> 117 Vitest files / 582 tests passed, build passed, agent eval 22/22, memory eval 2/2.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.

## 2026-06-16 P8.2 Runtime Resilience And Dynamic Turns

- Implemented retry-after-aware model request retry and a reusable ARK turn-budget helper.
- Hardened `completeWithModelRetry` to honor `retry-after-ms`, `retry-after` seconds, and `retry-after` HTTP dates from common error header shapes before falling back to exponential delay.
- Made custom retry sleep functions abortable by racing them against the run `AbortSignal`, preventing a canceled long task from waiting on an unresolved custom sleep.
- Added `deriveRuntimeMaxTurns` defaults for chat and Goal Mode: chat defaults to 8 turns, Goal Mode derives milestone count x 6 and caps at 60.
- Changed files:
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`
  - `docs/superpowers/plans/2026-06-16-runtime-resilience-dynamic-turns.md`
  - `src/main/modelRetry.ts`
  - `src/main/modelRetry.test.ts`
  - `src/main/kernel/resilience.ts`
  - `src/main/kernel/resilience.test.ts`
- TDD and verification evidence:
  - `npm test -- src/main/modelRetry.test.ts` -> RED, retry-after-ms and retry-after seconds used fallback delay, custom sleep abort timed out.
  - `npm test -- src/main/modelRetry.test.ts src/main/agentLoop.test.ts src/main/agentRuntimeEngine.test.ts` -> 3 files / 35 tests passed.
  - `npm test -- src/main/kernel/resilience.test.ts` -> RED, missing `./resilience`.
  - `npm test -- src/main/kernel/resilience.test.ts src/main/kernel/runtimeKernel.test.ts` -> 2 files / 9 tests passed.
  - `npm test -- src/main/modelRetry.test.ts src/main/kernel/resilience.test.ts src/main/agentLoop.test.ts src/main/agentRuntimeEngine.test.ts` -> 4 files / 40 tests passed.
  - `npm run build` -> passed.
  - `npm run verify` -> 119 Vitest files / 592 tests passed, build passed, agent eval 22/22, memory eval 2/2.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.

## 2026-06-16 P8.3 Evidence-Driven Stop Policy

- Implemented kernel-level evidence stop policy primitives for ARK without changing existing Goal Mode acceptance behavior.
- Added `createEvidenceJudgePolicy`, which uses an injected judge adapter and requires successful verdict evidence to appear in transcript text before returning `stop: true`.
- Added `createTurnLimitPolicy` for future runtime migration and max-react protection that returns an impossible stop decision when the judge loop is exhausted.
- Changed files:
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`
  - `docs/superpowers/plans/2026-06-16-evidence-driven-stop-policy.md`
  - `src/main/kernel/stopPolicy.ts`
  - `src/main/kernel/stopPolicy.test.ts`
- TDD and verification evidence:
  - `npm test -- src/main/kernel/stopPolicy.test.ts` -> RED, missing `./stopPolicy`.
  - `npm test -- src/main/kernel/stopPolicy.test.ts src/main/kernel/runtimeKernel.test.ts` -> 2 files / 10 tests passed.
  - `npm test -- src/main/kernel/stopPolicy.test.ts src/main/kernel/runtimeKernel.test.ts src/main/agentGoalAcceptance.test.ts src/main/goalRuntimeEngine.test.ts` -> 4 files / 29 tests passed.
  - `npm run build` -> passed.
  - `npm run verify` -> 120 Vitest files / 598 tests passed, build passed, agent eval 22/22, memory eval 2/2.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.

## 2026-06-16 P8.4 Rule-Based Permission Engine

- Implemented rule-based allow/deny/ask evaluation for unattended runs while keeping `ToolAuthorizationService` as the authorization boundary.
- Added `evaluatePermission` with wildcard matching, last matching rule wins, shell command arity prefixes, and full-command matching for dangerous patterns such as `rm -rf *`.
- Integrated allow/deny rules inside `ToolAuthorizationService`; rule decisions still write the existing audit event. No-match/ask continues through the existing task-policy and approval path.
- Changed files:
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`
  - `docs/superpowers/plans/2026-06-16-rule-based-permission-engine.md`
  - `src/main/kernel/permissionEngine.ts`
  - `src/main/kernel/permissionEngine.test.ts`
  - `src/main/toolAuthorizationService.ts`
  - `src/main/toolAuthorizationService.test.ts`
- TDD and verification evidence:
  - `npm test -- src/main/kernel/permissionEngine.test.ts` -> RED, missing `./permissionEngine`; after first implementation, wildcard matching failed for `git *` and `rm -rf *`.
  - `npm test -- src/main/kernel/permissionEngine.test.ts` -> 1 file / 5 tests passed.
  - `npm test -- src/main/toolAuthorizationService.test.ts` -> RED, rule allow/deny fell through to existing shell template denial.
  - `npm test -- src/main/kernel/permissionEngine.test.ts src/main/toolAuthorizationService.test.ts` -> 2 files / 14 tests passed.
  - `npm test -- src/main/kernel/permissionEngine.test.ts src/main/toolAuthorizationService.test.ts src/shared/toolPermissions.test.ts src/shared/toolApproval.test.ts src/main/toolApprovalCoordinator.test.ts` -> 5 files / 42 tests passed.
  - `npm run build` -> initially failed because `Array.findLast` is unavailable under ES2022; fixed with explicit reverse iteration, then passed.
  - `npm run verify` -> 121 Vitest files / 605 tests passed, build passed, agent eval 22/22, memory eval 2/2.
  - `npm run harness:check` -> passed.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - `git diff --check` -> passed.

## 2026-06-16 P8.5 Kernel Renderer Timeline

- Implemented the renderer-facing Agent Runtime Kernel event bridge and Runs inspector timeline for long-task events.
- Added a shared kernel event view reducer so renderer state is derived from `KernelEvent[]` instead of ad hoc UI-only state.
- Wired main-process kernel event history/live forwarding through preload, added runtime permission-rule updates that still flow through `ToolAuthorizationService`, and rendered compact Kernel Event cards for checkpoint, compaction, retry, judge, and run-end evidence.
- Changed files:
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`
  - `docs/superpowers/plans/2026-06-16-kernel-renderer-timeline.md`
  - `src/shared/kernelEventView.ts`
  - `src/shared/kernelEventView.test.ts`
  - `src/preload/index.ts`
  - `src/main/container.ts`
  - `src/main/main.ts`
  - `src/main/toolAuthorizationService.ts`
  - `src/renderer/components/RunsPanel.tsx`
  - `src/renderer/materialDesign.test.ts`
  - `src/renderer/styles/cards.css`
  - `src/renderer/styles/legacy.css`
- TDD and verification evidence:
  - `npm test -- src/shared/kernelEventView.test.ts` -> RED, missing `./kernelEventView`.
  - `npm test -- src/shared/kernelEventView.test.ts src/shared/kernelContract.test.ts` -> 2 files / 5 tests passed.
  - `npm test -- src/renderer/materialDesign.test.ts` -> RED, missing `KERNEL_IPC`, `onKernelEvent`, `resumeKernelRun`, `kernel-event-card`, and kernel event styles.
  - `npm test -- src/renderer/materialDesign.test.ts src/shared/kernelEventView.test.ts src/shared/kernelContract.test.ts` -> 3 files / 33 tests passed.
  - `npm run build` -> initially failed on the test helper's non-distributive `Omit<KernelEvent,...>`; fixed the helper, then build passed.
  - `npm run verify` -> 122 Vitest files / 608 tests passed, build passed, agent eval 22/22, memory eval 2/2.
  - `npm run harness:check` -> passed.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - `git diff --check` -> passed.
  - Browser QA at `http://127.0.0.1:5173/` -> Runs page rendered Kernel Events with 6 event cards: turn, checkpoint, compaction, retry, judge verdict, and run end.
  - Browser mobile QA at 390x844 -> Kernel Events still rendered with 6 visible cards and no horizontal overflow (`scrollWidth=384`, `viewportWidth=390`).

## 2026-06-16 P8.6 v2.3.0 Release Acceptance And Independent QA

- Completed the v2.3.0 Agent Runtime Kernel release acceptance slice.
- Bumped package metadata to `2.3.0`, updated README and architecture docs for the Agent Runtime Kernel, and added deterministic eval coverage for kernel event replay and permission-rule behavior.
- Launched independent test-engineer subagent `Leibniz` for this iteration. Initial review returned `FAIL` with two critical permission-boundary blockers and one paperwork blocker.
- Fixed the permission blockers: deny rules still reject early with audit evidence, but allow rules now run only after base task policy and run-context sandbox authorization succeeds; compound shell commands containing control operators no longer match reduced allow rules.
- Independent subagent re-review confirmed the original runtime/security blockers are fixed and reported no new runtime or safety release blockers; final remaining item was this P8.6 metadata/progress closeout, now recorded.
- Changed files:
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`
  - `README.md`
  - `docs/architecture/agent-runtime.md`
  - `package.json`
  - `package-lock.json`
  - `src/main/kernel/permissionEngine.ts`
  - `src/main/kernel/permissionEngine.test.ts`
  - `src/main/toolAuthorizationService.ts`
  - `src/main/toolAuthorizationService.test.ts`
  - `src/main/eval/agentEvalFixtures.ts`
  - `src/main/eval/agentEvalRunner.test.ts`
  - `src/shared/packageScripts.test.ts`
  - `src/shared/readme.test.ts`
- TDD and verification evidence:
  - `npm test -- src/shared/packageScripts.test.ts src/shared/readme.test.ts src/main/eval/agentEvalRunner.test.ts` -> RED with expected failures for `2.3.0` metadata, README/architecture text, and missing ARK eval fixtures.
  - `npm test -- src/shared/packageScripts.test.ts src/shared/readme.test.ts src/main/eval/agentEvalRunner.test.ts` -> 3 files / 16 tests passed after version, docs, and eval fixture updates.
  - Independent QA initial review -> `FAIL`; blockers: allow rules bypassed task/sandbox authorization, reduced shell command matching could allow compound shell commands, and P8.6 closeout evidence was missing.
  - `npm test -- src/main/kernel/permissionEngine.test.ts src/main/toolAuthorizationService.test.ts` -> RED with 4 expected failures for the permission-boundary regressions.
  - `npm test -- src/main/kernel/permissionEngine.test.ts src/main/toolAuthorizationService.test.ts` -> 2 files / 17 tests passed after permission-boundary fixes.
  - `npm test -- src/main/kernel/permissionEngine.test.ts src/main/toolAuthorizationService.test.ts src/shared/packageScripts.test.ts src/shared/readme.test.ts src/main/eval/agentEvalRunner.test.ts` -> 5 files / 33 tests passed.
  - `npm run verify` -> 122 Vitest files / 612 tests passed, build passed, agent eval 24/24, memory eval 2/2.
  - `npm run harness:score` -> overall 9.2 good; eval 24/24; goal 7/7; goal judge 2/2; adversarial 70 checked / 0 escaped.
  - `npm run harness:check` -> passed.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - `git diff --check` -> passed.
  - Independent QA re-review -> original runtime/security blockers fixed; no new runtime or safety release blockers; only P8.6 metadata/progress closeout remained before final pass.
  - Independent QA final check -> `PASS`; residual non-blocking risks: narrow kernel event history/live subscription race could duplicate an event, and `KernelEventBus.history()` shallow-copies event objects.
- Release packaging evidence:
  - `npm run verify` -> 122 Vitest files / 612 tests passed, build passed, agent eval 24/24, memory eval 2/2.
  - `npm run dist:mac` -> build and packaging succeeded for v2.3.0.
  - `release/mac-arm64/Zerox Agent.app/Contents/Info.plist` reports `CFBundleShortVersionString=2.3.0` and `CFBundleVersion=2.3.0`.
  - `release/Zerox Agent-2.3.0-arm64.dmg` -> 118M.
  - `release/Zerox Agent-2.3.0-arm64-mac.zip` -> 329M.
  - `release/latest-mac.yml` -> version `2.3.0`.
  - SHA-256:
    - dmg: `659961f2ec310a23da26a54ebcf8b70b1c62838909e780bb99d6ffe06e9fc1df`
    - zip: `7fd2561e85d3fc5b7abc3f929194bc16c3237715aa95363e4e942388e33d08d9`
    - latest-mac.yml: `681548622780ea5492367aaa6c9e08fd6839523d8636f8dc6203ff736bd931ad`
  - `npm run harness:check` -> passed.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - GitHub Release target: `https://github.com/ZeroxZhang/zerox-agent/releases/tag/v2.3.0`.

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

## 2026-06-16 MiMo-inspired Agent Harness v2.2.0

- Request:
  - Study the local MiMo-Code source and technical research report under `/Volumes/Out/trae_projects/research of mimo code`.
  - Integrate the useful parts into Zerox Agent as a major `2.2.0` iteration, especially goal handling, system prompts, system-level harness, and loop behavior.
- Research and plan:
  - Engineer subagent reviewed MiMo-Code and the report with emphasis on Goal Judge, TaskGate, system prompt layering, trajectory/ledger behavior, checkpoints, loop control, and sandbox risks.
  - Adopted the transferable patterns while preserving Zerox local-first boundaries, `ToolAuthorizationService`, workspace sandbox checks, and reviewed learning gates.
  - Wrote the implementation plan at `docs/superpowers/plans/2026-06-16-mimo-inspired-agent-harness-2-2.md`.
  - Before publishing, merged the existing v2.1.2 release baseline into this branch so v2.2.0 keeps the chat title/status, tool-result recovery, planner JSON recovery, and goal artifact output-root hotfixes.
- Implementation:
  - Added model-profiled system prompt routing for Codex, Claude, Gemini, GPT, Kimi, and default models.
  - Replaced compact goal anchors with an eleven-section goal continuity checkpoint.
  - Added transcript-backed model-review acceptance judging with `goal_judged` trajectory evidence before `acceptance_checked`.
  - Hardened transcript judging so prior transcript messages are quoted as inert evidence instead of replayed as live chat roles.
  - Added the final assistant summary to bounded goal transcripts so the judge can see terminal run evidence.
  - Shared the goal trajectory sequence source between milestone runtime and acceptance/controller events in the desktop container.
  - Added a goal judge eval fixture, adversarial deletion mutation, and harness score/report coverage for goal judge pass rate.
  - Added feature tracking entry `P7-mimo-inspired-agent-harness`.
- Changed files:
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`
  - `README.md`
  - `docs/architecture/agent-goal-mode.md`
  - `docs/superpowers/plans/2026-06-16-mimo-inspired-agent-harness-2-2.md`
  - `package.json`
  - `package-lock.json`
  - `scripts/run-harness-score.mjs`
  - `src/main/agentGoalAcceptance.ts`
  - `src/main/agentGoalAcceptance.test.ts`
  - `src/main/agentGoalContext.ts`
  - `src/main/agentGoalContext.test.ts`
  - `src/main/agentGoalController.ts`
  - `src/main/agentLoop.ts`
  - `src/main/agentRuntimeEngine.ts`
  - `src/main/container.ts`
  - `src/main/eval/agentEvalAdversary.ts`
  - `src/main/eval/agentEvalAdversary.test.ts`
  - `src/main/eval/agentEvalFixtures.ts`
  - `src/main/eval/agentEvalRunner.test.ts`
  - `src/main/goalRuntimeEngine.ts`
  - `src/main/goalRuntimeEngine.test.ts`
  - `src/shared/agentGoalContinuity.ts`
  - `src/shared/agentGoalContinuity.test.ts`
  - `src/shared/agentProtocol.ts`
  - `src/shared/agentProtocol.test.ts`
  - `src/shared/agentTrajectory.ts`
  - `src/shared/harnessScore.ts`
  - `src/shared/harnessScore.test.ts`
  - `src/shared/packageScripts.test.ts`
  - `src/shared/readme.test.ts`
- Independent adversarial review:
  - Test engineer subagent Halley initially returned `FAIL` after running focused tests, `npm run verify`, `npm run harness:check`, `npm run harness:score`, `npm run smoke:prod`, and `git diff --check`.
  - P1 fixed: transcript judge no longer replays untrusted transcript messages as live `system` / `user` / `assistant` roles; transcript is now quoted inside a single judge user prompt.
  - P1 fixed: goal runtime appends the terminal assistant summary to the bounded transcript passed into model-review acceptance.
  - P2 fixed: desktop goal runtime and acceptance/controller trajectory events share one sequence source for monotonic run evidence.
  - P2 fixed: progress evidence updated after feature status was marked done.
- TDD and verification evidence:
  - `./init.sh` -> harness check passed; packageScripts test 6 passed.
  - `npm test -- src/shared/agentProtocol.test.ts` -> RED before prompt profile support.
  - `npm test -- src/shared/agentProtocol.test.ts src/main/agentLoop.test.ts src/main/agentRuntimeEngine.test.ts src/main/goalRuntimeEngine.test.ts` -> 4 files / 49 tests passed.
  - `npm test -- src/shared/agentGoalContinuity.test.ts src/main/agentGoalContext.test.ts` -> RED before checkpoint/anchor replacement, then 2 files / 6 tests passed.
  - `npm test -- src/main/agentGoalAcceptance.test.ts src/main/goalRuntimeEngine.test.ts src/main/agentGoalController.test.ts` -> RED before transcript-backed judge, then 3 files / 26 tests passed.
  - `npm test -- src/main/eval/agentEvalRunner.test.ts src/main/eval/agentEvalAdversary.test.ts src/shared/harnessScore.test.ts` -> RED before goal judge eval/adversary/harness score support, then 3 files / 15 tests passed.
  - `npm test -- src/shared/agentProtocol.test.ts src/shared/agentGoalContinuity.test.ts src/main/agentGoalAcceptance.test.ts src/main/goalRuntimeEngine.test.ts src/main/agentGoalContext.test.ts src/main/eval/agentEvalRunner.test.ts src/main/eval/agentEvalAdversary.test.ts src/shared/harnessScore.test.ts src/main/agentGoalController.test.ts` -> 9 files / 62 tests passed.
  - `npm test -- src/main/agentGoalAcceptance.test.ts src/main/goalRuntimeEngine.test.ts` -> RED for untrusted transcript role replay and missing terminal assistant summary, then 2 files / 19 tests passed.
  - `npm test -- src/shared/agentProtocol.test.ts src/shared/agentGoalContinuity.test.ts src/main/agentGoalAcceptance.test.ts src/main/goalRuntimeEngine.test.ts src/main/agentGoalContext.test.ts src/main/eval/agentEvalRunner.test.ts src/main/eval/agentEvalAdversary.test.ts src/shared/harnessScore.test.ts src/main/agentGoalController.test.ts src/main/container.test.ts src/shared/packageScripts.test.ts src/shared/readme.test.ts` -> 12 files / 76 tests passed.
  - `npm test -- src/shared/packageScripts.test.ts src/shared/readme.test.ts` -> RED before v2.2.0 README/package metadata, then 2 files / 9 tests passed.
  - `npm test` -> 112 files / 566 tests passed after merging the v2.1.2 release baseline.
  - `npm run verify` -> 112 files / 566 tests passed, build passed, agent eval 22/22, memory eval 2/2.
  - `npm run harness:check` -> passed.
  - `npm run harness:score` -> score 9.2 good; eval 22/22; goal 7/7; goal-judge 1/1; adversarial 63 checked / 0 escaped.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - `git diff --check` -> passed.
  - Independent test engineer subagent re-review -> `PASS`; original four findings resolved; no new release blocker.
- Release artifact evidence:
  - `npm run dist:mac` -> build and packaging succeeded for v2.2.0 after merging the v2.1.2 release baseline.
  - `release/mac-arm64/Zerox Agent.app/Contents/Info.plist` reports `CFBundleShortVersionString=2.2.0` and `CFBundleVersion=2.2.0`.
  - `release/Zerox Agent-2.2.0-arm64.dmg` -> 118M.
  - `release/Zerox Agent-2.2.0-arm64-mac.zip` -> 329M.
  - `release/latest-mac.yml` -> version `2.2.0`.
  - Packaged app smoke with old required idle-panel text `进度|上下文` failed before the final merge package because the command-first UI hides idle progress/context text; default packaged app smoke passed after the final merge package with renderer rendering agent chat UI.
  - SHA-256:
    - dmg: `27b6ad2cfe21b314fcf84e45e671a0b5c81183e0c718161ba6f623bb1aeeb5b8`
    - zip: `4bec7c1853ca2c05d6cb4be96130569bd732a693daa768664f4befac65b4b838`
- GitHub release evidence:
  - `git push -u origin codex/system_up` -> pushed branch `codex/system_up`.
  - `git push origin v2.2.0` -> pushed release tag `v2.2.0`.
  - `gh release create v2.2.0 ... --latest` -> published `https://github.com/ZeroxZhang/zerox-agent/releases/tag/v2.2.0`.
  - `gh api repos/ZeroxZhang/zerox-agent/releases/latest --jq '{tag_name, name, draft, prerelease, html_url}'` -> `tag_name=v2.2.0`, `draft=false`, `prerelease=false`.
  - v2.2.0 assets uploaded: `latest-mac.yml`, `Zerox.Agent-2.2.0-arm64.dmg`, `Zerox.Agent-2.2.0-arm64.dmg.blockmap`, `Zerox.Agent-2.2.0-arm64-mac.zip`, `Zerox.Agent-2.2.0-arm64-mac.zip.blockmap`.

## 2026-06-15 Chat hero long-text containment hotfix

- Request:
  - Fix the visible header display issue where a long chat title and long live status text overlapped inside the top chat hero area.
- Implementation:
  - Added a stable `chatTitle` value and title tooltips for full chat title/status disclosure.
  - Wrapped live status text so the status pill can ellipsize reliably inside a flex header.
  - Constrained the chat hero layout: title area can shrink, title clamps to two lines, and live status stays inside a max-width pill.
- Changed files:
  - `src/renderer/components/AgentChatPanel.tsx`
  - `src/renderer/styles/chat.css`
  - `src/renderer/materialDesign.test.ts`
  - `.zerox/progress.md`
- TDD and verification evidence:
  - `npm test -- src/renderer/materialDesign.test.ts` -> RED with 1 expected failure for missing chat title/status containment.
  - `npm test -- src/renderer/materialDesign.test.ts` -> 1 file / 26 tests passed after the fix.
  - Browser QA at `http://127.0.0.1:5173/#chat` -> agent chat panel and hero rendered, document had no horizontal overflow, hero had no horizontal overflow.
  - Browser CSS QA -> `.chat-hero-main` computed `flex: 1 1 auto`; title CSS included `-webkit-line-clamp: 2`; `.chat-state` max width computed to `420px`; `.chat-state > span` computed `text-overflow: ellipsis` and `white-space: nowrap`.
  - `npm run harness:check` -> passed.
  - `npm run verify` -> 110 files / 545 tests passed, build passed, agent eval 21/21, memory eval 2/2.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - `git diff --check` -> passed.

## 2026-06-15 Chat title, status capsule, and tool-result recovery hotfix

- Request:
  - Fix the remaining chat hero display issue by generating brief session names and making long status capsules collapsed by default.
  - Fix goal execution failures caused by planner JSON parsing and repeated `file_read` failures when reading offloaded tool results.
- Root cause:
  - Chat sessions used the first user message as the title, so `/目标 ... 项目位置 ...` prompts leaked long paths into the hero/header and sidebar.
  - The live status capsule only ellipsized text; it had no explicit collapsed/expanded interaction, so long progress text still competed with the title area.
  - The goal planner accepted only bare JSON; markdown/code-fenced or non-JSON replanning responses could surface as unrecoverable goal failures.
  - Offloaded tool observations exposed `result_ref`, but the model had no native tool to read that ref during execution, so it repeatedly attempted `file_read` on `tool-result-refs/...`.
- Implementation:
  - Added deterministic short chat title generation that strips slash commands, local paths, and filler text before naming the session.
  - Made long chat status capsules collapsed by default, with explicit click-to-expand/collapse behavior and full-width expanded layout.
  - Hardened goal planner parsing to extract JSON objects from code fences or explanatory text; replanning now falls back to a safe remaining milestone if the model response stays invalid.
  - Added `tool_result_read` as a built-in low-risk tool, protocol entry, permission case, approval summary, executor handler, and runtime executor injection.
  - Routed legacy `file_read` calls for safe `tool-result-refs/...` paths to the offload store for compatibility with prior model behavior.
- Changed files:
  - `src/main/chatSessionStore.ts`
  - `src/main/agentGoalPlanner.ts`
  - `src/main/agentToolExecutor.ts`
  - `src/main/container.ts`
  - `src/renderer/components/AgentChatPanel.tsx`
  - `src/renderer/components/ToolsPanel.tsx`
  - `src/renderer/styles/chat.css`
  - `src/shared/agentProtocol.ts`
  - `src/shared/toolApproval.ts`
  - `src/shared/toolPermissions.ts`
  - focused tests for the files above
- TDD and verification evidence:
  - `npm test -- src/main/chatSessionStore.test.ts src/main/agentGoalPlanner.test.ts src/shared/agentProtocol.test.ts src/main/agentToolExecutor.test.ts src/renderer/materialDesign.test.ts` -> RED with 10 expected failures for missing short titles, planner JSON extraction/fallback, tool-result ref reading, and status capsule expansion logic.
  - `npm test -- src/main/chatSessionStore.test.ts src/main/agentGoalPlanner.test.ts src/shared/agentProtocol.test.ts src/main/agentToolExecutor.test.ts src/shared/toolPermissions.test.ts src/renderer/materialDesign.test.ts` -> 6 files / 95 tests passed.
  - Browser QA at `http://127.0.0.1:5173/#chat` -> desktop page title `Zerox Agent`, chat hero rendered, no framework overlay, no console warn/error logs, no horizontal overflow, and CSS contained title clamp plus `.chat-state.is-expanded` capsule rules.
  - Browser mobile QA at 390x844 -> no horizontal overflow, context panel hidden, no framework overlay, no console warn/error logs.
  - `npm run harness:check` -> passed.
  - `npm run verify` -> 110 files / 553 tests passed, build passed, agent eval 21/21, memory eval 2/2.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - `git diff --check` -> passed.

## 2026-06-15 Goal milestone progress and artifact stop-condition hotfix

- Request:
  - Fix goal runs where milestone progress in the right context panel stayed pending even after visible progress.
  - Fix goal execution continuing after the model had completed the work, with `Missing required artifact evidence: artifact:inventory_log.` still shown.
- Root cause:
  - Goal output-root extraction treated Chinese prose directly attached to a path, such as `/Users/zerox/Downloads目录下的文件`, as part of the filesystem path. Artifact contracts and acceptance checks then looked for `inventory_log.md` under a nonexistent root.
  - The goal controller marked a milestone `running` in memory but did not persist that state before dispatching the runtime loop, so UI refreshes read stale `ready/pending` milestone state.
  - The chat panel only reacted to goal progress events when `activeGoalRef` was already populated; early session-scoped events could arrive before the active goal summary refresh completed.
- Implementation:
  - Added natural-language suffix trimming for explicit goal output roots while preserving slash-separated Chinese path segments.
  - Persisted `running` milestone state before runtime dispatch and persisted run metadata before acceptance evaluation.
  - Updated chat goal progress syncing to refresh active goal details for the current session even when the active goal summary is still catching up.
- Changed files:
  - `src/main/goalOutputRoots.ts`
  - `src/main/goalOutputRoots.test.ts`
  - `src/main/agentGoalController.ts`
  - `src/main/agentGoalController.test.ts`
  - `src/renderer/components/AgentChatPanel.tsx`
  - `src/renderer/materialDesign.test.ts`
  - `.zerox/progress.md`
- TDD and verification evidence:
  - `npm test -- src/main/goalOutputRoots.test.ts` -> RED with expected failure showing `/Users/zerox/Downloads目录下的文件` was extracted instead of `/Users/zerox/Downloads`.
  - `npm test -- src/main/agentGoalController.test.ts` -> RED with expected failure showing persisted milestone state was still `ready` during runtime dispatch.
  - `npm test -- src/renderer/materialDesign.test.ts` -> RED with expected failure for missing session-scoped goal progress sync.
  - `npm test -- src/main/goalOutputRoots.test.ts src/main/agentGoalController.test.ts src/renderer/materialDesign.test.ts` -> all focused tests passed after implementation.
  - `npm test -- src/main/goalOutputRoots.test.ts src/main/goalRuntimeEngine.test.ts src/main/agentGoalAcceptance.test.ts src/main/agentGoalController.test.ts src/renderer/materialDesign.test.ts src/renderer/goalProgressViewModel.test.ts` -> 6 files / 57 tests passed.
  - Browser QA at `http://127.0.0.1:5173/` -> desktop page rendered app shell with no horizontal overflow; status capsule and chat shell visible.
  - Browser mobile QA at 390x844 -> no horizontal overflow; status capsule remained contained; composer remained usable; viewport reset afterward.
  - `npm run build` -> TypeScript and Vite production build passed.
  - `npm run harness:check` -> passed.
  - `npm run verify` -> 111 files / 557 tests passed, build passed, agent eval 21/21, memory eval 2/2.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - `git diff --check` -> passed.

## 2026-06-15 v2.1.2 release preparation

- Request:
  - Bump the app version to 2.1.2, update the local app metadata, package the macOS app, update README, push, and publish a new GitHub Release.
- Implementation:
  - Created release branch `release/2.1.2` from the latest v2.1.1 hotfix branch.
  - Updated `package.json` and `package-lock.json` from 2.1.1 to 2.1.2.
  - Updated README English/Chinese release positioning, packaging command examples, current version labels, and verification counts.
  - Updated release metadata tests and README tests to assert v2.1.2.
  - Built unsigned macOS distribution artifacts with electron-builder.
- Changed files:
  - `package.json`
  - `package-lock.json`
  - `README.md`
  - `src/shared/packageScripts.test.ts`
  - `src/shared/readme.test.ts`
  - `.zerox/progress.md`
- Verification evidence:
  - `npm test -- src/shared/packageScripts.test.ts src/shared/readme.test.ts` -> 2 files / 9 tests passed after updating version and README assertions.
  - `npm run harness:check` -> passed.
  - `npm run verify` -> 111 files / 557 tests passed, build passed, agent eval 21/21, memory eval 2/2.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - `npm run dist:mac` -> build passed and generated:
    - `release/Zerox Agent-2.1.2-arm64.dmg` (118MB)
    - `release/Zerox Agent-2.1.2-arm64-mac.zip` (329MB)
    - `release/Zerox Agent-2.1.2-arm64.dmg.blockmap`
    - `release/Zerox Agent-2.1.2-arm64-mac.zip.blockmap`
  - SHA-256:
    - dmg: `06b9552704bbc0e19e6a151409312d79fbe60fa467e73209b427643b9d695766`
    - zip: `38ab58b8de433a7cba1a490372556525ef55ca3ab920dce27d8b01910c1b2754`

## 2026-06-17 v2.3.5 P10 Run Graph Harness iteration

- Request:
  - Study the attached Harness Engineering docs, the `oh-my-openagent` repository, and the current Zerox Agent architecture.
  - Coordinate architecture, development, test, and user-path acceptance subagents for a new v2.3.5 major iteration.
- Planning evidence:
  - Attachment research emphasized Graph State vs Work State, typed Node Result, explicit Gate, Reconcile, and evidence-first UI.
  - External `oh-my-openagent` research identified useful ideas: Core/MCP/Skills/Adapters layering, evidence directories, hook/event validation, mailbox/tasklist, and doctor/status commands.
  - Runtime/UI/test/acceptance subagents recommended prioritizing Run Graph Truth, gate visibility, typed episode evidence, runtime-backed verification, and user-path evidence export.
- Implementation:
  - Added shared Run Graph contract and projector over `AgentRunRecord`, trajectory events, and kernel events.
  - Projected runtime runs, turns, goals, milestones, model requests, tool calls, checkpoints, summaries, and explicit gate nodes.
  - Fixed review-found projector issues: no dangling gate edges, no-`toolCallId` tool-result matching, mixed-run event filtering, and unique same-millisecond kernel evidence refs.
  - Added Runs Inspector Run Graph summary and gate list from selected run, trajectory, and kernel evidence.
  - Added `run-graph.json` to typed episode packages.
  - Added typed latest-validation episode export service and wired `npm run episode:export` to build and export `run-graph.json`, `eval-candidate.json`, trajectory, verification, and metadata.
  - Documented `--latest-validation` and Run Graph evidence export in README.
- Changed files:
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`
  - `README.md`
  - `package.json`
  - `scripts/export-agent-episode.mjs`
  - `src/main/agentEpisodeExportCli.ts`
  - `src/main/agentEpisodeExportCli.test.ts`
  - `src/main/agentEpisodeExporter.ts`
  - `src/main/agentEpisodeExporter.test.ts`
  - `src/renderer/components/RunsPanel.tsx`
  - `src/renderer/materialDesign.test.ts`
  - `src/renderer/styles/cards.css`
  - `src/renderer/styles/legacy.css`
  - `src/shared/packageScripts.test.ts`
  - `src/shared/readme.test.ts`
  - `src/shared/runGraph.ts`
  - `src/shared/runGraph.test.ts`
- TDD and verification evidence:
  - `npm test -- src/shared/runGraph.test.ts` -> RED with expected failures for missing goal/milestone projection, dangling gate edges, no-`toolCallId` tool-result matching, and mixed-run event contamination; later passed with 5 tests.
  - `npm test -- src/renderer/materialDesign.test.ts` -> RED for missing Run Graph surface; later passed with 31 tests.
  - `npm test -- src/main/agentEpisodeExporter.test.ts` -> RED for missing `run-graph.json`; later passed.
  - `npm test -- src/main/agentEpisodeExportCli.test.ts` -> RED for missing typed export service; later passed.
  - `npm test -- src/shared/runGraph.test.ts src/main/agentEpisodeExporter.test.ts src/main/agentEpisodeExportCli.test.ts src/renderer/materialDesign.test.ts src/shared/packageScripts.test.ts src/shared/readme.test.ts` -> 6 files / 47 tests passed.
  - `npm run build` -> TypeScript and Vite production build passed.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.
  - `npm run episode:export -- --help` -> build passed and CLI help documented `--latest-validation`, `run-graph.json`, and `eval-candidate.json`.
  - `npm run verify` -> 131 files / 672 tests passed, build passed, agent eval 25/25, memory eval 2/2.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.
  - `npm run dist:mac` -> build passed and generated:
    - `release/Zerox Agent-2.3.5-arm64.dmg` (118MB)
    - `release/Zerox Agent-2.3.5-arm64-mac.zip` (329MB)
    - `release/Zerox Agent-2.3.5-arm64.dmg.blockmap`
    - `release/Zerox Agent-2.3.5-arm64-mac.zip.blockmap`
  - SHA-256:
    - dmg: `c4b886d09c6bd3a1985e4454d3f4b45c5e9c77cfc45d01d9137d1b0c83734bc1`
    - zip: `11d9bf55511c3ea799a113ee290baa94c5bb24747e7441d0861182141f3d4ba6`
  - Browser QA at `http://127.0.0.1:5173/#runs` -> desktop Run Graph rendered, no horizontal overflow, no console warn/error logs.
  - Browser mobile QA at 390x844 -> Run Graph rendered, no horizontal overflow, no console warn/error logs, viewport reset afterward.

## 2026-06-17 v2.3.5 release metadata finalization

- Request:
  - Finish the v2.3.5 iteration as a concrete versioned release state, not only an internal feature branch capability.
- Implementation:
  - Bumped `package.json` and `package-lock.json` from 2.3.2 to 2.3.5.
  - Updated README English/Chinese current release labels, quarantine examples, verification counts, and v2.3.5 Run Graph Harness release notes.
  - Updated package and README tests to assert v2.3.5 metadata.
- Changed files:
  - `README.md`
  - `package.json`
  - `package-lock.json`
  - `src/shared/packageScripts.test.ts`
  - `src/shared/readme.test.ts`
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`
- Verification evidence:
  - `npm test -- src/shared/packageScripts.test.ts src/shared/readme.test.ts` -> 2 files / 9 tests passed.
  - `git diff --check` -> passed.
  - `npm run harness:check` -> passed.
  - `npm run verify` -> 131 files / 672 tests passed, build passed, agent eval 25/25, memory eval 2/2.
  - `npm run smoke:prod` -> build passed; smoke startup passed with renderer rendering agent chat UI.

## 2026-06-18 v2.3.6 deterministic goal contract subagent planning

- Request:
  - Before starting the v2.3.6 implementation, plan the independent subagents needed for the iteration.
  - Make a final independent subagent use computer-use to launch the local packaged app, create a real task on behalf of the user, and treat its acceptance verdict as the standard for completing the v2.3.6 goal.
- Planning:
  - Added the v2.3.6 subagent orchestration plan covering read-only explorer agents, implementation workers, per-slice spec/code reviewers, command-line verification, and final packaged-app computer-use acceptance.
  - The plan defines Agent M as the final release gate: it must launch the packaged local app, create the Chrome-bookmarks-to-Desktop Markdown task through the UI, collect UI/Desktop/provenance/trajectory evidence, and return `ACCEPTED` before v2.3.6 can be considered complete.
  - The plan explicitly rejects treating command-line verification as a substitute for the independent computer-use acceptance subagent.
- Changed files:
  - `docs/superpowers/plans/2026-06-18-v2-3-6-deterministic-goal-contract-subagents.md`
  - `.zerox/progress.md`
- Verification evidence:
  - `./init.sh` -> harness check passed; `src/shared/packageScripts.test.ts` passed with 6 tests.
  - `node -p "require('./package.json').version"` -> `2.3.5`, confirming v2.3.6 implementation has not started yet.
  - `rg -n "TBD|TODO|implement later|fill in|appropriate|similar to|computer-use|ACCEPTED|REJECTED|pack:mac|P11|Agent M" docs/superpowers/plans/2026-06-18-v2-3-6-deterministic-goal-contract-subagents.md` -> confirmed the plan names the final computer-use gate, packaged launch, P11 metadata work, and accepted/rejected verdict semantics; no unresolved placeholders were introduced.

## 2026-06-18 v2.3.6 Wave 0 explorer synthesis

- Request:
  - Continue the v2.3.6 iteration by using the planned independent subagents before implementation begins.
- Subagent evidence:
  - Agent A / Contract Cartographer -> completed read-only analysis: compile `AgentTaskContract` in `goalChatService`, store it as optional `Goal.taskContract`, make `agentGoalPlanner` consume the contract rather than rediscovering Chrome bookmark behavior from goal text.
  - Agent B / Location And Sandbox Cartographer -> completed read-only analysis: current path handling is split across `agentWorkspace`, `toolPermissions`, `goalOutputRoots`, `goalRuntimeEngine`, `agentToolExecutor`, `agentGoalAcceptance`, and `toolAuthorizationService`; v2.3.6 needs one canonical location resolver before paths enter sandbox roots, tool args, artifact roots, or acceptance.
  - Agent C / Provenance Cartographer -> completed read-only analysis: artifact provenance is currently vocabulary rather than a gate; v2.3.6 should add sidecar manifests and acceptance verification against run/goal identity, canonical destination, and current content hash.
  - Agent D / Test Strategy Cartographer -> completed read-only analysis: command-line verification is required but insufficient; final acceptance must be packaged-app UI validation through computer-use and must return `ACCEPTED` or `REJECTED`.
- Planning:
  - Added a detailed v2.3.6 implementation plan based on Wave 0 findings.
  - Marked Wave 0 as completed in the subagent orchestration plan.
- Changed files:
  - `docs/superpowers/plans/2026-06-18-v2-3-6-deterministic-goal-contract-subagents.md`
  - `docs/superpowers/plans/2026-06-18-v2-3-6-deterministic-goal-contract-implementation.md`
  - `.zerox/progress.md`
- Verification evidence:
  - `rg -n "TBD|TODO|implement later|fill in|similar to|appropriate|computer-use|ACCEPTED|REJECTED|Task Contract|Location|Provenance" docs/superpowers/plans/2026-06-18-v2-3-6-deterministic-goal-contract-implementation.md` -> confirmed the implementation plan names the computer-use gate and core design surfaces; no unresolved placeholders were introduced.
  - `git diff --check` -> passed.

## 2026-06-18 v2.3.6 P11.1 feature registration

- Request:
  - Move from planning into the first implementation slice while preserving the AGENTS.md rule to pick exactly one unfinished feature.
- Planning:
  - Added `P11.1-task-contract-compiler` as the single in-progress v2.3.6 feature.
  - Scoped P11.1 to the shared task contract compiler, optional `Goal.taskContract` storage, contract-aware planner routing, and focused compatibility tests.
- Changed files:
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`

## 2026-06-18 v2.3.6 P11.1 task contract compiler

- Request:
  - Implement the first v2.3.6 slice: compile deterministic task contracts before planning without starting the location/provenance/pipeline slices.
- Implementation:
  - Added `AgentTaskContract` and `compileAgentTaskContract` for Chrome bookmarks -> grouped Markdown -> Desktop deterministic local artifact goals.
  - Added optional `Goal.taskContract` storage while preserving old goal JSON compatibility.
  - `GoalChatService` now compiles and stores the contract before milestone planning, then passes it to the planner.
  - `AgentGoalPlanner` now accepts `taskContract`; supported Chrome bookmark contracts with `chrome_bookmarks_read` available produce the single native bookmark milestone without a model request.
  - Preserved legacy no-contract Chrome bookmark native planning behavior.
  - Hardened the contract guard so malformed contracts, missing acceptance, wrong evidence refs, missing capability, or unsupported sources fall back to model planning rather than crashing or taking the native path.
- Review evidence:
  - P11.1 implementation worker followed TDD and reported RED for missing contract module / undefined saved contract, then GREEN after implementation.
  - Spec reviewer approved the initial implementation, code quality reviewer requested fixes for over-broad Chinese grouping detection, static contract IDs, malformed contract crashes, and brittle tests.
  - Worker fixed those issues with RED/GREEN evidence.
  - Spec re-review requested validation of exact acceptance evidence refs before native contract routing.
  - Worker added evidence-ref validation and regression coverage with RED/GREEN evidence.
  - Final spec re-review -> APPROVED, confirming wrong evidence refs fall back to model planning and P11.1 does not implement location/provenance/pipeline behavior.
  - Code quality re-review -> APPROVED, with no blocking issues.
- Changed files:
  - `src/shared/agentTaskContract.ts`
  - `src/shared/agentTaskContract.test.ts`
  - `src/shared/agentGoal.ts`
  - `src/main/goalChatService.ts`
  - `src/main/goalChatService.test.ts`
  - `src/main/agentGoalPlanner.ts`
  - `src/main/agentGoalPlanner.test.ts`
  - `src/main/agentGoalStore.test.ts`
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`
- Verification evidence:
  - `npm test -- src/shared/agentTaskContract.test.ts src/main/goalChatService.test.ts src/main/agentGoalPlanner.test.ts src/main/agentGoalStore.test.ts` -> 4 files / 40 tests passed.
  - `npm run harness:check` -> passed.
  - `npm run build` -> passed.
  - `git diff --check` -> passed.

## 2026-06-18 v2.3.6 P11.2 feature registration

- Request:
  - Continue the v2.3.6 implementation after P11.1 by picking exactly one new unfinished feature.
- Planning:
  - Added `P11.2-location-resource-model` as the single in-progress feature.
  - Scoped P11.2 to canonical location resolution for `~`, Desktop, Downloads, workspace-relative and absolute paths across goal output roots, sandbox roots, acceptance, tool permission narrowing, and Chrome bookmark artifact writes.
- Baseline evidence:
  - `./init.sh` -> harness check passed; `src/shared/packageScripts.test.ts` passed with 6 tests.
  - `node -e "const f=require('./.zerox/feature_list.json'); const open=f.features.filter(x=>x.status!=='done'); console.log(JSON.stringify({updatedAt:f.updatedAt,total:f.features.length,open}, null, 2))"` -> no open features before registering P11.2.
- Changed files:
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`

## 2026-06-18 v2.3.6 P11.2 unified location resource model

- Request:
  - Implement the second v2.3.6 slice: canonicalize local destination resources without starting provenance manifests or deterministic pipeline execution.
- Implementation:
  - Added a shared `locationResource` resolver for home-relative paths, localized Desktop/Downloads aliases, workspace-relative paths, absolute paths, and boundary-root checks.
  - Stored canonical location environment data in run contexts so sandbox roots compare against the real user home/Desktop/Downloads instead of literal `~` strings.
  - Updated goal output root extraction, tool permission narrowing, acceptance checks, and Chrome bookmark artifact writes to use canonical location roots.
  - Hardened output-root extraction so standalone Desktop/Downloads aliases count only when tied to explicit output destination language, and incidental mentions such as "write tests for Desktop alias parsing" do not grant real Desktop access.
  - Hardened shell command path prechecks so bare alias paths such as `Desktop/report.md`, `Downloads/report.md`, `桌面/report.md`, and `下载/report.md` are blocked unless the matching root is explicitly allowed.
  - Blocked shell redirection operators before shell template matching and before acceptance command execution so `cat README.md>/tmp/out` and `cat </etc/passwd` cannot bypass workspace-only path checks.
- Review evidence:
  - P11.2 worker followed TDD and reported RED for missing shared resolver behavior, literal `~/Desktop` artifact writes, stale workspace Desktop acceptance, localized alias gaps, standalone output destination extraction, bare alias shell path narrowing, incidental Desktop false positives, and shell redirection bypasses.
  - Initial spec/code reviews requested fixes for acceptance standalone aliases granting home, missing bare alias shell token extraction, over-broad standalone Desktop output intent extraction, and over-broad command tokenization.
  - Worker fixed those review findings and reported GREEN with focused tests passing.
  - Parent reran focused tests, harness, build, and diff checks after each review fix.
  - Final spec re-review -> APPROVED.
  - Final narrow code-quality re-review -> APPROVED, confirming the redirection fix and no obvious unacceptable false positives for `node -e "console.log('Desktop')"` or `grep Desktop README.md`.
- Changed files:
  - `src/shared/locationResource.ts`
  - `src/shared/locationResource.test.ts`
  - `src/shared/agentWorkspace.ts`
  - `src/shared/agentWorkspace.test.ts`
  - `src/shared/toolPermissions.ts`
  - `src/shared/toolPermissions.test.ts`
  - `src/main/goalOutputRoots.ts`
  - `src/main/goalOutputRoots.test.ts`
  - `src/main/agentGoalAcceptance.ts`
  - `src/main/agentGoalAcceptance.test.ts`
  - `src/main/agentToolExecutor.ts`
  - `src/main/agentToolExecutor.test.ts`
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`
- Verification evidence:
  - `npm test -- src/shared/toolPermissions.test.ts src/main/agentGoalAcceptance.test.ts` -> RED before fix: 2 expected failures for shell redirection bypass; GREEN after fix: 2 files / 62 tests passed.
  - `npm test -- src/shared/locationResource.test.ts src/shared/agentWorkspace.test.ts src/shared/toolPermissions.test.ts src/main/goalOutputRoots.test.ts src/main/agentGoalAcceptance.test.ts src/main/agentToolExecutor.test.ts` -> 6 files / 119 tests passed.
  - `npm run harness:check` -> passed.
  - `npm run build` -> passed.
  - `git diff --check` -> passed.

## 2026-06-18 v2.3.6 P11.3 feature registration

- Request:
  - Continue the v2.3.6 implementation after P11.2 by picking exactly one new unfinished feature.
- Planning:
  - Added `P11.3-artifact-provenance-acceptance` as the single in-progress feature.
  - Scoped P11.3 to sidecar provenance manifests, deterministic artifact write provenance refs, provenance-backed acceptance checks, and trajectory/run graph evidence projection.
  - Explicitly kept deterministic pipeline routing, eval/docs release metadata, and packaged-app computer-use acceptance out of this slice.
- Baseline evidence:
  - `./init.sh` -> harness check passed; `src/shared/packageScripts.test.ts` passed with 6 tests.
  - `node -e "const f=require('./.zerox/feature_list.json'); const open=f.features.filter(x=>x.status!=='done'); console.log(JSON.stringify({updatedAt:f.updatedAt,total:f.features.length,openCount:open.length,open}, null, 2))"` -> no open features after closing P11.2 and before registering P11.3.
- Changed files:
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`

## 2026-06-18 v2.3.6 P11.3 artifact provenance acceptance

- Request:
  - Implement the third v2.3.6 slice: make deterministic artifact completion provenance-backed so stale files cannot satisfy acceptance.
- Implementation:
  - Added `agentArtifactProvenance` sidecar helpers for manifest path derivation, SHA-256 hashing, writing, and verification.
  - Manifest schema records `runId`, optional `goalId`/`milestoneId`, `artifactId`, `artifactRef`, source metadata, canonical destination path, destination SHA-256, size, and `generatedAt`.
  - Chrome bookmark artifact writes now create provenance sidecars for `bookmark_list.md` and `goalEvidence.md`, return `provenance:*` refs/paths, and include those refs in tool evidence.
  - `file_exists` acceptance checks now require provenance when `requireProvenance: true` or `artifactRef` is present, and reject missing, stale, wrong-run, wrong-goal, wrong-milestone, wrong-artifact, wrong-ref, wrong-destination, or hash-mismatched sidecars.
  - `AgentRunContext` now carries explicit optional `runId`, `goalId`, and `milestoneId`; `GoalRuntimeEngine` passes real goal-run identity to tools and emits provenance-backed `artifact_created` trajectory events from actual artifact-producing tool results.
  - Run graph projection now creates artifact nodes from `artifact_created` events while filtering inconsistent/spoofed `provenanceRef` payloads.
  - Deterministic artifact write and verification paths conservatively reject symlinked artifact files, sidecars, output roots, and intermediate artifact parents; known macOS system aliases `/var` and `/tmp` are allowed only at that system-alias segment to avoid false positives.
- Review evidence:
  - P11.3 worker followed TDD and reported RED for missing helper module, missing Chrome provenance fields/sidecars, acceptance ignoring provenance, missing run graph artifact nodes, and missing exported provenance refs.
  - Initial spec/code reviews requested fixes for first-class run/goal/milestone identity, real runtime `artifact_created` emission instead of hand-seeded events, symlink-safe writes/verification, runGraph provenanceRef spoofing, and broader mismatch tests.
  - Worker fixed those findings with RED/GREEN evidence; spec re-review -> APPROVED.
  - Code-quality re-review found one remaining P1 for symlinked output roots/intermediate parents. Worker added parent-segment symlink guards and tests; narrow code-quality re-review -> APPROVED.
- Changed files:
  - `src/shared/agentArtifactProvenance.ts`
  - `src/shared/agentArtifactProvenance.test.ts`
  - `src/shared/agentWorkspace.ts`
  - `src/shared/agentWorkspace.test.ts`
  - `src/main/agentToolExecutor.ts`
  - `src/main/agentToolExecutor.test.ts`
  - `src/main/agentGoalAcceptance.ts`
  - `src/main/agentGoalAcceptance.test.ts`
  - `src/main/goalRuntimeEngine.ts`
  - `src/main/goalRuntimeEngine.test.ts`
  - `src/shared/runGraph.ts`
  - `src/shared/runGraph.test.ts`
  - `src/main/agentEpisodeExporter.test.ts`
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`
- Verification evidence:
  - `npm test -- src/shared/agentArtifactProvenance.test.ts src/main/agentToolExecutor.test.ts` -> RED before second fix: 2 expected failures for parent-directory symlink escape; GREEN after fix: 2 files / 32 tests passed.
  - `npm test -- src/shared/agentArtifactProvenance.test.ts src/main/agentToolExecutor.test.ts src/main/agentGoalAcceptance.test.ts src/shared/runGraph.test.ts src/main/agentEpisodeExporter.test.ts src/main/goalRuntimeEngine.test.ts src/shared/agentWorkspace.test.ts` -> 7 files / 85 tests passed.
  - `npm run harness:check` -> passed.
  - `npm run build` -> passed.
  - `git diff --check` -> passed.

## 2026-06-18 v2.3.6 P11.4 feature registration

- Request:
  - Continue the v2.3.6 implementation after P11.3 by picking exactly one new unfinished feature.
- Planning:
  - Added `P11.4-deterministic-local-artifact-pipeline` as the single in-progress feature.
  - Scoped P11.4 to the contract-driven deterministic local artifact execution path, existing authorization/sandbox/provenance boundaries, Chrome bookmark native execution without parser fallback loops, and one non-Chrome deterministic pipeline test path.
  - Explicitly kept eval/docs release metadata, full command-line gate, and packaged-app computer-use acceptance out of this slice.
- Baseline evidence:
  - `./init.sh` -> harness check passed; `src/shared/packageScripts.test.ts` passed with 6 tests.
  - `node -e "const f=require('./.zerox/feature_list.json'); const open=f.features.filter(x=>x.status!=='done'); console.log(JSON.stringify({updatedAt:f.updatedAt,total:f.features.length,openCount:open.length,open}, null, 2))"` -> no open features after closing P11.3 and before registering P11.4.
- Changed files:
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`

## 2026-06-18 v2.3.6 P11.4 deterministic local artifact pipeline

- Request:
  - Implement only P11.4: deterministic local artifact contracts should execute through a narrow pipeline while preserving existing tool execution, authorization, sandbox, location, and provenance boundaries.
- Implementation:
  - Added `executeDeterministicGoalPipeline` for supported deterministic local artifact contracts.
  - Chrome bookmark contracts call `chrome_bookmarks_read` exactly once and normalize returned `bookmark_list` / `goalEvidence` artifact and provenance refs.
  - Added a non-Chrome JSON-file-to-Markdown deterministic path that reads via `file_read`, transforms the JSON fixture to Markdown, and writes via `file_write`.
  - Routed supported `goal.taskContract` executions in `GoalRuntimeEngine` before model-profile/model-loop assembly; unsupported or absent contracts continue through existing Goal Mode execution.
  - The runtime deterministic branch authorizes each tool through `ToolAuthorizationService`, executes through the existing `AgentToolExecutor`, passes the run-scoped `AgentRunContext`, and emits `tool_call`, `tool_result`, `artifact_created`, `final_summary`, and checkpoint trajectory evidence.
  - Extended `file_write` so artifact metadata plus run context writes provenance sidecars with run/goal/milestone identity; ordinary file writes keep their existing behavior.
  - Marked `P11.4-deterministic-local-artifact-pipeline` done in `.zerox/feature_list.json`.
- Changed files:
  - `src/main/agentDeterministicGoalPipeline.ts`
  - `src/main/agentDeterministicGoalPipeline.test.ts`
  - `src/main/goalRuntimeEngine.ts`
  - `src/main/goalRuntimeEngine.test.ts`
  - `src/main/agentToolExecutor.ts`
  - `src/main/agentToolExecutor.test.ts`
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`
  - `.git/sdd/task-4-report.md`
- RED evidence:
  - `npm test -- src/main/agentDeterministicGoalPipeline.test.ts` -> failed because `./agentDeterministicGoalPipeline` did not exist.
  - `npm test -- src/main/goalRuntimeEngine.test.ts -t "routes supported deterministic"` -> failed because deterministic contracts still loaded the model profile.
  - `npm test -- src/main/agentToolExecutor.test.ts -t "writes provenance for deterministic artifact file writes"` -> failed because `file_write` returned only path/byte count and no provenance refs.
- GREEN evidence:
  - `npm test -- src/main/agentDeterministicGoalPipeline.test.ts src/main/agentGoalController.test.ts src/main/goalRuntimeEngine.test.ts src/main/agentToolExecutor.test.ts src/shared/agentToolCapabilities.test.ts` -> 5 files / 53 tests passed.
  - `npm run harness:check` -> passed.
  - `npm run build` -> passed.
  - `git diff --check` -> passed.
- Residual risks:
  - P11.4 did not run packaged-app computer-use acceptance or add eval/docs release metadata, per slice constraints.

## 2026-06-18 v2.3.6 P11.4 review hardening

- Request:
  - Address P11.4 review findings before treating the deterministic local artifact pipeline slice as closed.
- Review fixes:
  - Moved `file_write` artifact provenance creation behind trusted internal `artifactWrite` execution metadata instead of model-visible args, so arbitrary model-loop `file_write` calls cannot mint valid-looking artifact provenance.
  - Added required artifact/provenance validation so Chrome and JSON deterministic pipelines fail when tool results omit required artifact refs, artifact paths, provenance refs, or provenance sidecar paths.
  - Added a typed `JsonMarkdownTaskContract` variant in `AgentTaskContract`; removed the previous test-only structural cast for the non-Chrome path.
  - Added real `ToolAuthorizationService` coverage for Chrome deterministic routing, including the narrow Chrome user data read root needed by `chrome_bookmarks_read`.
  - Added runtime tests for unsupported deterministic and non-deterministic contracts falling back to the existing Goal Mode/model loop.
  - Awaited deterministic `tool_call`, `tool_result`, and `artifact_created` trajectory writes before `runMilestone` returns.
  - Removed JSON pipeline synthesis of required artifact evidence fields; required refs and provenance evidence must now come from the actual `file_write` result.
- Review evidence:
  - Initial P11.4 spec review -> CHANGES_REQUIRED for real Chrome authorization, typed non-Chrome contract support, fallback tests, and awaited trajectory writes.
  - Initial P11.4 code-quality review -> CHANGES_REQUIRED for spoofable `file_write` provenance minting and missing required artifact/provenance validation.
  - Worker fixed those findings with RED/GREEN evidence; spec re-review -> APPROVED.
  - Code-quality re-review found one remaining JSON `artifactRef` synthesis issue; worker removed the synthesis and added regression coverage; narrow code-quality re-review -> APPROVED.
- Changed files:
  - `src/shared/agentTaskContract.ts`
  - `src/shared/agentTaskContract.test.ts`
  - `src/main/agentDeterministicGoalPipeline.ts`
  - `src/main/agentDeterministicGoalPipeline.test.ts`
  - `src/main/goalRuntimeEngine.ts`
  - `src/main/goalRuntimeEngine.test.ts`
  - `src/main/agentToolExecutor.ts`
  - `src/main/agentToolExecutor.test.ts`
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`
- Final verification evidence:
  - `npm test -- src/main/agentDeterministicGoalPipeline.test.ts` -> RED before final strictness fix: JSON `file_write` could omit `artifactRef` while the pipeline synthesized it and returned success.
  - `npm test -- src/main/agentDeterministicGoalPipeline.test.ts src/main/agentGoalController.test.ts src/main/goalRuntimeEngine.test.ts src/main/agentToolExecutor.test.ts src/shared/agentToolCapabilities.test.ts src/shared/agentTaskContract.test.ts` -> 6 files / 69 tests passed.
  - `npm run harness:check` -> passed.
  - `npm run build` -> passed.
  - `git diff --check` -> passed.

## 2026-06-18 v2.3.6 P11.5 feature registration

- Request:
  - Continue the v2.3.6 implementation after P11.4 by picking exactly one new unfinished feature.
- Planning:
  - Added `P11.5-eval-docs-release-metadata` as the single in-progress feature.
  - Scoped P11.5 to deterministic eval coverage, README/package metadata tests, and progress evidence.
  - Explicitly kept full command-line verification and independent packaged-app computer-use acceptance out of this slice; those remain later gates before v2.3.6 can be complete.
- Baseline evidence:
  - `./init.sh` -> harness check passed; `src/shared/packageScripts.test.ts` passed with 6 tests.
  - `node -e "const f=require('./.zerox/feature_list.json'); const open=f.features.filter(x=>x.status!=='done'); console.log(JSON.stringify({updatedAt:f.updatedAt,total:f.features.length,openCount:open.length,open}, null, 2))"` -> no open features after closing P11.4 and before registering P11.5.
- Changed files:
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`

## 2026-06-20 v2.4.0 release

- ABC activation complete (P1-P8 wired into the runtime, observability events
  emitted, version bumped, packaged, tagged, released).
- Version: package.json/package-lock 2.3.6 → 2.4.0; packageScripts + readme
  tests assert 2.4.0; feature_list P12-2.4.0-iteration-activation-and-release
  (done).
- better-sqlite3 upgraded 11 → 12.x (v11 cannot compile against Electron 42's
  V8 External::Value tag API); npmRebuild:true + asarUnpack so the packaged app
  uses the SQLite storage backend at runtime (no JSON fallback).
- Distribution: `npm run dist:mac` built
  - release/Zerox Agent-2.4.0-arm64.dmg (128279195 bytes, sha256 5ce654bf...)
  - release/Zerox Agent-2.4.0-arm64-mac.zip (349320265 bytes, sha256 cca73728...)
  - Info.plist CFBundleShortVersionString = 2.4.0
- git tag v2.4.0 pushed; GitHub Release v2.4.0 created (not draft, not
  prerelease) with dmg + zip + blockmaps:
  https://github.com/ZeroxZhang/zerox-agent/releases/tag/v2.4.0
- Final verification: npm run verify 151 files / 911 tests, agent eval 26/26,
  memory eval 2/2; harness:check green.
- Test growth across the iteration: 135 files / 767 tests → 151 files / 911
  tests (+16 files, +144 tests; zero regression).

## 2026-06-20 Wave 5 implementation consistency review (D)

- Reviewed all 8 implemented phases against contracts v1.4: **PASS, no drift**.
- Every frozen interface signature matches its implementation (audited §1–§10:
  Storage migrate/backup/close + 17 repos; LLMProvider complete/stream/
  countTokens/buildCachePrefix; analyzeShell→ShellPlan + ToolWorker.execute;
  CompactionStrategy shouldCompact/compact; ActorRuntime spawn/send/wait/cancel/
  status + ForkContext; WorkflowRuntime run/register + parallel/pipeline;
  MemoryRepository archive(reason?); McpTransport start/send/onNotification/
  close; MaxMode runStep).
- §11 consumption table realized in code: each implemented contract is imported
  by its declared downstream phases (Storage↔P2/P5/P6/P7; Provider↔P5/P6/P8;
  ShellPlan/ToolWorker↔P5/P6; WorkflowRuntime↔P7; ActorRuntime↔P7/P8).
- All 26 §12 patches realized in code.
- Additive invariants hold: trajectory events 29→48, runGraph node kinds 11→17;
  existing 11 node-producing projections + runGraph parity test unchanged.
- 5 non-blocking deviations documented (tree-sitter→tokenizer, QuickJS→Node
  executor, MCP http/sse client staged, flag-gated runtime activation, 15-store
  cutover follow-up) — all spec-permitted fallbacks / staged cutovers.
- Full review: iteration-roadmap/CONSISTENCY-REVIEW-IMPL.md (local, gitignored).

## 2026-06-20 v2.4.1 session history management

- Request:
  - Ship v2.4.1 with managed historical chat sessions in the workspace sidebar:
    per-session hover actions, delete, archive/restore, a collapsible archive
    group, latest assistant-response time, and cumulative token usage.
- Implementation:
  - Added `archivedAt`, `lastAssistantMessageAt`, and cumulative `tokenUsage`
    metadata to shared chat session list/record models.
  - Extended `ChatSessionStore` with archive, restore, delete, and additive
    token usage mutations, including legacy normalization.
  - Surfaced provider token usage from OpenAI-compatible responses and recorded
    provider or estimated turn usage from `ChatService`.
  - Exposed `chatSessions:archive`, `chatSessions:restore`, and
    `chatSessions:delete` through container, IPC, and preload.
  - Reworked the workspace sidebar into managed history rows with hover menus,
    latest-response time, cumulative token display, and a collapsible archive
    group. Actual implementation follows the selected A information architecture
    but uses the app's existing restrained shell instead of the rough mockup.
  - Bumped package metadata and release docs to v2.4.1.
- Changed files:
  - `src/shared/chat.ts`
  - `src/main/chatSessionStore.ts`
  - `src/main/chatSessionStore.test.ts`
  - `src/main/openAiCompatibleClient.ts`
  - `src/main/openAiCompatibleClient.test.ts`
  - `src/main/chatService.ts`
  - `src/main/chatService.test.ts`
  - `src/main/container.ts`
  - `src/main/ipc/index.ts`
  - `src/preload/index.ts`
  - `src/preload/index.test.ts`
  - `src/renderer/App.tsx`
  - `src/renderer/components/AgentChatPanel.tsx`
  - `src/renderer/styles/sidebar.css`
  - `src/renderer/materialDesign.test.ts`
  - `package.json`
  - `package-lock.json`
  - `README.md`
  - `src/shared/packageScripts.test.ts`
  - `src/shared/readme.test.ts`
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`
- RED evidence:
  - `npm test -- src/main/chatSessionStore.test.ts` -> failed before store
    operations existed (`addTokenUsage`/archive/delete metadata assertions).
  - `npm test -- src/main/chatService.test.ts` -> failed because token usage
    writes were not recorded.
  - `npm test -- src/preload/index.test.ts` -> failed because archive/restore/
    delete preload APIs were not exposed.
  - `npm test -- src/renderer/materialDesign.test.ts` -> failed because the
    managed history UI and operation channels were absent.
- GREEN evidence:
  - `npm test -- src/main/chatSessionStore.test.ts` -> 12 tests passed.
  - `npm test -- src/main/openAiCompatibleClient.test.ts src/main/chatService.test.ts` -> 32 tests passed.
  - `npm test -- src/preload/index.test.ts` -> 2 tests passed.
  - `npm test -- src/renderer/materialDesign.test.ts` -> 32 tests passed.
  - `npm test -- src/shared/packageScripts.test.ts src/shared/readme.test.ts` -> 10 tests passed.
  - `npm run build` -> passed.
  - Visual QA: Vite/Electron dev preview at `http://127.0.0.1:5173/#chat`
    showed aligned sidebar rows, hidden hover actions, and a correctly placed
    archive/delete menu.
  - `npm run verify` -> 153 test files / 931 tests passed; agent eval 26/26;
    memory eval 2/2.
  - `npm run smoke:prod` -> passed; local `better-sqlite3` ABI mismatch fell
    back to JSON through the existing storage fallback during smoke.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.
- Update/package/release evidence:
  - Merged latest `origin/main` into `codex/v2.3.5-run-graph-harness` before
    packaging.
  - Added `scripts/package-mac.mjs` so `npm run dist:mac` explicitly rebuilds
    `better-sqlite3` for the Electron ABI before packaging and restores the
    Node ABI afterward; `electron-builder.yml` now leaves native rebuilds to
    this script.
  - `npx vitest run src/shared/packageScripts.test.ts` -> 7 tests passed.
  - `npm run dist:mac` -> passed; generated macOS arm64 DMG + ZIP and
    blockmaps.
  - `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron -e "... packaged
    better-sqlite3 ..."` -> packaged SQLite opened `:memory:` successfully.
  - `BUILDING_AGENT_SMOKE=1 "release/mac-arm64/Zerox Agent.app/Contents/MacOS/Zerox Agent"` -> packaged smoke passed with SQLite available.
  - `npm run verify` -> 153 test files / 931 tests passed; agent eval 26/26;
    memory eval 2/2.
  - `npm run smoke:prod` -> passed; source-tree smoke uses JSON fallback after
    the packaging script restores the root native module to the Node ABI.
  - `npm run harness:check` -> passed.
  - Info.plist CFBundleShortVersionString = 2.4.1; CFBundleVersion = 2.4.1.
  - Artifacts:
    - `release/Zerox Agent-2.4.1-arm64.dmg` (128276939 bytes, sha256
      ca2b4d892841e4938b2b538f3ab644f35bbe84f9096b1331e446c25b840d74c7)
    - `release/Zerox Agent-2.4.1-arm64.dmg.blockmap` (135107 bytes, sha256
      edfc88bdc656c3471d7ff947a5b968787319d372ec933850365719c206067183)
    - `release/Zerox Agent-2.4.1-arm64-mac.zip` (349324769 bytes, sha256
      23c296926631998f600517e7a3eac9b3ef9d7f5df0bdd7254120a5b0f633f8e7)
    - `release/Zerox Agent-2.4.1-arm64-mac.zip.blockmap` (343716 bytes,
      sha256 5454d00c3369a40e42e7dea011f600a76adff2bd5a7d8aeafa46f82faa1ec2cb)
  - GitHub Release target:
    https://github.com/ZeroxZhang/zerox-agent/releases/tag/v2.4.1

## 2026-06-21 - Task 1 Workspace Sandbox And Tool Permission Hardening

- Summary:
  - Added shared realpath/no-symlink path-boundary validation and reused it in run-context checks, tool authorization, executor-side guards, local file organizer moves, and native Markdown report writes.
  - Hardened read-only runs so writable roots are not exposed and `chrome_bookmarks_read` cannot write artifacts.
  - Validated generated move previews/transactions as capabilities before `rename()`.
- Changed files:
  - `src/shared/locationResource.ts`
  - `src/shared/agentWorkspace.ts`
  - `src/shared/toolPermissions.ts`
  - `src/main/agentToolExecutor.ts`
  - `src/main/localFileOrganizer.ts`
  - `src/main/nativeResearchTools.ts`
  - `src/shared/agentWorkspace.test.ts`
  - `src/shared/toolPermissions.test.ts`
  - `src/main/agentToolExecutor.test.ts`
  - `src/main/localFileOrganizer.test.ts`
  - `src/main/nativeResearchTools.test.ts`
- RED evidence:
  - `npm test -- src/main/agentToolExecutor.test.ts src/shared/toolPermissions.test.ts src/main/nativeResearchTools.test.ts` -> failed: symlink read/write/native report paths were allowed or executed.
  - `npm test -- src/main/agentToolExecutor.test.ts src/main/localFileOrganizer.test.ts src/shared/toolPermissions.test.ts` -> failed: crafted apply/rollback move paths outside root were accepted before rename.
  - `npm test -- src/shared/agentWorkspace.test.ts src/shared/toolPermissions.test.ts src/main/chatService.test.ts src/main/agentToolExecutor.test.ts` -> failed: read-only write access, approved-command outside shell paths, and read-only Chrome artifact writes were allowed.
- GREEN evidence:
  - `npm test -- src/shared/agentWorkspace.test.ts src/shared/toolPermissions.test.ts src/main/agentToolExecutor.test.ts src/main/localFileOrganizer.test.ts src/main/nativeResearchTools.test.ts src/main/chatService.test.ts` -> 6 files / 112 tests passed.
  - `npm test` -> 164 files / 1028 tests passed.
  - `npm run build` -> passed.
  - `npm run harness:check` -> passed.

## 2026-06-21 - Task 1 Follow-up Relative Shell Path Escapes

- Summary:
  - Hardened approved shell command path extraction so relative path-shaped arguments are checked against the run workspace boundary.
  - Added authorization and executor-side regressions for `cat ../outside/secret.txt` with `allowWorkspaceEscape: false`.
- Changed files:
  - `src/shared/toolPermissions.ts`
  - `src/shared/toolPermissions.test.ts`
  - `src/main/agentToolExecutor.test.ts`
  - `.superpowers/sdd/task-1-followup-report.md`
- RED evidence:
  - `npm test -- src/shared/toolPermissions.test.ts src/main/agentToolExecutor.test.ts` -> failed before implementation: authorization allowed the approved `cat ../outside/secret.txt` template and executor `shell_exec` read `outside secret` from outside the workspace.
- GREEN evidence:
  - `npm test -- src/shared/toolPermissions.test.ts src/main/agentToolExecutor.test.ts` -> 2 files / 70 tests passed.
  - `npm run harness:check` -> passed.
  - `npm test` -> 164 files / 1030 tests passed.

## 2026-06-21 - Task 2 Follow-up Migration Test Fresh Artifact

- Summary:
  - Removed the migration round-trip test's dependency on repository-level `dist-electron`.
  - The test now compiles the current Electron source into a temporary script root and runs copied migration scripts from there, so clean checkouts exercise migration instead of skipping.
- Changed files:
  - `src/main/storage/migrateRoundTrip.test.ts`
  - `.superpowers/sdd/task-2-followup-report.md`
  - `.zerox/progress.md`
- RED evidence:
  - With repository `dist-electron` temporarily moved aside, `npm test -- src/main/storage/migrateRoundTrip.test.ts` reported `Test Files 1 skipped (1)` and `Tests 1 skipped (1)`.
- GREEN evidence:
  - With repository `dist-electron` temporarily moved aside after the fix, `npm test -- src/main/storage/migrateRoundTrip.test.ts` -> 1 file / 1 test passed; `DIST_RESTORED=yes`.
  - `npm test -- src/main/storage/storeProxy.test.ts src/main/toolAuditLog.test.ts src/main/storage/migrateRoundTrip.test.ts src/main/storage/repositories/repositories.test.ts src/main/storage/repositories/runRepository.test.ts src/main/chatSessionStore.test.ts src/main/workspaceRunStore.test.ts src/main/agentRunStore.test.ts src/main/agentTrajectoryStore.test.ts src/main/agentGoalStore.test.ts` -> 10 files / 86 tests passed.
  - `npm run harness:check` -> passed.
  - `npm run verify` -> 164 files / 1046 tests passed; build passed; agent eval 26/26; memory eval 2/2.

## 2026-06-21 - Task 3 Provider Timeout And Observability Durability

- Summary:
  - Added a shared abortable fetch timeout helper and routed OpenAI-compatible, Anthropic, and Gemini provider requests through it.
  - Passed provider-factory timeout dependencies into native Anthropic/Gemini providers.
  - Added explicit `flushShadowWrites()` drains for dual-mode run and trajectory JSON sidecars.
- Changed files:
  - `src/main/fetchWithTimeout.ts`
  - `src/main/openAiCompatibleClient.ts`
  - `src/main/providers/providerFactory.ts`
  - `src/main/providers/anthropicProvider.ts`
  - `src/main/providers/geminiProvider.ts`
  - `src/main/agentRunStore.ts`
  - `src/main/agentTrajectoryStore.ts`
  - `src/main/providers/providers.test.ts`
  - `src/main/modelRetry.test.ts`
  - `src/main/storage/storeProxy.test.ts`
  - `.superpowers/sdd/task-3-report.md`
- RED evidence:
  - `npm test -- src/main/providers/providers.test.ts src/main/modelRetry.test.ts` -> failed: native Anthropic/Gemini never-settling fetches remained `pending` instead of timing out; retry classification tests also remained `pending`.
  - `npm test -- src/main/storage/storeProxy.test.ts` -> failed: dual-mode run and trajectory stores did not expose `flushShadowWrites()`.
- GREEN evidence:
  - `npm test -- src/main/providers/providers.test.ts src/main/modelRetry.test.ts` -> 2 files / 23 tests passed.
  - `npm test -- src/main/storage/storeProxy.test.ts src/main/agentTrajectoryStore.test.ts src/main/agentRunStore.test.ts` -> 3 files / 26 tests passed.
  - `npm test` -> 164 files / 1051 tests passed.
  - `npm run build` -> passed.
  - `npm run harness:check` -> passed.
  - `npm run verify` -> 164 files / 1051 tests passed; build passed; agent eval 26/26; memory eval 2/2.
  - `npm run smoke:prod` -> passed; renderer rendered agent chat UI with expected SQLite ABI fallback to JSON.

## 2026-06-21 - Task 4 Runtime Protocol, Workflow, And Replay-Grade Observability

- Summary:
  - Kept paused multi-tool histories provider-valid by trimming unprocessed assistant tool calls when a pause/finalization interrupts a tool batch.
  - Scoped offloaded tool-result refs to run/session/request/workspace-run identity with explicit-capability escape hatch, and carried provider tool_call ids through chat status, trajectory, workspace ledger, offload refs, and run graph projection.
  - Closed workflow phases, preserved phase metadata, terminalized active phases on completion/error, and cleared deadline timers.
  - Added `SkillExecutionService` snapshots and exported chat trajectory/workspace-run ledgers in episode packages.
- Changed files:
  - `src/main/agentLoop.ts`
  - `src/main/chatService.ts`
  - `src/main/toolObservationOffload.ts`
  - `src/main/toolResultOffloadStore.ts`
  - `src/main/workflow/workflowRuntime.ts`
  - `src/main/skillExecutionService.ts`
  - `src/main/agentEpisodeExporter.ts`
  - `src/shared/runGraph.ts`
  - `src/shared/chat.ts`
  - `src/main/dynamicToolRegistry.ts`
  - `src/main/agentToolExecutor.ts`
  - `src/main/agentLoop.test.ts`
  - `src/main/chatService.test.ts`
  - `src/main/toolObservationOffload.test.ts`
  - `src/main/toolResultOffloadStore.test.ts`
  - `src/main/actors/actorRuntime.full.test.ts`
  - `src/main/agentEpisodeExporter.test.ts`
  - `src/shared/runGraph.test.ts`
  - `src/main/skillExecutionService.test.ts`
- RED evidence:
  - `npm test -- src/main/agentLoop.test.ts src/main/chatService.test.ts` -> failed: paused multi-tool history had unmatched provider tool calls; chat/workspace ledger events lacked provider `toolCallId`.
  - `npm test -- src/main/toolResultOffloadStore.test.ts src/main/toolObservationOffload.test.ts src/shared/toolPermissions.test.ts src/main/agentToolExecutor.test.ts` -> failed: scoped offload metadata was not written and cross-run ref read was allowed.
  - `npm test -- src/main/actors/actorRuntime.full.test.ts src/main/agentEpisodeExporter.test.ts src/shared/runGraph.test.ts src/main/skillExecutionService.test.ts` -> failed: workflow phases stayed running, episode package lacked ledger files, run graph ignored workspace ledger events, and `skillExecutionService` was missing.
- GREEN evidence:
  - `npm test -- src/main/agentLoop.test.ts src/main/chatService.test.ts` -> 2 files / 45 tests passed.
  - `npm test -- src/main/toolResultOffloadStore.test.ts src/main/toolObservationOffload.test.ts src/shared/toolPermissions.test.ts src/main/agentToolExecutor.test.ts` -> 4 files / 77 tests passed.
  - `npm test -- src/main/chatService.test.ts src/shared/workspaceRunLedger.test.ts` -> 2 files / 31 tests passed.
  - `npm test -- src/main/actors/actorRuntime.full.test.ts` -> 1 file / 19 tests passed.
  - `npm test -- src/shared/skillExecutionContract.test.ts src/main/chatService.test.ts src/main/agentEpisodeExporter.test.ts src/shared/runGraph.test.ts src/main/skillExecutionService.test.ts` -> 5 files / 42 tests passed.
  - `npm run harness:check` -> passed.
  - `npm run build` -> passed.
  - `npm run verify` -> 165 files / 1063 tests passed; build passed; agent eval 26/26; memory eval 2/2.
  - `npm run smoke:prod` -> passed; renderer rendered agent chat UI with expected SQLite ABI fallback to JSON.

## 2026-06-21 - Task 4 Follow-Up Scoped Tool-Result Ref Reads

- Summary:
  - Passed matching `toolResultReadScope` into `agentRuntimeEngine` and the legacy `agentRunnerService` fallback so same-run `tool_result_read` can read scoped refs written earlier in the same run.
  - Added shared UI read options for scoped/capability-based tool-result ref reads and threaded them through container, IPC, preload, and the trajectory panel.
  - Preserved denial for no-context and cross-run scoped UI reads while allowing explicit `tool_result_ref_read` capability reads.
- Changed files:
  - `src/main/agentRuntimeEngine.ts`
  - `src/main/agentRunnerService.ts`
  - `src/main/container.ts`
  - `src/main/ipc/index.ts`
  - `src/main/toolResultOffloadStore.ts`
  - `src/preload/index.ts`
  - `src/renderer/components/RunTrajectoryPanel.tsx`
  - `src/shared/toolResultRefs.ts`
  - `src/main/agentRuntimeEngine.test.ts`
  - `src/main/agentRunnerService.test.ts`
  - `src/main/container.test.ts`
- RED evidence:
  - `npm test -- src/main/agentRuntimeEngine.test.ts -t "owning runtime run read"` -> failed: `tool_result_read` returned `ok:false` / `scoped ref denied`.
  - `npm test -- src/main/agentRunnerService.test.ts -t "owning legacy runner read"` -> failed: legacy runner ended with failed status instead of reading the scoped ref.
  - `npm test -- src/main/container.test.ts -t "scoped tool-result ref reads"` -> failed: matching `runId` container read still returned `ok:false`.
- GREEN evidence:
  - `npm test -- src/main/agentRuntimeEngine.test.ts -t "owning runtime run read"` -> 1 test passed.
  - `npm test -- src/main/agentRunnerService.test.ts -t "owning legacy runner read"` -> 1 test passed.
  - `npm test -- src/main/container.test.ts -t "scoped tool-result ref reads"` -> 1 test passed.
  - `npm test -- src/main/agentRuntimeEngine.test.ts src/main/agentRunnerService.test.ts src/main/container.test.ts src/main/toolResultOffloadStore.test.ts src/main/agentToolExecutor.test.ts src/shared/toolResultRefs.test.ts` -> 6 files / 83 tests passed.
  - `npm run harness:check` -> passed.
  - `npm run verify` -> 165 files / 1066 tests passed; build passed; agent eval 26/26; memory eval 2/2.
  - `npm run smoke:prod` -> passed; renderer rendered agent chat UI with expected SQLite ABI fallback to JSON.

## 2026-06-21 - Task 4 Follow-Up 2 Renderer-Safe Tool-Result Ref Reads

- Summary:
  - Removed capability-bearing options from the renderer/preload/shared read-ref API shape; renderer calls now provide only run/session/request/workspace-run scope.
  - Sanitized the IPC `toolResults:readRef` handler to forward only known string scope fields, dropping forged renderer `capability` payloads.
  - Added main-process-issued `tool_result_ref_read` capabilities backed by a private store token so trusted internal grants still work without accepting plain renderer objects.
- Changed files:
  - `src/shared/toolResultRefs.ts`
  - `src/main/ipc/index.ts`
  - `src/main/container.ts`
  - `src/main/toolResultOffloadStore.ts`
  - `src/main/container.test.ts`
  - `src/main/toolResultOffloadStore.test.ts`
- RED evidence:
  - `npm test -- src/main/toolResultOffloadStore.test.ts src/main/container.test.ts` -> failed: forged `{ kind: "tool_result_ref_read", ref }` capability returned stored content instead of denial in both store and container coverage.
- GREEN evidence:
  - `npm test -- src/main/toolResultOffloadStore.test.ts src/main/container.test.ts` -> 2 files / 9 tests passed.
  - `npm test -- src/main/agentRuntimeEngine.test.ts src/main/agentRunnerService.test.ts src/main/container.test.ts src/main/toolResultOffloadStore.test.ts src/main/agentToolExecutor.test.ts src/shared/toolResultRefs.test.ts` -> 6 files / 83 tests passed.
  - `npm run harness:check` -> passed.
  - `npm run build` -> passed.
  - `npm run verify` -> 165 files / 1066 tests passed; build passed; agent eval 26/26; memory eval 2/2.
  - `npm run smoke:prod` -> passed; renderer rendered agent chat UI with expected SQLite ABI fallback to JSON.

## 2026-06-21 - Task 5 Follow-Up Worktree Auto-Approval Boundary

- Summary:
  - Added approval-result provenance for global auto-approval.
  - Rejected automatic approvals before untrusted git worktree creation reaches the workspace service or `git worktree add`.
  - Added a container regression with a disposable Git repo proving auto-approval no longer creates a worktree workspace or branch.
- Changed files:
  - `src/main/container.ts`
  - `src/main/container.test.ts`
  - `src/main/toolApprovalCoordinator.ts`
  - `src/main/toolApprovalCoordinator.test.ts`
  - `src/main/toolAuthorizationService.ts`
  - `.superpowers/sdd/task-5-followup-report.md`
- RED evidence:
  - `npm test -- src/main/container.test.ts -t "rejects globally automatic approval"` -> failed: promise resolved with a `git_worktree` workspace and branch `codex/auto-approved-worktree` instead of rejecting.
- GREEN evidence:
  - `npm test -- src/main/container.test.ts -t "rejects globally automatic approval"` -> 1 test passed.
  - `npm test -- src/main/container.test.ts src/main/toolApprovalCoordinator.test.ts src/main/toolAuthorizationService.test.ts src/main/agentWorkspaceService.test.ts` -> 4 files / 26 tests passed.
  - `npm run harness:check` -> passed.
  - `npm test` -> 165 files / 1072 tests passed.
  - `npm run build` -> passed.

## 2026-06-23 - Worker T1 Task 1 Navigation And Overview Relocation

- Summary:
  - Removed Overview from primary navigation so primary order is Chat, Runs, Tasks, Settings.
  - Added Settings system overview as the default Settings section and routed legacy `#overview` / `overview` targets into it.
  - Moved `OverviewPanel` rendering into the Settings shell and kept the legacy material `overview` icon compatibility path.
  - Updated app metadata primary modules to remove the old Overview module.
- Changed files:
  - `src/shared/navigation.ts`
  - `src/shared/navigation.test.ts`
  - `src/shared/appMeta.ts`
  - `src/renderer/App.tsx`
  - `src/renderer/materialDesign.test.ts`
  - `src/shared/materialNavigation.test.ts`
  - `.zerox/progress.md`
- RED evidence:
  - `npm test -- src/shared/navigation.test.ts src/shared/materialNavigation.test.ts` -> failed as expected: primary nav still included `overview`, Settings default was `model-settings`, and `#overview` still resolved to Overview.
  - `npm test -- src/renderer/materialDesign.test.ts` -> failed as expected: `OverviewPanel` was still rendered from the top-level `activeSection.id === "overview"` branch.
- GREEN / verification evidence:
  - `npm test -- src/shared/navigation.test.ts src/shared/materialNavigation.test.ts src/renderer/materialDesign.test.ts` -> 3 files / 44 tests passed.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.

## 2026-06-23 - Worker T1 Task 1 Follow-Up App Metadata Test Alignment

- Summary:
  - Updated `getAppMeta` coverage to expect only the Chat-first primary modules: 会话, 运行, 任务, 设置.
  - Removed stale test expectation for the former 总览 primary module and technical Settings subsections.
- Changed files:
  - `src/shared/appMeta.test.ts`
  - `.zerox/progress.md`
- RED evidence:
  - `npm test -- src/shared/appMeta.test.ts` -> failed as expected because the test still expected 总览/技能/工具/记忆/学习/评测 in `modules`.
- GREEN / verification evidence:
  - `npm test -- src/shared/appMeta.test.ts src/shared/navigation.test.ts src/shared/materialNavigation.test.ts src/renderer/materialDesign.test.ts` -> 4 files / 45 tests passed.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.

## 2026-06-23 - Worker T2 Task 2 Chat Stream Contract And IPC Bridge

- Summary:
  - Added shared guided skill input and chat-layer stream event contracts without reusing provider `StreamEvent`.
  - Added preload APIs for `onChatStreamEvent` and `respondSkillInput`.
  - Bridged `chat:streamEvent` through the chat send IPC sender and added `chat:respondSkillInput`.
  - Added a chat service stream option type and explicit not-wired guided input response.
  - Preserved persisted `streaming` and `waiting_for_input` chat activity states with input request normalization.
- Changed files:
  - `src/shared/chat.ts`
  - `src/shared/chatStream.test.ts`
  - `src/preload/index.ts`
  - `src/preload/index.test.ts`
  - `src/main/ipc/index.ts`
  - `src/main/chatService.ts`
  - `src/main/chatService.test.ts`
  - `src/main/chatSessionStore.ts`
  - `src/main/chatSessionStore.test.ts`
  - `.zerox/progress.md`
- RED evidence:
  - `npm test -- src/shared/chatStream.test.ts src/preload/index.test.ts src/main/chatService.test.ts src/main/chatSessionStore.test.ts` -> failed as expected: missing stream contract/preload bridge, missing `respondSkillInput`, and persisted new states normalized to `failed`.
- GREEN / verification evidence:
  - `npm test -- src/shared/chatStream.test.ts src/preload/index.test.ts src/main/chatService.test.ts src/main/chatSessionStore.test.ts` -> 4 files / 54 tests passed.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.
  - `npm run build` -> passed.

## 2026-06-23 - Worker T2 Task 2 Follow-Up Contract Alignment

- Summary:
  - Aligned guided skill input fields to the approved plan contract: `string`/`number`/`boolean`/`path`/`choice`, `executionId`, `reason`, and `choices`.
  - Replaced chat stream answer/thinking payloads with `text` and renamed tool preview events to `tool_call_preview`.
  - Removed conflicting guided input response `requestId` and nullable values.
  - Mirrored chat task status callbacks into `onStreamEvent` as chat-layer `status` events with the send request id.
  - Updated persisted input request normalization for the approved field shape.
- Changed files:
  - `src/shared/chat.ts`
  - `src/shared/chatStream.test.ts`
  - `src/main/chatService.ts`
  - `src/main/chatService.test.ts`
  - `src/main/chatSessionStore.ts`
  - `src/main/chatSessionStore.test.ts`
  - `.zerox/progress.md`
- RED evidence:
  - `npm test -- src/shared/chatStream.test.ts src/preload/index.test.ts src/main/chatService.test.ts src/main/chatSessionStore.test.ts` -> failed as expected: old `delta`/`tool_call_delta` contract remained, persisted choice fields normalized incorrectly, and `onStreamEvent` received no status events.
- GREEN / verification evidence:
  - `npm test -- src/shared/chatStream.test.ts src/preload/index.test.ts src/main/chatService.test.ts src/main/chatSessionStore.test.ts` -> 4 files / 55 tests passed.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.
  - `npm run build` -> passed.

## 2026-06-23 - Worker T2 Task 2 Follow-Up Terminal Stream Messages

- Summary:
  - Collapsed terminal chat stream events into one `completed | failed | canceled` union arm.
  - Made terminal stream event `message` optional for all three terminal states.
  - Added shared contract coverage for completed, failed, and canceled events without messages.
- Changed files:
  - `src/shared/chat.ts`
  - `src/shared/chatStream.test.ts`
  - `.zerox/progress.md`
- RED evidence:
  - `npm test -- src/shared/chatStream.test.ts src/preload/index.test.ts src/main/chatService.test.ts src/main/chatSessionStore.test.ts` -> failed as expected because the shared contract still had separate terminal arms.
- GREEN / verification evidence:
  - `npm test -- src/shared/chatStream.test.ts src/preload/index.test.ts src/main/chatService.test.ts src/main/chatSessionStore.test.ts` -> 4 files / 56 tests passed.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.

## 2026-06-23 - Worker T2 Task 2 Follow-Up Observer Isolation

- Summary:
  - Made chat status, stream, and persistence observers best-effort so thrown observer callbacks do not break chat sends.
  - Captured async status activity and workspace run persistence rejections with quiet `.catch(() => undefined)` handling.
  - Removed source-string assertions from shared chat stream contract tests.
  - Strengthened preload stream bridge coverage to assert listener cleanup for `chat:streamEvent`.
- Changed files:
  - `src/main/chatService.ts`
  - `src/main/chatService.test.ts`
  - `src/shared/chatStream.test.ts`
  - `src/preload/index.test.ts`
  - `.zerox/progress.md`
- RED evidence:
  - `npm test -- src/shared/chatStream.test.ts src/preload/index.test.ts src/main/chatService.test.ts src/main/chatSessionStore.test.ts` -> failed as expected because `onStatusEvent` throw rejected `sendMessage`.
- GREEN / verification evidence:
  - `npm test -- src/shared/chatStream.test.ts src/preload/index.test.ts src/main/chatService.test.ts src/main/chatSessionStore.test.ts` -> 4 files / 57 tests passed.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.

## 2026-06-23 - Worker T3 Task 3 Provider And Agent Loop Streaming Aggregation

- Summary:
  - Preserved provider thinking/reasoning deltas through low-level streaming adapters and stream aggregation.
  - Added agent-loop streaming aggregation for answer, reasoning, and tool-call preview deltas before existing full tool-call authorization/execution.
  - Mapped model stream deltas to chat `answer_delta`, `thinking_delta`, and `tool_call_preview` events without writing duplicate assistant messages.
- Changed files:
  - `src/main/providers/providerChatClient.ts`
  - `src/main/providers/streamProcessor.ts`
  - `src/main/providers/p8.test.ts`
  - `src/main/providers/providers.test.ts`
  - `src/main/providers/openAiCompatibleProvider.ts`
  - `src/main/openAiCompatibleClient.ts`
  - `src/main/openAiCompatibleClient.test.ts`
  - `src/main/agentLoop.ts`
  - `src/main/agentLoop.test.ts`
  - `src/main/chatService.ts`
  - `src/main/chatService.test.ts`
  - `.zerox/progress.md`
- RED evidence:
  - `npm test -- src/main/providers/p8.test.ts src/main/providers/providers.test.ts src/main/openAiCompatibleClient.test.ts src/main/agentLoop.test.ts src/main/chatService.test.ts` -> failed as expected: thinking deltas were dropped, streamed reasoning was not parsed, and agent loop used non-streaming `complete`.
  - `npm test -- src/main/providers/providers.test.ts src/main/openAiCompatibleClient.test.ts` -> failed as expected for low-level/provider-wrapper reasoning delta mapping.
- GREEN / verification evidence:
  - `npm test -- src/main/providers/p8.test.ts src/main/providers/providers.test.ts src/main/openAiCompatibleClient.test.ts src/main/agentLoop.test.ts src/main/chatService.test.ts` -> 5 files / 94 tests passed.
  - `npx tsc -p tsconfig.electron.json --noEmit --pretty false` -> passed.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.

## 2026-06-24 - Worker T5 Task 5 Fix Stale Stream After New Chat Reset

- Summary:
  - Fixed the rejected Task 5 blocker where the new-chat reset cleared visible transcript state but left active stream/status refs pointing at the previous request.
  - Added a focused regression asserting the new-chat reset clears active stream refs before stale events can repopulate the transcript.
  - Reused the same ref reset helper for persisted-session load and preview session reset paths.
- Changed files:
  - `src/renderer/components/AgentChatPanel.tsx`
  - `src/renderer/materialDesign.test.ts`
  - `.zerox/progress.md`
- RED evidence:
  - `npm test -- src/renderer/materialDesign.test.ts -t "clears active stream refs"` -> failed as expected: the reset effect did not call `resetActiveChatRefs()` and did not clear `activeStatusSessionIdRef` / `activeChatRequestIdRef`.
- GREEN / verification evidence:
  - `npm test -- src/renderer/materialDesign.test.ts -t "clears active stream refs"` -> 1 file / 1 selected test passed.
  - `npm test -- src/renderer/materialDesign.test.ts src/renderer/chatStreamReducer.test.ts src/renderer/chatTaskActivity.test.ts src/renderer/chatTaskActivityRestore.test.ts` -> 4 files / 56 tests passed.
  - `npx tsc -p tsconfig.renderer.json --noEmit --pretty false` -> passed.
  - `npm run harness:check` -> passed.

## 2026-06-24 - Worker T5 Task 5 Fix Guided Input Status IPC Forwarding

- Summary:
  - Fixed guided-input continuation IPC so `chat:respondSkillInput` forwards resumed backend status events to the invoking renderer as `chat:statusEvent`.
  - Added behavior-level IPC coverage that invokes the registered handler with a mocked chat service emitting both status and stream callbacks.
- Changed files:
  - `src/main/ipc/index.ts`
  - `src/main/ipc/index.test.ts`
  - `.zerox/progress.md`
- RED evidence:
  - `npm test -- src/main/ipc/index.test.ts -t "forwards guided skill continuation status"` -> failed as expected: only `chat:streamEvent` was sent.
- GREEN / verification evidence:
  - `npm test -- src/main/ipc/index.test.ts -t "forwards guided skill continuation status"` -> 1 file / 1 selected test passed.
  - `npm test -- src/main/ipc/index.test.ts src/main/ipc/chatSendMessageError.test.ts src/renderer/materialDesign.test.ts src/renderer/chatStreamReducer.test.ts src/renderer/chatTaskActivity.test.ts src/renderer/chatTaskActivityRestore.test.ts src/preload/index.test.ts` -> 7 files / 64 tests passed.
  - `npx tsc -p tsconfig.electron.json --noEmit --pretty false` -> passed.
  - `npx tsc -p tsconfig.renderer.json --noEmit --pretty false` -> passed.
  - `npm run harness:check` -> passed.

## 2026-06-24 - Worker T5 Task 5 Fix Stale Guided Input Stream Ref

- Summary:
  - Fixed the remaining Task 5 re-review blocker where `pendingInputRequestRef` could keep a previous guided-input request active between new-chat state reset and the pending-input effect sync.
  - Tightened the reset regression to require clearing all stream-active refs, including the pending guided-input ref used by `onChatStreamEvent` request fallback.
- Changed files:
  - `src/renderer/components/AgentChatPanel.tsx`
  - `src/renderer/materialDesign.test.ts`
  - `.zerox/progress.md`
- RED evidence:
  - `npm test -- src/renderer/materialDesign.test.ts -t "clears all active stream refs"` -> failed as expected: `pendingInputRequestRef.current = null` was missing.
- GREEN / verification evidence:
  - `npm test -- src/renderer/materialDesign.test.ts -t "clears all active stream refs"` -> 1 file / 1 selected test passed.
  - `npm test -- src/renderer/materialDesign.test.ts src/renderer/chatStreamReducer.test.ts src/renderer/chatTaskActivity.test.ts src/renderer/chatTaskActivityRestore.test.ts` -> 4 files / 56 tests passed.
  - `npx tsc -p tsconfig.renderer.json --noEmit --pretty false` -> passed.
  - `npm run harness:check` -> passed.

## 2026-06-23 - Worker T3 Task 3 Streaming Fallback Repair

- Summary:
  - Added a pre-delta streaming failure fallback from `streamComplete` to the existing `completeWithModelRetry` path.
  - Preserved partial-stream safety by propagating failures after answer/thinking/tool preview deltas instead of retrying and duplicating visible content.
- Changed files:
  - `src/main/agentLoop.ts`
  - `src/main/agentLoop.test.ts`
  - `.zerox/progress.md`
- RED evidence:
  - `npm test -- src/main/agentLoop.test.ts` -> failed as expected because a client exposing `streamComplete` failed the loop when streaming threw before yielding any event.
- GREEN / verification evidence:
  - `npm test -- src/main/agentLoop.test.ts` -> 1 file / 20 tests passed.
  - `npm test -- src/main/providers/p8.test.ts src/main/providers/providers.test.ts src/main/openAiCompatibleClient.test.ts src/main/agentLoop.test.ts src/main/chatService.test.ts` -> 5 files / 96 tests passed.
  - `npx tsc -p tsconfig.electron.json --noEmit --pretty false` -> passed.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.

## 2026-06-23 - Worker T3 Task 3 Indexed Streaming Tool Call Repair

- Summary:
  - Preserved OpenAI-compatible streamed `tool_calls[].index` on low-level stream events and through provider adapters when available.
  - Updated agent-loop stream aggregation to correlate tool-call deltas by index before id, preserving legacy active-call fallback only for single-call streams.
  - Added abort-style pre-delta stream failure coverage to ensure fallback completion is not used after cancellation.
- Changed files:
  - `src/main/openAiCompatibleClient.ts`
  - `src/main/openAiCompatibleClient.test.ts`
  - `src/main/providers/provider.ts`
  - `src/main/providers/providerChatClient.ts`
  - `src/main/providers/openAiCompatibleProvider.ts`
  - `src/main/providers/streamProcessor.ts`
  - `src/main/providers/providers.test.ts`
  - `src/main/agentLoop.ts`
  - `src/main/agentLoop.test.ts`
  - `.zerox/progress.md`
- RED evidence:
  - `npm test -- src/main/openAiCompatibleClient.test.ts src/main/providers/providers.test.ts src/main/agentLoop.test.ts` -> failed as expected: stream indexes were dropped and concurrent idless indexed tool-call deltas assembled into zero executable tool calls.
- GREEN / verification evidence:
  - `npm test -- src/main/openAiCompatibleClient.test.ts src/main/providers/providers.test.ts src/main/agentLoop.test.ts` -> 3 files / 56 tests passed.
  - `npm test -- src/main/providers/p8.test.ts src/main/providers/providers.test.ts src/main/openAiCompatibleClient.test.ts src/main/agentLoop.test.ts src/main/chatService.test.ts` -> 5 files / 100 tests passed.
  - `npx tsc -p tsconfig.electron.json --noEmit --pretty false` -> passed.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.

## 2026-06-23 - Worker T3 Task 3 Streamed Tool Preview Safety Repair

- Summary:
  - Avoided unsafe native-provider tool streaming with tools present by deriving low-level stream events from `complete()` before any deltas are emitted.
  - Preserved renderer-facing tool preview index and used deterministic `index:<n>` fallback ids for idless indexed chunks.
- Changed files:
  - `src/main/providers/providerChatClient.ts`
  - `src/main/providers/providers.test.ts`
  - `src/shared/chat.ts`
  - `src/shared/chatStream.test.ts`
  - `src/main/chatService.ts`
  - `src/main/chatService.test.ts`
  - `.zerox/progress.md`
- RED evidence:
  - `npm test -- src/shared/chatStream.test.ts src/main/providers/providers.test.ts src/main/chatService.test.ts` -> failed as expected: native provider stream emitted unsafe empty tool name/stream args and chat preview emitted empty `toolCallId` without index.
- GREEN / verification evidence:
  - `npm test -- src/shared/chatStream.test.ts src/main/providers/providers.test.ts src/main/chatService.test.ts` -> 3 files / 61 tests passed.
  - `npm test -- src/shared/chatStream.test.ts src/main/providers/p8.test.ts src/main/providers/providers.test.ts src/main/openAiCompatibleClient.test.ts src/main/agentLoop.test.ts src/main/chatService.test.ts` -> 6 files / 106 tests passed.
  - `npx tsc -p tsconfig.electron.json --noEmit --pretty false` -> passed.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.

## 2026-06-23 - Worker T4 Task 4 Guided Skill Input Preflight

- Summary:
  - Added skill execution preflight stages, input resolution snapshots, and guided input validation for missing/invalid/complete values.
  - Aligned skill manifest inputs with guided chat fields, including `choice`, `description`, `defaultValue`, and `choices`.
  - Wired chat skill preflight to pause before model/memory/tool execution, persist `waiting_for_input`, resume from structured responses, validate paths against the stored workspace context, and expand skill permission placeholders only after validated input.
- Changed files:
  - `src/shared/skillExecutionContract.ts`
  - `src/shared/skillExecutionContract.test.ts`
  - `src/shared/skills.ts`
  - `src/shared/skills.test.ts`
  - `src/main/skillExecutionService.ts`
  - `src/main/skillExecutionService.test.ts`
  - `src/main/chatService.ts`
  - `src/main/chatService.test.ts`
  - `.zerox/progress.md`
- RED evidence:
  - `npm test -- src/shared/skillExecutionContract.test.ts src/shared/skills.test.ts src/main/skillExecutionService.test.ts src/main/chatService.test.ts` -> failed as expected: missing new stages/transitions, manifest guided metadata, `resolveSkillInput`, and chat preflight/resume wiring.
- GREEN / verification evidence:
  - `npm test -- src/shared/skillExecutionContract.test.ts src/shared/skills.test.ts src/main/skillExecutionService.test.ts src/main/chatService.test.ts` -> 4 files / 52 tests passed.
  - `npm run build` -> passed.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.

## 2026-06-23 - Worker T4 Task 4 Guided Skill Input Durability Repair

- Summary:
  - Made guided `waiting_for_input` pending-state persistence a required awaited write before returning `Skill input required`.
  - Kept ordinary status observability best-effort while preventing waiting-input stream/status claims when the durable pending write fails.
  - Applied the same durability requirement when invalid `respondSkillInput` creates the next pending request.
  - Kept completion-marker writes awaited before returning successful resumed responses, with structured failure on completion persistence errors.
- Changed files:
  - `src/main/chatService.ts`
  - `src/main/chatService.test.ts`
  - `.zerox/progress.md`
- RED evidence:
  - `npm test -- src/shared/skillExecutionContract.test.ts src/shared/skills.test.ts src/main/skillExecutionService.test.ts src/main/chatService.test.ts` -> failed as expected: `sendMessage` and invalid `respondSkillInput` returned before delayed pending writes completed, and waiting persistence rejection still returned `Skill input required`.
- GREEN / verification evidence:
  - `npm test -- src/shared/skillExecutionContract.test.ts src/shared/skills.test.ts src/main/skillExecutionService.test.ts src/main/chatService.test.ts` -> 4 files / 58 tests passed.
  - `npm run build` -> passed.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.
  - `src/shared/toolPermissions.test.ts` was not run because Task 4 placeholder/root evidence is covered in `src/main/chatService.test.ts` and `src/shared/toolPermissions.test.ts` was not touched.

## 2026-06-23 - Worker T4 Task 4 Guided Skill Input Preflight Repair

- Summary:
  - Persisted pending guided skill input state on chat activity events, including original session/request/message, selected skill name, workspace context, and partial values.
  - Added recovery on fresh `createChatService` instances by scanning persisted session activity, rediscovering the skill by name, and resolving the workspace again.
  - Marked consumed pending input requests completed so duplicate responses are rejected safely.
  - Moved selected/natural skill resolution and missing-input preflight before goal intent routing for non-continuation turns.
- Changed files:
  - `src/shared/chat.ts`
  - `src/main/chatSessionStore.ts`
  - `src/main/chatService.ts`
  - `src/main/chatService.test.ts`
  - `.zerox/progress.md`
- RED evidence:
  - `npm test -- src/shared/skillExecutionContract.test.ts src/shared/skills.test.ts src/main/skillExecutionService.test.ts src/main/chatService.test.ts` -> failed as expected: fresh-service `respondSkillInput` could not recover pending input, and selected `/goal`-style skill messages routed to goal handling before skill preflight.
- GREEN / verification evidence:
  - `npm test -- src/shared/skillExecutionContract.test.ts src/shared/skills.test.ts src/main/skillExecutionService.test.ts src/main/chatService.test.ts` -> 4 files / 55 tests passed.
  - `npm run build` -> passed.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.

## 2026-06-23 - Worker T4 Task 4 Guided Skill Input Claim-Before-Resume Repair

- Summary:
  - Moved the durable pending-input completed/claimed marker before resumed model/agent execution for complete guided input responses.
  - If the claim marker fails, `respondSkillInput` now returns a structured failure before model/agent execution or assistant message append.
  - Removed the post-execution required completion write so duplicate-prevention does not depend on a write after side effects.
- Changed files:
  - `src/main/chatService.ts`
  - `src/main/chatService.test.ts`
  - `.zerox/progress.md`
- RED evidence:
  - `npm test -- src/shared/skillExecutionContract.test.ts src/shared/skills.test.ts src/main/skillExecutionService.test.ts src/main/chatService.test.ts` -> failed as expected: completion marker failure happened after resumed agent execution, so the agent loop was called before the failure response.
- GREEN / verification evidence:
  - `npm test -- src/shared/skillExecutionContract.test.ts src/shared/skills.test.ts src/main/skillExecutionService.test.ts src/main/chatService.test.ts` -> 4 files / 59 tests passed.
  - `npm test -- src/shared/skillExecutionContract.test.ts src/shared/skills.test.ts src/main/skillExecutionService.test.ts src/main/chatService.test.ts src/shared/toolPermissions.test.ts src/main/toolAuthorizationService.test.ts` -> 6 files / 108 tests passed.
  - `npm run build` -> passed.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.

## 2026-06-23 - Worker T4 Task 4 Guided Skill Path Canonicalization Repair

- Summary:
  - Canonicalized validated guided skill `path` input values by storing the absolute path returned by the run-context sandbox validator.
  - Verified relative `targetDir` input resolves against the workspace root before skill prompt injection and permission placeholder expansion.
  - Kept outside-workspace path rejection covered by existing service/chat tests.
- Changed files:
  - `src/main/skillExecutionService.ts`
  - `src/main/skillExecutionService.test.ts`
  - `src/main/chatService.test.ts`
  - `.zerox/progress.md`
- RED evidence:
  - `npm test -- src/main/skillExecutionService.test.ts src/main/chatService.test.ts` -> failed as expected: resolved values and chat prompt still contained raw `docs` instead of `/workspace/project/docs`.
- GREEN / verification evidence:
  - `npm test -- src/main/skillExecutionService.test.ts src/main/chatService.test.ts` -> 2 files / 49 tests passed.
  - `npm test -- src/shared/skillExecutionContract.test.ts src/shared/skills.test.ts src/main/skillExecutionService.test.ts src/main/chatService.test.ts src/shared/toolPermissions.test.ts src/main/toolAuthorizationService.test.ts` -> 6 files / 109 tests passed.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.

## 2026-06-23 - Worker T4 Task 4 Guided Skill Input Response Serialization Repair

- Summary:
  - Added per-`inputRequestId` in-flight serialization so concurrent guided input responses cannot recover and execute the same pending request twice.
  - Required durable activity persistence for completion claims, including recovered pending requests.
  - Reordered invalid/still-missing responses to persist the next pending wait before consuming the old request, preserving retryability when that write fails.
  - Aligned `SkillInputResponseResult` with the full chat send-message result shape returned by successful resumed execution.
- Changed files:
  - `src/main/chatService.ts`
  - `src/main/chatService.test.ts`
  - `src/shared/chat.ts`
  - `src/shared/chatStream.test.ts`
  - `.zerox/progress.md`
- RED evidence:
  - `npm test -- src/main/chatService.test.ts src/main/skillExecutionService.test.ts src/shared/skillExecutionContract.test.ts src/shared/skills.test.ts src/shared/chatStream.test.ts` -> failed as expected: invalid retry lost the original request, concurrent completion executed twice, and recovered completion executed without durable activity persistence.
- GREEN / verification evidence:
  - `npm test -- src/main/chatService.test.ts src/main/skillExecutionService.test.ts src/shared/skillExecutionContract.test.ts src/shared/skills.test.ts src/shared/chatStream.test.ts` -> 5 files / 68 tests passed.
  - `npm run build` -> passed.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.

## 2026-06-24 - Task 4 Guided Skill Invalid Retry Idempotency Repair

- Summary:
  - Closed the invalid-response retry window where a new pending request could be created before the old request was durably completed.
  - Invalid/still-missing guided input responses now reuse the original `inputRequestId` and update the pending state in place.
  - A failed completion marker during invalid retry no longer creates two answerable guided input requests.
- Changed files:
  - `src/main/chatService.ts`
  - `src/main/chatService.test.ts`
  - `.zerox/progress.md`
- RED evidence:
  - `npm test -- src/main/chatService.test.ts -t "does not create a second answerable guided input request"` -> failed as expected: invalid retry attempted a completed marker and returned `Failed to persist skill input completion.`
- GREEN / verification evidence:
  - `npm test -- src/main/chatService.test.ts -t "does not create a second answerable guided input request"` -> 1 file / 1 selected test passed.
  - `npm test -- src/main/chatService.test.ts src/main/skillExecutionService.test.ts src/shared/skillExecutionContract.test.ts src/shared/skills.test.ts src/shared/chatStream.test.ts src/shared/toolPermissions.test.ts src/main/toolAuthorizationService.test.ts` -> 7 files / 118 tests passed.
  - `npx tsc -p tsconfig.electron.json --noEmit --pretty false` -> passed.
  - `npx tsc -p tsconfig.renderer.json --noEmit --pretty false` -> passed.
  - `npm run harness:check` -> passed.

## 2026-06-24 - Worker T5 Task 5 Renderer Streaming Transcript And Guided Input UI

- Summary:
  - Added renderer chat stream reduction for active-session/request-filtered answer deltas, thinking deltas, tool call previews, terminal finalization, and pending guided input requests.
  - Wired `AgentChatPanel` to subscribe/unsubscribe to `onChatStreamEvent`, render separated collapsed thinking/tool preview surfaces, finalize streamed replies without duplicate assistant messages, and special-case guided input waits as paused state.
  - Rendered `guided-skill-input-form` in the main chat surface with string/path/number/boolean/choice controls and `respondSkillInput` submission.
  - Mapped `streaming`/`waiting_for_input` activity and restore state, including latest pending input after reload.
  - Forwarded `respondSkillInput` stream events through `chat:streamEvent` to the invoking renderer.
- Changed files:
  - `src/main/ipc/index.ts`
  - `src/main/ipc/index.test.ts`
  - `src/renderer/components/AgentChatPanel.tsx`
  - `src/renderer/chatStreamReducer.ts`
  - `src/renderer/chatStreamReducer.test.ts`
  - `src/renderer/chatTaskActivity.ts`
  - `src/renderer/chatTaskActivity.test.ts`
  - `src/renderer/chatTaskActivityRestore.test.ts`
  - `src/renderer/materialDesign.test.ts`
  - `src/renderer/styles/chat.css`
  - `src/renderer/styles/responsive.css`
  - `.zerox/progress.md`
- RED evidence:
  - `npm test -- src/renderer/chatTaskActivity.test.ts src/renderer/chatTaskActivityRestore.test.ts src/renderer/materialDesign.test.ts src/renderer/chatStreamReducer.test.ts src/main/ipc/index.test.ts` -> failed as expected: activity mapped guided input/streaming to fallback states, reducer was inert/missing behavior, panel lacked stream/guided/collapse surfaces, and IPC did not forward response stream events.
- GREEN / verification evidence:
  - `npm test -- src/renderer/chatTaskActivity.test.ts src/renderer/chatTaskActivityRestore.test.ts src/renderer/materialDesign.test.ts src/renderer/chatStreamReducer.test.ts src/main/ipc/index.test.ts` -> 5 files / 56 tests passed.
  - `npm test -- src/renderer/chatTaskActivity.test.ts src/renderer/chatTaskActivityRestore.test.ts src/renderer/materialDesign.test.ts src/renderer/chatStreamReducer.test.ts src/preload/index.test.ts src/main/ipc/*.test.ts` -> 7 files / 62 tests passed.
  - `npx tsc -p tsconfig.renderer.json --noEmit --pretty false` -> passed.
  - `npx tsc -p tsconfig.electron.json --noEmit --pretty false` -> passed.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.
  - `git diff --check` -> passed.

## 2026-06-24 - Task 4 Guided Skill Required Persistence Null-Write Repair

- Summary:
  - Required guided-skill activity writes now treat a `null` session update as persistence failure.
  - Completion/claim writes fail before model/agent execution if the session was deleted or the store cannot update it.
  - Added regression coverage for missing-session claim writes so no pending input is claimed or executed without durable evidence.
- Changed files:
  - `src/main/chatService.ts`
  - `src/main/chatService.test.ts`
  - `.zerox/progress.md`
- RED evidence:
  - `npm test -- src/main/chatService.test.ts -t "does not treat missing-session activity writes"` -> failed as expected: claim append returned `null` but execution still proceeded.
- GREEN / verification evidence:
  - `npm test -- src/main/chatService.test.ts -t "does not treat missing-session activity writes"` -> 1 file / 1 selected test passed.
  - `npm test -- src/main/chatService.test.ts src/main/skillExecutionService.test.ts src/shared/skillExecutionContract.test.ts src/shared/skills.test.ts src/shared/chatStream.test.ts src/shared/toolPermissions.test.ts src/main/toolAuthorizationService.test.ts src/main/chatSessionStore.test.ts src/preload/index.test.ts` -> 9 files / 140 tests passed.
  - `npx tsc -p tsconfig.electron.json --noEmit --pretty false` -> passed.
  - `npx tsc -p tsconfig.renderer.json --noEmit --pretty false` -> passed.
  - `npm run harness:check` -> passed.

## 2026-06-24 - Task 7 v2.7.0 Release Metadata Prep

- Summary:
  - Updated release-metadata regression tests to require `v2.7.0` package/version strings plus README Chat-first release notes coverage.
  - Bumped root package metadata to `2.7.0` and refreshed README current-version, packaging, roadmap, and bilingual `v2.7.0` release note references.
  - Kept this prep scoped to metadata/tests only; `P16-v2.7.0-ui-interaction` is not marked `done` here and no final independent acceptance evidence was recorded.
- Changed files:
  - `README.md`
  - `src/shared/readme.test.ts`
  - `src/shared/packageScripts.test.ts`
  - `package.json`
  - `package-lock.json`
  - `.zerox/progress.md`
- RED evidence:
  - `npm test -- src/shared/packageScripts.test.ts src/shared/readme.test.ts` -> failed as expected: package metadata still reported `2.6.0`, README still referenced `v2.6.0`, and README lacked the new `v2.7.0` / `Chat-first` / `streamed answers` / `guided skill input` assertions.
- GREEN / verification evidence:
  - `npm test -- src/shared/packageScripts.test.ts src/shared/readme.test.ts` -> 2 files / 11 tests passed.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.
  - `npm run build` -> passed.

## 2026-06-24 - Task 7 v2.7.0 README Acceptance-State Follow-Up

- Summary:
  - Corrected the README roadmap so `v2.7.0` is described as metadata prep in acceptance rather than already shipped.
  - Added regression coverage that requires acceptance-pending wording and rejects `[x]` shipped wording for the `v2.7.0` Chat-first release metadata line.
  - Kept `v2.7.0` current-version/package metadata references intact and did not mark `P16-v2.7.0-ui-interaction` done.
- Changed files:
  - `README.md`
  - `src/shared/readme.test.ts`
  - `.zerox/progress.md`
- RED evidence:
  - `npm test -- src/shared/packageScripts.test.ts src/shared/readme.test.ts` -> failed as expected: README did not contain `pending final independent acceptance` / `待最终独立验收` and still listed `v2.7.0` as shipped.
- GREEN / verification evidence:
  - `npm test -- src/shared/packageScripts.test.ts src/shared/readme.test.ts` -> 2 files / 11 tests passed.
  - `git diff --check` -> passed.

## 2026-06-24 - v2.7.0 UI/Interaction Iteration Final Acceptance

- Request:
  - Fully optimize/rework interaction and UI with Chat-first consumer experience, streamed output, separated thinking/process, guided skill input, icon cleanup, testing, and independent acceptance.
- Planning/design evidence:
  - Spec: `docs/superpowers/specs/2026-06-23-zerox-agent-2-7-0-ui-interaction-design.md`
  - Plan: `docs/superpowers/plans/2026-06-23-zerox-agent-2-7-0-ui-interaction.md`
  - Design artifact: `docs/design/zerox-agent-2-7-0-ui-artifact.html`
- Final status updates:
  - `.zerox/feature_list.json` marks `P16-v2.7.0-ui-interaction` as `done`.
  - README roadmap marks `v2.7.0 Chat-first interaction release` as shipped after independent acceptance.
- Changed files in final status commit:
  - `.zerox/feature_list.json`
  - `.zerox/progress.md`
  - `README.md`
  - `src/shared/readme.test.ts`
  - `src/shared/packageScripts.test.ts`
- Focused test evidence:
  - Task 1: `npm test -- src/shared/navigation.test.ts src/shared/materialNavigation.test.ts src/renderer/materialDesign.test.ts` -> passed during reviewed Task 1 closure.
  - Task 2: `npm test -- src/shared/chatStream.test.ts src/preload/index.test.ts src/main/ipc/index.test.ts` -> passed during reviewed Task 2 closure.
  - Task 3: `npm test -- src/main/providers/p8.test.ts src/main/agentLoop.test.ts src/main/chatService.test.ts src/shared/chatStream.test.ts` -> passed during reviewed Task 3 closure.
  - Task 4: `npm test -- src/main/chatService.test.ts src/main/skillExecutionService.test.ts src/shared/skillExecutionContract.test.ts src/shared/skills.test.ts src/shared/chatStream.test.ts src/shared/toolPermissions.test.ts src/main/toolAuthorizationService.test.ts src/main/chatSessionStore.test.ts src/preload/index.test.ts` -> 9 files / 140 tests passed.
  - Task 5: `npm test -- src/main/ipc/index.test.ts src/main/ipc/chatSendMessageError.test.ts src/renderer/materialDesign.test.ts src/renderer/chatStreamReducer.test.ts src/renderer/chatTaskActivity.test.ts src/renderer/chatTaskActivityRestore.test.ts src/preload/index.test.ts` -> 7 files / 64 tests passed.
  - Task 6: `npm test -- src/renderer/materialDesign.test.ts` -> 44/44 tests passed.
  - Task 7 final RED: `npm test -- src/shared/packageScripts.test.ts src/shared/readme.test.ts` -> failed as expected while README still said pending acceptance and P16 was not done.
  - Task 7 final GREEN: `npm test -- src/shared/packageScripts.test.ts src/shared/readme.test.ts` -> 2 files / 11 tests passed.
- Full command gates:
  - `npm test` -> 168 files / 1141 tests passed.
  - `npm run build` -> passed.
  - `npm run verify` -> 168 files / 1141 tests passed, 26/26 agent evals passed, 2/2 memory evals passed.
  - `npm run smoke:prod` -> passed; renderer rendered agent chat UI. Note: local `node_modules` emitted a better-sqlite3 ABI warning and fell back to JSON in this non-packaged smoke.
  - `npm run harness:score` -> passed; overall score 9.26, agent eval 26/26, goal eval 7/7, goal-judge eval 2/2.
  - `npm run harness:check` -> passed.
  - `git diff --check` -> passed.
- Packaged gates:
  - `npm run dist:mac` -> passed; generated `release/Zerox Agent-2.7.0-arm64.dmg` and `release/Zerox Agent-2.7.0-arm64-mac.zip`.
  - `npm run smoke:prod:built` -> passed; renderer rendered agent chat UI.
  - `BUILDING_AGENT_SMOKE=1 BUILDING_AGENT_SMOKE_REQUIRED_TEXTS='v2.7.0' "release/mac-arm64/Zerox Agent.app/Contents/MacOS/Zerox Agent"` -> passed.
- Independent acceptance:
  - Officer: Socrates (`019ef8da-f2ed-71b2-890d-8fba57d33d47`)
  - App path: `/Volumes/Out/codex_projects/building agent/release/mac-arm64/Zerox Agent.app/Contents/MacOS/Zerox Agent`
  - Config dir: `/Users/zerox/Library/Application Support/Zerox Agent/config`
  - Verdict: ACCEPTED
  - Command evidence:
    - Packaged app smoke with `v2.7.0` required text -> passed.
    - Packaged app narrow viewport smoke `390x844` -> passed.
    - Packaged app navigation text smoke `会话|运行|任务|设置` -> passed.
    - `npm run harness:check` -> passed.
    - `npm test -- src/main/smokeMode.test.ts src/preload/index.test.ts src/renderer/chatStreamReducer.test.ts src/renderer/materialDesign.test.ts` -> 4 files / 63 tests passed.
    - `npm test -- src/shared/navigation.test.ts` -> 1 file / 5 tests passed.
    - Focused authorization/runtime tests for no-bypass scenarios -> 2 files / 6 selected tests passed.
  - Scenario evidence:
    - Fresh launch uses Chat as the primary surface.
    - Primary navigation is Chat/Runs/Tasks/Settings; Overview diagnostics are under Settings.
    - Composer/workspace/icon affordances render and narrow viewport smoke has no overflow.
    - Streamed answer finalizes without duplicate assistant reply.
    - Thinking/process and tool preview output are distinct from final answer.
    - Guided skill input form covers required field types and is reachable when the right rail is hidden.
    - Tool approval remains explicit and authorization/runtime tests preserve permission and workspace boundaries.
    - Runs audit surfaces remain covered.
  - Screenshot: `/tmp/zerox-uat-shots/zerox-agent-2-7-0-ui-artifact.html.png`
  - Defects: none blocking. Residual risk noted by officer: packaged smoke required manual cleanup of a lingering app process in the PTY environment, with no observed UI/navigation/streaming/approval/sandbox regression.

## 2026-06-25 - Workspace Picker Open/Create Regression Fix

- Request:
  - Fix the chat composer workspace selector, which only showed default workspaces and did not provide an obvious way to open an existing folder or create a new workspace.
- Root cause:
  - The workspace domain model already supported `project` and `temporary` workspaces, but the desktop bridge exposed only list/create-temporary/git-worktree paths.
  - The chat composer rendered a selector for existing records only; it had no native directory-picker path to register a local project workspace.
- Changed files:
  - `src/main/agentWorkspaceService.ts`
  - `src/main/agentWorkspaceService.test.ts`
  - `src/main/ipc/index.ts`
  - `src/main/ipc/index.test.ts`
  - `src/preload/index.ts`
  - `src/preload/index.test.ts`
  - `src/renderer/components/AgentChatPanel.tsx`
  - `src/renderer/components/Icon.tsx`
  - `src/renderer/styles/composer.css`
  - `src/renderer/materialDesign.test.ts`
  - `.zerox/progress.md`
- RED evidence:
  - `npm test -- src/main/agentWorkspaceService.test.ts src/preload/index.test.ts src/renderer/materialDesign.test.ts` -> failed as expected: missing `createProjectWorkspace`, `openProjectAgentWorkspace`, and composer open/create affordances.
- GREEN / verification evidence:
  - `npm test -- src/main/agentWorkspaceService.test.ts src/preload/index.test.ts src/main/ipc/index.test.ts src/renderer/materialDesign.test.ts` -> 4 files / 58 tests passed.
  - `npm run build` -> passed.
  - `npm run harness:check` -> passed.
  - `npm run verify` -> 168 files / 1145 tests passed, 26/26 agent evals passed, 2/2 memory evals passed.
  - `BUILDING_AGENT_SMOKE_REQUIRED_TEXTS='打开|新建' npm run smoke:prod` -> passed; renderer rendered agent chat UI with workspace open/create affordances. Note: local `node_modules` emitted the existing better-sqlite3 ABI warning and fell back to JSON storage during smoke.
  - `npm run dist:mac` -> passed; regenerated `release/Zerox Agent-2.7.0-arm64.dmg` and `release/Zerox Agent-2.7.0-arm64-mac.zip`.
  - `BUILDING_AGENT_SMOKE=1 BUILDING_AGENT_SMOKE_REQUIRED_TEXTS='打开|新建' "release/mac-arm64/Zerox Agent.app/Contents/MacOS/Zerox Agent"` -> passed; packaged app rendered the workspace open/create affordances.

## 2026-06-25 - Workspace Picker Lightweight Menu Follow-Up

- Request:
  - Remove the heavy right-side workspace action buttons.
  - Make the current workspace pill open a drawer-style dropdown menu with historical project folders, default workspace, open existing directory, and new workspace actions.
  - Rebuild packages, commit, and push after the fix.
- Changed files:
  - `src/renderer/components/AgentChatPanel.tsx`
  - `src/renderer/styles/composer.css`
  - `src/renderer/materialDesign.test.ts`
  - `.zerox/progress.md`
- RED evidence:
  - `npm test -- src/renderer/materialDesign.test.ts` -> failed as expected while `workspace-menu` did not exist and the old `workspace-action-buttons` structure was still present.
- GREEN / verification evidence:
  - `npm test -- src/renderer/materialDesign.test.ts` -> 44 tests passed.
  - In-app Browser QA on `http://127.0.0.1:5173/#chat` -> passed: one `选择工作区` button, one `工作区菜单`, no standalone workspace action buttons, menu includes `历史工作区`, `默认工作区`, `打开已有目录`, and `新建工作区`; console warn/error count 0.
  - `npm run build` -> passed.
  - `npm run verify` -> 168 files / 1145 tests passed, 26/26 agent evals passed, 2/2 memory evals passed.
  - `BUILDING_AGENT_SMOKE_REQUIRED_TEXTS='工作区|默认工作区' npm run smoke:prod` -> passed; renderer rendered agent chat UI. Note: local `node_modules` emitted the existing better-sqlite3 ABI warning and fell back to JSON storage during smoke.
  - `npm run harness:check` -> passed.
  - `npm run dist:mac` -> passed; regenerated `release/Zerox Agent-2.7.0-arm64.dmg` and `release/Zerox Agent-2.7.0-arm64-mac.zip`.
  - `BUILDING_AGENT_SMOKE=1 BUILDING_AGENT_SMOKE_REQUIRED_TEXTS='工作区|默认工作区' "release/mac-arm64/Zerox Agent.app/Contents/MacOS/Zerox Agent"` -> passed; packaged app rendered the workspace entry.
