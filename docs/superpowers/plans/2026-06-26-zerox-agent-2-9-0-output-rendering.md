# Zerox Agent 2.9.0 Output Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved Zerox Agent 2.9.0 output rendering upgrade with evidence-bound answers, run ledger rendering, typed output parts, restored-session fidelity, and first-class treatment for tables, code blocks, diffs, terminal output, JSON, citations, artifacts, approvals, and guided input.

**Architecture:** Add a backward-compatible typed output layer in shared chat contracts, emit and persist those parts from the main process, then render the same parts in live and restored chat. Keep plain text `content` as the search/history/model surface while `outputParts` drives richer display, evidence binding, and artifact restore.

**Tech Stack:** Electron 42, React 19, TypeScript 6, Vite 8, Vitest 4, local JSON/SQLite storage abstractions, OpenAI-compatible/Anthropic/Gemini provider adapters, existing local CSS/tokens.

## Global Constraints

- Default visual direction is Evidence-Linked Answer fused with Run Ledger Answer.
- Document Report Answer is supported for long research/report outputs.
- Do not add cloud workers, remote renderers, or external storage.
- Do not bypass `ToolAuthorizationService`.
- Do not bypass workspace sandbox checks.
- Do not render raw HTML from model output.
- Keep `ChatMessageRecord.content` backward compatible.
- Keep Runs as the authoritative deep audit/replay view.
- Cover tables, code blocks, diffs, terminal output, JSON/tool data, citations, file references, artifacts, approvals, guided input, errors, and ledger rows.
- After implementation slices, run focused verification plus `npm run harness:check`; before release claim, run `npm run verify` and `npm run smoke:prod`.

---

## Approved Inputs

- Spec: `docs/superpowers/specs/2026-06-26-zerox-agent-2-9-0-output-rendering-design.md`
- Visual artifact: `/Users/zerox/.gstack/projects/ZeroxZhang-zerox-agent/designs/zerox-agent-2-9-output-rendering-20260626-123139/output-rendering-board.html`
- Feature: `P23-v2.9.0-output-rendering` in `.zerox/feature_list.json`
- Current branch: `codex/2.9.0`

## File Structure

Shared contracts:

- `src/shared/chatOutput.ts`: typed output part union, stream metadata helpers, secret masking, text fallback helpers.
- `src/shared/chat.ts`: persisted `ChatMessageRecord.outputParts`, richer stream events, terminal event completeness.
- `src/shared/chatOutput.test.ts`: output part validation, masking, fallback text, supported formats.
- `src/shared/chatStream.test.ts`: sequence metadata and terminal event coverage.

Main process:

- `src/main/chatOutputAssembler.ts`: convert model text, tool previews, status/evidence, command outputs, citations, and artifacts into `ChatOutputPart[]`.
- `src/main/chatService.ts`: emit sequence-stable output events, persist `outputParts`, keep `content` compatible.
- `src/main/chatSessionStore.ts`: load/save output parts in JSON and SQLite-compatible session payloads.
- `src/main/agentLoop.ts`: provide stable tool invocation ids and terminal completion details to chat service.
- `src/main/chatService.test.ts`: stream, persistence, restore, terminal event, approval/input mapping.
- `src/main/agentLoop.test.ts`: tool invocation identity and finalization behavior.

Renderer:

- `src/renderer/chatMarkdown.ts`: parse markdown tables, block quotes, task lists, and fenced diff/code metadata without raw HTML.
- `src/renderer/chatOutputModel.ts`: normalize live stream events and restored message records into renderable view models.
- `src/renderer/components/chat/AnswerBlock.tsx`: default answer layout and evidence chips.
- `src/renderer/components/chat/OutputPartRenderer.tsx`: route output parts to format components.
- `src/renderer/components/chat/CodeBlockView.tsx`: code block, copy, long collapse, diff mode.
- `src/renderer/components/chat/DataTableView.tsx`: responsive table renderer.
- `src/renderer/components/chat/CommandOutputView.tsx`: command/log renderer.
- `src/renderer/components/chat/JsonPreview.tsx`: structured JSON preview with masking.
- `src/renderer/components/chat/RunLedgerView.tsx`: ledger rows for process/evidence.
- `src/renderer/components/chat/EvidenceRail.tsx`: answer-bound evidence, citations, artifacts, approvals.
- `src/renderer/components/AgentChatPanel.tsx`: integrate answer block and evidence rail while preserving composer and session controls.
- `src/renderer/styles/chat.css`: approved A+B visual treatment, tables, code, diff, terminal, ledger, evidence rail, narrow layout.
- `src/renderer/chatMarkdown.test.ts`: markdown table/code/diff parsing.
- `src/renderer/chatOutputModel.test.ts`: live/restore normalization.
- `src/renderer/materialDesign.test.ts`: rendered structure, CSS class coverage, responsive safety.

