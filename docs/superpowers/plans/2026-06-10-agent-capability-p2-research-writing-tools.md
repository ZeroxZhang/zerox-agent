# Agent Capability P2.3 Research Writing Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and superpowers:test-driven-development. Track each checkbox as it is completed.

**Goal:** Add native research-writing tools that turn fetched source material into citation-backed Markdown reports with auditable evidence sidecars.

**Architecture:** Keep research evidence as structured data separate from prose. `web_fetch_document` gathers a normalized document; `citation_record` creates a stable citation record; `citation_coverage_check` validates that every sourced claim cites a known source; `markdown_report_write` writes the final Markdown only when coverage passes and emits a sibling citations JSON artifact.

**Tech Stack:** TypeScript shared contracts, Electron main process dynamic tool registry, existing task permission policy, deterministic agent eval fixtures, Vitest, README/.zerox harness docs.

---

## Scope

This plan implements the P2.3 slice from `docs/superpowers/specs/2026-06-10-agent-capability-p2-design.md`:

- Add native tools: `web_fetch_document`, `citation_record`, `citation_coverage_check`, and `markdown_report_write`.
- Extend task authorization and run-context sandboxing for research tools.
- Add shared citation coverage and Markdown report contracts.
- Register native descriptors so trajectory evidence records research tool invocations and observations.
- Add a deterministic research-writing golden path eval fixture.
- Update docs and harness metadata.

This plan does not implement child-agent handoff or UI review gates; those remain P2.4.

## File Structure

- `src/shared/researchWriting.ts`  
  Pure citation, claim coverage, source-id, and Markdown rendering contracts.

- `src/shared/researchWriting.test.ts`  
  Unit tests for coverage, unsupported claims, and sourced-fact vs inference summary separation.

- `src/main/nativeResearchTools.ts`  
  Main-process handlers for document fetch, citation record, coverage check, and Markdown/sidecar writes.

- `src/main/nativeResearchTools.test.ts`  
  Tool-level tests using a fake web tool and temporary report directory.

- `src/shared/toolPermissions.ts` and `src/shared/toolPermissions.test.ts`  
  Authorization for research-writing tools.

- `src/shared/agentProtocol.ts`  
  Tool definitions and agent prompt guidance.

- `src/main/agentToolExecutor.ts`  
  Built-in tool registration and native descriptors.

- `src/main/eval/agentEvalFixtures.ts` and `src/main/eval/agentEvalRunner.test.ts`  
  Research-writing golden path fixture.

- `.zerox/feature_list.json`, `.zerox/progress.md`, `README.md`  
  P2.3 capability and verification status.

---

## Tasks

- [x] **Task 1: Write failing shared research-writing tests**
  - Add tests proving sourced claims without citations fail coverage.
  - Add tests proving model inferences are allowed but separated.
  - Add tests proving Markdown summary has distinct sourced-facts and model-inference sections.

- [x] **Task 2: Implement shared research-writing contracts**
  - Add `ResearchCitation`, `ResearchClaim`, `CitationCoverageResult`, and `MarkdownResearchReportInput`.
  - Add stable source IDs, citation normalization, coverage validation, and Markdown rendering.

- [x] **Task 3: Write failing native tool tests**
  - Fake a web fetch and assert normalized document output.
  - Record a citation and assert structured evidence.
  - Write a Markdown report and assert the `.citations.json` sidecar exists.
  - Assert report writing refuses unsupported sourced claims.

- [x] **Task 4: Implement native research tools**
  - Add `src/main/nativeResearchTools.ts`.
  - Wire file writes through mkdir/writeFile and return coverage metadata.

- [x] **Task 5: Register tools, permissions, and protocol definitions**
  - Extend `AgentToolName`, `supportedTools`, and `buildToolDefinitions`.
  - Add task-policy authorization and run-context checks.
  - Register native descriptors in the dynamic registry.

- [x] **Task 6: Add deterministic eval golden path**
  - Add `research-writing-native-tools` fixture with native invocation/observation events.
  - Assert coverage passes before final summary.

- [x] **Task 7: Update docs and harness metadata**
  - Update `.zerox/feature_list.json`, `.zerox/progress.md`, and README.
  - Mention citation sidecars and sourced fact vs inference summaries.

- [x] **Task 8: Verify**
  - Focused tests for shared contracts, native tools, permissions, protocol, executor, and evals.
  - Run `npm run harness:check`, `npm run verify`, `npm run harness:score`, and `npm run smoke:prod`.
