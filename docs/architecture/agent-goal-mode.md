# Chat Session Goal Mode Architecture

Goal Mode adds observable, recoverable autonomy above the runtime. In the current UX it is a Chat Session Goal Mode: a user defines, continues, reviews, modifies, or ends a high-level goal inside the conversation where the work is happening. The agent runs inside local workspace permissions, deterministic or evidence-backed acceptance, review gates, explicit user interruption, and durable local checkpoints.

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
| `stopped_budget` | Legacy v2.0 budget-stop state; v2.1+ treats it as directly continuable. | No |
| `stopped_stalled` | The controller detected no progress. | Yes |
| `failed` | Acceptance or runtime failure became unrecoverable. | Yes |
| `canceled` | User or review decision stopped the goal. | Yes |

Allowed transitions are defined in `src/shared/agentGoal.ts`. The important recovery transitions are `waiting_for_review -> executing` after an explicit review decision and `stopped_budget -> executing` for goals stopped by older releases.

## Termination And Suspension Conditions

Goal Mode avoids hidden system budget stops. The controller must stop or suspend only when a behavioral condition is reached:

1. Goal acceptance passes: set `achieved` and `stopReason: goal_accepted`.
2. Progress stalls: set `stopped_stalled` with a help summary.
3. Review gate is reached: set `waiting_for_review` and wait for user action.
4. User interrupt or termination: set `canceled` with a reviewed stop reason.

`budgetUsage` remains an audit counter for iterations, tool calls, runtime, tokens, and replans. It is not a dispatch gate in v2.1+.

## Deterministic-first Acceptance

Acceptance checks live on success criteria and are non-empty. The acceptance engine evaluates deterministic checks first:

- `file_exists`
- `command_exit_code`
- `test_passes`
- `assertion`

`model_review` is an inferential fallback only. It must require evidence refs, and a model review with no evidence is not accepted. Every acceptance evaluation emits `acceptance_checked` trajectory evidence so eval fixtures and the UI can inspect why a milestone or goal passed.

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

## Goal-aware Compaction Anchors

Long goals must not lose their objective. `AgentGoalContext` preserves these anchors when compacting:

- goal description
- goal success criteria
- latest progress ledger summary
- accepted milestone conclusions
- evidence refs and tool-result offload refs

Completed milestones can be summarized to conclusion plus evidence. Running and pending milestones keep enough detail to safely continue.

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

The deterministic eval suite includes six goal-mode fixtures covering achievement, continued execution without budget stops, stall detection, replan on acceptance failure, review gate blocking, and compaction anchor retention.
