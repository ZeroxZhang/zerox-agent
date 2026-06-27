# Zerox Agent 2.9.0 Output Rendering Design Spec

> Status: Visual direction approved by user on 2026-06-26. Default direction is "Evidence-Linked Answer" fused with "Run Ledger Answer"; "Document Report Answer" is retained for research/report outputs.

## Objective

Zerox Agent 2.9.0 upgrades chat output from a plain markdown transcript plus detached runtime widgets into a typed, recoverable, evidence-bound output system. The product should make final answers easier to read while preserving local-first trust: explicit permissions, workspace sandbox checks, observable trajectories, recoverable sessions, and reviewed learning.

This iteration is not a frontend-only restyle. It changes shared chat contracts, main-process stream events, persistence snapshots, renderer components, format-specific rendering, tests, QA artifacts, and progress evidence.

## Approved Visual Direction

Use the approved A+B direction:

- A, Evidence-Linked Answer, is the default answer surface. The assistant answer remains document-like, but evidence chips, file references, tool results, citations, and approval states are bound to the answer instead of floating as unrelated widgets.
- B, Run Ledger Answer, is embedded for long tasks, code work, verification, command output, diffs, checkpoints, and retry/recovery events.
- C, Document Report Answer, is a mode for research reports and long-form deliverables that need a table of contents, citations, source coverage, tables, and artifact export affordances.

Reference visual artifact:

- `/Users/zerox/.gstack/projects/ZeroxZhang-zerox-agent/designs/zerox-agent-2-9-output-rendering-20260626-123139/output-rendering-board.html`

## Current State Findings

### Renderer

- `src/renderer/components/AgentChatPanel.tsx` renders the chat transcript, thinking disclosure, tool preview, approval requests, goal state, guided skill input, and composer in one large component.
- `src/renderer/chatMarkdown.ts` is intentionally safe and lightweight. It supports paragraphs, headings, ordered/unordered lists, fenced code blocks, bold, inline code, and `http(s)` links. It does not support tables, block quotes, task lists, citations, file references, syntax-aware code headers, structured command output, or artifact cards.
- Runtime surfaces are visually split from the assistant message. Thinking, tool previews, approvals, and guided inputs appear as a side/runtime stack rather than being bound to the answer that caused them.
- Tool preview data is raw and argument-delta oriented. It is useful for debugging but weak for reading, audit, or restore.
- Streaming answer state and restored session state are related but not the same. Restored sessions lose much of the semantic detail that was visible during live execution.

### Main Process And Shared Contracts

- `src/shared/chat.ts` keeps persisted assistant content as `ChatMessageRecord.content: string`.
- `ChatStreamEvent` supports answer deltas, thinking deltas, tool preview, status, waiting for input, and terminal variants, but the main process does not consistently emit terminal stream events.
- `ChatTaskStatusEvent` carries useful process details, but session activity snapshots normalize and truncate event history, so restored sessions lose structured evidence.
- Agent trajectory and research writing contracts already contain richer concepts such as citations, report artifacts, and evidence sidecars, but chat output does not expose those concepts as first-class renderable parts.

## Market Patterns To Borrow

- ChatGPT Canvas separates substantial editable output into a dedicated surface with inline edits, version history, and code-oriented actions: https://help.openai.com/en/articles/9930697-what-is-the-canvas-feature-in-chatgpt-and-how-do-i-use-it
- Claude Artifacts opens substantial standalone content in a dedicated window separate from the conversation: https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them
- Claude Citations attaches source references to generated text blocks and makes source grounding inspectable: https://claude.com/blog/introducing-citations-api
- Perplexity presents synthesized answers with source links and encourages checking underlying sources: https://www.perplexity.ai/help-center/en/articles/10354917-what-is-an-answer-engine-and-how-does-perplexity-work-as-one
- GitHub Copilot and VS Code agent mode expose tool activity, terminal commands, diffs, and review controls around the coding task rather than burying them in prose: https://code.visualstudio.com/docs/chat/chat-overview
- Devin and Cascade emphasize checkpoints, reviewable work, and local/remote execution visibility for agentic software tasks: https://docs.devin.ai/desktop/cascade/cascade

Borrow the structure, not the cloud assumptions. Zerox keeps local-first execution, explicit authorization, workspace sandbox checks, and recoverable trajectories.

## Output Format Matrix

| Format | Backend Source | Renderer Treatment | Persistence Requirement |
| --- | --- | --- | --- |
| Paragraphs, headings, lists, quotes | assistant text stream or restored `content` | document-style answer typography with compact spacing | preserve `content` and derived text parts |
| Tables | markdown table or `table` output part | responsive table with header styling, horizontal scroll, readable empty cells | persist column names, rows, caption, and fallback markdown |
| Code blocks | fenced markdown or `code` output part | language label, copy action, line wrapping toggle, long-block collapse | persist language, code, title, and source tool/ref |
| Diff blocks | `file_diff` output part or fenced `diff` | added/removed line colors, file header, summary chip | persist file path, additions, deletions, patch text |
| Terminal and command output | `command_output` output part from shell/test tools | command header, exit code, stdout/stderr split, expandable long logs | persist command, cwd, exit code, output preview, full output ref when large |
| JSON and tool arguments | `tool_call` and `tool_result` output parts | pretty viewer, masked secret fields, folded nested values | persist structured JSON when available and sanitized preview always |
| File references | `file_ref` or artifact evidence | clickable local file chip, path, kind, changed/read/generated status | persist workspace-relative path, absolute path only when allowed, action kind |
| Artifacts | `artifact` output part | artifact card with title, type, size, open/reveal action | persist artifact id, file path, media type, createdAt, evidence refs |
| Citations and sources | citation sidecar or `citation` output part | inline numbered citation chips plus evidence rail grouping | persist citation id, source title, URI/path, quote range or section |
| Approval gates | `approval_request` output part and status event | bound approval block with risk, tool, args preview, allow/deny actions | persist request id, tool source, risk level, decision |
| Guided input | `input_request` output part and waiting event | form block bound to the answer turn, not generic sidebar text | persist field specs, partial answers, validation state |
| Errors and diagnostics | `error` output part or terminal stream event | diagnostic block with cause, next action, retry availability | persist error kind, message, tool/request refs |
| Progress and checkpoints | `ledger_event` output part and trajectory event | compact run ledger row with status, time, tool, evidence link | persist event id, sequence, status, related tool/result refs |

