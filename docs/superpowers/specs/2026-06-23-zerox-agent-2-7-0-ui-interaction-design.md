# Zerox Agent 2.7.0 UI/Interaction Design Spec

> Status: Approved by user on 2026-06-23 for方案1, Chat-first consumer experience with progressive disclosure. This document is the source spec for the implementation plan.

## Objective

Zerox Agent 2.7.0 will be a major interaction and interface iteration. The goal is to make the product feel like a smooth consumer-grade desktop agent while preserving the local-first control-plane boundaries: explicit permissions, observable trajectories, recoverable runs, workspace sandboxing, and reviewed learning.

The iteration is not a renderer-only restyle. It affects shared chat contracts, IPC, provider streaming, agent-loop execution, skill input handling, chat persistence, renderer interaction state, tests, smoke coverage, and independent acceptance.

## Current State

- `package.json` reports version `2.6.0`; 2.7.0 has not been added to `.zerox/feature_list.json`.
- `.zerox/feature_list.json` currently has no unfinished feature entries.
- Primary navigation currently includes `chat`, `overview`, `runs`, `scheduled-tasks`, and `settings`.
- `OverviewPanel` is a real operational surface: readiness, harness score, capability score, validation, runtime paths, pending learning/eval signals, and quick actions.
- Chat has live status events but final assistant text is appended only after `sendChatMessage` resolves.
- Provider-level streaming exists, including `text_delta` and `thinking_delta` in provider contracts, but chat UI does not yet receive first-class answer deltas.
- Selected skills are injected into chat context and executed through the normal agent loop. `SkillManifest.inputs` exist but are not enforced as a preflight requirement before model/tool execution.
- Tool execution and workspace safety are centralized in `ToolAuthorizationService`, `toolPermissions`, and workspace sandbox checks. These remain non-negotiable boundaries.

## Recommended Direction

Use a Chat-first consumer experience with progressive disclosure for technical detail.

Primary navigation:

- `Chat`
- `Runs`
- `Tasks`
- `Settings`

`Overview` is removed from primary navigation. Its useful diagnostics move to `Settings > System Overview` or `Settings > Readiness`. Existing `#overview` links should resolve to that settings subsection for compatibility.

The main screen becomes:

- Left rail: brand, new chat, recent sessions, archive, primary nav.
- Center: streamed conversation transcript, compact header, workspace/model/status pills, compact composer.
- Right rail: contextual process rail that opens for active work, skill input, approvals, errors, and evidence. It is not a dashboard.
- Runs: deep audit/replay view for full trajectories, run graph, kernel events, refs, and eval candidate actions.

## Design Principles

- Chat is the first screen, not a technical dashboard.
- Status is concise by default and explorable when needed.
- Answer text and thinking process are visually and structurally separate.
- Long content collapses automatically without losing access.
- Tool approval and guided skill input are different user states.
- Renderer is never a permission authority.
- Streaming remains local-first; no cloud relay, remote worker, or unreviewed self-modification.
- UI polish must not weaken observability, recovery, or reviewed learning.

## Approval Checklist

Approving this spec means accepting these product and architecture decisions:

- The default product experience is Chat-first.
- `Overview` is removed from primary navigation.
- Overview diagnostics are preserved under Settings, not deleted.
- The UI will expose streamed answers in the transcript.
- Thinking/process output is observable but visually separated and collapsed by default.
- Guided skill input is a first-class pause state, separate from tool approval.
- Auto mode does not skip required user input.
- The implementation may change shared contracts, IPC, provider streaming, agent-loop behavior, skill execution state, renderer state, tests, and docs.
- A final release claim requires independent black-box UI acceptance.

If any item above is not acceptable, the spec should be revised before implementation planning starts.

## Not In Scope

- No cloud worker, cloud relay, or remote streaming proxy.
- No renderer-side permission decisions.
- No bypass around `ToolAuthorizationService`.
- No weakening of workspace sandbox checks.
- No automatic learning from raw thinking content.
- No replacement of Runs as the authoritative audit/replay surface.
- No broad redesign of every Settings subsection beyond what is required to relocate Overview diagnostics and keep technical surfaces coherent.
- No release metadata bump to `2.7.0` until implementation, verification, packaging, and independent acceptance are complete.

## Architecture Impact

### Navigation And Overview Relocation

