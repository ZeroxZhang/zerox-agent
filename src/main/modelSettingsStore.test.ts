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
    return Buffer.from(value.replace("encrypted:", ""), "base64").toString(
      "utf8",
    );
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
    expect(catalog.connections.map((connection) => connection.providerKind))
      .toEqual(expect.arrayContaining(["openai", "deepseek"]));
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
    const afterFirst = await readFile(
      path.join(tempDir, "model-settings.json"),
      "utf8",
    );
    const second = await store.loadCatalog();
    const afterSecond = await readFile(
      path.join(tempDir, "model-settings.json"),
      "utf8",
    );

    expect(first.connections[0]).toMatchObject({
      id: "connection_migrated_default",
      providerKind: "openai",
      hasCredential: true,
    });
    expect(first.defaultChatProfileId).toBe("profile_migrated_chat");
    expect(first.defaultEmbeddingProfileId).toBe(
      "profile_migrated_embedding",
    );
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
    const raw = await readFile(
      path.join(tempDir, "model-settings.json"),
      "utf8",
    );
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
      message:
        "已保存连接不能切换服务商；请新建连接，避免凭证被发送到其他厂商端点。",
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
    expect(historical.connectionValues.baseUrl).toBe(
      "https://first.example/v1",
    );
    expect(historical.secrets.apiKey).toBe("key-v1");
    expect(current.connectionValues.baseUrl).toBe(
      "https://second.example/v1",
    );
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
    expect(historical.connectionValues.baseUrl).toBe(
      "https://revision-1.example/v1",
    );
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
      expect(
        await readFile(path.join(tempDir, "model-settings.json"), "utf8"),
      ).not.toContain("environment-only-secret");
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
      const raw = JSON.parse(
        await readFile(path.join(tempDir, "model-settings.json"), "utf8"),
      ) as {
        connections: Array<{
          id: string;
          encryptedSecrets: Record<string, string>;
        }>;
      };
      expect(
        raw.connections.find(
          (connection) => connection.id === created.connection.id,
        )?.encryptedSecrets,
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

  it("replaces the default only when the existing default connection is unavailable", async () => {
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
      const originalDefault = first.catalog.defaultChatProfileId;
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
      expect(replacement.catalog.defaultChatProfileId).not.toBe(
        originalDefault,
      );
      expect(
        replacement.catalog.profiles.find(
          (profile) =>
            profile.id === replacement.catalog.defaultChatProfileId,
        )?.connectionId,
      ).toBe(replacement.connection.id);
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
    await expect(store.deleteProfile(profile.id)).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("计划引用"),
    });
  });
});
