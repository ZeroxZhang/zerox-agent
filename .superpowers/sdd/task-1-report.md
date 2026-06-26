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
