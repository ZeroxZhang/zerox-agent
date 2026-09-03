# conversation-disclosure archaeology (archived 2026-09-03, tag archive/disclosure-history-v3.9.2)

Frozen archive of the conversation-disclosure successor-program machinery
(rounds 1-23, orchestrators v1-v13). Nothing here runs in the live tree:

- tests/     - 117 historical governance-state test files (V2-V12 + closure
               state cases). Live tree runs only current-code tests via vitest.
- scripts/   - 142 orchestrator/verification/freeze scripts (v2-v13 lineage).
- evidence/  - .zerox/verification/conversation-disclosure round archives.
- program/   - .zerox/conversation-disclosure-program.{json,md}.

Restore: git checkout v3.9.2-pre-opt -- <path> for any file.
Relative dynamic imports inside tests/ pointed at ../../scripts/ under
src/shared; re-running archived tests requires re-pointing them to ../scripts/.
