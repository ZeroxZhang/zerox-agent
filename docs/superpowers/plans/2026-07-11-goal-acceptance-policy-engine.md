# Goal Acceptance Policy Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a backward-compatible protocol-v2 Goal acceptance engine with typed validators, bounded structural evidence, stable failure fingerprints, targeted repair, truthful blocked states, mandatory final semantic judgment, and durable completion certificates.

**Architecture:** Keep `AgentGoalController` as the durable state-machine orchestrator, but move validation dispatch, evidence construction, failure identity, repair decisions, and certificate integrity into focused modules. Every protocol-v2 transition continues from the canonical Goal returned by the store; deterministic facts precede model judgment; repeated unchanged failures are repaired in place and then stopped instead of silently replanning.

**Tech Stack:** TypeScript 5, Electron main/renderer, React, Vitest, Node `crypto`/`fs`, existing JSON Goal store, existing `AgentToolExecutor`, `ToolAuthorizationService`, and location-resource boundary utilities.

## Global Constraints

- Historical Goal JSON must remain readable without manual migration.
- New and explicitly resumed nonterminal goals use acceptance protocol v2.
- A protocol-v2 Goal cannot become `achieved` without a valid certificate in the same atomic Goal save.
- No validator may bypass `ToolAuthorizationService`, `AgentToolExecutor`, provenance checks, or symlink-aware authorized roots.
- Judge failure, invalid JSON, timeout, or missing validator registration must never produce `achieved`.
- Same-milestone repair does not increment `planVersion` or `budgetUsage.replans`.
- Only `replan_required` may invoke `AgentGoalPlanner.replan` automatically.
- Keep at most 20 recent failure records in Goal JSON; ledger and trajectory remain append-only evidence.
- Preserve unrelated dirty-worktree changes, including the existing `.gitignore` and user-owned untracked files.
- Every production behavior follows a witnessed RED → GREEN test cycle.

---

## File Responsibility Map

- `src/shared/agentGoal.ts`: protocol-v2 shared data contract, transitions, normalization-compatible optional fields.
- `src/main/agentGoalValidatorRegistry.ts`: validator registration, governed dispatch, missing-kind and timeout conversion.
- `src/main/agentGoalEvidenceManifest.ts`: authorized artifact resolution, adapters, hashing, bounded rendering.
- `src/main/agentGoalFailureFingerprint.ts`: stable failure and tool-action signatures.
- `src/main/agentGoalRepairPolicy.ts`: deterministic verdict/occurrence decision table and bounded failure history.
- `src/main/agentGoalAcceptanceCertificate.ts`: criteria/certificate hashing, creation, integrity verification.
- `src/main/agentGoalAcceptance.ts`: orchestration of deterministic checks, evidence, model review, and typed results.
- `src/main/agentGoalController.ts`: execution sequencing and application of repair/replan/block/certify decisions.
- `src/main/agentGoalStore.ts`: legacy normalization and v2 achieved-certificate invariant.
- `src/main/goalChatService.ts`: protocol upgrade on start/resume/retry and blocked recovery operations.
- `src/main/container.ts`: production dependency wiring and canonical progress projection.
- `src/renderer/goalProgressViewModel.ts`: acceptance/repair/blocked/certificate presentation model.
- `src/renderer/components/GoalDetailDrawer.tsx`: detailed decision and certificate view.
- `src/renderer/components/GoalStatusStrip.tsx`: compact acceptance state and recovery actions.
- `src/renderer/components/AgentChatPanel.tsx`: IPC-driven retry-acceptance, adjust-plan, and certificate refresh.

---

### Task 1: Protocol-v2 Shared Contract and Legacy Compatibility

**Files:**
- Modify: `src/shared/agentGoal.ts`
- Modify: `src/shared/agentGoal.test.ts`

**Interfaces:**
- Produces: `GoalAcceptanceProtocolVersion`, `AcceptanceVerdict`, `AcceptanceFailureClass`, `GoalAcceptanceCheckResult`, `AcceptanceRepairDirective`, `GoalAcceptanceFailureRecord`, `GoalAcceptanceState`, `GoalEvidenceManifest`, `GoalAcceptanceCertificate`, `upgradeGoalAcceptanceProtocol(goal)`.
- Consumes: existing `Goal`, `GoalStatus`, `StopReason`, `AcceptanceCheckKind`, and transition validation.

- [ ] **Step 1: Write failing shared-contract tests**

Add tests that construct a legacy Goal with no acceptance fields, call the wished-for upgrade helper, and assert the returned copy has protocol v2 with bounded empty state while the input remains unchanged. Add transition tests for `stopped_blocked → executing|canceled`, and type/runtime validation tests that reject protocol-v2 achieved Goals without a certificate.

```ts
it("upgrades a legacy nonterminal goal without mutating the stored input", () => {
  const legacy = createGoal({ status: "executing" })
  const upgraded = upgradeGoalAcceptanceProtocol(legacy)
  expect(legacy.acceptanceProtocolVersion).toBeUndefined()
  expect(upgraded.acceptanceProtocolVersion).toBe(2)
  expect(upgraded.acceptanceState).toMatchObject({ protocolVersion: 2, phase: "idle", attempt: 0, recentFailures: [] })
})

it("requires a certificate for a protocol-v2 achieved goal", () => {
  expect(() => validateGoal(createGoal({ status: "achieved", acceptanceProtocolVersion: 2 }))).toThrow(/certificate/i)
})
```

