## Status

DONE

## Changed Files

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
- `.zerox/progress.md`

## RED Evidence

- `npm test -- src/main/agentRuntimeEngine.test.ts -t "owning runtime run read"` failed: same-run `tool_result_read` received no matching read scope and returned `ok:false` / `scoped ref denied`.
- `npm test -- src/main/agentRunnerService.test.ts -t "owning legacy runner read"` failed: the legacy scheduled runner ended failed instead of reading its scoped offloaded ref.
- `npm test -- src/main/container.test.ts -t "scoped tool-result ref reads"` failed: container/IPC path could not read a scoped ref even with matching `runId`.

## GREEN Evidence

- `npm test -- src/main/agentRuntimeEngine.test.ts -t "owning runtime run read"` -> 1 test passed.
- `npm test -- src/main/agentRunnerService.test.ts -t "owning legacy runner read"` -> 1 test passed.
- `npm test -- src/main/container.test.ts -t "scoped tool-result ref reads"` -> 1 test passed.
- `npm test -- src/main/agentRuntimeEngine.test.ts src/main/agentRunnerService.test.ts src/main/container.test.ts src/main/toolResultOffloadStore.test.ts src/main/agentToolExecutor.test.ts src/shared/toolResultRefs.test.ts` -> 6 files / 83 tests passed.
- `npm run harness:check` -> passed.
- `npm run verify` -> 165 files / 1066 tests passed; build passed; agent eval 26/26; memory eval 2/2.
- `npm run smoke:prod` -> passed; renderer rendered agent chat UI. The expected better-sqlite3 Electron ABI mismatch fell back to JSON.

## Implementation Notes

- `agentRuntimeEngine` now passes `toolResultReadScope` with the owning `runId` plus available session/workspace-run identity into tool execution, and writes those same optional identities onto offloaded refs.
- The legacy `agentRunnerService` fallback now passes `toolResultReadScope: { runId: taskId }`, matching the existing legacy offload write scope.
- `ReadToolResultRefOptions` and `ToolResultRefReadCapability` now live in the shared tool-result ref contract; the offload store aliases that public shape.
- Container, IPC, and preload read-ref APIs now accept the shared read options, and the trajectory panel supplies the selected event's run/session/workspace-run context.
- No global unscoped read path was reopened for new scoped refs: no-context and wrong-run reads remain denied, while matching scope or explicit `tool_result_ref_read` capability can read.
