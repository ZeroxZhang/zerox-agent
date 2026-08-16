# SQLite Domain Storage Convergence Program

## Objective

Move the remaining core runtime domains from JSON authority to SQLite without
weakening local-first trust, conditional mutation semantics, durable terminal
truth, reviewed learning, or rollback recoverability.

## Execution Rules

1. `P97-sqlite-domain-storage-convergence` is the only unfinished Feature.
2. Exactly one SC workstream is `in_progress`.
3. A workstream may start only after all `dependsOn` workstreams complete.
4. Every domain cutover starts with typed parity tests against its current JSON
   behavior.
5. SQLite commits first. Optional JSON compatibility shadows run through a
   failure-visible serial queue and must drain before shutdown returns.
6. A domain is not SQLite-authoritative until migration, restart, rollback,
   conflict, and production smoke evidence pass.
7. File-backed exclusions remain explicit. P97 must not quietly move encrypted
   model settings, large scoped result blobs, raw history, or deliverable files.
8. Deferred Kernel capabilities remain closed.

## Workstream Order

`SC01 -> SC02 -> {SC03, SC04, SC05, SC06} -> SC07 -> SC08`

SC03 through SC06 may be implemented in parallel only when they modify
non-overlapping domain stores. The manifest still advances one controlled
workstream state at a time so rollback and evidence remain attributable.

## Authority Contract

- `json`: JSON is read and write authority.
- `sqlite`: SQLite is read and write authority; JSON is untouched.
- `dual`: SQLite is authority; JSON is a tracked compatibility shadow.

No caller may infer authority merely from a table existing in `zerox.db`.

## Closure

P97 closes only after:

- all eight SC workstreams are `completed`;
- every target domain is SQLite-authoritative in production;
- every exclusion remains explicitly file-backed;
- migration and rollback are canonical and idempotent;
- independent architecture, security, and test engineers return `ACCEPT`;
- full verify, stress, real Seatbelt, Electron SQLite smoke, program, harness,
  audit, and whitespace gates pass.
