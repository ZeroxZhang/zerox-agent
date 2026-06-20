# Session History Management 2.4.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Zerox Agent 2.4.1 with sidebar-native chat history management: latest response time, cumulative token usage, archive grouping, restore/delete actions, and polished A-direction UI.

**Architecture:** Extend the existing local `chat-sessions.json` model and IPC bridge instead of adding a new history store. The main process remains the source of truth for archive/delete/token mutations; the renderer only groups and displays the returned list. Token usage uses provider `usage` when present and local estimation when absent.

**Tech Stack:** Electron 42 main/preload IPC, React 19 renderer, TypeScript 6 shared types, Vitest 4 tests, existing CSS token system.

---

## File Map

- `src/shared/chat.ts`: add `ChatSessionTokenUsage`, session archived/token/list fields, and typed operation result.
- `src/main/chatSessionStore.ts`: normalize, persist, list, archive, restore, delete, and add token usage.
- `src/main/chatSessionStore.test.ts`: TDD coverage for archive/delete/list metadata and legacy normalization.
- `src/main/openAiCompatibleClient.ts`: parse OpenAI-compatible `usage` payloads into `ChatCompletionResponse.usage`.
- `src/main/openAiCompatibleClient.test.ts`: TDD coverage for usage parsing and missing usage.
- `src/main/chatService.ts`: collect provider/estimated usage and write it through `ChatSessionStore.addTokenUsage`.
- `src/main/chatService.test.ts`: TDD coverage for provider and fallback usage.
- `src/main/container.ts`: include new store methods in the chat service dependency and expose archive/restore/delete wrappers.
- `src/main/ipc/index.ts`: add `chatSessions:archive`, `chatSessions:restore`, and `chatSessions:delete`.
- `src/preload/index.ts`: expose session management methods.
- `src/preload/index.test.ts`: assert bridge methods and channels exist.
- `src/renderer/App.tsx`: render history list, archived group, action menu, delete confirmation, and preserve session metadata from child refreshes.
- `src/renderer/components/AgentChatPanel.tsx`: keep sidebar session type aligned with full `ChatSessionListItem`.
- `src/renderer/styles/sidebar.css`: polished dense history row, right metadata, quiet three-dot menu, archive group, dark mode compatibility.
- `src/renderer/materialDesign.test.ts`: assert history UI structure and styling hooks.
- `src/shared/packageScripts.test.ts`, `src/shared/readme.test.ts`, `package.json`, `package-lock.json`, `README.md`: bump visible release metadata to `2.4.1`.
- `.zerox/feature_list.json`: add `P12.1-session-history-management-2.4.1`.
- `.zerox/progress.md`: append changed-file and command evidence.

---

### Task 1: Chat Session Store Model

**Files:**
- Modify: `src/shared/chat.ts`
- Modify: `src/main/chatSessionStore.ts`
- Test: `src/main/chatSessionStore.test.ts`

- [ ] **Step 1: Write failing store tests**

Add these tests near the existing chat session store tests:

```typescript
it("lists sessions with last assistant response time and token usage", async () => {
  const store = createChatSessionStore({
    configDir,
    createId: createSequentialId("chat"),
    now: createSteppedClock("2026-06-20T08:00:00.000Z"),
  });

  const first = await store.appendMessage({
    role: "user",
    content: "整理历史会话",
  });
  await store.appendMessage({
    sessionId: first.session.id,
    role: "assistant",
    content: "已整理。",
  });
  await store.addTokenUsage(first.session.id, {
    totalTokens: 18700,
    promptTokens: 12000,
    completionTokens: 6700,
    estimated: false,
  });

  await expect(store.list()).resolves.toEqual([
    expect.objectContaining({
      id: first.session.id,
      lastAssistantMessageAt: "2026-06-20T08:01:00.000Z",
      tokenUsage: {
        totalTokens: 18700,
        promptTokens: 12000,
        completionTokens: 6700,
        estimated: false,
      },
    }),
  ]);
});

it("archives restores and deletes sessions without touching other sessions", async () => {
  const store = createChatSessionStore({
    configDir,
    createId: createSequentialId("chat"),
    now: createSteppedClock("2026-06-20T08:00:00.000Z"),
  });

  const archived = await store.appendMessage({
    role: "user",
    content: "旧会话",
  });
  const active = await store.appendMessage({
    role: "user",
    content: "新会话",
  });

  await expect(store.archive(archived.session.id)).resolves.toMatchObject({
    id: archived.session.id,
    archivedAt: "2026-06-20T08:02:00.000Z",
  });
  await expect(store.list()).resolves.toEqual([
    expect.objectContaining({ id: active.session.id, archivedAt: undefined }),
    expect.objectContaining({ id: archived.session.id, archivedAt: "2026-06-20T08:02:00.000Z" }),
  ]);

  await expect(store.restore(archived.session.id)).resolves.toMatchObject({
    id: archived.session.id,
    archivedAt: undefined,
  });
  await expect(store.delete(active.session.id)).resolves.toBe(true);
  await expect(store.get(active.session.id)).resolves.toBeNull();
  await expect(store.get(archived.session.id)).resolves.toMatchObject({
    id: archived.session.id,
  });
});

it("normalizes legacy sessions without archive or token metadata", async () => {
  await writeFile(
    path.join(configDir, "chat-sessions.json"),
    JSON.stringify({
      schemaVersion: 1,
      sessions: [
        {
          id: "legacy",
          title: "旧会话",
          summary: "旧摘要",
          messages: [{ id: "m1", role: "user", content: "继续", createdAt: "2026-06-18T08:00:00.000Z" }],
          createdAt: "2026-06-18T08:00:00.000Z",
          updatedAt: "2026-06-18T08:00:00.000Z",
        },
      ],
    }),
    "utf8",
  );
  const store = createChatSessionStore({ configDir });

  await expect(store.list()).resolves.toEqual([
    {
      id: "legacy",
      title: "旧会话",
      summary: "旧摘要",
      messageCount: 1,
      updatedAt: "2026-06-18T08:00:00.000Z",
      lastAssistantMessageAt: "2026-06-18T08:00:00.000Z",
    },
  ]);
});
```

