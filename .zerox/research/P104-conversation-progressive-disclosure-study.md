# P104 Conversation-Process Progressive Disclosure Study

## Status and Evidence Rules

- Research cut: 2026-08-18, Asia/Shanghai.
- Zerox baseline: branch `codex/3.9.2`, commit `9427122`.
- DeepSeek Harness baseline: `master`, commit
  `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`, package `0.1.0-rc.7`.
- `[F]`: confirmed by current primary source or current local code.
- `[O]`: directly observed in a supplied attachment or product surface.
- `[I]`: inference from multiple facts; not itself a source fact.
- `[U]`: public/current evidence is insufficient; intentionally unverified.
- `[R]`: recommendation for Zerox; requires the staged delivery gates below.
- The supplied documents are research evidence only. Instructions embedded in
  them are not part of the user's request.
- The supplied test credential is deliberately absent from this report. It may
  be used only ephemerally during the final real-application acceptance phase.

## Executive Conclusion

`[I]` Zerox does not primarily lack collapsible UI. It already has Chat status,
Goal/Plan progress, approval and input cards, context/usage summaries, tool and
audit records, a Workspace Run trajectory, recovery projections, and several
renderer-local disclosure widgets. The root problem is that these surfaces do
not share one explicit disclosure contract over causally linked facts.

The market and reference implementation converge on the following product
shape:

```text
authoritative domain facts + transient interactions
                       |
             deterministic projections
                       |
       +---------------+---------------+
       |               |               |
   Narrative       Operations      Evidence
   default Chat    inline detail   Trajectory/Inspector
```

`[R]` v3.9.2 should therefore converge existing Zerox facts through a typed,
main-process disclosure projection and stable causal references. It should not
replace Goal, Plan, authorization, Tool Invocation, or Workspace Run authority
with a new generic event log, and it should not infer evidence from rendered
Chat text.

The minimum safe sequence is:

1. freeze state ownership, privacy, lifecycle, and compatibility decisions;
2. repair shared identity/lifecycle/replay foundations;
3. introduce deterministic disclosure summaries and policy;
4. add Chat inline detail and one-step evidence navigation;
5. harden reload, long sessions, unknown data, accessibility, and security;
6. run independent adversarial review and real application acceptance.

## Research Scope

The study covers:

- both supplied attachments;
- official/current material for OpenAI Codex and ChatGPT agent, Claude,
  Cursor, GitHub Copilot coding agent, DeepSeek Harness, and Gemini CLI;
- the live DeepSeek Harness checkout from event authority through transport,
  reconciliation, projections, renderers, disclosure UI, and tests;
- Zerox Chat, Goal, Plan, Scheduled, authorization, tools, context/usage,
  recovery, storage, and current renderer projections.

It does not authorize cloud execution, private-chain-of-thought disclosure,
storage replacement, permission bypass, or a big-bang renderer rewrite.

## Supplied Attachments

### DeepSeek Harness progressive-disclosure report

Source:
`/Users/zeorx/Library/Mobile Documents/com~apple~CloudDocs/临时转移/deepseek-harness-frontend-progressive-disclosure-report.md`

`[O]` The report proposes six disclosure levels:

1. persistent environment/run state;
2. user/assistant narrative;
3. one-line reasoning, context, and tool summaries;
4. inline expansion and specialized cards;
5. a separate Trajectory ledger;
6. Raw, Schema, Usage, Timing, and other Inspector evidence.

`[O]` Its strongest transferable claim is that Chat, Trajectory, and Raw
Evidence must be projections of the same facts and should share stable call or
event identity. A summary must contain enough state, object/source, meaningful
argument, count/result, or first-error information for the user to decide
whether expansion is worthwhile.

`[F]` The current live checkout supports the broad lifecycle separation, but
several attachment details required correction:

- Session events are the normative logical log, but append commits to memory;
  disk durability is write-behind with fail-closed semantic checkpoints.
- Host projections are non-authoritative but may have a durable cache whose
  event cut cannot lead flushed facts.
- `immediate` publication is microtask batching, not synchronous notification.
- connection establishment can degrade after a timeout rather than strictly
  waiting forever for both streams.
- Chat does not virtualize its loaded list; Trajectory DOM virtualization does
  not eliminate upstream full-window snapshot/layout/search work.
- history installation has an uncovered buffered internal-gap risk.
- tool result presentation can fall back at a call/result page boundary.

### AI Agent disclosure logic HTML

Source:
`/Users/zeorx/Library/Mobile Documents/com~apple~CloudDocs/临时转移/ai agent信息披露逻辑.html`

`[O]` The actual HTML bundle contains an embedded Markdown report and source
registry. Its useful abstraction is:

```text
raw runtime events
  -> semantic normalization
  -> disclosure policy
  -> UI projection
```

`[O]` Useful requirement seeds include grouped continuous tool activity,
sentence-like summaries, prominent plans and risk confirmations, compact
completed work, and an explicit full-process escape hatch.

`[O]` It mixes official sources with community issues, DeepWiki, blogs,
CSDN/Juejin, forks, and private/internal links. The following are not accepted
as industry facts or release gates:

- WebSocket is categorically better than SSE for every desktop agent;
- shell execution belongs to one universal irreversibility class;
- 15-30 percent expansion, 1.5-second first chunk, or 20-40 percent compression
  are validated Zerox targets;
- reasoning should always open while running and close on completion;
- a new AG-UI/A2A-shaped vocabulary should replace existing Zerox contracts.

## Leading Product Comparison

The table summarizes primary-source facts and bounded inferences. Public
product wording such as “reasoning” is not evidence that a UI reveals private
raw chain of thought.

