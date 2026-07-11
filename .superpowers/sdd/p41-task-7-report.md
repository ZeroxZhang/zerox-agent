# P41 Task 7 Report — Controller Repair Loop, Blocking, and Certification

## Status

DONE

## Scope

- Replaced unconditional acceptance-failure replanning and the covered-check semantic fast path with one typed acceptance-decision path.
- Added durable failure fingerprints, bounded failure history, occurrence-based same-milestone repair, alternate strategy, stall, structural-only replan, and blocked stop mappings.
- Added deterministic final repair milestone creation/reuse and protocol-v2 atomic certificate-backed achievement.
- Added runtime repair directives and bounded/deduplicated/redacted action signatures for deterministic and model tool paths.
- Added the six approved acceptance ledger/trajectory/progress events with bounded redacted payloads.
- Preserved protocol-v1 final evaluation compatibility and P40 cancellation/achievement arbitration.

## TDD Evidence

RED was witnessed before production implementation:

```text
npm test -- --run src/main/agentGoalController.test.ts src/main/goalRuntimeEngine.test.ts
Test Files 1 failed | 1 passed
Tests 9 failed | 37 passed
```

The failures were the intended missing Task 7 behaviors: bounded repair/stall, fingerprint reset, blocked mappings, final repair reuse, mandatory final evaluation, and certificate-backed achievement.

The runtime directive/signature test was also witnessed RED independently:

```text
npm test -- --run src/main/goalRuntimeEngine.test.ts -t 'injects the exact repair directive'
Test Files 1 failed
Tests 1 failed | 13 skipped
```

GREEN after implementation and expanded race/certificate/observability coverage:

```text
npm test -- --run src/main/agentGoalController.test.ts src/main/goalRuntimeEngine.test.ts src/main/agentGoalAcceptanceCertificate.test.ts
Test Files 3 passed (3)
Tests 120 passed (120)
```

## Fresh Verification

```text
npx tsc -p tsconfig.electron.json --noEmit
exit 0

npm run harness:check
Harness check passed.

git diff --check
exit 0
```

## Changed Files

- `src/main/agentGoalController.ts`
- `src/main/agentGoalController.test.ts`
- `src/main/goalRuntimeEngine.ts`
- `src/main/goalRuntimeEngine.test.ts`
- `src/shared/agentTrajectory.ts`
- `src/shared/agentGoal.ts` (approved ledger event kind additions only)
- `.superpowers/sdd/p41-task-7-report.md`

## Coverage Highlights

- Identical milestone failures: occurrence 1 repair, occurrence 2 alternate strategy, occurrence 3 stalled; zero replans.
- Changed fingerprint occurrence reset.
- Structural-only replan with exact single planner increment and replan-budget enforcement.
- External, impossible, and unavailable blocked mappings.
- Operational-budget precedence after durable failure recording.
- Final repair milestone reuse without an unbounded chain.
- Mandatory fresh final goal evaluation for covered semantic/provenance checks.
- Valid deterministic and semantic protocol-v2 certificates; unavailable/invalid acceptance cannot certify.
- Cancellation races at validation, repair persistence, structural replan, and certificate persistence boundaries.
- All six acceptance events typed, ordered, progress-projected, and free of raw secrets/details/artifact contents.
- Stable redacted action signatures in deterministic and model runtime paths.

## Worktree Preservation

Pre-existing `.gitignore` and unrelated untracked files were not edited or staged.

## Review Fix — Bounded Acceptance Invariants

### Status

DONE

### RED Evidence

The review regressions were added before production changes and witnessed failing:

```text
npm test -- --run src/main/agentGoalController.test.ts src/main/goalRuntimeEngine.test.ts src/main/agentGoalFailureFingerprint.test.ts
Test Files 3 failed (3)
Tests 16 failed | 65 passed (81)
```

The failures covered:

- paused blocked/impossible/unavailable/structural results bypassing the typed decision path;
- repairable pauses lacking durable failure/directive state;
- final hard budgets still calling `evaluateGoal`;
- pending repair milestones blocked by skipped dependencies;
- cross-run action-signature and terminal-publication cache retention;
- unbounded/raw file content, commands, URLs, query credentials, and bearer tokens in action signatures.

