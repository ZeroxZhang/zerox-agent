# Task 5 Report - Renderer, IPC, And User-Visible State Coherence

## Status

DONE

## Changed files

- `src/main/agentWorkspaceService.ts`
- `src/main/agentWorkspaceService.test.ts`
- `src/main/chatService.ts`
- `src/main/chatService.test.ts`
- `src/main/container.ts`
- `src/main/container.test.ts`
- `src/main/ipc/index.ts`
- `src/preload/index.ts`
- `src/preload/index.test.ts`
- `src/renderer/components/AgentChatPanel.tsx`
- `src/renderer/components/RunsPanel.tsx`
- `src/renderer/materialDesign.test.ts`

## RED evidence

- `npm test -- src/main/agentWorkspaceService.test.ts src/preload/index.test.ts` -> failed as expected: git worktree creation resolved without approval and preload still invoked `agentWorkspaces:createGitWorktree`.
- `npm test -- src/main/chatService.test.ts src/main/goalChatService.test.ts src/renderer/chatTaskActivity.test.ts` -> failed as expected: review continuation could return `achieved` without clearing the active chat goal link.
- `npm test -- src/renderer/materialDesign.test.ts` -> failed as expected: Runs panel had no run-lifecycle refresh subscription and empty chat session lists were still ignored.

## GREEN evidence

- `npm test -- src/main/agentWorkspaceService.test.ts src/preload/index.test.ts` -> 2 files / 7 tests passed.
- `npm test -- src/main/chatService.test.ts src/main/goalChatService.test.ts src/renderer/chatTaskActivity.test.ts` -> 3 files / 46 tests passed.
- `npm test -- src/renderer/materialDesign.test.ts` -> 1 file / 36 tests passed.
- `npm test -- src/renderer/materialDesign.test.ts src/renderer/chatTaskActivityRestore.test.ts` -> 2 files / 37 tests passed.
- `npm run harness:check` -> passed.
- `npm test` -> 165 files / 1071 tests passed.
- `npm run build` -> passed.
- `npm run verify` -> 165 files / 1071 tests passed; build passed; agent eval 26/26; memory eval 2/2.
- `npm run smoke:prod` -> passed; renderer rendered agent chat UI with expected SQLite ABI fallback to JSON.
- `git diff --check` -> passed.

## Implementation notes

- `createGitWorktreeWorkspace()` now refuses `git worktree add` unless the main process supplies explicit user approval or the repository root matches a trusted repository policy.
- The preload worktree API now goes through `agentWorkspaces:requestGitWorktree`; IPC requests approval in the main process before adding an approval marker for the service.
- Terminal chat-goal summaries are still stored, but `achieved`, `failed`, and `canceled` statuses clear `activeGoalId` through shared main-process helper paths used by chat commands and progress synchronization.
- RunsPanel refreshes run and active execution lists from a new `agentRuns:changed` subscription and legacy stream events; kernel events remain detail input for the inspector.
- Desktop `listChatSessions()` returning `[]` now replaces local chat sidebar state instead of preserving fallback/demo sessions.

## Residual risk

- Worktree approval reuses the existing tool-approval coordinator with a synthetic `git_worktree_add` request. This preserves explicit main-process permissioning without adding a new dialog surface, but future UI polish could introduce a dedicated workspace approval copy.

---

# Task 5A Report - Atomic Manual Completion Attestation

## Status

DONE

Base: `3fb3d1f13c7b11bbb773860e03ae46600b0b2598`

## Changed files

- `src/main/agentGoalController.ts`
- `src/main/agentGoalController.test.ts`
- `src/main/agentGoalStore.test.ts`
- `src/main/storage/repositories/repositories.test.ts`
- `src/main/agentGoalAcceptanceCertificate.ts`
- `src/main/agentGoalAcceptanceCertificate.test.ts`
- `.superpowers/sdd/task-5-report.md`

## RED evidence

Command:

```text
npm test -- --run src/main/agentGoalController.test.ts src/main/storage/repositories/repositories.test.ts src/main/agentGoalAcceptanceCertificate.test.ts
```

Observed expected failures:

- 6 controller tests failed with `controller.markCompletedUnverified is not a function`.
- The certificate regression failed because `verifyGoalAcceptanceCertificate()` returned `{ ok: true }` for `completed_unverified` with a retained valid certificate.
- SQLite same-status parity already passed through the existing irreversible terminal guard.
- Overall RED result: 2 test files failed, 1 passed; 7 tests failed, 176 passed.

## GREEN evidence