Docs and tracking:

- `docs/design/zerox-agent-2-9-0-output-rendering-artifact.html`: repo-local copy of the approved design states used for acceptance.
- `.zerox/feature_list.json`: planned feature metadata and verification commands.
- `.zerox/progress.md`: planning evidence and implementation command evidence.

---

### Task 1: Shared Output Contract

**Files:**
- Create: `src/shared/chatOutput.ts`
- Modify: `src/shared/chat.ts`
- Create: `src/shared/chatOutput.test.ts`
- Modify: `src/shared/chatStream.test.ts`

**Interfaces:**
- Produces: `ChatOutputPart`, `ChatOutputStreamEvent`, `maskPreviewSecrets(value: unknown): unknown`, `outputPartsToPlainText(parts: ChatOutputPart[]): string`
- Consumes: existing `ChatMessageRecord`, `ChatStreamEvent`, `SkillUserInputRequest`, `ChatTaskStatusEvent`

- [ ] **Step 1: Write failing output contract tests**

Create `src/shared/chatOutput.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  maskPreviewSecrets,
  outputPartsToPlainText,
  type ChatOutputPart,
} from "./chatOutput";

describe("chat output parts", () => {
  it("keeps fallback text for tables, code, command output, and citations", () => {
    const parts: ChatOutputPart[] = [
      { id: "p1", type: "text", text: "Result", format: "markdown" },
      {
        id: "t1",
        type: "table",
        caption: "Scores",
        columns: ["Name", "Score"],
        rows: [["A", "9"], ["B", "8"]],
      },
      { id: "c1", type: "code", language: "ts", code: "const ok = true;", title: "example.ts" },
      {
        id: "cmd1",
        type: "command_output",
        command: "npm test",
        cwd: "/repo",
        exitCode: 0,
        stdout: "1 passed",
        stderr: "",
      },
      {
        id: "s1",
        type: "citation",
        citationId: "1",
        label: "Spec",
        sourceTitle: "Design Spec",
        uri: "docs/spec.md",
      },
    ];

    expect(outputPartsToPlainText(parts)).toContain("Result");
    expect(outputPartsToPlainText(parts)).toContain("| Name | Score |");
    expect(outputPartsToPlainText(parts)).toContain("```ts");
    expect(outputPartsToPlainText(parts)).toContain("$ npm test");
    expect(outputPartsToPlainText(parts)).toContain("[1] Design Spec");
  });

  it("masks secret-like JSON fields in previews", () => {
    expect(
      maskPreviewSecrets({
        apiKey: "sk-local-secret",
        nested: { authorization: "Bearer token", count: 3 },
      }),
    ).toEqual({
      apiKey: "****",
      nested: { authorization: "****", count: 3 },
    });
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npm test -- src/shared/chatOutput.test.ts src/shared/chatStream.test.ts
```

Expected: FAIL because `src/shared/chatOutput.ts` does not exist and stream metadata is not required yet.

- [ ] **Step 3: Implement the shared output part union**

Create `src/shared/chatOutput.ts` with:

```ts
export type ChatOutputPartBase = {
  id: string;
  evidenceRefs?: string[];
  createdAt?: string;
};

export type ChatTextPart = ChatOutputPartBase & {
  type: "text";
  text: string;
  format: "plain" | "markdown";
};

export type ChatTablePart = ChatOutputPartBase & {
  type: "table";
  columns: string[];
  rows: string[][];
  caption?: string;
};

export type ChatCodePart = ChatOutputPartBase & {
  type: "code";
  code: string;
  language?: string;
  title?: string;
};

export type ChatDiffPart = ChatOutputPartBase & {
  type: "file_diff";
  filePath?: string;
  patch: string;
  additions?: number;
  deletions?: number;
};

export type ChatCommandOutputPart = ChatOutputPartBase & {
  type: "command_output";
  command: string;
  cwd?: string;
  exitCode?: number;
  stdout: string;
  stderr: string;
  elapsedMs?: number;
};

export type ChatToolCallPart = ChatOutputPartBase & {
  type: "tool_call";
  toolCallId: string;
  toolName: string;
  toolSource?: string;
  argsPreview?: unknown;
};

export type ChatToolResultPart = ChatOutputPartBase & {
  type: "tool_result";
  toolCallId: string;
  ok: boolean;
  resultPreview?: unknown;
  error?: string;
};

export type ChatFileRefPart = ChatOutputPartBase & {
  type: "file_ref";
  path: string;
  label?: string;
  action: "read" | "wrote" | "changed" | "generated";
};

export type ChatArtifactPart = ChatOutputPartBase & {
  type: "artifact";
  artifactId: string;
  title: string;
  path?: string;
  mediaType?: string;
  sizeBytes?: number;
};

export type ChatCitationPart = ChatOutputPartBase & {
  type: "citation";
  citationId: string;
  label: string;
  sourceTitle: string;
  uri?: string;
  path?: string;
};

export type ChatApprovalPart = ChatOutputPartBase & {
  type: "approval_request";
  approvalId: string;
  toolName: string;
  riskLevel: "low" | "medium" | "high";
  argsPreview?: unknown;
};

export type ChatInputRequestPart = ChatOutputPartBase & {
  type: "input_request";
  inputRequestId: string;
  skillName: string;
  reason: string;
  fields: Array<{ name: string; label: string; required: boolean; type: string }>;
};

export type ChatDiagnosticPart = ChatOutputPartBase & {
  type: "diagnostic";
  severity: "info" | "warning" | "error";
  title: string;
  message: string;
  relatedToolCallId?: string;
};

export type ChatLedgerEventPart = ChatOutputPartBase & {
  type: "ledger_event";
  status: "running" | "waiting" | "completed" | "failed" | "canceled";
  title: string;
  detail?: string;
  toolName?: string;
};

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

Add `maskPreviewSecrets()` and `outputPartsToPlainText()` in the same file:

```ts
const SECRET_FIELD_PATTERN = /(token|key|secret|password|authorization)/i;

export function maskPreviewSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => maskPreviewSecrets(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        SECRET_FIELD_PATTERN.test(key) ? "****" : maskPreviewSecrets(item),
      ]),
    );
  }
  return value;
}

export function outputPartsToPlainText(parts: ChatOutputPart[]): string {
  return parts
    .map((part) => {
      switch (part.type) {
        case "text":
          return part.text;
        case "table":
          return [
            part.caption,
            `| ${part.columns.join(" | ")} |`,
            `| ${part.columns.map(() => "---").join(" | ")} |`,
            ...part.rows.map((row) => `| ${row.join(" | ")} |`),
          ]
            .filter(Boolean)
            .join("\n");
        case "code":
          return `\`\`\`${part.language ?? ""}\n${part.code}\n\`\`\``;
        case "file_diff":
          return `\`\`\`diff\n${part.patch}\n\`\`\``;
        case "command_output":
          return [`$ ${part.command}`, part.stdout, part.stderr].filter(Boolean).join("\n");
        case "citation":
          return `[${part.citationId}] ${part.sourceTitle}`;
        case "diagnostic":
          return `${part.title}\n${part.message}`;
        case "ledger_event":
          return `${part.title}${part.detail ? `: ${part.detail}` : ""}`;
        default:
          return "";
      }
    })
    .filter(Boolean)
    .join("\n\n");
}
```

- [ ] **Step 4: Extend chat records and stream metadata**

In `src/shared/chat.ts`, import the new type and update records:

```ts
import type { ChatOutputPart } from "./chatOutput";
```

Extend `ChatMessageRecord`:

```ts
export type ChatMessageRecord = ChatHistoryMessage & {
  id: string;
  createdAt: string;
  outputParts?: ChatOutputPart[];
  relatedMemoryIds?: string[];
  executedRunId?: string;
  goalId?: string;
  goalEventRef?: string;
};
```

Extend `ChatStreamEventBase`:

```ts
type ChatStreamEventBase = {
  sessionId: string;
  requestId: string;
  sequence: number;
  turnId: string;
  assistantMessageId?: string;
  createdAt: string;
};
```

Add a typed output event variant:

```ts
| (ChatStreamEventBase & {
    type: "output_part";
    part: ChatOutputPart;
  })