### GREEN Evidence

```text
npm test -- --run src/main/agentGoalController.test.ts src/main/goalRuntimeEngine.test.ts src/main/agentGoalAcceptanceCertificate.test.ts src/main/agentGoalFailureFingerprint.test.ts
Test Files 4 passed (4)
Tests 151 passed (151)

npx tsc -p tsconfig.electron.json --noEmit
exit 0

npm run harness:check
Harness check passed.

git diff --check
exit 0
```

### Fix Summary

- Every nonaccepted milestone result, including paused runs, now enters `applyAcceptanceDecision`; repairable turn-limit pauses retain review compatibility after durable policy application.
- Operational hard caps stop before both milestone acceptance validators and final goal cold judgment.
- Repair dependency readiness treats accepted and skipped predecessors as satisfied.
- Tool action signatures use stable private-value SHA-256/byte-length markers, redact secret-named fields and credential tokens, cap each signature at 2 KiB, and cap persisted arrays at 8 KiB.
- Per-goal terminal publication keys and recent action signatures are cleared on owned run cleanup and direct terminal paths without clearing replacement-run state.

### Review Fix Files

- `src/main/agentGoalController.ts`
- `src/main/agentGoalController.test.ts`
- `src/main/goalRuntimeEngine.ts`
- `src/main/goalRuntimeEngine.test.ts`
- `src/main/agentGoalFailureFingerprint.ts`
- `src/main/agentGoalFailureFingerprint.test.ts`
- `.superpowers/sdd/p41-task-7-report.md`

## Second Review Fix — Recoverability, Tail Identity, and Unique Termination

### Status

DONE

### RED Evidence

The three P1 regressions were added before production edits and witnessed failing:

```text
npm test -- --run src/main/agentGoalController.test.ts src/main/agentGoalFailureFingerprint.test.ts
Test Files 2 failed (2)
Tests 5 failed | 71 passed (76)
```

The owned-run signature cleanup race was then isolated with a second RED probe:

```text
npm test -- --run src/main/agentGoalController.test.ts -t 'keeps replacement action signatures'
Test Files 1 failed (1)
Tests 1 failed | 54 skipped (55)
```

The failures proved:

- a successful runtime stopped at the hard cap left its milestone `running` and unschedulable after a budget raise;
- array element 33, array length, object key/value 65, and object total-key count were absent from action identity;
- a replacement run could achieve while a stale acceptance run later emitted a duplicate `goal_stopped` event.

### GREEN Evidence

```text
npm test -- --run src/main/agentGoalController.test.ts src/main/goalRuntimeEngine.test.ts src/main/agentGoalAcceptanceCertificate.test.ts src/main/agentGoalFailureFingerprint.test.ts
Test Files 4 passed (4)
Tests 159 passed (159)

npx tsc -p tsconfig.electron.json --noEmit
exit 0

npm run harness:check
Harness check passed.

git diff --check
exit 0
```

### Fix Summary

- A hard-cap stop after runtime completion resets a still-running milestone to `ready`; raising the budget and resuming schedules it again without running acceptance validators past the cap.
- Canonical arrays now include total length plus a bounded omitted-tail digest. Canonical objects include total key count plus a bounded digest of globally sorted omitted key/value entries.
- Tail inspection has fixed item/node limits, safely converts getters/cycles, emits no omitted raw values, and prevents repeated-failure occurrence collisions at element 33/key 65.
- Terminal dedupe uses one canonical version per goal and tracks every owning run generation. Direct terminal writes register their version, and terminal/signature state is released only after all stale/replacement owners exit.

### Second Review Files

- `src/main/agentGoalController.ts`
- `src/main/agentGoalController.test.ts`
- `src/main/agentGoalFailureFingerprint.ts`
- `src/main/agentGoalFailureFingerprint.test.ts`
- `.superpowers/sdd/p41-task-7-report.md`

## Final Fingerprint Fix — Complete Streaming Action Tails

### Status

DONE

### RED Evidence

```text
npm test -- --run src/main/agentGoalFailureFingerprint.test.ts
Test Files 1 failed (1)
Tests 3 failed | 22 passed (25)
```

The failing probes changed array element 97 and the far sparse end, object sorted key 129 and the far end, and a late deeply nested tail value after the former shared node budget was exhausted. Each pair retained identical length/cardinality.