Change shared navigation so primary sections are Chat, Runs, Tasks, and Settings. Add a settings subsection for system diagnostics/readiness if Overview remains.

Expected files:

- `src/shared/navigation.ts`
- `src/shared/navigation.test.ts`
- `src/shared/appMeta.ts`
- `src/shared/materialNavigation.ts`
- `src/shared/materialNavigation.test.ts`
- `src/renderer/App.tsx`
- `src/renderer/components/OverviewPanel.tsx`
- `src/renderer/materialDesign.test.ts`

Compatibility rules:

- `#overview` opens the settings diagnostics subsection.
- `#goals` continues to resolve to Chat.
- `#tools`, `#memory`, `#learning`, and `#evals` continue to resolve to Settings.
- Unknown hashes continue to fall back to Chat.

### Chat Streaming Contract

Add a first-class renderer-facing stream event contract instead of overloading status events.

Proposed event variants:

- `answer_delta`
- `thinking_delta`
- `tool_call_preview`
- `status`
- `waiting_for_input`
- `completed`
- `failed`
- `canceled`

Behavior:

- Renderer creates an in-progress assistant message immediately after the user sends.
- Answer deltas append into that message.
- Completion finalizes the same message; no duplicate final reply.
- Cancellation marks the in-progress message as stopped.
- Thinking deltas are shown in the process rail or collapsed thinking block, not interleaved with final answer text.
- Final persisted assistant content remains backward compatible for search, memory, history, and export.

Expected files:

- `src/shared/chat.ts`
- `src/main/ipc/index.ts`
- `src/preload/index.ts`
- `src/main/chatService.ts`
- `src/main/agentLoop.ts`
- `src/main/providers/providerChatClient.ts`
- `src/main/providers/streamProcessor.ts`
- `src/main/openAiCompatibleClient.ts`
- `src/renderer/components/AgentChatPanel.tsx`

Security and privacy:

- Raw thinking is observable but controlled.
- Thinking is not written into reviewed learning by default.
- Future prompt history should use final answer content, not raw thinking deltas, unless explicitly designed and reviewed.

### Streamed Tool Calls

Tool calls can stream as preview/assembly data, but execution happens only after a complete tool call is assembled and authorized.

Rules:

- No partial tool call may reach execution.
- `ToolAuthorizationService` remains the only tool authorization gate.
- Workspace sandbox checks remain final and non-overridable.
- Tool results are still recorded as trajectory and workspace-run evidence.

### Guided Skill Input

Add a guided skill/input layer around the existing skill execution contract.

New concepts:

- `SkillInvocationIntent`: selected skill, source, confidence, user message, workspace.
- `SkillInputResolution`: resolved values, missing fields, invalid fields, source of each value.
- `SkillUserInputRequest`: execution id, session id, request id, skill name, field specs, defaults, validation hints.
- `SkillInputResponse`: request id plus typed answers.

Recommended state machine:

```text
resolving_skill
loading_resources
auditing_requirements
waiting_for_user_input
validating_input
planning
executing
waiting_for_approval
validating
finalizing
succeeded | failed | canceled
```

Hard rules:

- Required manifest inputs are checked before model execution.
- Auto mode must not invent or skip required user input.
- Auto approval affects tool authorization policy only; it is not consent for missing task configuration.
- `waiting_for_user_input` is separate from `waiting_for_approval`.
- Skill input values must be validated before they affect prompts, permissions, filesystem scope, or placeholder expansion.
- Path inputs must be canonicalized and checked by workspace sandbox rules.

Expected files:

- `src/shared/skills.ts`
- `src/shared/skillExecutionContract.ts`
- `src/main/skillExecutionService.ts`
- `src/main/skillExecutor.ts`
- `src/main/chatService.ts`
- `src/shared/toolPermissions.ts`
- `src/main/toolAuthorizationService.ts`
- `src/shared/workspaceRunLedger.ts`
- `src/renderer/chatTaskActivity.ts`
- `src/renderer/components/AgentChatPanel.tsx`

### Prompt Implications

Skill invocation prompts should receive a structured block:

- skill identity, root, file path, manifest hash, body hash;
- declared inputs and resolved values;
- explicit instruction not to invent unresolved required inputs;
- permission summary and workspace boundary;
- resource map for references, assets, and scripts.