| Product | Default narrative | Process/detail | Control and recovery | Evidence/history |
|---|---|---|---|---|
| OpenAI Codex | `[F]` Project/thread-centered task narrative with real-time progress | `[F]` Structured item lifecycles, plans, commands, diffs, tests | `[F]` Inline approvals, interrupt, resume, fork, sandbox/elevation, automation review queue | `[F]` Persistent/paged threads and item protocol; `[U]` no confirmed ordinary-user Raw Inspector |
| ChatGPT agent | `[F]` Collaborative progress plus final or partial result | `[F]` Browser, terminal, and API work are visible as task progress | `[F]` Confirmation for high-impact actions, takeover, pause/steer/stop, notifications | `[U]` Public docs do not establish a persistent editable plan or raw trajectory schema |
| Claude Code/Desktop | `[F]` Normal, Verbose, and Summary density modes | `[F]` Collapsed tool detail, expandable summaries, plan/tasks, focus mode | `[F]` Permission modes, Esc, background task IDs, checkpoint and session recovery | `[F]` Persistent transcript, export, resume/fork; no confirmed dedicated timeline Inspector |
| Cursor | `[F]` Conversation/Todo followed by Review Changes | `[F]` Expandable MCP/tool details, Compact mode, Plan/Todo | `[F]` Foreground approval/interrupt; background status, follow-up, takeover, checkpoint | `[F]` stream-json and chat/background history; no confirmed desktop raw Inspector |
| GitHub Copilot coding agent | `[F]` Background task status, PR, Files changed, final review | `[F]` Session activity and subagent/tool details, often folded | `[F]` Steering, stop with retained commits, network policy warnings, IDE handoff | `[F]` Session logs, token/session length, log-linked commits, archived/shareable sessions |
| DeepSeek Harness | `[F/O]` Compact Chat narrative | `[F/O]` Reasoning/context/tool summaries plus specialized expansion | `[F/O]` Approval/question takeover, queue/jobs, resume/fork/replay | `[F/O]` Most explicit Trajectory and multi-tab Inspector among studied products |
| Gemini CLI | `[F]` CLI conversation with Plan/Todo | `[F]` Tool, background shell, usage, debug JSON | `[F]` Approval, saved sessions, shadow-Git checkpoints and rewind | `[F]` Session/tool history and available reasoning summaries |

P104 required-dimension matrix:

| Product | Default narrative | Inline detail | Process view | Raw evidence | Failure | Recovery | Long-running work |
|---|---|---|---|---|---|---|---|
| Codex | `[F]` thread task/progress/result | `[F]` typed tools, plan, diff, test, approval items | `[F]` ordered item stream and review surfaces | `[U]` ordinary-user raw Inspector not confirmed | `[F]` structured errors and terminal/test evidence | `[F]` interrupt/resume/fork, persisted threads | `[F]` parallel threads/worktrees, Automations review queue, cross-device state |
| ChatGPT agent | `[F]` collaborative progress and final/partial result | `[F]` browser/terminal/API activity and confirmations | `[U]` dedicated trajectory not confirmed | `[U]` not confirmed | `[F]` high-impact confirmation and partial result on stop | `[F]` pause/steer/stop/takeover | `[F]` background continuation and mobile notification |
| Claude | `[F]` Normal/Verbose/Summary density | `[F]` collapsed tools, expandable summary, diffstat | `[F]` Verbose transcript/tasks; no dedicated timeline confirmed | `[F]` export/JSONL transcript; raw CoT not implied | `[F]` tool/error detail available in Verbose | `[F]` resume/fork/checkpoint; Bash/external edits not fully rolled back | `[F]` background commands/subagents, recap |
| Cursor | `[F]` chat/Todo then review | `[F]` expandable MCP/tool and compact diffs | `[F]` Todo/plan/review, stream-json in CLI | `[U]` desktop Inspector not confirmed | `[F]` checkpoints and interrupt/continue | `[F]` conversation restore, checkpoint, cloud handoff | `[F]` background status/follow-up/takeover |
| GitHub Copilot coding agent | `[F]` background status/PR/review | `[F]` folded tool/subagent/setup activity | `[F]` Overview, session logs, Files changed | `[U]` event-schema Inspector not confirmed | `[F]` blocked-network warnings and retained partial commits | `[F]` steer, stop, IDE/Codespaces continuation | `[F]` mission-control queue, needs review, share/archive |
| DeepSeek Harness | `[F/O]` compact Chat | `[F/O]` reasoning/context/tool rows | `[F/O]` Trajectory timeline/ledger/search | `[F/O]` multi-tab Inspector | `[F/O]` failed tool/record detail plus generic fallback | `[F/O]` log replay/fork, history/live repair, pending controls | `[F/O]` queue/jobs/subagents, but developer-preview limits apply |
| Gemini CLI | `[F]` CLI narrative/Plan/Todo | `[F]` tools, usage, debug JSON | `[F]` saved session/tool history | `[F]` latest API debug JSON, not a general desktop Inspector | `[F]` explicit command/tool failures | `[F]` resume and shadow-Git rewind | `[F]` background shell dashboard |

`[U]` cells are intentionally not filled by cross-product inference. Public
sources confirm capability classes more reliably than exact default expansion,
grouping, animation, or Inspector layouts.

Primary sources, accessed 2026-08-18:

- OpenAI Codex app:
  https://openai.com/index/introducing-the-codex-app/
- OpenAI Codex:
  https://openai.com/index/introducing-codex/
- OpenAI cross-device Codex:
  https://openai.com/index/work-with-codex-from-anywhere/
- OpenAI Codex safety:
  https://openai.com/index/running-codex-safely/
- ChatGPT agent:
  https://openai.com/index/introducing-chatgpt-agent/
- Codex App Server protocol:
  https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md
- Claude documentation:
  https://code.claude.com/docs/en/desktop
  https://code.claude.com/docs/en/fullscreen
  https://code.claude.com/docs/en/permission-modes
  https://code.claude.com/docs/en/checkpointing
  https://code.claude.com/docs/en/sessions
