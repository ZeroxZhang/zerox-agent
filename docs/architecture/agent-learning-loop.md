# Agent Learning Loop Architecture

Zerox Agent learns only through reviewed local artifacts. A run can generate learning candidates, but those candidates do not change future behavior until the user accepts and applies them.

## Data Flow

```text
agent run
  -> trajectory events
  -> rule-based learning extraction
  -> reviewable learning candidates
  -> user accept/reject
  -> accepted procedural memory write
  -> future run retrieves procedural memory
  -> task and planning prompts include reviewed procedure
```

## Candidate Sources

`AgentLearningExtractor` reads completed trajectories and creates candidates from durable evidence:

| Candidate | Source Evidence | Purpose |
| --- | --- | --- |
| `procedural_memory` | successful tool-call sequence | Preserve a workflow that worked. |
| `failure_lesson` | `permission_denied` failure classification | Explain why a run failed and what to adjust. |
| `skill_improvement` | `invalid_model_output` failure classification | Propose clearer skill or prompt instructions. |

The runtime automatically calls the extractor after a terminal run is appended when both a trajectory store and learning store are configured.

## Review Store

Learning candidates are persisted in:

```text
userData/config/agent-learning-candidates.json
```

Each candidate has:

- `type`
- `status`: `pending_review`, `accepted`, `rejected`, or `applied`
- `sourceRunId`
- `sourceTrajectoryEventIds`
- `claim`
- `recommendedAction`
- `risk`
- timestamps

The renderer exposes the review workflow in the Learning panel. Overview also surfaces pending candidates so the user can keep the learning queue under control.

## Applying Accepted Learning

`AgentLearningService.applyAccepted()` scans accepted procedural candidates and writes them to local memory as:

- `kind: "procedural"`
- `source: { type: "agent_run", refId: candidate.sourceRunId }`
- tags: `agent-learning`, `procedural-memory`

After a memory is written, the candidate moves to `applied`.

Failure lessons and skill improvement proposals remain review artifacts for now. They are intentionally not written into executable skills automatically.

## Future Run Injection

Before a new agent run starts, `agentProceduralMemory` searches local memory for matching `procedural` records using the task name, skill name, and skill description. Matching records are appended to:

- the recoverable runtime task prompt
- the compatibility runner planning prompt

This makes reviewed learning affect future planning while preserving traceability and reversibility. Deleting or archiving the memory removes it from future retrieval.

## Safety Rules

- Learning candidates are never applied without explicit review.
- Applied learning writes memory, not code or skill files.
- Procedural memory changes prompts only; normal tool permission checks still apply.
- Archived memories are excluded from prompt injection.
- Extraction is rule-based until eval data shows that LLM extraction is worth the extra risk and complexity.

## Verification

Focused tests:

```bash
npm test -- src/main/agentLearningStore.test.ts src/main/agentLearningExtractor.test.ts src/main/agentLearningService.test.ts src/main/agentRuntimeEngine.test.ts src/main/agentRunnerService.test.ts
```

End-to-end local verification:

```bash
npm run verify
```
