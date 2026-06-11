# Harness Engineering Iteration Spec

调研日期：2026-06-09

## Goal

把 Zerox Agent 从“已经有 recoverable runtime 的本地 agent 桌面应用”推进到更完整的 AI Agent Harness：repo 自身可被 agent 读取、每次运行可恢复可审计、聊天与任务路径共享证据层、验证从“事件存在”升级为“合同验收”，并把项目里已经证明有效的工程约束沉淀成可持续执行的黄金原则。

## Research Basis

本 spec 将 Harness Engineering 解释为 AI coding agent 的运行底座，而不是 Harness.io 公司。调研来源包括：

- OpenAI, “Harness engineering: leveraging Codex in an agent-first world”, 2026-02-11: https://openai.com/index/harness-engineering/
- OpenAI, “Unrolling the Codex agent loop”, 2026-01-23: https://openai.com/index/unrolling-the-codex-agent-loop/
- Anthropic, “Effective harnesses for long-running agents”, 2025-11-26: https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- Anthropic, “Harness design for long-running application development”, 2026: https://www.anthropic.com/engineering/harness-design-long-running-apps
- LangChain, “Improving Deep Agents with harness engineering”, 2026-02-17: https://www.langchain.com/blog/improving-deep-agents-with-harness-engineering
- Cursor, “Continually improving our agent harness”, 2026-04-30: https://cursor.com/blog/continually-improving-agent-harness
- Martin Fowler / Thoughtworks, “Harness engineering for coding agent users”, 2026-04-02: https://martinfowler.com/articles/harness-engineering.html
- Zhong & Zhu, “AI Harness Engineering: A Runtime Substrate for Foundation-Model Software Agents”, arXiv:2605.13357, 2026-05-13: https://arxiv.org/abs/2605.13357
- Sengupta et al., “Meta-Engineering Harnesses for AI-Native Software Production”, arXiv:2605.25665, 2026-05-25: https://arxiv.org/abs/2605.25665
- Li et al., “Agent Harness Engineering: A Survey”, OpenReview PDF, 2026: https://openreview.net/pdf/f358711a95aaaf61fdeffd4ef3fc60fba9b8da57.pdf

## External Lessons

### 1. Harness Is The System Around The Model

The model is not the product boundary. The product boundary is the model plus the environment that controls what it sees, what it can do, what state survives, what evidence is produced, and how completion is verified.

For Zerox, this means runtime, tools, memory, workspace, trajectory, permissions, evals, and UI review panels are not supporting infrastructure. They are the core product.

### 2. Repo-Local Knowledge Beats Hidden Context

OpenAI’s core lesson is that knowledge outside the repository is invisible to future agent runs. Anthropic’s long-running harness uses explicit local files such as feature lists, progress logs, and init scripts so a fresh session can resume safely.

For Zerox, the root repository needs a small agent-readable harness entrypoint:

- `AGENTS.md`: map and operating rules, not a giant manual.
- `init.sh`: deterministic health check and restart path.
- `.zerox/feature_list.json`: machine-readable scope and priority.
- `.zerox/progress.md`: handoff notes with verified evidence.
- `.zerox/golden-principles.md`: project-specific taste and architecture invariants.

### 3. Evidence Must Be Runtime-Native

The strongest sources all converge on trace-driven improvement. A high-quality harness produces evidence: what files were selected, what tools were used, what failed, what was retried, what was verified, and what a human approved.

Zerox already has `agent-trajectories/<runId>.jsonl`, redaction flags, checkpoints, eval fixtures, and learning candidates. The next step is to package these as explicit “episode packages” and score them against a richer contract.

### 4. Verification Needs Independent Pressure

Anthropic’s generator/evaluator loop shows that the evaluator must be trained to reject shallow completion. LangChain and Cursor emphasize traces, evals, and regression repair.

For Zerox, `run-agent-evals` should move from event-presence checks to ordered, payload-aware, contract-style checks:

- required event order
- expected state transitions
- payload assertions
- redaction assertions
- workspace and permission assertions
- recovery assertions

### 5. Guardrails Should Be Mechanical And Agent-Legible

Martin Fowler’s guide/sensor model maps well to Zerox:

- Feedforward guides: `AGENTS.md`, skills, feature list, product positioning, typed prompts.
- Feedback sensors: tests, build, smoke, evals, runtime trajectories, tool audit, learning review.

When a bad pattern repeats, the harness should gain a new guide or sensor rather than relying on humans to remember the lesson.

## Current Project Review

### Verified Build Status

Commands run on 2026-06-09:

```bash
npm run verify
npm run smoke:prod
```

Results:

- `npm run verify`: passed.
- Unit tests: 76 test files, 333 tests, all passed.
- Production build: passed.
- Agent evals: 7/7 passed, pass rate 1.0, recoverability rate 1.0, tool success rate 0.8.
- Memory evals: 2/2 passed.
- `npm run smoke:prod`: passed; Electron production startup rendered the agent chat UI.

