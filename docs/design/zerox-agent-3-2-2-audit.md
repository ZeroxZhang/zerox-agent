# Zerox Agent v3.2.2 Design System Audit

Date: 2026-07-06
Phase: 1 / Audit
Status: ready for direction proposal after user confirmation

## Scope

This audit covers the current renderer implementation of Zerox Agent as a desktop AI Agent application. It focuses on design-system structure, desktop interaction patterns, brand/icon language, AI Agent states, tool authorization, goal execution, settings governance, responsive behavior, and visible accessibility risks.

No product behavior was changed in this phase. The only durable outputs are this document, the screenshot evidence folder, and the progress entry.

## Evidence

### Local Code And Runtime Evidence

- Initialized the repo with `./init.sh`; it ran `npm run harness:check` and `npm test -- src/shared/packageScripts.test.ts`, both passing.
- Current app metadata in `package.json` is `3.2.1`; this audit starts the `3.2.2` iteration.
- `.zerox/feature_list.json` currently has no unfinished feature. I did not add a new planned feature in the audit phase to avoid changing release gates before direction approval.
- Browser preview ran at `http://127.0.0.1:5173/`.
- Screenshot and metrics evidence is stored in `docs/design/zerox-agent-3-2-2-audit/`.

### Screenshot Set

| File | Surface | Notes |
| --- | --- | --- |
| `01-chat-empty-desktop.png` | Chat, full-page capture | Capture artifact: mostly blank; retained as rejected evidence. |
| `02-runs-desktop.png` | Runs, full-page capture | Capture artifact: left-clipped; retained as rejected evidence. |
| `03-settings-model-desktop.png` | Settings / Model | Usable full-page evidence. |
| `04-settings-tools-desktop.png` | Settings / Tools | Usable full-page evidence. |
| `05-settings-memory-desktop.png` | Settings / Memory | Usable full-page evidence. |
| `06-settings-system-desktop.png` | Settings / System | Usable full-page evidence. |
| `07-chat-skill-menu-desktop.png` | Chat skill mention attempt | `@` produced unclear feedback in preview data. |
| `08-chat-goal-mode-desktop.png` | Chat goal mode | Shows goal/auto/stop/send controls in composer. |
| `09-chat-workspace-menu-desktop.png` | Workspace picker | Shows local workspace menu over chat home. |
| `10-chat-empty-viewport.png` | Chat, 1440x900 viewport | Primary desktop chat evidence. |
| `11-runs-viewport.png` | Runs, 1440x900 viewport | Primary desktop runs evidence. |
| `12-settings-model-viewport.png` | Settings / Model, 1440x900 viewport | Primary desktop settings evidence. |
| `13-chat-tablet-900.png` | Chat, 900x800 | Tablet/narrow desktop evidence. |
| `14-settings-model-tablet-900.png` | Settings / Model, 900x800 | Tablet/narrow desktop evidence. |
| `15-chat-mobile-390.png` | Chat, 390x844 | Narrow responsive evidence. |
| `16-runs-mobile-390.png` | Runs, 390x844 | Narrow responsive evidence. |
| `17-settings-model-mobile-390.png` | Settings / Model, 390x844 | Narrow responsive evidence. |
| `figma-reference-dashboard.png` | User-provided Figma reference | Dashboard reference for Phase 2 direction proposals. |
| `capture-metrics.json` | Runtime metrics | Viewport, overflow, focusable count, and console evidence. |

### Runtime Metrics Summary

- 1440x900 desktop captures: no page-level horizontal overflow in Chat, Runs, Model Settings, Tools, Memory, or System.
- Console logs during capture: no `warn` or `error` entries.
- 390x844 captures: no page-level horizontal overflow, but Chat risk tooltips extend off the left edge while still not increasing document scroll width.
- At 900px, the sidebar becomes a top navigation band and hides pinned/recents. This avoids overflow, but removes recent conversation context from the narrow desktop workflow.

### Figma Reference

The supplied Figma Community reference is a 1100x726 light dashboard: pale blue background, white elevated panel, blue vertical icon rail, three statistic cards, a line chart, and rounded white surfaces. It is a useful visual benchmark for a light, approachable dashboard, but it does not directly solve Zerox's denser Agent-specific states: streaming output, workspace sandbox, permission gates, tool calls, evidence, goal review, and recoverable failures.

## Current System Map

### UI Stack