For prose-guided skills that do not declare manifest inputs, use a constrained requirements-audit step that returns JSON before execution starts.

## UI/UX Specification

### Chat Transcript

- Stream answer text into the current assistant message.
- Show a subtle active cursor while streaming.
- Preserve Markdown rendering during and after streaming.
- Collapse assistant answers over a visual threshold, for example around `520px` height.
- Collapse code blocks over a line threshold, for example 30 lines.
- Expose a clear expand/collapse control.
- Do not hide errors or approval prompts by default.

### Thinking And Process

- Thinking appears as a collapsed process row or right-rail block.
- Latest thinking may preview in the process rail.
- Thinking is labeled as thinking/process, not answer.
- Tool calls, tool results, memory retrieval, model calls, context compaction, skill input requests, and approval waits appear as timeline/process items.
- Long process messages collapse by default with one-click expansion.

### Right Process Rail

Desktop:

- Docked at about `320px`.
- Opens automatically for active work, approvals, guided skill input, pauses, and errors.
- User can collapse it when idle.

Narrow widths:

- Convert the rail into a drawer or bottom sheet.
- Do not use `display: none` for active approvals or guided input.

Sections:

- Now
- Plan
- Tool Calls
- Approvals
- Skill Input
- Evidence
- Context

### Composer

- Compact by default; grows with content up to a capped height.
- Keep Enter-to-send and Shift-Enter newline.
- Keep slash commands and `@skill` selection.
- Keep workspace picker but reduce visual weight.
- Keep send/stop/command controls as icon buttons with accessible labels.
- Auto approval remains explicit and visually distinct.

### Icons

Create one local icon component/wrapper using 24x24 path data and `currentColor`.

Replace raw glyphs first:

- new chat
- more menu
- close
- command
- send
- stop
- expand/collapse
- tool
- thinking
- approval
- settings
- run
- task

Sizing:

- Navigation: 24px
- Action buttons: 16px
- Status indicators: 8-12px

### Visual System

Keep the existing warm-neutral token system but reduce hard-coded colors.

Known cleanup targets:

- Replace undefined `--text-muted` references.
- Replace hard-coded light color such as `#fffdfa`.
- Preserve dark-mode readability.
- Avoid decorative gradients, oversized marketing composition, and visual clutter.

## Design Artifacts Required

Before implementation is considered design-complete, the iteration must include UI/UE design artifacts covering:

- empty Chat state;
- active streaming answer;
- collapsed thinking and expanded thinking;
- guided skill input request;
- tool approval prompt;
- paused run with continue;
- error state;
- restored session with prior activity;
- desktop layout;
- narrow/mobile layout.

Existing untracked files `building-agent-A4-B3-20260620.html` and `building-agent-A4-B3-20260620.png` are product/architecture poster references only. They are not approved 2.7.0 app UI designs.

## Test And Acceptance Strategy

### Focused Tests

Expected test coverage includes:

- navigation relocation and hash compatibility;
- material icon coverage;
- chat stream event contract and preload/IPC exposure;
- chat service delta ordering, completion, cancellation, and no duplicate persistence;
- provider adapter preserving thinking deltas;
- agent loop assembling streamed tool calls before authorization/execution;
- guided skill input resolution and state transitions;
- required input missing before model call;
- structured input resume;
- workspace escape denial for guided path input;
- renderer mapping for streaming, thinking, auto-collapse, process rail, and input form.

Likely files:

- `src/shared/navigation.test.ts`
- `src/shared/materialNavigation.test.ts`
- `src/shared/chat.test.ts` or equivalent new shared contract test
- `src/preload/index.test.ts`
- `src/main/chatService.test.ts`
- `src/main/agentLoop.test.ts`
- `src/main/providers/p8.test.ts`
- `src/shared/skillExecutionContract.test.ts`
- `src/main/skillExecutionService.test.ts`
- `src/shared/toolPermissions.test.ts`
- `src/renderer/chatTaskActivity.test.ts`
- `src/renderer/chatTaskActivityRestore.test.ts`
- `src/renderer/materialDesign.test.ts`
- candidate new `src/renderer/uiInteractionAcceptance.test.ts`

### Command Gates

Focused slice gates:

```bash
npm test -- <focused files>
npm run harness:check
```

Integrated gates:

```bash
npm test
npm run build
npm run verify
npm run smoke:prod
npm run harness:score
npm run harness:check
git diff --check
```