Repository scale:

- 177 TypeScript/TSX files under `src`.
- 76 `*.test.ts` files.
- Application code: about 22,834 lines.
- Test code: about 11,342 lines.

### Existing Assets Worth Learning From

1. **Local-first trust boundary**
   - Product positioning is already precise: local-first desktop control plane, explicit permissions, observable runs, reviewed learning.
   - Source: `docs/product/zerox-positioning.md`.

2. **Typed recoverable runtime**
   - `src/shared/agentExecution.ts` defines explicit statuses, transitions, checkpoint fields, step states, artifacts, and failure classes.
   - `src/main/agentRuntimeEngine.ts` persists checkpoints before and during execution.

3. **Trajectory-first observability**
   - `src/shared/agentTrajectory.ts` defines append-only event types and redaction flags.
   - Runtime emits model request/response, tool calls/results, state transitions, checkpoint writes, failure classifications, and final summaries.

4. **Permissioned tool layer**
   - `src/shared/toolPermissions.ts` combines task policy with workspace context.
   - `src/main/toolAuthorizationService.ts` audit-logs authorization decisions and can request one-off user approval.

5. **Workspace-aware execution**
   - `src/shared/agentWorkspace.ts` and `src/main/agentWorkspaceService.ts` create default, temporary, project, and git-worktree workspaces.
   - Multi-agent child contexts inherit and narrow parent sandbox policy.

6. **Reviewed learning loop**
   - `src/main/agentLearningExtractor.ts`, `src/main/agentLearningStore.ts`, and `src/main/agentLearningService.ts` keep learning reviewable before it affects future runs.
   - Accepted procedural learning becomes local memory, not silent code mutation.

7. **Deterministic eval path**
   - `scripts/run-agent-evals.mjs` and `scripts/run-memory-evals.mjs` give the project a repeatable local quality signal.
   - `OverviewPanel` already surfaces eval and learning signals in the UI.

8. **Good documentation discipline**
   - Architecture docs exist for runtime, workspaces, and learning.
   - Existing `docs/superpowers/plans` and `docs/superpowers/specs` show the project already plans work in agent-readable form.

### Current Gaps

1. **Missing repo-local operating harness**
   - No root `AGENTS.md`.
   - No root `init.sh`.
   - No machine-readable feature list/progress file.
   - This makes fresh agents depend on conversation context or README scanning instead of a compact operational map.

2. **Two execution paths**
   - Scheduled/manual tasks use `AgentRuntimeEngine`.
   - Chat tool mode still uses `runAgentLoop` directly through `ChatService`.
   - Result: chat runs do not automatically get the same checkpoint, trajectory, learning, workspace, and episode guarantees as task runs.

3. **Runtime state model is ahead of runtime behavior**
   - `waiting_for_approval` exists in types and UI labels, but runtime does not yet save a checkpoint in that state while approval is pending.
   - Step states exist, but `AgentRuntimeEngine` currently uses a single pending step and does not mark normal running/completed state transitions.

4. **Signal propagation is incomplete**
   - `AgentToolExecutor.execute` accepts `signal`.
   - `runAgentLoop` passes it.
   - `AgentRuntimeEngine` and compatibility `AgentRunnerService.executeToolCalls` do not consistently pass it, so scheduled-task long shell/tool calls are less interruptible than chat calls.

5. **Shell sandbox semantics are softer than file sandbox semantics**
   - `workspace_only` is typed, but enforcement mainly relies on command templates and `cwd`.
   - A future hardening pass should inspect path-like shell arguments and deny outside-workspace paths unless explicitly allowed.

6. **Eval is too shallow for H3-level harness quality**
   - Current eval fixtures require event presence.
   - They do not yet verify event order, payload content, redaction correctness, approval state transitions, abort behavior, or contract-level completion.

7. **Learning extraction is intentionally conservative but generic**
   - Current extractor handles successful tool sequences, permission failures, and invalid model output.
   - It does not yet mine repeated failure patterns, evaluator findings, incomplete verification, or drift against golden principles.

## Target State

Zerox should become an H3-style auditable local agent harness:

- A fresh agent can enter the repo, run one command, understand the next feature, and know how to verify its work.
- Every significant agent action emits evidence that can be replayed or exported.
- Chat and scheduled tasks share the same evidence semantics.
- Approval, pause, resume, cancellation, and failure classification are visible in checkpoints and trajectories.
- Tool permissions are task-scoped and workspace-scoped, including shell path semantics.
- Evals grade behavior, not just event existence.
- Learning improves future runs only after explicit review.
- Golden principles turn repeated human taste into executable checks or agent-readable guidance.

## Requirements

### R1 Repo-Local Operating Harness

Create a root-level agent operating surface:

- `AGENTS.md` gives the map, commands, boundaries, done criteria, and handoff rules.
- `init.sh` performs deterministic setup/health checks.
- `.zerox/feature_list.json` tracks this iteration’s features, status, priority, and verification commands.
- `.zerox/progress.md` records session handoffs and verified evidence.
- `.zerox/golden-principles.md` captures project-specific quality invariants.
- `npm run harness:check` verifies these artifacts exist and that core scripts are present.

### R2 Runtime State Fidelity

Make `AgentRuntimeEngine` behavior match the type model:

- Mark steps `running` when execution starts.
- Increment attempts for model/tool turns that belong to the step.
- Mark the current step `completed` when final summary succeeds.
- Mark failed steps only when terminal failure occurs.
- Save `waiting_for_approval` checkpoint before a user approval dialog blocks.
- Restore `running` after approval resolves.
- Pass abort signals through runtime tool execution.

### R3 Stronger Workspace And Shell Governance

Enforce shell sandbox semantics:

- `shell: "disabled"` denies all shell calls.
- `shell: "approved_commands"` keeps current template matching.
- `shell: "workspace_only"` also denies path-like arguments outside workspace and explicit extra roots.
- Denials emit `workspace_escape_denied` trajectory events when caused by workspace policy.

### R4 Evidence Parity For Chat Runs

Bring chat tool mode closer to scheduled-task evidence:

- Chat tool runs get run ids, trajectory events, failure classifications, and optional checkpoint snapshots.
- Chat continuation uses persisted evidence instead of only in-memory `pendingContinuations`.
- Related memory writes preserve source message ids and, when tools are used, tool evidence ids.

### R5 Episode Package Export

Add an exportable episode package:

- `run.json`
- `checkpoint.json`
- `trajectory.jsonl`
- `learning-candidates.json`
- `verification.json`
- `metadata.json`

This package should be deterministic and redaction-aware.

### R6 Contract-Level Evals

Upgrade agent evals:

- event order assertions
- payload assertions
- redaction assertions
- state transition assertions
- workspace escape assertions
- approval lifecycle assertions
- cancellation/signal assertions
- episode package assertions

### R7 Harness Score

Compute a local `HarnessScore` with seven categories aligned to ETCLOVG:

- Execution environment
- Tool interface
- Context management
- Lifecycle/orchestration
- Observability
- Verification
- Governance

The score should be shown in Overview and emitted by a CLI script.

### R8 Learning And Entropy Control

Improve reviewed learning:

- Extract repeated failure patterns.
- Extract evaluator findings.
- Convert accepted skill improvements into reviewable files, not automatic skill rewrites.
- Add a lightweight recurring “harness garbage collection” report that identifies stale docs, missing tests, and drift against golden principles.

## Non-Goals

- Do not add remote cloud workers in this iteration.
- Do not execute unreviewed self-modifying skill/code changes.
- Do not replace Electron or the local JSON/JSONL stores.
- Do not introduce full OS containerization yet.
- Do not make chat a generic hosted assistant; keep the local-first control-plane positioning.

## Success Metrics

### Build And Test

- `npm run verify` passes.
- `npm run smoke:prod` passes.
- `npm run harness:check` passes.
- No TypeScript errors in electron or renderer targets.

### Harness Quality

- Root operating harness files exist and are checked.
- `AgentRuntimeEngine` tests prove step `running -> completed` and `running -> failed` transitions.
- Approval tests prove `running -> waiting_for_approval -> running` trajectory/checkpoint behavior.
- Signal propagation tests prove runtime shell execution can be canceled or paused.
- Shell workspace tests prove outside-workspace paths are denied in `workspace_only`.
- Episode package tests prove deterministic export.
- Eval runner tests prove ordered/payload-aware assertions.

### Product Quality

- Overview shows current eval/harness score.
- Runs panel can inspect trajectory and episode export entry points.
- Learning panel continues to require explicit accept/reject/apply.
- README links to `AGENTS.md`, `init.sh`, and the harness plan.

## Roadmap

### P0: Repo-Local Harness And Health Check

Create the operating files and `npm run harness:check`. This is low-risk and immediately improves future agent sessions.

### P1: Runtime Fidelity And Governance

Make state transitions, approval, step status, signals, and shell workspace semantics match the type system and product promise.

### P2: Evidence Parity And Episode Export

Bring chat runs into the evidence layer and add deterministic episode packages.

### P3: Contract Evals And Harness Score

Upgrade evals from event-presence to contract checks and expose a seven-category harness score.

### P4: Learning And Entropy Garbage Collection

Turn repeated failure/evaluator evidence into reviewable learning and recurring drift reports.

## Open Questions

- Should chat runs become first-class `AgentRunRecord`s, or should they use a separate `ChatAgentRunRecord` that references chat sessions?
- Should episode packages live under Electron `userData/config` only, or should users be able to export them into a project workspace?
- Should `init.sh` run full `npm run verify` by default, or a faster `npm run harness:check && npm test` path with `verify` reserved for completion?
- Should `HarnessScore` be a deterministic static/eval report first, or partly inferential after enough trajectory data exists?