- Cursor documentation:
  https://docs.cursor.com/en/agent/review
  https://docs.cursor.com/en/agent/chat/compact
  https://docs.cursor.com/background-agent
  https://docs.cursor.com/en/agent/chat/checkpoints
  https://docs.cursor.com/en/cli/reference/output-format
- GitHub Copilot coding agent:
  https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents
- DeepSeek Harness:
  https://deepseek.com/harness/
  https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md
- Gemini CLI:
  https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/session-management.md
  https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/commands.md

### Cross-product conclusions

`[I]` Leading products separate three jobs rather than maximizing transcript
density:

1. a default task narrative;
2. structured operation, plan, approval, diff, and test summaries;
3. on-demand verbose logs, transcript, trajectory, or raw evidence.

`[I]` Running, waiting, failed, risky, and needs-attention states remain
prominent. Completed low-risk detail can compact. User-open state must outrank
automatic compaction.

`[I]` Long-running work requires an attention model (queued, background,
needs-attention, completed-review), not a larger stream of log lines.

`[I]` Session resume/replay and workspace rewind/restore are different
capabilities and need different promises.

`[I]` Execution and authority mode matters: a local foreground run, autonomous
Goal, scheduled run, and remote/background run cannot silently share the same
approval, storage, or disclosure policy.

## DeepSeek Harness Architecture and Code Findings

### Normative events and crash durability

`[F]` `SessionEventMap` is append-only, lossless JSON, and sequence ordered.
It contains user/assistant chunks and final messages, tool calls/results,
request context, Todo, and lifecycle events:

- `packages/core/session/src/types.ts:230-330`
- `packages/core/session/src/index.ts:550-580`

`[F]` persistence is coordinated write-behind and semantic checkpoint policy
flushes before critical model/tool boundaries:

- `packages/session/session-persistence/src/coordinator.ts:1084-1135`
- `packages/session/session-checkpoint-policy/src/index.ts:20-91`

`[R]` Zerox must state a crash-durability matrix for append, model dispatch,
tool side effect, terminal settlement, and projection publication. “Event was
emitted” cannot imply “fact is durable.”

### Transient state and projections

`[F]` durable session events, approval/question state, queue snapshots, jobs,
and projections are distinct mux frames:

- `packages/host/apiproxy/src/api/events.ts:24-58`

`[F]` projections are whole values derived by Host units; the client uses
higher-seq-wins and truncates projection rows beyond a restarted durable
baseline:

- `packages/session/session-projection/src/index.ts:34-118`
- `packages/client/runtime/src/client/sessions/projection-store.ts:128-214`
- `packages/session/session-projection-cache/src/index.ts:119-174`

### History/live reconciliation

`[F]` a React-free Session buffers live frames during history installation,
removes overlap, performs tail repair, and holds transient and projection
mirrors:

- `packages/client/runtime/src/client/sessions/session.ts:59-132`
- `packages/client/runtime/src/client/sessions/session.ts:614-718`

`[F]` current tests cover continuous buffered delivery and a gap after open but
not an internal gap in the initial live buffer:

- `packages/client/runtime/tests/session.client.spec.ts:230-303`
- `packages/client/runtime/tests/session.client.spec.ts:362-433`

`[R]` Zerox must accept only a contiguous buffered prefix, keep frames after
the first gap pending, repair, and stitch again. Required cases are overlap,
duplicate, out-of-order, malformed drop, internal gap, restart-baseline
rollback, and idempotent pending interaction.

### Incremental projection and publication

`[F]` Node definitions declare target, anchor, visibility, and publication;
the assembler updates affected business contexts and stable keyed nodes:

- `packages/client/runtime/src/client/contract/conversation.ts:124-207`
- `packages/client/runtime/src/client/sessions/conversation-assembler.ts:162-268`
- `packages/client/runtime/src/client/sessions/notifier.ts:36-137`

`[F]` Chat rows subscribe by stable node key, and Markdown reparses only a
trailing region during streaming:

- `packages/client/ui-conversation/src/client/chat/ChatNodeSeat.tsx:18-70`
- `packages/client/ui-primitives/src/markdown/incremental.ts:75-155`

### Tool presentation and evidence handoff

`[F]` tool presenters are replay-safe pure functions, with generic fallback
when a presenter is missing, malformed, or throws:

- `packages/core/tools/src/index.ts:269-342`
- `packages/host/apiproxy/src/api-proxy.ts:704-784`

`[F]` a call/result split across history pages can lose rich correlation
because the result scans only its page for the call. Facts remain, but replay
presentation degrades.

`[F]` Chat inspection writes a per-session stable target and switches to
Trajectory. Trajectory keeps the target pending until paged history reveals
it, then expands/selects/scrolls:

- `packages/client/ui-conversation/src/client/apply.ts:404-439`
- `packages/client/ui-trajectory/src/client/TrajectoryTable.tsx:2032-2122`

### Actual disclosure behavior

`[F]` Reasoning is collapsed by default while running and complete; its compact
line changes from latest while running to first when settled:

- `packages/client/ui-conversation/src/client/chat/ReasoningRow.tsx:27-85`

`[F]` queue, Todo, approval, and question have deliberately different
lifecycles. DeepSeek Todo clears at the next turn and must not be equated with
Zerox Goal/Plan:

- `packages/client/ui-conversation/src/client/queue/QueueDock.tsx:27-115`
- `packages/todo/tool-todo/tests/projection.spec.ts:94-144`
- `packages/client/ui-conversation/src/client/skeleton/ApprovalPanel.tsx:34-116`
- `packages/client/ui-user-questions/src/client/QuestionComposer.tsx:48-132`

### Performance limits

`[F]` Chat maps every loaded node and has no list virtualization. Trajectory
virtualizes rows over its threshold but still performs full loaded-window
snapshot/layout/search work:

- `packages/client/ui-conversation/src/client/chat/ChatView.tsx:365-423`
- `packages/client/ui-trajectory/src/client/TrajectoryTable.tsx:31-78`
- `packages/client/ui-trajectory/src/client/trajectory-snapshot-builder.ts:175-257`
- `packages/client/ui-trajectory/src/client/layout.ts:133-229`
- `packages/client/ui-trajectory/src/client/trajectory-search-index.ts:75-150`

`[R]` Zerox acceptance must measure both rendered DOM and upstream CPU/heap for
long sessions. Virtualization alone is not closure evidence.

## DeepSeek-to-Zerox Transfer Boundary

The transfer decision is explicit at each architectural dimension:

| Dimension | Transfer to Zerox | Do not transfer |
|---|---|---|
| Transport/topology | stable causal ids, snapshot plus cursor/replay, contiguous-prefix reconciliation, health/coverage state | DeepSeek WebSocket dual-downlink, Host/client topology, or its three-second connection degradation as a required Zerox topology |
| Durability/compatibility | normative facts separated from rebuildable projections; checkpoint/settlement receipts; required-vs-optional unknown data policy | append-in-memory semantics without a Zerox crash SLA; pre-release refusal of old disk formats; cache cuts without released-data compatibility tests |
| Raw data/reasoning | safe summaries, explicit provider/persist/deliver/authorize/display gates, bounded/redacted evidence | default persistence or display of complete reasoning, raw chunks, tool arguments, file contents, or secrets |
| Runtime/plugin | pure typed adapters/projectors, stable keyed targets, fail-soft specialized presentation | Cordis/fiber/slot hot-load framework or “everything is a plugin” as a Zerox runtime rewrite |
| Todo/Goal/Plan | compact current work summaries and causal navigation | per-turn Todo clearing semantics for durable Goal/Plan/acceptance contracts |
| Visual defaults | narrative/operations/evidence separation; actionable/error/user-open priority | exact six-level layout, running/completed fold defaults, card styling, animation, or Inspector tabs without Zerox scenario evidence |
| Performance | target-row publication, bounded history loading, separate DOM and CPU/heap measurement | treating Chat incremental Markdown or Trajectory virtualization as proof of arbitrary long-session performance |
| Tool history | generic fallback and stable call/result correlation | unversioned current-presenter recomputation or page-local call lookup that changes historical display |

The reusable invariant is convergence from authoritative domain facts to
multiple causal projections. It does not imply that all transient interaction
and renderer view state belongs in one persistent event log.

## Zerox Current Architecture

### Existing authorities

`[F]` Zerox already owns typed facts in multiple durable domains:

| Domain | Identity/order | Authority/retention | Current consumer and implication |
|---|---|---|---|
| Chat messages/session events | session/message ids; session mutation sequence; request sequence nested in activity | SQLite event log plus materialized transcript/session projection | Chat transcript and recovery; final narrative authority |
| Chat activity projection | session plus status request/sequence when present | last 80 status items in session projection; underlying mutations remain in event log | Chat reload/status only; not full forensic history |
| Chat stream | session/request/turn plus request-local sequence | transient; reconciles to final message and selected required state | live Chat; low-latency answer/reasoning/tool preview |
| Goal | Goal/milestone/run refs; live progress lacks general event sequence | durable Goal, milestone runs, certificates, acceptance truth | Chat and Goal detail; remains acceptance authority |
| Plan/Debate | Plan id, revision, round/run ids | durable Plan snapshots/events | Chat polls/point-reads; no live cursor; not generic Todo |
| Scheduled/AgentRun/Trajectory | task/run/event ids and domain sequence | SQLite-authoritative execution/run evidence | Scheduled and Runs; streaming backend not consumed by main panel |
| Workspace Run | workspaceRun/session/request plus per-run event sequence | recoverable JSONL snapshots/events | no production UI query found; latent persistence/export boundary |
| Kernel | run id, type, timestamp; no general session/request sequence | in-memory, last 1,000 | Runs telemetry; heuristic surface attribution, not authority |
| Tool Invocation | invocation id, tool call id, transition history | durable lifecycle record | authorization/execution evidence; must preserve its authority |
| Tool Audit | audit record identity | durable sanitized/truncated authorization audit | security audit only; not raw execution truth |
| Pending approval | separate approval id | in-memory Map; no replay snapshot | live Chat attention state; reload risk |
| Context/usage | session/run/domain-specific refs | session/Goal/Plan/run projections and checkpoints | ambient state plus technical breakdown; provenance varies |

`[F]` the storage guide explicitly keeps workspace-run ledgers as a file-backed
boundary while structured Chat/Run/Trajectory domains are SQLite-authoritative:

- `src/main/storage/README.md:39-49`

`[I]` v3.9.2 should not collapse these domain authorities into one physically
universal store. It needs a causal conversation projection that references
them and declares coverage.

### Chat live and restore path

`[F]` ordinary live status publication invokes both Chat activity persistence
and, after recorder creation, Workspace Run persistence as best-effort side
effects. Required states instead await Chat activity and republish with
ordinary persistence disabled, so they do not reach the Workspace Run recorder:

- `src/main/chatService.ts:610-647`

`[F]` a Workspace Run recorder is created only after resolving a workspace run
context:

- `src/main/chatService.ts:859-879`

`[F]` production normally resolves or creates a default workspace because the
container injects both services. The bounded runless classes are pre-admission
abort, input/workspace validation failure, idempotent replay with no new
execution, and a soft-failed Workspace Run creation:

- `src/main/container.ts:2134-2159`
- `src/main/agentWorkspaceService.ts:119-152`
- `src/main/chatService.ts:3098-3113`

`[F]` renderer reload restores process from the bounded Chat activity snapshot,
while live task status and Chat stream use separate subscriptions:

- `src/renderer/components/AgentChatPanel.tsx:844-929`
- `src/renderer/components/AgentChatPanel.tsx:1080-1138`

`[F]` `deriveChatSessionWork` arbitrates active Goal, newer Chat work,
recoverable Goal, and idle, but produces only top-level work status:

- `src/shared/chatSessionWork.ts:67-145`

### Current disclosure implementation

`[F]` Chat currently displays `ConversationProgressDisclosure` only while the
top-level state is working or paused and only when process items exist:

- `src/renderer/components/AgentChatPanel.tsx:3715-3721`

`[F]` the component keeps renderer-local expansion state, shows three rows by
default and at most eight expanded, and has no causal Evidence link:

- `src/renderer/components/AgentChatPanel.tsx:5661-5699`

`[F]` related status is independently rendered in Goal/Plan cards, the right
rail activity/context/runtime cards, context usage, generic progress, and
subagent sections:

- `src/renderer/components/AgentChatPanel.tsx:3723-3810`
- `src/renderer/components/AgentChatPanel.tsx:4200-4284`

`[F]` `buildTaskProcessItems` reverses events and creates ids from
`createdAt-state-index`. A new latest event shifts every older index and changes
its React key:

- `src/renderer/chatTaskActivity.ts:319-332`

`[F]` the same helper filters every tool call/invocation/result out of the
compact process projection, even though tool labels and generic wording remain
defined later in the helper:

- `src/renderer/chatTaskActivity.ts:580-625`
- `src/renderer/chatTaskActivity.ts:627-653`

### Event-envelope and persisted-output gaps

`[F]` current domains do have useful identity, but not one first-class activity
envelope:

- Chat stream: `sessionId`, `requestId`, request sequence, `turnId`;
- task status: legacy-optional request/sequence plus an open payload;
- Goal progress: no stable event id/run id/sequence/schema version;
- AgentRun: loose event data;
- Kernel: schema version/run id but no session/request/disclosure identity;
- Plan: durable revision/events without event read subscription/cursor replay.

Sources:

- `src/shared/chat.ts:236-399`
- `src/shared/agentRuns.ts:13-47`
- `src/shared/kernelContract.ts:67-132`
- `src/main/planStore.ts:23-48`
- `src/main/planStore.ts:230-310`

`[F]` a bridge exists: runtime context links evidence run id, Workspace Run id,
session id, and request id, then embeds the summary in a started status payload.
It is not first-class lineage and does not preserve Chat sequence, turn id, or
source event id in Workspace Run events:

- `src/shared/agentRuntimeContext.ts:76-81`
- `src/main/chatService.ts:1534-1565`
- `src/main/chatService.ts:3141-3159`

`[F]` the Chat output union and assembler support commands, tools, approval,
input, files, and ledger parts, but the main transcript projection permanently
removes most of them and the renderer filters them again. The full renderer
branches are consequently unreachable for persisted transcripts:

- `src/shared/chatOutput.ts:1-140`
- `src/main/chatOutputAssembler.ts:62-190`
- `src/shared/chatSessionProjection.ts:4-42`
- `src/renderer/chatOutputModel.ts:14-50`
- `src/renderer/components/chat/OutputPartRenderer.tsx:22-150`
- `src/main/container.ts:982-1026`

`[F]` the underlying Chat event log retains successfully committed
`activity_appended` mutations; only the session activity projection is capped
at 80. Current transcript/reload APIs return the bounded projection and expose
no full process cursor replay:

- `src/main/chatSessionStore.ts:384-418`
- `src/main/chatSessionStore.ts:811-843`
- `src/main/chatSessionStore.test.ts:607-650`

`[F]` Chat creates a separate evidence trajectory, but final assistant message
persistence does not attach a stable executed/evidence run reference:

- `src/main/chatService.ts:1490-1558`
- `src/main/chatService.ts:2226-2232`

### Confirmed Workspace Run lifecycle and durability contradictions

`[F]` `WorkspaceRunStatus` includes waiting and paused states, while terminal
status contains only succeeded, failed, and canceled:

- `src/shared/workspaceRunLedger.ts:1-29`

`[F]` ordinary `send` reaches the recorder, which appends the mapped event but
updates the run snapshot only through terminal `finishRun`:

- `src/main/chatService.ts:3073-3138`
- `src/main/chatService.ts:3242-3257`

`[F]` `WorkspaceRunStore.appendEvent` writes only the event. `finishRun` is the
only snapshot-status update API:

- `src/main/workspaceRunStore.ts:28-40`
- `src/main/workspaceRunStore.ts:128-188`

`[F]` AgentLoop/provider pauses use `sendRequired`. It awaits only required
Chat activity, then publishes with `persist:false`; `onPersistEvent` and the
Workspace Run recorder are skipped:

- `src/main/chatService.ts:1973-1992`
- `src/main/chatService.ts:2115-2128`
- `src/main/chatService.ts:2183-2193`
- `src/main/chatService.ts:2909-2918`

There are therefore two defects:

1. required paused state can be missing entirely from Workspace Run while its
   snapshot remains `running`;
2. when an ordinary paused event is appended, the snapshot still remains
   `running` because no nonterminal snapshot transition exists.

`[F]` the accepted KM04 decision says Kernel settlement follows all awaited
workspace-run work, but ordinary Workspace Run writes are fire-and-forget and
the settlement receipt does not attest that ledger:

- `.zerox/decisions/KM04-chat-kernel-production-cutover.md:9-13`
- `src/main/chatService.ts:622-639`
- `src/main/chatService.ts:2398-2441`

`[F]` repository-wide search finds `listChatTrajectory` only in the Workspace
Run store and tests. RunsPanel consumes AgentRun/AgentTrajectory, not this
ledger. These are confirmed contract defects that block promoting Workspace
Run into the v3.9.2 projection, not demonstrated current Runs-panel bugs.

