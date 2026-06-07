import type { MemorySearchResult } from "../shared/memory";
import type { MemoryStore } from "./memoryStore";

export type ProceduralMemoryStore = Partial<Pick<MemoryStore, "search">>;

export async function buildProceduralMemoryPromptContext(options: {
  memoryStore?: ProceduralMemoryStore;
  taskName: string;
  skillName: string;
  skillDescription: string;
  limit?: number;
}): Promise<string | null> {
  if (!options.memoryStore?.search) {
    return null;
  }

  try {
    const results = await options.memoryStore.search({
      query: [
        options.taskName,
        options.skillName,
        options.skillDescription,
      ]
        .filter(Boolean)
        .join(" "),
      kind: "procedural",
      limit: options.limit ?? 3,
    });

    return formatProceduralMemoryContext(results);
  } catch {
    return null;
  }
}

export function appendProceduralMemoryContext(
  prompt: string,
  context: string | null,
): string {
  if (!context) {
    return prompt;
  }

  return [prompt, "", context].join("\n");
}

function formatProceduralMemoryContext(
  results: MemorySearchResult[],
): string | null {
  const visibleResults = results.filter(
    (result) => result.record.kind === "procedural" && !result.record.archivedAt,
  );

  if (!visibleResults.length) {
    return null;
  }

  return [
    "相关流程记忆（来自已审核学习；优先参考，但仍需结合当前任务判断）：",
    ...visibleResults.map((result, index) => {
      const title = result.record.title.trim();
      const content = truncateForPrompt(result.record.content.trim(), 600);
      return `${index + 1}. ${title ? `${title}: ` : ""}${content}`;
    }),
  ].join("\n");
}

function truncateForPrompt(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}...`;
}
