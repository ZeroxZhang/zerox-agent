# Zerox Agent 2.7.0 UI Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved方案1 Chat-first Zerox Agent 2.7.0 UI/interaction redesign with streamed answers, separated thinking/process output, guided skill input, unified icons, tests, QA, and independent acceptance.

**Architecture:** Keep Chat as the consumer-grade first screen and move Overview diagnostics under Settings. Add shared contracts for chat stream events and guided skill input before wiring main-process execution and renderer UI. Preserve `ToolAuthorizationService`, workspace sandbox checks, trajectory evidence, workspace-run ledgers, and reviewed learning as non-negotiable boundaries.

**Tech Stack:** Electron 42, React 19, TypeScript 6, Vite 8, Vitest 4, local JSON/SQLite storage abstractions, OpenAI-compatible/Anthropic/Gemini provider adapters.

---

## Approved Inputs

- Spec: `docs/superpowers/specs/2026-06-23-zerox-agent-2-7-0-ui-interaction-design.md`
- Feature: `P16-v2.7.0-ui-interaction` in `.zerox/feature_list.json`
- Current branch: `codex/v2.5.0-workspace-skill-execution`

## Scope Structure

This plan is intentionally a master plan because the approved 2.7.0 spec crosses shared contracts, main-process orchestration, renderer interaction, design artifacts, and acceptance gates. Each task below is a bounded slice with its own tests. Execute tasks sequentially; do not run multiple worker implementations in parallel unless their write sets are disjoint and the controller explicitly assigns ownership.

## File Structure

Shared contracts:

- `src/shared/chat.ts`: chat stream event, pending guided input, and backward-compatible session record types.
- `src/shared/skills.ts`: skill input schema compatibility and helper exports.
- `src/shared/skillExecutionContract.ts`: guided skill stages, input resolution, request/response contracts, transition rules.
- `src/shared/navigation.ts`: primary/settings navigation and compatibility routing.
- `src/shared/materialNavigation.ts`: nav icon registry and local icon paths.

Main process:

- `src/main/chatService.ts`: chat stream orchestration, guided skill preflight, persistence, status/stream event emission.
- `src/main/agentLoop.ts`: streamed model response aggregation and safe tool-call assembly before authorization.
- `src/main/providers/providerChatClient.ts`: preserve text and thinking stream deltas through provider adaptation.
- `src/main/providers/streamProcessor.ts`: aggregate stream deltas into final response without dropping thinking.
- `src/main/skillExecutionService.ts`: guided input snapshots and evidence.
- `src/main/ipc/index.ts`: `chat:streamEvent` and guided input response IPC.

Renderer:

- `src/preload/index.ts`: typed bridge for chat stream events and guided skill responses.
- `src/renderer/components/AgentChatPanel.tsx`: streamed transcript, thinking/process collapse, guided input form, rail behavior.
- `src/renderer/chatTaskActivity.ts`: `waiting_for_input`, stream, thinking, tool preview activity mapping.
- `src/renderer/components/Icon.tsx`: local icon component.
- `src/renderer/styles/chat.css`, `composer.css`, `responsive.css`, `tokens.css`, `sidebar.css`: compact Chat-first UX, responsive rail/drawer, icon controls, collapse states.

Planning/release:

- `docs/design/zerox-agent-2-7-0-ui-artifact.html`: static UI/UE design artifact for the approved direction.
- `README.md`, `package.json`, `package-lock.json`, `src/shared/packageScripts.test.ts`, `src/shared/readme.test.ts`: final release metadata, only after implementation and acceptance pass.
- `.zerox/progress.md`: command evidence and independent acceptance record.

---

### Task 1: Navigation And Overview Relocation

**Files:**
- Modify: `src/shared/navigation.ts`
- Modify: `src/shared/navigation.test.ts`
- Modify: `src/shared/appMeta.ts`
- Modify: `src/shared/materialNavigation.ts`
- Modify: `src/shared/materialNavigation.test.ts`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/materialDesign.test.ts`

- [ ] **Step 1: Write failing navigation tests**

Replace the primary order assertion in `src/shared/navigation.test.ts` with:

```ts
it("orders primary navigation for the v2.7 Chat-first shell", () => {
  expect(getNavigationSections().map((section) => section.id)).toEqual([
    "chat",
    "runs",
    "scheduled-tasks",
    "settings",
  ]);
});

it("keeps Overview as a settings diagnostics compatibility route", () => {
  expect(getStartupNavigationSection("#overview")).toMatchObject({
    id: "settings",
    label: "设置",
  });
  expect(getDefaultSettingsNavigationSection()).toMatchObject({
    id: "system-overview",
    label: "系统",
  });
  expect(getSettingsNavigationSections().map((section) => section.id)).toEqual([
    "system-overview",
    "model-settings",
    "skills",
    "tools",
    "memory",
    "learning",
    "evals",
  ]);
});
```

- [ ] **Step 2: Run navigation tests and verify RED**

Run:

```bash
npm test -- src/shared/navigation.test.ts src/shared/materialNavigation.test.ts
```

Expected: FAIL because `overview` is still a primary section and `system-overview` is not a settings section.

- [ ] **Step 3: Implement shared navigation changes**

In `src/shared/navigation.ts`, update the type and settings section union:

```ts
export type NavigationSectionId =
  | "chat"
  | "overview"
  | "goals"
  | "runs"
  | "scheduled-tasks"
  | "tools"
  | "memory"
  | "learning"
  | "evals"
  | "settings";

export type SettingsNavigationSectionId =
  | "system-overview"
  | "model-settings"
  | "skills"
  | "tools"
  | "memory"
  | "learning"
  | "evals";
```

Remove the `overview` object from `navigationSections`. Add this first object to `settingsNavigationSections`:

```ts
{
  id: "system-overview",
  label: "系统",
  module: "诊断",
  summary: "本地运行状态、Harness、能力评分和启动验证。",
},
```

Update `resolvePrimaryNavigationId`:

```ts
function resolvePrimaryNavigationId(id: string): NavigationSectionId {
  if (id === "goals") {
    return "chat";
  }

  if (id === "overview") {
    return "settings";
  }

  if (settingsNavigationSections.some((section) => section.id === id)) {
    return "settings";
  }

  return id as NavigationSectionId;
}
```

Update `getDefaultSettingsNavigationSection()` to return the first settings section, now `system-overview`.

- [ ] **Step 4: Move Overview rendering into Settings shell**

In `src/renderer/App.tsx`, keep the import:

```ts
import { OverviewPanel } from "./components/OverviewPanel";
```

Update `getStartupSettingsSectionId()` so `#overview` maps to `system-overview`:

```ts
function getStartupSettingsSectionId(): SettingsNavigationSectionId {
  const hash = window.location.hash.replace(/^#/, "");
  if (hash === "overview") {
    return "system-overview";
  }
  return getSettingsNavigationSections().some((section) => section.id === hash)
    ? (hash as SettingsNavigationSectionId)
    : "system-overview";
}
```

In the settings section body switch, render:

```tsx
{activeSettingsSectionId === "system-overview" ? (
  <OverviewPanel />
) : activeSettingsSectionId === "model-settings" ? (
  <ModelSettingsPanel />
) : activeSettingsSectionId === "skills" ? (
  <SkillLibraryPanel />
) : activeSettingsSectionId === "tools" ? (
  <ToolsPanel />
) : activeSettingsSectionId === "memory" ? (
  <MemoryPanel />
) : activeSettingsSectionId === "learning" ? (
  <LearningReviewPanel />
) : (
  <EvalReviewPanel />
)}
```

Remove the top-level `activeSection.id === "overview"` rendering branch.

- [ ] **Step 5: Update app metadata and icon coverage**

In `src/shared/appMeta.ts`, remove `"总览"` from the primary `modules` list and keep `"设置"`.

In `src/shared/materialNavigation.ts`, keep the `overview` icon in the registry for compatibility but do not require it from `getNavigationSections()`. In `src/shared/materialNavigation.test.ts`, add:

```ts
it("keeps a compatibility icon for the overview route", () => {
  expect(getMaterialNavigationIcon("overview")).toMatchObject({
    label: "总览",
    glyph: expect.any(String),
  });
});
```

- [ ] **Step 6: Verify GREEN**

Run:

```bash
npm test -- src/shared/navigation.test.ts src/shared/materialNavigation.test.ts src/renderer/materialDesign.test.ts
npm run harness:check
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add src/shared/navigation.ts src/shared/navigation.test.ts src/shared/appMeta.ts src/shared/materialNavigation.ts src/shared/materialNavigation.test.ts src/renderer/App.tsx src/renderer/materialDesign.test.ts .zerox/feature_list.json docs/superpowers/specs/2026-06-23-zerox-agent-2-7-0-ui-interaction-design.md
git commit -m "feat: move overview diagnostics under settings"
```

---

### Task 2: Chat Stream Contract And IPC Bridge

**Files:**
- Modify: `src/shared/chat.ts`
- Create: `src/shared/chatStream.test.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.test.ts`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/main/chatService.ts`
- Modify: `src/main/chatService.test.ts`

- [ ] **Step 1: Write failing shared stream contract tests**

Create `src/shared/chatStream.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ChatStreamEvent, SkillUserInputRequest } from "./chat";

describe("chat stream contract", () => {
  it("represents answer and thinking deltas separately", () => {
    const answer: ChatStreamEvent = {
      sessionId: "session-1",
      requestId: "request-1",
      type: "answer_delta",
      text: "hello",
      createdAt: "2026-06-23T00:00:00.000Z",
    };
    const thinking: ChatStreamEvent = {
      sessionId: "session-1",
      requestId: "request-1",
      type: "thinking_delta",
      text: "checking requirements",
      createdAt: "2026-06-23T00:00:01.000Z",
    };

    expect(answer.type).toBe("answer_delta");
    expect(thinking.type).toBe("thinking_delta");
  });

  it("represents guided skill input as a stream event", () => {
    const request: SkillUserInputRequest = {
      id: "input-1",
      executionId: "skill-exec-1",
      sessionId: "session-1",
      requestId: "request-1",
      skillName: "local-file-organizer",
      reason: "targetDir is required before organizing files.",
      fields: [
        {
          name: "targetDir",
          label: "Target folder",
          type: "path",
          required: true,
          description: "Folder to organize",
        },
      ],
      createdAt: "2026-06-23T00:00:00.000Z",
    };
    const event: ChatStreamEvent = {
      sessionId: "session-1",
      requestId: "request-1",
      type: "waiting_for_input",
      inputRequest: request,
      createdAt: "2026-06-23T00:00:02.000Z",
    };

    expect(event.inputRequest.fields[0]?.type).toBe("path");
  });
});
```

- [ ] **Step 2: Run shared stream contract test and verify RED**

Run:

```bash
npm test -- src/shared/chatStream.test.ts
```

Expected: FAIL because `ChatStreamEvent` and `SkillUserInputRequest` do not exist.

- [ ] **Step 3: Add shared chat stream and input types**

In `src/shared/chat.ts`, add:

```ts
export type SkillInputFieldType = "string" | "number" | "boolean" | "path" | "choice";

export type SkillInputField = {
  name: string;
  label: string;
  type: SkillInputFieldType;
  required: boolean;
  description?: string;
  defaultValue?: string | number | boolean;
  choices?: string[];
};

export type SkillUserInputRequest = {
  id: string;
  executionId: string;
  sessionId: string;
  requestId: string;
  skillName: string;
  reason: string;
  fields: SkillInputField[];
  createdAt: string;
};

export type SkillInputResponse = {
  inputRequestId: string;
  values: Record<string, string | number | boolean>;
};

export type ChatStreamEvent =
  | {
      sessionId: string;
      requestId: string;
      type: "answer_delta" | "thinking_delta";
      text: string;
      createdAt: string;
    }
  | {
      sessionId: string;
      requestId: string;
      type: "tool_call_preview";
      toolCallId: string;
      toolName?: string;
      argumentsDelta?: string;
      createdAt: string;
    }
  | {
      sessionId: string;
      requestId: string;
      type: "status";
      status: ChatTaskStatusEvent;
      createdAt: string;
    }
  | {
      sessionId: string;
      requestId: string;
      type: "waiting_for_input";
      inputRequest: SkillUserInputRequest;
      createdAt: string;
    }
  | {
      sessionId: string;
      requestId: string;
      type: "completed" | "failed" | "canceled";
      message?: string;
      createdAt: string;
    };
