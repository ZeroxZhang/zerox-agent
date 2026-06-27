# Task 1 Report: Shared Output Contract for Zerox Agent 2.9.0 Output Rendering

Status: DONE

Scope:
- Implemented only the shared output contract and chat stream contract updates required by Task 1.
- Kept production changes limited to shared contracts/helpers.
- Preserved `ChatMessageRecord.content` as the backward-compatible plain-text field.

Changed files:
- `src/shared/chat.ts`
- `src/shared/chatStream.test.ts`
- `src/shared/chatOutput.ts`
- `src/shared/chatOutput.test.ts`
- `.zerox/progress.md`

RED evidence:
- `npm test -- src/shared/chatOutput.test.ts src/shared/chatStream.test.ts` -> failed before implementation because `src/shared/chatOutput.ts` did not exist (`Cannot find module './chatOutput'`), while the updated stream contract test already compiled against the stricter metadata shape.

GREEN evidence:
- `npm test -- src/shared/chatOutput.test.ts src/shared/chatStream.test.ts` -> 2 files / 8 tests passed.
- `npm run harness:check` -> passed.
- `git diff --check` -> passed.

Implementation notes:
- Added the shared `ChatOutputPart` union for evidence-linked answer and run-ledger answer rendering primitives, including tables, code, diffs, terminal output, tool previews/results, citations, file references, artifacts, approvals, guided input, diagnostics, and ledger rows.
- Added `maskPreviewSecrets(value: unknown): unknown` with the required ASCII secret mask string `****`.
- Added `outputPartsToPlainText(parts)` so structured parts still have a plain-text fallback for existing transcript surfaces.
- Extended `ChatMessageRecord` with optional `outputParts` while keeping `content: string` intact.
- Extended `ChatStreamEvent` with `sequence`, `turnId`, optional `assistantMessageId`, a typed `output_part` event, and terminal `finalMessageId`.

Self-review:
- Confirmed the diff stayed within shared contracts/tests plus required reporting files.
- Did not modify or stage unrelated untracked root reference files.

Deferred by task scope:
- `npm run verify` and `npm run smoke:prod` were not run in this task slice because the brief requires focused verification plus `npm run harness:check` for the implementation slice, and reserves full verify/smoke for release claims.

## 2026-06-26 Fix Round After Review

Status: DONE

Reviewer findings addressed:
- Critical: extended `outputPartsToPlainText()` fallback coverage to include tool call/result JSON previews, file refs, artifacts, approvals, and guided input, alongside the existing diff/diagnostic coverage.
- Important: added a named shared `ChatOutputStreamEvent` type while keeping `ChatStreamEvent` as the broader union.
- Important: expanded contract tests to assert fallback coverage for diffs, tool previews/results, file refs, artifacts, approvals, guided input, and diagnostics.
- Minor: kept `maskPreviewSecrets()` scoped by preserving `Date`, `Error`, `Map`, and `Set` instances instead of flattening them.

RED evidence:
- `npm test -- src/shared/chatOutput.test.ts src/shared/chatStream.test.ts` -> failed as expected before the fix:
  - fallback output omitted tool/file/artifact/approval/input parts (`expected ... to contain "Tool call: file_read"`),
  - `maskPreviewSecrets()` flattened `Date` objects to `{}` (`expected {} to be 2026-06-26T00:00:00.000Z`).

GREEN evidence:
- `npm test -- src/shared/chatOutput.test.ts src/shared/chatStream.test.ts` -> 2 files / 11 tests passed.
- `npm run harness:check` -> passed.
- `git diff --check` -> passed.

Fix notes:
- Added human-readable fallback text for `tool_call`, `tool_result`, `file_ref`, `artifact`, `approval_request`, and `input_request`.
- Reused `maskPreviewSecrets()` in fallback JSON rendering so previews keep the required ASCII `****` masking.
- Exported `ChatOutputStreamEvent` and reused it inside `ChatStreamEvent`.
