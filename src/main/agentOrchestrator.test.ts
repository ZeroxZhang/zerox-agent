import { describe, expect, it } from "vitest";
import { createAgentOrchestrator } from "./agentOrchestrator";
import { ResponseBodyLimitError } from "./fetchWithTimeout";

describe("agent orchestrator", () => {
  it("does not replace a decomposition response limit with an empty plan", async () => {
    const limit = new ResponseBodyLimitError("LLM", 32);
    let runTaskCalls = 0;
    const orchestrator = createAgentOrchestrator({
      chatClient: {
        async complete() {
          throw new Error("wrapped", { cause: limit });
        },
      },
      runTask: (async () => {
        runTaskCalls += 1;
        throw new Error("unused");
      }) as never,
      getModelProfile: async () => ({
        baseUrl: "http://localhost",
        apiKey: "test",
        model: "test",
        temperature: 0,
        maxTokens: 2000,
      }),
    });

    await expect(orchestrator.execute("复杂任务", [{
      name: "test-skill",
      displayName: "Test Skill",
      description: "test",
    }])).rejects.toBe(limit);
    expect(runTaskCalls).toBe(0);
  });
});