```

Extend `ChatTaskStatusEvent["state"]` with:

```ts
| "streaming"
| "waiting_for_input"
```

Add this field:

```ts
inputRequest?: SkillUserInputRequest;
```

- [ ] **Step 4: Add preload stream bridge test**

In `src/preload/index.test.ts`, add:

```ts
it("exposes chat stream and guided skill input IPC", () => {
  expect(preloadSource).toContain("onChatStreamEvent");
  expect(preloadSource).toContain('ipcRenderer.on("chat:streamEvent"');
  expect(preloadSource).toContain("respondSkillInput");
  expect(preloadSource).toContain('ipcRenderer.invoke("chat:respondSkillInput"');
});
```

- [ ] **Step 5: Run preload test and verify RED**

Run:

```bash
npm test -- src/preload/index.test.ts
```

Expected: FAIL because the bridge does not expose stream or guided input APIs.

- [ ] **Step 6: Implement preload bridge and IPC shell**

In `src/preload/index.ts`, import `ChatStreamEvent` and `SkillInputResponse`, then add to `buildingAgent`:

```ts
onChatStreamEvent: (callback: (event: ChatStreamEvent) => void) => {
  const handler = (_event: Electron.IpcRendererEvent, data: ChatStreamEvent) =>
    callback(data);
  ipcRenderer.on("chat:streamEvent", handler);
  return () => {
    ipcRenderer.removeListener("chat:streamEvent", handler);
  };
},
respondSkillInput: (input: SkillInputResponse): Promise<SendChatMessageResult> =>
  ipcRenderer.invoke("chat:respondSkillInput", input),
```

In `src/main/ipc/index.ts`, add stream sending near the existing status event handler:

```ts
function sendChatStreamEvent(event: ChatStreamEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send("chat:streamEvent", event);
    }
  }
}
```

In `registerChatIpcHandlers`, pass an `onStreamEvent` callback into `sendMessage`:

```ts
onStreamEvent(streamEvent) {
  sender.send("chat:streamEvent", streamEvent);
},
```

Add the guided input handler:

```ts
ipcMain.handle("chat:respondSkillInput", async (_event, input: SkillInputResponse) =>
  container.respondSkillInput(input),
);
```

Add a temporary guarded method to the app container surface in this task so IPC compiles before Task 4 wires the real implementation:

```ts
respondSkillInput(_input: SkillInputResponse): Promise<SendChatMessageResult> {
  return Promise.resolve({ ok: false, message: "Guided skill input is not wired yet." });
}
```

Task 4 replaces this guarded bridge with real behavior.

- [ ] **Step 7: Add chat service stream callback type**

In `src/main/chatService.ts`, add:

```ts
import type { ChatStreamEvent } from "../shared/chat";
```

Extend send options:

```ts
onStreamEvent?: (event: ChatStreamEvent) => void;
```

Add helper:

```ts
function createChatStreamEmitter(options: {
  sessionId: string;
  requestId: string;
  now: () => Date;
  onStreamEvent?: (event: ChatStreamEvent) => void;
}) {
  return {
    send(event: Omit<ChatStreamEvent, "sessionId" | "requestId" | "createdAt">) {
      options.onStreamEvent?.({
        ...event,
        sessionId: options.sessionId,
        requestId: options.requestId,
        createdAt: options.now().toISOString(),
      } as ChatStreamEvent);
    },
  };
}
```

Wire it where status emitters are created:

```ts
const streamEmitter = createChatStreamEmitter({
  sessionId,
  requestId,
  now: options.now,
  onStreamEvent: runtimeOptions.onStreamEvent,
});
```

Emit `status` stream events whenever status events are emitted:

```ts
streamEmitter.send({ type: "status", status: statusEvent });
```

- [ ] **Step 8: Verify GREEN**

Run:

```bash
npm test -- src/shared/chatStream.test.ts src/preload/index.test.ts src/main/chatService.test.ts
npm run harness:check
```

Expected: PASS.

- [ ] **Step 9: Commit Task 2**

```bash
git add src/shared/chat.ts src/shared/chatStream.test.ts src/preload/index.ts src/preload/index.test.ts src/main/ipc/index.ts src/main/chatService.ts src/main/chatService.test.ts
git commit -m "feat: add chat stream event contract"
```

---

### Task 3: Provider And Agent Loop Streaming Aggregation

**Files:**
- Modify: `src/main/providers/providerChatClient.ts`
- Modify: `src/main/providers/streamProcessor.ts`
- Modify: `src/main/providers/p8.test.ts`
- Modify: `src/main/agentLoop.ts`
- Modify: `src/main/agentLoop.test.ts`
- Modify: `src/main/chatService.ts`
- Modify: `src/main/chatService.test.ts`

- [ ] **Step 1: Add failing provider adapter test for thinking delta preservation**

In `src/main/providers/p8.test.ts`, add:

```ts
it("preserves thinking deltas through provider chat client streaming", async () => {
  const events: StreamEvent[] = [
    { type: "thinking_delta", text: "checking inputs" },
    { type: "text_delta", text: "answer" },
    { type: "done" },
  ];
  const provider = scriptedStreamProvider(events);
  const req: CompleteRequest = {
    model: "m",
    apiKey: "k",
    temperature: 0,
    maxTokens: 10,
    messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  };
  const result = await processStream(provider, req);

  expect(result.response.reasoningContent).toBe("checking inputs");
  expect(result.response.content).toBe("answer");
  expect(result.thinkingDeltas).toBe(1);
});
```

- [ ] **Step 2: Run provider test and verify RED**

Run:

```bash
npm test -- src/main/providers/p8.test.ts -t "thinking deltas"
```

Expected: FAIL because the older low-level stream event shape has no reasoning delta.

- [ ] **Step 3: Extend low-level stream event shape**

In `src/main/openAiCompatibleClient.ts`, extend `StreamEvent`:

```ts
| { type: "reasoning_delta"; text: string }
```

In `src/main/providers/providerChatClient.ts`, map provider `thinking_delta`:

```ts
if (ev.type === "thinking_delta") {
  yield { type: "reasoning_delta", text: ev.text };
}
```

- [ ] **Step 4: Add failing agent loop streaming callback test**

In `src/main/agentLoop.test.ts`, add:

```ts
it("emits streamed answer and reasoning deltas before final response", async () => {
  const streamed: string[] = [];
  const chatClient = {
    async complete() {
      return { content: "final answer", toolCalls: [], finishReason: "stop" };
    },
    async *streamComplete() {
      yield { type: "reasoning_delta" as const, text: "thinking" };
      yield { type: "content_delta" as const, text: "final " };
      yield { type: "content_delta" as const, text: "answer" };
      yield { type: "done" as const, finishReason: "stop" };
    },
  };

  const result = await runAgentLoop([{ role: "user", content: "hello" }], modelProfile, {
    chatClient,
    toolExecutor,
    maxTurns: 1,
    onReasoningDelta(text) {
      streamed.push(`thinking:${text}`);
    },
    onAnswerDelta(text) {
      streamed.push(`answer:${text}`);
    },
  });

  expect(result.summary).toBe("final answer");
  expect(streamed).toEqual(["thinking:thinking", "answer:final ", "answer:answer"]);
});
```

Use existing local test helpers for `modelProfile` and `toolExecutor`.

- [ ] **Step 5: Run agent loop test and verify RED**

Run:

```bash
npm test -- src/main/agentLoop.test.ts -t "streamed answer and reasoning"
```

Expected: FAIL because `runAgentLoop` has no `onAnswerDelta` / `onReasoningDelta` callbacks and does not use `streamComplete`.

- [ ] **Step 6: Add streaming callbacks and aggregation in agent loop**

In `src/main/agentLoop.ts`, extend `AgentLoopOptions`:

```ts
onAnswerDelta?: (text: string, turn: number) => void;
onReasoningDelta?: (text: string, turn: number) => void;
onToolCallDelta?: (event: {
  toolCallId: string;
  name?: string;
  argumentsDelta?: string;
  turn: number;
}) => void;
```

Add a helper:

```ts
function isStreamingChatClient(client: ChatClient): client is ChatClient & StreamingChatClient {
  return "streamComplete" in client && typeof client.streamComplete === "function";
}
```

Before each model call, use streaming when available:

```ts
const response = isStreamingChatClient(chatClient)
  ? await completeModelRequestStreaming({
      chatClient,
      request,
      turn: turns + 1,
      onAnswerDelta,
      onReasoningDelta,
      onToolCallDelta,
    })
  : await completeWithModelRetry(request, retryOptions);
