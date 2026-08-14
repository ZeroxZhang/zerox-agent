# KM07 Decision: Production Kernel Scope Convergence

Status: Accepted

Date: 2026-08-14

## Decision

Centralize Production Kernel coverage in `productionKernelCovers(scope, mode)`.
The matrix is monotonic:

- `all`: Scheduled Task, Chat, Goal;
- `scheduled_chat`: Scheduled Task, Chat;
- `scheduled`: Scheduled Task;
- `off`: none.

Container wiring consumes this policy for every surface. Direct execution
delegates remain as explicit rollback paths and are not duplicate terminal
publishers.

No persistence, permission, or event schema changes are introduced.
