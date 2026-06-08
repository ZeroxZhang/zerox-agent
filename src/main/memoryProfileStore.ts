import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MemoryRecord } from "../shared/memory";
import type { MemoryProfileDocument } from "../shared/memoryProfile";

export type MemoryProfileStore = {
  read(): Promise<MemoryProfileDocument>;
  save(content: string): Promise<MemoryProfileDocument>;
  updateFromMemories(memories: MemoryRecord[]): Promise<void>;
};

export function createMemoryProfileStore(options: {
  configDir: string;
  now?: () => Date;
}): MemoryProfileStore {
  const profilePath = path.join(options.configDir, "memory-persona.md");
  const now = options.now ?? (() => new Date());

  return {
    async read() {
      const updatedAt = now().toISOString();
      const content =
        (await readExistingProfile(profilePath)) ||
        formatProfile(updatedAt, []);

      return {
        content,
        updatedAt,
      };
    },

    async save(content) {
      const updatedAt = now().toISOString();
      await mkdir(options.configDir, { recursive: true });
      await writeFile(profilePath, content, "utf8");

      return {
        content,
        updatedAt,
      };
    },

    async updateFromMemories(memories) {
      const preferenceMemories = memories.filter(isPreferenceMemory);
      const existing = await readExistingProfile(profilePath);
      const existingMemoryIds = new Set(extractMemoryIds(existing));
      const preferenceLines = [
        ...extractPreferenceLines(existing),
        ...preferenceMemories
          .filter((memory) => !existingMemoryIds.has(memory.id))
          .map((memory) => `- [${memory.id}] ${memory.content.trim()}`),
      ];

      await mkdir(options.configDir, { recursive: true });
      await writeFile(
        profilePath,
        formatProfile(now().toISOString(), preferenceLines),
        "utf8",
      );
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
    if (line.startsWith("## ")) {
      break;
    }

    if (line.startsWith("- [")) {
      preferenceLines.push(line);
    }
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
