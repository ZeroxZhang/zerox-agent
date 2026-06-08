# Memory Runtime P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first runtime-grade memory layer: bounded recall, source-linked chat evidence, and authorized active memory search tools.

**Architecture:** Keep the current local-first JSON memory store and add small focused runtime adapters around it. Chat recall goes through a budgeted helper; chat messages become L0 evidence through `chatSessionStore.searchMessages`; agent memory tools are registered in the existing dynamic tool registry and protected by task memory-read permissions.

**Tech Stack:** TypeScript, Electron main process, React renderer, Vitest.

---

## File Structure

- Create `src/main/memoryRecall.ts`: shared memory recall timeout, per-record truncation, total prompt budget helpers.
- Create `src/main/memoryRecall.test.ts`: red/green tests for timeout and prompt budget behavior.
- Modify `src/shared/chat.ts`: add raw conversation search result types.
- Modify `src/main/chatSessionStore.ts`: add `searchMessages()` over persisted chat sessions.
- Modify `src/main/chatSessionStore.test.ts`: prove chat messages can be searched as L0 evidence.
- Modify `src/shared/memory.ts`: add `chat_session` memory source for evidence-linked session memories.
- Modify `src/main/chatService.ts`: use budgeted recall and write session memories after assistant persistence with chat message ids as source evidence.
- Modify `src/main/chatService.test.ts`: update expectations for bounded recall and evidence-linked memory source.
- Modify `src/main/agentProceduralMemory.ts`: reuse budgeted recall for procedural memory prompt injection.
- Modify `src/shared/toolPermissions.ts`: add `memory.read/write` to task policies and authorize memory tools.
- Modify `src/shared/toolPermissions.test.ts`: prove skill memory permissions flow into task policy and memory tools are denied/allowed correctly.
- Modify `src/shared/toolSafetySummary.ts` and tests: show memory permission in run safety summary.
- Modify `src/renderer/components/ScheduledTasksPanel.tsx`: expose memory read/write toggles and summarize memory permissions.
- Modify `src/main/agentToolExecutor.ts`: register `memory_search` and `conversation_search`.
- Modify `src/main/agentToolExecutor.test.ts`: prove both memory tools return bounded structured results.
- Modify `src/shared/agentProtocol.ts`: add memory tools to supported tool names, static definitions, and system prompt guidance.
- Modify `src/main/chatService.ts`: pass registry-backed tools into the unified chat loop.
- Modify `src/main/main.ts`: construct tool executors with memory and chat-session stores.

---

### Task 1: Budgeted Memory Recall Helper

**Files:**
- Create: `src/main/memoryRecall.ts`
- Test: `src/main/memoryRecall.test.ts`

- [ ] **Step 1: Write failing tests for timeout and prompt budgets**

```typescript
it("returns no memories when recall exceeds the timeout", async () => {
  const results = await recallMemoriesWithBudget({
    memoryStore: {
      search: () =>
        new Promise((resolve) =>
          setTimeout(() => resolve([createResult("slow", "Slow memory")]), 20),
        ),
    },
    query: "slow",
    limit: 3,
    timeoutMs: 1,
  });

  expect(results).toEqual([]);
});

it("truncates each memory and stops at the total prompt budget", () => {
  const context = formatMemoryRecallContext(
    [
      createResult("first", "A".repeat(50)),
      createResult("second", "B".repeat(50)),
    ],
    {
      heading: "相关记忆：",
      maxCharsPerMemory: 12,
      maxTotalRecallChars: 48,
    },
  );

  expect(context).toBe("相关记忆：\n- first：AAAAAAAAAAA…");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/memoryRecall.test.ts`

Expected: FAIL because `memoryRecall.ts` does not exist.

- [ ] **Step 3: Implement `recallMemoriesWithBudget()` and `formatMemoryRecallContext()`**

Implementation requirements:
- `recallMemoriesWithBudget()` calls `memoryStore.search({ query, kind, limit })`.
- It returns `[]` on timeout or memory-store errors.
- Default timeout is `5000`.
- `formatMemoryRecallContext()` truncates content per memory, stops before exceeding total budget, and returns `null` when no line can fit.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/memoryRecall.test.ts`

Expected: PASS.

---

### Task 2: Chat L0 Evidence Search

**Files:**
- Modify: `src/shared/chat.ts`
- Modify: `src/main/chatSessionStore.ts`
- Test: `src/main/chatSessionStore.test.ts`

- [ ] **Step 1: Write failing test for searching raw chat messages**

```typescript
const results = await store.searchMessages({ query: "下载 报告", limit: 5 });
expect(results).toEqual([
  {
    sessionId: "chat_1",
    sessionTitle: "帮我整理下载文件夹，并生成报告",
    messageId: "chat_2",
    role: "assistant",
    content: "我会先检查权限，然后运行本地文件整理任务。",
    createdAt: "2026-06-06T08:01:00.000Z",
    score: expect.any(Number),
    matchedTerms: ["报告"],
  },
]);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/chatSessionStore.test.ts`

Expected: FAIL because `searchMessages()` is not implemented.

- [ ] **Step 3: Add types and search implementation**

Implementation requirements:
- Add `ChatMessageSearchOptions` and `ChatMessageSearchResult` to `src/shared/chat.ts`.
- Add `searchMessages(options)` to `ChatSessionStore`.
- Search all persisted messages, optionally filtering by `sessionId`.
- Tokenize Chinese/English terms the same way memory search does.
- Score content matches above session-title matches; sort by score descending then newest message.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/chatSessionStore.test.ts`

Expected: PASS.

---

### Task 3: Evidence-Linked Session Memories and Bounded Chat Recall