- [ ] **Step 2: Run the shared tests and witness RED**

Run: `npm test -- --run src/shared/agentGoal.test.ts`

Expected: FAIL because `upgradeGoalAcceptanceProtocol`, protocol-v2 types, and `stopped_blocked` do not exist.

- [ ] **Step 3: Implement the shared protocol contract**

Add the exact shared discriminants from the design and make new Goal fields optional for v1 compatibility. Extend the status transition table and validation:

```ts
export type BuiltinAcceptanceCheckKind = "file_exists" | "command_exit_code" | "test_passes" | "assertion" | "model_review"
export type AcceptanceCheckKind = BuiltinAcceptanceCheckKind | `validator:${string}`
export type GoalAcceptanceProtocolVersion = 1 | 2
export type AcceptanceVerdict = "accepted" | "rejected_repairable" | "replan_required" | "blocked_external" | "impossible" | "acceptance_unavailable"

export function upgradeGoalAcceptanceProtocol(goal: Goal): Goal {
  if (goal.acceptanceProtocolVersion === 2 && goal.acceptanceState) return goal
  return {
    ...goal,
    acceptanceProtocolVersion: 2,
    acceptanceState: { protocolVersion: 2, phase: "idle", attempt: 0, recentFailures: [] },
  }
}
```

Keep protocol-v2 certificate structural validation separate from cryptographic verification; Task 5 supplies the latter.

- [ ] **Step 4: Run shared tests and witness GREEN**

Run: `npm test -- --run src/shared/agentGoal.test.ts`

Expected: all shared Goal tests pass.

- [ ] **Step 5: Commit the shared contract**

```bash
git add src/shared/agentGoal.ts src/shared/agentGoal.test.ts
git commit -m "feat: add goal acceptance protocol v2 contract"
```

---

### Task 2: Governed Validator Registry

**Files:**
- Create: `src/main/agentGoalValidatorRegistry.ts`
- Create: `src/main/agentGoalValidatorRegistry.test.ts`
- Modify: `src/main/agentGoalAcceptance.ts`

**Interfaces:**
- Consumes: `AcceptanceCheck`, `AcceptanceCheckKind`, `GoalAcceptanceCheckResult`, and `AcceptanceContext`.
- Produces: `AcceptanceValidator`, `AcceptanceValidatorInput`, `AgentGoalValidatorRegistry`, `createAgentGoalValidatorRegistry({ validators?, timeoutMs? })`.

- [ ] **Step 1: Write failing registry tests**

Cover successful dispatch, deterministic duplicate-registration rejection, `validator:<name>` dispatch, missing-kind conversion, timeout conversion, and preservation of the governed context object.

```ts
it("turns an unavailable custom validator into a typed blocked result", async () => {
  const registry = createAgentGoalValidatorRegistry({ timeoutMs: 20 })
  await expect(registry.evaluate(customCheck("validator:local/report"), context())).resolves.toMatchObject({
    passed: false,
    code: "validator_not_registered",
    failureClass: "validator_unavailable",
  })
})

it("times out instead of allowing a validator to trap acceptance", async () => {
  const registry = createAgentGoalValidatorRegistry({ validators: [neverValidator], timeoutMs: 5 })
  await expect(registry.evaluate(customCheck(neverValidator.kind), context())).resolves.toMatchObject({
    code: "validator_timeout",
    failureClass: "validator_unavailable",
  })
})
```

- [ ] **Step 2: Run registry tests and witness RED**

Run: `npm test -- --run src/main/agentGoalValidatorRegistry.test.ts`

Expected: FAIL because the registry module does not exist.

- [ ] **Step 3: Implement registry dispatch and timeout**

Use a `Map<AcceptanceCheckKind, AcceptanceValidator>`, reject duplicate kinds, and convert infrastructure failures without exposing exception payloads:

```ts
export type AcceptanceValidator = {
  kind: AcceptanceCheckKind
  evaluate(input: AcceptanceValidatorInput): Promise<GoalAcceptanceCheckResult>
}

export function createAgentGoalValidatorRegistry(options: RegistryOptions = {}): AgentGoalValidatorRegistry {
  const validators = new Map(options.validators?.map((validator) => [validator.kind, validator]) ?? [])
  return {
    register(validator) {
      if (validators.has(validator.kind)) throw new Error(`Acceptance validator already registered: ${validator.kind}`)
      validators.set(validator.kind, validator)
    },
    async evaluate(check, context) {
      const validator = validators.get(check.kind)
      if (!validator) return unavailableResult(check, "validator_not_registered")
      return withValidatorTimeout(validator.evaluate({ check, context }), options.timeoutMs ?? 30_000, check)
    },
    listKinds: () => [...validators.keys()],
  }
}
```

