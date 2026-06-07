import { describe, expect, it } from "vitest";
import {
  parseApiInfoProfiles,
  redactApiInfoProfile,
} from "./apiInfoProfiles";

describe("api info profiles", () => {
  it("parses OpenAI-compatible profiles from the local api info markdown", () => {
    const profiles = parseApiInfoProfiles(`# 阿里百炼coding plan
{
base_url = "https://coding.dashscope.aliyuncs.com/v1"
api_key = sk-ali-secret
model = "qwen3.6-plus"
}

# kimi code coding plan
{base_url = "https://api.kimi.com/coding/v1"
api_key = kimi-secret
model = "Kimi-k2.6"

选项 设置值 说明
Enable streaming ✓ 启用流式输出
}`);

    expect(profiles).toEqual([
      {
        name: "阿里百炼coding plan",
        baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
        apiKey: "sk-ali-secret",
        model: "qwen3.6-plus",
      },
      {
        name: "kimi code coding plan",
        baseUrl: "https://api.kimi.com/coding/v1",
        apiKey: "kimi-secret",
        model: "Kimi-k2.6",
      },
    ]);
  });

  it("redacts api keys before profiles are printed", () => {
    const redacted = redactApiInfoProfile({
      name: "阿里百炼coding plan",
      baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
      apiKey: "sk-ali-secret",
      model: "qwen3.6-plus",
    });

    expect(redacted).toEqual({
      name: "阿里百炼coding plan",
      baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
      model: "qwen3.6-plus",
      hasApiKey: true,
    });
    expect(JSON.stringify(redacted)).not.toContain("sk-ali-secret");
  });
});