- React 19 renderer with Vite and Electron.
- CSS is split across `tokens.css`, `base.css`, `app-shell.css`, `sidebar.css`, `chat.css`, `composer.css`, `cards.css`, `responsive.css`, plus a large `legacy.css`.
- Main shell: `src/renderer/App.tsx`.
- Core Agent surface: `src/renderer/components/AgentChatPanel.tsx`.
- Design-system smoke tests: `src/renderer/materialDesign.test.ts`.
- Existing v3.2.1 design doc: `docs/design/zerox-agent-3-2-1-ui-ux-design-system.md`.

### Existing Design Thesis

v3.2.1 documents the product as a "quiet local glass control plane". The current UI mostly follows that direction: cool blue-gray surfaces, glass panels, large left navigation, subdued typography, and status pills.

The implementation, however, is not yet a single system. It is a layered accumulation of Material 3 legacy tokens, newer glass tokens, component-specific overrides, and hard-coded Agent output styling.

## Findings

### 1. Design Source Of Truth Is Split

`src/renderer/styles.css:1` imports `legacy.css` before the new token and component files. `legacy.css` itself declares a full Material 3 design system at `src/renderer/styles/legacy.css:1-110`, while `tokens.css` declares another token set at `src/renderer/styles/tokens.css:1-120`.

This means the renderer has two competing foundations:

- Legacy Material 3: Google-blue, Google Sans/Roboto, 96px rail assumptions.
- Current glass control plane: Inter/system stack, 280px sidebar, cool blue-gray panels.

Impact:

- Designers and engineers cannot answer "which token is canonical?" without reading cascade order.
- Component changes risk accidentally reviving legacy assumptions.
- Dark mode coverage is fragile because legacy and current tokens do not map one-to-one.

Severity: high.

### 2. Token Semantics Are Too Broad And Too Shallow

The current token file has useful primitives, but component semantics are under-modeled. `tokens.css` mixes root surfaces, glass surfaces, brand colors, nav colors, chat colors, status colors, typography, spacing, radius, shadows, transitions, and layout widths in one flat namespace.

Examples:

- `--bg-*` includes both page surfaces and interactive accent colors.
- `--glass-*` encodes material effects but not component intent.
- `--status-*` supports success/error/warning/info, but there are no Agent-specific semantic tokens for `planning`, `executing`, `reflecting`, `awaiting_approval`, `blocked`, `recoverable`, `memory_write`, `tool_call`, or `evidence`.
- `--transition-fast`, `--transition-normal`, and `--transition-slow` use generic `ease` at `tokens.css:113-115`, so motion does not encode desktop interaction intent.

Impact:

- Agent state surfaces are forced to reuse generic info/warning/error colors.
- Tool calls, evidence, diffs, command output, and goal review cannot become visually coherent without more tokens.
- Dark mode is partial: `tokens.css:122-155` overrides many root colors but does not cover all status, danger, warning, success, code, shadow, and component-specific hard-coded values.

Severity: high.

### 3. Agent Output Surfaces Still Use Hard-Coded Visual Values

The highest-value AI Agent surfaces are not fully tokenized. Chat output, code blocks, command output, diffs, and evidence cards contain direct hex and rgba values:

- Inline code and markdown code blocks: `src/renderer/styles/chat.css:401-447`.
- Dedicated chat code/command output: `src/renderer/styles/chat.css:638-694`.
- Diff blocks: `src/renderer/styles/chat.css:696-729`.
- Goal runtime process: `src/renderer/styles/chat.css:1277-1285`.
- Context and side cards: `src/renderer/styles/chat.css:1425-1542`.
- Composer focus shadow: `src/renderer/styles/composer.css:293-298`.

Impact:

- Dark mode and future themes will break first in the most important Agent output areas.
- Code, terminal, JSON, diff, evidence, approval, and citation surfaces look related by proximity, not by a designed syntax.
- A design-system migration cannot be completed safely until these surfaces get explicit semantic tokens.

Severity: high.

### 4. Core Agent States Are Present But Not Yet A Visual Language

`AgentChatPanel` already renders the right conceptual pieces:

- thinking text and tool call previews at `AgentChatPanel.tsx:2177-2192`
- goal draft at `AgentChatPanel.tsx:2194-2209`
- active goal status at `AgentChatPanel.tsx:2211-2228`
- goal run events and tool approval monitor at `AgentChatPanel.tsx:2230-2282`
- tool approval panel at `AgentChatPanel.tsx:2285-2292`
- guided skill input at `AgentChatPanel.tsx:2294-2308`

The pieces exist, but they do not share a crisp state grammar. "Thinking", "tool preview", "goal draft", "approval", "review", "input request", and "ledger event" are styled as separate cards/panels rather than one execution timeline language.

