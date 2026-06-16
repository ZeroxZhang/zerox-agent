# Rule Based Permission Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add P8.4 rule-based allow/deny/ask permission evaluation for unattended runs while keeping `ToolAuthorizationService` as the only authorization boundary.

**Architecture:** Add a kernel `permissionEngine` that derives human-readable commands from tool calls, matches wildcard rules, and returns allow/deny/ask decisions. Integrate only allow/deny decisions inside `ToolAuthorizationService` so every decision still writes the existing audit event. Ask/default continues through the existing task-policy and approval flow.

**Tech Stack:** TypeScript, Vitest, existing `ToolCallRequest`, existing tool audit log and authorization service.

---

## File Structure

- Create `src/main/kernel/permissionEngine.ts`
  - `evaluatePermission`, wildcard matcher, shell command tokenizer, arity prefix helper.
- Create `src/main/kernel/permissionEngine.test.ts`
  - Rule matching, default ask, last matching rule wins, shell arity, and deny pattern tests.
- Modify `src/main/toolAuthorizationService.ts`
  - Accept optional `permissionRules`; apply allow/deny inside service before task-policy fallback.
- Modify `src/main/toolAuthorizationService.test.ts`
  - Verify rule allow and deny decisions write audit events and default ask keeps existing approval behavior.
- Modify `.zerox/feature_list.json`
  - Add P8.4 plan/test files and mark P8.4 done after verification.
- Modify `.zerox/progress.md`
  - Record changed files and command evidence.

## Task 1: Permission Engine

- [ ] **Step 1: Write failing tests**

Add `src/main/kernel/permissionEngine.test.ts` asserting:

- `npm run verify -- --watch` derives `npm run verify`.
- `git status --short` matches `git * = allow`.
- `rm -rf /tmp/cache` matches `rm -rf * = deny`.
- no matching rule returns ask.
- later matching rule wins.

- [ ] **Step 2: Run RED**

Run: `npm test -- src/main/kernel/permissionEngine.test.ts`

Expected: FAIL because `permissionEngine.ts` does not exist.

- [ ] **Step 3: Implement engine**

Create the engine with no side effects. Use wildcard `*` matching and a small arity table for common commands.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- src/main/kernel/permissionEngine.test.ts`

Expected: PASS.

## Task 2: Authorization Service Integration

- [ ] **Step 1: Write failing tests**

Extend `src/main/toolAuthorizationService.test.ts` asserting:

- rule allow authorizes shell command and writes an audit event.
- rule deny rejects shell command and writes an audit event.
- no matching rule still uses existing approval behavior.

- [ ] **Step 2: Run RED**

Run: `npm test -- src/main/toolAuthorizationService.test.ts`

Expected: FAIL because service does not accept permission rules yet.

- [ ] **Step 3: Implement integration**

Add optional `permissionRules` to `createToolAuthorizationService`. Apply only allow/deny before policy fallback and include matched rule plus derived command in the decision reason.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- src/main/kernel/permissionEngine.test.ts src/main/toolAuthorizationService.test.ts`

Expected: PASS.

## Task 3: Feature Evidence And Verification

- [ ] **Step 1: Update feature metadata**

Add P8.4 plan/test files to `.zerox/feature_list.json`; mark P8.4 `done` only after verification passes.

- [ ] **Step 2: Record progress**

Append changed files and command evidence to `.zerox/progress.md`.

- [ ] **Step 3: Run required checks**

Run:

```bash
npm test -- src/main/kernel/permissionEngine.test.ts src/main/toolAuthorizationService.test.ts src/shared/toolPermissions.test.ts src/shared/toolApproval.test.ts src/main/toolApprovalCoordinator.test.ts
npm run build
npm run verify
npm run harness:check
npm run smoke:prod
git diff --check
```

Expected: all pass. `npm run smoke:prod` is required because P8.4 affects authorization behavior used by the runtime.
