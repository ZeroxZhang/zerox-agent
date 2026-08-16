import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ChatSessionListItem } from "../shared/chat";
import type { MemoryInput, MemoryRecord } from "../shared/memory";
import type { RawHistoryEntry } from "../shared/rawHistory";
import { createMemoryIngestionService } from "./memoryIngestionService";

describe("MemoryIngestionService", () => {
  it("keeps ingestion status visible while a job continues across page switches", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zerox-memory-ingest-"));
    let releaseModel!: () => void;
    const modelGate = new Promise<void>((resolve) => {
      releaseModel = resolve;
    });
    const service = createMemoryIngestionService({
      configDir: tempDir,
      historyIndexStore: {
        list: async () => [
          historyEntry({
            id: "message_1",
            sessionId: "session_active",
            content: "以后默认先给我明确验收标准。",
          }),
        ],
      },
      chatSessionStore: { list: async () => [chatSession("session_active")] },
      memoryStore: {
        async create(input) {
          return {
            id: "memory_1",
            ...input,
            kind: "semantic",
            tags: input.tags ?? [],
            source: input.source ?? { type: "manual" },
            importance: input.importance ?? 3,
            createdAt: "2026-07-05T02:00:00.000Z",
            updatedAt: "2026-07-05T02:00:00.000Z",
          } as MemoryRecord;
        },
      },
      chatClient: {
        async complete() {
          await modelGate;
          return {
            content: JSON.stringify([
              {
                title: "目标验收习惯",
                content: "用户希望目标先被翻译成可度量的验收标准。",
                confidence: 0.8,
                evidenceMessageIds: ["message_1"],
              },
            ]),
            toolCalls: [],
            finishReason: "stop",
          };
        },
      },
      getModelProfile: async () => ({
        baseUrl: "http://localhost",
        apiKey: "test",
        model: "test",
        temperature: 0,
        maxTokens: 2000,
      }),
      now: () => new Date("2026-07-05T02:00:00.000Z"),
      createId: () => "candidate_1",
    });

    try {
      const job = service.ingestRecent();
      const runningStatus = await service.getStatus();
      expect(runningStatus.ok).toBe(true);
      if (!runningStatus.ok) return;
      expect(runningStatus.status.running).toBe(true);
      expect(runningStatus.status.message).toContain("正在摄取");

      const duplicateJob = service.ingestRecent();
      expect(duplicateJob).toBe(job);
      releaseModel();
      const result = await job;
      expect(result.ok).toBe(true);

      const completedStatus = await service.getStatus();
      expect(completedStatus.ok).toBe(true);
      if (!completedStatus.ok) return;
      expect(completedStatus.status.running).toBe(false);
      expect(completedStatus.status.report?.createdCandidates).toBe(1);
    } finally {
      releaseModel();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("uses the user's dominant language for ingestion candidates", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zerox-memory-ingest-"));
    const service = createMemoryIngestionService({
      configDir: tempDir,
      historyIndexStore: {
        list: async () => [
          historyEntry({
            id: "message_1",
            sessionId: "session_active",
            content: "以后请默认用中文总结目标，并且先写清楚验收标准。",
          }),
          historyEntry({
            id: "message_2",
            sessionId: "session_active",
            content: "不是泛泛描述，我需要可以度量、可以判断是否完成。",
          }),
        ],
      },
      chatSessionStore: { list: async () => [chatSession("session_active")] },
      memoryStore: {
        async create(input) {
          return {
            id: "memory_1",
            ...input,
            kind: "semantic",
            tags: input.tags ?? [],
            source: input.source ?? { type: "manual" },
            importance: input.importance ?? 3,
            createdAt: "2026-07-05T02:00:00.000Z",
            updatedAt: "2026-07-05T02:00:00.000Z",
          } as MemoryRecord;
        },
      },
      chatClient: {
        async complete(request) {
          expect(request.messages[0].content).toContain("Simplified Chinese");
          return {
            content: JSON.stringify([
              {
                title: "Strict Goal Acceptance Criteria",
                content:
                  "The user prefers measurable acceptance criteria before execution.",
                rationale:
                  "The user repeatedly corrected vague goal descriptions.",
                confidence: 0.92,
                tags: ["goal", "preference"],
                evidenceMessageIds: ["message_1", "message_2"],
              },
            ]),
            toolCalls: [],
            finishReason: "stop",
          };
        },
      },
      getModelProfile: async () => ({
        baseUrl: "http://localhost",
        apiKey: "test",
        model: "test",
        temperature: 0,
        maxTokens: 2000,
      }),
      now: () => new Date("2026-07-05T02:00:00.000Z"),
      createId: () => "candidate_1",
    });

    try {
      const result = await service.ingestRecent();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.report.candidates[0].title).toContain("目标");
      expect(result.report.candidates[0].title).not.toContain("Strict");
      expect(result.report.candidates[0].draftMemory.content).toContain("用户近期");
      expect(result.report.candidates[0].draftMemory.content).toContain("中文");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("creates evidence-backed candidates, collapses duplicate titles, and respects scope", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zerox-memory-ingest-"));
    const entries = [
      historyEntry({
        id: "message_1",
        sessionId: "session_active",
        workspaceId: "workspace_a",
        content: "以后默认先给我明确验收标准。",
      }),
      historyEntry({
        id: "message_2",
        sessionId: "session_active",
        workspaceId: "workspace_a",
        content: "不是泛泛描述，目标要可以度量。",
      }),
      historyEntry({
        id: "message_archived",
        sessionId: "session_archived",
        workspaceId: "workspace_a",
        content: "这个归档会话不应进入摄取。",
      }),
      historyEntry({
        id: "message_other_workspace",
        sessionId: "session_other",
        workspaceId: "workspace_b",
        content: "其他工作区不应进入摄取。",
      }),
    ];
    const writtenMemories: MemoryInput[] = [];
    const service = createMemoryIngestionService({
      configDir: tempDir,
      historyIndexStore: { list: async () => entries },
      chatSessionStore: {
        list: async () => [
          chatSession("session_active"),
          chatSession("session_archived", "2026-07-05T01:00:00.000Z"),
          chatSession("session_other"),
        ],
      },
      memoryStore: {
        async create(input) {
          writtenMemories.push(input);
          return {
            id: "memory_1",
            ...input,
            kind: "semantic",
            tags: input.tags ?? [],
            source: input.source ?? { type: "manual" },
            importance: input.importance ?? 3,
            createdAt: "2026-07-05T02:00:00.000Z",
            updatedAt: "2026-07-05T02:00:00.000Z",
          } as MemoryRecord;
        },
      },
      chatClient: {
        async complete() {
          return {
            content: JSON.stringify([
              {
                title: "目标验收习惯",
                content: "用户希望目标先被翻译成可度量的验收标准。",
                rationale: "近期反复强调目标需要清晰、可度量。",
                confidence: 0.86,
                tags: ["goal"],
                evidenceMessageIds: ["message_1", "message_2"],
              },
              {
                title: "目标验收习惯",
                content: "重复标题应折叠。",
                rationale: "duplicate",
                confidence: 0.8,
                evidenceMessageIds: ["message_1"],
              },
              {
                title: "无证据候选",
                content: "没有证据不能进入候选箱。",
                confidence: 0.7,
                evidenceMessageIds: ["missing_message"],
              },
            ]),
            toolCalls: [],
            finishReason: "stop",
          };
        },
      },
      getModelProfile: async () => ({
        baseUrl: "http://localhost",
        apiKey: "test",
        model: "test",
        temperature: 0,
        maxTokens: 2000,
      }),
      now: () => new Date("2026-07-05T02:00:00.000Z"),
      createId: () => `candidate_${Math.random().toString(16).slice(2)}`,
    });

    try {
      const result = await service.ingestRecent({ workspaceId: "workspace_a" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.report.scannedSessions).toBe(1);
      expect(result.report.scannedMessages).toBe(2);
      expect(result.report.createdCandidates).toBe(1);
      expect(result.report.duplicateCandidates).toBe(1);
      expect(result.report.skippedCandidates).toBe(1);

      const listResult = await service.listCandidates();
      expect(listResult.ok).toBe(true);
      if (!listResult.ok) return;
      expect(listResult.candidates).toHaveLength(1);
      expect(listResult.candidates[0].draftMemory.layer).toBe("ingested_habit");
      expect(listResult.candidates[0].draftMemory.source?.type).toBe(
        "memory_ingestion",
      );

      const acceptResult = await service.acceptCandidate(listResult.candidates[0].id);
      expect(acceptResult.ok).toBe(true);
      expect(writtenMemories).toHaveLength(1);
      expect(writtenMemories[0].layer).toBe("ingested_habit");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejecting a candidate writes no memory", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zerox-memory-ingest-"));
    const writtenMemories: MemoryInput[] = [];
    const service = createMemoryIngestionService({
      configDir: tempDir,
      historyIndexStore: {
        list: async () => [
          historyEntry({
            id: "message_1",
            sessionId: "session_active",
            content: "以后默认先总结风险。",
          }),
        ],
      },
      chatSessionStore: { list: async () => [chatSession("session_active")] },
      memoryStore: {
        async create(input) {
          writtenMemories.push(input);
          throw new Error("reject should not write");
        },
      },
      chatClient: {
        async complete() {
          return {
            content: JSON.stringify([
              {
                title: "风险总结习惯",
                content: "用户希望默认先总结风险。",
                confidence: 0.7,
                evidenceMessageIds: ["message_1"],
              },
            ]),
            toolCalls: [],
            finishReason: "stop",
          };
        },
      },
      getModelProfile: async () => ({
        baseUrl: "http://localhost",
        apiKey: "test",
        model: "test",
        temperature: 0,
        maxTokens: 2000,
      }),
      now: () => new Date("2026-07-05T02:00:00.000Z"),
      createId: () => "candidate_1",
    });

    try {
      await service.ingestRecent();
      const listResult = await service.listCandidates();
      expect(listResult.ok).toBe(true);
      if (!listResult.ok) return;
      const rejectResult = await service.rejectCandidate(listResult.candidates[0].id);
      expect(rejectResult.ok).toBe(true);
      expect(writtenMemories).toHaveLength(0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

function historyEntry(
  partial: Pick<RawHistoryEntry, "id" | "sessionId" | "content"> &
    Partial<RawHistoryEntry>,
): RawHistoryEntry {
  return {
    role: "user",
    source: "chat",
    workspaceId: "workspace_a",
    createdAt: "2026-07-05T01:00:00.000Z",
    ...partial,
  };
}

function chatSession(
  id: string,
  archivedAt?: string,
): ChatSessionListItem {
  return {
    id,
    title: id,
    summary: "",
    messageCount: 1,
    ...(archivedAt ? { archivedAt } : {}),
    work: {
      source: "idle",
      status: "idle",
      updatedAt: "2026-07-05T01:00:00.000Z",
    },
    updatedAt: "2026-07-05T01:00:00.000Z",
  };
}
