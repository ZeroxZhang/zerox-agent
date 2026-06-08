import type {
  MemoryKind,
  MemorySearchOptions,
  MemorySearchResult,
} from "../shared/memory";

export type MemoryRecallStore = {
  search(options: MemorySearchOptions): Promise<MemorySearchResult[]>;
};

export type MemoryRecallBudget = {
  limit?: number;
  timeoutMs?: number;
  maxCharsPerMemory?: number;
  maxTotalRecallChars?: number;
};

export type MemoryRecallRequest = MemoryRecallBudget & {
  memoryStore: MemoryRecallStore;
  query: string;
  kind?: MemoryKind | "all";
};

export type FormatMemoryRecallOptions = Required<
  Pick<MemoryRecallBudget, "maxCharsPerMemory" | "maxTotalRecallChars">
> & {
  heading: string;
};

const defaultRecallTimeoutMs = 5_000;

export async function recallMemoriesWithBudget(
  options: MemoryRecallRequest,
): Promise<MemorySearchResult[]> {
  const searchOptions: MemorySearchOptions = {
    query: options.query,
    ...(options.kind ? { kind: options.kind } : {}),
    ...(options.limit ? { limit: options.limit } : {}),
  };

  try {
    return await withTimeout(
      options.memoryStore.search(searchOptions),
      options.timeoutMs ?? defaultRecallTimeoutMs,
    );
  } catch {
    return [];
  }
}

export function formatMemoryRecallContext(
  results: MemorySearchResult[],
  options: FormatMemoryRecallOptions,
): string | null {
  const lines: string[] = [];

  for (const result of results) {
    const title = result.record.title.trim();
    const content = truncateText(
      result.record.content.trim(),
      options.maxCharsPerMemory,
    );
    const line = `- ${title ? `${title}：` : ""}${content}`;
    const next = [options.heading, ...lines, line].join("\n");

    if (
      options.maxTotalRecallChars > 0 &&
      next.length >= options.maxTotalRecallChars
    ) {
      break;
    }

    lines.push(line);
  }

  if (!lines.length) {
    return null;
  }

  return [options.heading, ...lines].join("\n");
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (timeoutMs <= 0) {
    return promise;
  }

  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Memory recall timed out."));
    }, timeoutMs);

    promise
      .then(resolve, reject)
      .finally(() => clearTimeout(timeout));
  });
}

function truncateText(value: string, maxLength: number): string {
  if (maxLength <= 0 || value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}