```

Implement `completeModelRequestStreaming` to aggregate:

```ts
async function completeModelRequestStreaming(options: {
  chatClient: ChatClient & StreamingChatClient;
  request: ChatCompletionRequest;
  turn: number;
  onAnswerDelta?: (text: string, turn: number) => void;
  onReasoningDelta?: (text: string, turn: number) => void;
  onToolCallDelta?: (event: {
    toolCallId: string;
    name?: string;
    argumentsDelta?: string;
    turn: number;
  }) => void;
}): Promise<ChatCompletionResponse> {
  let content = "";
  let reasoningContent = "";
  const toolCalls = new Map<string, ToolCall>();

  for await (const event of options.chatClient.streamComplete(options.request)) {
    if (event.type === "content_delta") {
      content += event.text;
      options.onAnswerDelta?.(event.text, options.turn);
    } else if (event.type === "reasoning_delta") {
      reasoningContent += event.text;
      options.onReasoningDelta?.(event.text, options.turn);
    } else if (event.type === "tool_call_delta") {
      const existing = toolCalls.get(event.id) ?? {
        id: event.id,
        type: "function" as const,
        function: { name: event.name, arguments: "" },
      };
      toolCalls.set(event.id, {
        ...existing,
        function: {
          name: event.name || existing.function.name,
          arguments: `${existing.function.arguments}${event.arguments}`,
        },
      });
      options.onToolCallDelta?.({
        toolCallId: event.id,
        name: event.name,
        argumentsDelta: event.arguments,
        turn: options.turn,
      });
    }
  }

  return {
    content: content.trim() || null,
    toolCalls: [...toolCalls.values()],
    finishReason: toolCalls.size ? "tool_calls" : "stop",
    ...(reasoningContent ? { reasoningContent } : {}),
  };
}
```

Keep existing complete/retry behavior for providers without streaming.

- [ ] **Step 7: Wire chat service stream events**

In `src/main/chatService.ts`, pass callbacks into `runAgentLoop`:

```ts
onAnswerDelta(text) {
  streamEmitter.send({ type: "answer_delta", text });
},
onReasoningDelta(text) {
  streamEmitter.send({ type: "thinking_delta", text });
},
onToolCallDelta(event) {
  streamEmitter.send({
    type: "tool_call_preview",
    toolCallId: event.toolCallId,
    ...(event.name ? { toolName: event.name } : {}),
    ...(event.argumentsDelta ? { argumentsDelta: event.argumentsDelta } : {}),
  });
},
```

- [ ] **Step 8: Verify GREEN**

Run:

```bash
npm test -- src/main/providers/p8.test.ts src/main/agentLoop.test.ts src/main/chatService.test.ts
npm run harness:check
```

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

```bash
git add src/main/openAiCompatibleClient.ts src/main/providers/providerChatClient.ts src/main/providers/streamProcessor.ts src/main/providers/p8.test.ts src/main/agentLoop.ts src/main/agentLoop.test.ts src/main/chatService.ts src/main/chatService.test.ts
git commit -m "feat: stream chat answers and thinking through agent loop"
```

---

### Task 4: Guided Skill Input Preflight

**Files:**
- Modify: `src/shared/skillExecutionContract.ts`
- Modify: `src/shared/skillExecutionContract.test.ts`
- Modify: `src/shared/skills.ts`
- Modify: `src/main/skillExecutionService.ts`
- Modify: `src/main/skillExecutionService.test.ts`
- Modify: `src/main/chatService.ts`
- Modify: `src/main/chatService.test.ts`
- Modify: `src/shared/toolPermissions.ts`
- Modify: `src/shared/toolPermissions.test.ts`
- Modify: `src/main/container.ts`
- Modify: `src/main/container.test.ts`

- [ ] **Step 1: Add failing skill execution contract tests**

In `src/shared/skillExecutionContract.test.ts`, add:

```ts
it("allows guided skill input wait and resume transitions", () => {
  const snapshot = createSkillExecutionSnapshot({
    executionId: "skill-exec-1",
    selectedSkillName: "local-file-organizer",
    now: "2026-06-23T00:00:00.000Z",
  });

  const waiting = transitionSkillExecution(snapshot, "auditing_requirements");
  const requested = transitionSkillExecution(waiting, "waiting_for_user_input", {
    message: "targetDir is required",
  });
  const validating = transitionSkillExecution(requested, "validating_input");

  expect(validating.stage).toBe("validating_input");
});
```

Use existing local snapshot helper names if they differ.

- [ ] **Step 2: Run contract test and verify RED**

Run:

```bash
npm test -- src/shared/skillExecutionContract.test.ts -t "guided skill input"
```

Expected: FAIL because guided stages do not exist.

- [ ] **Step 3: Extend skill execution stages and input types**

In `src/shared/skillExecutionContract.ts`, extend `SkillExecutionStage`:

```ts
| "auditing_requirements"
| "waiting_for_user_input"
| "validating_input"
| "waiting_for_approval"
```

Add:

```ts
export type SkillInputResolution = {
  status: "complete" | "missing" | "invalid";
  values: Record<string, string | number | boolean>;
  missingFields: string[];
  invalidFields: Array<{ name: string; reason: string }>;
};
```

Add these fields to `SkillExecutionSnapshot`:

```ts
inputResolution?: SkillInputResolution;
pendingInputRequestId?: string;
```

Update `allowedSkillStageTransitions` so:

```ts
loading_resources: ["auditing_requirements", "failed", "canceled"],
auditing_requirements: ["waiting_for_user_input", "validating_input", "planning", "failed", "canceled"],
waiting_for_user_input: ["validating_input", "failed", "canceled"],
validating_input: ["planning", "waiting_for_user_input", "failed", "canceled"],
planning: ["executing", "failed", "canceled"],
executing: ["waiting_for_approval", "validating", "failed", "canceled"],
waiting_for_approval: ["executing", "failed", "canceled"],
```

- [ ] **Step 4: Add failing chat service missing input test**

In `src/main/chatService.test.ts`, add:

```ts
it("requests required skill input before model execution", async () => {
  let modelCalls = 0;
  const streamEvents: ChatStreamEvent[] = [];
  const service = createChatServiceForTest({
    chatClient: {
      async complete() {
        modelCalls += 1;
        return { content: "should not run", toolCalls: [], finishReason: "stop" };
      },
    },
    discoverSkills: async () => ({
      skills: [
        createSkillRecord({
          name: "local-file-organizer",
          inputs: [{ name: "targetDir", type: "path", required: true }],
        }),
      ],
      errors: [],
    }),
  });

  const result = await service.sendMessage(
    { message: "use @local-file-organizer", selectedSkillName: "local-file-organizer" },
    { onStreamEvent: (event) => streamEvents.push(event) },
  );

  expect(result.ok).toBe(true);
  expect(modelCalls).toBe(0);
  expect(streamEvents.some((event) => event.type === "waiting_for_input")).toBe(true);
});
```

Use existing test factory names from `chatService.test.ts`.

- [ ] **Step 5: Run chat service missing input test and verify RED**

Run:

```bash
npm test -- src/main/chatService.test.ts -t "required skill input"
```

Expected: FAIL because chat service currently runs the model after resolving the skill.

- [ ] **Step 6: Implement deterministic skill input resolution**

In `src/main/skillExecutionService.ts`, add:

```ts
export function resolveSkillInputs(options: {
  skill: SkillRecord;
  providedValues?: Record<string, string | number | boolean>;
}): SkillInputResolution {
  const values = options.providedValues ?? {};
  const missingFields: string[] = [];
  const invalidFields: Array<{ name: string; reason: string }> = [];

  for (const input of options.skill.manifest.inputs ?? []) {
    const value = values[input.name];
    if (input.required && (value === undefined || value === "")) {
      missingFields.push(input.name);
      continue;
    }
    if (value !== undefined && input.type === "number" && typeof value !== "number") {
      invalidFields.push({ name: input.name, reason: "Expected number." });
    }
  }

  return {
    status: invalidFields.length ? "invalid" : missingFields.length ? "missing" : "complete",
    values,
    missingFields,
    invalidFields,
  };
}
```

Add helper to build `SkillUserInputRequest`:

```ts
export function buildSkillUserInputRequest(options: {
  id: string;
  executionId: string;
  sessionId: string;
  requestId: string;
  skill: SkillRecord;
  resolution: SkillInputResolution;
  createdAt: string;
}): SkillUserInputRequest {
  return {
    id: options.id,
    executionId: options.executionId,
    sessionId: options.sessionId,
    requestId: options.requestId,
    skillName: options.skill.manifest.name,
    reason: `Missing required input: ${options.resolution.missingFields.join(", ")}`,
    fields: (options.skill.manifest.inputs ?? [])
      .filter((field) => options.resolution.missingFields.includes(field.name))
      .map((field) => ({
        name: field.name,
        label: field.label ?? field.name,
        type: field.type,
        required: field.required,
        ...(field.description ? { description: field.description } : {}),
      })),
    createdAt: options.createdAt,
  };
}
```

- [ ] **Step 7: Wire chat preflight and pending input persistence**

In `src/main/chatService.ts`, after `requestedSkill?.kind === "matched"` and before model profile lookup:

```ts
const inputResolution = requestedSkill?.kind === "matched"
  ? resolveSkillInputs({ skill: requestedSkill.skill })
  : null;