**Files:**
- Modify: `src/shared/memory.ts`
- Modify: `src/main/chatService.ts`
- Modify: `src/main/agentProceduralMemory.ts`
- Test: `src/main/chatService.test.ts`
- Test: `src/main/agentRuntimeEngine.test.ts`
- Test: `src/main/agentRunnerService.test.ts`

- [ ] **Step 1: Write/update failing chat-service expectation**

```typescript
expect(memoryWrites).toEqual([
  {
    kind: "session",
    title: "会话：帮我整理下载文件夹",
    content:
      "用户：帮我整理下载文件夹\nAgent：我可以先检查任务和工具权限，然后运行文件整理 skill。",
    tags: ["chat", "session"],
    source: {
      type: "chat_session",
      sessionId: "persisted_session",
      messageIds: ["user_message", "assistant_message"],
    },
    importance: 2,
  },
]);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/chatService.test.ts`

Expected: FAIL because session memories still use `{ type: "system" }`.

- [ ] **Step 3: Implement source evidence and bounded recall**

Implementation requirements:
- Add `{ type: "chat_session"; sessionId: string; messageIds: string[] }` to `MemorySource`.
- Capture the user `appendMessage()` result in `sendMessage()`.
- Append assistant messages before writing session memory so both message IDs are available.
- Write session memory with the chat-session source.
- Replace ad hoc `formatMemoryContext()` with `memoryRecall.ts` helper.
- Update procedural memory prompt context to use the helper with `limit: 3`, `maxCharsPerMemory: 600`, `maxTotalRecallChars: 1800`.

- [ ] **Step 4: Run affected tests**

Run:
- `npx vitest run src/main/chatService.test.ts`
- `npx vitest run src/main/agentRuntimeEngine.test.ts src/main/agentRunnerService.test.ts`

Expected: PASS.

---

### Task 4: Memory Tool Authorization and Safety UI

**Files:**
- Modify: `src/shared/toolPermissions.ts`
- Modify: `src/shared/toolPermissions.test.ts`
- Modify: `src/shared/toolSafetySummary.ts`
- Modify: `src/shared/toolSafetySummary.test.ts`
- Modify: `src/renderer/components/ScheduledTasksPanel.tsx`

- [ ] **Step 1: Write failing authorization tests**

```typescript
expect(getDefaultTaskPermissionPolicy().memory).toEqual({
  read: false,
  write: false,
});

expect(createPermissionPolicyFromSkillManifest(manifest).memory).toEqual({
  read: true,
  write: true,
});

expect(
  authorizeToolCall(policy, {
    toolName: "memory_search",
    args: { query: "downloads" },
  }),
).toMatchObject({ allowed: true });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/shared/toolPermissions.test.ts src/shared/toolSafetySummary.test.ts`

Expected: FAIL because policy has no memory permission.

- [ ] **Step 3: Implement memory policy and UI plumbing**

Implementation requirements:
- Add `memory: { read: boolean; write: boolean }` to `TaskPermissionPolicy`.
- Normalize defaults for older saved tasks.
- `memory_search` and `conversation_search` require `memory.read`.
- Show memory permission in safety summary.
- Add “允许读取本地记忆” and “允许写入本地记忆” checkboxes in scheduled-task editor.
- Include memory count in `summarizePermissions()`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/shared/toolPermissions.test.ts src/shared/toolSafetySummary.test.ts`

Expected: PASS.

---

### Task 5: Active Memory Tools

**Files:**
- Modify: `src/shared/agentProtocol.ts`
- Modify: `src/main/agentToolExecutor.ts`
- Modify: `src/main/agentToolExecutor.test.ts`
- Modify: `src/main/chatService.ts`
- Modify: `src/main/main.ts`

- [ ] **Step 1: Write failing tool executor tests**

```typescript
await expect(
  executor.execute({
    toolName: "memory_search",
    args: { query: "downloads", limit: 2 },
  }),
).resolves.toMatchObject({
  ok: true,
  result: {
    query: "downloads",
    results: [
      {
        id: "mem_downloads",
        kind: "semantic",
        title: "Downloads preference",
      },
    ],
  },
});

await expect(
  executor.execute({
    toolName: "conversation_search",
    args: { query: "报告", limit: 1 },
  }),
).resolves.toMatchObject({
  ok: true,
  result: {
    query: "报告",
    results: [
      {
        sessionId: "chat_1",
        messageId: "msg_1",
      },
    ],
  },
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/agentToolExecutor.test.ts`

Expected: FAIL because memory tools are not registered.

- [ ] **Step 3: Register tools and wire stores**

Implementation requirements:
- Add memory tools to `AgentToolName`, `supportedTools`, and tool definitions.
- Register `memory_search` and `conversation_search` in `createAgentToolExecutor()`.
- Return bounded structured results with no raw huge payloads.
- Chat loop should use `toolExecutor.getRegistry().getDefinitions()` when available.
- `getAgentRunnerService()` and `getChatService()` pass `getMemoryStore()` and `getChatSessionStore()` into `createAgentToolExecutor()`.
- Update `buildAgentSystemPrompt()` to say memory tools are read-only recall helpers and should be used sparingly.

- [ ] **Step 4: Run affected tests**

Run:
- `npx vitest run src/main/agentToolExecutor.test.ts src/shared/agentProtocol.test.ts`
- `npx vitest run src/main/chatService.test.ts src/main/agentRuntimeEngine.test.ts src/main/agentRunnerService.test.ts`

Expected: PASS.

---

### Task 6: Full Verification

**Files:**
- All touched files.

- [ ] **Step 1: Run full test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 2: Run production build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 3: Inspect git diff**

Run: `git status --short && git diff --stat`

Expected: Only memory-runtime P0 files and plan are changed; unrelated untracked files remain untouched.
