import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type {
  RawHistoryAroundOptions,
  RawHistoryAroundResult,
  RawHistoryEntry,
  RawHistorySearchOptions,
  RawHistorySearchResult,
} from "../shared/rawHistory";

export type HistoryIndexStore = {
  append(entry: RawHistoryEntry): Promise<void>;
  search(options: RawHistorySearchOptions): Promise<RawHistorySearchResult[]>;
  around(options: RawHistoryAroundOptions): Promise<RawHistoryAroundResult | null>;
  list(): Promise<RawHistoryEntry[]>;
};

export function createHistoryIndexStore(options: {
  filePath: string;
}): HistoryIndexStore {
  return {
    async append(entry) {
      await mkdir(path.dirname(options.filePath), { recursive: true });
      await appendFile(options.filePath, `${JSON.stringify(entry)}\n`, "utf8");
    },

    async search(searchOptions) {
      const terms = tokenize(searchOptions.query);
      if (terms.length === 0) {
        return [];
      }

      const limit = clampLimit(searchOptions.limit);
      const entries = await readEntries(options.filePath);
      return entries
        .filter((entry) => matchesRawHistoryScope(entry, searchOptions))
        .map((entry) => scoreEntry(entry, terms))
        .filter((result) => result.score > 0)
        .sort(
          (left, right) =>
            right.score - left.score ||
            right.entry.createdAt.localeCompare(left.entry.createdAt),
        )
        .slice(0, limit);
    },

    async around(aroundOptions) {
      const before = clampWindow(aroundOptions.before);
      const after = clampWindow(aroundOptions.after);
      const entries = await readEntries(options.filePath);
      const anchor = entries.find((entry) => entry.id === aroundOptions.entryId);
      if (!anchor || !matchesRawHistoryScope(anchor, aroundOptions)) {
        return null;
      }

      const sessionEntries = entries
        .filter(
          (entry) =>
            entry.sessionId === anchor.sessionId &&
            matchesRawHistoryScope(entry, aroundOptions),
        )
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      const anchorIndex = sessionEntries.findIndex((entry) => entry.id === anchor.id);
      const start = Math.max(0, anchorIndex - before);
      const end = Math.min(sessionEntries.length, anchorIndex + after + 1);
      return {
        anchor,
        entries: sessionEntries.slice(start, end),
      };
    },

    async list() {
      return readEntries(options.filePath);
    },
  };
}

function matchesRawHistoryScope(
  entry: RawHistoryEntry,
  scope: { workspaceId?: string; sessionId?: string },
): boolean {
  if (scope.workspaceId && entry.workspaceId !== scope.workspaceId) {
    return false;
  }
  if (scope.sessionId && entry.sessionId !== scope.sessionId) {
    return false;
  }
  return true;
}

async function readEntries(filePath: string): Promise<RawHistoryEntry[]> {
  let raw = "";
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const entries: RawHistoryEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as RawHistoryEntry;
      if (parsed.id && parsed.content && parsed.createdAt) {
        entries.push(parsed);
      }
    } catch {
      // Tolerate partially written JSONL lines; the stores are append-only.
    }
  }
  return entries;
}

function scoreEntry(
  entry: RawHistoryEntry,
  terms: string[],
): RawHistorySearchResult {
  const haystack = [
    entry.content,
    entry.toolName ?? "",
    ...(entry.pathRefs ?? []),
  ]
    .join("\n")
    .toLowerCase();
  const matchedTerms = terms.filter((term) => haystack.includes(term));
  return {
    entry,
    matchedTerms,
    score: matchedTerms.length,
  };
}

function tokenize(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/\s+/)
        .map((term) => term.trim())
        .filter(Boolean),
    ),
  ];
}

function clampLimit(limit: unknown): number {
  return Math.max(
    1,
    Math.min(20, typeof limit === "number" && Number.isFinite(limit) ? limit : 5),
  );
}

function clampWindow(value: unknown): number {
  return Math.max(
    0,
    Math.min(10, typeof value === "number" && Number.isFinite(value) ? value : 3),
  );
}
