import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createMemoryMaintenancePlan, type MemoryMaintenanceOptions } from "../shared/memoryMaintenance";
import {
  createMemoryGovernanceReport,
  type MemoryGovernanceReport,
} from "../shared/memoryGovernance";
import { createChunkingService, type ChunkingService } from "./chunking";
import { createReranker, type Reranker } from "./reranker";
import {
  exportMemoryRecords,
  normalizeMemoryInput,
  searchMemoryRecords,
  validateMemoryInput,
  type MemoryEmbedding,
  type MemoryInput,
  type MemoryListOptions,
  type MemoryMaintenanceReport,
  type MemoryRecord,
  type MemorySearchOptions,
  type MemorySearchResult,
  type MemoryValidationErrors,
} from "../shared/memory";

type StoredMemoryRecords = {
  schemaVersion: 1;
  records: MemoryRecord[];
};

export type MemoryEmbeddingService = {
  embed(text: string): Promise<{ model: string; vector: number[] } | null>;
};

export type MemoryStore = {
  create(input: MemoryInput): Promise<MemoryRecord>;
  list(options?: MemoryListOptions): Promise<MemoryRecord[]>;
  search(options: MemorySearchOptions): Promise<MemorySearchResult[]>;
  delete(memoryId: string): Promise<boolean>;
  export(): Promise<string>;
  runMaintenance(options?: MemoryMaintenanceOptions): Promise<MemoryMaintenanceReport>;
  reviewGovernance(options?: {
    now?: string;
    staleAfterDays?: number;
  }): Promise<MemoryGovernanceReport>;
};

export class MemoryValidationError extends Error {
  constructor(public readonly errors: MemoryValidationErrors) {
    super("Memory record is invalid.");
  }
}