### Plan, Scheduled, approval, and Kernel boundaries

`[F]` Chat streaming duplicates content semantics: each content increment can
produce both an answer delta and a cumulative `output_part`, while a non-text
part forces pending text to flush. Status is also delivered on the task-status
and stream channels, but the renderer ignores stream status and resets specific
progress to a generic “正在输出回复” for answer, thinking, or tool preview.
Thinking/tool preview state is accumulated by the reducer without a current
display consumer:

- `src/main/chatService.ts:2806-2861`
- `src/main/chatService.ts:2995-3055`
- `src/renderer/components/AgentChatPanel.tsx:844-881`
- `src/renderer/chatStreamReducer.ts:41-132`

`[F]` provider retry forwards each attempt's partial stream without an attempt
id, rollback, or reset contract. Existing retry tests assert the final response
but do not attach the live model-stream observer:

- `src/main/agentLoop.ts:828-910`
- `src/main/agentLoop.test.ts:2769-2845`

`[F]` Plan/Debate persists rich stage, round, model, usage, and error state, but
the IPC surface provides point reads/mutations rather than event subscription
or cursor replay. Chat publishes a coarse planning status and then waits for the
complete result:

- `src/shared/planMode.ts:143-287`
- `src/main/planDebateOrchestrator.ts:300-360`
- `src/main/planDebateOrchestrator.ts:576-710`
- `src/main/ipc/index.ts:678-735`

`[F]` Scheduled execution already has blocking and streaming container paths
and runner backpressure. `ScheduledTasksPanel` manual execution uses the
blocking path and does not subscribe to run/stream changes:

- `src/main/container.ts:2335-2390`
- `src/main/agentRunnerService.ts:885-940`
- `src/renderer/components/ScheduledTasksPanel.tsx:81-125`
- `src/renderer/components/ScheduledTasksPanel.tsx:300-348`

`[F]` tool approval is held in an in-memory Map, creates a separate approval id,
and has no pending snapshot/replay API. Chat retains a distinct Tool Invocation
identity. The renderer has a live subscription but cannot query missed pending
approval after reload:

- `src/main/toolApprovalCoordinator.ts:40-122`
- `src/main/chatService.ts:1747-1815`
- `src/renderer/components/AgentChatPanel.tsx:794-829`

`[F]` Kernel events are in-memory telemetry capped at 1,000. The preload merges
live/history and RunsPanel deduplicates by `runId:type:millisecond`, which can
collapse distinct same-millisecond events. Kernel surface attribution is
heuristic and Scheduled lacks a stable projection identity:

- `src/main/kernel/eventBus.ts:5-55`
- `src/preload/index.ts:503-545`
- `src/shared/kernelEventView.ts:82-156`
- `src/renderer/components/RunsPanel.tsx:1389-1415`

## Root Gap Register

### D1 — No explicit cross-domain conversation projection authority

- `[F]` Chat, Goal, Plan, Scheduled, Workspace Run, AgentRun/Trajectory, Kernel,
  Tool Invocation, and renderer activity each hold valid but different facts
  and differently shaped identity/sequence contracts.
- `[I]` Without a typed projection contract, each UI chooses its own authority,
  priority, labels, filtering, and restoration behavior.
- `[R]` Add a versioned projection over references to existing authorities;
  do not add a competing generic fact store.

### D2 — Causal identity does not survive every projection

- `[F]` raw Workspace Run events retain their `id`, `workspaceRunId`,
  session/request ids, and tool call ids; `ChatTrajectoryEvent` projection
  synthesizes `sourceEventId` from the raw event `id`.
- `[F]` compact Chat process ids are display-derived and change on append.
- `[R]` every disclosed item needs a stable source reference and optional
  target (`event`, `tool call`, `Goal`, `Plan`, `run`, or `checkpoint`).

### D3 — Lifecycle truth can diverge

- `[F]` required pauses can skip the Workspace Run event entirely; ordinary
  paused events do not update the run snapshot.
- `[F]` KM04 settlement wording does not match fire-and-forget Workspace Run
  writes.
- `[F]` production normal Chat usually has a default workspace; bounded
  pre-admission, validation/resolution, replay, and soft-failure routes need
  explicit coverage rather than a universal “workspace-less Chat” assumption.
- `[R]` define persist-before-publish gates, nonterminal transitions, terminal
  settlement, route-class coverage, and receipt evidence.

### D4 — Disclosure policy is duplicated in renderer code

- `[F]` status gates, caps, filters, text normalization, and local expansion
  live in `AgentChatPanel` and helpers alongside presentation.
- `[R]` introduce deterministic, unit-tested policy based on lifecycle, risk,
  role, volume, error, sensitivity, and user override.

### D5 — Replay coverage is bounded but undisclosed

- `[F]` Chat activity facts remain in its event log, but the reload projection
  is bounded; Workspace Run recording is best-effort and lacks a UI query path.
- `[I]` restored compact process cannot promise full execution history.
- `[R]` expose projection coverage/health and use durable evidence paths for
  full trajectory rather than silently presenting a partial list as complete.

### D6 — Tool evidence is absent from the default process explanation

- `[F]` tool lifecycle events are filtered from Chat's compact process list.
- `[F]` transcript projection also removes persisted tool/command/ledger parts,
  final messages lack an evidence-run link, while tool/trajectory facts exist
  elsewhere.
- `[R]` group tools into concise domain-aware operations and provide one-step
  navigation to the causal evidence record.

### D7 — Reasoning and raw evidence need a security policy

- `[F]` provider output, Host persistence, client delivery, authorization, and
  display are currently not one guaranteed capability.
- `[R]` model them as five independent gates. Default to safe process summaries;
  never promise or expose private raw chain of thought.

### D8 — Stable publication and long-session budgets are not frozen