```

Update the terminal variant:

```ts
| (ChatStreamEventBase & {
    type: "completed" | "failed" | "canceled";
    finalMessageId?: string;
    message?: string;
  });
```

- [ ] **Step 5: Run contract tests and verify GREEN**

Run:

```bash
npm test -- src/shared/chatOutput.test.ts src/shared/chatStream.test.ts
```

Expected: PASS.

---

### Task 2: Main-Process Assembly, Streaming, And Persistence

**Files:**
- Create: `src/main/chatOutputAssembler.ts`
- Modify: `src/main/chatService.ts`
- Modify: `src/main/chatSessionStore.ts`
- Modify: `src/main/agentLoop.ts`
- Modify: `src/main/chatService.test.ts`
- Modify: `src/main/agentLoop.test.ts`

**Interfaces:**
- Consumes: `ChatOutputPart`, `maskPreviewSecrets`, existing agent-loop model/tool events.
- Produces: sequence-stable `output_part` stream events and persisted `ChatMessageRecord.outputParts`.

- [ ] **Step 1: Write failing assembler tests in `src/main/chatService.test.ts`**

Add a test that sends a chat turn with a tool preview, command-like result, and final answer, then asserts terminal completion and persisted output parts:

```ts
it("emits sequence-stable output parts and persists them with the final assistant message", async () => {
  const events: ChatStreamEvent[] = [];
  const service = createTestChatService({
    onStreamEvent: (event) => events.push(event),
    modelEvents: [
      { type: "text_delta", text: "Here is the result." },
      {
        type: "tool_call_delta",
        toolCallId: "tool-1",
        toolName: "test_run",
        argumentsDelta: "{\"command\":\"npm test\",\"apiKey\":\"secret\"}",
      },
      { type: "done" },
    ],
  });

  const result = await service.sendMessage({ message: "run tests" });

  expect(result.session.messages.at(-1)?.outputParts?.map((part) => part.type)).toContain("text");
  expect(result.session.messages.at(-1)?.outputParts?.map((part) => part.type)).toContain("tool_call");
  expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index + 1));
  expect(events.at(-1)).toMatchObject({ type: "completed", finalMessageId: result.session.messages.at(-1)?.id });
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npm test -- src/main/chatService.test.ts src/main/agentLoop.test.ts
```

Expected: FAIL because `outputParts`, sequence metadata, and terminal stream completion are not wired.

- [ ] **Step 3: Add the output assembler**

Create `src/main/chatOutputAssembler.ts`:

```ts
import {
  maskPreviewSecrets,
  type ChatOutputPart,
  type ChatToolCallPart,
} from "../shared/chatOutput";

