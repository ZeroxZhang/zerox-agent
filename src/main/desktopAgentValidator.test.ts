import { describe, expect, it } from "vitest";
import { runDesktopAgentValidation } from "./desktopAgentValidator";
import type { ModelSettingsInput } from "../shared/modelSettings";

describe("desktop agent validator", () => {
  it("saves profiles from api info and stops after the first passing validation", async () => {
    const savedInputs: ModelSettingsInput[] = [];
    const validationCalls: string[] = [];
    const result = await runDesktopAgentValidation({
      apiInfoMarkdown: `# first
base_url = "https://bad.example.com/v1"
api_key = bad-key
model = "bad-model"

# second
base_url = "https://ok.example.com/v1"
api_key = ok-key
model = "ok-model"`,
      modelSettingsStore: {
        async save(input) {
          savedInputs.push(input);
          return {
            baseUrl: input.baseUrl,
            chatModel: input.chatModel,
            embeddingModel: input.embeddingModel,
            temperature: input.temperature,
            maxTokens: input.maxTokens,
            hasApiKey: true,
            updatedAt: "2026-06-07T08:00:00.000Z",
          };
        },
      },
      validateAgent: async () => {
        const saved = savedInputs.at(-1)!;
        validationCalls.push(saved.chatModel);
        return {
          ready: saved.chatModel === "ok-model",
          model: { ready: true, message: "模型配置已就绪。" },
          skill: { ready: true, message: "内置文件整理技能已就绪。" },
          task: {
            ready: true,
            created: false,
            message: "默认文件整理任务已存在。",
            task: null,
          },
          connection: {
            ready: saved.chatModel === "ok-model",
            checked: true,
            latencyMs: 12,
            message:
              saved.chatModel === "ok-model"
                ? "模型连接测试成功。"
                : "模型连接失败。",
          },
          run: {
            ready: saved.chatModel === "ok-model",
            ran: saved.chatModel === "ok-model",
            run: null,
            message:
              saved.chatModel === "ok-model"
                ? "默认文件整理任务已验收运行。"
                : "模型连接未通过，暂不运行默认任务。",
          },
        };
      },
      now: () => new Date("2026-06-07T08:00:00.000Z"),
    });

    expect(result.ok).toBe(true);
    expect(result.selectedProfile?.model).toBe("ok-model");
    expect(result.attempts).toEqual([
      expect.objectContaining({
        profile: {
          name: "first",
          baseUrl: "https://bad.example.com/v1",
          model: "bad-model",
          hasApiKey: true,
        },
        ready: false,
      }),
      expect.objectContaining({
        profile: {
          name: "second",
          baseUrl: "https://ok.example.com/v1",
          model: "ok-model",
          hasApiKey: true,
        },
        ready: true,
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("ok-key");
    expect(savedInputs).toEqual([
      expect.objectContaining({
        baseUrl: "https://bad.example.com/v1",
        chatModel: "bad-model",
        apiKey: "bad-key",
        embeddingModel: "",
        temperature: 0.2,
        maxTokens: 8192,
      }),
      expect.objectContaining({
        baseUrl: "https://ok.example.com/v1",
        chatModel: "ok-model",
        apiKey: "ok-key",
      }),
    ]);
    expect(validationCalls).toEqual(["bad-model", "ok-model"]);
  });

  it("fails without leaking secrets when no api profiles can validate", async () => {
    const result = await runDesktopAgentValidation({
      apiInfoMarkdown: `# only
base_url = "https://bad.example.com/v1"
api_key = very-secret
model = "bad-model"`,
      modelSettingsStore: {
        async save() {
          throw new Error("Cannot save very-secret");
        },
      },
      validateAgent: async () => {
        throw new Error("not reached");
      },
      now: () => new Date("2026-06-07T08:00:00.000Z"),
    });

    expect(result.ok).toBe(false);
    expect(result.selectedProfile).toBeNull();
    expect(result.attempts[0]).toMatchObject({
      ready: false,
      error: "Cannot save [REDACTED]",
    });
    expect(JSON.stringify(result)).not.toContain("very-secret");
  });
});