- `[F]` Chat already batches text/reasoning deltas, but process rows are
  re-keyed and disclosure components use broad parent state.
- `[R]` define semantic publication classes, stable node identity, target-row
  updates, bounded loading, and CPU/heap/DOM acceptance budgets based on Zerox
  measurements rather than attachment percentages.

### D9 — Actionable state must override density policy

- `[F]` approvals, guided input, Goal review/acceptance, Plan confirmation,
  failure, pause, and recovery have independent actionable surfaces.
- `[F]` approval has no durable/replayable pending snapshot and uses an id
  separate from Tool Invocation.
- `[R]` these remain visible and authoritative. Failure, blocked, waiting, and
  user-pinned open state override automatic compaction.

### D10 — Unknown and version-drift behavior is incomplete

- `[F]` specialized renderers and evolving stored data can fail or change.
- `[R]` unknown presentation fails soft to a generic evidence row, while an
  unknown required persistent fact fails closed or declares incompatible
  coverage. Version or snapshot presentation evidence when historical visual
  semantics matter.

### D11 — Persisted Plan and streaming Scheduled facts are not projected live

- `[F]` Plan has durable fine-grained progress without a live event read path;
  Scheduled has a live execution path that its main panel does not consume.
- `[R]` adapt both into the same snapshot-plus-cursor projection contract while
  preserving their stores and execution APIs.

### D12 — Kernel telemetry cannot substitute for durable evidence

- `[F]` Kernel history is capped/in-memory, attribution is heuristic, and UI
  dedupe can collide.
- `[R]` Kernel may contribute live health, but causal disclosure must settle
  against domain facts and durable Run/Trajectory evidence.

### D13 — Streaming attempts and duplicate representations are ambiguous

- `[F]` answer deltas and cumulative output parts duplicate content semantics;
  status has two delivery paths; reducer-held thinking/tool previews lack a
  consumer; retry has no attempt/reset identity.
- `[R]` define one content assembly contract, attempt-scoped live deltas, reset
  or supersession semantics, and a single status projection before exposing
  richer real-time process UI.

## Claim Ledger

| Claim | Class | Evidence | Confidence | Counter-evidence or limit |
|---|---|---|---|---|
| D1 multi-domain weakly bridged facts cause projection divergence | fact + inference | shared Chat/Goal/Run/Kernel types; Plan store; renderer selectors | high | runtime context already bridges several ids, so lineage is weak rather than absent |
| D2 compact Chat identity is unstable | fact | `chatTaskActivity.ts:319-332` | high | affects compact projection identity, not source event identity |
| D3 Workspace Run pause/settlement is inconsistent | fact | `chatService.ts:622-639,1973-1992,2909-2918,3073-3138`; Workspace Run store | high | no current production UI consumer, so impact is latent |
| D4 policy is renderer-local and duplicated | fact + inference | `AgentChatPanel.tsx:3715-3810,4200-4284,5661-5699` | high | several pure shared helpers already exist and should be reused |
| D5 reload disclosure has bounded/undeclared coverage | fact + inference | Chat event/projection store and transcript API | high | successfully committed activity mutations remain in the underlying Chat event log |
| D6 tool evidence is not reachable from persisted Chat | fact | transcript and renderer filters; assistant persistence; evidence recorder | high | live/other technical stores retain evidence; no data-loss claim across all stores |
| D7 reasoning/raw needs explicit security gates | recommendation | DeepSeek behavior, provider variability, existing secret masking | high | exact role model remains an architecture decision |
| D8 stable publication/performance needs measured gates | fact + recommendation | current batching, unstable keys; DeepSeek Chat/Trajectory limits | high | no Zerox production p95 baseline yet; no arbitrary numeric target accepted |
| D9 actionable state overrides compaction | cross-product inference + recommendation | approvals, Plan/Goal decisions, product primary sources | high | specific visual default/open animation remains unverified |
| D10 unknown/version drift requires two fallback classes | recommendation | DeepSeek presenter fallback and required-event compatibility | medium-high | Zerox event compatibility policy must be frozen before schema work |
| D11 Plan/Scheduled facts lack a common live projection | fact | Plan IPC/store; Scheduled blocking/streaming paths | high | each domain works independently today; convergence must preserve behavior |
| D12 Kernel is telemetry, not durable authority | fact | event bus, preload merge, Kernel view, Runs dedupe | high | Kernel settlement remains useful live lifecycle evidence |
| D13 streaming retry and duplicate representations are ambiguous | fact | Chat status/stream emitters, reducer, AgentLoop retry | high | final persisted assistant reconciliation remains a useful safety net |

No external-product source in this study proves Zerox's exact default fold,
tool-grouping interval, animation, or Inspector tab layout. Those are product
decisions to freeze in Phase 2 and verify through the real scenario matrix.

## Recommended Ownership Model

`[R]` Freeze the following ownership before implementation:

| State class | Owner | Persistence | Renderer responsibility |
|---|---|---|---|
| Domain facts | existing main-process stores/services | authoritative, domain-specific | read-only projection |
| Conversation disclosure projection | main process/shared pure projector | rebuildable; optional versioned cache | subscribe/render |
| Pending approval/input | owning main-process interaction service | durable or idempotently recoverable as required | answer/approve UI only |
| Live assistant deltas | request-scoped stream reconciled to final message | transient plus final durable message | target-row streaming |
| User disclosure preferences | renderer/session view state | local/session-scoped where useful | explicit override |
| Raw technical evidence | existing evidence/run/tool stores | authorized and bounded | opt-in Inspector |

Every projected item should minimally carry:

```text
id, sourceRef, sessionId, requestId, lifecycle, kind,
summary, detailAvailability, sensitivity, occurredAt, sequence/ordinal,
attention, evidenceTarget, projectionVersion
```

