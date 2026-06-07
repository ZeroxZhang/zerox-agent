#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const apiInfoPath = path.join(rootDir, ".api_info.md");
const { parseApiInfoProfiles, redactApiInfoProfile } = require(
  "../dist-electron/shared/apiInfoProfiles.js",
);
const { createOpenAiCompatibleClient } = require(
  "../dist-electron/main/openAiCompatibleClient.js",
);

if (!existsSync(apiInfoPath)) {
  console.error("没有找到 .api_info.md，无法运行真实模型冒烟。");
  process.exit(1);
}

const markdown = await readFile(apiInfoPath, "utf8");
const profiles = parseApiInfoProfiles(markdown);

if (!profiles.length) {
  console.error(".api_info.md 中没有解析到 base_url、api_key 和 model。");
  process.exit(1);
}

const client = createOpenAiCompatibleClient({ timeoutMs: 60_000 });
const results = [];

for (const profile of profiles) {
  const startedAt = Date.now();
  try {
    const reply = await client.complete({
      baseUrl: profile.baseUrl,
      apiKey: profile.apiKey,
      model: profile.model,
      temperature: 0,
      maxTokens: 32,
      messages: [
        {
          role: "system",
          content: "你正在进行本地桌面智能体连通性测试。",
        },
        {
          role: "user",
          content: "请只回复 OK。",
        },
      ],
    });

    results.push({
      ...redactApiInfoProfile(profile),
      ok: true,
      latencyMs: Date.now() - startedAt,
      replyPreview: reply.slice(0, 80),
    });
  } catch (error) {
    results.push({
      ...redactApiInfoProfile(profile),
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: sanitizeError(
        error instanceof Error ? error.message : String(error),
        profiles,
      ),
    });
  }
}

const passed = results.filter((result) => result.ok).length;
const report = {
  checkedAt: new Date().toISOString(),
  source: ".api_info.md",
  total: results.length,
  passed,
  failed: results.length - passed,
  results,
};

console.log(JSON.stringify(report, null, 2));

if (passed === 0) {
  process.exit(1);
}

function sanitizeError(message, apiProfiles) {
  return apiProfiles.reduce(
    (current, profile) => current.replaceAll(profile.apiKey, "[REDACTED]"),
    message,
  );
}