```text
npm test -- --run src/main/agentGoalController.test.ts src/main/agentGoalStore.test.ts src/main/storage/repositories/repositories.test.ts src/main/agentGoalAcceptanceCertificate.test.ts src/main/agentGoalRedaction.test.ts
```

- 5 test files passed; 228 tests passed.

```text
npx tsc -p tsconfig.electron.json --noEmit
```

- Passed with no diagnostics.

```text
npm run harness:check
```

- Passed.

```text
git diff --check
```

- Passed.

## Implementation and self-review

- `markCompletedUnverified()` accepts only canonical `waiting_for_acceptance`; every other status throws the required status-specific error.
- Attestation construction fails closed without a lowercase SHA-256 evidence fingerprint or valid retry cycle, takes failure code/cycle from canonical retry state, and takes bounded unique check/evidence references from the latest final-goal failure.
- Check IDs, evidence refs, and the failure code use the existing acceptance redaction/bounding path; the audit payload excludes provider detail, prompts, artifact bodies, and certificate data.
- A controller publication fence keeps the order `acceptance_manual_completion_requested` -> one atomic goal save -> `acceptance_manual_completion_recorded`; terminal publication waits until recorded is durable. Save failure leaves requested evidence but never recorded evidence.
- The single save carries `completed_unverified`, `user_marked_complete`, the attestation, and an explicitly absent certificate.
- File and SQLite store regressions prove same-status stale writes cannot remove the canonical attestation or restore a forged certificate. The pre-existing late-judge regression continues to prove terminal stale-write fencing.
- Certificate verification now requires canonical status `achieved`, so manual completion cannot verify even if stale certificate bytes are present.
- No service, container, IPC, preload, global, or UI files were changed.

## Concerns

- `./init.sh` has a pre-existing unrelated failure in `src/shared/packageScripts.test.ts` because the harness expects P42 to be the open release feature while P43 is now the sole in-progress feature. The required standalone `npm run harness:check` passes.

## Task 5A Independent Review Fixes

### Status

DONE

### RED evidence

```text
npm test -- --run src/main/agentGoalStore.test.ts src/main/storage/repositories/repositories.test.ts src/main/agentGoalController.test.ts
```

- Expected RED: 3 test files failed; 12 tests failed and 145 passed.
- JSON and SQLite tests failed because `saveIfStatus` did not exist.
- Controller race tests showed `completed_unverified` incorrectly overwrote canonical `executing` and `canceled` winners.
- Recorded/goal-stopped retry tests failed because a committed `completed_unverified` goal was rejected instead of resuming publication.

### GREEN evidence

```text
npm test -- --run src/main/agentGoalController.test.ts src/main/agentGoalStore.test.ts src/main/storage/repositories/repositories.test.ts src/main/agentGoalAcceptanceCertificate.test.ts src/main/agentGoalRedaction.test.ts
```

- 5 test files passed; 240 tests passed.

```text
npx tsc -p tsconfig.electron.json --noEmit
npm run harness:check
git diff --check
```

- All passed.

### Additional changed files

- `src/main/agentGoalStore.ts`
- `src/main/storage/repositories/goalRepository.ts`
- `src/shared/storageContract.ts`

### Fixes and self-review

- Added a serialized JSON goal-store CAS and a single-statement SQLite `UPDATE ... WHERE status = ?` CAS. Manual completion can now commit only while canonical status is `waiting_for_acceptance`; `executing` and terminal race winners are returned unchanged.
- Both CAS implementations explicitly remove `acceptanceCertificate` from a successful manual transition, including when the waiting record contains stale or forged certificate data.
- A committed manual terminal can re-enter `markCompletedUnverified()` only to recover post-commit publication. Durable ledger and trajectory reads make recorded and goal-stopped publication idempotent across same-controller retries and controller recreation.
- Failure injection covers recorded ledger, recorded trajectory, goal-stopped ledger, and goal-stopped trajectory boundaries. Ledger failure is injected after the durable write to prove replay dedupe; trajectory failure is retried without duplicating durable events.
- Terminal publication versions are registered only after goal-stopped ledger and trajectory writes are durable. A ledger-tail check distinguishes retry recovery from a later terminal cycle even under a fixed clock.
- Prior Task 5 report content above is retained verbatim; the original Task 5A report and this review-fix section are appended.

## Task 5A Second Independent Review Fixes

### Status

DONE

### RED evidence

```text
npm test -- --run src/main/agentGoalController.test.ts src/main/agentGoalStore.test.ts src/main/agentTrajectoryStore.test.ts src/main/storage/repositories/repositories.test.ts
```

