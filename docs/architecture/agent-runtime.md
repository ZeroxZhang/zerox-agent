# Agent Runtime Architecture

Zerox Agent runs local work through a recoverable runtime instead of a one-shot chat loop. The runtime is responsible for checkpointing, trajectory emission, failure classification, resume, and durable run records.

## Agent Runtime Kernel

The v2.3.0 Agent Runtime Kernel is an additive runtime layer for long-running local work. It does not replace the existing recoverable runtime path yet; it provides typed kernel contracts that can be adopted slice by slice without bypassing the local-first trust boundary.

The kernel layer currently includes:

- a shared `KernelEvent` contract for turns, tool calls, checkpoint writes, compaction, judge verdicts, retry scheduling, and run end states
- a process-local `KernelEventBus` that stores event history and streams new events to observers
- checkpointed context compaction that writes rebuildable local refs before replacing bulky historical tool results
- retry-after-aware model retry behavior for transient provider failures
- evidence-driven stop policies for judge-backed long tasks
- a rule-based permission engine that is invoked inside `ToolAuthorizationService`, so rule allow/deny decisions still write the normal tool audit log

These primitives are local only. Kernel checkpoints remain under local runtime storage, permission rules are applied in process, and renderer surfaces consume event history through IPC instead of becoming the source of truth.

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

## Kernel Event Bridge

The renderer-facing Kernel Event Bridge is a read-oriented IPC surface. Preload exposes `onKernelEvent`, `resumeKernelRun`, `updateKernelPermissionRules`, and `respondKernelPermission` using the shared `KERNEL_IPC` channel names. `onKernelEvent` first replays the current kernel event history and then streams live `kernel:event` updates from the process-local event bus.

Runs derives compact `RunView` state from `KernelEvent[]` with a shared reducer. The UI then renders Kernel Event cards for checkpoint writes, context compaction, retry scheduling, judge verdicts, and run-end states. Browser preview mode uses deterministic demo kernel events so UI review can verify kernel event replay without executing a real desktop run.

## Permission Rule Engine

Rule-based permission evaluation is intentionally inside `ToolAuthorizationService`. The kernel permission engine can match exact or wildcard command patterns and returns `allow`, `deny`, or `ask`; `ask` falls through to the existing task-policy and approval path. Allow/deny outcomes still append the normal tool audit event, preserving the same reviewable evidence as task-policy decisions.

The renderer can update runtime permission rules through the kernel IPC bridge, but tool execution never trusts renderer decisions directly. Final authorization remains in the main process, scoped by task policy, workspace sandbox checks, and the tool authorization service.

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