export type ChatOutputAssembler = {
  appendText(text: string): ChatOutputPart | undefined;
  appendToolCall(input: {
    toolCallId: string;
    toolName?: string;
    toolSource?: string;
    argumentsText?: string;
  }): ChatToolCallPart;
  parts(): ChatOutputPart[];
};

export function createChatOutputAssembler(now = () => new Date().toISOString()): ChatOutputAssembler {
  const parts: ChatOutputPart[] = [];
  let textBuffer = "";

  return {
    appendText(text) {
      textBuffer += text;
      const existing = parts.find((part) => part.type === "text") as ChatOutputPart | undefined;
      if (existing?.type === "text") {
        existing.text = textBuffer;
        return existing;
      }
      const part: ChatOutputPart = {
        id: `text-${parts.length + 1}`,
        type: "text",
        text: textBuffer,
        format: "markdown",
        createdAt: now(),
      };
      parts.push(part);
      return part;
    },
    appendToolCall(input) {
      let argsPreview: unknown = input.argumentsText ?? "";
      try {
        argsPreview = input.argumentsText ? JSON.parse(input.argumentsText) : {};
      } catch {
        argsPreview = input.argumentsText ?? "";
      }
      const part: ChatToolCallPart = {
        id: `tool-${input.toolCallId}`,
        type: "tool_call",
        toolCallId: input.toolCallId,
        toolName: input.toolName ?? "tool",
        toolSource: input.toolSource,
        argsPreview: maskPreviewSecrets(argsPreview),
        createdAt: now(),
      };
      parts.push(part);
      return part;
    },
    parts() {
      return parts;
    },
  };
}
```

- [ ] **Step 4: Wire sequence metadata and terminal events in chat service**

In `src/main/chatService.ts`, create per-request sequence helpers:

```ts
let sequence = 0;
const turnId = `turn-${requestId}`;
const nextStreamBase = () => ({
  sessionId,
  requestId,
  sequence: ++sequence,
  turnId,
  assistantMessageId,
  createdAt: new Date().toISOString(),
});
```

Use `createChatOutputAssembler()` for answer deltas and tool previews. Emit both the legacy delta event and the new output part event:

```ts
const textPart = outputAssembler.appendText(delta.text);
if (textPart) {
  emitStreamEvent({ ...nextStreamBase(), type: "output_part", part: textPart });
}
```

At successful completion, persist:

```ts
const outputParts = outputAssembler.parts();
const assistantMessage: ChatMessageRecord = {
  id: assistantMessageId,
  role: "assistant",
  content: reply,
  outputParts,
  createdAt: completedAt,
};
```

Emit terminal completion:

```ts
emitStreamEvent({
  ...nextStreamBase(),
  type: "completed",
  finalMessageId: assistantMessage.id,
  message: reply,
});
```

On failure and cancellation, emit `failed` or `canceled` with the same sequence helper.

- [ ] **Step 5: Preserve output parts in session storage**

In `src/main/chatSessionStore.ts`, keep `outputParts` during session serialization and hydration by treating it as part of `ChatMessageRecord`. Add a defensive normalization branch:

```ts
function normalizeMessageRecord(message: ChatMessageRecord): ChatMessageRecord {
  return {
    ...message,
    outputParts: Array.isArray(message.outputParts) ? message.outputParts : undefined,
  };
}
```

Apply this normalizer wherever sessions are loaded from persisted JSON/SQLite records.

- [ ] **Step 6: Run main-process tests and verify GREEN**

Run:

```bash
npm test -- src/main/chatService.test.ts src/main/agentLoop.test.ts
```

Expected: PASS.

---

### Task 3: Markdown, Table, Code, And Diff Model

**Files:**
- Modify: `src/renderer/chatMarkdown.ts`
- Modify: `src/renderer/chatMarkdown.test.ts`
- Create: `src/renderer/chatOutputModel.ts`
- Create: `src/renderer/chatOutputModel.test.ts`

**Interfaces:**
- Consumes: `ChatOutputPart`, `ChatMessageRecord`, live `ChatStreamEvent`.
- Produces: `RenderedOutputPart[]` for React components.

- [ ] **Step 1: Add failing markdown tests for table, blockquote, task list, and diff**

In `src/renderer/chatMarkdown.test.ts`, add:

```ts
it("parses markdown tables into table blocks", () => {
  expect(parseChatMarkdown("| Name | Score |\n| --- | --- |\n| A | 9 |")).toEqual([
    {
      type: "table",
      columns: ["Name", "Score"],
      rows: [["A", "9"]],
      caption: undefined,
    },
  ]);
});

