import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  defaultModelGenerationSettings,
  getDefaultModelSettings,
  isProviderKind,
  normalizeModelSettingsInput,
  type ModelCatalogMutationResult,
  type ModelProfile,
  type ModelProfileInput,
  type ModelSettingsInput,
  type ModelSettingsValidationErrors,
  type ProviderConnectionInput,
  type ProviderCredentialSource,
  type ProviderKind,
  type PublicModelCatalog,
  type PublicModelSettings,
  type PublicProviderConnection,
  type ResolvedModelBinding,
  type SaveModelProfileResult,
  type SaveProviderConnectionResult,
  validateModelSettingsInput,
} from "../shared/modelSettings";
import { capabilitiesForModel, listModelCatalogEntries } from "./providers/modelMatrix";
import {
  getProviderDescriptor,
  listProviderDescriptors,
  requireProviderDescriptor,
  validateProviderFields,
} from "./providers/providerRegistry";

type StoredModelSettingsV1 = {
  schemaVersion: 1;
  baseUrl: string;
  chatModel: string;
  embeddingModel: string;
  encryptedApiKey: string | null;
  temperature: number;
  maxTokens: number;
  thinkingEnabled?: boolean;
  thinkingBudgetTokens?: number;
  updatedAt: string;
  providerId?: string;
};

