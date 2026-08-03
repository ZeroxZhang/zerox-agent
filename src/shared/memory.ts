export type MemoryKind =
  | "core"
  | "session"
  | "semantic"
  | "episodic"
  | "procedural";

export type MemorySource =
  | { type: "manual" }
  | { type: "agent_run"; refId: string }
  | { type: "chat_session"; sessionId: string; messageIds: string[] }
  | { type: "skill"; refId: string }
  | { type: "system" }
  | {
      type: "memory_ingestion";
      candidateId: string;
      sessionIds: string[];
      messageIds: string[];
    }
  | { type: "dream"; runId: string } // P7 (Patch 23)
  | { type: "distill"; runId: string }; // P7 (Patch 23)

export type MemoryLayer =
  | "manual_required"
  | "system_long_term"
  | "ingested_habit";

export type MemoryEmbedding = {
  model: string;
  dimensions: number;
  vector: number[];
  embeddedAt: string;
};

export type MemoryConsolidationStrategy = "duplicate-title" | "topic-rollup";

export type MemoryConsolidation = {
  strategy: MemoryConsolidationStrategy;
  sourceIds: string[];
  createdAt: string;
};

export type MemoryInput = {
  kind: MemoryKind | string;
  title: string;
  content: string;
  tags?: string[];
  source?: MemorySource;
  layer?: MemoryLayer;
  importance?: number;
  embedding?: MemoryEmbedding;
  consolidation?: MemoryConsolidation;
};

export type NormalizedMemoryInput = {
  kind: MemoryKind;
  title: string;
  content: string;
  tags: string[];
  source: MemorySource;
  layer?: MemoryLayer;
  importance: number;
  embedding?: MemoryEmbedding;
  consolidation?: MemoryConsolidation;
};

export type MemoryArchiveReason =
  | "consolidated"
  | "superseded"
  | "stale"
  | "user_archived";

export type MemoryRecord = NormalizedMemoryInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  archiveReason?: MemoryArchiveReason;
  consolidatedInto?: string;
};

export type MemoryValidationErrors = Partial<
  Record<"kind" | "title" | "content" | "importance" | "embedding", string>
>;

export type MemoryValidationResult = {
  valid: boolean;
  errors: MemoryValidationErrors;
};

export type MemorySearchOptions = {
  query: string;
  kind?: MemoryKind | "all";
  /**
   * When present, session memories are restricted to this chat session while
   * non-session memories remain globally visible.
   */
  sessionId?: string;
  limit?: number;
  minScore?: number;
  queryEmbedding?: number[];
  includeArchived?: boolean;
  strategy?: "blended" | "hybrid";
};

export type MemorySearchResult = {
  record: MemoryRecord;
  score: number;
  matchedTerms: string[];
};

export type MemoryListOptions = {
  kind?: MemoryKind | "all";
  limit?: number;
  includeArchived?: boolean;
};

export type CreateMemoryResult =
  | { ok: true; memory: MemoryRecord }
  | {
      ok: false;
      errors: MemoryValidationErrors;
      message: string;
    };

export type DeleteMemoryResult =
  | { ok: true; deleted: boolean }
  | { ok: false; message: string };

export type MemoryMaintenanceReport = {
  scanned: number;
  candidates: number;
  consolidated: number;
  archived: number;
  skipped: number;
  createdAt: string;
  createdMemories: MemoryRecord[];
};

export type RunMemoryMaintenanceResult =
  | { ok: true; report: MemoryMaintenanceReport }
  | { ok: false; message: string };

const memoryKinds: MemoryKind[] = [
  "core",
  "session",
  "semantic",
  "episodic",
  "procedural",
];

export function normalizeMemoryInput(input: MemoryInput): NormalizedMemoryInput {
  const embedding = normalizeEmbedding(input.embedding);
  const consolidation = normalizeConsolidation(input.consolidation);

  return {
    kind: isMemoryKind(input.kind) ? input.kind : "semantic",
    title: String(input.title ?? "").trim(),
    content: String(input.content ?? "").trim(),
    tags: normalizeTags(input.tags ?? []),
    source: input.source ?? { type: "manual" },
    layer: normalizeMemoryLayer(input.layer, input.source),
    importance: normalizeImportance(input.importance),
    ...(embedding ? { embedding } : {}),
    ...(consolidation ? { consolidation } : {}),
  };
}

