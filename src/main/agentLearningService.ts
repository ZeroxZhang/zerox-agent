import type { AgentLearningStore } from "./agentLearningStore";
import type { MemoryStore } from "./memoryStore";
import type { AgentLearningCandidate } from "../shared/agentLearning";

export type ApplyAcceptedLearningReport = {
  scanned: number;
  applied: number;
  skipped: number;
  memoryIds: string[];
};

export type AgentLearningService = {
  applyAcceptedLearning(): Promise<ApplyAcceptedLearningReport>;
};

export function createAgentLearningService(options: {
  learningStore: Pick<AgentLearningStore, "list" | "setStatus">;
  memoryStore: Pick<MemoryStore, "create">;
}): AgentLearningService {
  return {
    async applyAcceptedLearning() {
      const accepted = await options.learningStore.list({ status: "accepted" });
      const memoryIds: string[] = [];
      let skipped = 0;

      for (const candidate of accepted) {
        if (candidate.type !== "procedural_memory") {
          skipped += 1;
          continue;
        }

        const memory = await options.memoryStore.create({
          kind: "procedural",
          title: createProceduralTitle(candidate),
          content: [
            `Claim: ${candidate.claim}`,
            `Recommended action: ${candidate.recommendedAction}`,
            `Risk: ${candidate.risk}`,
          ].join("\n"),
          tags: ["agent-learning", "procedural-memory"],
          source: { type: "agent_run", refId: candidate.sourceRunId },
          importance: 4,
        });
        memoryIds.push(memory.id);
        await options.learningStore.setStatus(candidate.id, "applied");
      }

      return {
        scanned: accepted.length,
        applied: memoryIds.length,
        skipped,
        memoryIds,
      };
    },
  };
}

function createProceduralTitle(candidate: AgentLearningCandidate): string {
  return `Procedure: ${candidate.claim.replace(/\.$/, "")}`;
}