type StoredProviderConnection = {
  id: string;
  name: string;
  providerKind: ProviderKind;
  values: Record<string, string>;
  encryptedSecrets: Record<string, string>;
  credentialSource: ProviderCredentialSource;
  keySetAt?: string;
  lastUsedAt?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

type StoredModelSettingsV2 = {
  schemaVersion: 2;
  connections: StoredProviderConnection[];
  connectionHistory: StoredProviderConnection[];
  profiles: ModelProfile[];
  profileHistory: ModelProfile[];
  defaultChatProfileId: string | null;
  defaultEmbeddingProfileId: string | null;
  hiddenRoutedModelIds: string[];
  updatedAt: string;
};

type StoredModelSettings = StoredModelSettingsV1 | StoredModelSettingsV2;

export type SecretVault = {
  encrypt(value: string): string;
  decrypt(value: string): string;
  isAvailable(): boolean;
};

export type ResolvedModelProfile = {
  binding: ResolvedModelBinding;
  connectionValues: Record<string, string>;
  secrets: Record<string, string>;
  profile: ModelProfile;
};

export type ResolvedProviderConnection = {
  id: string;
  providerKind: ProviderKind;
  connectionValues: Record<string, string>;
  secrets: Record<string, string>;
  revision: number;
};

export type ModelSettingsStore = {
  // Legacy compatibility while existing consumers migrate to profile binding.
  load(): Promise<PublicModelSettings>;
  save(input: ModelSettingsInput): Promise<PublicModelSettings>;
  getApiKey(): Promise<string | null>;

  loadCatalog(): Promise<PublicModelCatalog>;
  saveConnection(input: ProviderConnectionInput): Promise<SaveProviderConnectionResult>;
  deleteConnection(connectionId: string): Promise<ModelCatalogMutationResult>;
  saveProfile(input: ModelProfileInput): Promise<SaveModelProfileResult>;
  deleteProfile(profileId: string): Promise<ModelCatalogMutationResult>;
  setDefaultProfile(
    purpose: "chat" | "embedding",
    profileId: string | null,
  ): Promise<ModelCatalogMutationResult>;
  setModelHidden(
    routedModelId: string,
    hidden: boolean,
  ): Promise<ModelCatalogMutationResult>;
  resolveProfile(profileId?: string | null): Promise<ResolvedModelProfile>;
  resolveBinding(binding: ResolvedModelBinding): Promise<ResolvedModelProfile>;
  resolveConnection(connectionId: string): Promise<ResolvedProviderConnection>;
  markConnectionUsed(connectionId: string): Promise<void>;
};

export class ModelSettingsValidationError extends Error {
  constructor(public readonly errors: ModelSettingsValidationErrors) {
    super("Model settings are invalid.");
  }
}

export class ModelCatalogConflictError extends Error {}

export function createModelSettingsStore(options: {
  configDir: string;
  vault: SecretVault;
  isConnectionReferenced?: (connectionId: string) => Promise<boolean>;
  isProfileReferenced?: (profileId: string) => Promise<boolean>;
  now?: () => string;
  createId?: () => string;
}): ModelSettingsStore {
  const settingsPath = path.join(options.configDir, "model-settings.json");
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? (() => randomUUID());
  let mutationTail = Promise.resolve();

  async function readStoredSettings(): Promise<StoredModelSettingsV2> {
    let parsed: StoredModelSettings | null = null;
    try {
      const raw = await readFile(settingsPath, { encoding: "utf8" });
      parsed = JSON.parse(raw) as StoredModelSettings;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    if (!parsed) {
      return emptyV2(now());
    }
    if (parsed.schemaVersion === 2) {
      return normalizeStoredV2(parsed);
    }

    const migrated = migrateV1(parsed, now());
    await writeStoredSettings(migrated);
    return migrated;
  }

  async function writeStoredSettings(settings: StoredModelSettingsV2) {
    await mkdir(options.configDir, { recursive: true });
    const tempPath = `${settingsPath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(settings, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(tempPath, settingsPath);
  }

  function mutate<T>(
    operation: (stored: StoredModelSettingsV2) => Promise<T>,
  ): Promise<T> {
    const invocation = mutationTail.then(async () => {
      const stored = await readStoredSettings();
      return operation(stored);
    });
    mutationTail = invocation.then(
      () => undefined,
      () => undefined,
    );
    return invocation;
  }

  async function loadCatalogFrom(
    stored: StoredModelSettingsV2,
  ): Promise<PublicModelCatalog> {
    return {
      schemaVersion: 2,
      descriptors: listProviderDescriptors(),
      entries: listModelCatalogEntries().filter(
        (entry) => !stored.hiddenRoutedModelIds.includes(entry.routedModelId),
      ),
      connections: stored.connections.map(toPublicConnection),
      profiles: stored.profiles.map((profile) => structuredClone(profile)),
      defaultChatProfileId: stored.defaultChatProfileId,
      defaultEmbeddingProfileId: stored.defaultEmbeddingProfileId,
      hiddenRoutedModelIds: [...stored.hiddenRoutedModelIds],
      updatedAt: stored.updatedAt || null,
    };
  }

  function decryptSecrets(
    connection: StoredProviderConnection,
  ): Record<string, string> {
    return Object.fromEntries(
      Object.entries(connection.encryptedSecrets).map(([key, value]) => [
        key,
        options.vault.decrypt(value),
      ]),
    );
  }

  async function resolveProfileFrom(
    stored: StoredModelSettingsV2,
    profileId?: string | null,
    frozenBinding?: ResolvedModelBinding,
  ): Promise<ResolvedModelProfile> {
    const selectedId =
      frozenBinding?.profileId ?? profileId ?? stored.defaultChatProfileId;
    const profileRevision = frozenBinding?.profileRevision;
    const profile = [...stored.profiles, ...stored.profileHistory].find(
      (candidate) =>
        candidate.id === selectedId &&
        (profileRevision === undefined ||
          candidate.revision === profileRevision),
    );
    if (!profile) {
      throw new Error("没有可用的模型档案，请先在设置中配置模型。");
    }
    const connectionRevision = frozenBinding?.connectionRevision;
    const connection = [
      ...stored.connections,
      ...stored.connectionHistory,
    ].find(
      (candidate) =>
        candidate.id === profile.connectionId &&
        (connectionRevision === undefined ||
          candidate.revision === connectionRevision),
    );
    if (!connection) {
      throw new Error(`模型档案 ${profile.name} 引用的服务商连接不存在。`);
    }
    const descriptor = requireProviderDescriptor(connection.providerKind);
    if (
      frozenBinding &&
      (frozenBinding.connectionId !== connection.id ||
        frozenBinding.providerKind !== connection.providerKind ||
        frozenBinding.modelId !== profile.modelId)
    ) {
      throw new Error("冻结模型绑定与历史配置不一致。");
    }
    const secrets = decryptSecrets(connection);
    for (const field of descriptor.fields) {
      if (
        field.secret &&
        !secrets[field.key] &&
        connection.credentialSource === "environment" &&
        descriptor.environmentKey &&
        process.env[descriptor.environmentKey]
      ) {
        secrets[field.key] = process.env[descriptor.environmentKey]!;
      }
    }
    const baseUrl =
      connection.values.baseUrl ||
      descriptor.fields.find((field) => field.key === "baseUrl")?.defaultValue;
    return {
      binding: {
        profileId: profile.id,
        connectionId: connection.id,
        providerKind: connection.providerKind,
        modelId: profile.modelId,
        revision: pairRevisions(connection.revision, profile.revision),
        connectionRevision: connection.revision,
        profileRevision: profile.revision,
        ...(baseUrl ? { baseUrl } : {}),
        capabilities: {
          ...capabilitiesForModel(connection.providerKind, profile.modelId),
          ...profile.capabilityOverrides,
        },
        generation: { ...profile.generation },
      },
      connectionValues: { ...connection.values },
      secrets,
      profile: structuredClone(profile),
    };
  }

  return {
    async load() {
      const stored = await readStoredSettings();
      return toLegacyPublicSettings(stored);
    },

    async save(input) {
      return mutate(async (stored) => {
        const legacy = toLegacyPublicSettings(stored);
        const normalized = normalizeModelSettingsInput(input);
        const providerKind = normalizeLegacyProviderKind(normalized.providerId);
        const existingProfile = stored.profiles.find(
          (profile) => profile.id === stored.defaultChatProfileId,
        );
        const existingConnection = existingProfile
          ? stored.connections.find(
              (connection) => connection.id === existingProfile.connectionId,
            )
          : undefined;
        const reusableConnection =
          existingConnection?.providerKind === providerKind
            ? existingConnection
            : undefined;
        const validation = validateModelSettingsInput(
          input,
          Boolean(reusableConnection && legacy.hasApiKey),
        );
        if (!validation.valid) {
          throw new ModelSettingsValidationError(validation.errors);
        }
        const timestamp = now();
        const connectionId =
          reusableConnection?.id ?? `connection_${createId()}`;
        const profileId = existingProfile?.id ?? `profile_${createId()}`;
        const descriptor = requireProviderDescriptor(providerKind);
        const encryptedSecrets = {
          ...(reusableConnection?.encryptedSecrets ?? {}),
        };
        if (normalized.apiKey) {
          encryptedSecrets.apiKey = encryptSecret(options.vault, normalized.apiKey);
        }
        const connection: StoredProviderConnection = {
          id: connectionId,
          name: reusableConnection?.name ?? descriptor.title,
          providerKind,
          values: {
            ...(reusableConnection?.values ?? {}),
            baseUrl: normalized.baseUrl,
          },
          encryptedSecrets,
          credentialSource:
            Object.keys(encryptedSecrets).length > 0 ? "stored" : "none",
          ...(Object.keys(encryptedSecrets).length > 0
            ? { keySetAt: reusableConnection?.keySetAt ?? timestamp }
            : {}),
          revision: (reusableConnection?.revision ?? 0) + 1,
          createdAt: reusableConnection?.createdAt ?? timestamp,
          updatedAt: timestamp,
        };
        const profile: ModelProfile = {
          id: profileId,
          name: existingProfile?.name ?? normalized.chatModel,
          connectionId,
          modelId: normalized.chatModel,
          purpose: "chat",
          generation: {
            temperature: normalized.temperature,
            maxTokens: normalized.maxTokens,
            thinkingEnabled: normalized.thinkingEnabled,
            thinkingBudgetTokens: normalized.thinkingBudgetTokens,
          },
          custom: !Boolean(
            listModelCatalogEntries().find(
              (entry) =>
                entry.providerKind === providerKind &&
                entry.modelId === normalized.chatModel,
            ),
          ),
          revision: (existingProfile?.revision ?? 0) + 1,
          createdAt: existingProfile?.createdAt ?? timestamp,
          updatedAt: timestamp,
        };

        stored.connections = [
          ...stored.connections.filter((candidate) => candidate.id !== connectionId),
          connection,
        ];
        if (reusableConnection) {
          stored.connectionHistory = appendRevisionHistory(
            stored.connectionHistory,
            reusableConnection,
          );
        }
        stored.profiles = [
          ...stored.profiles.filter((candidate) => candidate.id !== profileId),
          profile,
        ];
        if (existingProfile) {
          stored.profileHistory = appendRevisionHistory(
            stored.profileHistory,
            existingProfile,
          );
        }
        stored.defaultChatProfileId = profileId;
        if (normalized.embeddingModel) {
          const embeddingId =
            stored.defaultEmbeddingProfileId ?? `profile_${createId()}`;
          const oldEmbedding = stored.profiles.find(
            (candidate) => candidate.id === embeddingId,
          );
          stored.profiles = [
            ...stored.profiles.filter((candidate) => candidate.id !== embeddingId),
            {
              id: embeddingId,
              name: oldEmbedding?.name ?? normalized.embeddingModel,
              connectionId,
              modelId: normalized.embeddingModel,
              purpose: "embedding",
              generation: { ...profile.generation },
              custom: true,
              revision: (oldEmbedding?.revision ?? 0) + 1,
              createdAt: oldEmbedding?.createdAt ?? timestamp,
              updatedAt: timestamp,
            },
          ];
          if (oldEmbedding) {
            stored.profileHistory = appendRevisionHistory(
              stored.profileHistory,
              oldEmbedding,
            );
          }
          stored.defaultEmbeddingProfileId = embeddingId;
        }
        stored.updatedAt = timestamp;
        await writeStoredSettings(stored);
        return toLegacyPublicSettings(stored);
      });
    },

    async getApiKey() {
      const stored = await readStoredSettings();
      if (!stored.defaultChatProfileId) {
        return null;
      }
      const resolved = await resolveProfileFrom(stored);
      return firstSecret(resolved.secrets);
    },

    async loadCatalog() {
      return loadCatalogFrom(await readStoredSettings());
    },

    async saveConnection(input) {
      try {
        return await mutate(async (stored) => {
          const descriptor = requireProviderDescriptor(input.providerKind);
          const existing = input.id
            ? stored.connections.find((candidate) => candidate.id === input.id)
            : undefined;
          if (existing && existing.providerKind !== input.providerKind) {
            return {
              ok: false,
              message:
                "已保存连接不能切换服务商；请新建连接，避免凭证被发送到其他厂商端点。",
            } satisfies SaveProviderConnectionResult;
          }
          if (
            existing &&
            input.expectedRevision !== undefined &&
            existing.revision !== input.expectedRevision
          ) {
            throw new ModelCatalogConflictError("服务商连接已被其他操作更新。");
          }
          const values = applyProviderDefaults(descriptor, input.values);
          const existingSecret =
            existing && Object.keys(existing.encryptedSecrets).length > 0;
          const environmentCredentialAvailable = Boolean(
            input.credentialSource === "environment" &&
              descriptor.environmentKey &&
              process.env[descriptor.environmentKey],
          );
          const errors = {
            ...validateProviderFields(descriptor, values, {
              hasStoredSecret:
                Boolean(existingSecret) || environmentCredentialAvailable,
            }),
            ...validateConditionalCredentials(descriptor.kind, values, existing),
          };
          if (
            input.credentialSource === "environment" &&
            !descriptor.environmentKey
          ) {
            errors.credentialSource =
              `${descriptor.title} 不支持环境变量凭证来源。`;
          } else if (
            input.credentialSource === "environment" &&
            descriptor.environmentKey &&
            !environmentCredentialAvailable
          ) {
            errors.apiKey = `未检测到环境变量 ${descriptor.environmentKey}。`;
          }
          if (Object.keys(errors).length > 0) {
            return {
              ok: false,
              message: "服务商连接配置不完整。",
              errors,
            } satisfies SaveProviderConnectionResult;
          }

          const timestamp = now();
          const encryptedSecrets = { ...(existing?.encryptedSecrets ?? {}) };
          const publicValues: Record<string, string> = {};
          let secretChanged = false;
          if (input.credentialSource === "environment") {
            for (const field of descriptor.fields.filter(
              (candidate) => candidate.secret,
            )) {
              if (encryptedSecrets[field.key]) {
                delete encryptedSecrets[field.key];
                secretChanged = true;
              }
            }
          }
          for (const field of descriptor.fields) {
            const value = values[field.key]?.trim() ?? "";
            if (field.secret) {
              if (!isProviderFieldVisible(field, values)) {
                if (encryptedSecrets[field.key]) {
                  delete encryptedSecrets[field.key];
                  secretChanged = true;
                }
                continue;
              }
              if (input.credentialSource !== "environment" && value) {
                encryptedSecrets[field.key] = encryptSecret(options.vault, value);
                secretChanged = true;
              }
              continue;
            }
            if (value) {
              publicValues[field.key] = value;
            }
          }
          const credentialSource = resolveCredentialSource(
            descriptor,
            encryptedSecrets,
            input.credentialSource,
            values,
          );
          const connection: StoredProviderConnection = {
            id: existing?.id ?? `connection_${createId()}`,
            name: input.name.trim() || descriptor.title,
            providerKind: input.providerKind,
            values: publicValues,
            encryptedSecrets,
            credentialSource,
            ...(Object.keys(encryptedSecrets).length > 0
              ? {
                  keySetAt: secretChanged
                    ? timestamp
                    : existing?.keySetAt ?? timestamp,
                }
              : {}),
            ...(existing?.lastUsedAt ? { lastUsedAt: existing.lastUsedAt } : {}),
            revision: (existing?.revision ?? 0) + 1,
            createdAt: existing?.createdAt ?? timestamp,
            updatedAt: timestamp,
          };
          if (existing) {
            stored.connectionHistory = appendRevisionHistory(
              stored.connectionHistory,
              existing,
            );
          }
          stored.connections = [
            ...stored.connections.filter(
              (candidate) => candidate.id !== connection.id,
            ),
            connection,
          ];

          const hasProfile = stored.profiles.some(
            (profile) => profile.connectionId === connection.id,
          );
          if (!hasProfile && descriptor.recommendedModel) {
            const profile: ModelProfile = {
              id: `profile_${createId()}`,
              name: descriptor.recommendedModel,
              connectionId: connection.id,
              modelId: descriptor.recommendedModel,
              purpose: "chat",
              generation: defaultModelGenerationSettings(),
              custom: false,
              revision: 1,
              createdAt: timestamp,
              updatedAt: timestamp,
            };
            stored.profiles.push(profile);
            const currentDefault = stored.profiles.find(
              (candidate) =>
                candidate.id === stored.defaultChatProfileId &&
                candidate.purpose === "chat",
            );
            const currentDefaultConnection = currentDefault
              ? stored.connections.find(
                  (candidate) =>
                    candidate.id === currentDefault.connectionId,
                )
              : undefined;
            const currentDefaultWorks = Boolean(
              currentDefaultConnection &&
                hasUsableCredential(currentDefaultConnection),
            );
            if (!currentDefaultWorks) {
              stored.defaultChatProfileId = profile.id;
            }
          }
          stored.updatedAt = timestamp;
          await writeStoredSettings(stored);
          return {
            ok: true,
            catalog: await loadCatalogFrom(stored),
            connection: toPublicConnection(connection),
          } satisfies SaveProviderConnectionResult;
        });
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : "无法保存服务商连接。",
        };
      }
    },

    async deleteConnection(connectionId) {
      return mutate(async (stored) => {
        if (await options.isConnectionReferenced?.(connectionId)) {
          return {
            ok: false,
            message: "该连接仍被活动或待确认计划引用，不能删除。",
          };
        }
        if (stored.profiles.some((profile) => profile.connectionId === connectionId)) {
          return {
            ok: false,
            message: "该连接仍被模型档案引用，请先删除相关模型档案。",
          };
        }
        stored.connections = stored.connections.filter(
          (candidate) => candidate.id !== connectionId,
        );
        stored.updatedAt = now();
        await writeStoredSettings(stored);
        return { ok: true, catalog: await loadCatalogFrom(stored) };
      });
    },

    async saveProfile(input) {
      return mutate(async (stored) => {
        const connection = stored.connections.find(
          (candidate) => candidate.id === input.connectionId,
        );
        if (!connection) {
          return { ok: false, message: "模型档案引用的服务商连接不存在。" };
        }
        const existing = input.id
          ? stored.profiles.find((candidate) => candidate.id === input.id)
          : undefined;
        if (
          existing &&
          input.expectedRevision !== undefined &&
          existing.revision !== input.expectedRevision
        ) {
          return { ok: false, message: "模型档案已被其他操作更新。" };
        }
        const modelId = input.modelId.trim();
        if (!modelId) {
          return { ok: false, message: "模型 ID 必填。" };
        }
        const timestamp = now();
        const generation = {
          ...defaultModelGenerationSettings(),
          ...(existing?.generation ?? {}),
          ...(input.generation ?? {}),
        };
        const profile: ModelProfile = {
          id: existing?.id ?? `profile_${createId()}`,
          name: input.name.trim() || modelId,
          connectionId: connection.id,
          modelId,
          purpose: input.purpose,
          generation,
          ...(input.capabilityOverrides
            ? { capabilityOverrides: { ...input.capabilityOverrides } }
            : existing?.capabilityOverrides
              ? { capabilityOverrides: { ...existing.capabilityOverrides } }
              : {}),
          custom: !Boolean(
            listModelCatalogEntries().find(
              (entry) =>
                entry.providerKind === connection.providerKind &&
                entry.modelId === modelId,
            ),
          ),
          revision: (existing?.revision ?? 0) + 1,
          createdAt: existing?.createdAt ?? timestamp,
          updatedAt: timestamp,
        };
        if (existing) {
          stored.profileHistory = appendRevisionHistory(
            stored.profileHistory,
            existing,
          );
        }
        stored.profiles = [
          ...stored.profiles.filter((candidate) => candidate.id !== profile.id),
          profile,
        ];
        if (profile.purpose === "chat" && !stored.defaultChatProfileId) {
          stored.defaultChatProfileId = profile.id;
        }
        if (profile.purpose === "embedding" && !stored.defaultEmbeddingProfileId) {
          stored.defaultEmbeddingProfileId = profile.id;
        }
        stored.updatedAt = timestamp;
        await writeStoredSettings(stored);
        return {
          ok: true,
          catalog: await loadCatalogFrom(stored),
          profile: structuredClone(profile),
        };
      });
    },

    async deleteProfile(profileId) {
      return mutate(async (stored) => {
        if (await options.isProfileReferenced?.(profileId)) {
          return {
            ok: false,
            message: "该模型档案仍被活动或待确认计划引用，不能删除。",
          };
        }
        stored.profiles = stored.profiles.filter(
          (candidate) => candidate.id !== profileId,
        );
        if (stored.defaultChatProfileId === profileId) {
          stored.defaultChatProfileId =
            stored.profiles.find((candidate) => candidate.purpose === "chat")?.id ??
            null;
        }
        if (stored.defaultEmbeddingProfileId === profileId) {
          stored.defaultEmbeddingProfileId =
            stored.profiles.find(
              (candidate) => candidate.purpose === "embedding",
            )?.id ?? null;
        }
        stored.updatedAt = now();
        await writeStoredSettings(stored);
        return { ok: true, catalog: await loadCatalogFrom(stored) };
      });
    },

    async setDefaultProfile(purpose, profileId) {
      return mutate(async (stored) => {
        if (profileId) {
          const profile = stored.profiles.find(
            (candidate) =>
              candidate.id === profileId && candidate.purpose === purpose,
          );
          if (!profile) {
            return { ok: false, message: "默认模型档案不存在或用途不匹配。" };
          }
        }
        if (purpose === "chat") {
          stored.defaultChatProfileId = profileId;
        } else {
          stored.defaultEmbeddingProfileId = profileId;
        }
        stored.updatedAt = now();
        await writeStoredSettings(stored);
        return { ok: true, catalog: await loadCatalogFrom(stored) };
      });
    },

    async setModelHidden(routedModelId, hidden) {
      return mutate(async (stored) => {
        const next = new Set(stored.hiddenRoutedModelIds);
        if (hidden) {
          next.add(routedModelId);
        } else {
          next.delete(routedModelId);
        }
        stored.hiddenRoutedModelIds = [...next].sort();
        stored.updatedAt = now();
        await writeStoredSettings(stored);
        return { ok: true, catalog: await loadCatalogFrom(stored) };
      });
    },

    async resolveProfile(profileId) {
      return resolveProfileFrom(await readStoredSettings(), profileId);
    },

    async resolveBinding(binding) {
      return resolveProfileFrom(
        await readStoredSettings(),
        binding.profileId,
        binding,
      );
    },

    async resolveConnection(connectionId) {
      const stored = await readStoredSettings();
      const connection = stored.connections.find(
        (candidate) => candidate.id === connectionId,
      );
      if (!connection) {
        throw new Error("服务商连接不存在。");
      }
      const descriptor = requireProviderDescriptor(connection.providerKind);
      const secrets = decryptSecrets(connection);
      if (
        connection.credentialSource === "environment" &&
        descriptor.environmentKey &&
        process.env[descriptor.environmentKey]
      ) {
        const secretField =
          descriptor.fields.find((field) => field.key === "apiKey") ??
          descriptor.fields.find((field) => field.secret);
        if (secretField) {
          secrets[secretField.key] = process.env[descriptor.environmentKey]!;
        }
      }
      return {
        id: connection.id,
        providerKind: connection.providerKind,
        connectionValues: { ...connection.values },
        secrets,
        revision: connection.revision,
      };
    },

    async markConnectionUsed(connectionId) {
      await mutate(async (stored) => {
        const connection = stored.connections.find(
          (candidate) => candidate.id === connectionId,
        );
        if (!connection) {
          return;
        }
        const timestamp = now();
        if (
          connection.lastUsedAt &&
          Date.parse(timestamp) - Date.parse(connection.lastUsedAt) < 60_000
        ) {
          return;
        }
        connection.lastUsedAt = timestamp;
        connection.updatedAt = timestamp;
        stored.updatedAt = timestamp;
        await writeStoredSettings(stored);
      });
    },
  };

  function migrateV1(
    legacy: StoredModelSettingsV1,
    timestamp: string,
  ): StoredModelSettingsV2 {
    const providerKind = normalizeLegacyProviderKind(legacy.providerId);
    const connectionId = "connection_migrated_default";
    const chatProfileId = "profile_migrated_chat";
    const embeddingProfileId = legacy.embeddingModel
      ? "profile_migrated_embedding"
      : null;
    const descriptor = requireProviderDescriptor(providerKind);
    const connection: StoredProviderConnection = {
      id: connectionId,
      name: descriptor.title,
      providerKind,
      values: legacy.baseUrl ? { baseUrl: legacy.baseUrl } : {},
      encryptedSecrets: legacy.encryptedApiKey
        ? { apiKey: legacy.encryptedApiKey }
        : {},
      credentialSource: legacy.encryptedApiKey ? "stored" : "none",
      ...(legacy.encryptedApiKey ? { keySetAt: legacy.updatedAt } : {}),
      revision: 1,
      createdAt: legacy.updatedAt || timestamp,
      updatedAt: legacy.updatedAt || timestamp,
    };
    const generation = {
      temperature: legacy.temperature,
      maxTokens: legacy.maxTokens,
      thinkingEnabled: legacy.thinkingEnabled ?? false,
      thinkingBudgetTokens: legacy.thinkingBudgetTokens ?? 8192,
    };
    const profiles: ModelProfile[] = legacy.chatModel
      ? [
          {
            id: chatProfileId,
            name: legacy.chatModel,
            connectionId,
            modelId: legacy.chatModel,
            purpose: "chat",
            generation,
            custom: !Boolean(
              listModelCatalogEntries().find(
                (entry) =>
                  entry.providerKind === providerKind &&
                  entry.modelId === legacy.chatModel,
              ),
            ),
            revision: 1,
            createdAt: legacy.updatedAt || timestamp,
            updatedAt: legacy.updatedAt || timestamp,
          },
        ]
      : [];
    if (legacy.embeddingModel && embeddingProfileId) {
      profiles.push({
        id: embeddingProfileId,
        name: legacy.embeddingModel,
        connectionId,
        modelId: legacy.embeddingModel,
        purpose: "embedding",
        generation,
        custom: true,
        revision: 1,
        createdAt: legacy.updatedAt || timestamp,
        updatedAt: legacy.updatedAt || timestamp,
      });
    }
    return {
      schemaVersion: 2,
      connections: profiles.length || legacy.encryptedApiKey ? [connection] : [],
      connectionHistory: [],
      profiles,
      profileHistory: [],
      defaultChatProfileId: profiles.some((profile) => profile.id === chatProfileId)
        ? chatProfileId
        : null,
      defaultEmbeddingProfileId: embeddingProfileId,
      hiddenRoutedModelIds: [],
      updatedAt: legacy.updatedAt || timestamp,
    };
  }
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

function emptyV2(timestamp: string): StoredModelSettingsV2 {
  return {
    schemaVersion: 2,
    connections: [],
    connectionHistory: [],
    profiles: [],
    profileHistory: [],
    defaultChatProfileId: null,
    defaultEmbeddingProfileId: null,
    hiddenRoutedModelIds: [],
    updatedAt: timestamp,
  };
}

function normalizeStoredV2(stored: StoredModelSettingsV2): StoredModelSettingsV2 {
  return {
    schemaVersion: 2,
    connections: Array.isArray(stored.connections) ? stored.connections : [],
    connectionHistory: Array.isArray(stored.connectionHistory)
      ? stored.connectionHistory
      : [],
    profiles: Array.isArray(stored.profiles) ? stored.profiles : [],
    profileHistory: Array.isArray(stored.profileHistory)
      ? stored.profileHistory
      : [],
    defaultChatProfileId: stored.defaultChatProfileId ?? null,
    defaultEmbeddingProfileId: stored.defaultEmbeddingProfileId ?? null,
    hiddenRoutedModelIds: Array.isArray(stored.hiddenRoutedModelIds)
      ? stored.hiddenRoutedModelIds
      : [],
    updatedAt: stored.updatedAt ?? new Date(0).toISOString(),
  };
}

function normalizeLegacyProviderKind(value: unknown): ProviderKind {
  if (value === "openai-compatible" || !value) {
    return "openai";
  }
  if (isProviderKind(value)) {
    return value;
  }
  throw new Error(`未知模型服务商：${String(value)}`);
}

function toPublicConnection(
  connection: StoredProviderConnection,
): PublicProviderConnection {
  return {
    id: connection.id,
    name: connection.name,
    providerKind: connection.providerKind,
    values: { ...connection.values },
    credentialSource: connection.credentialSource,
    hasCredential: hasUsableCredential(connection),
    ...(connection.keySetAt ? { keySetAt: connection.keySetAt } : {}),
    ...(connection.lastUsedAt ? { lastUsedAt: connection.lastUsedAt } : {}),
    revision: connection.revision,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

function toLegacyPublicSettings(
  stored: StoredModelSettingsV2,
): PublicModelSettings {
  const defaults = getDefaultModelSettings();
  const profile = stored.profiles.find(
    (candidate) => candidate.id === stored.defaultChatProfileId,
  );
  const connection = profile
    ? stored.connections.find(
        (candidate) => candidate.id === profile.connectionId,
      )
    : undefined;
  const embedding = stored.profiles.find(
    (candidate) => candidate.id === stored.defaultEmbeddingProfileId,
  );
  if (!profile || !connection) {
    return defaults;
  }
  return {
    baseUrl:
      connection.values.baseUrl ??
      getProviderDescriptor(connection.providerKind)?.fields.find(
        (field) => field.key === "baseUrl",
      )?.defaultValue ??
      "",
    chatModel: profile.modelId,
    embeddingModel: embedding?.modelId ?? "",
    temperature: profile.generation.temperature,
    maxTokens: profile.generation.maxTokens,
    thinkingEnabled: profile.generation.thinkingEnabled,
    thinkingBudgetTokens: profile.generation.thinkingBudgetTokens,
    hasApiKey: hasUsableCredential(connection),
    updatedAt: stored.updatedAt,
    providerId:
      connection.providerKind === "openai"
        ? "openai-compatible"
        : connection.providerKind,
  };
}

function applyProviderDefaults(
  descriptor: ReturnType<typeof requireProviderDescriptor>,
  values: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    descriptor.fields.map((field) => [
      field.key,
      values[field.key]?.trim() || field.defaultValue || "",
    ]),
  );
}

function validateConditionalCredentials(
  providerKind: ProviderKind,
  values: Record<string, string>,
  existing?: StoredProviderConnection,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const hasSecret = (key: string) =>
    Boolean(values[key]?.trim() || existing?.encryptedSecrets[key]);
  if (providerKind === "bedrock") {
    const method = values.authMethod || "api_key";
    if (method === "api_key" && !hasSecret("bedrockApiKey")) {
      errors.bedrockApiKey = "Bedrock API Key 必填。";
    }
    if (
      method === "iam" &&
      (!values.awsAccessKeyId?.trim() || !hasSecret("awsSecretAccessKey"))
    ) {
      errors.awsSecretAccessKey = "IAM Access Key ID 和 Secret Access Key 必填。";
    }
  }
  if (providerKind === "vertex") {
    const method = values.authMethod || "adc";
    if (method === "service_account" && !hasSecret("serviceAccountJson")) {
      errors.serviceAccountJson = "Service Account JSON 必填。";
    }
    if (method === "api_key" && !hasSecret("vertexApiKey")) {
      errors.vertexApiKey = "Vertex API Key 必填。";
    }
  }
  return errors;
}

function hasUsableCredential(
  connection: StoredProviderConnection,
): boolean {
  if (Object.keys(connection.encryptedSecrets).length > 0) {
    return true;
  }
  if (connection.credentialSource === "environment") {
    const environmentKey = getProviderDescriptor(
      connection.providerKind,
    )?.environmentKey;
    return Boolean(environmentKey && process.env[environmentKey]);
  }
  return (
    connection.credentialSource === "ambient" ||
    connection.providerKind === "ollama"
  );
}

function isProviderFieldVisible(
  field: { showWhen?: Record<string, string> },
  values: Record<string, string>,
): boolean {
  return (
    !field.showWhen ||
    Object.entries(field.showWhen).every(
      ([key, expected]) => values[key] === expected,
    )
  );
}

function resolveCredentialSource(
  descriptor: ReturnType<typeof requireProviderDescriptor>,
  encryptedSecrets: Record<string, string>,
  requested: ProviderCredentialSource | undefined,
  values: Record<string, string>,
): ProviderCredentialSource {
  if (Object.keys(encryptedSecrets).length > 0) {
    return "stored";
  }
  if (
    requested === "environment" &&
    descriptor.environmentKey &&
    process.env[descriptor.environmentKey]
  ) {
    return "environment";
  }
  if (
    requested === "ambient" ||
    (descriptor.kind === "bedrock" &&
      (values.authMethod === "profile" || !values.authMethod)) ||
    (descriptor.kind === "vertex" &&
      (values.authMethod === "adc" || !values.authMethod))
  ) {
    return "ambient";
  }
  return descriptor.needsCredential ? "none" : "none";
}

function encryptSecret(vault: SecretVault, value: string): string {
  if (!vault.isAvailable()) {
    throw new Error("Secure storage is not available on this device.");
  }
  return vault.encrypt(value);
}

function firstSecret(secrets: Record<string, string>): string | null {
  return (
    secrets.apiKey ??
    secrets.bedrockApiKey ??
    secrets.vertexApiKey ??
    null
  );
}

function pairRevisions(connectionRevision: number, profileRevision: number): number {
  const left = Math.max(0, Math.trunc(connectionRevision));
  const right = Math.max(0, Math.trunc(profileRevision));
  const sum = left + right;
  return (sum * (sum + 1)) / 2 + right;
}

function appendRevisionHistory<T extends { id: string; revision: number }>(
  history: T[],
  value: T,
): T[] {
  return [
    ...history.filter(
      (candidate) =>
        candidate.id !== value.id || candidate.revision !== value.revision,
    ),
    structuredClone(value),
  ];
}
