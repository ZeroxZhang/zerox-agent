## Status

DONE

## Changed Files

- `src/shared/toolResultRefs.ts`
- `src/main/ipc/index.ts`
- `src/main/container.ts`
- `src/main/toolResultOffloadStore.ts`
- `src/main/container.test.ts`
- `src/main/toolResultOffloadStore.test.ts`
- `.zerox/progress.md`

## RED Evidence

- `npm test -- src/main/toolResultOffloadStore.test.ts src/main/container.test.ts` failed:
  - store accepted a forged plain `{ kind: "tool_result_ref_read", ref }` capability and returned scoped ref content.
  - container accepted the same forged capability, proving the renderer/IPC path could bypass no-scope and wrong-run denial.

## GREEN Evidence

- `npm test -- src/main/toolResultOffloadStore.test.ts src/main/container.test.ts` -> 2 files / 9 tests passed.
- `npm test -- src/main/agentRuntimeEngine.test.ts src/main/agentRunnerService.test.ts src/main/container.test.ts src/main/toolResultOffloadStore.test.ts src/main/agentToolExecutor.test.ts src/shared/toolResultRefs.test.ts` -> 6 files / 83 tests passed.
- `npm run harness:check` -> passed.
- `npm run build` -> passed.
- `npm run verify` -> 165 files / 1066 tests passed; build passed; agent eval 26/26; memory eval 2/2.
- `npm run smoke:prod` -> passed; renderer rendered agent chat UI. The expected better-sqlite3 Electron ABI mismatch fell back to JSON.

## Implementation Notes

- `ReadToolResultRefOptions` is now the renderer-safe scope-only shape: `runId`, `sessionId`, `requestId`, and `workspaceRunId`.
- IPC now sanitizes `toolResults:readRef` options by copying only known string scope fields before calling the container, so renderer-supplied `capability` payloads are ignored.
- `ToolResultRefReadCapability` moved to the main offload store boundary and is issued through `issueToolResultRefReadCapability`. The store only honors capabilities carrying a private symbol token, which plain IPC/JSON input cannot forge.
- Same-run scoped reads still work through matching scope, wrong/no-scope reads remain denied for scoped refs, and trusted internal main-process-issued grants still support explicit cross-run read semantics.
