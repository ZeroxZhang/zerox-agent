# Session History Management 2.4.1 Design

## Goal

Zerox Agent 2.4.1 adds first-class history management for chat sessions in the left sidebar. Users should be able to scan recent work, see when each session last received an assistant response, see cumulative token usage, archive low-frequency sessions into a collapsible archive group, and delete sessions through an explicit menu.

The approved product direction is visual option A from:

`/Users/zerox/.gstack/projects/ZeroxZhang-zerox-agent/designs/session-history-20260620/session-history-v241-mockup.html`

The user approved option A but called out that the HTML mockup is visually rough. Implementation must use option A only for information architecture and interaction behavior. It must not copy the mockup's crude spacing, menu styling, typography, or visual density blindly.

## Current Project State

The app is an Electron, React, TypeScript, Vite desktop agent. Its durable product boundary is local-first data, explicit permissions, observable trajectories, recoverable runs, workspace sandboxing, and user-reviewed learning.

Relevant current behavior:

- `src/renderer/App.tsx` renders a workspace sidebar with navigation, pinned entries, and a `Recents` session section.
- `src/renderer/components/AgentChatPanel.tsx` owns active chat state and refreshes session summaries from `window.buildingAgent.listChatSessions()`.
- `src/main/chatSessionStore.ts` persists `chat-sessions.json` with `ChatSessionRecord` data.
- `src/shared/chat.ts` defines `ChatSessionRecord` and `ChatSessionListItem`.
- `src/preload/index.ts` exposes `listChatSessions()` and `getChatSession()`.
- `src/main/ipc/index.ts` registers chat session IPC handlers.

Observed gap:

- Session list items have `updatedAt`, but no archived state, no deletion API, no last assistant response field, and no token usage field.
- `App.tsx` currently maps sidebar sessions back into `ChatSessionListItem` with `updatedAt: new Date(0).toISOString()`, which drops the real timestamp when sessions are refreshed from `AgentChatPanel`.
- `openAiCompatibleClient.ts` parses message content/tool calls but does not surface provider `usage`.
- `package.json` currently reports `2.3.2`; this iteration must update release metadata to `2.4.1`.
- `.zerox/feature_list.json` claims later roadmap completion through `2.4.0`, but repository metadata and README are behind that state. Treat this as progress metadata drift to reconcile carefully, not as proof that runtime code is already at `2.4.0`.

## Approved UX Direction

Use a sidebar-native history model.

The current `Recents` block becomes a history session list. It keeps the app's existing left-rail mental model: users remain in chat while managing history, without opening a separate history page.

Each visible session row shows:

- title
- short summary
- right-aligned latest assistant response time
- right-aligned cumulative token usage
- active goal badge when applicable
- a three-dot action button on hover, focus, or active selection

The three-dot menu contains:

- `归档`
- `删除`

Archived sessions move out of the default visible list into a collapsible `归档会话` group. The archive group itself renders like a session row: title, count, cumulative archived tokens, and expand/collapse affordance. Expanding the group shows archived sessions with the same row structure and action menu.

Deletion is destructive. It must require a confirmation state before removing the local session record.

## Visual Quality Constraints

The mockup is not the final visual style. During implementation:

- Follow existing `tokens.css` color, radius, type, and spacing tokens.
- Keep cards and rows compact, but reduce the mockup's heavy border and button feel.
- Preserve the screenshot-inspired scan pattern: title on the left, time/token on the right.
- Make the three-dot affordance polished and quiet. It should not shove text around aggressively.
- Use consistent icon weight with the existing sidebar icons.
- Avoid nested cards in the sidebar.
- Keep long Chinese and mixed Chinese/English titles contained with ellipsis.
- Keep touch/click targets at least 28px in the dense sidebar, preferably 32px for menu controls.
- Dark mode must remain readable through existing CSS variables.

## Data Model

Extend shared chat types:

- `ChatSessionRecord.archivedAt?: string`
- `ChatSessionRecord.tokenUsage?: ChatSessionTokenUsage`
- `ChatSessionListItem.archivedAt?: string`
- `ChatSessionListItem.lastAssistantMessageAt?: string`
- `ChatSessionListItem.tokenUsage?: ChatSessionTokenUsage`

`ChatSessionTokenUsage`:

- `totalTokens: number`
- `promptTokens?: number`
- `completionTokens?: number`
- `estimated: boolean`

Provider usage is preferred when available. If an OpenAI-compatible provider omits usage, the app records an estimated token count using the existing local token estimator. Estimated values must be safe to display as approximate in code, even if the first UI label stays compact as `18.7k`.

`lastAssistantMessageAt` is derived from the latest assistant message's `createdAt`. If a session has no assistant messages, it falls back to `updatedAt`.

## Main Process Changes

`ChatSessionStore` adds methods:

- `archive(sessionId: string): Promise<ChatSessionRecord | null>`
- `restore(sessionId: string): Promise<ChatSessionRecord | null>`
- `delete(sessionId: string): Promise<boolean>`
- `addTokenUsage(sessionId: string, usage: ChatSessionTokenUsage): Promise<ChatSessionRecord | null>`

Listing behavior:

- `list()` returns all sessions with archived state included.
- Non-archived sessions sort first by `updatedAt` descending.
- Archived sessions sort after non-archived sessions by `archivedAt` descending, then `updatedAt` descending.
- Renderer grouping owns the default visible/archived split, so main-process consumers keep one simple list contract.
- Search should continue to include archived sessions unless a future search UI adds an archived filter. Archived is hidden from the default sidebar, not erased from local evidence.

Storage rules:

- Persist archive and token metadata in `chat-sessions.json`.
- Normalize missing metadata for older sessions without mutating on read.
- Keep atomic JSON writes and corrupt-file quarantine behavior.

## Model Usage Capture

Extend `ChatCompletionResponse` with optional usage:

- `usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }`

`createOpenAiCompatibleClient.complete()` maps common OpenAI-compatible fields:

- `usage.prompt_tokens`
- `usage.completion_tokens`
- `usage.total_tokens`

If usage is missing, `ChatService` estimates usage from messages and reply content. Tool-loop usage should accumulate across loop model responses where practical. A good first slice is to aggregate usage seen in `onModelResponse` plus final fallback estimation when no provider usage exists.

## Renderer Changes

`App.tsx` owns the sidebar management UI because the sidebar lives there.

Renderer responsibilities:

- Preserve real `updatedAt`, `lastAssistantMessageAt`, `archivedAt`, and `tokenUsage` when receiving session updates from `AgentChatPanel`.
- Render the sidebar history section from full session data.
- Group archived sessions under a collapsible `归档会话` row.
- Show time labels as relative values: `刚刚`, `18 小时`, `2 天`, `2 周`.
- Show token labels compactly: `920`, `18.7k`, `204k`.
- Open a small action menu from the three-dot button.
- Trigger archive/delete IPC calls and refresh sessions after success.
- If the active session is deleted, clear `selectedChatSessionId`, request a new chat, and keep the app in Chat.
- If the active session is archived, keep it readable if currently selected, but remove it from the default unarchived group on next selection.

Accessibility:

- The three-dot button has `aria-label="会话操作：<title>"`.
- The menu uses role-appropriate labels for archive and delete.
- Keyboard users can tab to the action button and activate the menu.
- Escape closes the menu.

## IPC And Preload

Expose explicit session management APIs:

- `archiveChatSession(sessionId: string)`
- `restoreChatSession(sessionId: string)`
- `deleteChatSession(sessionId: string)`

IPC channels:

- `chatSessions:archive`
- `chatSessions:restore`
- `chatSessions:delete`

All operations stay in the main process. Renderer never edits `chat-sessions.json` directly.

## Error Handling

- If archive/delete targets a missing session, return a typed failure rather than throwing raw errors into the renderer.
- If deletion fails, leave the row visible and show a compact status message.
- If token usage cannot be parsed, record no provider usage and fall back to estimation.
- If old session data lacks token metadata, display `0` or omit the second line until a new turn records usage. Prefer omission if `0` would look like an exact measurement.
- If corrupted `chat-sessions.json` is detected, keep existing quarantine behavior.

## Testing

Focused tests:

- `src/main/chatSessionStore.test.ts`
  - archives and restores sessions
  - deletes sessions atomically
  - list output carries archived state, last assistant response time, and token usage
  - normalizes older records without metadata
- `src/main/openAiCompatibleClient.test.ts`
  - parses provider usage fields
  - tolerates missing usage
- `src/main/chatService.test.ts`
  - records token usage after a successful assistant reply
  - falls back to estimated token usage when provider usage is absent
- `src/preload/index.test.ts` or IPC-focused coverage if existing pattern supports it
  - exposes the new session management methods
- `src/renderer/materialDesign.test.ts`
  - asserts sidebar history management structure, archive group, action menu labels, time/token rendering classes, and version metadata.

Required verification after implementation:

- focused test command for changed areas
- `npm run harness:check`
- `npm run verify`
- `npm run smoke:prod` because this changes renderer/runtime behavior
- update `.zerox/progress.md` with changed files and command evidence

## Release Metadata

Update:

- `package.json`
- `package-lock.json`
- README current release/version text if present
- package script/readme tests as needed
- `.zerox/feature_list.json` with a single new `P12.1-session-history-management-2.4.1` feature or the repository's current next-feature convention
- `.zerox/progress.md` with evidence

The version for this iteration is `2.4.1`.

## Implementation Gate

No further product decision is needed before implementation. The user chose option A. The implementation caveat is mandatory: use option A's structure, but polish the actual visual design beyond the rough HTML mockup.