### GREEN Evidence

```text
npm test -- --run src/main/agentGoalController.test.ts src/main/goalRuntimeEngine.test.ts src/main/agentGoalAcceptanceCertificate.test.ts src/main/agentGoalFailureFingerprint.test.ts
Test Files 4 passed (4)
Tests 162 passed (162)

npx tsc -p tsconfig.electron.json --noEmit
exit 0

npm run harness:check
Harness check passed.

git diff --check
exit 0
```

### Fix Summary

- Sparse arrays retain declared length but enumerate and hash every actually enumerable omitted numeric index instead of looping declared holes.
- Objects hash every omitted own enumerable key/value in sorted-key order.
- Tail hashes use length-framed streaming SHA-256 updates and never build or persist raw tail-value arrays.
- Every omitted entry receives a fresh bounded canonical state while retaining depth/string limits, secret/private handling, hostile getter containment, and parent-cycle detection.
- Element 97/key 129 and arbitrarily later same-cardinality changes now alter both action signatures and failure fingerprints, protecting occurrence counting.

### Final Fingerprint Files

- `src/main/agentGoalFailureFingerprint.ts`
- `src/main/agentGoalFailureFingerprint.test.ts`
- `.superpowers/sdd/p41-task-7-report.md`

## Visible Entry Budget Fix — Isolated Bounded Action Entries

### Status

DONE

### RED Evidence

The wide visible-object and visible-array regressions were added before production changes and witnessed failing because an early `a` entry exhausted the shared 512-node budget before a later visible `z` field:

```text
npm test -- --run src/main/agentGoalFailureFingerprint.test.ts
Test Files 1 failed (1)
Tests 2 failed | 25 passed (27)
```

Both failing probes produced identical bounded action signatures when only the late `z` value changed.

### GREEN Evidence

```text
npm test -- --run src/main/agentGoalFailureFingerprint.test.ts
Test Files 1 passed (1)
Tests 27 passed (27)

npm test -- --run src/main/agentGoalController.test.ts src/main/goalRuntimeEngine.test.ts src/main/agentGoalAcceptanceCertificate.test.ts src/main/agentGoalFailureFingerprint.test.ts
Test Files 4 passed (4)
Tests 164 passed (164)

npx tsc -p tsconfig.electron.json --noEmit
exit 0

npm run harness:check
Harness check passed.

git diff --check
exit 0
```

### Fix Summary

- Each top-level visible object field or array element receives a fresh 512-node canonical state with the root container retained in its ancestor guard.
- Nested recursion shares that entry state, so every top-level entry remains bounded by one node/depth budget rather than multiplying work at each nested sibling level.
- Existing 64-key and 32-element visibility caps, complete streaming tail digests, cycle detection, hostile-getter containment, private-value handling, and 2 KiB signature cap remain intact.
- Wide-object and wide-array probes now distinguish late `z` alpha/bravo changes, produce distinct failure fingerprints, reset consecutive occurrence counting, and persist neither raw probe value.

### Visible Entry Budget Files

- `src/main/agentGoalFailureFingerprint.ts`
- `src/main/agentGoalFailureFingerprint.test.ts`
- `.superpowers/sdd/p41-task-7-report.md`

## Nested Entry Budget Fix — Universal Sibling Isolation

### Status

DONE

### RED Evidence

The exact nested config-object, nested array-sibling, and hostile nested array/object regressions were added before the production change and witnessed failing under root-only isolation:

```text
npm test -- --run src/main/agentGoalFailureFingerprint.test.ts
Test Files 1 failed (1)
Tests 3 failed | 27 passed (30)
```

After the initial universal fix passed those probes, a second strict-TDD cycle added an alternating object/array property-style depth sweep. The old root-only behavior was restored for the RED witness:

```text
npm test -- --run src/main/agentGoalFailureFingerprint.test.ts -t "sweeps nested sibling isolation"
Test Files 1 failed (1)
Tests 1 failed | 30 skipped (31)
```

The depth-1 case retained identical bounded signatures after an early 64×64 wide sibling exhausted the nested shared node budget.

### GREEN Evidence

