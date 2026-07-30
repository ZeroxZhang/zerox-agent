import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createModelSettingsStore,
  ModelSettingsValidationError,
  type SecretVault,
} from "./modelSettingsStore";

class FakeSecretVault implements SecretVault {
  encrypt(value: string): string {
    return `encrypted:${Buffer.from(value, "utf8").toString("base64")}`;
  }

  decrypt(value: string): string {
    return Buffer.from(value.replace("encrypted:", ""), "base64").toString("utf8");
  }

  isAvailable(): boolean {
    return true;
  }
}

describe("model settings store", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "building-agent-settings-"));
  });

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  it("persists public settings without writing the API key in plaintext", async () => {
    const store = createModelSettingsStore({
      configDir: tempDir,
      vault: new FakeSecretVault(),
    });

    const saved = await store.save({
      baseUrl: "https://api.example.com/v1",
      chatModel: "example-chat",
      embeddingModel: "example-embedding",
      apiKey: "sk-secret-value",
      temperature: 0.4,
      maxTokens: 8192,
    });

    expect(saved).toMatchObject({
      baseUrl: "https://api.example.com/v1",
      chatModel: "example-chat",
      embeddingModel: "example-embedding",
      hasApiKey: true,
      maxTokens: 8192,
      temperature: 0.4,
    });

    const rawFile = await readFile(path.join(tempDir, "model-settings.json"), {
      encoding: "utf8",
    });
    expect(rawFile).not.toContain("sk-secret-value");
    expect(rawFile).toContain("encrypted:");

    await expect(store.getApiKey()).resolves.toBe("sk-secret-value");
  });

  it("allows profiles without an embedding model so memory can fall back later", async () => {
    const store = createModelSettingsStore({
      configDir: tempDir,
      vault: new FakeSecretVault(),
    });

    const saved = await store.save({
      baseUrl: "https://api.example.com/v1",
      chatModel: "example-chat",
      embeddingModel: "",
      apiKey: "sk-secret-value",
      temperature: 0.2,
      maxTokens: 8192,
    });

    expect(saved.embeddingModel).toBe("");
    expect(saved.hasApiKey).toBe(true);
  });

  it("keeps the existing encrypted key when saving non-secret fields", async () => {
    const store = createModelSettingsStore({
      configDir: tempDir,
      vault: new FakeSecretVault(),
    });

    await store.save({
      baseUrl: "https://api.example.com/v1",
      chatModel: "first-chat",
      embeddingModel: "first-embedding",
      apiKey: "sk-original",
      temperature: 0.2,
      maxTokens: 4096,
    });

    const updated = await store.save({
      baseUrl: "https://api.example.com/v1",
      chatModel: "second-chat",
      embeddingModel: "first-embedding",
      apiKey: "",
      temperature: 0.1,
      maxTokens: 2048,
    });

    expect(updated.hasApiKey).toBe(true);
    await expect(store.getApiKey()).resolves.toBe("sk-original");
  });

  it("never reuses a legacy connection key when switching providers", async () => {
    let id = 0;
    const store = createModelSettingsStore({
      configDir: tempDir,
      vault: new FakeSecretVault(),
      createId: () => String(++id),
    });

    await store.save({
      providerId: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      chatModel: "gpt-test",
      embeddingModel: "",
      apiKey: "openai-only-secret",
      temperature: 0.2,
      maxTokens: 4096,
    });
    const openAiConnectionId = (await store.loadCatalog()).connections[0]!.id;

    await expect(
      store.save({
        providerId: "deepseek",
        baseUrl: "https://api.deepseek.com",
        chatModel: "deepseek-test",
        embeddingModel: "",
        apiKey: "",
        temperature: 0.2,
        maxTokens: 4096,
      }),
    ).rejects.toBeInstanceOf(ModelSettingsValidationError);
    await expect(store.getApiKey()).resolves.toBe("openai-only-secret");

    await store.save({
      providerId: "deepseek",
      baseUrl: "https://api.deepseek.com",
      chatModel: "deepseek-test",
      embeddingModel: "",
      apiKey: "deepseek-only-secret",
      temperature: 0.2,
      maxTokens: 4096,
    });

    const catalog = await store.loadCatalog();
    expect(catalog.connections.map((connection) => connection.providerKind)).toEqual(
      expect.arrayContaining(["openai", "deepseek"]),
    );
    await expect(store.getApiKey()).resolves.toBe("deepseek-only-secret");
    await expect(store.resolveConnection(openAiConnectionId)).resolves.toMatchObject({
      providerKind: "openai",
      secrets: { apiKey: "openai-only-secret" },
    });
  });

  it("migrates schema v1 to stable connection and profile ids atomically and idempotently", async () => {
    await writeFile(
      path.join(tempDir, "model-settings.json"),
      JSON.stringify({
        schemaVersion: 1,
        baseUrl: "https://legacy.example/v1",
        chatModel: "legacy-chat",
        embeddingModel: "legacy-embedding",
        encryptedApiKey: new FakeSecretVault().encrypt("legacy-secret"),
        temperature: 0.3,
        maxTokens: 4096,
        updatedAt: "2026-07-01T00:00:00.000Z",
        providerId: "openai-compatible",
      }),
    );
    const store = createModelSettingsStore({
      configDir: tempDir,
      vault: new FakeSecretVault(),
    });

    const first = await store.loadCatalog();
    const afterFirst = await readFile(path.join(tempDir, "model-settings.json"), "utf8");
    const second = await store.loadCatalog();
    const afterSecond = await readFile(path.join(tempDir, "model-settings.json"), "utf8");

    expect(first.connections[0]).toMatchObject({
      id: "connection_migrated_default",
      providerKind: "openai",
      hasCredential: true,
    });
    expect(first.defaultChatProfileId).toBe("profile_migrated_chat");
    expect(first.defaultEmbeddingProfileId).toBe("profile_migrated_embedding");
    expect(second).toEqual(first);
    expect(afterSecond).toBe(afterFirst);
    expect(afterFirst).not.toContain("legacy-secret");
    await expect(store.getApiKey()).resolves.toBe("legacy-secret");
  });

  it("supports multiple connections for one provider without crossing credentials", async () => {
    let id = 0;
    const store = createModelSettingsStore({
      configDir: tempDir,
      vault: new FakeSecretVault(),
      createId: () => String(++id),
    });
    const first = await store.saveConnection({
      name: "DeepSeek production",
      providerKind: "deepseek",
      credentialSource: "stored",
      values: {
        apiKey: "deepseek-production-key",
        baseUrl: "https://api.deepseek.com",
      },
    });
    const second = await store.saveConnection({
      name: "DeepSeek proxy",
      providerKind: "deepseek",
      credentialSource: "stored",
      values: {
        apiKey: "deepseek-proxy-key",
        baseUrl: "https://proxy.example/v1",
      },
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    const firstProfile = first.catalog.profiles.find(
      (profile) => profile.connectionId === first.connection.id,
    )!;
    const secondProfile = second.catalog.profiles.find(
      (profile) => profile.connectionId === second.connection.id,
    )!;
    const resolvedFirst = await store.resolveProfile(firstProfile.id);
    const resolvedSecond = await store.resolveProfile(secondProfile.id);
    expect(resolvedFirst.secrets.apiKey).toBe("deepseek-production-key");
    expect(resolvedSecond.secrets.apiKey).toBe("deepseek-proxy-key");
    expect(resolvedFirst.connectionValues.baseUrl).not.toBe(
      resolvedSecond.connectionValues.baseUrl,
    );
    const raw = await readFile(path.join(tempDir, "model-settings.json"), "utf8");
    expect(raw).not.toContain("deepseek-production-key");
    expect(raw).not.toContain("deepseek-proxy-key");
  });

  it("rejects changing the provider kind of a saved connection", async () => {
    const store = createModelSettingsStore({
      configDir: tempDir,
      vault: new FakeSecretVault(),
    });
    const created = await store.saveConnection({
      name: "OpenAI primary",
      providerKind: "openai",
      credentialSource: "stored",
      values: {
        apiKey: "openai-only-secret",
        baseUrl: "https://api.openai.com/v1",
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const changed = await store.saveConnection({
      id: created.connection.id,
      expectedRevision: created.connection.revision,
      name: "DeepSeek",
      providerKind: "deepseek",
      credentialSource: "stored",
      values: {
        baseUrl: "https://api.deepseek.com",
      },
    });

    expect(changed).toEqual({
      ok: false,
      message: "已保存连接不能切换服务商；请新建连接，避免凭证被发送到其他厂商端点。",
    });
    const profile = created.catalog.profiles.find(
      (candidate) => candidate.connectionId === created.connection.id,
    )!;
    const resolved = await store.resolveProfile(profile.id);
    expect(resolved.binding.providerKind).toBe("openai");
    expect(resolved.secrets.apiKey).toBe("openai-only-secret");
  });

  it("resolves a frozen binding from encrypted revision history after settings change", async () => {
    let id = 0;
    const store = createModelSettingsStore({
      configDir: tempDir,
      vault: new FakeSecretVault(),
      createId: () => String(++id),
    });
    const created = await store.saveConnection({
      name: "OpenAI primary",
      providerKind: "openai",
      values: {
        apiKey: "key-v1",
        baseUrl: "https://first.example/v1",
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const profile = created.catalog.profiles.find(
      (candidate) => candidate.connectionId === created.connection.id,
    )!;
    const frozen = await store.resolveProfile(profile.id);
    const updated = await store.saveConnection({
      id: created.connection.id,
      expectedRevision: created.connection.revision,
      name: "OpenAI primary",
      providerKind: "openai",
      values: {
        apiKey: "key-v2",
        baseUrl: "https://second.example/v1",
      },
    });
    expect(updated.ok).toBe(true);

    const historical = await store.resolveBinding(frozen.binding);
    const current = await store.resolveProfile(profile.id);
    expect(historical.connectionValues.baseUrl).toBe("https://first.example/v1");
    expect(historical.secrets.apiKey).toBe("key-v1");
    expect(current.connectionValues.baseUrl).toBe("https://second.example/v1");
    expect(current.secrets.apiKey).toBe("key-v2");
    expect(current.binding.revision).not.toBe(frozen.binding.revision);
  });

  it("retains frozen bindings across more than twenty settings revisions", async () => {
    const store = createModelSettingsStore({
      configDir: tempDir,
      vault: new FakeSecretVault(),
    });
    const created = await store.saveConnection({
      name: "Long-lived plan connection",
      providerKind: "openai",
      credentialSource: "stored",
      values: {
        apiKey: "key-v1",
        baseUrl: "https://revision-1.example/v1",
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const profile = created.catalog.profiles.find(
      (candidate) => candidate.connectionId === created.connection.id,
    )!;
    const frozen = await store.resolveProfile(profile.id);
    let revision = created.connection.revision;

    for (let index = 2; index <= 24; index += 1) {
      const updated = await store.saveConnection({
        id: created.connection.id,
        expectedRevision: revision,
        name: "Long-lived plan connection",
        providerKind: "openai",
        credentialSource: "stored",
        values: {
          apiKey: `key-v${index}`,
          baseUrl: `https://revision-${index}.example/v1`,
        },
      });
      expect(updated.ok).toBe(true);
      if (!updated.ok) return;
      revision = updated.connection.revision;
    }

    const historical = await store.resolveBinding(frozen.binding);
    expect(historical.connectionValues.baseUrl).toBe("https://revision-1.example/v1");
    expect(historical.secrets.apiKey).toBe("key-v1");
  });

  it("supports environment credentials without persisting their value", async () => {
    const previous = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = "environment-only-secret";
    try {
      const store = createModelSettingsStore({
        configDir: tempDir,
        vault: new FakeSecretVault(),
      });
      const result = await store.saveConnection({
        name: "DeepSeek env",
        providerKind: "deepseek",
        credentialSource: "environment",
        values: { baseUrl: "https://api.deepseek.com" },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const profile = result.catalog.profiles[0]!;
      const resolved = await store.resolveProfile(profile.id);
      expect(resolved.secrets.apiKey).toBe("environment-only-secret");
      expect(await readFile(path.join(tempDir, "model-settings.json"), "utf8")).not.toContain(
        "environment-only-secret",
      );
    } finally {
      if (previous === undefined) {
        delete process.env.DEEPSEEK_API_KEY;
      } else {
        process.env.DEEPSEEK_API_KEY = previous;
      }
    }
  });

  it("rejects environment credentials for providers without an environment key", async () => {
    const store = createModelSettingsStore({
      configDir: tempDir,
      vault: new FakeSecretVault(),
    });
    const result = await store.saveConnection({
      name: "Bedrock env",
      providerKind: "bedrock",
      credentialSource: "environment",
      values: {
        region: "us-east-1",
        authMethod: "profile",
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.credentialSource).toContain("不支持环境变量");
  });

  it("honors an explicit switch from stored to environment credentials", async () => {
    const previous = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = "environment-replacement-secret";
    try {
      const store = createModelSettingsStore({
        configDir: tempDir,
        vault: new FakeSecretVault(),
      });
      const created = await store.saveConnection({
        name: "DeepSeek",
        providerKind: "deepseek",
        credentialSource: "stored",
        values: {
          apiKey: "stored-secret",
          baseUrl: "https://api.deepseek.com",
        },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const updated = await store.saveConnection({
        id: created.connection.id,
        expectedRevision: created.connection.revision,
        name: "DeepSeek",
        providerKind: "deepseek",
        credentialSource: "environment",
        values: { baseUrl: "https://api.deepseek.com" },
      });
      expect(updated.ok).toBe(true);
      if (!updated.ok) return;
      expect(updated.connection).toMatchObject({
        credentialSource: "environment",
        hasCredential: true,
      });
      expect(updated.connection.keySetAt).toBeUndefined();
      const profile = updated.catalog.profiles.find(
        (candidate) => candidate.connectionId === created.connection.id,
      )!;
      await expect(store.resolveProfile(profile.id)).resolves.toMatchObject({
        secrets: { apiKey: "environment-replacement-secret" },
      });
      const raw = JSON.parse(await readFile(path.join(tempDir, "model-settings.json"), "utf8")) as {
        connections: Array<{
          id: string;
          encryptedSecrets: Record<string, string>;
        }>;
      };
      expect(
        raw.connections.find((connection) => connection.id === created.connection.id)
          ?.encryptedSecrets,
      ).toEqual({});
    } finally {
      if (previous === undefined) {
        delete process.env.DEEPSEEK_API_KEY;
      } else {
        process.env.DEEPSEEK_API_KEY = previous;
      }
    }
  });

  it("drops stale cloud secrets when the selected auth method changes", async () => {
    const store = createModelSettingsStore({
      configDir: tempDir,
      vault: new FakeSecretVault(),
    });
    const created = await store.saveConnection({
      name: "Bedrock",
      providerKind: "bedrock",
      credentialSource: "stored",
      values: {
        region: "us-east-1",
        authMethod: "iam",
        awsAccessKeyId: "AKIA_TEST",
        awsSecretAccessKey: "iam-secret",
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const updated = await store.saveConnection({
      id: created.connection.id,
      expectedRevision: created.connection.revision,
      name: "Bedrock",
      providerKind: "bedrock",
      credentialSource: "ambient",
      values: {
        region: "us-east-1",
        authMethod: "profile",
        awsProfile: "default",
      },
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.connection).toMatchObject({
      credentialSource: "ambient",
      hasCredential: true,
    });
    expect(updated.connection.keySetAt).toBeUndefined();
    const resolved = await store.resolveConnection(created.connection.id);
    expect(resolved.secrets).toEqual({});
  });

  it("requires a fresh Bedrock key when the credential target region changes", async () => {
    const store = createModelSettingsStore({
      configDir: tempDir,
      vault: new FakeSecretVault(),
    });
    const created = await store.saveConnection({
      name: "Bedrock east",
      providerKind: "bedrock",
      credentialSource: "stored",
      values: {
        region: "us-east-1",
        authMethod: "api_key",
        bedrockApiKey: "east-secret",
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await expect(
      store.saveConnection({
        id: created.connection.id,
        expectedRevision: created.connection.revision,
        name: "Bedrock west",
        providerKind: "bedrock",
        credentialSource: "stored",
        values: {
          region: "us-west-2",
          authMethod: "api_key",
          bedrockApiKey: "",
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      errors: { bedrockApiKey: expect.any(String) },
    });
    await expect(
      store.resolveConnection(created.connection.id),
    ).resolves.toMatchObject({
      connectionValues: { region: "us-east-1" },
      secrets: { bedrockApiKey: "east-secret" },
    });
  });

  it("requires fresh Vertex credentials when the project changes", async () => {
    const store = createModelSettingsStore({
      configDir: tempDir,
      vault: new FakeSecretVault(),
    });
    const created = await store.saveConnection({
      name: "Vertex project A",
      providerKind: "vertex",
      credentialSource: "stored",
      values: {
        project: "project-a",
        location: "global",
        authMethod: "service_account",
        serviceAccountJson: '{"project_id":"project-a"}',
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await expect(
      store.saveConnection({
        id: created.connection.id,
        expectedRevision: created.connection.revision,
        name: "Vertex project B",
        providerKind: "vertex",
        credentialSource: "stored",
        values: {
          project: "project-b",
          location: "global",
          authMethod: "service_account",
          serviceAccountJson: "",
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      errors: { serviceAccountJson: expect.any(String) },
    });
  });

  it("does not auto-select saved-only cloud connections before verification", async () => {
    const previous = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = "temporary-environment-secret";
    try {
      const store = createModelSettingsStore({
        configDir: tempDir,
        vault: new FakeSecretVault(),
      });
      const first = await store.saveConnection({
        name: "DeepSeek env",
        providerKind: "deepseek",
        credentialSource: "environment",
        values: { baseUrl: "https://api.deepseek.com" },
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.catalog.defaultChatProfileId).toBeNull();
      delete process.env.DEEPSEEK_API_KEY;

      const replacement = await store.saveConnection({
        name: "OpenAI stored",
        providerKind: "openai",
        credentialSource: "stored",
        values: {
          apiKey: "openai-secret",
          baseUrl: "https://api.openai.com/v1",
        },
      });
      expect(replacement.ok).toBe(true);
      if (!replacement.ok) return;
      expect(replacement.catalog.defaultChatProfileId).toBeNull();
    } finally {
      if (previous === undefined) {
        delete process.env.DEEPSEEK_API_KEY;
      } else {
        process.env.DEEPSEEK_API_KEY = previous;
      }
    }
  });

  it("blocks deleting model resources referenced by an active plan", async () => {
    const store = createModelSettingsStore({
      configDir: tempDir,
      vault: new FakeSecretVault(),
      isProfileReferenced: async () => true,
      isConnectionReferenced: async () => true,
    });
    const created = await store.saveConnection({
      name: "OpenAI",
      providerKind: "openai",
      values: {
        apiKey: "secret",
        baseUrl: "https://api.openai.com/v1",
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const profile = created.catalog.profiles[0]!;
    await expect(
      store.deleteProfile({
        id: profile.id,
        expectedRevision: profile.revision,
      }),
    ).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("计划引用"),
    });
  });

  it("creates the first custom model profile from the connection model id", async () => {
    const store = createModelSettingsStore({
      configDir: tempDir,
      vault: new FakeSecretVault(),
    });
    const created = await store.saveConnection({
      name: "Private Anthropic gateway",
      providerKind: "custom",
      credentialSource: "stored",
      values: {
        protocol: "anthropic",
        apiKey: "private-secret",
        baseUrl: "https://gateway.example",
        modelId: "private-claude",
      },
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.catalog.profiles).toContainEqual(
      expect.objectContaining({
        connectionId: created.connection.id,
        modelId: "private-claude",
        custom: true,
        capabilityOverrides: {
          tools: true,
          streaming: true,
        },
      }),
    );
    expect(created.catalog.defaultChatProfileId).toBeNull();
    const secondProfile = await store.saveProfile({
      name: "Private Claude 2",
      connectionId: created.connection.id,
      modelId: "private-claude-2",
      purpose: "chat",
    });
    expect(secondProfile).toMatchObject({
      ok: true,
      profile: {
        capabilityOverrides: {
          tools: true,
          streaming: true,
        },
      },
    });
  });

  it("keeps the auto-created custom profile aligned when the connection model changes", async () => {
    const store = createModelSettingsStore({
      configDir: tempDir,
      vault: new FakeSecretVault(),
    });
    const created = await store.saveConnection({
      name: "Private OpenAI gateway",
      providerKind: "custom",
      credentialSource: "stored",
      values: {
        protocol: "openai",
        apiKey: "private-secret",
        baseUrl: "https://gateway.example/v1",
        modelId: "private-model-v1",
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const originalProfile = created.catalog.profiles.find(
      (profile) => profile.connectionId === created.connection.id,
    )!;

    const updated = await store.saveConnection({
      id: created.connection.id,
      expectedRevision: created.connection.revision,
      name: "Private OpenAI gateway",
      providerKind: "custom",
      credentialSource: "stored",
      values: {
        protocol: "openai",
        apiKey: "",
        baseUrl: "https://gateway.example/v1",
        modelId: "private-model-v2",
      },
    });

    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    const updatedProfile = updated.catalog.profiles.find(
      (profile) => profile.id === originalProfile.id,
    )!;
    expect(updatedProfile).toMatchObject({
      name: "private-model-v2",
      modelId: "private-model-v2",
      revision: originalProfile.revision + 1,
    });
    await expect(store.resolveProfile(originalProfile.id)).resolves.toMatchObject(
      {
        binding: { modelId: "private-model-v2" },
      },
    );
  });

  it("persists revision-bound verification and clears credentials explicitly", async () => {
    const store = createModelSettingsStore({
      configDir: tempDir,
      vault: new FakeSecretVault(),
      now: (() => {
        const values = [
          "2026-07-31T01:00:00.000Z",
          "2026-07-31T01:00:01.000Z",
          "2026-07-31T01:00:02.000Z",
        ];
        return () => values.shift() ?? "2026-07-31T01:00:02.000Z";
      })(),
    });
    const created = await store.saveConnection({
      name: "Coding Plan",
      providerKind: "dashscope-coding",
      credentialSource: "stored",
      values: {
        apiKey: "coding-plan-secret",
        baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const recorded = await store.recordConnectionVerification(
      created.connection.id,
      created.connection.revision,
      {
        status: "passed",
        checkedAt: "2026-07-31T01:00:01.000Z",
        message: "模型连接测试成功。",
        latencyMs: 321,
      },
    );
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;
    expect(recorded.catalog.connections[0]?.verification).toEqual({
      status: "passed",
      checkedAt: "2026-07-31T01:00:01.000Z",
      message: "模型连接测试成功。",
      latencyMs: 321,
      connectionRevision: created.connection.revision,
    });
    const profile = created.catalog.profiles.find(
      (candidate) => candidate.connectionId === created.connection.id,
    )!;
    const frozenBinding = (await store.resolveProfile(profile.id)).binding;

    const cleared = await store.clearConnectionCredential({
      id: created.connection.id,
      expectedRevision: created.connection.revision,
    });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.catalog.connections[0]).toMatchObject({
      hasCredential: false,
      credentialSource: "none",
      revision: created.connection.revision + 1,
    });
    expect(cleared.catalog.connections[0]?.verification).toBeUndefined();
    await expect(store.resolveBinding(frozenBinding)).resolves.toMatchObject({
      secrets: {},
    });
    const raw = await readFile(path.join(tempDir, "model-settings.json"), "utf8");
    expect(raw).not.toContain("coding-plan-secret");
    const persisted = JSON.parse(raw) as {
      connections: Array<{
        id: string;
        encryptedSecrets: Record<string, string>;
        keySetAt?: string;
      }>;
      connectionHistory: Array<{
        id: string;
        encryptedSecrets: Record<string, string>;
        keySetAt?: string;
      }>;
    };
    for (const connection of [...persisted.connections, ...persisted.connectionHistory].filter(
      (candidate) => candidate.id === created.connection.id,
    )) {
      expect(connection.encryptedSecrets).toEqual({});
      expect(connection.keySetAt).toBeUndefined();
    }
  });

  it("requires a fresh credential when a saved connection changes its endpoint", async () => {
    const store = createModelSettingsStore({
      configDir: tempDir,
      vault: new FakeSecretVault(),
    });
    const created = await store.saveConnection({
      name: "Private gateway",
      providerKind: "custom",
      credentialSource: "stored",
      values: {
        protocol: "openai",
        apiKey: "original-secret",
        baseUrl: "https://first.example/v1",
        modelId: "private-model",
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const rejected = await store.saveConnection({
      id: created.connection.id,
      expectedRevision: created.connection.revision,
      name: "Private gateway",
      providerKind: "custom",
      credentialSource: "stored",
      values: {
        protocol: "openai",
        apiKey: "",
        baseUrl: "https://second.example/v1",
        modelId: "private-model",
      },
    });
    expect(rejected).toMatchObject({
      ok: false,
      errors: { apiKey: expect.any(String) },
    });
    await expect(
      store.resolveConnection(created.connection.id),
    ).resolves.toMatchObject({
      connectionValues: { baseUrl: "https://first.example/v1" },
      secrets: { apiKey: "original-secret" },
    });

    const updated = await store.saveConnection({
      id: created.connection.id,
      expectedRevision: created.connection.revision,
      name: "Private gateway",
      providerKind: "custom",
      credentialSource: "stored",
      values: {
        protocol: "openai",
        apiKey: "replacement-secret",
        baseUrl: "https://second.example/v1",
        modelId: "private-model",
      },
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    await expect(
      store.resolveConnection(created.connection.id),
    ).resolves.toMatchObject({
      connectionValues: { baseUrl: "https://second.example/v1" },
      secrets: { apiKey: "replacement-secret" },
    });
  });

  it("requires current verification before setting a default and invalidates it on edit", async () => {
    const store = createModelSettingsStore({
      configDir: tempDir,
      vault: new FakeSecretVault(),
    });
    const created = await store.saveConnection({
      name: "OpenAI",
      providerKind: "openai",
      credentialSource: "stored",
      values: {
        apiKey: "first-secret",
        baseUrl: "https://api.openai.com/v1",
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const profile = created.catalog.profiles.find(
      (candidate) => candidate.connectionId === created.connection.id,
    )!;

    await expect(
      store.setDefaultProfile("chat", profile.id),
    ).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("尚未通过"),
    });
    const verified = await store.recordConnectionVerification(
      created.connection.id,
      created.connection.revision,
      {
        status: "passed",
        checkedAt: "2026-07-31T00:00:00.000Z",
        message: "passed",
      },
    );
    expect(verified.ok).toBe(true);
    const profileVerified = await store.recordProfileVerification(
      profile.id,
      profile.revision,
      created.connection.revision,
      {
        status: "passed",
        checkedAt: "2026-07-31T00:00:00.000Z",
        message: "passed",
      },
    );
    expect(profileVerified.ok).toBe(true);
    await expect(
      store.setDefaultProfile("chat", profile.id),
    ).resolves.toMatchObject({ ok: true });
    const profileFailed = await store.recordProfileVerification(
      profile.id,
      profile.revision,
      created.connection.revision,
      {
        status: "failed",
        checkedAt: "2026-07-31T00:00:30.000Z",
        message: "model unavailable",
      },
    );
    expect(profileFailed).toMatchObject({
      ok: true,
      catalog: { defaultChatProfileId: null },
    });
    await store.recordProfileVerification(
      profile.id,
      profile.revision,
      created.connection.revision,
      {
        status: "passed",
        checkedAt: "2026-07-31T00:00:45.000Z",
        message: "recovered",
      },
    );
    await expect(
      store.setDefaultProfile("chat", profile.id),
    ).resolves.toMatchObject({ ok: true });

    const edited = await store.saveConnection({
      id: created.connection.id,
      expectedRevision: created.connection.revision,
      name: "OpenAI renamed",
      providerKind: "openai",
      credentialSource: "stored",
      values: {
        apiKey: "",
        baseUrl: "https://api.openai.com/v1",
      },
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.catalog.defaultChatProfileId).toBeNull();
    await expect(
      store.setDefaultProfile("chat", profile.id),
    ).resolves.toMatchObject({ ok: false });

    const connectionReverified = await store.recordConnectionVerification(
      edited.connection.id,
      edited.connection.revision,
      {
        status: "passed",
        checkedAt: "2026-07-31T00:01:00.000Z",
        message: "passed again",
      },
    );
    expect(connectionReverified.ok).toBe(true);
    const modelReverified = await store.recordProfileVerification(
      profile.id,
      profile.revision,
      edited.connection.revision,
      {
        status: "passed",
        checkedAt: "2026-07-31T00:01:00.000Z",
        message: "passed again",
      },
    );
    expect(modelReverified.ok).toBe(true);
    await expect(
      store.setDefaultProfile("chat", profile.id),
    ).resolves.toMatchObject({ ok: true });

    const editedProfile = await store.saveProfile({
      id: profile.id,
      expectedRevision: profile.revision,
      name: "Changed model",
      connectionId: edited.connection.id,
      modelId: "gpt-changed",
      purpose: "chat",
    });
    expect(editedProfile.ok).toBe(true);
    if (!editedProfile.ok) return;
    expect(editedProfile.catalog.defaultChatProfileId).toBeNull();
    expect(
      editedProfile.catalog.profiles.find(
        (candidate) => candidate.id === profile.id,
      )?.verification,
    ).toBeUndefined();
  });

  it("rejects unsupported embedding protocols before they can become defaults", async () => {
    const store = createModelSettingsStore({
      configDir: tempDir,
      vault: new FakeSecretVault(),
    });
    const created = await store.saveConnection({
      name: "Anthropic gateway",
      providerKind: "custom",
      credentialSource: "stored",
      values: {
        protocol: "anthropic",
        apiKey: "secret",
        baseUrl: "https://anthropic.example",
        modelId: "claude-private",
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await expect(
      store.saveProfile({
        name: "Not an embedding model",
        connectionId: created.connection.id,
        modelId: "claude-private",
        purpose: "embedding",
      }),
    ).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("尚未实现 Embedding"),
    });
  });

  it("rejects stale destructive mutations and purges deleted revision history", async () => {
    const store = createModelSettingsStore({
      configDir: tempDir,
      vault: new FakeSecretVault(),
    });
    const created = await store.saveConnection({
      name: "Private gateway",
      providerKind: "custom",
      credentialSource: "stored",
      values: {
        protocol: "openai",
        apiKey: "first-secret",
        baseUrl: "https://private.example/v1",
        modelId: "private-model",
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const originalProfile = created.catalog.profiles.find(
      (profile) => profile.connectionId === created.connection.id,
    )!;
    const updatedConnection = await store.saveConnection({
      id: created.connection.id,
      expectedRevision: created.connection.revision,
      name: "Private gateway",
      providerKind: "custom",
      credentialSource: "stored",
      values: {
        protocol: "openai",
        apiKey: "second-secret",
        baseUrl: "https://private.example/v1",
        modelId: "private-model",
      },
    });
    expect(updatedConnection.ok).toBe(true);
    if (!updatedConnection.ok) return;
    const updatedProfile = await store.saveProfile({
      id: originalProfile.id,
      expectedRevision: originalProfile.revision,
      name: "Private model renamed",
      connectionId: created.connection.id,
      modelId: originalProfile.modelId,
      purpose: "chat",
    });
    expect(updatedProfile.ok).toBe(true);
    if (!updatedProfile.ok) return;

    await expect(
      store.clearConnectionCredential({
        id: created.connection.id,
        expectedRevision: created.connection.revision,
      }),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      store.deleteProfile({
        id: originalProfile.id,
        expectedRevision: originalProfile.revision,
      }),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      store.deleteConnection({
        id: created.connection.id,
        expectedRevision: created.connection.revision,
      }),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      store.deleteProfile({
        id: updatedProfile.profile.id,
        expectedRevision: updatedProfile.profile.revision,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      store.deleteConnection({
        id: updatedConnection.connection.id,
        expectedRevision: updatedConnection.connection.revision,
      }),
    ).resolves.toMatchObject({ ok: true });

    const persisted = JSON.parse(
      await readFile(path.join(tempDir, "model-settings.json"), "utf8"),
    ) as {
      connections: Array<{ id: string }>;
      connectionHistory: Array<{ id: string }>;
      profiles: Array<{ id: string }>;
      profileHistory: Array<{ id: string }>;
    };
    expect([
      ...persisted.connections,
      ...persisted.connectionHistory,
    ]).not.toContainEqual(expect.objectContaining({ id: created.connection.id }));
    expect([
      ...persisted.profiles,
      ...persisted.profileHistory,
    ]).not.toContainEqual(expect.objectContaining({ id: originalProfile.id }));
  });
});