export function createMemoryStore(options: {
  configDir: string;
  createId?: () => string;
  now?: () => Date;
  embeddingService?: MemoryEmbeddingService;
  chunkingService?: ChunkingService;
  reranker?: Reranker;
}): MemoryStore {
  const memoryPath = path.join(options.configDir, "memory-records.json");
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const chunkingService = options.chunkingService ?? createChunkingService();
  const reranker = options.reranker ?? createReranker();
  const maxContentLength = 8000;
  let mutationQueue: Promise<void> = Promise.resolve();

  async function withMutation<T>(operation: () => Promise<T>): Promise<T> {
    const current = mutationQueue.catch(() => undefined).then(operation);
    mutationQueue = current.then(
      () => undefined,
      () => undefined,
    );
    return current;
  }

  async function readStoredRecords(): Promise<StoredMemoryRecords> {
    try {
      const raw = await readFile(memoryPath, { encoding: "utf8" });
      const stored = JSON.parse(raw) as StoredMemoryRecords;
      return {
        schemaVersion: 1,
        records: Array.isArray(stored.records)
          ? stored.records.map(normalizeStoredRecord)
          : [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { schemaVersion: 1, records: [] };
      }

      throw error;
    }
  }

  async function writeStoredRecords(stored: StoredMemoryRecords) {
    await mkdir(options.configDir, { recursive: true });
    const temporary = `${memoryPath}.${process.pid}-${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(stored, null, 2)}\n`, {
        encoding: "utf8",
      });
      await rename(temporary, memoryPath);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  return {
    async create(input) {
      const normalized = normalizeMemoryInput(input);
      const validation = validateMemoryInput(input);

      if (!validation.valid) {
        throw new MemoryValidationError(validation.errors);
      }

      const timestamp = now().toISOString();
      const embedding =
        normalized.embedding ??
        (await createEmbedding(normalized, timestamp, options.embeddingService));
      const record: MemoryRecord = {
        id: createId(),
        ...normalized,
        ...(embedding ? { embedding } : {}),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      return withMutation(async () => {
        const stored = await readStoredRecords();
        await writeStoredRecords({
          schemaVersion: 1,
          records: [...stored.records, record],
        });

        return record;
      });
    },

    async list(listOptions) {
      const stored = await readStoredRecords();
      const filteredRecords =
        listOptions?.kind && listOptions.kind !== "all"
          ? stored.records.filter((record) => record.kind === listOptions.kind)
          : stored.records;
      const visibleRecords = listOptions?.includeArchived
        ? filteredRecords
        : filteredRecords.filter((record) => !record.archivedAt);

      return visibleRecords.slice(0, listOptions?.limit ?? visibleRecords.length);
    },

    async search(searchOptions) {
      const stored = await readStoredRecords();
      const scopedRecords = searchOptions.sessionId
        ? stored.records.filter(
            (record) =>
              record.kind !== "session" ||
              (record.source.type === "chat_session" &&
                record.source.sessionId === searchOptions.sessionId),
          )
        : stored.records;
      const queryEmbedding =
        searchOptions.queryEmbedding ??
        (await createQueryEmbedding(
          searchOptions.query,
          options.embeddingService,
        ));

      const results = searchMemoryRecords(scopedRecords, {
        ...searchOptions,
        ...(queryEmbedding ? { queryEmbedding } : {}),
      });

      // Apply reranking if there are results
      if (results.length > 1 && searchOptions.query) {
        return reranker.rerank(results, searchOptions.query, {
          topN: Math.min(results.length, 15),
        });
      }

      return results;
    },

    async delete(memoryId) {
      return withMutation(async () => {
        const stored = await readStoredRecords();
        const nextRecords = stored.records.filter(
          (record) => record.id !== memoryId,
        );

        if (nextRecords.length === stored.records.length) {
          return false;
        }

        await writeStoredRecords({
          schemaVersion: 1,
          records: nextRecords,
        });
        return true;
      });
    },

    async export() {
      const stored = await readStoredRecords();
      return exportMemoryRecords(stored.records, now().toISOString());
    },

    async runMaintenance(maintenanceOptions) {
      return withMutation(async () => {
        const stored = await readStoredRecords();
        const createdAt =
          maintenanceOptions?.createdAt ?? now().toISOString();
        const plan = createMemoryMaintenancePlan(stored.records, {
          ...maintenanceOptions,
          createdAt,
        });
        const createdMemories: MemoryRecord[] = [];
        const archivedSourceIds = new Set<string>();

        for (const draft of plan.drafts) {
          const normalized = normalizeMemoryInput(draft);
          const validation = validateMemoryInput(draft);

          if (!validation.valid) {
            continue;
          }

          const embedding =
            normalized.embedding ??
            (await createEmbedding(
              normalized,
              createdAt,
              options.embeddingService,
            ));
          const record: MemoryRecord = {
            id: createId(),
            ...normalized,
            ...(embedding ? { embedding } : {}),
            createdAt,
            updatedAt: createdAt,
          };

          createdMemories.push(record);
          for (const sourceId of draft.sourceIds) {
            archivedSourceIds.add(sourceId);
          }
        }

        const targetBySourceId = new Map<string, string>();
        for (const memory of createdMemories) {
          for (const sourceId of memory.consolidation?.sourceIds ?? []) {
            targetBySourceId.set(sourceId, memory.id);
          }
        }
        const archivedRecords = stored.records.map((record) => {
          const consolidatedInto = targetBySourceId.get(record.id);

          if (!consolidatedInto) {
            return record;
          }

          return {
            ...record,
            archivedAt: createdAt,
            archiveReason: "consolidated" as const,
            consolidatedInto,
            updatedAt: createdAt,
          };
        });

        if (createdMemories.length) {
          await writeStoredRecords({
            schemaVersion: 1,
            records: [...archivedRecords, ...createdMemories],
          });
        }

        return {
          scanned: plan.scanned,
          candidates: plan.candidates,
          consolidated: createdMemories.length,
          archived: archivedSourceIds.size,
          skipped: plan.drafts.length - createdMemories.length,
          createdAt,
          createdMemories,
        };
      });
    },

    async reviewGovernance(governanceOptions) {
      const stored = await readStoredRecords();
      return createMemoryGovernanceReport(stored.records, governanceOptions);
    },
  };
}

async function createEmbedding(
  input: { title: string; content: string; tags: string[] },
  embeddedAt: string,
  embeddingService: MemoryEmbeddingService | undefined,
): Promise<MemoryEmbedding | null> {
  if (!embeddingService) {
    return null;
  }

  try {
    const embedding = await embeddingService.embed(formatEmbeddingText(input));
    if (!embedding?.vector.length) {
      return null;
    }

    return {
      model: embedding.model,
      dimensions: embedding.vector.length,
      vector: embedding.vector,
      embeddedAt,
    };
  } catch {
    return null;
  }
}

async function createQueryEmbedding(
  query: string,
  embeddingService: MemoryEmbeddingService | undefined,
): Promise<number[] | null> {
  if (!query.trim() || !embeddingService) {
    return null;
  }

  try {
    const embedding = await embeddingService.embed(query);
    return embedding?.vector.length ? embedding.vector : null;
  } catch {
    return null;
  }
}

function formatEmbeddingText(input: {
  title: string;
  content: string;
  tags: string[];
}): string {
  return [input.title, input.tags.join(" "), input.content]
    .filter(Boolean)
    .join("\n");
}

function normalizeStoredRecord(record: MemoryRecord): MemoryRecord {
  return {
    id: record.id,
    ...normalizeMemoryInput(record),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.archivedAt ? { archivedAt: record.archivedAt } : {}),
    ...(record.archiveReason ? { archiveReason: record.archiveReason } : {}),
    ...(record.consolidatedInto
      ? { consolidatedInto: record.consolidatedInto }
      : {}),
  };
}
