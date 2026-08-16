# SC01: SQLite Domain Storage Convergence Program

Date: 2026-08-16

## Decision

Create an independent P97 program for converging the remaining core domain
stores on SQLite authority. Do not reopen the completed Runtime Convergence or
Kernel Migration programs.

## Context

P96 established an honest mixed-authority matrix. Chat, Run, Trajectory, Task,
Validation, MemoryProfile, ToolAudit, and SQLite-mode Plan already use SQLite.
Goal, execution checkpoints, Memory, Workspace, Multi-Agent Session, Learning,
Eval Candidate, and promoted eval fixtures still use JSON despite existing
SQLite schemas or repositories.

That split preserves compatibility but duplicates mutation, migration, and
rollback logic. A global cutover would be unsafe because the current
repositories do not yet prove all domain-specific semantics.

## Constraints

- Preserve Goal conditional writes, irreversible terminal states, acceptance
  certificates, ledger publication keys, and Plan lineage.
- Preserve checkpoint restart semantics and Kernel settlement ordering.
- Preserve Memory embeddings, deterministic ranking, reranking, maintenance,
  governance, and session isolation.
- Preserve reviewed learning and eval status transitions.
- Keep SQLite authoritative before compatibility shadows.
- Keep encrypted settings, large scoped tool-result blobs, raw history,
  workspace run ledgers, and artifact payloads file-backed in P97.
- Do not change ToolRuntime, authorization, Seatbelt, or deferred Kernel
  capabilities.

## Consequences

- Store factories gain explicit backend and storage dependencies.
- Repository contracts may be extended only where parity tests prove a missing
  domain operation.
- Migration and rollback become per-domain and canonical.
- JSON compatibility remains available until SC08 closure evidence passes.
- Release preparation begins only after P97 closes.