Release/packaged gates:

```bash
npm run dist:mac
npm run smoke:prod:built
BUILDING_AGENT_SMOKE=1 BUILDING_AGENT_SMOKE_REQUIRED_TEXTS='v2.7.0' "release/mac-arm64/Zerox Agent.app/Contents/MacOS/Zerox Agent"
```

### Black-Box Electron QA

Scenarios:

1. Fresh launch opens to Chat, no blank root, no horizontal overflow.
2. Primary navigation contains Chat, Runs, Tasks, Settings; no primary Overview.
3. `#overview`, `#tools`, `#memory`, `#learning`, and `#evals` route correctly.
4. Composer supports text, slash command, skill selection, skill chip cancellation, workspace switching, send, and stop.
5. Answer streams visibly before completion and does not duplicate on finalization.
6. Thinking is distinct from answer and collapses when long.
7. Guided skill without required input asks for input before model/tool execution.
8. Tool approval can be rejected and approved without bypass.
9. Right process rail appears during active work and remains accessible at narrow widths.
10. Runs view still exposes Run Graph, Kernel Events, trajectory payload/ref viewing, and eval candidate action.
11. Responsive checks at `1440x900`, `1180x800`, `900x700`, `640x760`, and `390x844`.

## Independent Acceptance Officer

An independent acceptance officer must:

- not implement the 2.7.0 changes;
- use production Electron or the packaged app;
- record app path and config dir;
- run command gates or inspect fresh command evidence;
- perform UI tasks through the real app;
- capture screenshots or accessibility evidence;
- record exact pass/fail per scenario;
- issue final verdict `ACCEPTED` or `REJECTED`.

Hard rejection criteria:

- command gates fail;
- UI cannot launch;
- acceptance is not through UI;
- horizontal overflow or incoherent overlap appears in required viewports;
- permission flow is bypassed;
- guided skill input is skipped in auto mode;
- `.zerox/progress.md` lacks evidence.

## Feature Tracking

After design approval, add a new `.zerox/feature_list.json` entry:

```json
{
  "id": "P16-v2.7.0-ui-interaction",
  "status": "planned",
  "title": "v2.7.0 UI and interaction redesign",
  "definitionOfDone": [
    "Primary navigation is Chat, Runs, Tasks, Settings; Overview diagnostics live under Settings with compatibility routing",
    "Chat supports first-class streamed answer output with distinct collapsed thinking/process output",
    "Long answers, code blocks, tool results, and thinking/process details auto-collapse with accessible expansion controls",
    "Interactive and guided skills preflight required inputs, pause for missing user input even in auto mode, and resume from structured responses",
    "Guided skill input values are validated before prompts, permissions, or filesystem scope and cannot bypass ToolAuthorizationService or workspace sandbox checks",
    "System icons are unified through a local icon component and raw glyph controls are replaced",
    "UI/UE design artifacts cover empty, streaming, thinking, guided input, approval, paused, error, restored, desktop, and narrow states",
    "Focused tests, full verification, production smoke, packaged smoke, black-box QA, and independent acceptance pass",
    "package metadata, README, feature list, and progress evidence reflect v2.7.0"
  ],
  "verification": [
    "npm test",
    "npm run build",
    "npm run verify",
    "npm run smoke:prod",
    "npm run harness:score",
    "npm run harness:check",
    "npm run dist:mac",
    "npm run smoke:prod:built",
    "Independent packaged-app UI acceptance officer returns ACCEPTED",
    "git diff --check"
  ]
}
```

## Progress Evidence Format

Use this `.zerox/progress.md` shape when implementation starts:

```md
## YYYY-MM-DD - v2.7.0 UI/Interaction Iteration

- Request:
- Planning/design evidence:
  - Spec:
  - Plan:
  - Design稿/UI/UE artifact:
- Changed files:
- Focused test evidence:
- Full command gates:
- Browser/Electron QA:
  - Scenario:
  - Viewport:
  - Evidence:
  - Result:
- Independent acceptance:
  - Officer:
  - App path:
  - Config dir:
  - Verdict: ACCEPTED | REJECTED
  - Evidence:
```

## Open Approval Gate

Approved direction:方案1, Chat-first consumer experience. Implementation planning may start from this spec; implementation still requires the separate implementation plan and TDD task execution.
