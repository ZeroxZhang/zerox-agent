# Task 1 Follow-up 2 Report: Bare Parent ShellPlan Paths

Status: DONE

Changed files:
- `src/main/tools/shell/shellAnalyzer.ts`
- `src/main/tools/shell/shellAnalyzer.test.ts`
- `src/main/toolAuthorizationService.test.ts`

RED evidence:
- `npm test -- src/main/tools/shell/shellAnalyzer.test.ts src/shared/toolPermissions.test.ts` -> failed before implementation: `analyzeShell("cat ..")`, `ls ..`, and quoted `..` commands returned no touched paths, and run-context authorization approved `cat ..` when given that empty `ShellPlan`.

GREEN evidence:
- `npm test -- src/main/tools/shell/shellAnalyzer.test.ts src/shared/toolPermissions.test.ts` -> 2 files / 52 tests passed.
- `npm test -- src/main/tools/shell/shellAnalyzer.test.ts src/shared/toolPermissions.test.ts src/main/toolAuthorizationService.test.ts` -> 3 files / 63 tests passed.
- `npm run harness:check` -> passed.
- `npm test` -> 164 files / 1035 tests passed.
- `npm run build` -> passed.

Implementation notes:
- Extended shell path classification to treat exactly bare `..` as path-like, after quote stripping, so `ShellPlan.touchedPaths` includes the resolved parent directory for `cat ..`, `ls ..`, and quoted variants.
- Kept arbitrary bare words unclassified as paths; existing slash, home-relative, absolute, and extension-like path detection is unchanged.
- Added a run-context authorization regression using `authorizeToolCallWithinRunContext(..., { shellPlan: analyzeShell("cat ..") })`, covering the production `ToolAuthorizationService` plan path that bypasses the legacy fallback tokenizer.
