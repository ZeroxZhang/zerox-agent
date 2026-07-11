# Autonomous Goal Runtime and Strict Goal UI Design

**Date:** 2026-07-11

**Status:** Approved

**Scope:** Goal-mode authorization, persistent execution, cancellation, planning fallback, observability, and goal UI

## 1. Problem statement

The current goal-mode implementation does not behave like an autonomous long-running agent:

- A goal milestone run is hard-limited to eight model turns and uses `pauseOnTurnLimit`. Reaching that internal limit is converted into `waiting_for_review`, so the user must repeatedly click Continue or adjust milestones even when the review policy is `review_high_risk_only`.
- Continue starts a new milestone run whose assembled context omits the real prior message/tool transcript. Repeated runs therefore rediscover the same repository state instead of resuming from the last action.
- Auto approval only auto-approves a small read-only whitelist. Shell, writes, network access, and composed shell commands can still create hidden approval requests with a five-minute timeout.
- The renderer hides pending approvals while auto approval is enabled, so a run can appear active while actually waiting for an invisible user action.
- Cancellation aborts the goal controller, but approval waits do not accept an `AbortSignal`. Canceled runs can keep emitting trajectory and checkpoint events.
- Planning and translation errors are swallowed. The fallback can turn the complete original prompt into a single milestone title.
- The goal detail drawer renders the full goal description as a heading in a non-scrollable header row. A long prompt consumes the drawer and makes the remaining content unreachable.
- The Continue button uses an undefined foreground token, producing unreadable text in the current theme.

The approved product principle is:

> When goal mode is enabled, automatic authorization is enabled and enforced. Every operation is allowed without user interaction except a narrowly defined class of extremely high-risk actions.

## 2. Reference model: MiMo-Code

The local MiMo-Code implementation at `/Volumes/Out/trae_projects/research of mimo code/MiMo-Code` was used as an engineering reference.

Relevant principles adopted from it:

1. Goal mode is a stop condition, not a separate eight-turn state machine.
2. The goal evaluator runs when the main agent attempts to stop. It receives the real compacted transcript, including tool calls and tool results.
3. When acceptance fails, the evaluator supplies the missing evidence and the same execution loop continues automatically.
4. Context pressure triggers checkpointing/compaction and an automatic continuation, not a user review gate.
5. Rebuild context preserves recent real messages and gives an explicit instruction to resume at the exact seam without recap or restart.
6. Skip-all permissions still reserve a forced-ask class for destructive commands.
7. Permission waits accept cancellation signals and forced asks use bounded timeouts.

MiMo's fixed goal-react count is not copied as a primary turn budget. Zerox will use configurable resource budgets and progress-aware loop breakers instead of a hard-coded number of normal model turns.

## 3. Chosen architecture

### 3.1 Single persistent logical run

A goal owns one logical runtime execution. Checkpoints create resumable segments within that run; they do not create a new logical goal run or require user confirmation.

The normal control flow is:

1. Load the goal contract, task graph, latest checkpoint, recent transcript, and evidence manifest.
2. Call the main model.
3. Execute requested tools and append their real results to the transcript.
4. Continue steps 2–3 while the model is doing work.
5. When the model attempts to finish, call the goal acceptance evaluator.
6. If accepted, complete and publish the goal.
7. If rejected, append a synthetic continuation containing the concrete gaps and continue the same run.

Internal checkpoints, context rebuilds, retry recovery, and acceptance re-entry never transition the goal to `waiting_for_review`.

### 3.2 Review semantics

`waiting_for_review` is reserved for only two cases:

- An extremely high-risk operation needs explicit authorization.
- The original user instruction explicitly defines a business checkpoint, such as “write the outline and wait for my confirmation.”

Milestone boundaries, model-turn counts, compaction boundaries, and internal replanning are not review events.

### 3.3 Runtime budgets

There is no goal-mode `maxTurns: 8` cutoff. The runtime uses configurable limits for:

- wall-clock duration;
- token and monetary cost;
- tool-call count;
- consecutive identical tool/model failures;
- consecutive acceptance rejections with no new evidence;
- provider retry limits.

Budget exhaustion produces a terminal, reason-specific outcome and diagnostic evidence. It does not produce a generic Continue prompt.

Progress-sensitive counters reset when the evidence manifest, task state, artifact set, or validation result materially changes. This prevents a fixed number from terminating productive work while still stopping non-progress loops.

## 4. Authorization policy

### 4.1 Goal-mode coupling

- Enabling goal mode immediately enables auto approval through the main-process authorization state.
- Auto approval remains locked on while goal mode is active.
- Disabling goal mode unlocks the standalone auto-approval control. The previous standalone preference may be restored.
- The main process is authoritative; renderer state cannot independently claim auto approval is active.

