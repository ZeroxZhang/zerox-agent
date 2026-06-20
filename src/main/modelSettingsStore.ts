import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  getDefaultModelSettings,
  normalizeModelSettingsInput,
  type ModelSettingsInput,
  type ModelSettingsValidationErrors,
  type PublicModelSettings,
  validateModelSettingsInput,
} from "../shared/modelSettings";

type StoredModelSettings = {
  schemaVersion: 1;
  baseUrl: string;
  chatModel: string;
  embeddingModel: string;
  encryptedApiKey: string | null;
  temperature: number;
  maxTokens: number;
  thinkingEnabled: boolean;
  thinkingBudgetTokens: number;
  updatedAt: string;
  providerId?: import("../shared/modelSettings").ProviderId;
};

export type SecretVault = {
  encrypt(value: string): string;
  decrypt(value: string): string;
  isAvailable(): boolean;
};

export type ModelSettingsStore = {
  load(): Promise<PublicModelSettings>;
  save(input: ModelSettingsInput): Promise<PublicModelSettings>;
  getApiKey(): Promise<string | null>;
};

export class ModelSettingsValidationError extends Error {
  constructor(public readonly errors: ModelSettingsValidationErrors) {
    super("Model settings are invalid.");
  }
}

export function createModelSettingsStore(options: {
  configDir: string;
  vault: SecretVault;
}): ModelSettingsStore {
  const settingsPath = path.join(options.configDir, "model-settings.json");

  async function readStoredSettings(): Promise<StoredModelSettings | null> {
    try {
      const raw = await readFile(settingsPath, { encoding: "utf8" });
      return JSON.parse(raw) as StoredModelSettings;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }

      throw error;
    }
  }

  async function writeStoredSettings(settings: StoredModelSettings) {
    await mkdir(options.configDir, { recursive: true });
    await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, {
      encoding: "utf8",
    });
  }

  return {
    async load() {
      const stored = await readStoredSettings();
      if (!stored) {
        return getDefaultModelSettings();
      }

      return toPublicSettings(stored);
    },

    async save(input) {
      const stored = await readStoredSettings();
      const hasExistingApiKey = Boolean(stored?.encryptedApiKey);
      const validation = validateModelSettingsInput(input, hasExistingApiKey);

      if (!validation.valid) {
        throw new ModelSettingsValidationError(validation.errors);
      }

      const normalized = normalizeModelSettingsInput(input);
      const encryptedApiKey = normalized.apiKey
        ? encryptApiKey(options.vault, normalized.apiKey)
        : stored?.encryptedApiKey ?? null;
      const nextStored: StoredModelSettings = {
        schemaVersion: 1,
        baseUrl: normalized.baseUrl,
        chatModel: normalized.chatModel,
        embeddingModel: normalized.embeddingModel,
        encryptedApiKey,
        temperature: normalized.temperature,
        maxTokens: normalized.maxTokens,
        thinkingEnabled: normalized.thinkingEnabled,
        thinkingBudgetTokens: normalized.thinkingBudgetTokens,
        updatedAt: new Date().toISOString(),
        ...(normalized.providerId ? { providerId: normalized.providerId } : {}),
      };

      await writeStoredSettings(nextStored);
      return toPublicSettings(nextStored);
    },

    async getApiKey() {
      const stored = await readStoredSettings();
      if (!stored?.encryptedApiKey) {
        return null;
      }

      return options.vault.decrypt(stored.encryptedApiKey);
    },
  };
}

export function createElectronSecretVault(safeStorage: {
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
  isEncryptionAvailable(): boolean;
}): SecretVault {
  return {
    encrypt(value) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("Secure storage is not available on this device.");
      }

      return safeStorage.encryptString(value).toString("base64");
    },
    decrypt(value) {
      return safeStorage.decryptString(Buffer.from(value, "base64"));
    },
    isAvailable() {
      return safeStorage.isEncryptionAvailable();
    },
  };
}

function encryptApiKey(vault: SecretVault, apiKey: string): string {
  if (!vault.isAvailable()) {
    throw new Error("Secure storage is not available on this device.");
  }

  return vault.encrypt(apiKey);
}

function toPublicSettings(settings: StoredModelSettings): PublicModelSettings {
  const defaults = getDefaultModelSettings();
  return {
    baseUrl: settings.baseUrl,
    chatModel: settings.chatModel,
    embeddingModel: settings.embeddingModel,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    thinkingEnabled: settings.thinkingEnabled ?? defaults.thinkingEnabled,
    thinkingBudgetTokens:
      settings.thinkingBudgetTokens ?? defaults.thinkingBudgetTokens,
    hasApiKey: Boolean(settings.encryptedApiKey),
    updatedAt: settings.updatedAt,
    ...(settings.providerId ? { providerId: settings.providerId } : {}),
  };
}
