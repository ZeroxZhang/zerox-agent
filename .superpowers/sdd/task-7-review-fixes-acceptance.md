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

## Critical follow-up: live artifact revalidation

### Root cause and RED

The replay seal authenticated the persisted manifest but did not compare that manifest with the live workspace. A deleted, modified, or symlink-replaced report could therefore still reach the model with its old excerpt and be accepted.

`npm test -- --run src/main/agentGoalAcceptance.test.ts -t "sealed file|required provenance|unchanged sealed"` initially failed 5 mutation cases: deleted file, modified bytes, workspace-escape symlink, deleted provenance sidecar, and provenance content tampering all returned `accepted`.

### Fix

- `replayFinalGoalJudge` now calls `revalidateGoalEvidenceManifest` before any provider call.
- Every sealed artifact is resolved again through the current workspace/authorized roots and existing sandbox/symlink checks, opened as a regular file, fully hashed, and compared with the sealed path, byte size, and SHA-256.
- Provenance-required scans seal the sidecar's exact content SHA-256 plus run/goal/milestone/artifact identity. Replay reuses `verifyArtifactProvenance` to check sidecar containment, no-symlink rules, schema, identity, and destination hash, then compares the exact sidecar content hash with the original anchor.
- Old provenance-required replay records without a provenance anchor fail closed.
- A live mismatch returns non-retryable `validator_failed`, retains the original manifest and replay seal for explicit user recovery, and cannot reach an acceptance/certificate path.
- The production-shaped test fixture uses real temporary files, JSON serialization, and `sanitizeFinalGoalJudgeReplayEvidence` before replay to cover the persisted/restarted shape.

### GREEN

- Mutation/unchanged regression subset: 6 passed; replay validator calls remained zero, mismatch provider calls remained zero.
- `npm test -- --run src/main/agentGoalAcceptance.test.ts src/main/agentGoalEvidenceManifest.test.ts src/shared/agentArtifactProvenance.test.ts src/main/agentGoalController.test.ts`
  - Passed: 4 files, 250 tests.
- `npx tsc -p tsconfig.electron.json --noEmit --pretty false`
  - Passed.

## Final review follow-up: one deadline and descriptor-bound reads

### RED

- A controlled chunk barrier showed replay had no deadline during live evidence hashing.
- A delayed revalidation followed by a pending provider showed the provider received a fresh timeout instead of the attempt's remaining budget.
- Replacing a validated artifact parent with a symlink between precheck and open was not covered by an fd/path identity binding test.
- Two provenance sidecars with distinct invalid UTF-8 bytes decoded to the same text and therefore produced the same sidecar hash.

### Fix

- Replay creates one linked final-judge deadline before live revalidation. The same deadline signal covers artifact/provenance reads, chunk hashing, model transport, response parsing, and judged publication; model-review helpers do not create a nested timer for replay.
- Deadline expiry during evidence work returns retryable `judge_timeout`, retains the original seal and manifest, emits no provider call, and leaves parent cancellation on the abort path.
- `readTrustedRegularFile` centralizes trusted reads for artifacts, artifact destinations, and provenance sidecars:
  - authorization and canonical roots are captured before the injectable pre-open barrier;
  - the leaf is opened with `O_NOFOLLOW`;
  - after open and after hashing, the path is revalidated for containment and symlink segments;
  - `lstat`/`stat` path identity and regular-file type/size must match the opened fd's `dev` and `ino`;
  - all bytes are read and hashed asynchronously in 64 KiB chunks from that same fd with abort checks and abortable hooks between chunks.
- Provenance JSON decoding uses a separate view of the single descriptor-bound raw Buffer; the sealed sidecar SHA-256 is calculated from exact raw bytes without a path reread.

### Verification

- Controlled deadline, remaining-budget, and parent-replacement tests: 3 passed.
- Exact raw provenance byte regression: 1 passed.
- Full focused acceptance/evidence/provenance/controller suite: 4 files, 254 tests passed.