## Shared Output Contract

Add a typed render layer while keeping the existing plain text surface for search, model history, exports, and backward compatibility.

Recommended model:

```ts
export type ChatOutputPart =
  | ChatTextPart
  | ChatTablePart
  | ChatCodePart
  | ChatDiffPart
  | ChatCommandOutputPart
  | ChatToolCallPart
  | ChatToolResultPart
  | ChatFileRefPart
  | ChatArtifactPart
  | ChatCitationPart
  | ChatApprovalPart
  | ChatInputRequestPart
  | ChatDiagnosticPart
  | ChatLedgerEventPart;
```

Persisted messages keep `content: string` and gain `outputParts?: ChatOutputPart[]`. New stream events include stable sequence metadata so live rendering, restore, and audit can converge.

Required stream metadata:

- `sessionId`
- `requestId`
- `sequence`
- `turnId`
- `assistantMessageId`
- `createdAt`

Every chat request emits exactly one terminal event:

- `completed`
- `failed`
- `canceled`

Terminal events include `finalMessageId` and either the final plain text reply or a diagnostic message.

## UI Specification

### Default Answer Block

- Assistant answers render as a readable document surface without bubble-heavy styling.
- Evidence chips sit directly below the relevant answer section.
- Runtime facts are grouped as "Evidence", "Files", "Commands", "Approvals", and "Diagnostics".
- The latest active turn can show a right rail, but restored content remains useful without the rail.

### Run Ledger

- Long tasks show a compact ledger with status rows for plan, tool calls, approvals, commands, file edits, verification, recovery, and finalization.
- Ledger rows are collapsed by default after completion. Failed or waiting rows stay open.
- Ledger content links to the same evidence refs used by Runs, so Chat remains a readable work record without replacing Runs as the audit surface.

### Tables

- Markdown pipe tables and typed table parts both render through the same table component.
- Tables use compact density, visible column headers, zebra-free neutral rows, and horizontal overflow containment.
- Empty values render as muted em dash text.
- Wide tables never force horizontal page overflow.

### Code Blocks

- Code blocks show language, title or file path when available, copy action, and collapse control for long blocks.
- Fenced `diff` blocks use the diff renderer.
- Inline code remains quiet and readable, without link-blue styling.
- Long code defaults to a capped height with an obvious expand affordance.

### Command Output

- Command output includes command, cwd, elapsed time when available, exit code, and stdout/stderr grouping.
- Passing verification commands get a success treatment; failing commands get a diagnostic treatment with the failing command visible.
- Large logs use preview plus expand, preserving local-first evidence.

### JSON And Tool Details

- Tool arguments and results render as structured JSON when valid.
- Secret-like fields are masked in previews using name-based rules such as `token`, `key`, `secret`, `password`, and `authorization`.
- Invalid JSON remains visible as raw text with a warning badge.

### Citations And Sources

- Inline citations appear as compact numbered chips.
- Source details live in the evidence rail and in restored message metadata.
- Local file citations prefer workspace-relative paths.
- Web citations include source title and URL.

### Approvals And Guided Input

- Approval requests remain explicit user gates and never become visual-only hints.
- Guided input requests render as forms bound to the active turn.
- Renderer actions call existing IPC/preload paths; the renderer does not decide authorization.

## Architecture Requirements

- Do not add cloud workers, remote rendering services, or external storage.
- Do not bypass `ToolAuthorizationService`.
- Do not bypass workspace sandbox checks.
- Do not write raw thinking into reviewed learning.
- Do not render raw HTML from model output.
- Keep plain text `content` backward compatible for old sessions.
- Keep Runs as the authoritative deep audit/replay view.
- Keep `.zerox/progress.md` command evidence current after implementation slices.

## Acceptance Criteria

- Restored sessions show the same answer/evidence/artifact structure as live sessions for the supported output parts.
- Tables, code blocks, diffs, terminal output, JSON/tool arguments, file references, artifacts, citations, approval gates, guided input requests, errors, and ledger rows have focused tests.
- Live stream events are sequence-stable and terminal-complete.
- Renderer tests cover desktop and narrow layouts without horizontal overflow.
- Focused tests pass for shared contracts, main-process event mapping, markdown/table parsing, renderer material design, and persistence restore.
- `npm run verify`, `npm run smoke:prod`, and `npm run harness:check` pass before a release claim.
