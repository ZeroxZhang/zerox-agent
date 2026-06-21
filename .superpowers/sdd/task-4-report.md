## Status

DONE

## Changed Files

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
- `.zerox/progress.md`

Shared-contract touches outside the brief list were necessary to carry scoped ref read context and provider tool-call ids through existing runtime boundaries: `src/shared/chat.ts`, `src/main/dynamicToolRegistry.ts`, and `src/main/agentToolExecutor.ts`.

## RED Evidence

- `npm test -- src/main/agentLoop.test.ts src/main/chatService.test.ts` failed:
  - paused multi-tool history left an assistant message with `provider_call_second` but no matching tool result.
  - chat status/workspace ledger events fabricated tool ids instead of recording `provider_call_ledger`.
- `npm test -- src/main/toolResultOffloadStore.test.ts src/main/toolObservationOffload.test.ts src/shared/toolPermissions.test.ts src/main/agentToolExecutor.test.ts` failed:
  - offloaded writes omitted `sessionId`, `requestId`, and `workspaceRunId`.
  - cross-run scoped ref reads returned content instead of `null`.
- `npm test -- src/main/actors/actorRuntime.full.test.ts src/main/agentEpisodeExporter.test.ts src/shared/runGraph.test.ts src/main/skillExecutionService.test.ts` failed:
  - workflow phases stayed `running` and lost phase metadata.
  - episode packages lacked chat/workspace ledger files.
  - run graph ignored workspace run ledger events.
  - `src/main/skillExecutionService.ts` did not exist.

## GREEN Evidence

- `npm test -- src/main/agentLoop.test.ts src/main/chatService.test.ts` -> 2 files / 45 tests passed.
- `npm test -- src/main/toolResultOffloadStore.test.ts src/main/toolObservationOffload.test.ts src/shared/toolPermissions.test.ts src/main/agentToolExecutor.test.ts` -> 4 files / 77 tests passed.
- `npm test -- src/main/chatService.test.ts src/shared/workspaceRunLedger.test.ts` -> 2 files / 31 tests passed.
- `npm test -- src/main/actors/actorRuntime.full.test.ts` -> 1 file / 19 tests passed.
- `npm test -- src/shared/skillExecutionContract.test.ts src/main/chatService.test.ts src/main/agentEpisodeExporter.test.ts src/shared/runGraph.test.ts src/main/skillExecutionService.test.ts` -> 5 files / 42 tests passed.
- `npm run harness:check` -> passed.
- `npm run build` -> passed.
- `npm run verify` -> 165 files / 1063 tests passed; build passed; agent eval 26/26; memory eval 2/2.
- `npm run smoke:prod` -> passed; renderer rendered agent chat UI. The expected better-sqlite3 Electron ABI mismatch fell back to JSON.

## Implementation Notes

- Multi-tool pause/resume: `runAgentLoop` now tracks processed tool calls for each assistant batch. If a pause or finalization interrupts the batch, the saved assistant message is trimmed to the answered provider tool calls so continuation history remains provider-valid.
- Tool-result refs: offload writes now persist a metadata sidecar with run/session/request/workspace-run/tool-call identity. Reads enforce that scope unless an explicit `tool_result_ref_read` capability targets the ref.
- Provider tool-call ids: `onToolCall`/`onToolResult` now carry a typed event with `toolCallId`, scope ids, and offload ref details. Chat status, trajectory evidence, workspace-run ledger events, and run graph projection preserve the provider id.
- Workflow lifecycle: starting a new phase closes previous running phases, phase metadata is stored at creation, active phases terminalize on completion/error, and deadline/abort timers are cleared in `finally`.
- v2.5.0 follow-ups: added `SkillExecutionService` snapshots from the shared contract; episode exports optionally include `chat-trajectory.jsonl` and `workspace-run-events.jsonl`, and run graph can project workspace-run tool events.

## Residual Risk

- Scoped refs written before this change have no metadata sidecar and remain readable by legacy behavior.
- Explicit cross-run ref capabilities are modeled at the store boundary; a richer grant lifecycle can be layered on top later without changing the stored ref metadata.
