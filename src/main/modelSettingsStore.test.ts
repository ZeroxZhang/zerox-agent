import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createModelSettingsStore, type SecretVault } from "./modelSettingsStore";

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
});