it("preserves diff language metadata for fenced blocks", () => {
  expect(parseChatMarkdown("```diff\n+added\n-removed\n```")).toEqual([
    { type: "code", language: "diff", code: "+added\n-removed" },
  ]);
});

it("parses block quotes and task list items without raw HTML", () => {
  const blocks = parseChatMarkdown("> note\n\n- [x] done\n- [ ] next");
  expect(blocks[0]?.type).toBe("blockquote");
  expect(blocks[1]?.type).toBe("list");
});
```

- [ ] **Step 2: Run renderer model tests and verify RED**

Run:

```bash
npm test -- src/renderer/chatMarkdown.test.ts src/renderer/chatOutputModel.test.ts
```

Expected: FAIL because table, blockquote, task-list, and output model support do not exist.

- [ ] **Step 3: Extend markdown block types**

In `src/renderer/chatMarkdown.ts`, extend the exported block union:

```ts
export type ChatMarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: Array<{ text: string; checked?: boolean }> }
  | { type: "code"; language?: string; code: string }
  | { type: "table"; columns: string[]; rows: string[][]; caption?: string }
  | { type: "blockquote"; text: string };
```

Add a table detector before paragraph flushing:

```ts
function parseTable(lines: string[], startIndex: number): { block: ChatMarkdownBlock; nextIndex: number } | undefined {
  const header = lines[startIndex];
  const divider = lines[startIndex + 1];
  if (!header?.includes("|") || !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(divider ?? "")) {
    return undefined;
  }

  const splitRow = (line: string) =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());

  const columns = splitRow(header);
  const rows: string[][] = [];
  let index = startIndex + 2;
  while (index < lines.length && lines[index]?.includes("|")) {
    rows.push(splitRow(lines[index]));
    index += 1;
  }

  return { block: { type: "table", columns, rows, caption: undefined }, nextIndex: index };
}
```

Add blockquote and task-list handling while keeping raw HTML as plain text.

- [ ] **Step 4: Create output model normalization**

Create `src/renderer/chatOutputModel.ts`:

```ts
import type { ChatMessageRecord, ChatStreamEvent } from "../shared/chat";
import type { ChatOutputPart } from "../shared/chatOutput";

export type RenderedOutputPart = ChatOutputPart & {
  renderKey: string;
  source: "persisted" | "stream";
};

export function outputPartsFromMessage(message: ChatMessageRecord): RenderedOutputPart[] {
  if (message.outputParts?.length) {
    return message.outputParts.map((part) => ({
      ...part,
      renderKey: `${message.id}:${part.id}`,
      source: "persisted",
    }));
  }
  return [
    {
      id: `${message.id}:text`,
      type: "text",
      text: message.content,
      format: "markdown",
      renderKey: `${message.id}:text`,
      source: "persisted",
    },
  ];
}

export function outputPartFromStreamEvent(event: ChatStreamEvent): RenderedOutputPart | undefined {
  if (event.type !== "output_part") {
    return undefined;
  }
  return {
    ...event.part,
    renderKey: `${event.requestId}:${event.sequence}:${event.part.id}`,
    source: "stream",
  };
}
```

Create `src/renderer/chatOutputModel.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { outputPartFromStreamEvent, outputPartsFromMessage } from "./chatOutputModel";

