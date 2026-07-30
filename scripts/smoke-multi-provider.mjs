#!/usr/bin/env node
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  listProviderDescriptors,
  requireProviderDescriptor,
} = require("../dist-electron/main/providers/providerRegistry.js");
const {
  listModelCatalogEntries,
} = require("../dist-electron/main/providers/modelMatrix.js");
const {
  createProvider,
  resolveProviderBaseUrl,
} = require("../dist-electron/main/providers/providerFactory.js");

const expectedKinds = [
  "openai",
  "anthropic",
  "gemini",
  "bedrock",
  "vertex",
  "zai",
  "deepseek",
  "kimi",
  "minimax",
  "qwen",
  "xai",
  "mistral",
  "meta",
  "together",
  "fireworks",
  "openrouter",
  "ollama",
];

const descriptors = listProviderDescriptors();
const entries = listModelCatalogEntries();
const descriptorKinds = new Set(descriptors.map((descriptor) => descriptor.kind));
const catalogKinds = new Set(entries.map((entry) => entry.providerKind));
const missingDescriptors = expectedKinds.filter(
  (kind) => !descriptorKinds.has(kind),
);
const missingCatalogKinds = expectedKinds.filter(
  (kind) => !catalogKinds.has(kind),
);

if (missingDescriptors.length || missingCatalogKinds.length) {
  console.error(
    JSON.stringify(
      { ok: false, missingDescriptors, missingCatalogKinds },
      null,
      2,
    ),
  );
  process.exit(1);
}

let unknownProviderRejected = false;
try {
  requireProviderDescriptor("unknown-provider");
} catch {
  unknownProviderRejected = true;
}
if (!unknownProviderRejected) {
  console.error("Unknown providers must fail closed.");
  process.exit(1);
}

if (process.env.ZEROX_PROVIDER_SMOKE !== "1") {
  console.log(
    JSON.stringify(
      {
        ok: true,
        static: {
          providers: expectedKinds.length,
          catalogEntries: entries.length,
          unknownProviderRejected,
        },
        live: {
          status: "skipped",
          reason:
            "Set ZEROX_PROVIDER_SMOKE=1 and ZEROX_PROVIDER_SMOKE_CASES to opt in.",
        },
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const cases = parseCases(process.env.ZEROX_PROVIDER_SMOKE_CASES);
if (!cases.length) {
  console.error(
    "ZEROX_PROVIDER_SMOKE_CASES must be a non-empty JSON array when live smoke is enabled.",
  );
  process.exit(1);
}

const results = [];
for (const smokeCase of cases) {
  const startedAt = Date.now();
  const secrets = resolveSecrets(smokeCase.secretEnvs);
  const apiKey =
    secrets.apiKey ??
    secrets.bedrockApiKey ??
    secrets.vertexApiKey ??
    "";
  const baseUrl = resolveProviderBaseUrl(
    smokeCase.providerKind,
    smokeCase.values,
  );
  try {
    const provider = createProvider({
      providerKind: smokeCase.providerKind,
      apiKey,
      chatModel: smokeCase.modelId,
      connectionValues: smokeCase.values,
      secrets,
      baseUrl,
    });
    const response = await provider.complete({
      model: smokeCase.modelId,
      apiKey,
      baseUrl,
      temperature: 0,
      maxTokens: 16,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Reply with exactly OK." }],
        },
      ],
    });
    results.push({
      name: smokeCase.name,
      providerKind: smokeCase.providerKind,
      modelId: smokeCase.modelId,
      ok: Boolean(response.content),
      latencyMs: Date.now() - startedAt,
    });
  } catch (error) {
    results.push({
      name: smokeCase.name,
      providerKind: smokeCase.providerKind,
      modelId: smokeCase.modelId,
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: redact(
        error instanceof Error ? error.message : String(error),
        Object.values(secrets),
      ),
    });
  }
}

console.log(
  JSON.stringify(
    {
      ok: results.every((result) => result.ok),
      static: {
        providers: expectedKinds.length,
        catalogEntries: entries.length,
        unknownProviderRejected,
      },
      live: {
        status: "completed",
        total: results.length,
        passed: results.filter((result) => result.ok).length,
        results,
      },
    },
    null,
    2,
  ),
);

if (results.some((result) => !result.ok)) {
  process.exit(1);
}

function parseCases(raw) {
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("ZEROX_PROVIDER_SMOKE_CASES must be a JSON array.");
  }
  return parsed.map((candidate, index) => {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      typeof candidate.providerKind !== "string" ||
      !expectedKinds.includes(candidate.providerKind) ||
      typeof candidate.modelId !== "string" ||
      !candidate.modelId.trim()
    ) {
      throw new Error(`Invalid provider smoke case at index ${index}.`);
    }
    return {
      name:
        typeof candidate.name === "string" && candidate.name.trim()
          ? candidate.name.trim()
          : `case-${index + 1}`,
      providerKind: candidate.providerKind,
      modelId: candidate.modelId.trim(),
      values:
        candidate.values &&
        typeof candidate.values === "object" &&
        !Array.isArray(candidate.values)
          ? candidate.values
          : {},
      secretEnvs:
        candidate.secretEnvs &&
        typeof candidate.secretEnvs === "object" &&
        !Array.isArray(candidate.secretEnvs)
          ? candidate.secretEnvs
          : {},
    };
  });
}

function resolveSecrets(secretEnvs) {
  return Object.fromEntries(
    Object.entries(secretEnvs).map(([secretName, environmentKey]) => {
      if (typeof environmentKey !== "string" || !environmentKey) {
        throw new Error(`Invalid environment variable for ${secretName}.`);
      }
      const value = process.env[environmentKey];
      if (!value) {
        throw new Error(
          `Required environment variable ${environmentKey} is not set.`,
        );
      }
      return [secretName, value];
    }),
  );
}

function redact(message, secrets) {
  return secrets.reduce(
    (current, secret) =>
      secret ? current.replaceAll(secret, "[REDACTED]") : current,
    message,
  );
}
