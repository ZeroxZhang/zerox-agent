# Runs Module Simplified Redesign

## Context

The current Runs page is technically useful but reads like an observability console. It exposes run lists, event timelines, payloads, Run Graph, Kernel Events, eval candidates, and trajectory JSON with similar visual weight. For a consumer-facing desktop agent, that makes the user work too hard.

The approved direction is the v2 simplified mockup:

- Local companion URL during design review: `http://localhost:51573`
- Mockup file: `.superpowers/brainstorm/12504-1782556056/content/runs-module-redesign-v2-simple.html`

The module remains necessary, but its user-facing job changes:

> Show whether each task finished, what needs attention, and the safest next action. Keep technical evidence available, but not primary.

## Product Positioning

Rename the user-facing module from `运行` to `任务记录`.

Navigation copy:

- Label: `任务记录`
- Module: `活动`
- Summary: `查看每次任务是否完成，以及下一步怎么处理。`

The page should not call itself a log viewer, run graph viewer, or observability surface. Those are implementation details.

## Information Architecture

The page has one primary path:

1. User opens `任务记录`.
2. The page highlights the most important task, usually one that needs attention.
3. The task card states the outcome in plain language.
4. The primary action is obvious.
5. The user can inspect simple details.
6. Technical details are available behind disclosure.

Default desktop layout:

- Left app navigation remains unchanged in the app shell.
- Main content uses a single centered content column with a max width.
- Top header: page title, short description, `打开会话`, `新任务`.
- Focus card: the one selected or most urgent task.
- Recent tasks list: simple rows with status, title, outcome, time, and a lightweight view affordance.
- Simple detail panel: only the selected task's human-readable steps.
- Technical details accordion: collapsed by default.

Mobile layout:

- No stacked three-column log page.
- Use segmented tabs: `处理`, `历史`, `详情`.
- Default tab is `处理`.
- Primary action remains visible without scrolling on common phone sizes.

## State And Action Model

Each state chooses one primary action.

| Run status | User label | Primary action | Secondary actions |
|---|---|---|---|
| `running` | `正在运行` | `停止` | `打开会话`, `查看详情` |
| `paused` | `已暂停` | `继续` | `停止`, `打开会话`, `查看详情` |
| `canceled` | `已停止` | `重新运行` | `打开原会话`, `查看详情` |
| `failed` | `需要处理` | `修正后重试` | `打开会话`, `查看详情` |
| `succeeded` | `已完成` | `查看结果` | `再次运行`, `查看详情` |
| waiting for approval | `需要授权` | `查看授权` | `打开会话`, `停止` |

Rules:

- `继续` resumes an existing checkpoint.
- `重新运行` or `修正后重试` creates a new run.
- Do not show `重新运行任务` as the universal primary action.
- If retry may duplicate local file or shell side effects, warn before starting.
- If a checkpoint is missing, disable `继续` and offer `重新运行`.

## Copy Rules

User-facing copy must describe outcomes, not internals.

Replace examples:

- `运行` -> `任务记录`
- `成功` -> `已完成`
- `已取消` -> `已停止`
- `失败` -> `需要处理`
- `处理建议` -> `下一步`
- `选中事件` -> `发生了什么`
- `Run Graph` -> `证据链`
- `Kernel Events` -> `高级日志`
- `payload` -> `原始数据`
- `Agent loop canceled.` -> `任务已停止。`
- `Goal milestone started...` -> `开始步骤：...`

Raw English event strings should not appear in the default view.

## Progressive Disclosure

Default view shows:

- Task title
- Outcome
- Whether the agent continued operating locally
- Whether artifacts were produced
- Whether memory was written
- Plain-language step summary
- Next action

Collapsed `技术详情` may show:

- Run Graph
- Kernel Events
- trajectory events
- raw payload JSON
- tool result refs
- eval candidate information
- parent/child run ids

Technical detail panels must be bounded. Large JSON cannot stretch the page indefinitely.

## Visual Design Requirements

This is a hard quality gate, not polish for later.

Layout:

- Main content must have a stable max width and consistent left/right alignment.
- Cards in the same section use the same border radius, padding, and border color.
- Buttons align to a clear action area and do not float inconsistently.
- Recent task rows have consistent height rhythm, but allow long titles to wrap.
- The focus card and detail panel should align on desktop. No accidental staggered edges.
- Do not nest card-like surfaces more than one level deep.

Responsive behavior:

- At desktop widths, the page should feel spacious and centered.
- At tablet widths, the focus card stacks before the task list.
- At mobile widths, use tabs and a single column.
- No horizontal scrolling at `390px` viewport width.
- Touch targets must be at least `44px` tall.

Text:

- Long Chinese titles, long English tool names, and long file paths must wrap inside their containers.
- Buttons must not truncate primary action labels.
- Status pills must not overlap titles or timestamps.
- Technical JSON uses a scrollable area with max height.

Visual hierarchy:

- Only one element should feel like the primary next action.
- Status color is used sparingly: green for completed, amber for stopped/attention, red for errors, blue for info.
- The page should not present five counters as the first thing users see.

## Empty And Edge States

No runs:

- Title: `还没有任务记录`
- Body: `从会话里发起一个任务，完成后会在这里看到结果和步骤。`
- Primary CTA: `打开会话`
- Secondary CTA: `运行首次验收`

No selected task:

- Select the most recent attention task.
- If none need attention, select the most recent completed task.

No trajectory evidence:

- Show: `这次任务没有可查看的详细证据，可能来自旧版本或预览数据。`
- Do not show an empty JSON panel.

Failed permission:

- Show denied path, command, or domain in plain language.
- Primary CTA: `查看授权`

Failed model config:

- Primary CTA: `打开设置`

Parent/child runs:

- Default list shows the parent as the task.
- Child runs appear in technical details unless the user opens collaboration details.

## Implementation Scope

Expected code areas:

- `src/renderer/components/RunsPanel.tsx`
- `src/renderer/components/RunTrajectoryPanel.tsx`
- `src/shared/navigation.ts`
- `src/shared/agentRunInsights.ts`
- Runs-related CSS in `src/renderer/styles/legacy.css` or a new scoped style file if consistent with existing project style.

Implementation should preserve existing backend run, retry, resume, pause, trajectory, and tool-ref APIs. This is primarily presentation and interaction reshaping.

## Verification Requirements

Focused verification:

- Unit tests for run status labels and primary-action mapping.
- Unit tests for event copy translation where current raw English is known.
- Renderer tests for empty state, attention state, completed state, failed permission state, and mobile tab selection if feasible.

Visual verification:

- Run the app locally.
- Capture desktop screenshot around `1440x900`.
- Capture mobile screenshot around `390x844`.
- Check no overlap, no horizontal scroll, no clipped button text, no misaligned main sections.
- Check with at least one very long task title and one long path/tool payload.
- Open `技术详情` and confirm large JSON scrolls inside its panel.

Required project verification after implementation:

- Focused test command for changed modules.
- `npm run harness:check`
- `npm run verify`
- `npm run smoke:prod` if the change affects packaged UI/runtime behavior.

## Non-Goals

- Do not redesign the entire app shell.
- Do not change the run storage model.
- Do not remove technical evidence.
- Do not add cloud sync or cloud workers.
- Do not bypass existing permission or workspace sandbox checks.

## Acceptance Criteria

- A non-technical user can tell whether the latest task completed or needs action within three seconds.
- The primary next action is visible without reading raw logs.
- Technical evidence remains accessible but does not dominate the page.
- The page remains visually aligned and readable across desktop and mobile.
- Long content does not break layout.
- Existing run recovery and retry behavior remains intact.