- [ ] **Step 2: Run store tests and verify RED**

Run:

```bash
npm test -- src/main/chatSessionStore.test.ts
```

Expected: FAIL because `addTokenUsage`, `archive`, `restore`, `delete`, `archivedAt`, `lastAssistantMessageAt`, and `tokenUsage` do not exist yet.

- [ ] **Step 3: Extend shared chat types**

In `src/shared/chat.ts`, add:

```typescript
export type ChatSessionTokenUsage = {
  totalTokens: number;
  promptTokens?: number;
  completionTokens?: number;
  estimated: boolean;
};

export type ChatSessionOperationResult =
  | { ok: true; session?: ChatSessionRecord }
  | { ok: false; message: string };
```

Extend `ChatSessionRecord`:

```typescript
  archivedAt?: string;
  tokenUsage?: ChatSessionTokenUsage;
```

Extend `ChatSessionListItem`:

```typescript
  archivedAt?: string;
  lastAssistantMessageAt?: string;
  tokenUsage?: ChatSessionTokenUsage;
```

- [ ] **Step 4: Extend the store interface**

In `src/main/chatSessionStore.ts`, import `ChatSessionTokenUsage` and extend `ChatSessionStore`:

```typescript
  archive(sessionId: string): Promise<ChatSessionRecord | null>;
  restore(sessionId: string): Promise<ChatSessionRecord | null>;
  delete(sessionId: string): Promise<boolean>;
  addTokenUsage(
    sessionId: string,
    usage: ChatSessionTokenUsage,
  ): Promise<ChatSessionRecord | null>;
```

- [ ] **Step 5: Implement archive restore delete and token mutation**

Add methods inside the returned store object:

```typescript
    async archive(sessionId) {
      return updateSessionById(sessionId, (session) => ({
        ...session,
        archivedAt: now().toISOString(),
      }));
    },

    async restore(sessionId) {
      return updateSessionById(sessionId, (session) => {
        const { archivedAt: _archivedAt, ...rest } = session;
        return rest;
      });
    },

    async delete(sessionId) {
      return serializeMutation(mutationQueue, (nextQueue) => {
        mutationQueue = nextQueue;
      }, async () => {
        const stored = await readStoredSessions();
        const nextSessions = stored.sessions.filter((session) => session.id !== sessionId);
        if (nextSessions.length === stored.sessions.length) {
          return false;
        }
        await writeStoredSessions({ schemaVersion: 1, sessions: nextSessions });
        return true;
      });
    },

    async addTokenUsage(sessionId, usage) {
      const normalizedUsage = normalizeTokenUsage(usage);
      return updateSessionById(sessionId, (session) => ({
        ...session,
        tokenUsage: mergeTokenUsage(session.tokenUsage, normalizedUsage),
      }));
    },
```

Add helper inside `createChatSessionStore` before `return`:

```typescript
  async function updateSessionById(
    sessionId: string,
    update: (session: ChatSessionRecord) => ChatSessionRecord,
  ): Promise<ChatSessionRecord | null> {
    return serializeMutation(mutationQueue, (nextQueue) => {
      mutationQueue = nextQueue;
    }, async () => {
      const stored = await readStoredSessions();
      const existingSession = stored.sessions.find((session) => session.id === sessionId);
      if (!existingSession) {
        return null;
      }
      const nextSession = update(existingSession);
      await writeStoredSessions({
        schemaVersion: 1,
        sessions: stored.sessions.map((session) =>
          session.id === sessionId ? nextSession : session,
        ),
      });
      return nextSession;
    });
  }
```

- [ ] **Step 6: Implement list metadata normalization**

Update `list()` sorting:

```typescript
      return stored.sessions
        .slice()
        .sort(compareSessionsForList)
        .map(toListItem);
```

Add helpers:

```typescript
function compareSessionsForList(left: ChatSessionRecord, right: ChatSessionRecord): number {
  const leftArchived = Boolean(left.archivedAt);
  const rightArchived = Boolean(right.archivedAt);
  if (leftArchived !== rightArchived) {
    return leftArchived ? 1 : -1;
  }
  if (leftArchived && rightArchived) {
    return (
      (right.archivedAt ?? "").localeCompare(left.archivedAt ?? "") ||
      right.updatedAt.localeCompare(left.updatedAt)
    );
  }
  return right.updatedAt.localeCompare(left.updatedAt);
}

function getLastAssistantMessageAt(session: ChatSessionRecord): string {
  const assistantMessage = session.messages
    .slice()
    .reverse()
    .find((message) => message.role === "assistant");
  return assistantMessage?.createdAt ?? session.updatedAt;
}
```

Update `toListItem()`:

```typescript
    ...(session.archivedAt ? { archivedAt: session.archivedAt } : {}),
    lastAssistantMessageAt: getLastAssistantMessageAt(session),
    ...(session.tokenUsage ? { tokenUsage: session.tokenUsage } : {}),
```

Update `normalizeStoredSession()`:

```typescript
    ...(session.archivedAt ? { archivedAt: String(session.archivedAt) } : {}),
    ...(session.tokenUsage ? { tokenUsage: normalizeTokenUsage(session.tokenUsage) } : {}),
```

Add usage helpers:

```typescript
function normalizeTokenUsage(usage: ChatSessionTokenUsage): ChatSessionTokenUsage {
  const promptTokens = normalizeOptionalTokenCount(usage.promptTokens);
  const completionTokens = normalizeOptionalTokenCount(usage.completionTokens);
  const totalTokens = Math.max(0, Math.floor(Number(usage.totalTokens) || 0));
  return {
    totalTokens,
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(completionTokens !== undefined ? { completionTokens } : {}),
    estimated: Boolean(usage.estimated),
  };
}

function normalizeOptionalTokenCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.floor(value));
}

function mergeTokenUsage(
  current: ChatSessionTokenUsage | undefined,
  next: ChatSessionTokenUsage,
): ChatSessionTokenUsage {
  return {
    totalTokens: (current?.totalTokens ?? 0) + next.totalTokens,
    ...(current?.promptTokens !== undefined || next.promptTokens !== undefined
      ? { promptTokens: (current?.promptTokens ?? 0) + (next.promptTokens ?? 0) }
      : {}),
    ...(current?.completionTokens !== undefined || next.completionTokens !== undefined
      ? { completionTokens: (current?.completionTokens ?? 0) + (next.completionTokens ?? 0) }
      : {}),
    estimated: Boolean(current?.estimated || next.estimated),
  };
}
```