export function validateMemoryInput(
  input: MemoryInput,
): MemoryValidationResult {
  const normalized = normalizeMemoryInput(input);
  const errors: MemoryValidationErrors = {};

  if (!isMemoryKind(input.kind)) {
    errors.kind = "记忆类型无效。";
  }

  if (!normalized.title) {
    errors.title = "记忆标题必填。";
  }

  if (!normalized.content) {
    errors.content = "记忆内容必填。";
  }

  if (
    typeof input.importance === "number" &&
    (!Number.isFinite(input.importance) ||
      input.importance < 1 ||
      input.importance > 5)
  ) {
    errors.importance = "重要度必须在 1 到 5 之间。";
  }

  if (input.embedding && !normalizeEmbedding(input.embedding)) {
    errors.embedding = "Embedding 向量无效。";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export function getMemoryKindLabel(kind: MemoryKind): string {
  return {
    core: "核心记忆",
    session: "会话记忆",
    semantic: "语义记忆",
    episodic: "情景记忆",
    procedural: "流程记忆",
  }[kind];
}

export function getMemoryKinds(): MemoryKind[] {
  return memoryKinds;
}

export function getMemoryLayerLabel(layer: MemoryLayer): string {
  return {
    manual_required: "强制记忆",
    system_long_term: "长期记忆",
    ingested_habit: "习惯摄取",
  }[layer];
}

export function searchMemoryRecords(
  records: MemoryRecord[],
  options: MemorySearchOptions,
): MemorySearchResult[] {
  const terms = tokenize(options.query);
  const queryEmbedding = normalizeVector(options.queryEmbedding);
  const filteredRecords =
    options.kind && options.kind !== "all"
      ? records.filter((record) => record.kind === options.kind)
      : records;
  const visibleRecords = options.includeArchived
    ? filteredRecords
    : filteredRecords.filter((record) => !record.archivedAt);

  if (!terms.length && !queryEmbedding.length) {
    return visibleRecords
      .slice()
      .sort(sortRecordsByImportanceAndDate)
      .slice(0, options.limit ?? 20)
      .map((record) => ({ record, score: 0, matchedTerms: [] }));
  }

  const minScore = options.minScore ?? 1;

  if (options.strategy === "hybrid" && terms.length && queryEmbedding.length) {
    return searchMemoryRecordsWithHybridRrf(
      visibleRecords,
      terms,
      queryEmbedding,
      minScore,
      options.limit ?? 20,
    );
  }

  return visibleRecords
    .map((record) => scoreRecord(record, terms, queryEmbedding))
    .filter((result) => result.score >= minScore)
    .sort((a, b) => b.score - a.score || sortRecordsByImportanceAndDate(a.record, b.record))
    .slice(0, options.limit ?? 20);
}

function searchMemoryRecordsWithHybridRrf(
  records: MemoryRecord[],
  terms: string[],
  queryEmbedding: number[],
  minScore: number,
  limit: number,
): MemorySearchResult[] {
  const lexicalResults = records
    .map((record) => scoreRecord(record, terms, []))
    .filter((result) => result.score >= minScore)
    .sort((a, b) => b.score - a.score || sortRecordsByImportanceAndDate(a.record, b.record));
  const vectorResults = records
    .map((record) => scoreRecord(record, [], queryEmbedding))
    .filter((result) => result.score >= minScore)
    .sort((a, b) => b.score - a.score || sortRecordsByImportanceAndDate(a.record, b.record));
  const byId = new Map<
    string,
    {
      record: MemoryRecord;
      score: number;
      matchedTerms: Set<string>;
    }
  >();

  applyRrfScores(byId, lexicalResults);
  applyRrfScores(byId, vectorResults);

  return [...byId.values()]
    .map((result) => ({
      record: result.record,
      score: Number(result.score.toFixed(6)),
      matchedTerms: [...result.matchedTerms],
    }))
    .sort((a, b) => b.score - a.score || sortRecordsByImportanceAndDate(a.record, b.record))
    .slice(0, limit);
}

function applyRrfScores(
  target: Map<
    string,
    {
      record: MemoryRecord;
      score: number;
      matchedTerms: Set<string>;
    }
  >,
  results: MemorySearchResult[],
) {
  results.forEach((result, index) => {
    const current = target.get(result.record.id) ?? {
      record: result.record,
      score: 0,
      matchedTerms: new Set<string>(),
    };

    current.score += 1 / (60 + index + 1);
    for (const term of result.matchedTerms) {
      current.matchedTerms.add(term);
    }
    target.set(result.record.id, current);
  });
}

export function exportMemoryRecords(
  records: MemoryRecord[],
  exportedAt = "2026-06-05T08:00:00.000Z",
): string {
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      exportedAt,
      records,
    },
    null,
    2,
  )}\n`;
}

function scoreRecord(
  record: MemoryRecord,
  terms: string[],
  queryEmbedding: number[],
): MemorySearchResult {
  const titleTokens = tokenize(record.title);
  const contentTokens = tokenize(record.content);
  const tagTokens = record.tags.flatMap(tokenize);
  const phrase = terms.join(" ");
  const combinedText = `${record.title} ${record.tags.join(" ")} ${record.content}`.toLowerCase();
  const matchedTerms: string[] = [];
  let score = 0;

  for (const term of terms) {
    let termScore = 0;
    if (titleTokens.includes(term)) {
      termScore += 3;
    }
    if (tagTokens.includes(term)) {
      termScore += 2;
    }
    if (contentTokens.includes(term)) {
      termScore += 1;
    }

    if (termScore > 0) {
      matchedTerms.push(term);
      score += termScore;
    }
  }

  if (terms.length > 1 && combinedText.includes(phrase)) {
    score += 1;
  }

  if (queryEmbedding.length && record.embedding?.vector.length) {
    score += Math.round(
      Math.max(0, cosineSimilarity(queryEmbedding, record.embedding.vector)) * 100,
    );
  }

  return { record, score, matchedTerms };
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
    .map((token) => token.trim())
    .filter(Boolean);
}

function normalizeTags(tags: string[]): string[] {
  return [
    ...new Set(
      tags
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

function normalizeImportance(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 3;
  }

  return Math.round(value);
}

function normalizeEmbedding(
  embedding: MemoryEmbedding | undefined,
): MemoryEmbedding | null {
  if (!embedding) {
    return null;
  }

  const vector = normalizeVector(embedding.vector);

  if (
    !embedding.model.trim() ||
    !embedding.embeddedAt.trim() ||
    embedding.dimensions !== vector.length ||
    !vector.length
  ) {
    return null;
  }

  return {
    model: embedding.model.trim(),
    dimensions: vector.length,
    vector,
    embeddedAt: embedding.embeddedAt,
  };
}

function normalizeConsolidation(
  consolidation: MemoryConsolidation | undefined,
): MemoryConsolidation | null {
  if (!consolidation?.sourceIds.length || !consolidation.createdAt.trim()) {
    return null;
  }

  if (
    consolidation.strategy !== "duplicate-title" &&
    consolidation.strategy !== "topic-rollup"
  ) {
    return null;
  }

  return {
    strategy: consolidation.strategy,
    sourceIds: [...new Set(consolidation.sourceIds.filter(Boolean))],
    createdAt: consolidation.createdAt,
  };
}

function normalizeMemoryLayer(
  layer: unknown,
  source: MemorySource | undefined,
): MemoryLayer {
  if (
    layer === "manual_required" ||
    layer === "system_long_term" ||
    layer === "ingested_habit"
  ) {
    return layer;
  }

  if (!source || source.type === "manual") {
    return "manual_required";
  }

  if (source.type === "memory_ingestion") {
    return "ingested_habit";
  }

  return "system_long_term";
}

function normalizeVector(vector: unknown): number[] {
  if (!Array.isArray(vector)) {
    return [];
  }

  return vector.filter((value): value is number => Number.isFinite(value));
}

function cosineSimilarity(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] ** 2;
    rightMagnitude += right[index] ** 2;
  }

  if (!leftMagnitude || !rightMagnitude) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function isMemoryKind(value: unknown): value is MemoryKind {
  return typeof value === "string" && memoryKinds.includes(value as MemoryKind);
}

function sortRecordsByImportanceAndDate(
  left: MemoryRecord,
  right: MemoryRecord,
): number {
  const archivedDelta = Number(Boolean(left.archivedAt)) - Number(Boolean(right.archivedAt));

  return (
    archivedDelta ||
    memoryLayerRank(resolveRecordLayer(left)) -
      memoryLayerRank(resolveRecordLayer(right)) ||
    right.importance - left.importance ||
    right.updatedAt.localeCompare(left.updatedAt)
  );
}

function resolveRecordLayer(record: MemoryRecord): MemoryLayer {
  return normalizeMemoryLayer(record.layer, record.source);
}

function memoryLayerRank(layer: MemoryLayer): number {
  switch (layer) {
    case "manual_required":
      return 0;
    case "ingested_habit":
      return 1;
    case "system_long_term":
      return 2;
  }
}
