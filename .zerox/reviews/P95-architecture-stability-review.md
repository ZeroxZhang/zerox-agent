# P95 Architecture Stability And Trust Review

Date: 2026-08-16

## Scope And Intent

Intent: preserve Zerox Agent as a local-first, permissioned, observable, and
recoverable desktop control plane while closing architecture defects that can
cross trust boundaries, publish false terminal truth, or lose rollback data.

The review covered Electron main/preload/renderer boundaries, Kernel-backed
Chat/Goal/Scheduled execution, ToolRuntime and Seatbelt enforcement, Skill MCP
activation, JSON/SQLite/dual persistence, migration verification, and release
gates. Four fresh domain reviews were consolidated by the main reviewer. Two
additional fresh validators independently checked every candidate finding.
Only findings confirmed by both validators are included.

## Executive Summary

- 12 confirmed serious findings: 2 Critical and 10 Major.
- 12/12 findings received 2/2 existence confirmation.
- One replay-driver concern was confirmed but independently downgraded to
  Minor by both validators and excluded from P95 remediation scope.
- Existing strengths remain intact: one ToolRuntime authorization pipeline,
  exactly-one Kernel terminal assertions, bounded Kernel event history,
  append-only Chat projections, and explicit shutdown drain infrastructure.

## Trust Boundary Flow

~~~mermaid
flowchart LR
  R[Renderer source] --> P[Preload bridge]
  P --> I[Privileged IPC]
  M[Model-authored files] --> S[Shell templates]
  S --> B[Seatbelt process]
  K[Discovered Skill] --> C[MCP child/client]
  I --> D[Local data and runtime controls]
  B --> D
  C --> D
  style R fill:#ffc9c9,color:#b71c1c
  style M fill:#ffc9c9,color:#b71c1c
  style K fill:#fff3bf,color:#7d5500
  style D fill:#d0ebff,color:#0d47a1
~~~

## Terminal And Persistence Flow

~~~mermaid
flowchart LR
  A[Runtime work] --> T[Trajectory queue]
  T --> F[Flush receipt]
  F --> E[Kernel run_end]
  A --> C[Pause or cancel]
  C --> Q[Quiescent drain]
  Q --> U[User-visible settlement]
  X[SQLite authority] --> J[Tracked JSON shadow]
  J --> H[Shutdown flush]
  style F fill:#fff3bf,color:#7d5500
  style Q fill:#c3fae8,color:#087f5b
  style J fill:#d0ebff,color:#0d47a1
~~~

## Confirmed Findings