describe("chat output model", () => {
  it("falls back to markdown text for old messages", () => {
    expect(
      outputPartsFromMessage({
        id: "m1",
        role: "assistant",
        content: "plain",
        createdAt: "2026-06-26T00:00:00.000Z",
      }),
    ).toMatchObject([{ type: "text", text: "plain", source: "persisted" }]);
  });

  it("converts output_part stream events into render parts", () => {
    expect(
      outputPartFromStreamEvent({
        type: "output_part",
        sessionId: "s1",
        requestId: "r1",
        sequence: 1,
        turnId: "turn-r1",
        createdAt: "2026-06-26T00:00:00.000Z",
        part: { id: "p1", type: "text", text: "hello", format: "markdown" },
      }),
    ).toMatchObject({ renderKey: "r1:1:p1", source: "stream" });
  });
});
```

- [ ] **Step 5: Run renderer model tests and verify GREEN**

Run:

```bash
npm test -- src/renderer/chatMarkdown.test.ts src/renderer/chatOutputModel.test.ts
```

Expected: PASS.

---

### Task 4: Format-Specific React Renderers

**Files:**
- Create: `src/renderer/components/chat/AnswerBlock.tsx`
- Create: `src/renderer/components/chat/OutputPartRenderer.tsx`
- Create: `src/renderer/components/chat/CodeBlockView.tsx`
- Create: `src/renderer/components/chat/DataTableView.tsx`
- Create: `src/renderer/components/chat/CommandOutputView.tsx`
- Create: `src/renderer/components/chat/JsonPreview.tsx`
- Create: `src/renderer/components/chat/RunLedgerView.tsx`
- Create: `src/renderer/components/chat/EvidenceRail.tsx`
- Modify: `src/renderer/components/AgentChatPanel.tsx`
- Modify: `src/renderer/materialDesign.test.ts`

**Interfaces:**
- Consumes: `RenderedOutputPart[]`, `ChatOutputPart`, existing approval and guided-input callbacks.
- Produces: answer-bound output UI with format-specific components.

- [ ] **Step 1: Add failing material tests for supported renderers**

In `src/renderer/materialDesign.test.ts`, add source checks:

```ts
it("renders typed output formats through dedicated chat components", () => {
  const files = [
    "src/renderer/components/chat/AnswerBlock.tsx",
    "src/renderer/components/chat/OutputPartRenderer.tsx",
    "src/renderer/components/chat/CodeBlockView.tsx",
    "src/renderer/components/chat/DataTableView.tsx",
    "src/renderer/components/chat/CommandOutputView.tsx",
    "src/renderer/components/chat/JsonPreview.tsx",
    "src/renderer/components/chat/RunLedgerView.tsx",
    "src/renderer/components/chat/EvidenceRail.tsx",
  ];

  for (const file of files) {
    expect(fs.existsSync(path.join(projectRoot, file))).toBe(true);
  }

  const outputRenderer = fs.readFileSync(
    path.join(projectRoot, "src/renderer/components/chat/OutputPartRenderer.tsx"),
    "utf8",
  );
  expect(outputRenderer).toContain('case "table"');
  expect(outputRenderer).toContain('case "code"');
  expect(outputRenderer).toContain('case "file_diff"');
  expect(outputRenderer).toContain('case "command_output"');
  expect(outputRenderer).toContain('case "tool_call"');
  expect(outputRenderer).toContain('case "citation"');
  expect(outputRenderer).toContain('case "approval_request"');
});
```

- [ ] **Step 2: Run material tests and verify RED**

Run:

```bash
npm test -- src/renderer/materialDesign.test.ts
```

Expected: FAIL because the new components do not exist.

- [ ] **Step 3: Create format components**

Create `src/renderer/components/chat/DataTableView.tsx`:

```tsx
import type { ChatTablePart } from "../../../shared/chatOutput";

