import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MemoryRecord } from "../shared/memory";
import type { MemoryProfileDocument } from "../shared/memoryProfile";
import type { StorageBackend, Storage, MemoryProfileRepository } from "../shared/storageContract";
import { createMemoryProfileRepository } from "./storage/repositories/index";
import {
  createFailureVisibleSerialQueue,
  type PersistenceQueueDrainOptions,
} from "./failureVisibleSerialQueue";

export type MemoryProfileStore = {
  read(): Promise<MemoryProfileDocument>;
  save(content: string): Promise<MemoryProfileDocument>;
  updateFromMemories(memories: MemoryRecord[]): Promise<void>;
  flushShadowWrites(options?: PersistenceQueueDrainOptions): Promise<void>;
};

export interface MemoryProfileStoreOptions {
  configDir: string;
  now?: () => Date;
  /** Storage backend (default "json" — legacy behavior, zero regression). */
  backend?: StorageBackend;
  /** Storage instance required when backend is sqlite/dual. */
  storage?: Storage;
}

export function createMemoryProfileStore(options: MemoryProfileStoreOptions): MemoryProfileStore {
  const backend: StorageBackend = options.backend ?? "json";
  const profilePath = path.join(options.configDir, "memory-persona.md");
  const now = options.now ?? (() => new Date());

  const jsonImpl: MemoryProfileStore = {
    async read() {
      const updatedAt = now().toISOString();
      const content = (await readExistingProfile(profilePath)) || formatProfile(updatedAt, []);
      return { content, updatedAt };
    },
    async save(content) {
      const updatedAt = now().toISOString();
      await mkdir(options.configDir, { recursive: true });
      await writeFile(profilePath, content, "utf8");
      return { content, updatedAt };
    },
    async updateFromMemories(memories) {
      const existing = await readExistingProfile(profilePath);
      await mkdir(options.configDir, { recursive: true });
      await writeFile(
        profilePath,
        updateProfileContent(existing, memories, now().toISOString()),
        "utf8",
      );
    },
    async flushShadowWrites() {
      return;
    },
  };

  if (backend === "json" || !options.storage) {
    return jsonImpl;
  }

  // --- sqlite / dual ---
  const repo: MemoryProfileRepository = createMemoryProfileRepository(options.storage);
  const shadowQueue = createFailureVisibleSerialQueue();
  return {
    async read() {
      return repo.read();
    },
    async save(content) {
      shadowQueue.assertOpen();
      const doc = repo.save(content);
      if (backend === "dual") {
        void shadowQueue.enqueue(() => jsonImpl.save(content));
      }
      return doc;
    },
    async updateFromMemories(memories) {
      shadowQueue.assertOpen();
      const current = repo.read();
      const content = updateProfileContent(
        current.content,
        memories,
        now().toISOString(),
      );
      repo.save(content);
      if (backend === "dual") {
        void shadowQueue.enqueue(() => jsonImpl.save(content));
      }
    },
    async flushShadowWrites(flushOptions) {
      await shadowQueue.drain(flushOptions);
    },
  };
}

async function readExistingProfile(profilePath: string): Promise<string> {
  try {
    return await readFile(profilePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

function isPreferenceMemory(memory: MemoryRecord): boolean {
  return (
    (memory.kind === "semantic" || memory.kind === "core") &&
    memory.tags.includes("preference") &&
    Boolean(memory.content.trim())
  );
}

function extractMemoryIds(profile: string): string[] {
  return [...profile.matchAll(/^- \[([^\]]+)] /gm)].map((match) => match[1]);
}

function extractPreferenceLines(profile: string): string[] {
  const lines = profile.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === "## Preferences");
  if (headingIndex < 0) {
    return [];
  }
  const preferenceLines: string[] = [];
  for (const line of lines.slice(headingIndex + 1)) {
    if (line.startsWith("## ")) break;
    if (line.startsWith("- [")) preferenceLines.push(line);
  }
  return preferenceLines;
}

function formatProfile(updatedAt: string, preferenceLines: string[]): string {
  return [
    "# Memory Persona",
    "",
    `Updated: ${updatedAt}`,
    "",
    "## Preferences",
    ...preferenceLines,
    "",
  ].join("\n");
}

function updateProfileContent(
  existing: string,
  memories: MemoryRecord[],
  updatedAt: string,
): string {
  const existingMemoryIds = new Set(extractMemoryIds(existing));
  const preferenceLines = [
    ...extractPreferenceLines(existing),
    ...memories
      .filter(isPreferenceMemory)
      .filter((memory) => !existingMemoryIds.has(memory.id))
      .map((memory) => `- [${memory.id}] ${memory.content.trim()}`),
  ];
  return formatProfile(updatedAt, preferenceLines);
}
