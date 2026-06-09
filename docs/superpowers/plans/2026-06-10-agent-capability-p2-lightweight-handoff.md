# Agent Capability P2.4 Lightweight Multi-Agent Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and superpowers:test-driven-development. Track each checkbox as it is completed.

**Goal:** Upgrade existing parent/child lineage into a one-level, reviewable handoff contract for researcher, executor, and reviewer child roles.

**Architecture:** Keep the current `MultiAgentCoordinator` and `child_run_scheduled` lineage. Add a shared `AgentHandoffContract`, child output, and review decision model; emit deterministic trajectory events for handoff creation, child completion, and review gate decisions; surface those cards in Runs.

**Tech Stack:** TypeScript shared contracts, main-process coordinator, trajectory fixtures, Runs UI, Vitest, README/.zerox harness docs.

---

## Scope

- Add `researcher` as a supported child role while retaining older planner/critic metadata for compatibility.
- Add shared handoff contracts with bounded allowed tools, expected artifacts, budget, and review gate.
- Add trajectory event types:
  - `child_handoff_created`
  - `child_handoff_completed`
  - `child_handoff_reviewed`
- Extend `MultiAgentCoordinator` to create contracts, record child output, and record parent/reviewer decisions.
- Extend Runs UI with compact handoff review gate cards derived from trajectory evidence.
- Upgrade deterministic multi-agent eval fixture to assert handoff order and review decision.

This plan does not implement a parallel scheduler or multi-level agent swarm.

## Tasks

- [x] **Task 1: Write failing shared handoff contract tests**
  - Contract accepts researcher/executor/reviewer only.
  - Contract rejects empty objective, empty allowed tools, and depth > 0 parents.
  - Review decisions normalize to accepted/rejected/revision_requested.

- [x] **Task 2: Implement shared handoff contracts and trajectory summarizer**
  - Create `src/shared/agentHandoff.ts`.
  - Add summarizer for Runs UI cards from trajectory events.

- [x] **Task 3: Write failing coordinator and eval tests**
  - Coordinator emits created/scheduled/completed/reviewed events in order.
  - Eval fixture requires handoff review gate events.

- [x] **Task 4: Implement coordinator event recording**
  - Add create contract, child output, and review methods.
  - Preserve existing `recordChildRun` behavior for compatibility.

- [x] **Task 5: Add Runs review gate UI**
  - Render child role, objective, status, artifacts, open questions, and review decision.
  - Keep the card compact and driven by trajectory evidence.

- [x] **Task 6: Update docs and harness metadata**
  - Update `.zerox`, README, and progress.

- [x] **Task 7: Verify**
  - Focused tests, `npm run harness:check`, `npm run verify`, `npm run harness:score`, and `npm run smoke:prod`.