Impact:

- The user sees multiple local widgets instead of one Agent run trajectory.
- Tool authorization and evidence are not visually central enough for a local-first trust product.
- Streaming output, tool calls, and recovery states do not yet feel like the soul of the app.

Severity: high.

### 5. Composer Carries Too Much Meaning In Small Controls

The composer is structurally powerful: workspace picker, workspace path, skill mention, auto approval, goal mode, stop, and send live in one surface. The implementation is at `AgentChatPanel.tsx:2313-2623` and `composer.css:272-590`.

Problems:

- `自动` and `目标` are high-risk/high-authority modes but are visually tiny chips at `composer.css:528-548`.
- Risk explanations depend on hover/focus tooltip behavior at `composer.css:557-590`.
- On 390px, tooltip boxes extend off the left edge according to `capture-metrics.json`.
- `@` skill mention had unclear feedback in preview state; a user can trigger a command grammar without seeing what happened.
- Workspace menu appears as a large overlay over the empty-state hero (`09-chat-workspace-menu-desktop.png`), temporarily obscuring the primary prompt.

Impact:

- High-risk modes are underweighted compared with their behavioral consequences.
- Keyboard and screen-reader users may not get equivalent warning affordance.
- The composer is becoming the real command center, but the visual system still treats it as a chat input.

Severity: high.

### 6. Desktop Information Architecture Is Better Than Before, But Still Ambiguous

Primary navigation currently has `会话`, `任务记录`, `任务`, and `设置` in `src/shared/navigation.ts`. The difference between `任务记录` and `任务` is conceptually correct, but visually and linguistically close.

Settings groups are more useful than a flat settings page, but in the screenshot they still read as a governance sidebar inside a governance page. Trust-critical surfaces such as tools, memory, learning, and evals are nested under Settings, even though they are product-defining capabilities.

Impact:

- New users may not understand where permission history, run recovery, memory review, and eval review live.
- "Settings" contains much of the product's trust proposition, which underplays the local-first control-plane identity.
- Navigation is efficient on desktop, but narrow layouts hide recents and pinned entries at `responsive.css:40-43`.

Severity: medium-high.

### 7. The Visual Density Is Inconsistent Across Surfaces

Runs is the strongest screen right now. `11-runs-viewport.png` shows clear next action, recent tasks, and a readable event panel.

Settings is useful but heavy: a left settings nav, a body card, and nested cards produce a card-within-card rhythm (`12-settings-model-viewport.png`). Chat empty state is the opposite: hero-scale type and large breathing room, then a large composer at the bottom (`13-chat-tablet-900.png`, `15-chat-mobile-390.png`).

Impact:

- Chat feels like a polished launcher; Runs feels like a task console; Settings feels like an admin form.
- The product does not yet have one desktop density rule.
- The Figma reference's dashboard card language would amplify this inconsistency if copied directly.

Severity: medium-high.

### 8. Brand And Icon Language Are Not Unified

Brand assets use cream background, black mark, and cyan stroke:

- `build/icon.svg:4-19`
- `build/zerox-logo.svg:4-39`

The app UI uses cool blue-gray glass tokens and a dark navy accent. Navigation icons use Material-style filled paths inline in `App.tsx:414-422`, while local controls use a separate hand-coded stroke icon set in `Icon.tsx:1-65`.

Impact:

- The app icon, wordmark, navigation icons, and control icons feel like adjacent systems.
- The cyan brand accent is almost absent from the active product UI.
- There is no documented icon grammar for Agent-specific concepts such as memory write, sandbox, approval, evidence, retry, checkpoint, or review gate.

Severity: medium-high.

### 9. Accessibility Is Partially Considered But Not Systematic

Strengths:

- Many regions have `aria-label`.
- Buttons often have accessible names.
- Some status messages use `role="status"` or `role="alert"` in settings panels.
- There is a reduced-motion media query at `responsive.css:221-227`.

Risks:

- `GoalDetailDrawer` is visually modal but uses an `aside` with only `aria-label` and no `role="dialog"`, no `aria-modal`, no visible focus handoff, and no Escape handling in the component (`GoalDetailDrawer.tsx:35-57`).
- `ToolApprovalPanel` uses `role="dialog"` at `AgentChatPanel.tsx:3187-3194`, but it is inline in the runtime stack, not modal, and lacks the full dialog contract.
- Hidden checkbox labels for auto approval rely on a visually small text label; warning detail is in a tooltip, not persistent text (`AgentChatPanel.tsx:2550-2594`).
- `responsive.css:159-165` hides horizontal overflow for tables/code/JSON instead of defining a scroll policy; this protects layout but can hide inspectable technical content.
- Mobile navigation in Chat measured `0x0` for `.workspace-sidebar` in `15-chat-mobile-390.png` metrics, while non-chat pages show a visible top nav. This may be intentional, but there is no alternate persistent route affordance in the Chat narrow view.

