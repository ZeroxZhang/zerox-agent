import type { MemoryRecord } from "./memory";

export type MemoryGovernanceDuplicateGroup = {
  key: string;
  title: string;
  memoryIds: string[];
};

export type MemoryGovernanceConflictGroup = {
  subject: string;
  memoryIds: string[];
  contents: string[];
};

export type MemoryGovernanceStaleRecord = {
  memoryId: string;
  title: string;
  ageDays: number;
  importance: number;
};

export type MemoryGovernanceReport = {
  scanned: number;
  duplicateGroups: MemoryGovernanceDuplicateGroup[];
  conflictGroups: MemoryGovernanceConflictGroup[];
  staleLowSignalRecords: MemoryGovernanceStaleRecord[];
  recommendations: string[];
};

export type RunMemoryGovernanceResult =
  | { ok: true; report: MemoryGovernanceReport }
  | { ok: false; message: string };

export function createMemoryGovernanceReport(
  records: MemoryRecord[],
  options: {
    now?: string;
    staleAfterDays?: number;
  } = {},
): MemoryGovernanceReport {
  const activeRecords = records.filter((record) => !record.archivedAt);
  const duplicateGroups = findDuplicateTitleGroups(activeRecords);
  const conflictGroups = findPreferenceConflicts(activeRecords);
  const staleLowSignalRecords = findStaleLowSignalRecords(
    activeRecords,
    options.now ?? new Date().toISOString(),
    options.staleAfterDays ?? 120,
  );

  return {
    scanned: records.length,
    duplicateGroups,
    conflictGroups,
    staleLowSignalRecords,
    recommendations: createRecommendations({
      duplicateGroups,
      conflictGroups,
      staleLowSignalRecords,
    }),
  };
}

function findDuplicateTitleGroups(
  records: MemoryRecord[],
): MemoryGovernanceDuplicateGroup[] {
  return [...groupBy(records, (record) => normalizeKey(record.title)).entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({
      key,
      title: group[0].title,
      memoryIds: group.map((record) => record.id),
    }));
}

function findPreferenceConflicts(
  records: MemoryRecord[],
): MemoryGovernanceConflictGroup[] {
  const preferenceRecords = records.filter(
    (record) =>
      (record.kind === "semantic" || record.kind === "core") &&
      record.tags.includes("preference"),
  );

  return [
    ...groupBy(preferenceRecords, getPreferenceSubject).entries(),
  ]
    .filter(([, group]) => group.length > 1)
    .filter(([, group]) => new Set(group.map((record) => normalizeKey(record.content))).size > 1)
    .map(([subject, group]) => ({
      subject,
      memoryIds: group.map((record) => record.id),
      contents: group.map((record) => record.content),
    }));
}

function findStaleLowSignalRecords(
  records: MemoryRecord[],
  nowIso: string,
  staleAfterDays: number,
): MemoryGovernanceStaleRecord[] {
  const now = new Date(nowIso).getTime();

  return records
    .filter((record) => record.importance <= 2)
    .map((record) => ({
      record,
      ageDays: Math.floor(
        (now - new Date(record.updatedAt).getTime()) / (24 * 60 * 60 * 1000),
      ),
    }))
    .filter(({ ageDays }) => ageDays >= staleAfterDays)
    .map(({ record, ageDays }) => ({
      memoryId: record.id,
      title: record.title,
      ageDays,
      importance: record.importance,
    }));
}

function createRecommendations(input: {
  duplicateGroups: MemoryGovernanceDuplicateGroup[];
  conflictGroups: MemoryGovernanceConflictGroup[];
  staleLowSignalRecords: MemoryGovernanceStaleRecord[];
}): string[] {
  const recommendations: string[] = [];

  if (input.duplicateGroups.length) {
    recommendations.push(
      `合并 ${input.duplicateGroups.length} 组重复标题记忆，保留来源最清晰的一条。`,
    );
  }

  if (input.conflictGroups.length) {
    recommendations.push(
      `审查 ${input.conflictGroups.length} 组冲突偏好，确认当前真实偏好。`,
    );
  }

  if (input.staleLowSignalRecords.length) {
    recommendations.push(
      `复查 ${input.staleLowSignalRecords.length} 条低重要度陈旧记忆，可删除或降噪归档。`,
    );
  }

  if (!recommendations.length) {
    recommendations.push("暂未发现需要人工治理的记忆问题。");
  }

  return recommendations;
}

function getPreferenceSubject(record: MemoryRecord): string {
  return record.title
    .replace(/^用户偏好[:：]\s*/i, "")
    .trim() || normalizeKey(record.title);
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
  return value
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
    .map((token) => token.trim())
    .filter(Boolean)
    .join("-");
}