- [ ] **Step 4: Run registry tests and the existing acceptance suite**

Run: `npm test -- --run src/main/agentGoalValidatorRegistry.test.ts src/main/agentGoalAcceptance.test.ts`

Expected: registry tests pass and existing acceptance behavior remains green.

- [ ] **Step 5: Commit the validator registry**

```bash
git add src/main/agentGoalValidatorRegistry.ts src/main/agentGoalValidatorRegistry.test.ts src/main/agentGoalAcceptance.ts
git commit -m "feat: add governed goal validator registry"
```

---

### Task 3: Structural Evidence Manifest and Artifact Adapters

**Files:**
- Create: `src/main/agentGoalEvidenceManifest.ts`
- Create: `src/main/agentGoalEvidenceManifest.test.ts`
- Modify: `src/main/agentGoalAcceptance.ts`
- Modify: `src/main/agentGoalAcceptance.test.ts`

**Interfaces:**
- Consumes: acceptance authorized roots/location environment, artifact refs, success-criterion text, and provenance verification results.
- Produces: `buildGoalEvidenceManifest(input): Promise<GoalEvidenceManifest>` and `renderGoalEvidenceManifest(manifest, maxChars = 12_000): string`.

- [ ] **Step 1: Write failing adapter tests with real temporary files**

Create real Markdown, JSON, CSV, text, PNG-header, and binary fixtures. Assert SHA256/bytes, Markdown heading lines beyond the first 4,000 characters, JSON keys, table shape, image dimensions, generic metadata, criterion-relevant excerpts, symlink rejection, and the 12,000-character cap.

