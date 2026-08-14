# RC08 Decision: Production Kernel Convergence And Read-Only Code Mode

Status: Accepted

Date: 2026-08-14

## Context

`runRuntimeKernel` owns a typed turn loop, stop policy, checkpoint cadence, and
Kernel events, but production execution is still driven by AgentLoop,
AgentRuntimeEngine, GoalRuntimeEngine, and compatibility loops. The desktop
subscribes to `KernelEventBus`, yet production runs do not use the Kernel as
their lifecycle authority.

Zerox also lacks a Code Mode that can combine several read operations inside
one model tool call. Adding arbitrary model-written JavaScript to Node `vm` or
a Worker Thread would not create a security boundary: constructor escapes,
dynamic imports, process globals, and native-module access are not safely
eliminated by `vm`. This iteration must not trade fewer model turns for host
code execution.

## Decision

### Production Kernel Cutover

Cut over exactly one production entry: recoverable scheduled-task execution.

The Kernel becomes the lifecycle driver around one shared-AgentLoop execution
segment:

- Kernel owns `turn_start`, checkpoint, tool-call, retry, and `run_end`
  publication for the scheduled run;
- AgentLoop remains the segment implementation that owns model protocol,
  ToolRuntime, replay-safe context, ordered tool scheduling, and quiescent
  cancellation;
- segment terminal status is an explicit Kernel turn result, including paused,
  failed, and canceled, rather than being inferred as success;
- Kernel and AgentLoop run ids, status, summary, checkpoint id, and signal are
  required to match before AgentRuntimeEngine persists the final run;
- legacy AgentRuntimeEngine execution remains available only as an explicit
  rollback/testing path.

Chat and Goal milestone entry points continue using the shared AgentLoop
directly. Their Kernel cutover requires separate parity evidence and is not
claimed by RC08.

### Read-Only Code Mode Pilot

Add one built-in `read_code` tool backed by an isolated Worker Thread.

The model supplies a typed declarative DAG, not JavaScript source:

```text
steps[] = { id, tool, args, dependsOn[] }
output[] = step ids
```

The Worker validates and schedules the DAG. It has no filesystem, process,
network, module, shell, or arbitrary-code binding. It communicates only by
structured messages requesting an allowlisted read tool. The main process
executes every subcall through the existing ToolRuntime.

Initial SDK allowlist:

- `file_stat`
- `file_list`
- `file_search`
- `file_inventory`
- `file_move_plan`
- `file_verify_moves`
- `file_read`
- `tool_result_read`
- `code_search`
- `git_status`
- `git_diff`
- `memory_search`
- `conversation_search`
- `history_search`
- `history_around`
- `web_search`
- `web_fetch`

No write, test, Shell, Actor, Workflow, MCP, approval-bearing, unknown-source,
or nested `read_code` call is available.

## Invariants

1. Scheduled production runs pass through `runRuntimeKernel`.
2. Each admitted scheduled execution segment emits exactly one Kernel
   `run_end`; a later resume is a new segment on the same run id.
3. Kernel terminal status equals the AgentLoop segment status.
4. Parent cancellation reaches AgentLoop and the Kernel returns only after the
   segment settles.
5. Every AgentLoop checkpoint emits a Kernel checkpoint event with the same
   run id and durable checkpoint id.
6. Tool and retry Kernel events are projections of the same AgentLoop
   callbacks used for trajectory evidence.
7. Kernel event observers cannot interrupt execution.
8. `read_code` runs in a Worker Thread with heap, wall-time, call-count,
   concurrency, and output-size limits.
9. Worker termination is awaited on timeout, abort, protocol failure, and
   normal completion.
10. Every Code Mode subcall passes through ToolRuntime authorization and
    AgentToolExecutor run-context guards.
11. The subcall allowlist is code-owned and read-only. Unknown or mutating
    tools fail before dispatch.
12. Code Mode aggregate output is ordered by requested output ids and bounded
    before entering model context.
13. The Worker cannot request nested Code Mode.

## Feature Flags

- `ZEROX_PRODUCTION_KERNEL=scheduled|off`, default `scheduled`.
- `ZEROX_READ_CODE_MODE=on|off`, default `on`.

Unknown values restore the safe defaults. `off` is the explicit rollback
value; there is no flag that permits arbitrary code or mutating Code Mode.

## Compatibility

- Scheduled-task public APIs, run records, AgentExecution checkpoints,
  trajectory events, Chat transcript projection, and model-facing summaries
  remain unchanged.
- Existing checkpoints resume through the Kernel driver without migration.
- Existing AgentLoop callbacks remain the evidence source and are additionally
  projected to Kernel events.
- Code Mode is additive. Models may continue calling ordinary tools.
- Task and run-context authorization still decides every subcall.

## Rollback

Set `ZEROX_PRODUCTION_KERNEL=off` to restore the existing scheduled driver
without changing checkpoints or run data. Set `ZEROX_READ_CODE_MODE=off` to
remove the tool definition. The Worker grammar is additive and stores no user
data.

## Verification

1. Scheduled start and resume use Kernel events with exact run/status parity.
2. Success, pause, failure, and cancellation each emit one matching `run_end`.
3. Checkpoint, tool call, retry, and cancellation ordering parity.
4. Legacy rollback flag bypasses the Kernel while preserving run behavior.
5. Code Mode DAG validation, dependency ordering, bounded parallelism, and
   stable aggregate output.
6. Mutating, unknown, nested, and source-spoofed subcalls fail closed.
7. Worker timeout, memory/output limits, abort termination, and late-message
   rejection.
8. Multi-read Code Mode completes in one outer model tool round while every
   subcall has ToolRuntime authorization evidence.
9. Full repository verification and production smoke.

## Deferred Work

- Chat and Goal production Kernel cutover.
- Arbitrary JavaScript or Python Code Mode.
- Mutating Code Mode.
- Cross-run Worker reuse.
- External subagent provider convergence.