- [ ] **Step 7: Run store tests and verify GREEN**

Run:

```bash
npm test -- src/main/chatSessionStore.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit store slice**

```bash
git add src/shared/chat.ts src/main/chatSessionStore.ts src/main/chatSessionStore.test.ts
git commit -m "feat: add chat session history metadata"
```

---

### Task 2: Model Usage Capture

**Files:**
- Modify: `src/main/openAiCompatibleClient.ts`
- Modify: `src/main/chatService.ts`
- Test: `src/main/openAiCompatibleClient.test.ts`
- Test: `src/main/chatService.test.ts`

- [ ] **Step 1: Write failing OpenAI-compatible usage tests**

Add to `src/main/openAiCompatibleClient.test.ts`:

```typescript
it("returns provider token usage when present", async () => {
  const client = createOpenAiCompatibleClient({
    fetch: async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: "OK" },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 5,
            total_tokens: 17,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });

  await expect(
    client.complete({
      baseUrl: "https://api.example.com/v1",
      apiKey: "secret-key",
      model: "agent-model",
      temperature: 0.2,
      maxTokens: 8192,
      messages: [{ role: "user", content: "Hi" }],
    }),
  ).resolves.toEqual({
    content: "OK",
    toolCalls: [],
    finishReason: "stop",
    usage: {
      promptTokens: 12,
      completionTokens: 5,
      totalTokens: 17,
    },
  });
});
```

- [ ] **Step 2: Run OpenAI-compatible tests and verify RED**

Run:

```bash
npm test -- src/main/openAiCompatibleClient.test.ts
```

Expected: FAIL because `usage` is not returned.

- [ ] **Step 3: Parse provider usage**

In `src/main/openAiCompatibleClient.ts`, add:

```typescript
export type ChatCompletionUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};
```

Extend `ChatCompletionResponse`:

```typescript
  usage?: ChatCompletionUsage;
```

Extend the parsed payload shape with:

```typescript
        usage?: {
          prompt_tokens?: unknown;
          completion_tokens?: unknown;
          total_tokens?: unknown;
        };
```

Return usage:

```typescript
      const usage = normalizeCompletionUsage(payload.usage);

      return {
        content,
        toolCalls,
        finishReason: choice?.finish_reason ?? "stop",
        ...(reasoningContent ? { reasoningContent } : {}),
        ...(usage ? { usage } : {}),
      };
```

Add helper:

```typescript
function normalizeCompletionUsage(
  usage: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
  } | undefined,
): ChatCompletionUsage | undefined {
  const promptTokens = normalizeTokenCount(usage?.prompt_tokens);
  const completionTokens = normalizeTokenCount(usage?.completion_tokens);
  const totalTokens = normalizeTokenCount(usage?.total_tokens);
  if (
    promptTokens === undefined &&
    completionTokens === undefined &&
    totalTokens === undefined
  ) {
    return undefined;
  }
  return {
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(completionTokens !== undefined ? { completionTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  };
}

function normalizeTokenCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.floor(value));
}
```

- [ ] **Step 4: Run OpenAI-compatible tests and verify GREEN**

Run:

```bash
npm test -- src/main/openAiCompatibleClient.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing chat service usage tests**

Update the fake `createChatSessionStore` helper in `src/main/chatService.test.ts` to accept token writes:

```typescript
function createChatSessionStore(
  messages: AppendChatMessageInput[],
  options: {
    attachedGoals?: ChatSessionGoalSummary[];
    tokenUsageWrites?: Array<{ sessionId: string; usage: ChatSessionTokenUsage }>;
  } = {},
) {
  return {
    async appendMessage(input: AppendChatMessageInput) {
      messages.push(input);
      return {
        session: {
          id: input.sessionId ?? "persisted_session",
          title: "会话",
          summary: input.content,
          messages: [],
          createdAt: "2026-06-06T08:00:00.000Z",
          updatedAt: "2026-06-06T08:00:00.000Z",
          ...(options.attachedGoals?.[0]
            ? {
                activeGoalId: options.attachedGoals[0].id,
                goalSummaries: options.attachedGoals,
              }
            : {}),
        },
        message: {
          id: `message_${messages.length}`,
          role: input.role,
          content: input.content,
          createdAt: "2026-06-06T08:00:00.000Z",
        },
      };
    },
    async attachGoal(_sessionId: string, goal: ChatSessionGoalSummary) {
      options.attachedGoals?.push(goal);
      return {
        id: "persisted_session",
        title: "会话",
        summary: goal.description,
        messages: [],
        activeGoalId: goal.id,
        goalSummaries: [goal],
        createdAt: "2026-06-06T08:00:00.000Z",
        updatedAt: "2026-06-06T08:00:00.000Z",
      };
    },
    async clearActiveGoal() {
      return null;
    },
    async addTokenUsage(sessionId: string, usage: ChatSessionTokenUsage) {
      options.tokenUsageWrites?.push({ sessionId, usage });
      return null;
    },
  };
}
```

Import `ChatSessionTokenUsage` from `../shared/chat`.

Add tests:

```typescript
it("records provider token usage for a successful model reply", async () => {
  const chatMessages: AppendChatMessageInput[] = [];
  const tokenUsageWrites: Array<{ sessionId: string; usage: ChatSessionTokenUsage }> = [];
  const service = createChatService({
    chatClient: {
      async complete() {
        return {
          content: "已完成。",
          toolCalls: [],
          finishReason: "stop",
          usage: { promptTokens: 100, completionTokens: 25, totalTokens: 125 },
        };
      },
    },
    getModelProfile: createCompleteProfile,
    memoryStore: createMemoryStore(),
    chatSessionStore: createChatSessionStore(chatMessages, { tokenUsageWrites }),
    createId: () => "chat_usage",
    now: () => new Date("2026-06-20T08:00:00.000Z"),
  });

  await service.sendMessage({ message: "统计 token" });

  expect(tokenUsageWrites).toEqual([
    {
      sessionId: "persisted_session",
      usage: {
        totalTokens: 125,
        promptTokens: 100,
        completionTokens: 25,
        estimated: false,
      },
    },
  ]);
});

it("records estimated token usage when the provider omits usage", async () => {
  const chatMessages: AppendChatMessageInput[] = [];
  const tokenUsageWrites: Array<{ sessionId: string; usage: ChatSessionTokenUsage }> = [];
  const service = createChatService({
    chatClient: {
      async complete() {
        return chatReply("已完成。");
      },
    },
    getModelProfile: createCompleteProfile,
    memoryStore: createMemoryStore(),
    chatSessionStore: createChatSessionStore(chatMessages, { tokenUsageWrites }),
    createId: () => "chat_usage_estimated",
    now: () => new Date("2026-06-20T08:00:00.000Z"),
  });

  await service.sendMessage({ message: "估算 token" });

  expect(tokenUsageWrites).toEqual([
    {
      sessionId: "persisted_session",
      usage: expect.objectContaining({
        totalTokens: expect.any(Number),
        estimated: true,
      }),
    },
  ]);
  expect(tokenUsageWrites[0].usage.totalTokens).toBeGreaterThan(0);
});
```

- [ ] **Step 6: Run chat service tests and verify RED**

Run:

```bash
npm test -- src/main/chatService.test.ts
```

Expected: FAIL because `createChatService` does not call `addTokenUsage`.

- [ ] **Step 7: Implement usage recording in chat service**

In `src/main/chatService.ts`, update the store type:

```typescript
    "appendMessage" | "attachGoal" | "clearActiveGoal" | "addTokenUsage"
```

Import:

```typescript
import { estimateMessageTokens } from "./contextManager";
import type { ChatCompletionUsage } from "./openAiCompatibleClient";
import type { ChatSessionTokenUsage } from "../shared/chat";
```

Track usage:

```typescript
      let accumulatedUsage: ChatSessionTokenUsage | null = null;
```

Inside agent loop `onModelResponse`:

```typescript
                accumulatedUsage = mergeChatSessionTokenUsage(
                  accumulatedUsage,
                  toChatSessionTokenUsage(response.usage),
                );
```

Inside simple chat after response:

```typescript
          accumulatedUsage = mergeChatSessionTokenUsage(
            accumulatedUsage,
            toChatSessionTokenUsage(response.usage),
          );
```

Before returning success after `writeAtomicMemories`:

```typescript
      await recordSessionTokenUsage({
        chatSessionStore: options.chatSessionStore,
        sessionId,
        usage: accumulatedUsage ?? estimateChatTurnUsage(chatMessages, reply),
      });
```

Add helpers near other helpers:

```typescript
function toChatSessionTokenUsage(
  usage: ChatCompletionUsage | undefined,
): ChatSessionTokenUsage | null {
  if (!usage) {
    return null;
  }
  const totalTokens =
    usage.totalTokens ??
    (usage.promptTokens !== undefined || usage.completionTokens !== undefined
      ? (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0)
      : 0);
  if (totalTokens <= 0) {
    return null;
  }
  return {
    totalTokens,
    ...(usage.promptTokens !== undefined ? { promptTokens: usage.promptTokens } : {}),
    ...(usage.completionTokens !== undefined ? { completionTokens: usage.completionTokens } : {}),
    estimated: false,
  };
}

function mergeChatSessionTokenUsage(
  current: ChatSessionTokenUsage | null,
  next: ChatSessionTokenUsage | null,
): ChatSessionTokenUsage | null {
  if (!next) {
    return current;
  }
  if (!current) {
    return next;
  }
  return {
    totalTokens: current.totalTokens + next.totalTokens,
    ...(current.promptTokens !== undefined || next.promptTokens !== undefined
      ? { promptTokens: (current.promptTokens ?? 0) + (next.promptTokens ?? 0) }
      : {}),
    ...(current.completionTokens !== undefined || next.completionTokens !== undefined
      ? { completionTokens: (current.completionTokens ?? 0) + (next.completionTokens ?? 0) }
      : {}),
    estimated: current.estimated || next.estimated,
  };
}

function estimateChatTurnUsage(
  messages: ChatMessage[],
  reply: string,
): ChatSessionTokenUsage {
  return {
    totalTokens: Math.max(
      1,
      estimateMessageTokens([
        ...messages,
        { role: "assistant", content: reply },
      ]),
    ),
    estimated: true,
  };
}

async function recordSessionTokenUsage(options: {
  chatSessionStore:
    | Pick<ChatSessionStore, "addTokenUsage">
    | undefined;
  sessionId: string;
  usage: ChatSessionTokenUsage;
}): Promise<void> {
  await options.chatSessionStore?.addTokenUsage(options.sessionId, options.usage);
}
```

- [ ] **Step 8: Run usage tests and verify GREEN**

Run:

```bash
npm test -- src/main/openAiCompatibleClient.test.ts src/main/chatService.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit usage slice**

```bash
git add src/main/openAiCompatibleClient.ts src/main/openAiCompatibleClient.test.ts src/main/chatService.ts src/main/chatService.test.ts
git commit -m "feat: record chat session token usage"
```

---

### Task 3: IPC and Preload Session Operations

**Files:**
- Modify: `src/main/container.ts`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/preload/index.ts`
- Test: `src/preload/index.test.ts`

- [ ] **Step 1: Write failing preload bridge test**

Add to `src/preload/index.test.ts`:

```typescript
  it("exposes chat session management methods through the sandboxed preload", () => {
    expect(preloadSource).toContain("archiveChatSession");
    expect(preloadSource).toContain("restoreChatSession");
    expect(preloadSource).toContain("deleteChatSession");
    expect(preloadSource).toContain("chatSessions:archive");
    expect(preloadSource).toContain("chatSessions:restore");
    expect(preloadSource).toContain("chatSessions:delete");
  });
```

- [ ] **Step 2: Run preload test and verify RED**

Run:

```bash
npm test -- src/preload/index.test.ts
```

Expected: FAIL because methods and channels do not exist.

- [ ] **Step 3: Add container wrappers**

In `src/main/container.ts`, add functions near `getChatSession`:

```typescript
  async function archiveChatSession(
    sessionId: string,
  ): Promise<ChatSessionOperationResult> {
    const session = await chatSessionStore().archive(sessionId);
    return session
      ? { ok: true, session }
      : { ok: false, message: "会话不存在，无法归档。" };
  }

  async function restoreChatSession(
    sessionId: string,
  ): Promise<ChatSessionOperationResult> {
    const session = await chatSessionStore().restore(sessionId);
    return session
      ? { ok: true, session }
      : { ok: false, message: "会话不存在，无法恢复。" };
  }

  async function deleteChatSession(
    sessionId: string,
  ): Promise<ChatSessionOperationResult> {
    const deleted = await chatSessionStore().delete(sessionId);
    return deleted
      ? { ok: true }
      : { ok: false, message: "会话不存在，无法删除。" };
  }
```

Import `ChatSessionOperationResult` from `../shared/chat` and export the functions in the returned container object.

- [ ] **Step 4: Register IPC handlers**

In `src/main/ipc/index.ts`, add:

```typescript
  ipcMain.handle("chatSessions:archive", (_event, sessionId: string) =>
    container.archiveChatSession(sessionId),
  );
  ipcMain.handle("chatSessions:restore", (_event, sessionId: string) =>
    container.restoreChatSession(sessionId),
  );
  ipcMain.handle("chatSessions:delete", (_event, sessionId: string) =>
    container.deleteChatSession(sessionId),
  );
```

- [ ] **Step 5: Expose preload methods**

In `src/preload/index.ts`, import `ChatSessionOperationResult` as a type and add:

```typescript
  archiveChatSession: (sessionId: string): Promise<ChatSessionOperationResult> =>
    ipcRenderer.invoke("chatSessions:archive", sessionId),
  restoreChatSession: (sessionId: string): Promise<ChatSessionOperationResult> =>
    ipcRenderer.invoke("chatSessions:restore", sessionId),
  deleteChatSession: (sessionId: string): Promise<ChatSessionOperationResult> =>
    ipcRenderer.invoke("chatSessions:delete", sessionId),
```

- [ ] **Step 6: Run preload test and focused type build**

Run:

```bash
npm test -- src/preload/index.test.ts
npm run build
```

Expected: both PASS.

- [ ] **Step 7: Commit IPC slice**

```bash
git add src/main/container.ts src/main/ipc/index.ts src/preload/index.ts src/preload/index.test.ts
git commit -m "feat: expose chat session management ipc"
```

---

### Task 4: Sidebar History UI

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/AgentChatPanel.tsx`
- Modify: `src/renderer/styles/sidebar.css`
- Test: `src/renderer/materialDesign.test.ts`

- [ ] **Step 1: Write failing material design test**

Add to `src/renderer/materialDesign.test.ts`:

```typescript
  it("renders polished sidebar history management for chat sessions", () => {
    expect(appSource).toContain("sidebar-history");
    expect(appSource).toContain("archiveChatSession");
    expect(appSource).toContain("deleteChatSession");
    expect(appSource).toContain("archivedSessions");
    expect(appSource).toContain("归档会话");
    expect(appSource).toContain("formatSessionTimeLabel");
    expect(appSource).toContain("formatSessionTokenLabel");
    expect(appSource).toContain("aria-label={`会话操作：${session.title}`}");
    expect(styles).toContain(".sidebar-history");
    expect(styles).toContain(".sidebar-session-meta");
    expect(styles).toContain(".sidebar-session-actions");
    expect(styles).toContain(".sidebar-archive-group");
    expect(styles).not.toContain(".menu-popover");
  });
```

- [ ] **Step 2: Run material design test and verify RED**

Run:

```bash
npm test -- src/renderer/materialDesign.test.ts
```

Expected: FAIL because history UI hooks do not exist.

- [ ] **Step 3: Align sidebar session type**

In `src/renderer/components/AgentChatPanel.tsx`, replace the local sidebar type with the shared list item:

```typescript
type ChatSession = ChatSessionListItem;

export type ChatSidebarSession = ChatSessionListItem;
```

Update `fallbackSessions` entries to include:

```typescript
    messageCount: 0,
    updatedAt: new Date(0).toISOString(),
    lastAssistantMessageAt: new Date(0).toISOString(),
```

Update `toSessionRailItem` to preserve:

```typescript
    updatedAt: session.updatedAt,
    ...(session.lastAssistantMessageAt ? { lastAssistantMessageAt: session.lastAssistantMessageAt } : {}),
    ...(session.archivedAt ? { archivedAt: session.archivedAt } : {}),
    ...(session.tokenUsage ? { tokenUsage: session.tokenUsage } : {}),
```

- [ ] **Step 4: Preserve metadata in App session mapping**

In `src/renderer/App.tsx`, update `toChatSessionListItem`:

```typescript
function toChatSessionListItem(session: ChatSidebarSession): ChatSessionListItem {
  return {
    id: session.id,
    title: session.title,
    summary: session.summary,
    messageCount: session.messageCount ?? 0,
    ...(session.activeGoal ? { activeGoal: session.activeGoal } : {}),
    updatedAt: session.updatedAt,
    ...(session.lastAssistantMessageAt ? { lastAssistantMessageAt: session.lastAssistantMessageAt } : {}),
    ...(session.archivedAt ? { archivedAt: session.archivedAt } : {}),
    ...(session.tokenUsage ? { tokenUsage: session.tokenUsage } : {}),
  };
}
```

- [ ] **Step 5: Add App sidebar state and handlers**

In `App.tsx`, add state:

```typescript
  const [archiveExpanded, setArchiveExpanded] = useState(false);
  const [sessionMenuId, setSessionMenuId] = useState<string | null>(null);
  const [deleteConfirmSessionId, setDeleteConfirmSessionId] = useState<string | null>(null);