if (requestedSkill?.kind === "matched" && inputResolution?.status === "missing") {
  const inputRequest = buildSkillUserInputRequest({
    id: createId("skill_input"),
    executionId: createId("skill_exec"),
    sessionId,
    requestId,
    skill: requestedSkill.skill,
    resolution: inputResolution,
    createdAt: options.now().toISOString(),
  });

  await options.chatSessionStore.updateActivity(sessionId, {
    pendingInputRequest: inputRequest,
  });
  streamEmitter.send({ type: "waiting_for_input", inputRequest });
  emitStatus.send({
    state: "waiting_for_input",
    message: inputRequest.reason,
    selectedSkillName: requestedSkill.skill.manifest.name,
    inputRequest,
  });

  return {
    ok: true,
    reply: inputRequest.reason,
    sessionId,
    relatedMemories: [],
    memoryId: null,
    selectedSkill: {
      name: requestedSkill.skill.manifest.name,
      displayName: requestedSkill.skill.manifest.displayName,
    },
  };
}
```

If `updateActivity` is not the local store method name, add a focused store method in this task and cover it in `src/main/chatSessionStore.test.ts`.

- [ ] **Step 8: Implement guided input response entrypoint**

In `src/main/container.ts`, implement:

```ts
async respondSkillInput(input: SkillInputResponse): Promise<SendChatMessageResult> {
  return this.chatService().respondSkillInput(input);
}
```

In `src/main/chatService.ts`, add `respondSkillInput(input: SkillInputResponse)`. It should:

1. Load the pending input request from the session activity.
2. Resolve and validate values.
3. If invalid or still missing, emit a new `waiting_for_input`.
4. If complete, resume normal skill execution using the original session, request id, skill, and resolved values.

Use the same `sendMessage` internal path after injecting `providedSkillInputValues`.

- [ ] **Step 9: Verify GREEN**

Run:

```bash
npm test -- src/shared/skillExecutionContract.test.ts src/main/skillExecutionService.test.ts src/main/chatService.test.ts src/main/container.test.ts src/shared/toolPermissions.test.ts
npm run harness:check
```

Expected: PASS.

- [ ] **Step 10: Commit Task 4**

```bash
git add src/shared/skillExecutionContract.ts src/shared/skillExecutionContract.test.ts src/shared/skills.ts src/main/skillExecutionService.ts src/main/skillExecutionService.test.ts src/main/chatService.ts src/main/chatService.test.ts src/shared/toolPermissions.ts src/shared/toolPermissions.test.ts src/main/container.ts src/main/container.test.ts
git commit -m "feat: add guided skill input preflight"
```

---

### Task 5: Renderer Streaming Transcript And Guided Input UI

**Files:**
- Modify: `src/renderer/components/AgentChatPanel.tsx`
- Modify: `src/renderer/chatTaskActivity.ts`
- Modify: `src/renderer/chatTaskActivity.test.ts`
- Modify: `src/renderer/chatTaskActivityRestore.test.ts`
- Modify: `src/renderer/materialDesign.test.ts`
- Modify: `src/renderer/styles/chat.css`
- Modify: `src/renderer/styles/composer.css`
- Modify: `src/renderer/styles/responsive.css`

- [ ] **Step 1: Add failing renderer contract tests**

In `src/renderer/chatTaskActivity.test.ts`, add:

```ts
it("maps guided skill input to a paused user-input activity", () => {
  const event: ChatTaskStatusEvent = {
    sessionId: "session-1",
    state: "waiting_for_input",
    message: "Missing required input: targetDir",
    createdAt: "2026-06-23T00:00:00.000Z",
    elapsedMs: 0,
    selectedSkillName: "local-file-organizer",
    inputRequest: {
      id: "input-1",
      executionId: "skill-exec-1",
      sessionId: "session-1",
      requestId: "request-1",
      skillName: "local-file-organizer",
      reason: "Missing required input: targetDir",
      fields: [{ name: "targetDir", label: "Target folder", type: "path", required: true }],
      createdAt: "2026-06-23T00:00:00.000Z",
    },
  };

  expect(getWorkPhaseFromChatStatusEvent(event)).toBe("paused");
  expect(buildTaskActivityFromStatusEvent(event)).toMatchObject({
    kind: "paused",
    title: "等待补充信息",
  });
});
```

In `src/renderer/materialDesign.test.ts`, add expectations for:

```ts
expect(chatPanelSource).toContain("onChatStreamEvent");
expect(chatPanelSource).toContain("streaming-assistant-message");
expect(chatPanelSource).toContain("guided-skill-input-form");
expect(styles).toContain(".chat-message-collapse");
expect(styles).toContain(".process-rail-drawer");
```

- [ ] **Step 2: Run renderer tests and verify RED**

Run:

```bash
npm test -- src/renderer/chatTaskActivity.test.ts src/renderer/materialDesign.test.ts
```

Expected: FAIL because `waiting_for_input`, stream UI, guided input form, and collapse styles do not exist.

- [ ] **Step 3: Update activity mapping**

In `src/renderer/chatTaskActivity.ts`:

```ts
if (event.state === "waiting_for_input") return "paused";
```

In `getTaskActivityTitleFromStatusEvent`:

```ts
if (event.state === "waiting_for_input") return "等待补充信息";
```

In `getProcessLabel`:

```ts
if (event.state === "waiting_for_input") return "补充信息";
```

- [ ] **Step 4: Add stream message state in AgentChatPanel**

In `AgentChatPanel.tsx`, extend `ChatMessage`:

```ts
type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
  createdAt: string;
  streaming?: boolean;
  stopped?: boolean;
  thinkingContent?: string;
  collapsed?: boolean;
};
```

Add state:

```ts
const [pendingInputRequest, setPendingInputRequest] =
  useState<SkillUserInputRequest | null>(null);