### 4.2 Default allow

With auto approval enabled, normal operations are automatically authorized after policy classification and workspace/sandbox validation. This includes:

- reading and writing ordinary project files;
- creating, moving, and deleting ordinary files inside the workspace;
- shell pipelines, redirection, and command chaining;
- dependency installation;
- builds, tests, formatters, and local development servers;
- ordinary network search, downloads, and API calls;
- Git add, commit, branch creation, merge, and non-forced push;
- other reversible local actions.

Existing explicit sandbox and workspace boundary checks remain in place; automatic authorization does not bypass validation. A validated, non-extreme action is auto-approved instead of routed to a user prompt.

### 4.3 Forced-ask extremely high-risk class (Policy B)

The following actions cannot be bypassed by a wildcard allow or auto-approval state:

1. **Irrecoverable data destruction**
   - recursive/forced deletion affecting broad scopes, protected paths, home/system roots, or paths outside the active workspace;
   - disk formatting, partitioning, secure erasure, bulk truncation, or equivalent destructive storage operations;
   - destructive Git state/history operations such as `reset --hard`, `clean -f`, worktree removal, stash clear/drop, destructive branch/tag deletion, and forced push.
2. **Privilege and security-boundary mutation**
   - root/administrator elevation;
   - protected-system ownership or permission mutation;
   - firewall, system service, login item, persistence, keychain, credential-store, sandbox, or authorization-policy changes;
   - attempts by the agent to weaken or modify its own authorization controls.
3. **Secret exfiltration**
   - transmitting passwords, access tokens, private keys, cookies, signing credentials, recovery codes, or equivalent secrets to an external destination.
4. **Irreversible external or reputational action**
   - production deployment or release;
   - package/app publication;
   - destructive cloud-resource changes;
   - sending email or chat messages, or publishing public content;
   - purchases, transfers, trades, or other financial commitments.

Detection must be structural where possible: parsed command/tool metadata, resolved paths, destination, environment, and operation type. Substring matching alone is not sufficient.

### 4.4 Forced-ask behavior

The approval surface must show:

- risk category and reason;
- exact affected objects or destination;
- full command or external action;
- clear Allow and Reject controls.

The prompt remains visible even while auto approval is on. A forced ask receives the active run's `AbortSignal` and a configurable default timeout of 60 seconds. On timeout it rejects only that action, returns actionable feedback to the model, and allows the agent to pursue a safe alternative. If the goal is impossible without the rejected action, the goal ends as blocked with the precise reason.

Enabling auto approval flushes already-pending non-forced requests by approving them. Forced asks remain pending.

## 5. Checkpointing and context reconstruction

### 5.1 Checkpoint triggers

Checkpointing is automatic and may run on:

- context pressure thresholds;
- elapsed-time/tool-count intervals;
- task or milestone transitions;
- before acceptance evaluation;
- before controlled shutdown or application restart.

Context pressure is derived from the selected model's actual input/context limits and output reserve. It is not based on a fixed number of turns.

### 5.2 Persisted state

Each checkpoint records or references:

- original goal and acceptance contract;
- short display title, structured task graph, active task, and next action;
- completed work and remaining gaps;
- real tool calls and result references;
- modified files and artifact provenance;
- validation/test evidence;
- recent user and assistant messages;
- failure/retry state;
- runtime budgets already consumed.

### 5.3 Rebuild behavior

When context pressure is high:

1. Finish the current atomic tool/result pair.
2. Write the checkpoint.
3. Preserve a bounded tail of recent real user, assistant, tool-call, and tool-result messages.
4. Replace older large tool outputs with stable references/summaries.
5. Rebuild context from the goal contract, checkpoint, task/evidence state, project memory, and retained tail.
6. Inject a seam instruction to resume directly from the last state without recap, rediscovery, or replanning.
7. Continue automatically.

The acceptance evaluator uses the reconstructed real transcript plus evidence references rather than goal summaries alone.

## 6. Cancellation and terminal-state fencing

One run-scoped `AbortSignal` is propagated through:

- model requests and retries;
- tool execution and child processes;
- authorization waits;
- validators and acceptance evaluation;
- checkpoint/evidence/trajectory persistence;
- publication.

Cancellation must:

1. abort the provider request and active tools;
2. settle and remove pending approvals;
3. cancel retry timers;
4. stop checkpoint and validator work;
5. persist one terminal cancellation event;
6. prevent all later non-terminal writes.

Every run receives an execution generation/lease. Persistence APIs validate the lease and current goal status so a stale asynchronous continuation cannot overwrite a canceled, completed, or superseded goal.