```

Add derived lists:

```typescript
  const visibleChatSessions = chatSessions.filter((session) => !session.archivedAt);
  const archivedSessions = chatSessions.filter((session) => session.archivedAt);
```

Add handlers:

```typescript
  async function refreshChatSessions() {
    const loadedSessions = await window.buildingAgent?.listChatSessions().catch(() => []);
    if (loadedSessions?.length) {
      setChatSessions(loadedSessions);
    }
  }

  async function handleArchiveChatSession(sessionId: string) {
    setSessionMenuId(null);
    const result = await window.buildingAgent?.archiveChatSession(sessionId);
    if (result?.ok) {
      await refreshChatSessions();
    }
  }

  async function handleRestoreChatSession(sessionId: string) {
    setSessionMenuId(null);
    const result = await window.buildingAgent?.restoreChatSession(sessionId);
    if (result?.ok) {
      await refreshChatSessions();
    }
  }

  async function handleDeleteChatSession(sessionId: string) {
    if (deleteConfirmSessionId !== sessionId) {
      setDeleteConfirmSessionId(sessionId);
      return;
    }
    setSessionMenuId(null);
    setDeleteConfirmSessionId(null);
    const result = await window.buildingAgent?.deleteChatSession(sessionId);
    if (result?.ok) {
      if (selectedChatSessionId === sessionId) {
        handleNewChat();
      }
      await refreshChatSessions();
    }
  }
