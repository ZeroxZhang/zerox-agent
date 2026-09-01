import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ChatSessionListItem } from "../shared/chat";
import type {
  AcceptMemoryIngestionCandidateResult,
  GetMemoryIngestionStatusResult,
  IngestRecentMemoryResult,
  ListMemoryIngestionCandidatesResult,
  MemoryIngestionCandidate,
  MemoryIngestionEvidenceSnippet,
  MemoryIngestionReport,
  MemoryIngestionRuntimeStatus,
  MemoryIngestionScope,
  RejectMemoryIngestionCandidateResult,
} from "../shared/memoryIngestion";
import type { RawHistoryEntry } from "../shared/rawHistory";
import type { ChatClient, ChatMessage } from "./openAiCompatibleClient";
import { throwForModelServiceNotice } from "../shared/modelServiceNotice";
import { throwIfResponseBodyLimitError } from "./fetchWithTimeout";
import type { AgentModelProfile } from "./agentRunnerService";
import type { HistoryIndexStore } from "./historyIndexStore";
import type { MemoryStore } from "./memoryStore";

type StoredMemoryIngestionCandidates = {
  schemaVersion: 1;
  candidates: MemoryIngestionCandidate[];
};

type ParsedCandidate = {
  title?: unknown;
  content?: unknown;
  rationale?: unknown;
  confidence?: unknown;
  tags?: unknown;
  evidenceMessageIds?: unknown;
};

export type MemoryIngestionService = {
  ingestRecent(scope?: MemoryIngestionScope): Promise<IngestRecentMemoryResult>;
  getStatus(): Promise<GetMemoryIngestionStatusResult>;
  listCandidates(): Promise<ListMemoryIngestionCandidatesResult>;
  acceptCandidate(
    candidateId: string,
  ): Promise<AcceptMemoryIngestionCandidateResult>;
  rejectCandidate(
    candidateId: string,
  ): Promise<RejectMemoryIngestionCandidateResult>;
};