Impact:

- The most safety-sensitive interactions are not guaranteed to be keyboard/screen-reader robust.
- Dialog and popover contracts need to be formalized before visual implementation.

Severity: high for safety surfaces, medium elsewhere.

### 10. Responsive Behavior Avoids Overflow But Does Not Define A Narrow Desktop Experience

The CSS breakpoints prevent page-level horizontal overflow in tested viewports, which is good. But the responsive behavior is mostly rearrangement and hiding:

- At <=900px the sidebar becomes a top block and hides pinned/recents (`responsive.css:25-43`).
- At <=640px the brand copy and new chat button disappear (`responsive.css:64-80`).
- Chat composer remains large: 366x186 at 390x844.
- Tooltips can render outside the viewport while not creating document overflow.

Impact:

- Narrow desktop and mobile states are usable but not purposeful.
- Hidden recents/pinned sections remove task continuity at the exact widths where users may need compact navigation.
- There is no explicit narrow-window information architecture.

Severity: medium.

## Strengths To Preserve

- Local-first trust pillars are already visible in product copy and architecture.
- Runs already frames failures around next action and recovery.
- Chat already contains the correct raw ingredients: workspace, skill, goal mode, tool approval, streaming states, runtime previews, and context.
- Settings groups model, tools, memory, skills, learning, evals, and system health in a sensible governance hierarchy.
- The current color palette is calm and restrained, avoiding noisy SaaS dashboards.
- Desktop density is moving in the right direction in Runs and Settings.

## Risks If We Only Re-Skin

- A new palette will not fix the split source-of-truth problem.
- A Figma-dashboard-like card system will make Agent states feel generic.
- Leaving `legacy.css` and hard-coded Agent output values in place will make dark mode and future brand work brittle.
- Tool authorization and evidence will remain too visually secondary.
- The composer will keep accumulating authority without a designed command grammar.

## Required Design System Work In Later Phases

1. Define a canonical token architecture:
   - primitive tokens: color, typography, spacing, radius, elevation, motion
   - semantic tokens: app, surface, text, border, focus, status
   - Agent tokens: planning, executing, thinking, tool-call, tool-result, approval, denied, evidence, memory, recovery, review
   - component tokens: sidebar, composer, timeline, code, table, popover, dialog, form

2. Retire or quarantine `legacy.css`:
   - stop declaring tokens in legacy
   - move still-used component rules into named CSS files
   - remove cascade-dependent duplicates

3. Redesign Agent execution language:
   - one timeline grammar for thinking, tool calls, approvals, evidence, checkpoints, review, recovery
   - explicit status icon/color/shape mapping
   - persistent trust metadata: workspace, sandbox, model, skill, memory policy

4. Redesign composer as a command surface:
   - workspace and sandbox as persistent contract
   - goal/auto approval as prominent authority states
   - skill mention and slash command empty/no-match states
   - tooltip alternatives for keyboard and touch users

5. Establish dialog/popover accessibility contracts:
   - modal vs inline disclosure definitions
   - focus trap, Escape, return focus, labelled/described by
   - popover placement and collision rules

6. Unify brand and icon system:
   - decide whether cyan remains a live UI accent
   - define icon stroke/fill style and sizes
   - add Agent-specific icon categories
   - align logo background with app surfaces

## Phase 2 Direction Questions

The next phase should not ask whether the app should be "simple" or "modern"; those are not design directions. It should ask which product character best supports a local desktop AI Agent:

1. Quiet Operations Room: denser, trust-first, Linear/Raycast-like control plane.
2. Agent Flight Deck: stronger execution timeline, state lights, tool telemetry, but still restrained.
3. Soft Local Workspace: more approachable, closer to the supplied Figma dashboard, with gentler onboarding and lighter cards.

My preliminary recommendation is option 1 with selected mechanics from option 2. Zerox's differentiation is not "dashboard analytics"; it is permissioned local execution with observable, recoverable Agent work.

## Acceptance For This Phase

- Audit document created: yes.
- Screenshot evidence captured under `docs/design/`: yes.
- Figma reference inspected and saved locally: yes.
- No UI behavior changed: yes.
- Awaiting user confirmation before direction proposal: yes.
