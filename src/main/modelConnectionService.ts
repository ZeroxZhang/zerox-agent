import type { ModelSettingsStore } from "./modelSettingsStore";
import type { ChatClient } from "./openAiCompatibleClient";
import type { TestModelConnectionResult } from "../shared/modelSettings";

export type ModelConnectionService = {
  testConnection(): Promise<TestModelConnectionResult>;
};

export function createModelConnectionService(options: {
  modelSettingsStore: Pick<ModelSettingsStore, "load" | "getApiKey">;
  chatClient: ChatClient;
  now?: () => Date;
}): ModelConnectionService {
  const now = options.now ?? (() => new Date());

  return {
    async testConnection() {
      const settings = await options.modelSettingsStore.load();
      const apiKey = await options.modelSettingsStore.getApiKey();

      if (!settings.chatModel || !apiKey) {
        return {
          ok: false,
          message: "模型配置不完整：请先保存 base URL、对话模型和 API Key。",
        };
      }

      const startedAt = now();
      try {
        const response = await options.chatClient.complete({
          baseUrl: settings.baseUrl,
          apiKey,
          model: settings.chatModel,
          temperature: 0,
          maxTokens: Math.min(settings.maxTokens, 32),
          messages: [
            {
              role: "system",
              content: "你正在进行桌面智能体的模型连通性测试。",
            },
            {
              role: "user",
              content: "请只回复 OK。",
            },
          ],
        });
        const checkedAt = now();

        return {
          ok: true,
          message: "模型连接测试成功。",
          model: settings.chatModel,
          latencyMs: Math.max(0, checkedAt.getTime() - startedAt.getTime()),
          checkedAt: checkedAt.toISOString(),
          replyPreview: (response.content ?? "").slice(0, 120),
        };
      } catch (error) {
        return {
          ok: false,
          message: `模型连接测试失败：${
            error instanceof Error ? error.message : "未知错误"
          }`,
        };
      }
    },
  };
}