export function DataTableView({ part }: { part: ChatTablePart }) {
  return (
    <div className="chat-data-table-wrap">
      {part.caption ? <div className="chat-data-table-caption">{part.caption}</div> : null}
      <table className="chat-data-table">
        <thead>
          <tr>{part.columns.map((column) => <th key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>
          {part.rows.map((row, rowIndex) => (
            <tr key={`${part.id}-row-${rowIndex}`}>
              {part.columns.map((column, columnIndex) => (
                <td key={`${column}-${columnIndex}`}>{row[columnIndex] || <span className="muted">—</span>}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

Create `CodeBlockView.tsx`, `CommandOutputView.tsx`, `JsonPreview.tsx`, `RunLedgerView.tsx`, and `EvidenceRail.tsx` using the class names from Task 5. `CodeBlockView` handles `code` and `file_diff`; `JsonPreview` renders masked JSON from shared data; `RunLedgerView` renders `ledger_event`; `EvidenceRail` groups citations, artifacts, files, approvals, and diagnostics.

- [ ] **Step 4: Route output parts**

Create `src/renderer/components/chat/OutputPartRenderer.tsx`:

```tsx
import type { ChatOutputPart } from "../../../shared/chatOutput";
import { CodeBlockView } from "./CodeBlockView";
import { CommandOutputView } from "./CommandOutputView";
import { DataTableView } from "./DataTableView";
import { JsonPreview } from "./JsonPreview";
import { RunLedgerView } from "./RunLedgerView";

export function OutputPartRenderer({ part }: { part: ChatOutputPart }) {
  switch (part.type) {
    case "text":
      return <div className="chat-answer-markdown">{part.text}</div>;
    case "table":
      return <DataTableView part={part} />;
    case "code":
    case "file_diff":
      return <CodeBlockView part={part} />;
    case "command_output":
      return <CommandOutputView part={part} />;
    case "tool_call":
    case "tool_result":
      return <JsonPreview title={part.type === "tool_call" ? part.toolName : "Tool result"} value={part} />;
    case "citation":
      return <span className="chat-citation-chip">[{part.citationId}] {part.label}</span>;
    case "approval_request":
      return <div className="chat-approval-block">{part.toolName}</div>;
    case "input_request":
      return <div className="chat-input-request-block">{part.skillName}</div>;
    case "diagnostic":
      return <div className={`chat-diagnostic chat-diagnostic-${part.severity}`}>{part.title}</div>;
    case "ledger_event":
      return <RunLedgerView part={part} />;
    case "file_ref":
    case "artifact":
      return <div className="chat-artifact-card">{part.type === "file_ref" ? part.path : part.title}</div>;
  }
}
```

- [ ] **Step 5: Integrate `AnswerBlock` into `AgentChatPanel`**

Create `AnswerBlock.tsx`:

```tsx
import type { RenderedOutputPart } from "../../chatOutputModel";
import { EvidenceRail } from "./EvidenceRail";
import { OutputPartRenderer } from "./OutputPartRenderer";

export function AnswerBlock({ parts }: { parts: RenderedOutputPart[] }) {
  return (
    <article className="chat-answer-block">
      <div className="chat-answer-body">
        {parts.map((part) => <OutputPartRenderer key={part.renderKey} part={part} />)}
      </div>
      <EvidenceRail parts={parts} />
    </article>
  );
}
```

In `AgentChatPanel.tsx`, replace assistant markdown rendering with `AnswerBlock` for assistant messages:

```tsx
<AnswerBlock parts={outputPartsFromMessage(message)} />
```

- [ ] **Step 6: Run renderer tests and verify GREEN**

Run:

```bash
npm test -- src/renderer/materialDesign.test.ts src/renderer/chatOutputModel.test.ts
```

Expected: PASS.

---

### Task 5: Approved Visual Styling And Responsive Safety

**Files:**
- Modify: `src/renderer/styles/chat.css`
- Modify: `src/renderer/styles/tokens.css`
- Modify: `src/renderer/materialDesign.test.ts`
- Create: `docs/design/zerox-agent-2-9-0-output-rendering-artifact.html`

**Interfaces:**
- Consumes: class names from Task 4.
- Produces: approved A+B visual treatment and repo-local design artifact.

- [ ] **Step 1: Add failing style coverage**

In `src/renderer/materialDesign.test.ts`, add:

```ts
it("defines output rendering styles for the approved v2.9 A+B direction", () => {
  const css = fs.readFileSync(path.join(projectRoot, "src/renderer/styles/chat.css"), "utf8");
  for (const className of [
    ".chat-answer-block",
    ".chat-answer-body",
    ".chat-evidence-rail",
    ".chat-data-table-wrap",
    ".chat-code-block",
    ".chat-diff-line-added",
    ".chat-diff-line-removed",
    ".chat-command-output",
    ".chat-json-preview",
    ".chat-ledger-row",
    ".chat-artifact-card",
    ".chat-citation-chip",
    ".chat-approval-block",
    ".chat-input-request-block",
  ]) {
    expect(css).toContain(className);
  }
});
```

- [ ] **Step 2: Run style test and verify RED**

Run:

```bash
npm test -- src/renderer/materialDesign.test.ts -t "v2.9 A+B"
```

Expected: FAIL because v2.9 output rendering classes are missing.

- [ ] **Step 3: Add CSS for the output system**

Append focused styles to `src/renderer/styles/chat.css`:

```css
.chat-answer-block {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(220px, 28%);
  gap: 16px;
  align-items: start;
}

.chat-answer-body {
  min-width: 0;
  color: var(--text-primary);
  line-height: 1.62;
}

.chat-evidence-rail {
  border-left: 1px solid var(--border-subtle);
  padding-left: 14px;
  color: var(--text-secondary);
}

.chat-data-table-wrap {
  max-width: 100%;
  overflow-x: auto;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
}

.chat-data-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 420px;
  font-size: 0.88rem;
}

.chat-data-table th,
.chat-data-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-subtle);
  text-align: left;
  vertical-align: top;
}

.chat-code-block,
.chat-command-output,
.chat-json-preview {
  max-width: 100%;
  overflow: auto;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--surface-raised);
}

.chat-diff-line-added {
  color: var(--success-strong);
}

.chat-diff-line-removed {
  color: var(--danger-strong);
}

.chat-ledger-row {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: start;
}

.chat-artifact-card,
.chat-approval-block,
.chat-input-request-block {
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  padding: 10px 12px;
  background: var(--surface);
}

.chat-citation-chip {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
  padding: 1px 7px;
  font-size: 0.78rem;
  color: var(--text-secondary);
}

@media (max-width: 860px) {
  .chat-answer-block {
    grid-template-columns: minmax(0, 1fr);
  }

  .chat-evidence-rail {
    border-left: 0;
    padding-left: 0;
  }
}
```

Add token aliases to `src/renderer/styles/tokens.css` only when missing:

```css
--success-strong: #1f7a4d;
--danger-strong: #b42318;
```

- [ ] **Step 4: Add repo-local design artifact**

Create `docs/design/zerox-agent-2-9-0-output-rendering-artifact.html` with static states for:

- default evidence-linked answer
- run ledger answer
- table-heavy answer
- code/diff answer
- terminal output answer
- document report answer
- approval waiting state
- guided input state
- error diagnostic state
- narrow layout state

- [ ] **Step 5: Run style tests and verify GREEN**

Run:

```bash
npm test -- src/renderer/materialDesign.test.ts
```

Expected: PASS.

---

### Task 6: Restore Fidelity, QA, And Release Gates

**Files:**
- Modify: `src/renderer/components/AgentChatPanel.tsx`
- Modify: `src/main/chatService.test.ts`
- Modify: `src/renderer/chatOutputModel.test.ts`
- Modify: `src/shared/packageScripts.test.ts`
- Modify: `src/shared/readme.test.ts`
- Modify: `README.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.zerox/progress.md`

**Interfaces:**
- Consumes: completed typed output and renderer work.
- Produces: verified 2.9.0 release claim, progress evidence, and package metadata.

- [ ] **Step 1: Add restore-fidelity tests**

In `src/renderer/chatOutputModel.test.ts`, add:

```ts
it("restores mixed output formats from persisted assistant messages", () => {
  const parts = outputPartsFromMessage({
    id: "m2",
    role: "assistant",
    content: "summary",
    createdAt: "2026-06-26T00:00:00.000Z",
    outputParts: [
      { id: "text-1", type: "text", text: "summary", format: "markdown" },
      { id: "table-1", type: "table", columns: ["A"], rows: [["1"]] },
      { id: "code-1", type: "code", language: "ts", code: "const x = 1;" },
      { id: "ledger-1", type: "ledger_event", status: "completed", title: "Verified" },
    ],
  });

  expect(parts.map((part) => part.type)).toEqual(["text", "table", "code", "ledger_event"]);
  expect(parts.every((part) => part.source === "persisted")).toBe(true);
});
```

- [ ] **Step 2: Run restore tests and verify RED or GREEN**

Run:

```bash
npm test -- src/renderer/chatOutputModel.test.ts src/main/chatService.test.ts
```

Expected: PASS after Tasks 1-5. A failure here means live and restored output paths diverged and must be fixed in the previous task files.

- [ ] **Step 3: Update release metadata tests**

Update `src/shared/packageScripts.test.ts` and `src/shared/readme.test.ts` so they expect version `2.9.0`, the output rendering feature summary, and command coverage.

- [ ] **Step 4: Update package metadata and README**

Set `package.json` and `package-lock.json` version to `2.9.0`. Update `README.md` current release notes with:

```md
### v2.9.0 - Output Rendering And Evidence-Bound Answers

- Adds typed output rendering for tables, code blocks, diffs, terminal output, JSON/tool previews, citations, artifacts, approvals, guided input, diagnostics, and run ledger rows.
- Preserves local-first execution, explicit permissions, workspace sandbox checks, recoverable sessions, and reviewed learning.
- Keeps plain text chat content backward compatible while restoring richer output parts for new sessions.
```

- [ ] **Step 5: Run focused verification**

Run:

```bash
npm test -- src/shared/chatOutput.test.ts src/shared/chatStream.test.ts src/main/chatService.test.ts src/main/agentLoop.test.ts src/renderer/chatMarkdown.test.ts src/renderer/chatOutputModel.test.ts src/renderer/materialDesign.test.ts src/shared/packageScripts.test.ts src/shared/readme.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run full verification gates**

Run:

```bash
npm test
npm run build
npm run verify
npm run smoke:prod
npm run harness:check
git diff --check
```

Expected: all PASS.

- [ ] **Step 7: Update Zerox progress evidence**

Append a 2026-06-26 v2.9.0 section to `.zerox/progress.md` with:

- changed files
- RED evidence
- GREEN evidence
- rendered QA evidence
- packaging evidence when package artifacts are created

Use exact command outputs and screenshot paths from the execution environment.