```

- [ ] **Step 6: Replace session list JSX**

Replace the current `.sidebar-recents` session list with:

```tsx
        <section className="sidebar-section sidebar-history" aria-label="历史会话">
          <p className="sidebar-section-title">
            <span>历史会话</span>
            <small>按最近响应</small>
          </p>
          <div className="sidebar-session-list">
            {visibleChatSessions.slice(0, 12).map((session) => (
              <SidebarSessionButton
                key={session.id}
                session={session}
                selected={session.id === selectedChatSessionId}
                menuOpen={session.id === sessionMenuId}
                deleteConfirming={deleteConfirmSessionId === session.id}
                onSelect={onSelectChatSession}
                onOpenMenu={setSessionMenuId}
                onArchive={handleArchiveChatSession}
                onRestore={handleRestoreChatSession}
                onDelete={handleDeleteChatSession}
              />
            ))}
            {archivedSessions.length ? (
              <div className="sidebar-archive-group">
                <button
                  type="button"
                  className="sidebar-archive-toggle"
                  aria-expanded={archiveExpanded}
                  onClick={() => setArchiveExpanded((expanded) => !expanded)}
                >
                  <span aria-hidden="true">{archiveExpanded ? "▾" : "▸"}</span>
                  <strong>归档会话</strong>
                  <small>{archivedSessions.length} 个</small>
                </button>
                {archiveExpanded ? (
                  <div className="sidebar-archived-session-list">
                    {archivedSessions.map((session) => (
                      <SidebarSessionButton
                        key={session.id}
                        session={session}
                        selected={session.id === selectedChatSessionId}
                        menuOpen={session.id === sessionMenuId}
                        deleteConfirming={deleteConfirmSessionId === session.id}
                        onSelect={onSelectChatSession}
                        onOpenMenu={setSessionMenuId}
                        onArchive={handleArchiveChatSession}
                        onRestore={handleRestoreChatSession}
                        onDelete={handleDeleteChatSession}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>
```

- [ ] **Step 7: Add sidebar row component and formatters**

In `App.tsx`, add below `SettingsSectionShell`:

```tsx
function SidebarSessionButton(props: {
  session: ChatSessionListItem;
  selected: boolean;
  menuOpen: boolean;
  deleteConfirming: boolean;
  onSelect: (sessionId: string) => void;
  onOpenMenu: (sessionId: string | null) => void;
  onArchive: (sessionId: string) => void;
  onRestore: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
}) {
  const { session } = props;
  return (
    <div className={`sidebar-session-shell ${props.menuOpen ? "has-open-menu" : ""}`}>
      <button
        className={`sidebar-session-item ${props.selected ? "is-active" : ""}`}
        type="button"
        onClick={() => props.onSelect(session.id)}
      >
        <span className="sidebar-session-copy">
          <strong>{session.title}</strong>
          <small>{session.summary || `${session.messageCount} 条消息`}</small>
        </span>
        <span className="sidebar-session-meta">
          <span>{formatSessionTimeLabel(session.lastAssistantMessageAt ?? session.updatedAt)}</span>
          {session.tokenUsage ? (
            <span>{formatSessionTokenLabel(session.tokenUsage.totalTokens)}</span>
          ) : null}
        </span>
        {session.activeGoal ? (
          <span className={`goal-session-badge is-${session.activeGoal.status}`}>
            {translateSidebarGoalStatus(session.activeGoal.status)}
          </span>
        ) : null}
      </button>
      <button
        type="button"
        className="sidebar-session-actions"
        aria-label={`会话操作：${session.title}`}
        onClick={() => props.onOpenMenu(props.menuOpen ? null : session.id)}
      >
        ⋯
      </button>
      {props.menuOpen ? (
        <div className="sidebar-session-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() =>
              session.archivedAt
                ? props.onRestore(session.id)
                : props.onArchive(session.id)
            }
          >
            {session.archivedAt ? "恢复" : "归档"}
          </button>
          <button
            type="button"
            role="menuitem"
            className="is-danger"
            onClick={() => props.onDelete(session.id)}
          >
            {props.deleteConfirming ? "确认删除" : "删除"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function formatSessionTimeLabel(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return "";
  }
  const diffMs = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days} 天`;
  return `${Math.floor(days / 7)} 周`;
}

function formatSessionTokenLabel(totalTokens: number): string {
  if (totalTokens < 1000) {
    return `${totalTokens}`;
  }
  if (totalTokens < 10000) {
    return `${(totalTokens / 1000).toFixed(1)}k`;
  }
  return `${Math.round(totalTokens / 1000)}k`;
}
```

- [ ] **Step 8: Add polished sidebar CSS**

In `src/renderer/styles/sidebar.css`, add:

```css
.sidebar-history .sidebar-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sidebar-history .sidebar-section-title small {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
}

.sidebar-session-shell {
  position: relative;
  min-width: 0;
}

.sidebar-session-shell .sidebar-session-item {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-2);
  min-height: 46px;
  padding-right: 38px;
}

.sidebar-session-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.sidebar-session-meta {
  display: grid;
  justify-items: end;
  gap: 2px;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  font-variant-numeric: tabular-nums;
  line-height: 1.15;
}

.sidebar-session-actions {
  position: absolute;
  top: 50%;
  right: 6px;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  transform: translateY(-50%);
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  background: transparent;
  opacity: 0;
}

.sidebar-session-shell:hover .sidebar-session-actions,
.sidebar-session-shell:focus-within .sidebar-session-actions,
.sidebar-session-shell.has-open-menu .sidebar-session-actions {
  opacity: 1;
}

.sidebar-session-actions:hover {
  color: var(--text-primary);
  background: var(--bg-surface-hover);
}

.sidebar-session-menu {
  position: absolute;
  z-index: 20;
  top: 36px;
  right: 4px;
  display: grid;
  width: 118px;
  padding: 5px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-surface-raised);
  box-shadow: var(--shadow-sm);
}

.sidebar-session-menu button,
.sidebar-archive-toggle {
  border: 0;
  font: inherit;
}

.sidebar-session-menu button {
  min-height: 32px;
  padding: 0 var(--space-2);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  background: transparent;
  text-align: left;
}

.sidebar-session-menu button:hover {
  color: var(--text-primary);
  background: var(--bg-surface-hover);
}

.sidebar-session-menu button.is-danger {
  color: var(--text-danger);
}

.sidebar-archive-group {
  margin-top: var(--space-2);
  padding-top: var(--space-2);
  border-top: 1px solid var(--border-default);
}

.sidebar-archive-toggle {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: 36px;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  background: transparent;
  text-align: left;
}

.sidebar-archive-toggle:hover {
  color: var(--text-primary);
  background: var(--bg-surface-hover);
}

.sidebar-archive-toggle strong,
.sidebar-archive-toggle small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-archive-toggle small {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.sidebar-archived-session-list {
  display: grid;
  gap: 2px;
  padding-left: var(--space-2);
}
```

- [ ] **Step 9: Run material design test and renderer build**

Run:

```bash
npm test -- src/renderer/materialDesign.test.ts
npm run build
```

Expected: both PASS.

- [ ] **Step 10: Commit UI slice**

```bash
git add src/renderer/App.tsx src/renderer/components/AgentChatPanel.tsx src/renderer/styles/sidebar.css src/renderer/materialDesign.test.ts
git commit -m "feat: add sidebar session history controls"
```

---

### Task 5: Release Metadata, Feature Tracking, and Verification

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `src/shared/packageScripts.test.ts`
- Modify: `src/shared/readme.test.ts`
- Modify: `.zerox/feature_list.json`
- Modify: `.zerox/progress.md`

- [ ] **Step 1: Write failing release metadata tests**

In `src/shared/packageScripts.test.ts`, change the release metadata test names and expectations from `2.4.0` to `2.4.1`, and add the new feature assertion:

```typescript
  it("sets release metadata to v2.4.1", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as PackageJson;
    const packageLock = JSON.parse(
      readFileSync(path.join(process.cwd(), "package-lock.json"), "utf8"),
    ) as { version?: string; packages?: Record<string, { version?: string }> };

    expect(packageJson.version).toBe("2.4.1");
    expect(packageLock.version).toBe("2.4.1");
    expect(packageLock.packages?.[""]?.version).toBe("2.4.1");
  });

  it("marks the v2.4.1 session history management iteration done", () => {
    const featureList = JSON.parse(
      readFileSync(path.join(process.cwd(), ".zerox/feature_list.json"), "utf8"),
    ) as {
      features: Array<{
        id: string;
        status: string;
        definitionOfDone?: string[];
      }>;
    };

    expect(featureList.features).toContainEqual(
      expect.objectContaining({
        id: "P12.1-session-history-management-2.4.1",
        status: "done",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("sidebar-native history management"),
          expect.stringContaining("package version bumped to 2.4.1"),
        ]),
      }),
    );
  });
```

In `src/shared/readme.test.ts`, update visible version strings:

```typescript
expect(readme).toContain("current release is **v2.4.1**");
expect(readme).toContain("当前版本是 **v2.4.1**");
expect(readme).toContain("Current version: v2.4.1.");
expect(readme).toContain("当前版本：v2.4.1。");
expect(readme).toContain("v2.4.1 adds sidebar-native history management");
expect(readme).toContain("v2.4.1 新增侧栏原生历史会话管理");
```

- [ ] **Step 2: Run release tests and verify RED**

Run:

```bash
npm test -- src/shared/packageScripts.test.ts src/shared/readme.test.ts
```

Expected: FAIL because package, README, and feature list still say `2.4.0`.

- [ ] **Step 3: Update package metadata**

Change `package.json`:

```json
  "version": "2.4.1",
```

Change both root version fields in `package-lock.json`:

```json
  "version": "2.4.1",
```

and:

```json
      "version": "2.4.1",
```

- [ ] **Step 4: Update README release text**

Add a short v2.4.1 paragraph after the v2.4.0 English release paragraph:

```markdown
v2.4.1 adds sidebar-native history management for chat sessions. The sidebar now shows latest assistant response time and cumulative token usage per session, exposes archive/delete actions from a quiet three-dot menu, keeps archived sessions in a collapsible local group instead of deleting them, and preserves the local-first session store and IPC boundary.
```

Add the matching Chinese paragraph:

```markdown
v2.4.1 新增侧栏原生历史会话管理。侧栏现在会显示每个会话的最新助手响应时间和累计 token 消耗，通过克制的三点菜单提供归档/删除操作，把归档会话收纳到可折叠的本地分组里，并继续遵守本地优先的会话存储和 IPC 边界。
```

Update current release/version lines from `2.4.0` to `2.4.1`. Leave historical `2.4.0` release paragraphs intact.

- [ ] **Step 5: Add feature-list entry**

Append to `.zerox/feature_list.json` after the `P12-2.4.0-iteration-activation-and-release` entry:

```json
    {
      "id": "P12.1-session-history-management-2.4.1",
      "priority": 52,
      "status": "done",
      "title": "v2.4.1 sidebar-native session history management",
      "files": [
        "src/shared/chat.ts",
        "src/main/chatSessionStore.ts",
        "src/main/chatSessionStore.test.ts",
        "src/main/openAiCompatibleClient.ts",
        "src/main/openAiCompatibleClient.test.ts",
        "src/main/chatService.ts",
        "src/main/chatService.test.ts",
        "src/main/container.ts",
        "src/main/ipc/index.ts",
        "src/preload/index.ts",
        "src/preload/index.test.ts",
        "src/renderer/App.tsx",
        "src/renderer/components/AgentChatPanel.tsx",
        "src/renderer/styles/sidebar.css",
        "src/renderer/materialDesign.test.ts",
        "package.json",
        "package-lock.json",
        "README.md",
        "src/shared/packageScripts.test.ts",
        "src/shared/readme.test.ts",
        ".zerox/feature_list.json",
        ".zerox/progress.md"
      ],
      "definitionOfDone": [
        "Chat sessions support sidebar-native history management with archive, restore, and delete actions",
        "Session rows display latest assistant response time and cumulative token usage",
        "Archived sessions render in a collapsible local archive group without being erased from chat evidence",
        "Provider token usage is recorded when available and local estimated usage is recorded when missing",
        "Package version bumped to 2.4.1"
      ],
      "verification": [
        "npm test -- src/main/chatSessionStore.test.ts src/main/openAiCompatibleClient.test.ts src/main/chatService.test.ts src/preload/index.test.ts src/renderer/materialDesign.test.ts src/shared/packageScripts.test.ts src/shared/readme.test.ts",
        "npm run harness:check",
        "npm run verify",
        "npm run smoke:prod",
        "git diff --check"
      ]
    }
```

Update `.zerox/feature_list.json.updatedAt` to:

```json
  "updatedAt": "2026-06-20T00:00:00.000Z",
```

- [ ] **Step 6: Update progress evidence**

Append to `.zerox/progress.md`:

```markdown
## 2026-06-20 v2.4.1 session history management

- Request:
  - Add sidebar-native history session management with hover three-dot actions,
    delete, archive grouping, latest response time, cumulative token usage, and
    version 2.4.1 metadata.
- Implementation:
  - Extended chat session records/list items with archived state, latest
    assistant response time, and token usage.
  - Added archive/restore/delete store and IPC operations.
  - Captured provider usage from OpenAI-compatible responses and estimated
    usage when providers omit it.
  - Reworked the sidebar history list around approved option A's structure,
    while polishing the visual design beyond the rough HTML mockup.
- Verification evidence:
  - `npm test -- src/main/chatSessionStore.test.ts src/main/openAiCompatibleClient.test.ts src/main/chatService.test.ts src/preload/index.test.ts src/renderer/materialDesign.test.ts src/shared/packageScripts.test.ts src/shared/readme.test.ts` -> passed.
  - `npm run harness:check` -> passed.
  - `npm run verify` -> passed.
  - `npm run smoke:prod` -> passed.
  - `git diff --check` -> passed.
```

Write this section only after the commands in Step 9 pass. If any command fails, fix the failure, rerun the command, and only then append this evidence.

- [ ] **Step 7: Run release tests and verify GREEN**

Run:

```bash
npm test -- src/shared/packageScripts.test.ts src/shared/readme.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run focused feature tests**

Run:

```bash
npm test -- src/main/chatSessionStore.test.ts src/main/openAiCompatibleClient.test.ts src/main/chatService.test.ts src/preload/index.test.ts src/renderer/materialDesign.test.ts src/shared/packageScripts.test.ts src/shared/readme.test.ts
```

Expected: PASS.

- [ ] **Step 9: Run required project verification**

Run:

```bash
npm run harness:check
npm run verify
npm run smoke:prod
git diff --check
```

Expected: all PASS. If any command fails, fix the failure and rerun the failing command before updating progress evidence.

- [ ] **Step 10: Confirm progress evidence matches the fresh command results**

Edit `.zerox/progress.md` so the verification section uses exact results, for example:

```markdown
- Verification evidence:
  - `npm test -- src/main/chatSessionStore.test.ts src/main/openAiCompatibleClient.test.ts src/main/chatService.test.ts src/preload/index.test.ts src/renderer/materialDesign.test.ts src/shared/packageScripts.test.ts src/shared/readme.test.ts` -> passed.
  - `npm run harness:check` -> passed.
  - `npm run verify` -> passed.
  - `npm run smoke:prod` -> passed.
  - `git diff --check` -> passed.
```

- [ ] **Step 11: Commit release and progress slice**

```bash
git add package.json package-lock.json README.md src/shared/packageScripts.test.ts src/shared/readme.test.ts .zerox/feature_list.json .zerox/progress.md
git commit -m "release: mark v2.4.1 session history management"
```

---

## Final Verification Checklist

- [ ] Every production behavior change has a prior RED test run.
- [ ] Store tests passed.
- [ ] OpenAI-compatible client tests passed.
- [ ] Chat service tests passed.
- [ ] Preload tests passed.
- [ ] Renderer material design tests passed.
- [ ] Package/readme release tests passed.
- [ ] `npm run harness:check` passed.
- [ ] `npm run verify` passed.
- [ ] `npm run smoke:prod` passed.
- [ ] `git diff --check` passed.
- [ ] `.zerox/progress.md` contains real command evidence from this implementation run.