This is a projection identity, not a replacement event protocol.

### Sensitive-data and reasoning gates

`[R]` Persistence and disclosure are separate decisions:

| Data class | Persist | Default surface | Technical evidence |
|---|---|---|---|
| safe host-authored process summary | yes with source ref | visible according to lifecycle policy | visible |
| provider reasoning summary | only when provider/policy permits | collapsed safe summary at most | authorized opt-in |
| private/raw chain of thought | no product promise; default do not persist/display | never | unavailable unless a separately approved policy exists |
| tool name and safe object/path summary | yes | grouped compact operation | visible |
| raw tool arguments/output | existing authorized evidence boundary, bounded and redacted | hidden | opt-in, truncated/offloaded, secret scanned |
| file contents | only under existing workspace/tool contract | never by default | authorized excerpt/reference only |
| user text | existing session/history contract | narrative only where user authored it | avoid duplicating into raw telemetry |
| credentials/API keys/tokens | never intentionally persist in disclosure facts | never | never; detect/redact and fail the acceptance scan |
| authorization decision/audit | sanitized durable audit | action/scope/result summary | authorized audit record, not execution truth |

Reasoning disclosure passes five independent gates:

```text
provider output available
  -> host policy permits persistence
  -> client contract permits delivery
  -> viewer role is authorized
  -> UI policy permits display
```

## Disclosure Policy Baseline

`[R]` The deterministic default table is:

| State | Default behavior |
|---|---|
| running, low risk | compact current summary; group completed detail |
| completed, low risk | collapsed summary with result/count/duration when known |
| waiting for input/approval | prominent and open; exact action and scope |
| failed/blocked | prominent and open through first useful error/recovery action |
| canceled/interrupted | visible settlement and restart/resume option |
| sensitive | redacted summary; detail only through authorized Inspector |
| user-open/pinned | remain open until the user closes it |
| unknown required fact | incompatible/coverage warning; do not silently hide |
| unknown optional presentation | generic evidence row with stable source ref |

Tool summaries should contain:

```text
status + action/object + meaningful safe argument/source
       + first error/result + count/duration when known
```

## Staged Delivery Recommendation

### Stage 1 — Program and architecture contract

- independent v3.9.2 disclosure program and checker;
- state ownership and lineage matrix;
- privacy/reasoning/raw-evidence decision;
- compatibility and rollback plan;
- frozen UI scenario matrix.

Exit: independent architecture review, program check, harness check.

### Stage 2 — Projection and lifecycle foundation

- stable causal disclosure ids/source references;
- deterministic shared projector/policy;
- Workspace Run nonterminal lifecycle convergence;
- explicit projection coverage and runless fallback;
- focused replay/reload/unknown/lineage tests.

Exit: focused tests and full verify; no renderer cutover required.

### Stage 3 — Chat narrative and inline operations

- concise grouped operation rows in Chat;
- user override and actionable-state priority;
- stable keyed updates and semantic publication scheduling;
- preserve Goal/Plan/approval/input authority.

Exit: renderer tests and real production smoke scenarios.

### Stage 4 — Trajectory and Inspector handoff

- one-step causal navigation from Chat to existing Runs/evidence surface;
- generic fallback and bounded/redacted raw data;
- selected event/tool/run view state and reload behavior.

Exit: live/history parity and authorization tests.

### Stage 5 — Recovery, performance, and compatibility hardening

- partial stream/reload and pending-interaction recovery;
- long-session CPU, heap, and DOM measurement;
- keyboard, screen reader, and reduced-motion acceptance;
- legacy record and version-drift matrix.

Exit: full verify, production smoke, stress, program, harness, and audit gates.

### Stage 6 — Independent adversarial and real acceptance

- implementation-independent code, architecture, security, and test review;
- clean real app run with an ephemeral credential;
- default/expanded/evidence/failure/recovery/reload scenarios;
- repository and log secret scan.

Exit: no unresolved Critical/Major finding and all scenario evidence recorded.

## Research-stage Acceptance Checklist

- [x] Both supplied attachments were treated as evidence, not instructions.
- [x] Attachment claims were checked against current code and primary sources.
- [x] Leading products were compared across narrative, process detail,
  permissions, long work, recovery, context, and evidence.
- [x] DeepSeek Harness was traced end to end and its own relevant weaknesses
  were recorded.
- [x] Zerox existing domain facts and current disclosure surfaces were mapped.
- [x] Facts, observations, inferences, and recommendations are labeled.
- [x] Transferable patterns and rejected assumptions are explicit.
- [x] Root gaps, privacy/security risks, and a staged recommendation are
  recorded.
- [x] Independent research challenge has accepted the evidence or every
  confirmed issue has been repaired/deferred.

## Risks and Explicit Deferrals

- Do not persist or display raw reasoning merely because a provider supplies
  it. The product must distinguish provider availability, persistence,
  transport, role authorization, and UI display.
- Do not put raw tool output or credentials into default Chat summaries.
- Do not infer authorization from disclosure density. Existing
  `ToolAuthorizationService`, workspace guards, and sandbox remain mandatory.
- Do not make Chat activity snapshots the forensic source of truth.
- Do not imply full evidence when a best-effort recorder failed or a run had no
  Workspace Run.
- Do not port DeepSeek's Cordis/fiber/slot plugin runtime for this feature.
- Do not port DeepSeek's per-turn Todo semantics into Goal/Plan.
- Do not add cloud workers, external subagent providers, arbitrary Code Mode,
  or unreviewed self-modification.
- Do not claim a performance target until Zerox has a reproducible baseline
  and measurement protocol.

## Reviewer Sign-off

PASS on the final independent P104 research challenge. All first-pass FAIL and
second-pass CONDITIONAL findings were corrected and rechecked. P104 is accepted
as the frozen evidence baseline for Phase 2 architecture and delivery planning.