- Expected RED: 4 test files failed; 6 tests failed and 162 passed.
- Store tests failed because ledger and trajectory atomic append-if-absent APIs did not exist.
- The CAS loser test showed the winner could fail recorded publication while the loser still returned without repairing it.
- Cross-controller barrier tests showed publication did not enter atomic boundaries and could not guarantee exactly-once order.

```text
npm test -- --run src/main/agentTrajectoryStore.test.ts
```

- Expected RED: 1 test failed and 7 passed; SQLite incorrectly treated an unrelated sequence collision as an existing publication.

### GREEN evidence

```text
npm test -- --run src/main/agentGoalController.test.ts src/main/agentGoalStore.test.ts src/main/agentTrajectoryStore.test.ts src/main/storage/repositories/repositories.test.ts
```

- 4 test files passed; 169 tests passed.

```text
npm test -- --run src/main/agentGoalController.test.ts src/main/agentGoalStore.test.ts src/main/agentTrajectoryStore.test.ts src/main/storage/repositories/repositories.test.ts src/main/storage/repositories/runRepository.test.ts src/main/agentGoalAcceptanceCertificate.test.ts src/main/agentGoalRedaction.test.ts
```

- Final focused verification: 7 test files passed; 260 tests passed.

```text
npx tsc -p tsconfig.electron.json --noEmit
npm run harness:check
git diff --check
```

- All passed.

### Fixes and self-review

- Manual terminal publication is now a per-goal serialized sequence inside each controller: durable recorded ledger, durable recorded trajectory, durable goal-stopped ledger, then durable goal-stopped trajectory.
- A CAS loser that receives another caller's `completed_unverified` canonical result always enters the same recorded-first recovery sequence, including when the winner's recorded write is delayed or fails.
- Ledger events carry a durable `publicationKey`. JSON goal stores share a path-keyed mutation queue across instances; SQLite uses one `INSERT ... WHERE NOT EXISTS` statement.
- Trajectory publication uses a deterministic publication event ID. JSON trajectory stores share a path-keyed mutation queue; SQLite uses `INSERT OR IGNORE` and allocates the next durable sequence so restart collisions cannot suppress a missing publication.
- Barrier regressions force two controllers/stores to reach all four absent-publication boundaries concurrently and prove exactly-once durable events in recorded-before-stopped order.
- Recorded and stopped progress is emitted only by the caller that atomically appends the corresponding trajectory event, preventing duplicate recovery notifications.

---

# Task 5B Report - Explicit Service, IPC, And Preload Operations

## Status

DONE

Base: `1d8d20de4b3a49e2f677365110d9d803bc3bd601`

## Changed files

- `src/main/goalChatService.ts`
- `src/main/goalChatService.test.ts`
- `src/main/container.ts`
- `src/main/ipc/index.ts`
- `src/main/ipc/index.test.ts`
- `src/preload/index.ts`
- `src/preload/index.test.ts`
- `.superpowers/sdd/task-5-report.md`

`src/renderer/global.d.ts` already exposes `BuildingAgentApi = typeof buildingAgent`; the two preload additions therefore flow into the renderer's exact `window.buildingAgent` type without a duplicate declaration.

## RED evidence

```text
npm test -- --run src/main/goalChatService.test.ts src/main/ipc/index.test.ts src/preload/index.test.ts
```

- Expected RED: 3 test files failed; 4 tests failed and 40 passed.
- Service failures proved `continueAcceptance` and `markCompletedUnverified` were absent.
- IPC failure proved neither dedicated handler was registered.
- Preload failure proved neither renderer-facing operation was exposed.

## GREEN evidence

```text
npm test -- --run src/main/goalChatService.test.ts src/main/container.test.ts src/main/ipc/index.test.ts src/preload/index.test.ts
```

- 4 test files passed; 85 tests passed.

```text
npx tsc -p tsconfig.electron.json --noEmit --pretty false
npm run harness:check
git diff --check
```

- All passed.

## Implementation and self-review

- `GoalChatService.continueAcceptance(goalId, options?)` forwards the caller's abort signal to the controller and returns only the canonical chat goal summary.
- `GoalChatService.markCompletedUnverified(goalId)` delegates exclusively to the controller, preserving Task 5A's atomic attestation, certificate clearing, and idempotent publication behavior.
- Container operations are distinct wrappers through the existing `runGoalOperation` error/result boundary.
- IPC channels are exactly `goal:continueAcceptance` and `goal:markCompletedUnverified`; runtime tests prove each handler calls only its matching container operation.
- Preload operations are exactly `continueGoalAcceptance(goalId)` and `markGoalCompletedUnverified(goalId)` and return the existing typed `GoalOperationResult`.
- Generic `retryGoal` and `goal:retry` are unchanged, so final-acceptance continuation cannot be confused with task execution retry.