## 7. Planning and recovery

Planning errors must not be silently swallowed.

- Translator/planner failures are logged with structured diagnostic data.
- Transient failures receive bounded, abortable retries.
- A failed structured plan falls back to a concise single-goal contract with a short derived title; the original prompt remains body content and is never used as the display heading.
- Internal task decomposition can be revised automatically without requesting milestone adjustment from the user.
- Repeated identical failures are fed back to the main model with prior attempts and evidence so it changes strategy instead of repeating exploration.

## 8. Renderer design

### 8.1 Controls

- The Goal Mode switch visibly enables Auto Approval.
- While goal mode is on, the Auto Approval switch is on and disabled, with explanatory helper text.
- Renderer copy states that normal actions are auto-approved and extremely high-risk actions still require confirmation.
- Renderer state is hydrated from and reconciled with the main-process authorization state.

### 8.2 Goal status

- Internal checkpointing appears as non-blocking activity such as “正在整理上下文”.
- The status strip shows the current task, last meaningful action, elapsed time, tool count, and relevant failure/retry state.
- Continue is shown only for an explicit user/business pause.
- Adjust Milestones is removed from automatic runtime checkpoints.
- A high-risk wait is labeled with its actual risk category and opens the forced-ask surface.

### 8.3 Goal detail drawer

- The header contains a short title and compact metadata only.
- The original goal description appears in a scrollable body section and may be collapsed/expanded.
- The complete drawer is height-constrained and scrollable; the close control remains reachable.
- Long Chinese/English prose, Markdown, URLs, and code blocks wrap or scroll correctly.
- Heading, body, metadata, and controls use the shared typography and spacing tokens.

### 8.4 Visual and accessibility requirements

- Replace the undefined Continue-button foreground token with the canonical on-accent token.
- All action text/background combinations meet WCAG AA contrast.
- Hover, focus, active, disabled, loading, and destructive states are token-driven and visually distinct.
- Interactive controls are keyboard accessible and have visible focus indicators.
- Visual regression fixtures cover very long goals, narrow/standard windows, both themes, scrolled states, and forced-ask dialogs.

## 9. Observability

Run logs and the activity view must separately report:

- provider/model latency;
- tool execution time;
- authorization wait time;
- checkpoint/compaction time;
- acceptance time;
- retry and repeated-failure counts;
- cancellation propagation and late-write suppression.

No hidden wait may be represented as generic execution. A run waiting for a forced ask must say so; a run doing model/tool work must show the current action.

## 10. Migration and compatibility

- Existing goals waiting only because of the legacy turn-limit checkpoint are eligible for automatic continuation when goal mode is active.
- Goals waiting for an explicit user checkpoint or a high-risk operation remain waiting.
- Existing ledgers and trajectories remain readable. New events add reason codes instead of reinterpreting old events.
- Existing standalone chat/skill turn budgets remain unchanged unless they use goal mode; this design removes the eight-turn user gate from goal execution, not every bounded agent API.

## 11. Verification requirements

The implementation is complete only when the following are covered by focused and end-to-end tests:

1. Goal mode enables and locks auto approval.
2. Default-allow policy authorizes normal file, shell, network, installation, build, test, and non-forced Git operations.
3. Every Policy B category is forced-ask and cannot be bypassed by wildcard allow.
4. Forced asks are visible in auto mode, abortable, and timeout with safe continuation.
5. Productive goal execution continues beyond eight model turns without review.
6. Acceptance rejection continues the same logical run with real evidence.
7. Context rebuild resumes from the last action without repeating repository exploration.
8. Cancellation leaves no pending approval and emits no post-terminal trajectory/checkpoint writes.
9. Planning failure never places the full prompt in the title.
10. The long-goal drawer is fully scrollable and the primary action text is readable in all themes.
11. Focused tests, `npm run harness:check`, `npm run verify`, and `npm run smoke:prod` pass.

## 12. Alternatives rejected

### Keep eight-turn checkpoints but auto-click Continue

Rejected because it preserves artificial run segmentation, incomplete context restoration, duplicate exploration, and misleading state. Automating the click would hide rather than fix the runtime defect.

### Unlimited execution with no budgets or evaluator

Rejected because it can loop indefinitely, accumulate cost, and repeat failing actions. Autonomy requires progress-aware safety limits and independent acceptance.

### Auto-approve absolutely everything

Rejected because irreversible destruction, privilege changes, secret exfiltration, public actions, and financial commitments require explicit human authority even in an autonomous goal run.

### Treat every external write as extremely high risk

Rejected because ordinary project writes, dependency installation, network calls, commits, and non-forced pushes are normal agent work. Prompting for them would recreate the current usability failure.
