# Task 7 acceptance-engine review fixes

## Scope

- Final acceptance infrastructure classification and native provider error metadata.
- Final-model-judge-only replay contract in `AgentGoalAcceptance`.
- Deterministic UTF-8 prompt compaction for the final judge.

## Root causes

1. Anthropic and Gemini emitted `HTTP <status>: <body>`, while the acceptance classifier only recognized structured `status`/`statusCode` or the text `status <status>`.
2. The controller's only public final acceptance entry point was `evaluateGoal`, so every retry necessarily traversed deterministic validators again.
3. Individual transcript/evidence fields had character limits, but goal, criteria, milestones, run IDs, failures, and multi-byte strings had no aggregate byte budget.

## RED evidence

- `npm test -- --run src/main/agentGoalAcceptanceRetryPolicy.test.ts src/main/providers/providers.test.ts`
  - Failed for `HTTP 429`, `HTTP 502`, Anthropic structured retry metadata, and Gemini structured retry metadata.
- `npm test -- --run src/main/agentGoalAcceptance.test.ts`
  - Failed because `replayFinalGoalJudge` did not exist and the final prompt byte ceiling was undefined.
- `npm test -- --run src/main/agentGoalAcceptance.test.ts -t "malformed"`
  - Failed with a `TypeError` for malformed persisted replay evidence instead of a fail-closed result.

## Implementation and controller interface

- `AgentGoalAcceptance.replayFinalGoalJudge(goal, sealedEvidence, ctx)` is the final-only entry point.
- On a final judge infrastructure failure, the initial `evaluateGoal` result includes `finalJudgeReplay` with:
  - goal and criteria identity;
  - a SHA-256 evidence fingerprint covering deterministic results plus rendered evidence identity/content;
  - the already-passed deterministic check results;
  - a bounded `GoalEvidenceManifest` safe for persistence and replay.
- Replay validates the goal/criteria/evidence seal before any model call, reuses the sealed manifest, and evaluates only `model_review` checks. It never dispatches registry validators, commands, tests, shell operations, or tools.
- Controller integration should persist `result.finalJudgeReplay` with the recoverable retry state and call `replayFinalGoalJudge` for automatic retry and user-initiated continuation. A missing, malformed, mismatched, or changed seal returns non-retryable `validator_failed`; it must not issue a certificate.
- `FINAL_GOAL_JUDGE_MAX_PROMPT_BYTES` is 32 KiB across system and user messages. Per-field, collection, section, and aggregate budgets preserve the decision schema and evidence refs/hashes; explicit omitted item/byte counts describe compaction.
- Native provider errors expose only `status`, `statusCode`, and allowlisted/capped Retry-After metadata. Response bodies and unrelated headers are not retained.

## GREEN evidence

- `npm test -- --run src/main/agentGoalAcceptanceRetryPolicy.test.ts src/main/agentGoalAcceptance.test.ts src/main/providers/providers.test.ts`
  - Passed: 3 files, 134 tests.
- `npx tsc -p tsconfig.electron.json --noEmit --pretty false`
  - Passed.
- `npm run harness:check`
  - Passed.
- `git diff --check`
  - Passed.

## Adversarial coverage

- Native `HTTP 429` and `HTTP 5xx` retry; ordinary `HTTP 4xx` remains non-retryable.
- Retry-After is allowlisted and capped at 30 seconds for Anthropic and Gemini.
- A deterministic validator throws if invoked during replay; replay still succeeds and tool calls remain zero.
- Altered fingerprints and malformed persisted replay evidence fail closed before the judge.
- A 100,000-character Chinese goal, 200 criteria, 200 accepted milestones, thousands of run IDs, 100 failures, large transcript, and artifact evidence remain within 32 KiB while retaining the output schema plus artifact ref, SHA-256, and evidence excerpt.