## Concerns

- Renderer exhaustiveness updates for the new goal statuses and acceptance phases remain intentionally out of scope for Task 5B and are assigned to Task 6.

## Task 5B Independent Review Fixes

### Status

DONE

### RED evidence

```text
npm test -- --run src/main/goalChatService.test.ts src/main/container.test.ts src/main/ipc/index.test.ts
```

- Expected RED: 3 test files failed; 4 tests failed and 79 passed.
- The service and real production-container tests proved that a continuation started from the wrapper had no registered abort signal, so `cancel()` could not stop a validator/judge wait.
- Both IPC negative tests proved unsafe, traversal-shaped, oversized, and non-string goal IDs reached the container operations.

### GREEN evidence

```text
npm test -- --run src/main/goalChatService.test.ts src/main/container.test.ts src/main/ipc/index.test.ts src/preload/index.test.ts
```

- 4 test files passed; 89 tests passed.

```text
npm test -- --run src/main/agentGoalController.test.ts src/main/goalChatService.test.ts src/main/container.test.ts src/main/ipc/index.test.ts src/preload/index.test.ts src/main/agentGoalAcceptanceCertificate.test.ts
npx tsc -p tsconfig.electron.json --noEmit --pretty false
npm run harness:check
git diff --check
```

- Final focused verification: 6 test files passed; 264 tests passed.
- Electron TypeScript, harness, and diff checks all passed.

### Fixes and self-review

- Final-acceptance continuation now joins the existing per-goal active-run registry through a linked internal `AbortController`. Existing `cancel()` aborts that controller, including retry sleeps and the final judge/validator request.
- Concurrent continuation requests share the registered operation and do not start a second judge cycle. Tests prove one controller call and canonical `canceled` summaries for both callers.
- A short cancellation settlement fence makes an aborted continuation wait for the canonical cancel save and ledger publication before rereading the goal. A late `achieved` return from a dependency cannot escape through the service or container wrapper.
- The production container regression uses an abort-observing acceptance validator and the real `continueGoalAcceptance` plus `runGoalOperation` cancellation path; it proves the validator signal is aborted and durable status remains `canceled`.
- Both new IPC handlers validate `goalId` before any container call. Accepted IDs are trimmed-exact strings of 1-128 characters, begin with an ASCII alphanumeric character, contain only ASCII alphanumerics plus `. _ : -`, and cannot contain `..`.
- Invalid goal IDs return `{ ok: false, message: "目标 ID 无效。" }`; tests cover empty, whitespace, traversal, backslash, oversized, numeric, and null inputs on both channels.
- Generic `retryGoal` remains unchanged.

## Task 5B Third Independent Review Fix

### Status

DONE

### RED evidence

```text
npm test -- --run src/main/goalChatService.test.ts -t "keeps duplicate continuations registered through the final canonical read"
```

- Expected RED: the second continuation entered the controller while the first operation was blocked in its post-run canonical store read (`continuationCalls` was 2 instead of 1).
- After extending registry lifetime, the strengthened cancellation snapshot regression remained RED because a store read started before cancellation returned stale `waiting_for_acceptance` instead of canonical `canceled`.

### GREEN evidence

```text
npm test -- --run src/main/agentGoalController.test.ts src/main/goalChatService.test.ts src/main/container.test.ts src/main/ipc/index.test.ts src/preload/index.test.ts src/main/agentGoalAcceptanceCertificate.test.ts
npx tsc -p tsconfig.electron.json --noEmit --pretty false
npm run harness:check
git diff --check
```

- Final focused verification: 6 test files passed; 265 tests passed.
- Electron TypeScript, harness, and diff checks all passed.

### Fixes and self-review

- Active runs now use a typed `background | operation` entry. An operation entry owns the complete continuation promise: controller runner, cancellation settlement, canonical store read, and cleanup.
- Duplicate continuation callers return the same full operation completion and cannot start a second judge while canonical settlement is still in progress.
- Registry deletion moved to the outer operation `finally`, after every canonical read or error path has settled.
- The regression blocks the first post-run store read, starts a duplicate continuation, cancels concurrently, and returns the pre-cancel snapshot from that blocked read. The operation detects cancellation during the read, waits for cancellation settlement, rereads canonical state, and returns `canceled` to both callers.
- A third continuation after both callers settle reaches the controller again, proving the registry entry clears without leaking.