```text
npm test -- --run src/main/agentGoalFailureFingerprint.test.ts
Test Files 1 passed (1)
Tests 31 passed (31)

npm test -- --run src/main/agentGoalController.test.ts src/main/goalRuntimeEngine.test.ts src/main/agentGoalAcceptanceCertificate.test.ts src/main/agentGoalFailureFingerprint.test.ts
Test Files 4 passed (4)
Tests 168 passed (168)

npx tsc -p tsconfig.electron.json --noEmit
exit 0

npm run harness:check
Harness check passed.

git diff --check
exit 0
```

### Fix Summary

- Every visible object field and array element at every nesting level receives a fresh zeroed 512-node counter while sharing the active ancestor `WeakSet`.
- Sharing the ancestor guard preserves self/ancestor cycle detection without cloning or iterating weak references; hostile getters remain converted to unreadable markers.
- The exact `{ config: { a: wide, z: alpha/bravo } }` probe, nested arrays, nested array/object cycles, and alternating depths 1–14 now preserve late-sibling identity, reset fingerprint occurrence counting, remain at or below 2 KiB, and expose no raw probe/getter text.
- Traversal stays proportional to actually expanded enumerable input: arrays inspect at most 32 visible indices, objects at most 64 visible keys, sparse tails enumerate actual own keys, every path stops at depth 16, and strings/private values remain bounded digests.
- Cross-sibling memoization was intentionally not added because canonical cycle results depend on the active ancestor context and hostile getters may not be stable across reads; per-reference traversal remains bounded and does not collapse later siblings.

### Nested Entry Budget Files

- `src/main/agentGoalFailureFingerprint.ts`
- `src/main/agentGoalFailureFingerprint.test.ts`
- `.superpowers/sdd/p41-task-7-report.md`

## Depth Boundary Fix — Deterministic Iterative Deep-Graph Digests

### Status

DONE

### RED Evidence

The exact depth-16 mixed object/array late-value regression was added first and witnessed colliding on the former fixed truncation marker:

```text
npm test -- --run src/main/agentGoalFailureFingerprint.test.ts -t "depth-16 boundary"
Test Files 1 failed (1)
Tests 1 failed | 31 skipped (32)
```

The remaining adversarial matrix was then added before production edits. It covered depths 15/16/32/1000, visible and complete sparse-tail placements, reordered keys, shared references/cycles, hostile getters, and secret-key reads:

```text
npm test -- --run src/main/agentGoalFailureFingerprint.test.ts
Test Files 1 failed (1)
Tests 4 failed | 33 passed (37)
```

Failures proved fixed depth truncation collided at the boundary, in visible/tail placements, and across meaningful shared-reference graph changes.

### GREEN Evidence

```text
npm test -- --run src/main/agentGoalFailureFingerprint.test.ts
Test Files 1 passed (1)
Tests 37 passed (37)

npm test -- --run src/main/agentGoalController.test.ts src/main/goalRuntimeEngine.test.ts src/main/agentGoalAcceptanceCertificate.test.ts src/main/agentGoalFailureFingerprint.test.ts
Test Files 4 passed (4)
Tests 174 passed (174)

npx tsc -p tsconfig.electron.json --noEmit
exit 0

npm run harness:check
Harness check passed.

git diff --check
exit 0
```

### Fix Summary

- Reaching canonical depth 16 now emits a private `deep_digest` marker instead of a fixed truncation marker; the ordinary canonical depth constant was not raised.
- The fallback performs a nonrecursive deterministic DFS using explicit value/container cursor tasks, so a depth-1000 mixed graph neither constructs nor traverses through recursive test/production calls.
- Objects hash sorted own enumerable keys. Arrays hash declared length, actual enumerable-key count, numeric indices in numeric order, and non-index properties in lexical order; sparse arrays never iterate declared holes.
- A per-traversal `WeakMap` assigns deterministic IDs to first-seen objects and frames subsequent references, preserving shared-reference topology and cycles in O(actual visited nodes and edges), aside from required key sorting.
- Length-framed hash updates distinguish types, keys, indices, values, references, unreadable getters/containers, and user strings that resemble markers.
- Secret-like keys hash a redacted marker without reading their value. Private strings, commands, and URLs feed only the SHA-256 input after credential scrubbing and never appear in signatures.
- The fixed-size marker contains only the SHA-256 digest plus node/edge counts; the existing final 2 KiB action-signature bound and complete streaming tail digest remain intact.