export function createMemoryIngestionService(options: {
  configDir: string;
  historyIndexStore: Pick<HistoryIndexStore, "list">;
  memoryStore: Pick<MemoryStore, "create">;
  chatSessionStore?: { list(): Promise<ChatSessionListItem[]> };
  chatClient: ChatClient;
  getModelProfile: () => Promise<AgentModelProfile>;
  createId?: () => string;
  now?: () => Date;
}): MemoryIngestionService {
  const candidatesPath = path.join(
    options.configDir,
    "memory-ingestion-candidates.json",
  );
  const createId = options.createId ?? (() => `memory_ingest_${randomUUID()}`);
  const now = options.now ?? (() => new Date());
  let activeIngestionJob: Promise<IngestRecentMemoryResult> | null = null;
  let ingestionStatus: MemoryIngestionRuntimeStatus = {
    running: false,
    message: "记忆摄取已就绪。",
  };

  async function readStored(): Promise<StoredMemoryIngestionCandidates> {
    try {
      const raw = await readFile(candidatesPath, "utf8");
      const parsed = JSON.parse(raw) as StoredMemoryIngestionCandidates;
      return {
        schemaVersion: 1,
        candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { schemaVersion: 1, candidates: [] };
      }
      throw error;
    }
  }

  async function writeStored(stored: StoredMemoryIngestionCandidates) {
    await mkdir(options.configDir, { recursive: true });
    await writeFile(candidatesPath, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
  }

  async function runIngestion(scope: MemoryIngestionScope | undefined) {
    try {
      const stored = await readStored();
      const entries = await collectRecentEntries({
        historyIndexStore: options.historyIndexStore,
        chatSessionStore: options.chatSessionStore,
        scope,
        now: now(),
      });
      const preferredLanguage = detectPreferredLanguage(entries);
      const parsedCandidates =
        (await extractCandidatesWithModel({
          chatClient: options.chatClient,
          getModelProfile: options.getModelProfile,
          entries,
          preferredLanguage,
        })) ?? extractCandidatesWithHeuristics(entries);
      const existingTitles = new Set(
        stored.candidates
          .filter((candidate) => candidate.status !== "rejected")
          .map((candidate) => normalizeTitle(candidate.title)),
      );
      const nextCandidates: MemoryIngestionCandidate[] = [];
      let duplicateCandidates = 0;
      let skippedCandidates = 0;

      for (const parsedCandidate of parsedCandidates) {
        const candidate = buildCandidate({
          parsedCandidate: localizeParsedCandidate({
            parsedCandidate,
            entries,
            preferredLanguage,
          }),
          entries,
          createId,
          createdAt: now().toISOString(),
        });
        if (!candidate) {
          skippedCandidates += 1;
          continue;
        }

        const normalizedTitle = normalizeTitle(candidate.title);
        if (!normalizedTitle || existingTitles.has(normalizedTitle)) {
          duplicateCandidates += 1;
          continue;
        }

        existingTitles.add(normalizedTitle);
        nextCandidates.push(candidate);
      }

      const report: MemoryIngestionReport = {
        scannedSessions: new Set(entries.map((entry) => entry.sessionId).filter(Boolean)).size,
        scannedMessages: entries.length,
        createdCandidates: nextCandidates.length,
        duplicateCandidates,
        skippedCandidates,
        candidates: nextCandidates,
        createdAt: now().toISOString(),
      };

      if (nextCandidates.length) {
        await writeStored({
          schemaVersion: 1,
          candidates: [...stored.candidates, ...nextCandidates],
        });
      }

      return { ok: true, report } satisfies IngestRecentMemoryResult;
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "无法摄取记忆。",
      } satisfies IngestRecentMemoryResult;
    }
  }

  return {
    ingestRecent(scope) {
      if (activeIngestionJob) {
        return activeIngestionJob;
      }

      const startedAt = now().toISOString();
      ingestionStatus = {
        running: true,
        message: "正在摄取最近会话...",
        startedAt,
      };
      activeIngestionJob = runIngestion(scope)
        .then((result) => {
          if (result.ok) {
            ingestionStatus = {
              running: false,
              message: `摄取完成：新增 ${result.report.createdCandidates} 个候选。`,
              startedAt,
              completedAt: now().toISOString(),
              report: result.report,
            };
            return result;
          }

          ingestionStatus = {
            running: false,
            message: result.message,
            startedAt,
            completedAt: now().toISOString(),
            error: result.message,
          };
          return result;
        })
        .finally(() => {
          activeIngestionJob = null;
        });
      return activeIngestionJob;
    },

    async getStatus() {
      return { ok: true, status: ingestionStatus };
    },

    async listCandidates() {
      try {
        const stored = await readStored();
        const localizedCandidates = stored.candidates.map(localizeStoredCandidate);
        if (
          JSON.stringify(localizedCandidates) !== JSON.stringify(stored.candidates)
        ) {
          await writeStored({ schemaVersion: 1, candidates: localizedCandidates });
        }
        return {
          ok: true,
          candidates: localizedCandidates
            .slice()
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
        };
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof Error ? error.message : "无法读取摄取候选。",
        };
      }
    },

    async acceptCandidate(candidateId) {
      try {
        const stored = await readStored();
        const candidate = stored.candidates.find((item) => item.id === candidateId);
        if (!candidate) {
          return { ok: false, message: "摄取候选不存在。" };
        }
        if (candidate.status !== "pending") {
          return { ok: false, message: "摄取候选已处理。" };
        }

        const memory = await options.memoryStore.create(candidate.draftMemory);
        const updatedCandidate: MemoryIngestionCandidate = {
          ...candidate,
          status: "accepted",
          acceptedMemoryId: memory.id,
          updatedAt: now().toISOString(),
        };
        await writeStored({
          schemaVersion: 1,
          candidates: stored.candidates.map((item) =>
            item.id === candidateId ? updatedCandidate : item,
          ),
        });
        return { ok: true, candidate: updatedCandidate, memory };
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof Error ? error.message : "无法接受摄取候选。",
        };
      }
    },

    async rejectCandidate(candidateId) {
      try {
        const stored = await readStored();
        const candidate = stored.candidates.find((item) => item.id === candidateId);
        if (!candidate) {
          return { ok: false, message: "摄取候选不存在。" };
        }
        if (candidate.status !== "pending") {
          return { ok: false, message: "摄取候选已处理。" };
        }
        const updatedCandidate: MemoryIngestionCandidate = {
          ...candidate,
          status: "rejected",
          updatedAt: now().toISOString(),
        };
        await writeStored({
          schemaVersion: 1,
          candidates: stored.candidates.map((item) =>
            item.id === candidateId ? updatedCandidate : item,
          ),
        });
        return { ok: true, candidate: updatedCandidate };
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof Error ? error.message : "无法拒绝摄取候选。",
        };
      }
    },
  };
}

