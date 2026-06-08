# Tool Result Offload P2 Implementation Plan

## Goal

Prevent oversized tool results from being injected verbatim into subsequent model turns. Preserve the full result locally behind a stable reference, while giving the model a compact observation with enough metadata to continue reasoning.

## Scope

- Add a local tool-result reference store under the app config directory.
- Add an async serializer that offloads large successful tool observations.
- Wire offload into the chat agent loop, recoverable runtime engine, and legacy runner fallback.
- Record enough metadata for checkpoint and trajectory inspection.
- Keep user-visible behavior unchanged for small results and failed tool calls.

## Non-Goals

- No new UI browser for offloaded refs in this iteration.
- No automatic rehydration into future prompts.
- No semantic compression of large files beyond a compact metadata summary.

## Implementation Steps

1. Create failing tests for `ToolResultOffloadStore`.
   - Writes full serialized tool observations to `tool-result-refs/*.json`.
   - Returns stable relative refs and byte counts.
   - Can read a stored ref back.

2. Create failing tests for the offload serializer.
   - Small observations preserve the existing JSON format.
   - Large successful observations write the original full JSON to the store.
   - The model-facing JSON includes `offloaded`, `result_ref`, `original_chars`, `summary`, and `tool_call_id`.
   - Failed observations remain inline.

3. Implement `src/main/toolResultOffloadStore.ts`.
   - Use `fs/promises`, `path`, and an injectable id factory.
   - Keep refs relative to the config dir.
   - Sanitize generated ids for filenames.

4. Implement `src/main/toolObservationOffload.ts`.
   - Wrap `serializeToolObservation`.
   - Threshold default: 12000 characters.
   - Produce compact, JSON-parseable observations.

5. Wire runtime entry points.
   - `runAgentLoop` gets optional `toolResultOffloadStore` and `toolResultOffloadThreshold`.
   - `createAgentRuntimeEngine` gets the same options and annotates trajectory metadata.
   - `createAgentRunnerService` passes the options to the recoverable engine and uses them in fallback execution.
   - `main.ts` creates one store singleton and injects it into chat and runner services.

6. Verify.
   - Add integration tests proving the next model request receives compact refs.
   - Run `npm test`.
   - Run `npm run build`.
   - Commit the P2 changes only after verification passes.

## Acceptance Criteria

- Large tool results no longer appear verbatim in the next model request.
- Full original tool observation remains readable from a local ref file.
- Existing small-result behavior remains backward compatible.
- Recoverable checkpoints store compact tool messages, reducing replay context pressure.