### Depth Boundary Files

- `src/main/agentGoalFailureFingerprint.ts`
- `src/main/agentGoalFailureFingerprint.test.ts`
- `.superpowers/sdd/p41-task-7-report.md`

## Hostile Graph Bound Fix — Deterministic Traversal Caps

### Status

DONE

### RED Evidence

The consolidated hostile-graph, tail-order, and deep-array regressions were added before production edits and witnessed failing:

```text
npm test -- --run src/main/agentGoalFailureFingerprint.test.ts
Test Files 1 failed (1)
Tests 4 failed | 38 passed (42)
```

The failures proved:

- a semantically endless fresh-`next` getter ran until the test-only 10,001-read fuse and returned no truthful truncation status;
- a lazy finite generator traversed all 250,000 nodes;
- shallow array tail identity depended on named-property insertion order;
- nonenumerable numeric own array indices were absent from deep identity.

The RED suite completed in 773 ms, so the endless source could not hang the test process.

### GREEN Evidence

```text
npm test -- --run src/main/agentGoalFailureFingerprint.test.ts
Test Files 1 passed (1)
Tests 42 passed (42)

npm test -- --run src/main/agentGoalController.test.ts src/main/goalRuntimeEngine.test.ts src/main/agentGoalAcceptanceCertificate.test.ts src/main/agentGoalFailureFingerprint.test.ts
Test Files 4 passed (4)
Tests 179 passed (179)

npx tsc -p tsconfig.electron.json --noEmit
exit 0

npm run harness:check
Harness check passed.

git diff --check
exit 0
```

### Fix Summary

- Iterative deep-graph traversal now has deterministic hard caps of 8,192 unique nodes and 32,768 own-property inspections.
- Once either cap is reached, traversal stops before the next property descriptor/getter/value read, hashes explicit `graph_truncated` node/edge/inspection counts, and emits a truthful `truncated` marker status.
- Exact deep-graph differentiation is guaranteed only within those documented safety budgets; inputs beyond them terminate synchronously with deterministic bounded identity.
- Hash payload frames larger than 512 bytes are replaced by length-plus-SHA-256 frames, so huge keys and strings never enlarge the persisted marker or expose raw private text.
- Shallow array tail keys are sorted numeric-first and then lexical before length-framed streaming hash updates.
- Deep arrays use safe own-property-name/descriptor inspection: every actual numeric own index participates regardless of enumerability, named properties participate only when enumerable, symbols and nonenumerable named properties are excluded, and accessor/descriptor failures become typed hash markers.
- Sparse arrays hash declared length plus actual discovered own indices without iterating declared holes. Secret-like properties still skip their values/getters.
- The endless fresh-getter signatures repeat deterministically, invoke no more than the node budget, finish within the test performance bound, remain at or below 2 KiB, and expose no fuse/private text.

### Hostile Graph Bound Files

- `src/main/agentGoalFailureFingerprint.ts`
- `src/main/agentGoalFailureFingerprint.test.ts`
- `.superpowers/sdd/p41-task-7-report.md`

## Hidden Metadata Budget Consistency

### Status

DONE

### RED / GREEN Evidence

The final independent review showed that 32,768 ignored nonenumerable named
properties could consume the semantic inspection budget. The added object and
array regressions failed before the implementation change and now pass:

```text
npm test -- --run src/main/agentGoalFailureFingerprint.test.ts
Test Files 1 passed (1)
Tests 45 passed (45)

npm test -- --run src/main/agentGoalController.test.ts src/main/goalRuntimeEngine.test.ts src/main/agentGoalAcceptanceCertificate.test.ts src/main/agentGoalFailureFingerprint.test.ts
Test Files 4 passed (4)
Tests 182 passed (182)
```

Objects now enumerate only own enumerable string keys. Arrays merge those keys
with numeric own property names, preserving nonenumerable numeric elements while
excluding `length`, symbols, and nonenumerable named metadata before the semantic
inspection budget is consumed. Hostile object/array proxy enumeration remains
contained as an unreadable-container marker.
