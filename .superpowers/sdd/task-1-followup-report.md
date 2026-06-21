# Task 1 Follow-up Report: Relative Shell Path Escapes

Status: DONE

Changed files:
- `src/shared/toolPermissions.ts`
- `src/shared/toolPermissions.test.ts`
- `src/main/agentToolExecutor.test.ts`

RED evidence:
- `npm test -- src/shared/toolPermissions.test.ts src/main/agentToolExecutor.test.ts` -> failed before implementation: `authorizeToolCallWithinRunContext(...)` allowed `cat ../outside/secret.txt` under an approved template, and executor-side `shell_exec` ran from the workspace cwd and returned `stdout: "outside secret"`.

GREEN evidence:
- `npm test -- src/shared/toolPermissions.test.ts src/main/agentToolExecutor.test.ts` -> 2 files / 70 tests passed.
- `npm run harness:check` -> passed.
- `npm test` -> 164 files / 1030 tests passed.

Implementation notes:
- Extended `extractPathLikeShellTokens()` path classification to include relative path-shaped shell tokens such as `..`, `../x`, `./x`, and slash-containing relative paths.
- Reused the existing run-context path boundary checks in authorization and executor guards; no bypasses or new execution paths were added.
- Quoted tokens continue to be unquoted by the existing tokenizer before classification, so quoted relative path escapes flow through the same boundary checks.
