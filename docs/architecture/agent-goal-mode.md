# Chat Session Goal Mode Architecture

Goal Mode adds bounded autonomy above the recoverable runtime. In the current UX it is a Chat Session Goal Mode: a user defines, continues, reviews, modifies, or ends a high-level goal inside the conversation where the work is happening. The agent can only run inside explicit budgets, deterministic or evidence-backed acceptance, review gates, and durable local checkpoints.

Goal Mode is no longer a parallel standalone page. Chat sessions carry `activeGoalId`, `goalIds`, and goal summaries; goal events are written back to assistant messages with `goalId` and `goalEventRef`. Legacy `#goals` navigation resolves to Chat so old links land in the session-native surface.

## Layer Diagram

```text
Renderer AgentChatPanel
  -> GoalContractBar / GoalDetailDrawer / inline review gate
  -> ChatService goal intent routing
    -> GoalChatService
      -> AgentGoalStore JSON + ledger JSONL
      -> AgentGoalController
        -> AgentGoalPlanner
        -> AgentRuntimeEngine child runs
        -> AgentGoalAcceptance
        -> AgentGoalContext compaction
        -> AgentTrajectoryStore evidence
```

The goal layer sits above `AgentRuntimeEngine`. A milestone dispatch is one recoverable runtime run, so existing workspace sandboxing, tool authorization, checkpoints, reflection, model retry, and trajectory records remain the execution boundary. The renderer surface is the chat session: active-goal badges live in the session rail, the Goal Contract Bar summarizes the current goal, review gates render inline, and detailed progress opens as a drawer.

## Goal State Machine

| State | Meaning | Terminal |
| --- | --- | --- |
| `planning` | Goal draft exists and can be decomposed into milestones. | No |
| `executing` | The controller may dispatch the next ready milestone. | No |
| `waiting_for_review` | A review gate is open; no milestone can advance. | No |
| `achieved` | Goal-level acceptance passed. | Yes |
| `stopped_budget` | Budget was exhausted before more work could start. | Yes |
| `stopped_stalled` | The controller detected no progress. | Yes |
| `failed` | Acceptance or runtime failure became unrecoverable. | Yes |
| `canceled` | User or review decision stopped the goal. | Yes |

Allowed transitions are defined in `src/shared/agentGoal.ts`. The important recovery transition is `waiting_for_review -> executing` after an explicit review decision.

## Five Termination Conditions

Goal Mode is bounded autonomy. The controller must stop or suspend when any termination condition is reached:

1. Goal acceptance passes: set `achieved` and `stopReason: goal_accepted`.
2. Budget is exhausted: set `stopped_budget` before dispatching another milestone.
3. Progress stalls: set `stopped_stalled` with a help summary.
4. Review gate is reached: set `waiting_for_review` and wait for user action.
5. User interrupt or termination: set `canceled` with a reviewed stop reason.

Budget checks happen before dispatch. An exhausted budget must never start a new runtime run.

## Deterministic-first Acceptance

Acceptance checks live on success criteria and are non-empty. The acceptance engine evaluates deterministic checks first:

- `file_exists`
- `command_exit_code`
- `test_passes`
- `assertion`

`model_review` is an inferential fallback only. It must require evidence refs, and a model review with no evidence is not accepted. When a bounded runtime transcript is available, the acceptance engine asks a transcript-backed goal judge for a JSON verdict before accepting inferential evidence. The judge emits `goal_judged` trajectory evidence with goal, milestone, check, verdict, reason, and transcript message count; acceptance then emits `acceptance_checked` so eval fixtures and the UI can inspect why a milestone or goal passed.

## Review Policies

Review policy is shared in `src/shared/agentGoalReview.ts` and consumed by the controller:

| Policy | Gate condition |
| --- | --- |
| `review_each_milestone` | Suspend after every accepted milestone. |
| `review_key_milestones` | Suspend for final acceptance or milestone metadata `reviewRequired: true`. |
| `review_final_only` | Suspend only at final milestone or goal acceptance boundary. |
| `review_high_risk_only` | Suspend for milestone metadata `riskLevel: "high"`. |

Review decisions are explicit:

- `approve_continue`: resume the bounded loop.
- `modify_plan`: replan remaining non-terminal milestones.
- `terminate`: stop as `canceled` with `review_rejected`.

## Goal Continuity Checkpoint

Long goals must not lose their objective. `AgentGoalContext` now injects an eleven-section continuity checkpoint when compacting:

- active intent
- next concrete action
- directives
- task tree
- current work
- files and evidence
- discovered knowledge
- errors and fixes
- live resources
- design decisions
- open notes

Completed milestones can be summarized to conclusion plus evidence. Running and pending milestones keep enough detail to safely continue, and the checkpoint is emitted as a system anchor marked never compact.

## Recovery Guarantees

Goal state is local-first:

```text
userData/config/agent-goals/<goalId>.json
userData/config/agent-goals/<goalId>.ledger.jsonl
userData/config/agent-trajectories/<goalId>.jsonl
```

On restart, active goals can be listed from `AgentGoalStore`. Accepted milestones are not re-dispatched on resume. Ledger entries and trajectory events explain each milestone start, acceptance result, replan, review request, review resolution, context compaction, checkpoint, and stop reason.

## Verification

Fast focused paths:

```bash
npm test -- src/main/agentGoalController.test.ts src/main/eval/agentEvalRunner.test.ts src/main/eval/agentEvalAdversary.test.ts src/shared/harnessScore.test.ts src/shared/readme.test.ts
node scripts/run-agent-evals.mjs
npm run harness:score
```

The deterministic eval suite includes seven goal-mode fixtures covering achievement, budget stop, stall detection, replan on acceptance failure, review gate blocking, continuity checkpoint retention, and transcript-backed goal judge ordering. Harness score reports both goal-mode pass rate and goal-judge pass rate, while adversarial eval rejects removed acceptance checks and removed judge events.