async function collectRecentEntries(options: {
  historyIndexStore: Pick<HistoryIndexStore, "list">;
  chatSessionStore?: { list(): Promise<ChatSessionListItem[]> };
  scope: MemoryIngestionScope | undefined;
  now: Date;
}): Promise<RawHistoryEntry[]> {
  const days = clampNumber(options.scope?.days, 14, 1, 90);
  const maxSessions = clampNumber(options.scope?.maxSessions, 20, 1, 100);
  const maxMessages = clampNumber(options.scope?.maxMessages, 200, 1, 1000);
  const sinceMs = options.now.getTime() - days * 24 * 60 * 60 * 1000;
  const sessions = await options.chatSessionStore?.list();
  const visibleSessionIds = sessions
    ? new Set(
        sessions
          .filter((session) => !session.archivedAt)
          .map((session) => session.id),
      )
    : null;
  const entries = (await options.historyIndexStore.list())
    .filter((entry) => entry.source === "chat")
    .filter((entry) => entry.role === "user" || entry.role === "assistant")
    .filter((entry) => Date.parse(entry.createdAt) >= sinceMs)
    .filter((entry) =>
      options.scope?.workspaceId
        ? entry.workspaceId === options.scope.workspaceId
        : true,
    )
    .filter((entry) =>
      options.scope?.sessionId ? entry.sessionId === options.scope.sessionId : true,
    )
    .filter((entry) =>
      visibleSessionIds && entry.sessionId
        ? visibleSessionIds.has(entry.sessionId)
        : true,
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const selectedSessionIds = new Set<string>();
  const selectedEntries: RawHistoryEntry[] = [];

  for (const entry of entries) {
    if (entry.sessionId && !selectedSessionIds.has(entry.sessionId)) {
      if (selectedSessionIds.size >= maxSessions) {
        continue;
      }
      selectedSessionIds.add(entry.sessionId);
    }
    selectedEntries.push(entry);
    if (selectedEntries.length >= maxMessages) {
      break;
    }
  }

  return selectedEntries.sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

async function extractCandidatesWithModel(options: {
  chatClient: ChatClient;
  getModelProfile: () => Promise<AgentModelProfile>;
  entries: RawHistoryEntry[];
  preferredLanguage: PreferredMemoryLanguage;
}): Promise<ParsedCandidate[] | null> {
  if (!options.entries.length) {
    return [];
  }
  try {
    const profile = await options.getModelProfile();
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: [
          "Extract review-first memory ingestion candidates from recent chat history.",
          "Return JSON array only. Each item needs title, content, rationale, confidence, tags, evidenceMessageIds.",
          "Focus on repeated user preferences, corrections, task-framing habits, and durable workflow constraints.",
          "Do not invent evidence. Every item must reference message ids from the provided transcript.",
          memoryLanguageInstruction(options.preferredLanguage),
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify(
          options.entries.map((entry) => ({
            id: entry.id,
            sessionId: entry.sessionId,
            role: entry.role,
            createdAt: entry.createdAt,
            content: entry.content.slice(0, 1000),
          })),
        ),
      },
    ];
    const response = await options.chatClient.complete({
      ...profile,
      messages,
      temperature: Math.min(profile.temperature, 0.2),
      maxTokens: Math.min(profile.maxTokens, 1600),
    });
    throwForModelServiceNotice(response.modelServiceNotice);
    return parseCandidateJson(response.content);
  } catch (error) {
    throwIfResponseBodyLimitError(error);
    return null;
  }
}

type PreferredMemoryLanguage = "zh-Hans" | "en";

function detectPreferredLanguage(entries: RawHistoryEntry[]): PreferredMemoryLanguage {
  const userText = entries
    .filter((entry) => entry.role === "user")
    .map((entry) => entry.content)
    .join("\n");
  const sourceText = userText || entries.map((entry) => entry.content).join("\n");
  const cjkCount = (sourceText.match(/[\u3400-\u9fff]/g) ?? []).length;
  const latinWordCount = (sourceText.match(/[a-zA-Z]{3,}/g) ?? []).length;
  return cjkCount >= 6 && cjkCount >= latinWordCount ? "zh-Hans" : "en";
}

function memoryLanguageInstruction(language: PreferredMemoryLanguage): string {
  if (language === "zh-Hans") {
    return [
      "The dominant language of the user's own messages is Simplified Chinese.",
      "Write title, content, rationale, and user-facing tags in Simplified Chinese.",
      "Keep technical proper nouns such as Markdown, HTML, SKILL.md, shell, or API unchanged when needed.",
    ].join("\n");
  }

  return [
    "Write title, content, rationale, and user-facing tags in the dominant language of the user's own messages.",
    "For this transcript the detected dominant language is English.",
  ].join("\n");
}

function parseCandidateJson(content: string | null): ParsedCandidate[] | null {
  if (!content) {
    return null;
  }
  const trimmed = content.trim();
  const candidates = [
    trimmed,
    trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim(),
    trimmed.match(/\[[\s\S]*\]/)?.[0],
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      return Array.isArray(parsed) ? (parsed as ParsedCandidate[]) : null;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function extractCandidatesWithHeuristics(entries: RawHistoryEntry[]): ParsedCandidate[] {
  const userEntries = entries.filter((entry) => entry.role === "user");
  const correctionEntries = userEntries.filter((entry) =>
    /(不是|应该|改成|修正|纠正|不要|别|instead|rather than|prefer)/i.test(entry.content),
  );
  const preferenceEntries = userEntries.filter((entry) =>
    /(以后|默认|记住|我喜欢|我希望|每次|习惯|prefer|always|default)/i.test(entry.content),
  );
  const candidates: ParsedCandidate[] = [];

  if (preferenceEntries.length) {
    candidates.push({
      title: "用户偏好的默认工作方式",
      content: summarizeEvidenceContent(preferenceEntries),
      rationale: "用户在近期对默认偏好、习惯或期望有明确表达。",
      confidence: Math.min(0.9, 0.55 + preferenceEntries.length * 0.08),
      tags: ["habit", "preference", "ingested"],
      evidenceMessageIds: preferenceEntries.slice(-5).map((entry) => entry.id),
    });
  }

  if (correctionEntries.length) {
    candidates.push({
      title: "用户修正过的输出约束",
      content: summarizeEvidenceContent(correctionEntries),
      rationale: "用户近期修正过输出方向或约束，适合沉淀为可复用习惯。",
      confidence: Math.min(0.88, 0.52 + correctionEntries.length * 0.08),
      tags: ["habit", "correction", "ingested"],
      evidenceMessageIds: correctionEntries.slice(-5).map((entry) => entry.id),
    });
  }

  return candidates;
}

function localizeParsedCandidate(options: {
  parsedCandidate: ParsedCandidate;
  entries: RawHistoryEntry[];
  preferredLanguage: PreferredMemoryLanguage;
}): ParsedCandidate {
  if (options.preferredLanguage !== "zh-Hans") {
    return options.parsedCandidate;
  }
  const evidenceIds = readStringArray(options.parsedCandidate.evidenceMessageIds);
  const evidenceEntries = evidenceIds
    .map((id) => options.entries.find((entry) => entry.id === id))
    .filter((entry): entry is RawHistoryEntry => Boolean(entry));
  return localizeCandidateTextFromEvidence({
    parsedCandidate: options.parsedCandidate,
    evidenceEntries,
  });
}

function localizeStoredCandidate(
  candidate: MemoryIngestionCandidate,
): MemoryIngestionCandidate {
  const language = detectPreferredLanguage(
    candidate.evidence.map((item) => ({
      id: item.messageId,
      role: item.role,
      source: "chat",
      content: item.content,
      createdAt: item.createdAt,
      ...(item.sessionId ? { sessionId: item.sessionId } : {}),
      ...(item.workspaceId ? { workspaceId: item.workspaceId } : {}),
    })),
  );
  if (language !== "zh-Hans") {
    return candidate;
  }
  const localized = localizeCandidateTextFromEvidence({
    parsedCandidate: {
      title: candidate.title,
      content: candidate.draftMemory.content,
      rationale: candidate.rationale,
      confidence: candidate.confidence,
      tags: candidate.draftMemory.tags,
      evidenceMessageIds: candidate.evidence.map((item) => item.messageId),
    },
    evidenceEntries: candidate.evidence.map((item) => ({
      id: item.messageId,
      role: item.role,
      source: "chat",
      content: item.content,
      createdAt: item.createdAt,
      ...(item.sessionId ? { sessionId: item.sessionId } : {}),
      ...(item.workspaceId ? { workspaceId: item.workspaceId } : {}),
    })),
  });
  const nextTitle = readString(localized.title);
  const nextContent = readString(localized.content);
  const nextRationale = readString(localized.rationale);
  if (
    nextTitle === candidate.title &&
    nextContent === candidate.draftMemory.content &&
    nextRationale === candidate.rationale
  ) {
    return candidate;
  }

  return {
    ...candidate,
    title: nextTitle || candidate.title,
    rationale: nextRationale || candidate.rationale,
    draftMemory: {
      ...candidate.draftMemory,
      title: nextTitle || candidate.draftMemory.title,
      content: nextContent || candidate.draftMemory.content,
      tags: localizeTags(readStringArray(localized.tags)),
    },
  };
}

function localizeCandidateTextFromEvidence(options: {
  parsedCandidate: ParsedCandidate;
  evidenceEntries: RawHistoryEntry[];
}): ParsedCandidate {
  const title = readString(options.parsedCandidate.title);
  const content = readString(options.parsedCandidate.content);
  const rationale = readString(options.parsedCandidate.rationale);
  if (!looksLikeEnglishCandidate([title, content, rationale].join("\n"))) {
    return options.parsedCandidate;
  }

  const evidenceSummary = summarizeEvidenceContent(options.evidenceEntries);
  return {
    ...options.parsedCandidate,
    title: inferChineseCandidateTitle(options.evidenceEntries),
    content: evidenceSummary
      ? `用户近期反复表达或修正：${evidenceSummary}`
      : "用户近期对工作方式有可复用的偏好或修正。",
    rationale: "根据近期中文会话中的重复偏好、修正或任务描述方式提取。",
    tags: localizeTags(readStringArray(options.parsedCandidate.tags)),
  };
}

function inferChineseCandidateTitle(entries: RawHistoryEntry[]): string {
  const text = entries.map((entry) => entry.content).join("\n");
  if (/(工具|技能|调用|invoke|SKILL|@[\w-]+)/i.test(text)) {
    return "工具和技能调用偏好";
  }
  if (/(子.?agent|subagent|并行|多.?agent)/i.test(text)) {
    return "并行子任务执行偏好";
  }
  if (/(HTML|Markdown|报告|可视化|交付|最终产物)/i.test(text)) {
    return "交付格式偏好";
  }
  if (/(目标|验收|度量|可判断|完成标准)/i.test(text)) {
    return "目标验收与度量习惯";
  }
  if (/(语言|中文|英文|输出语言)/i.test(text)) {
    return "输出语言偏好";
  }
  if (/(不是|应该|改成|修正|纠正|不要|别)/i.test(text)) {
    return "用户修正过的工作约束";
  }
  return "用户近期工作习惯";
}

function looksLikeEnglishCandidate(text: string): boolean {
  const cjkCount = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const latinWordCount = (text.match(/[a-zA-Z]{3,}/g) ?? []).length;
  return cjkCount < 6 && latinWordCount >= 4;
}

function localizeTags(tags: string[]): string[] {
  const dictionary = new Map([
    ["habit", "习惯"],
    ["preference", "偏好"],
    ["correction", "修正"],
    ["workflow", "流程"],
    ["tool", "工具"],
    ["skill", "技能"],
    ["ingested", "摄取"],
    ["goal", "目标"],
  ]);
  const localized = tags.map((tag) => dictionary.get(tag.toLowerCase()) ?? tag);
  return [...new Set(localized.length ? localized : ["习惯", "摄取"])];
}

function buildCandidate(options: {
  parsedCandidate: ParsedCandidate;
  entries: RawHistoryEntry[];
  createId: () => string;
  createdAt: string;
}): MemoryIngestionCandidate | null {
  const title = readString(options.parsedCandidate.title);
  const content = readString(options.parsedCandidate.content);
  const evidenceIds = readStringArray(options.parsedCandidate.evidenceMessageIds);
  const evidenceById = new Map(options.entries.map((entry) => [entry.id, entry]));
  const evidence = evidenceIds
    .map((id) => evidenceById.get(id))
    .filter((entry): entry is RawHistoryEntry => Boolean(entry))
    .slice(0, 8)
    .map(toEvidenceSnippet);

  if (!title || !content || !evidence.length) {
    return null;
  }

  const id = options.createId();
  const sessionIds = [
    ...new Set(evidence.map((item) => item.sessionId).filter((value): value is string => Boolean(value))),
  ];
  const messageIds = evidence.map((item) => item.messageId);
  const tags = [
    ...new Set([
      "ingested",
      "habit",
      ...readStringArray(options.parsedCandidate.tags),
    ]),
  ];
  const confidence = clampNumber(
    typeof options.parsedCandidate.confidence === "number"
      ? options.parsedCandidate.confidence
      : 0.65,
    0.65,
    0,
    1,
  );

  return {
    id,
    title,
    rationale: readString(options.parsedCandidate.rationale) || "从近期会话中提取。",
    confidence,
    status: "pending",
    evidence,
    draftMemory: {
      kind: "semantic",
      title,
      content,
      tags,
      layer: "ingested_habit",
      importance: confidence >= 0.78 ? 4 : 3,
      source: {
        type: "memory_ingestion",
        candidateId: id,
        sessionIds,
        messageIds,
      },
    },
    createdAt: options.createdAt,
    updatedAt: options.createdAt,
  };
}

function toEvidenceSnippet(entry: RawHistoryEntry): MemoryIngestionEvidenceSnippet {
  return {
    messageId: entry.id,
    ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
    ...(entry.workspaceId ? { workspaceId: entry.workspaceId } : {}),
    role: entry.role,
    content: entry.content.slice(0, 500),
    createdAt: entry.createdAt,
  };
}

function summarizeEvidenceContent(entries: RawHistoryEntry[]): string {
  return entries
    .slice(-5)
    .map((entry) => entry.content.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ").trim();
}

function clampNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}