| ID | Severity | Finding | Required remediation | Evidence |
|---|---|---|---|---|
| AR-01 | Critical | Packaged Electron can load an arbitrary ELECTRON_RENDERER_URL into the privileged preload window; navigation and new-window policy are not fail-closed. | Ignore renderer URL in packaged mode, allow only loopback development origins, deny in-app navigation/new windows, and validate trusted renderer senders at IPC boundaries. | [main.ts:62](file:///Users/bytedance/Documents/trae_projects/zerox-agent/zerox-agent/src/main/main.ts#L62), [main.ts:129-180](file:///Users/bytedance/Documents/trae_projects/zerox-agent/zerox-agent/src/main/main.ts#L129-L180), [preload/index.ts:682](file:///Users/bytedance/Documents/trae_projects/zerox-agent/zerox-agent/src/preload/index.ts#L682) |
| AR-02 | Critical | Goal grants generic interpreter/package execution over mutable workspace code while Seatbelt is read-open, shell networking follows task policy, and child processes inherit the main environment. | Remove generic node wildcard execution, separate shell network capability from web tools, pass a minimal child environment, and constrain process reads to declared roots plus required system runtime paths. | [goalRuntimeEngine.ts:1251-1265](file:///Users/bytedance/Documents/trae_projects/zerox-agent/zerox-agent/src/main/goalRuntimeEngine.ts#L1251-L1265), [processSandbox.ts:157-182](file:///Users/bytedance/Documents/trae_projects/zerox-agent/zerox-agent/src/main/processSandbox.ts#L157-L182), [agentToolExecutor.ts:2221-2257](file:///Users/bytedance/Documents/trae_projects/zerox-agent/zerox-agent/src/main/agentToolExecutor.ts#L2221-L2257) |
| AR-03 | Major | Global Skill MCP opt-in starts every discovered MCP server without per-Skill trust; stdio MCP can read broadly and use unrestricted network. | Require an explicit Skill/server allowlist or trust record and confine MCP reads/network to declared roots and policy. | [skillRegistry.ts:30-41](file:///Users/bytedance/Documents/trae_projects/zerox-agent/zerox-agent/src/main/skillRegistry.ts#L30-L41), [skillRegistry.ts:87-107](file:///Users/bytedance/Documents/trae_projects/zerox-agent/zerox-agent/src/main/skillRegistry.ts#L87-L107), [container.ts:2063-2110](file:///Users/bytedance/Documents/trae_projects/zerox-agent/zerox-agent/src/main/container.ts#L2063-L2110) |
| AR-04 | Major | Goal and Scheduled trajectory queues can hide an intermediate append failure behind a later success, while the Goal wrapper declares trajectoryFlushed true. | Preserve the first queue failure, drain all admitted writes, rethrow at flush, and prevent successful run_end after any persistence gap. | [goalRuntimeEngine.ts:272-292](file:///Users/bytedance/Documents/trae_projects/zerox-agent/zerox-agent/src/main/goalRuntimeEngine.ts#L272-L292), [goalRuntimeEngine.ts:123-137](file:///Users/bytedance/Documents/trae_projects/zerox-agent/zerox-agent/src/main/goalRuntimeEngine.ts#L123-L137), [agentRuntimeEngine.ts:388-391](file:///Users/bytedance/Documents/trae_projects/zerox-agent/zerox-agent/src/main/agentRuntimeEngine.ts#L388-L391) |
| AR-05 | Major | Goal pause/cancel returns before the active background completion drains, allowing late tool effects and persistence after the caller sees settlement. | Abort admission, await the owned completion barrier, then persist/publish the user-visible pause or cancel result. | [goalChatService.ts:182-206](file:///Users/bytedance/Documents/trae_projects/zerox-agent/zerox-agent/src/main/goalChatService.ts#L182-L206), [goalChatService.ts:541-600](file:///Users/bytedance/Documents/trae_projects/zerox-agent/zerox-agent/src/main/goalChatService.ts#L541-L600) |
| AR-06 | Major | SQLite task reads are SQLite-authoritative, but update/recordRun/setEnabled/delete depend on the JSON copy succeeding first. | In SQLite mode mutate the repository directly; in dual mode use the SQLite result as authority and enqueue a derived JSON shadow. | [taskStore.ts:252-299](file:///Users/bytedance/Documents/trae_projects/zerox-agent/zerox-agent/src/main/taskStore.ts#L252-L299) |
| AR-07 | Major | Dual shadow failures are swallowed or fire-and-forget; validation, persona, and audit shadows are not part of shutdown drain. | Use one failure-visible serial shadow queue contract across dual stores and drain every instantiated queue before storage close. | [agentRunStore.ts:63-94](file:///Users/bytedance/Documents/trae_projects/zerox-agent/zerox-agent/src/main/agentRunStore.ts#L63-L94), [agentValidationStore.ts:73-78](file:///Users/bytedance/Documents/trae_projects/zerox-agent/zerox-agent/src/main/agentValidationStore.ts#L73-L78), [memoryProfileStore.ts:68-78](file:///Users/bytedance/Documents/trae_projects/zerox-agent/zerox-agent/src/main/memoryProfileStore.ts#L68-L78), [toolAuditLog.ts:100-105](file:///Users/bytedance/Documents/trae_projects/zerox-agent/zerox-agent/src/main/toolAuditLog.ts#L100-L105), [container.ts:4395-4407](file:///Users/bytedance/Documents/trae_projects/zerox-agent/zerox-agent/src/main/container.ts#L4395-L4407) |
| AR-08 | Major | Tool audit truncates rather than recursively redacting secrets; prefixed Chat tool-history strings bypass structured masking and persist raw values. | Apply recursive key and value-pattern redaction before all audit/history disk writes and serialize tool results only after masking. | [toolAuditLog.ts:48-81](file:///Users/bytedance/Documents/trae_projects/zerox-agent/zerox-agent/src/main/toolAuditLog.ts#L48-L81), [chatService.ts:1803-1815](file:///Users/bytedance/Documents/trae_projects/zerox-agent/zerox-agent/src/main/chatService.ts#L1803-L1815), [chatService.ts:5415-5435](file:///Users/bytedance/Documents/trae_projects/zerox-agent/zerox-agent/src/main/chatService.ts#L5415-L5435) |
| AR-09 | Major | SQLite migration skips malformed JSONL rows and verifies against successful writes only; mismatches do not set a failing exit code. | Count source records, parse/write failures, and target rows independently; --verify must fail nonzero on any loss or mismatch. | [migrate-to-sqlite.mjs:59-70](file:///Users/bytedance/Documents/trae_projects/zerox-agent/zerox-agent/scripts/migrate-to-sqlite.mjs#L59-L70), [migrate-to-sqlite.mjs:312-325](file:///Users/bytedance/Documents/trae_projects/zerox-agent/zerox-agent/scripts/migrate-to-sqlite.mjs#L312-L325) |
| AR-10 | Major | HTTP/SSE MCP implementation is unreachable from Skill manifests because the shared parser and registry discard transport, URL, and headers. | Define and validate a discriminated stdio/http/sse config union through parser, registry, and container without unsafe recovery casts. | [skills.ts:47-52](file:///Users/bytedance/Documents/trae_projects/zerox-agent/zerox-agent/src/shared/skills.ts#L47-L52), [skills.ts:286-299](file:///Users/bytedance/Documents/trae_projects/zerox-agent/zerox-agent/src/shared/skills.ts#L286-L299), [skillRegistry.ts:87-107](file:///Users/bytedance/Documents/trae_projects/zerox-agent/zerox-agent/src/main/skillRegistry.ts#L87-L107), [container.ts:2069-2116](file:///Users/bytedance/Documents/trae_projects/zerox-agent/zerox-agent/src/main/container.ts#L2069-L2116) |
| AR-11 | Major | Renderer process crashes leave a live BrowserWindow whose recovery paths only show/focus the dead webContents. | Add bounded render-process-gone recovery with diagnostics, window recreation, and a crash-loop ceiling. | [main.ts:129-166](file:///Users/bytedance/Documents/trae_projects/zerox-agent/zerox-agent/src/main/main.ts#L129-L166), [main.ts:799-803](file:///Users/bytedance/Documents/trae_projects/zerox-agent/zerox-agent/src/main/main.ts#L799-L803) |
| AR-12 | Major | Tagged release packaging bypasses the newly mandatory strict test TypeScript project. | Run npm run typecheck:tests before release tests or invoke the canonical verification gate, and lock the workflow with a contract test. | [release.yml:41-48](file:///Users/bytedance/Documents/trae_projects/zerox-agent/zerox-agent/.github/workflows/release.yml#L41-L48), [package.json:13-14](file:///Users/bytedance/Documents/trae_projects/zerox-agent/zerox-agent/package.json#L13-L14) |

## Remediation Order

1. Close AR-01 and AR-02 before broadening any runtime capability.
2. Repair AR-04 and AR-05 before accepting further Kernel terminal claims.
3. Repair AR-06 through AR-09 before relying on SQLite rollback evidence.
4. Repair AR-03 and AR-10 as one typed MCP trust-boundary change.
5. Close AR-11 and AR-12, then run full runtime, smoke, and release gates.

## Acceptance Contract

- Every finding receives a focused regression that fails on the reviewed code.
- No fix bypasses ToolRuntime, ToolAuthorizationService, run-context guards, or
  the process sandbox.
- No successful Kernel terminal may be published after a required persistence
  write fails.
- Shutdown must report shadow failure rather than silently claiming a complete
  drain.
- The implementation is independently reviewed by a system architect and
  independently accepted by a test engineer.

## Remediation Outcome

Status: completed after independent development, system-architecture review,
security review, and four independent QA acceptance rounds.

- AR-01 and AR-11 now enforce trusted renderer origins, fail-closed navigation
  and IPC senders, and bounded renderer crash recovery.
- AR-02 and AR-03 now use deny-by-default Seatbelt profiles, minimal child
  environments, per-process private temp leases, detached process-group drain,
  and exact Skill/server MCP trust.
- AR-04 and AR-05 now preserve the first persistence failure, drain admitted
  work, and settle Goal pause/cancel only after owned runtime completion.
- AR-06 through AR-09 now use SQLite-authoritative mutation, close-and-drain
  failure-visible shadow queues, recursive credential redaction, and
  source/delta-aware fail-closed migration verification.
- AR-10 now carries a validated stdio/http/sse discriminated union through the
  Skill parser, registry, and production client factory.
- AR-12 now runs strict type coverage for every `src/**/*.test.ts` and
  `src/**/*.test.tsx` file and executes the production built smoke before
  release packaging.

The acceptance loop rejected three intermediate implementations:

1. Production smoke rendered successfully after native SQLite failed and the
   application fell back to JSON.
2. Seatbelt allowed the global temp directory, so shell and stdio MCP could
   read undeclared sibling files.
3. Native ABI recovery skipped its final proof on an initial-bad failure path,
   and the strict test project omitted renderer tests.

Each rejection received a production fix, focused regression, independent
architecture re-review, and a fresh full QA run.

## Final Acceptance Evidence

- Strict test type coverage: 282/282 repository test files, zero diagnostics.
- Focused architecture acceptance: 29 files / 509 tests, zero skips.
- Full verification: 281 files / 2,880 tests; Agent evaluations 26/26 and
  Memory evaluations 2/2.
- Runtime stress: all 6 scenarios passed, including 25,000-event Context and
  SQLite trajectory runs, cancellation, parallel writes, and Worker recovery.
- Real macOS Seatbelt effects: 10/10 passed with global-temp sibling,
  cross-lease, symlink, network, environment override, and process cleanup
  negative cases.
- Production smoke: Node ABI 137 to Electron ABI 146 to Node ABI 137; native
  SQLite WAL, three migrations, SQLite row, and JSON shadow all verified with
  no fallback.
- `npm run program:check`, `npm run harness:check`, `./init.sh`,
  `npm audit --audit-level=high`, and `git diff --check` passed; the audit
  reported zero vulnerabilities.

The final independent test-engineer decision was `ACCEPT`. Non-macOS process
isolation remains fail-closed, while CPU, memory, PID, syscall, and domain-level
network controls remain explicitly deferred rather than being represented as
implemented isolation.
