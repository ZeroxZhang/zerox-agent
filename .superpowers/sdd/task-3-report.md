# Task 3 Report: Provider Timeout And Observability Durability

## Status

DONE

## Changed Files

- `src/main/fetchWithTimeout.ts`
- `src/main/openAiCompatibleClient.ts`
- `src/main/providers/providerFactory.ts`
- `src/main/providers/anthropicProvider.ts`
- `src/main/providers/geminiProvider.ts`
- `src/main/agentRunStore.ts`
- `src/main/agentTrajectoryStore.ts`
- `src/main/providers/providers.test.ts`
- `src/main/modelRetry.test.ts`
- `src/main/storage/storeProxy.test.ts`
- `.zerox/progress.md`

## RED Evidence

- `npm test -- src/main/providers/providers.test.ts src/main/modelRetry.test.ts`
  - Failed as expected.
  - Anthropic and Gemini never-settling fetch tests reported `expected 'pending' to be 'rejected'`.
  - Native-provider retry classification tests also reported `expected 'pending' to be 'rejected'`.
- `npm test -- src/main/storage/storeProxy.test.ts`
  - Failed as expected.
  - Dual run and trajectory tests reported `flushShadowWrites is not a function`.

## GREEN Evidence

- `npm test -- src/main/providers/providers.test.ts src/main/modelRetry.test.ts`
  - 2 files / 23 tests passed.
- `npm test -- src/main/storage/storeProxy.test.ts src/main/agentTrajectoryStore.test.ts src/main/agentRunStore.test.ts`
  - 3 files / 26 tests passed.
- `npm test`
  - 164 files / 1051 tests passed.
- `npm run build`
  - Passed.
- `npm run harness:check`
  - Passed.
- `npm run verify`
  - 164 files / 1051 tests passed; build passed; agent eval 26/26; memory eval 2/2.
- `npm run smoke:prod`
  - Passed; renderer rendered agent chat UI. SQLite native module ABI mismatch fell back to JSON as expected in this environment.

## Implementation Notes

- Moved the OpenAI-compatible timeout behavior into `src/main/fetchWithTimeout.ts`.
- The shared helper races fetch against a local timeout, aborts the underlying request, respects external abort signals, and still settles even if an injected fetch never resolves.
- Anthropic and Gemini complete, stream, and token-count HTTP calls now use the shared helper with the same default timeout as OpenAI-compatible calls.
- `createProvider()` now forwards `timeoutMs` to native providers.
- Dual-mode `agentRunStore` and `agentTrajectoryStore` keep the SQLite hot path synchronous and track JSON shadow writes in a drainable promise set.
- JSON and SQLite-only stores expose no-op `flushShadowWrites()` for a stable caller/test contract.

## Residual Risk

- `flushShadowWrites()` drains writes already queued when it is called. Callers that append concurrently while draining should call it after they have stopped enqueueing shutdown-critical writes.
- The shared timeout aborts ignored fetches and settles the caller promise, but a custom fetch implementation that ignores `AbortSignal` may continue doing background work outside the returned promise.