```ts
it("preserves the full heading tree for a large markdown artifact", async () => {
  await writeFile(report, `# Start\n${"body\n".repeat(1500)}\n# Final conclusion\naccepted evidence`)
  const manifest = await buildGoalEvidenceManifest(input({ refs: [`artifact:${report}`], criterionText: "Final conclusion" }))
  expect(manifest.artifacts[0]).toMatchObject({ lineCount: 1504, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) })
  expect(manifest.artifacts[0]?.headings).toContainEqual(expect.objectContaining({ text: "Final conclusion" }))
  expect(renderGoalEvidenceManifest(manifest).length).toBeLessThanOrEqual(12_000)
})
```

- [ ] **Step 2: Run evidence tests and witness RED**

Run: `npm test -- --run src/main/agentGoalEvidenceManifest.test.ts`

Expected: FAIL because the evidence-manifest module does not exist.

- [ ] **Step 3: Implement authorized adapters**

Resolve every file through `validatePathInsideLocationRoots` before `stat`, hashing, or reading. Stream SHA256, cap decoded text reads, parse structural metadata, rank excerpts by criterion terms, and render metadata before excerpts:

```ts
export async function buildGoalEvidenceManifest(input: BuildManifestInput): Promise<GoalEvidenceManifest> {
  const artifacts = await Promise.all(input.refs.map((ref) => buildArtifact(ref, input)))
  const complete = { version: 1 as const, generatedAt: input.now(), artifacts: artifacts.filter(isPresent), totalRenderedChars: 0, truncated: false }
  return applyRenderedBudget(complete, input.maxRenderedChars ?? 12_000)
}
```

PNG dimensions come from the IHDR header; JPEG dimensions come from SOF markers. Unsupported/corrupt images retain hash/MIME/size without dimensions and do not throw acceptance infrastructure errors.

- [ ] **Step 4: Replace fixed artifact previews in model review**

Build one manifest per criteria evaluation and render it into the judge prompt. Keep non-artifact evidence refs as labeled references. Required missing artifact refs still return `artifact_missing` before any model call.

```ts
const evidenceManifest = await buildGoalEvidenceManifest({ refs: evidenceRefs, criterionText, ...context })
const evidenceLines = renderGoalEvidenceManifest(evidenceManifest).split("\n")
```

- [ ] **Step 5: Run evidence and acceptance suites**

Run: `npm test -- --run src/main/agentGoalEvidenceManifest.test.ts src/main/agentGoalAcceptance.test.ts`

Expected: all tests pass, including outside-root and parent/leaf symlink regressions.

- [ ] **Step 6: Commit structural evidence**

```bash
git add src/main/agentGoalEvidenceManifest.ts src/main/agentGoalEvidenceManifest.test.ts src/main/agentGoalAcceptance.ts src/main/agentGoalAcceptance.test.ts
git commit -m "feat: add structural goal evidence manifests"
```

---

### Task 4: Failure Fingerprints and Deterministic Repair Policy

**Files:**
- Create: `src/main/agentGoalFailureFingerprint.ts`
- Create: `src/main/agentGoalFailureFingerprint.test.ts`
- Create: `src/main/agentGoalRepairPolicy.ts`
- Create: `src/main/agentGoalRepairPolicy.test.ts`

**Interfaces:**
- Consumes: failed `GoalAcceptanceCheckResult[]`, evidence manifest, target identity, recent tool actions, recent failure history, and verdict.
- Produces: `createAcceptanceFailureFingerprint(input)`, `createToolActionSignature(toolName, args)`, `countConsecutiveFingerprint(history, target, fingerprint)`, `decideAcceptanceRepair(input)`, `appendAcceptanceFailure(state, record)`.

- [ ] **Step 1: Write failing stable-fingerprint tests**

Assert recursive key sorting, exclusion of timestamps/free-form details/plan version, inclusion of failed check code/artifact hash/action signature, and secret-redaction stability.

```ts
it("treats reordered tool arguments and changed prose as the same logical failure", () => {
  const left = fingerprintInput({ args: { path: "a", options: { z: 1, a: 2 } }, detail: "first wording", planVersion: 1 })
  const right = fingerprintInput({ args: { options: { a: 2, z: 1 }, path: "a" }, detail: "other wording", planVersion: 99 })
  expect(createAcceptanceFailureFingerprint(left)).toBe(createAcceptanceFailureFingerprint(right))
})
```

- [ ] **Step 2: Write failing repair-policy table tests**

Cover occurrence 1 repair, occurrence 2 alternate strategy, occurrence 3 stop stalled, structural failure replan, external/impossible/unavailable blocked, accepted certify, history cap 20, and changed fingerprint reset.

```ts
it.each([
  ["rejected_repairable", 1, "repair_same_milestone"],
  ["rejected_repairable", 2, "retry_alternate_strategy"],
  ["rejected_repairable", 3, "stop_stalled"],
  ["replan_required", 1, "replan"],
  ["acceptance_unavailable", 1, "stop_blocked"],
] as const)("maps %s occurrence %i to %s", (verdict, occurrence, action) => {
  expect(decideAcceptanceRepair(policyInput({ verdict, occurrence })).action).toBe(action)
})
```

- [ ] **Step 3: Run fingerprint/policy tests and witness RED**

Run: `npm test -- --run src/main/agentGoalFailureFingerprint.test.ts src/main/agentGoalRepairPolicy.test.ts`

Expected: FAIL because both modules are missing.

- [ ] **Step 4: Implement stable hashing and policy**

Use Node SHA256 over recursively sorted JSON. Normalize results to machine-readable fields only. Implement the exact decision table from the spec and preserve actionable instructions:

```ts
export function decideAcceptanceRepair(input: RepairPolicyInput): AcceptanceRepairDirective {
  if (input.verdict === "replan_required") return directive("replan", input)
  if (input.verdict === "blocked_external" || input.verdict === "impossible" || input.verdict === "acceptance_unavailable") return directive("stop_blocked", input)
  if (input.occurrence === 1) return directive("repair_same_milestone", input)
  if (input.occurrence === 2) return directive("retry_alternate_strategy", input)
  return directive("stop_stalled", input)
}
```

- [ ] **Step 5: Run tests and witness GREEN**

Run: `npm test -- --run src/main/agentGoalFailureFingerprint.test.ts src/main/agentGoalRepairPolicy.test.ts`

Expected: all fingerprint and policy tests pass.

- [ ] **Step 6: Commit fingerprint and policy modules**

```bash
git add src/main/agentGoalFailureFingerprint.ts src/main/agentGoalFailureFingerprint.test.ts src/main/agentGoalRepairPolicy.ts src/main/agentGoalRepairPolicy.test.ts
git commit -m "feat: add bounded goal acceptance repair policy"
```

---

### Task 5: Completion Certificate Integrity and Store Invariant

**Files:**
- Create: `src/main/agentGoalAcceptanceCertificate.ts`
- Create: `src/main/agentGoalAcceptanceCertificate.test.ts`
- Modify: `src/main/agentGoalStore.ts`
- Modify: `src/main/agentGoalStore.test.ts`

**Interfaces:**
- Consumes: protocol-v2 Goal, passed check results, evidence manifest, judge metadata, and accepted timestamp.
- Produces: `createGoalCriteriaHash(goal)`, `createGoalAcceptanceCertificate(input)`, `verifyGoalAcceptanceCertificate(goal)`, store rejection of invalid v2 achievement.

- [ ] **Step 1: Write failing certificate tests**

Assert stable criteria hashing across object-key order, certificate hash verification, tamper detection for plan/check/evidence fields, and deterministic run/evidence sorting.

```ts
it("detects a certificate whose evidence hash was modified", () => {
  const certificate = createGoalAcceptanceCertificate(validInput())
  const goal = goalWithCertificate(certificate)
  goal.acceptanceCertificate!.evidence[0]!.sha256 = "0".repeat(64)
  expect(verifyGoalAcceptanceCertificate(goal)).toMatchObject({ ok: false, reason: expect.stringContaining("hash") })
})
```

- [ ] **Step 2: Write failing real-store invariant tests**

Use the real JSON store. Assert v2 achieved without certificate rejects and does not replace executing state; valid certificate and achieved are observed together; legacy achieved without protocol marker remains readable; stale saves cannot remove the certificate.

- [ ] **Step 3: Run certificate/store tests and witness RED**

Run: `npm test -- --run src/main/agentGoalAcceptanceCertificate.test.ts src/main/agentGoalStore.test.ts`

Expected: FAIL because certificate functions and v2 store invariant do not exist.

- [ ] **Step 4: Implement certificate hashing and verification**

Use stable JSON and SHA256, excluding only `certificateHash` from its own digest:

```ts
export function verifyGoalAcceptanceCertificate(goal: Goal): CertificateVerification {
  const certificate = goal.acceptanceCertificate
  if (!certificate) return { ok: false, reason: "Protocol v2 achieved goal requires a certificate." }
  if (certificate.goalId !== goal.id || certificate.planVersion !== goal.planVersion) return { ok: false, reason: "Certificate identity or plan version mismatch." }
  if (certificate.criteriaHash !== createGoalCriteriaHash(goal)) return { ok: false, reason: "Certificate criteria hash mismatch." }
  if (certificate.checkResults.some((result) => !result.passed)) return { ok: false, reason: "Certificate contains a failed check." }
  return verifyCertificateDigest(certificate)
}
```

- [ ] **Step 5: Enforce the invariant inside serialized save**

Before atomic write, reject an incoming protocol-v2 achieved Goal whose certificate verification fails. Preserve existing irreversible-status arbitration and return the canonical existing goal on stale writes.

- [ ] **Step 6: Run certificate/store tests and witness GREEN**

Run: `npm test -- --run src/main/agentGoalAcceptanceCertificate.test.ts src/main/agentGoalStore.test.ts`

Expected: all tests pass.

- [ ] **Step 7: Commit certificate and store invariant**

```bash
git add src/main/agentGoalAcceptanceCertificate.ts src/main/agentGoalAcceptanceCertificate.test.ts src/main/agentGoalStore.ts src/main/agentGoalStore.test.ts
git commit -m "feat: require acceptance certificates for v2 goals"
```

---

### Task 6: Acceptance Service Orchestration and Final Cold Judge

**Files:**
- Modify: `src/main/agentGoalAcceptance.ts`
- Modify: `src/main/agentGoalAcceptance.test.ts`
- Modify: `src/main/container.ts`
- Modify: `src/main/container.test.ts`

**Interfaces:**
- Consumes: validator registry, evidence manifest builder, current Goal/milestone criteria, transcript, model profile.
- Produces: enriched `AcceptanceResult` with verdict/failure class/fingerprint inputs/manifest/judge metadata and a model-review verdict of accepted/rejected/impossible/unavailable.

- [ ] **Step 1: Write failing enriched-result tests**

Cover deterministic aggregation precedence, stable result codes, deterministic failure skipping model review, missing evidence as repairable, missing registry as unavailable, and manifest propagation.

- [ ] **Step 2: Write failing final-judge tests**

Assert model review receives structural evidence including a late Markdown heading, temperature zero, no tools, accepted/rejected/impossible parsing, and provider/timeout/invalid-JSON mapping to `acceptance_unavailable`.

```ts
it("never accepts when the final judge response is invalid", async () => {
  const acceptance = createAgentGoalAcceptance({ chatClient: completing("not-json") })
  await expect(acceptance.evaluateGoal(semanticGoal(), context())).resolves.toMatchObject({
    accepted: false,
    verdict: "acceptance_unavailable",
    failureClass: "judge_unavailable",
  })
})
```

- [ ] **Step 3: Run acceptance/container tests and witness RED**

Run: `npm test -- --run src/main/agentGoalAcceptance.test.ts src/main/container.test.ts`

Expected: FAIL because enriched results, injected registry, and impossible/unavailable semantics are absent.

- [ ] **Step 4: Refactor built-ins behind the registry**

Register the existing deterministic implementations as built-ins without weakening their command/path/provenance controls. Evaluate all deterministic checks, aggregate by fixed precedence, and invoke model validators only when deterministic results all pass.

- [ ] **Step 5: Implement cold-judge result parsing and metadata**

Use a versioned prompt constant and typed parser:

```ts
const GOAL_JUDGE_PROMPT_VERSION = "goal-acceptance-v2"
type JudgeVerdict = { verdict: "accepted" | "rejected" | "impossible"; reason: string; evidenceRefs: string[] }
```

Catch judge infrastructure errors at the acceptance boundary and return a typed unavailable result. Never throw into the Controller’s generic failed path for a normal judge outage.

- [ ] **Step 6: Wire the production registry in the container**

Construct one registry per app container, register built-ins, expose trusted validator injection through an optional `acceptanceValidators` container option, and pass it to acceptance service construction.

- [ ] **Step 7: Run acceptance/container tests and witness GREEN**

Run: `npm test -- --run src/main/agentGoalValidatorRegistry.test.ts src/main/agentGoalEvidenceManifest.test.ts src/main/agentGoalAcceptance.test.ts src/main/container.test.ts`

Expected: all tests pass.

- [ ] **Step 8: Commit acceptance orchestration**

```bash
git add src/main/agentGoalAcceptance.ts src/main/agentGoalAcceptance.test.ts src/main/container.ts src/main/container.test.ts
git commit -m "feat: orchestrate typed goal acceptance and cold judging"
```

---

### Task 7: Controller Targeted Repair, Structural Replan, Blocking, and Certification

**Files:**
- Modify: `src/main/agentGoalController.ts`
- Modify: `src/main/agentGoalController.test.ts`
- Modify: `src/main/goalRuntimeEngine.ts`
- Modify: `src/main/goalRuntimeEngine.test.ts`
- Modify: `src/shared/agentTrajectory.ts`

**Interfaces:**
- Consumes: enriched `AcceptanceResult`, repair policy, fingerprints, certificate creator, protocol-v2 Goal state.
- Produces: bounded repair loop, deterministic final repair milestone, `stopped_blocked`, certificate-backed achievement, new acceptance trajectory events, runtime repair prompt.

- [ ] **Step 1: Write failing controller policy tests**

Add real-store tests for first repair with unchanged plan version, second alternate strategy, third stalled stop, changed fingerprint reset, structural-only replan, blocked mappings, and final repair milestone reuse.

```ts
it("repairs the same milestone twice and stops on a third identical failure without replanning", async () => {
  const result = await controller.start("goal_1")
  expect(result.status).toBe("stopped_stalled")
  expect(result.planVersion).toBe(1)
  expect(plannerCalls).toBe(0)
  expect(result.acceptanceState?.recentFailures.map((failure) => failure.occurrence)).toEqual([1, 2, 3])
})
```

- [ ] **Step 2: Write failing final-certificate and race tests**

Assert final semantic checks always call `evaluateGoal`, protocol-v2 achieved contains a valid certificate, judge unavailable blocks, operational budget wins before repair, and cancellation during manifest/judge/repair/certificate persistence remains canceled with a terminal last progress event.

- [ ] **Step 3: Run controller/runtime tests and witness RED**

Run: `npm test -- --run src/main/agentGoalController.test.ts src/main/goalRuntimeEngine.test.ts`

Expected: FAIL because targeted repair, blocked status, runtime directives, and certificates are not integrated.

- [ ] **Step 4: Add one policy application function**

Replace unconditional rejection replanning with a single helper:

```ts
async function applyAcceptanceDecision(goal: Goal, target: Milestone | null, result: AcceptanceResult): Promise<"continue" | "suspend" | Goal> {
  const fingerprint = createAcceptanceFailureFingerprint(buildFingerprintInput(goal, target, result))
  const occurrence = countConsecutiveFingerprint(goal.acceptanceState?.recentFailures ?? [], targetIdentity(goal, target), fingerprint) + 1
  const directive = decideAcceptanceRepair({ verdict: result.verdict, occurrence, fingerprint, checkResults: result.checkResults })
  return persistAndApplyDirective(goal, target, result, directive)
}
```

Every save must use its returned canonical Goal and stop immediately when cancellation or achievement won concurrently.

- [ ] **Step 5: Implement same-milestone and alternate repair**

Reset the milestone to `ready`, record the directive, emit `acceptance_repair_scheduled` or `acceptance_strategy_changed`, and pass the directive into `runMilestone` options. Add exact runtime prompt text requiring failed checks to be fixed and occurrence 2 to use different tool arguments/strategy.

- [ ] **Step 6: Implement deterministic final repair milestone**

Create/reuse `repair_${fingerprint.slice(0, 12)}` with dependencies on accepted milestones and the failed goal checks. Do not call Planner for this branch.

- [ ] **Step 7: Remove semantic fast-path completion and certify final acceptance**

Always call final `evaluateGoal`. On accepted protocol-v2 result, build the certificate first, set state phase `certified`, and pass the complete Goal to `stopGoal`. The store invariant proves atomicity.

- [ ] **Step 8: Implement blocked stops and trajectory events**

Map external/impossible/unavailable to the exact stop reasons. Add new trajectory-event union members and redacted payloads.

- [ ] **Step 9: Run controller/runtime tests and witness GREEN**

Run: `npm test -- --run src/main/agentGoalController.test.ts src/main/goalRuntimeEngine.test.ts src/main/agentGoalAcceptanceCertificate.test.ts`

Expected: all tests pass.

- [ ] **Step 10: Commit controller policy integration**

```bash
git add src/main/agentGoalController.ts src/main/agentGoalController.test.ts src/main/goalRuntimeEngine.ts src/main/goalRuntimeEngine.test.ts src/shared/agentTrajectory.ts
git commit -m "feat: add bounded targeted goal repair and certification"
```

---

### Task 8: Goal Store Upgrade Paths, Chat Recovery, and Canonical Progress

**Files:**
- Modify: `src/main/agentGoalStore.ts`
- Modify: `src/main/agentGoalStore.test.ts`
- Modify: `src/main/goalChatService.ts`
- Modify: `src/main/goalChatService.test.ts`
- Modify: `src/main/container.ts`
- Modify: `src/main/container.test.ts`
- Modify: `src/shared/chat.ts`

**Interfaces:**
- Consumes: protocol upgrade helper, `stopped_blocked`, repair/certificate progress events.
- Produces: upgrade-on-start/resume/retry, blocked retry, adjust-plan recovery, canonical session summary and progress reconciliation.

- [ ] **Step 1: Write failing compatibility and recovery tests**

Use serialized legacy fixtures, not only in-memory objects. Assert reads do not rewrite, start/resume/retry upgrades nonterminal legacy Goals, terminal legacy achieved remains certificate-free, blocked retry returns executing, and impossible goals require adjustment before retry when their condition is unchanged.

- [ ] **Step 2: Write failing progress-race tests**

Cover stale repair/replan/certificate events arriving after cancellation/achievement and assert both renderer listeners and persisted chat summaries remain terminal.

- [ ] **Step 3: Run store/chat/container tests and witness RED**

Run: `npm test -- --run src/main/agentGoalStore.test.ts src/main/goalChatService.test.ts src/main/container.test.ts`

Expected: FAIL because upgrade/recovery/event variants are missing.

- [ ] **Step 4: Implement upgrade-on-authorized-transition**

Call `upgradeGoalAcceptanceProtocol` only in start/resume/retry paths before saving. Do not normalize v1 terminal records into v2 on read.

- [ ] **Step 5: Add blocked recovery operations**

Reuse existing retry and replan IPC paths with status-aware validation. Clear only recoverable stop reasons and retain failure history so an unchanged retry cannot reset loop detection.

- [ ] **Step 6: Extend canonical progress reconciliation**

Add acceptance event variants and keep serialized delivery. If persisted status is irreversible, convert any stale acceptance event to canonical stopped progress before session sync and listener notification.

- [ ] **Step 7: Run store/chat/container tests and witness GREEN**

Run: `npm test -- --run src/shared/agentGoal.test.ts src/main/agentGoalStore.test.ts src/main/goalChatService.test.ts src/main/container.test.ts`

Expected: all tests pass.

- [ ] **Step 8: Commit migration and recovery integration**

```bash
git add src/main/agentGoalStore.ts src/main/agentGoalStore.test.ts src/main/goalChatService.ts src/main/goalChatService.test.ts src/main/container.ts src/main/container.test.ts src/shared/chat.ts
git commit -m "feat: add compatible goal acceptance recovery flows"
```

---

### Task 9: Acceptance, Blocked, and Certificate UI

**Files:**
- Modify: `src/renderer/goalProgressViewModel.ts`
- Modify: `src/renderer/goalProgressViewModel.test.ts`
- Modify: `src/renderer/components/GoalDetailDrawer.tsx`
- Modify: `src/renderer/components/GoalStatusStrip.tsx`
- Modify: `src/renderer/components/AgentChatPanel.tsx`
- Modify: `src/renderer/materialDesign.test.ts`
- Modify: `src/renderer/styles/chat.css`

**Interfaces:**
- Consumes: Goal acceptance state, failure records, last directive, certificate, blocked stop reason, existing Goal IPC operations.
- Produces: truthful labels, bounded evidence/certificate details, retry-acceptance/adjust/terminate actions.

- [ ] **Step 1: Write failing view-model tests**

Assert exact Chinese labels for validating, first repair, alternate strategy, stalled, each blocked reason, certified, and legacy achieved. Assert secrets/full artifact contents are absent from the projected certificate.

```ts
expect(buildGoalStatusPresentation(blockedGoal("acceptance_unavailable"))).toMatchObject({
  statusLabel: "目标受阻",
  detail: expect.stringContaining("验收服务暂时不可用"),
  recoveryActions: ["retry_acceptance", "adjust_plan", "terminate"],
})
```

- [ ] **Step 2: Write failing static wiring tests**

In `materialDesign.test.ts`, require `重试验收`, `调整计划`, `查看验收证书`, certificate hash rendering, existing IPC calls, and Obsidian token classes.

- [ ] **Step 3: Run renderer tests and witness RED**

Run: `npm test -- --run src/renderer/goalProgressViewModel.test.ts src/renderer/materialDesign.test.ts`

Expected: FAIL because the new status and UI controls are absent.

- [ ] **Step 4: Implement presentation projection**

Keep policy interpretation out of React components. Project only safe certificate fields and short hashes:

```ts
export type GoalCertificatePresentation = {
  acceptedAt: string
  planVersion: number
  checks: Array<{ label: string; passed: boolean; evidenceRefs: string[] }>
  artifacts: Array<{ path?: string; sizeBytes?: number; shortSha256?: string }>
  judge?: { model: string; promptVersion: string }
  shortCertificateHash: string
}
```

- [ ] **Step 5: Implement detail/status components and actions**

Render acceptance phase and occurrence, failed check IDs, exact decision, bounded artifact metadata, and certificate. Wire actions through existing retry/replan/cancel APIs and refresh Goal/session state after each operation.

- [ ] **Step 6: Apply Obsidian styling without new visual language**

Use existing raised surface, neutral border, status chip, focus-visible, and primary/secondary action tokens. Keep long evidence lists scrollable and hashes monospace.

- [ ] **Step 7: Run renderer tests and build**

Run: `npm test -- --run src/renderer/goalProgressViewModel.test.ts src/renderer/materialDesign.test.ts && npm run build`

Expected: renderer tests and TypeScript/Vite build pass; only the existing large-chunk warning may remain.

- [ ] **Step 8: Commit acceptance UI**

```bash
git add src/renderer/goalProgressViewModel.ts src/renderer/goalProgressViewModel.test.ts src/renderer/components/GoalDetailDrawer.tsx src/renderer/components/GoalStatusStrip.tsx src/renderer/components/AgentChatPanel.tsx src/renderer/materialDesign.test.ts src/renderer/styles/chat.css
git commit -m "feat: explain goal acceptance and certificates in UI"
```

---

### Task 10: Incident Regression, Harness Tracking, Full Verification, and Package Replacement

**Files:**
- Modify: `src/main/agentGoalController.test.ts`
- Modify: `src/main/agentGoalAcceptance.test.ts`
- Modify: `src/shared/packageScripts.test.ts`
- Modify: `.zerox/feature_list.json`
- Modify: `.zerox/progress.md`

**Interfaces:**
- Consumes: all P41 behavior.
- Produces: authoritative end-to-end regression evidence, completed feature tracking, rebuilt local app.

- [ ] **Step 1: Add a deterministic reproduction of the original incident**

Create a large ten-section report at an authorized absolute path. Configure semantic evidence using that path. Make the first two judge outcomes reject with the same machine-readable failure and the third attempt available only if the controller loops incorrectly. Assert:

```ts
expect(result.status).toBe("stopped_stalled")
expect(result.planVersion).toBe(1)
expect(result.budgetUsage.replans).toBe(0)
expect(runtime.runMilestoneIds).toHaveLength(3)
expect(result.acceptanceState?.recentFailures.at(-1)?.occurrence).toBe(3)
```

Add the successful counterpart proving the late tenth heading reaches the judge and produces a valid certificate.

- [ ] **Step 2: Update harness expectations for P41**

Teach `packageScripts.test.ts` that P41 is the sole permitted unfinished feature and assert its definition-of-done phrases. Run it once while P41 is in progress.

Run: `npm test -- --run src/shared/packageScripts.test.ts && npm run harness:check`

Expected: 8 or more package-script tests pass and harness reports `Harness check passed.`

- [ ] **Step 3: Run the complete focused P41 suite**

Run the exact P41 verification command from `.zerox/feature_list.json`.

Expected: every listed file passes with zero failed tests.

- [ ] **Step 4: Run full verification**

Run: `npm run verify`

Expected: all Vitest files pass, TypeScript and Vite build pass, agent evals pass, and memory evals pass.

- [ ] **Step 5: Run production smoke and diff checks**

Run: `npm run smoke:prod && git diff --check`

Expected: renderer smoke passes; the existing unpackaged better-sqlite3 ABI warning may fall back to JSON; diff check exits 0.

- [ ] **Step 6: Perform requirement-by-requirement completion audit**

For each of the ten P41 definition-of-done entries, record the exact test name, file/runtime evidence, and status. Any missing or indirect evidence keeps P41 in progress.

- [ ] **Step 7: Record progress and mark P41 done**

Append root cause, changed files, witnessed RED/GREEN commands, review findings, focused/full verification, package hashes, and runtime replacement evidence to `.zerox/progress.md`. Set P41 to `done` only after every audit item is proven.

- [ ] **Step 8: Re-run harness after tracker completion**

Run: `npm test -- --run src/shared/packageScripts.test.ts && npm run harness:check && git diff --check`

Expected: package tests and harness pass, zero unfinished features, diff check exits 0.

- [ ] **Step 9: Rebuild and smoke-test the packaged app**

Gracefully quit the currently running packaged app, then run:

```bash
npm run dist:mac
BUILDING_AGENT_SMOKE=1 BUILDING_AGENT_SMOKE_REQUIRED_TEXTS='v3.4.0' "release/mac-arm64/Zerox Agent.app/Contents/MacOS/Zerox Agent"
```

Expected: packaging exits 0 and packaged renderer smoke passes.

- [ ] **Step 10: Verify package content and relaunch**

Confirm `app.asar` contains `Goal acceptance certified`, `目标受阻`, and `查看验收证书`; compute SHA256 for DMG/ZIP; relaunch `release/mac-arm64/Zerox Agent.app`; verify the new PID/start time and that the original canceled incident ledger remains unchanged.

- [ ] **Step 11: Commit final tracking and regression evidence**

```bash
git add src/main/agentGoalController.test.ts src/main/agentGoalAcceptance.test.ts src/shared/packageScripts.test.ts .zerox/feature_list.json .zerox/progress.md
git commit -m "test: verify goal acceptance policy engine end to end"
```

---

## Plan Self-Review Checklist

- [x] Every design requirement maps to at least one task and explicit verification.
- [x] Every new module has a focused failing test before implementation.
- [x] Shared type names match all downstream task interfaces.
- [x] Semantic final judgment, unavailable-judge behavior, and certificate atomicity are controller-level tests, not only unit tests.
- [x] Legacy compatibility uses serialized fixtures and does not rely only on constructed objects.
- [x] Security tests cover outside-root and symlink artifact paths plus governed tool execution.
- [x] The original infinite-replan incident has both failure and successful-certificate regressions.
- [x] No task authorizes unrelated cleanup or destructive worktree operations.