```

Subscribe to stream events:

```ts
useEffect(() => {
  if (!window.buildingAgent) {
    return;
  }

  return window.buildingAgent.onChatStreamEvent((event) => {
    if (event.type === "answer_delta") {
      appendAssistantDelta(event.requestId, event.text);
    } else if (event.type === "thinking_delta") {
      appendThinkingDelta(event.requestId, event.text);
    } else if (event.type === "waiting_for_input") {
      setPendingInputRequest(event.inputRequest);
    } else if (event.type === "completed" || event.type === "failed" || event.type === "canceled") {
      finalizeStreamingMessage(event.requestId, event.type);
    }
  });
}, []);
```

Add helpers:

```ts
function appendAssistantDelta(requestId: string, text: string) {
  setMessages((current) =>
    current.map((message) =>
      message.id === requestId
        ? { ...message, content: `${message.content}${text}`, streaming: true }
        : message,
    ),
  );
}

function appendThinkingDelta(requestId: string, text: string) {
  setMessages((current) =>
    current.map((message) =>
      message.id === requestId
        ? { ...message, thinkingContent: `${message.thinkingContent ?? ""}${text}` }
        : message,
    ),
  );
}

function finalizeStreamingMessage(requestId: string, type: ChatStreamEvent["type"]) {
  setMessages((current) =>
    current.map((message) =>
      message.id === requestId
        ? { ...message, streaming: false, stopped: type === "canceled" }
        : message,
    ),
  );
}
```

When sending a message, create a placeholder:

```ts
const assistantPlaceholder = createMessage(
  { role: "assistant", content: "" },
  messages.length + 1,
);
assistantPlaceholder.id = requestId;
assistantPlaceholder.streaming = true;
setMessages((current) => [...current, userMessage, assistantPlaceholder]);
```

Remove the final `appendMessage({ role: "assistant", content: result.reply })` when streamed content already exists.

- [ ] **Step 5: Render thinking and collapse controls**

In assistant message rendering:

```tsx
<article className={`chat-message is-${message.role} ${message.streaming ? "streaming-assistant-message" : ""}`}>
  <span>{message.role === "assistant" ? "智能体" : "你"}</span>
  {message.thinkingContent ? (
    <details className="thinking-process-block">
      <summary>思考过程</summary>
      <p>{message.thinkingContent}</p>
    </details>
  ) : null}
  <CollapsibleMarkdownMessage content={message.content} streaming={message.streaming} />
  <small>{message.stopped ? "已中断" : message.createdAt}</small>
