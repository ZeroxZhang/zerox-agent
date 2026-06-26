# Task 2 Report: Main-Process Assembly, Streaming, And Persistence

## Status

DONE_WITH_CONCERNS

## Scope

- Created `src/main/chatOutputAssembler.ts`.
- Updated `src/main/chatService.ts` to assemble streamed output parts, emit sequence-stable renderer stream events, and emit one terminal stream event per completed/failed/canceled request path touched by this task.
- Updated `src/main/chatSessionStore.ts` to accept and reload persisted assistant `outputParts`.
- Updated `src/main/chatService.test.ts` for RED/GREEN coverage around `output_part`, terminal `finalMessageId`, and persisted `outputParts`.
- Updated adjacent compile-only test `src/renderer/chatStreamReducer.test.ts` because the required `ChatStreamEvent` metadata now includes `sequence` and `turnId`.

## RED Evidence

- `npm test -- src/main/chatService.test.ts src/main/agentLoop.test.ts`
  - Failed in `chat service > emits sequence-stable output parts and completes with the persisted assistant message id`.
  - Failure: streamed events had `sequence === undefined` instead of stable incrementing values, confirming the main-process metadata/output-part wiring was missing.

## Implementation Notes

- Added a small main-process output assembler that:
  - accumulates contiguous streamed text into `text` parts;
  - accumulates tool preview argument chunks per `toolCallId`;
  - masks preview secrets through `maskPreviewSecrets`.
- Extended the chat status emitter so every renderer-facing stream event now carries:
  - `sessionId`
  - `requestId`
  - `sequence`
  - `turnId`
  - `createdAt`
  - `assistantMessageId` when known
- Preserved legacy renderer events:
  - `answer_delta`
  - `thinking_delta`
  - `tool_call_preview`
- Added new renderer-facing `output_part` events alongside the legacy deltas.
- Persisted assistant `outputParts` while keeping legacy `content` unchanged.
- Added terminal `completed` / `failed` / `canceled` events with `finalMessageId` when an assistant message was persisted.
- Kept authorization and workspace sandbox behavior unchanged.

## GREEN Evidence

- `npm test -- src/main/chatService.test.ts src/main/agentLoop.test.ts`
  - 2 files / 78 tests passed.
- `npm test -- src/main/chatService.test.ts -t "emits sequence-stable output parts and completes with the persisted assistant message id"`
  - 1 test passed.
- `npm test -- src/renderer/chatStreamReducer.test.ts`
  - 1 file / 5 tests passed.

## Verification Evidence

- `npm run harness:check`
  - passed.
- `git diff --check`
  - passed.
- `npm run build`
  - passed.
- `npm run smoke:prod`
  - passed; production renderer rendered agent chat UI.
  - Existing local `better-sqlite3` ABI mismatch warning appeared and the app fell back to JSON storage during smoke, but startup verification still passed.
- `npm run verify`
  - failed in `src/shared/packageScripts.test.ts > keeps release gates done through v2.8.5`.
  - Cause: repo release metadata still expects every feature to be `done` for `2.8.5`, while `P23-v2.9.0-output-rendering` is intentionally present and still `planned`.
  - This blocker is outside Task 2’s write scope and not caused by the main-process streaming/persistence changes.

## Changed Files

- `src/main/chatOutputAssembler.ts`
- `src/main/chatService.ts`
- `src/main/chatSessionStore.ts`
- `src/main/chatService.test.ts`
- `src/renderer/chatStreamReducer.test.ts`
- `.zerox/progress.md`

## Concerns

- Full `npm run verify` remains red because of the repo-level `v2.8.5` package/feature-list gate, not because of Task 2 behavior.
- The user task asked not to edit renderer runtime files; only the adjacent renderer test helper was adjusted so the required shared stream metadata compiles under `build` / `smoke:prod`.
