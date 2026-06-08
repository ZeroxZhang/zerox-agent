# Agent Runtime Architecture

Zerox Agent runs local work through a recoverable runtime instead of a one-shot chat loop. The runtime is responsible for checkpointing, trajectory emission, failure classification, resume, and durable run records.

## Runtime Boundary

The production task path is:

1. `AgentRunnerService.runTask(taskId)`
2. `AgentRuntimeEngine.startTask(taskId)`
3. workspace context resolution
4. `AgentExecutionStore.save(checkpoint)`
5. model turn, tool authorization, tool execution
6. checkpoint update and trajectory append
7. final `AgentRunRecord` append

`AgentRunnerService` still contains the older plan/execute/reflect loop for compatibility when no execution store is configured, but the desktop app wires the recoverable runtime by default.

## State Machine

Execution checkpoints use these statuses:

| Status | Meaning | Terminal |
| --- | --- | --- |
| `queued` | Run exists and has an initial checkpoint. | No |
| `running` | Runtime is actively calling the model or tools. | No |
| `waiting_for_approval` | A tool call needs explicit user approval. | No |
| `paused` | Run can be resumed from the latest checkpoint. | No |
| `succeeded` | Run finished with a final summary. | Yes |
| `failed` | Run stopped with a classified failure. | Yes |
| `canceled` | User or abort signal stopped the run. | Yes |

Allowed transitions are defined in `src/shared/agentExecution.ts`. The key recovery transition is `paused -> running`, and terminal states are hidden from the active execution list.

## Checkpoint Format

Checkpoints are persisted as JSON under:

```text
userData/config/agent-executions/<runId>.json
```

Each checkpoint keeps:

- `runId`, `taskId`, `status`, and current step id
- optional `runContext` with workspace id, workspace root, sandbox policy, role, parent run, and session id
- execution steps with attempt count, failure class, and failure message
- model/tool messages needed to continue the run
- `toolCallCount`
- `createdAt` and `updatedAt`

The checkpoint is saved before execution starts, after state changes, after tool observations, and when the run reaches a terminal state.

## Resume Guarantees

`AgentRuntimeEngine.resumeRun(runId)` loads the latest checkpoint and continues with the stored messages. This guarantees:

- app restart does not lose the current plan/messages/tool observations stored in the checkpoint
- already recorded checkpoint data is not recomputed from the UI
- resumed runs reuse the original `runId`
- final run records reference the terminal checkpoint id

The renderer exposes active checkpoints through `agentRuns:listActiveExecutions`, pauses them through `agentRuns:pause`, and resumes them through `agentRuns:resume`.

## Failure Classification

Runtime failures are normalized by `classifyAgentFailure` before the terminal checkpoint and run record are written. Current classes include permission denial, tool failure, invalid model output, timeout, cancellation, user approval, and unknown failures.

Failure classifications are also emitted into the trajectory as `failure_classified` events so evals and learning extraction can reason about failed runs.

## Trajectory Emission

The runtime emits append-only trajectory events for:

- run context creation
- state transitions
- checkpoint writes
- model requests and responses
- tool calls and tool results
- workspace escape denials
- child run scheduling
- failure classification
- final summaries

Trajectory files live under:

```text
userData/config/agent-trajectories/<runId>.jsonl
```

Events carry redaction flags so future replay and inspection tools can avoid exposing API keys, file content, or user text accidentally.

The Runs panel reads trajectory files through `agentRuns:listTrajectory` and shows event payloads plus redaction flags for the selected run.

## Workspace And Multi-Agent Context

The desktop app wires `AgentWorkspaceService` into `AgentRunnerService`, so new recoverable runs receive an `AgentRunContext` before the first model request. That context is written to checkpoints, final run records, and trajectory events.

Tool authorization receives the same context and narrows task permissions to the active workspace unless the sandbox explicitly allows workspace escape. Shell commands execute with `cwd` set to the workspace root. Parent/child multi-agent sessions reuse this context, adding `parentRunId`, `sessionId`, role, and depth metadata.

## Verification

Fast local verification paths:

```bash
npm test -- src/shared/agentExecution.test.ts src/main/agentExecutionStore.test.ts src/main/agentRuntimeEngine.test.ts src/main/agentRunnerService.test.ts
npm run verify
```

`npm run verify` runs unit tests, builds the app, and executes the deterministic agent eval suite.

The Overview panel can request `agentQuality:getEvalReport` to display the deterministic eval pass rate as a local quality signal.
