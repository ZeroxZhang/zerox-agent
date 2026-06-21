# Task 1 Report: Workspace Sandbox And Tool Permission Hardening

Status: DONE

Changed files:
- `src/shared/locationResource.ts`
- `src/shared/agentWorkspace.ts`
- `src/shared/toolPermissions.ts`
- `src/main/agentToolExecutor.ts`
- `src/main/localFileOrganizer.ts`
- `src/main/nativeResearchTools.ts`
- `src/shared/agentWorkspace.test.ts`
- `src/shared/toolPermissions.test.ts`
- `src/main/agentToolExecutor.test.ts`
- `src/main/localFileOrganizer.test.ts`
- `src/main/nativeResearchTools.test.ts`

RED evidence:
- `npm test -- src/main/agentToolExecutor.test.ts src/shared/toolPermissions.test.ts src/main/nativeResearchTools.test.ts` -> failed before implementation: symlink escapes were authorized/executed and `markdown_report_write` wrote through a symlinked parent.
- `npm test -- src/main/agentToolExecutor.test.ts src/main/localFileOrganizer.test.ts src/shared/toolPermissions.test.ts` -> failed before implementation: crafted apply/rollback move objects were accepted and renamed outside-root files.
- `npm test -- src/shared/agentWorkspace.test.ts src/shared/toolPermissions.test.ts src/main/chatService.test.ts src/main/agentToolExecutor.test.ts` -> failed before implementation: read-only contexts still modeled workspace write access, approved shell templates allowed outside absolute paths, and `chrome_bookmarks_read` was allowed in read-only runs.

GREEN evidence:
- `npm test -- src/shared/agentWorkspace.test.ts src/shared/toolPermissions.test.ts src/main/agentToolExecutor.test.ts src/main/localFileOrganizer.test.ts src/main/nativeResearchTools.test.ts src/main/chatService.test.ts` -> 6 files / 112 tests passed.
- `npm test` -> 164 files / 1028 tests passed.
- `npm run build` -> passed.
- `npm run harness:check` -> passed.

Implementation notes:
- Added a shared path-boundary primitive that normalizes location aliases, rejects existing symlink path segments, resolves real targets when available, and verifies resolved paths remain inside allowed roots.
- Wired the primitive into run-context path checks, task authorization, executor-side guards, organizer move validation, and native Markdown report writes.
- Treats generated move plans/transactions as capabilities by validating `root`, `moves[].from`, `moves[].to`, and transaction logs before rename.
- Denies writable tools, including Chrome bookmark artifact writes, in read-only run contexts.
