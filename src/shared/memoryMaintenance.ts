import type {
  MemoryConsolidationStrategy,
  MemoryInput,
  MemoryKind,
  MemoryRecord,
} from "./memory";

export type MemoryConsolidationDraft = MemoryInput & {
  strategy: MemoryConsolidationStrategy;
  sourceIds: string[];
};

export type MemoryMaintenancePlan = {
  scanned: number;
  candidates: number;
  drafts: MemoryConsolidationDraft[];
};

export type MemoryMaintenanceOptions = {
  createdAt?: string;
  minDuplicateGroupSize?: number;
  minTopicGroupSize?: number;
  maxRecordsPerDraft?: number;
};

const maintainableKinds: MemoryKind[] = ["session", "semantic", "episodic"];
const lowSignalTags = new Set(["agent", "agent-run", "memory", "consolidated"]);

export function createMemoryMaintenancePlan(
  records: MemoryRecord[],
  options: MemoryMaintenanceOptions = {},
): MemoryMaintenancePlan {
  const createdAt = options.createdAt ?? new Date().toISOString();
  const minDuplicateGroupSize = options.minDuplicateGroupSize ?? 2;
  const minTopicGroupSize = options.minTopicGroupSize ?? 4;
  const maxRecordsPerDraft = options.maxRecordsPerDraft ?? 8;
  const candidates = records
    .filter(isMaintainableRecord)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const usedSourceIds = new Set<string>();
  const drafts: MemoryConsolidationDraft[] = [];

  for (const group of groupBy(candidates, (record) =>
    normalizeKey(record.title),
  ).values()) {
    if (group.length < minDuplicateGroupSize) {
      continue;
    }

    const sourceRecords = group.slice(0, maxRecordsPerDraft);
    drafts.push(
      createDraft({
        strategy: "duplicate-title",
        title: `Merged memory: ${sourceRecords[0].title}`,
        topic: sourceRecords[0].title,
        sourceRecords,
        createdAt,
      }),
    );
    for (const record of sourceRecords) {
      usedSourceIds.add(record.id);
    }
  }

  const topicCandidates = candidates.filter(
    (record) => !usedSourceIds.has(record.id),
  );
  for (const [topic, group] of groupBy(topicCandidates, getTopicKey).entries()) {
    if (!topic || group.length < minTopicGroupSize) {
      continue;
    }

    const sourceRecords = group.slice(0, maxRecordsPerDraft);
    drafts.push(
      createDraft({
        strategy: "topic-rollup",
        title: `Consolidated memory: ${topic}`,
        topic,
        sourceRecords,
        createdAt,
      }),
    );
    for (const record of sourceRecords) {
      usedSourceIds.add(record.id);
    }
  }

  return {
    scanned: records.length,
    candidates: candidates.length,
    drafts,
  };
}

function isMaintainableRecord(record: MemoryRecord): boolean {
  return (
    maintainableKinds.includes(record.kind) &&
    !record.archivedAt &&
    !record.consolidation
  );
}

function createDraft(options: {
  createdAt: string;
  sourceRecords: MemoryRecord[];
  strategy: MemoryConsolidationStrategy;
  title: string;
  topic: string;
}): MemoryConsolidationDraft {
  const sourceIds = options.sourceRecords.map((record) => record.id);

  return {
    strategy: options.strategy,
    sourceIds,
    kind: "semantic",
    title: options.title,
    content: formatConsolidatedContent(
      options.topic,
      options.sourceRecords,
      options.strategy,
    ),
    tags: normalizeTags([
      ...options.sourceRecords.flatMap((record) => record.tags),
      "consolidated",
    ]),
    source: { type: "system" },
    importance: Math.max(
      3,
      ...options.sourceRecords.map((record) => record.importance),
    ),
    consolidation: {
      strategy: options.strategy,
      sourceIds,
      createdAt: options.createdAt,
    },
  };
}

function formatConsolidatedContent(
  topic: string,
  records: MemoryRecord[],
  strategy: MemoryConsolidationStrategy,
): string {
  const heading =
    strategy === "duplicate-title"
      ? `Merged ${records.length} memories named ${topic}.`
      : `Consolidated ${records.length} memories about ${topic}.`;

  return [
    heading,
    "",
    ...records.map(
      (record) => `- ${record.title}: ${truncate(record.content, 220)}`,
    ),
  ].join("\n");
}

function getTopicKey(record: MemoryRecord): string {
  const tag = record.tags.find((candidate) => !lowSignalTags.has(candidate));

  if (tag) {
    return tag;
  }

  return tokenize(record.title).slice(0, 3).join("-");
}

function groupBy<T>(
  values: T[],
  getKey: (value: T) => string,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const value of values) {
    const key = getKey(value);
    if (!key) {
      continue;
    }

    groups.set(key, [...(groups.get(key) ?? []), value]);
  }

  return groups;
}

function normalizeKey(value: string): string {
  return tokenize(value).join("-");
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
    .map((token) => token.trim())
    .filter(Boolean);
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}...`;
}