</article>
```

Add `CollapsibleMarkdownMessage`:

```tsx
function CollapsibleMarkdownMessage({
  content,
  streaming,
}: {
  content: string;
  streaming?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const shouldCollapse = !streaming && content.length > 2400;

  return (
    <div className={shouldCollapse && !expanded ? "chat-message-collapse" : ""}>
      <MarkdownMessage content={content} />
      {shouldCollapse ? (
        <button type="button" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "收起" : "展开完整回答"}
        </button>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 6: Render guided skill input form**

Add:

```tsx
function GuidedSkillInputForm({
  request,
  onSubmit,
}: {
  request: SkillUserInputRequest;
  onSubmit: (values: Record<string, string | number | boolean>) => void;
}) {
  const [values, setValues] = useState<Record<string, string | number | boolean>>({});
  return (
    <form className="guided-skill-input-form" onSubmit={(event) => {
      event.preventDefault();
      onSubmit(values);
    }}>
      <strong>{request.skillName}</strong>
      <p>{request.reason}</p>
      {request.fields.map((field) => (
        <label key={field.name}>
          <span>{field.label}</span>
          <input
            required={field.required}
            type={field.type === "number" ? "number" : "text"}
            value={String(values[field.name] ?? "")}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                [field.name]: field.type === "number" ? Number(event.currentTarget.value) : event.currentTarget.value,
              }))
            }
          />
        </label>
      ))}
      <button type="submit">继续</button>
    </form>
  );
}
```

Render it in the process rail when `pendingInputRequest` is set.

- [ ] **Step 7: Add CSS for streaming, collapse, rail drawer, and guided input**

In `src/renderer/styles/chat.css`:

```css
.streaming-assistant-message .markdown-message::after {
  content: "";
  display: inline-block;
  width: 7px;
  height: 1em;
  margin-left: 3px;
  background: currentColor;
  animation: stream-caret 900ms steps(2, start) infinite;
  vertical-align: text-bottom;
}

@keyframes stream-caret {
  50% { opacity: 0; }
}

.thinking-process-block,
.guided-skill-input-form {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-surface-raised);
}

.chat-message-collapse {
  max-height: 520px;
  overflow: hidden;
  position: relative;
}
```

In `src/renderer/styles/responsive.css`, replace hiding of the context panel under 1180px with:

```css
@media (max-width: 1180px) {
  .agent-chat-panel.has-context-panel {
    grid-template-columns: minmax(0, 1fr);
  }

  .agent-context-panel {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 40;
    width: min(360px, calc(100vw - 32px));
    max-height: min(70vh, 620px);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg);
    background: var(--bg-surface-raised);
    box-shadow: var(--shadow-md);
  }

  .process-rail-drawer {
    display: grid;
  }
}
```

- [ ] **Step 8: Verify GREEN**

Run:

```bash
npm test -- src/renderer/chatTaskActivity.test.ts src/renderer/chatTaskActivityRestore.test.ts src/renderer/materialDesign.test.ts
npm run harness:check
```

Expected: PASS.

- [ ] **Step 9: Commit Task 5**

```bash
git add src/renderer/components/AgentChatPanel.tsx src/renderer/chatTaskActivity.ts src/renderer/chatTaskActivity.test.ts src/renderer/chatTaskActivityRestore.test.ts src/renderer/materialDesign.test.ts src/renderer/styles/chat.css src/renderer/styles/composer.css src/renderer/styles/responsive.css
git commit -m "feat: render streamed chat and guided skill input"
```

---

### Task 6: Icon System And Visual Design Artifact

**Files:**
- Create: `src/renderer/components/Icon.tsx`
- Modify: `src/renderer/components/AgentChatPanel.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/materialDesign.test.ts`
- Modify: `src/renderer/styles/sidebar.css`
- Modify: `src/renderer/styles/composer.css`
- Modify: `docs/design/zerox-agent-2-7-0-ui-artifact.html`

- [ ] **Step 1: Add failing material design icon assertions**

In `src/renderer/materialDesign.test.ts`, add:

```ts
it("uses the shared local Icon component for primary controls", () => {
  const iconSource = readFileSync(
    path.join(process.cwd(), "src/renderer/components/Icon.tsx"),
    "utf8",
  );
  expect(iconSource).toContain("export function Icon");
  expect(chatPanelSource).toContain("<Icon name=\"send\"");
  expect(chatPanelSource).toContain("<Icon name=\"stop\"");
  expect(chatPanelSource).toContain("<Icon name=\"command\"");
  expect(appSource).toContain("<Icon name=\"plus\"");
  expect(appSource).not.toContain("＋");
  expect(chatPanelSource).not.toContain("×");
});
```

- [ ] **Step 2: Run material design test and verify RED**

Run:

```bash
npm test -- src/renderer/materialDesign.test.ts -t "Icon component"
```

Expected: FAIL because `Icon.tsx` does not exist and glyphs remain.

- [ ] **Step 3: Create Icon component**

Create `src/renderer/components/Icon.tsx`:

```tsx
export type IconName =
  | "plus"
  | "more"
  | "close"
  | "command"
  | "send"
  | "stop"
  | "expand"
  | "collapse"
  | "tool"
  | "thinking"
  | "approval"
  | "settings"
  | "run"
  | "task";

const iconPaths: Record<IconName, string> = {
  plus: "M12 5v14M5 12h14",
  more: "M6 12h.01M12 12h.01M18 12h.01",
  close: "M6 6l12 12M18 6 6 18",
  command: "M9 9H6.5A2.5 2.5 0 1 1 9 6.5V17.5A2.5 2.5 0 1 1 6.5 15H17.5A2.5 2.5 0 1 1 15 17.5V6.5A2.5 2.5 0 1 1 17.5 9H9Z",
  send: "M4 12 20 4l-4 16-4-6-8-2Z",
  stop: "M7 7h10v10H7z",
  expand: "M8 10l4 4 4-4",
  collapse: "M8 14l4-4 4 4",
  tool: "M14.7 6.3a4 4 0 0 0-5 5L4 17l3 3 5.7-5.7a4 4 0 0 0 5-5l-2.4 2.4-3-3 2.4-2.4Z",
  thinking: "M12 4a7 7 0 0 0-3 13.3V20h6v-2.7A7 7 0 0 0 12 4Z",
  approval: "M20 6 9 17l-5-5",
  settings: "M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8ZM4 12h2M18 12h2M12 4v2M12 18v2",
  run: "M8 5v14l11-7L8 5Z",
  task: "M5 6h14M5 12h14M5 18h10",
};

export function Icon({
  name,
  size = 16,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <path
        d={iconPaths[name]}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}
```

- [ ] **Step 4: Replace glyph controls**

In `AgentChatPanel.tsx`, import:

```ts
import { Icon } from "./Icon";
```

Replace send/stop/command spans:

```tsx
<Icon name="command" />
<Icon name="stop" />
<Icon name="send" />
```

Replace selected skill cancel `×` with:

```tsx
<Icon name="close" />
```

In `App.tsx`, import:

```ts
import { Icon } from "./components/Icon";
```

Replace the new-chat glyph with:

```tsx
<Icon name="plus" />
```

Replace more-menu glyphs with:

```tsx
<Icon name="more" />
```

- [ ] **Step 5: Add design artifact**

Create `docs/design/zerox-agent-2-7-0-ui-artifact.html` as a static design artifact with sections for:

```html
<section data-state="empty-chat"></section>
<section data-state="streaming-answer"></section>
<section data-state="thinking-collapsed"></section>
<section data-state="guided-skill-input"></section>
<section data-state="tool-approval"></section>
<section data-state="paused-run"></section>
<section data-state="error-state"></section>
<section data-state="restored-session"></section>
<section data-state="narrow-layout"></section>
```

Use the existing warm-neutral palette from `tokens.css`, not the poster-only untracked artifact.

- [ ] **Step 6: Verify GREEN**

Run:

```bash
npm test -- src/renderer/materialDesign.test.ts
npm run harness:check
```

Expected: PASS.

- [ ] **Step 7: Commit Task 6**

```bash
git add src/renderer/components/Icon.tsx src/renderer/components/AgentChatPanel.tsx src/renderer/App.tsx src/renderer/materialDesign.test.ts src/renderer/styles/sidebar.css src/renderer/styles/composer.css docs/design/zerox-agent-2-7-0-ui-artifact.html
git commit -m "feat: unify renderer icons and add ui artifact"
```

---

### Task 7: End-To-End Verification, Docs, And Progress Evidence

**Files:**
- Modify: `.zerox/progress.md`
- Modify: `README.md`
- Modify: `src/shared/readme.test.ts`
- Modify: `src/shared/packageScripts.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.zerox/feature_list.json`

- [ ] **Step 1: Add release metadata tests after implementation passes**

In `src/shared/packageScripts.test.ts`, update the expected package version to `2.7.0`.

In `src/shared/readme.test.ts`, add assertions that README mentions:

```ts
expect(readme).toContain("v2.7.0");
expect(readme).toContain("Chat-first");
expect(readme).toContain("streamed answers");
expect(readme).toContain("guided skill input");
```

- [ ] **Step 2: Run release metadata tests and verify RED**

Run:

```bash
npm test -- src/shared/packageScripts.test.ts src/shared/readme.test.ts
```

Expected: FAIL until package metadata and README are updated.

- [ ] **Step 3: Update README and package metadata**

Update `package.json` and `package-lock.json` version fields to `2.7.0`.

Add README release notes:

```md
## v2.7.0

Zerox Agent v2.7.0 makes Chat the primary interaction surface. It removes Overview from primary navigation, streams answers into the transcript, separates thinking/process output, supports guided skill input before execution, unifies local icons, and preserves local-first permission and workspace boundaries.
```

- [ ] **Step 4: Run focused and full command gates**

Run:

```bash
npm test
npm run build
npm run verify
npm run smoke:prod
npm run harness:score
npm run harness:check
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 5: Run packaged gates**

Run:

```bash
npm run dist:mac
npm run smoke:prod:built
BUILDING_AGENT_SMOKE=1 BUILDING_AGENT_SMOKE_REQUIRED_TEXTS='v2.7.0' "release/mac-arm64/Zerox Agent.app/Contents/MacOS/Zerox Agent"
```

Expected: all commands exit 0 and packaged app reports v2.7.0.

- [ ] **Step 6: Independent acceptance officer**

Dispatch an independent acceptance officer who did not implement the changes. The officer must use production Electron or packaged app and run the scenarios from the spec:

```text
Fresh launch, navigation, composer, streaming answer, thinking collapse, guided skill input, tool approval, Runs audit, responsive viewports, and no permission bypass.
```

Required final verdict format:

```text
ACCEPTED
App path:
Config dir:
Command evidence:
Scenario evidence:
Screenshots:
Defects:
```

If the officer returns `REJECTED`, fix the findings with TDD and rerun the officer.

- [ ] **Step 7: Mark feature done and record progress**

In `.zerox/feature_list.json`, set:

```json
"status": "done"
```

for `P16-v2.7.0-ui-interaction`.

Add a `.zerox/progress.md` entry:

```md
## 2026-06-23 - v2.7.0 UI/Interaction Iteration

- Request: fully optimize/rework interaction and UI with Chat-first consumer experience, streamed output, separated thinking/process, guided skill input, icon cleanup, testing, and independent acceptance.
- Planning/design evidence:
  - Spec: `docs/superpowers/specs/2026-06-23-zerox-agent-2-7-0-ui-interaction-design.md`
  - Plan: `docs/superpowers/plans/2026-06-23-zerox-agent-2-7-0-ui-interaction.md`
  - Design artifact: `docs/design/zerox-agent-2-7-0-ui-artifact.html`
- Changed files:
  - Use `git diff --name-only HEAD~1..HEAD` after the final commit and paste the exact file list.
- Focused test evidence:
  - Paste the exact focused `npm test -- ...` commands from Tasks 1-6 and their pass counts.
- Full command gates:
  - Paste the exact `npm run harness:check`, `npm test`, `npm run build`, `npm run verify`, and `npm run smoke:prod` results.
- Browser/Electron QA:
  - Paste the exact black-box scenario names, app path, config dir, and screenshots or notes.
- Independent acceptance:
  - Officer:
  - App path:
  - Config dir:
  - Verdict: ACCEPTED
  - Evidence:
```

- [ ] **Step 8: Commit Task 7**

```bash
git add .zerox/feature_list.json .zerox/progress.md README.md src/shared/readme.test.ts src/shared/packageScripts.test.ts package.json package-lock.json
git commit -m "release: document v2.7.0 ui interaction iteration"
```

---

## Plan Self-Review

Spec coverage:

- Chat-first IA: Task 1 and Task 5.
- Overview removal/relocation: Task 1.
- Streamed answer and separated thinking: Task 2, Task 3, Task 5.
- Auto-collapse: Task 5.
- Interactive/guided skills: Task 4 and Task 5.
- Tool authorization and workspace sandbox preservation: Task 3, Task 4, Task 7.
- Icon optimization: Task 6.
- UI/UE design artifact: Task 6.
- Testing and independent acceptance: Task 7.

Execution rule:

- Implementation must follow TDD. Every production behavior change above starts with a failing test in its task.
- Do not skip spec compliance review or code quality review when executing with subagents.
- Do not mark P16 done until all command gates and independent acceptance pass.
