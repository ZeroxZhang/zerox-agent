import type { MemoryStore } from "./memoryStore";
import {
  formatMemoryRecallContext,
  recallMemoriesWithBudget,
} from "./memoryRecall";

export type ProceduralMemoryStore = Partial<Pick<MemoryStore, "search">>;

export async function buildProceduralMemoryPromptContext(options: {
  memoryStore?: ProceduralMemoryStore;
  taskName: string;
  skillName: string;
  skillDescription: string;
  limit?: number;
}): Promise<string | null> {
  const memoryStore = options.memoryStore;
  if (!memoryStore?.search) {
    return null;
  }

  const results = await recallMemoriesWithBudget({
    memoryStore: { search: memoryStore.search },
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

  return formatMemoryRecallContext(
    results.filter(
      (result) =>
        result.record.kind === "procedural" && !result.record.archivedAt,
    ),
    {
      heading: "相关流程记忆（来自已审核学习；优先参考，但仍需结合当前任务判断）：",
      maxCharsPerMemory: 600,
      maxTotalRecallChars: 1_800,
    },
  );
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
