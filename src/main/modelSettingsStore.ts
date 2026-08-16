import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  defaultModelGenerationSettings,
  getDefaultModelSettings,
  isProviderKind,
  normalizeModelSettingsInput,
  providerConnectionTargetIdentity,
  type ModelCatalogMutationResult,
  type ModelProfile,
  type ModelProfileInput,
  type ModelProfileVerification,
  type ModelSettingsInput,
  type ModelSettingsValidationErrors,
  type PublishedModelMetadata,
  type ProviderConnectionInput,
  type ProviderConnectionVerification,
  type ProviderCredentialSource,
  type ProviderKind,
  type PublicModelCatalog,
  type PublicModelSettings,
  type PublicProviderConnection,
  type ResolvedModelBinding,
  type RevisionedModelResourceInput,
  type SaveModelProfileResult,
  type SaveProviderConnectionResult,
  validateModelSettingsInput,
} from "../shared/modelSettings";
import { capabilitiesForModel, listModelCatalogEntries } from "./providers/modelMatrix";
import {
  getProviderDescriptor,
  listProviderDescriptors,
  providerSupportsEmbeddings,
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
  publishedModels?: PublishedModelMetadata[];
  verification?: ProviderConnectionVerification;
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
  credentialSource: ProviderCredentialSource;
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
  clearConnectionCredential(
    input: RevisionedModelResourceInput,
  ): Promise<ModelCatalogMutationResult>;
  recordConnectionVerification(
    connectionId: string,
    expectedRevision: number,
    verification: Omit<ProviderConnectionVerification, "connectionRevision">,
  ): Promise<ModelCatalogMutationResult>;
  recordProfileVerification(
    profileId: string,
    expectedProfileRevision: number,
    expectedConnectionRevision: number,
    verification: Omit<
      ModelProfileVerification,
      "profileRevision" | "connectionRevision"
    >,
  ): Promise<ModelCatalogMutationResult>;
  recordPublishedModels(
    connectionId: string,
    models: PublishedModelMetadata[],
  ): Promise<void>;
  deleteConnection(
    input: RevisionedModelResourceInput,
  ): Promise<ModelCatalogMutationResult>;
  saveProfile(input: ModelProfileInput): Promise<SaveModelProfileResult>;
  deleteProfile(
    input: RevisionedModelResourceInput,
  ): Promise<ModelCatalogMutationResult>;
  setDefaultProfile(
    purpose: "chat" | "embedding",
    profileId: string | null,
  ): Promise<ModelCatalogMutationResult>;
  setModelHidden(routedModelId: string, hidden: boolean): Promise<ModelCatalogMutationResult>;
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

  function mutate<T>(operation: (stored: StoredModelSettingsV2) => Promise<T>): Promise<T> {
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

  async function loadCatalogFrom(stored: StoredModelSettingsV2): Promise<PublicModelCatalog> {
    return {
      schemaVersion: 2,
      descriptors: listProviderDescriptors(),
      entries: listModelCatalogEntries().filter(
        (entry) => !stored.hiddenRoutedModelIds.includes(entry.routedModelId),
      ),
      connections: stored.connections.map(toPublicConnection),
      profiles: stored.profiles.map((profile) =>
        toPublicProfile(
          profile,
          stored.connections.find(
            (connection) => connection.id === profile.connectionId,
          ),
        ),
      ),
      defaultChatProfileId: stored.defaultChatProfileId,
      defaultEmbeddingProfileId: stored.defaultEmbeddingProfileId,
      hiddenRoutedModelIds: [...stored.hiddenRoutedModelIds],
      updatedAt: stored.updatedAt || null,
    };
  }

  function decryptSecrets(connection: StoredProviderConnection): Record<string, string> {
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
      frozenBinding?.profileId ??
      profileId ??
      stored.defaultChatProfileId ??
      findRecoverableDefaultProfile(stored, "chat")?.id;
    const profileRevision = frozenBinding?.profileRevision;
    const profile = [...stored.profiles, ...stored.profileHistory].find(
      (candidate) =>
        candidate.id === selectedId &&
        (profileRevision === undefined || candidate.revision === profileRevision),
    );
    if (!profile) {
      throw new Error("没有可用的模型档案，请先在设置中配置模型。");
    }
    const connectionRevision = frozenBinding?.connectionRevision;
    const connection = [...stored.connections, ...stored.connectionHistory].find(
      (candidate) =>
        candidate.id === profile.connectionId &&
        (connectionRevision === undefined || candidate.revision === connectionRevision),
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
    const catalogEntry = listModelCatalogEntries().find(
      (entry) =>
        entry.providerKind === connection.providerKind &&
        entry.modelId === profile.modelId,
    );
    const publishedModel = connection.publishedModels?.find(
      (candidate) => candidate.modelId === profile.modelId,
    );
    const contextWindow =
      frozenBinding?.contextWindow ??
      catalogEntry?.contextWindow ??
      publishedModel?.contextWindow;
    const contextWindowSource =
      frozenBinding?.contextWindowSource ??
      catalogEntry?.contextWindowSource ??
      publishedModel?.contextWindowSource;
    return {
      binding: {
        profileId: profile.id,
        connectionId: connection.id,
        providerKind: connection.providerKind,
        modelId: profile.modelId,
        ...(contextWindow ? { contextWindow } : {}),
        ...(contextWindow && contextWindowSource
          ? { contextWindowSource: { ...contextWindowSource } }
          : {}),
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
      return mutate(async (stored) => {
        await persistRecoveredDefaults(stored);
        return toLegacyPublicSettings(stored);
      });
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
          ? stored.connections.find((connection) => connection.id === existingProfile.connectionId)
          : undefined;
        const reusableConnection =
          existingConnection?.providerKind === providerKind ? existingConnection : undefined;
        const validation = validateModelSettingsInput(
          input,
          Boolean(reusableConnection && legacy.hasApiKey),
        );
        if (!validation.valid) {
          throw new ModelSettingsValidationError(validation.errors);
        }
        const timestamp = now();
        const connectionId = reusableConnection?.id ?? `connection_${createId()}`;
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
          credentialSource: Object.keys(encryptedSecrets).length > 0 ? "stored" : "none",
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
                entry.providerKind === providerKind && entry.modelId === normalized.chatModel,
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
          stored.profileHistory = appendRevisionHistory(stored.profileHistory, existingProfile);
        }
        stored.defaultChatProfileId = profileId;
        if (normalized.embeddingModel) {
          const embeddingId = stored.defaultEmbeddingProfileId ?? `profile_${createId()}`;
          const oldEmbedding = stored.profiles.find((candidate) => candidate.id === embeddingId);
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
            stored.profileHistory = appendRevisionHistory(stored.profileHistory, oldEmbedding);
          }
          stored.defaultEmbeddingProfileId = embeddingId;
        }
        stored.updatedAt = timestamp;
        await writeStoredSettings(stored);
        return toLegacyPublicSettings(stored);
      });
    },

    async getApiKey() {
      return mutate(async (stored) => {
        await persistRecoveredDefaults(stored);
        if (!stored.defaultChatProfileId) {
          return null;
        }
        const resolved = await resolveProfileFrom(stored);
        return firstSecret(resolved.secrets);
      });
    },

    async loadCatalog() {
      return mutate(async (stored) => {
        await persistRecoveredDefaults(stored);
        return loadCatalogFrom(stored);
      });
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
              message: "已保存连接不能切换服务商；请新建连接，避免凭证被发送到其他厂商端点。",
            } satisfies SaveProviderConnectionResult;
          }
          if (
            existing?.providerKind === "custom" &&
            existing.values.protocol &&
            existing.values.protocol !== (input.values.protocol || existing.values.protocol)
          ) {
            return {
              ok: false,
              message:
                "已保存的自定义连接不能切换接口协议；请新建连接，避免凭证被发送到不同协议端点。",
            } satisfies SaveProviderConnectionResult;
          }
          if (
            existing &&
            input.expectedRevision === undefined
          ) {
            return {
              ok: false,
              message: "更新服务商连接必须提供当前修订号，请重新加载后再试。",
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
          const requestedCredentialSource =
            input.credentialSource ??
            existing?.credentialSource ??
            (descriptor.needsCredential ? "stored" : "none");
          const connectionTargetChanged = Boolean(
            existing &&
              providerConnectionTargetIdentity(
                existing.providerKind,
                existing.values,
              ) !==
                providerConnectionTargetIdentity(descriptor.kind, values),
          );
          const credentialSourceChanged = Boolean(
            existing &&
              existing.credentialSource !== requestedCredentialSource,
          );
          const canReuseExistingSecrets =
            Boolean(existing) &&
            !connectionTargetChanged &&
            !credentialSourceChanged;
          const existingSecret =
            canReuseExistingSecrets &&
            Boolean(existing && Object.keys(existing.encryptedSecrets).length > 0);
          const environmentCredentialAvailable = Boolean(
            requestedCredentialSource === "environment" &&
            descriptor.environmentKey &&
            process.env[descriptor.environmentKey],
          );
          const errors = {
            ...validateProviderFields(descriptor, values, {
              hasStoredSecret: Boolean(existingSecret) || environmentCredentialAvailable,
            }),
            ...validateConditionalCredentials(
              descriptor.kind,
              values,
              canReuseExistingSecrets ? existing : undefined,
            ),
          };
          if (requestedCredentialSource === "environment" && !descriptor.environmentKey) {
            errors.credentialSource = `${descriptor.title} 不支持环境变量凭证来源。`;
          } else if (
            requestedCredentialSource === "environment" &&
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
          const encryptedSecrets = canReuseExistingSecrets
            ? { ...(existing?.encryptedSecrets ?? {}) }
            : {};
          const publicValues: Record<string, string> = {};
          let secretChanged = false;
          if (requestedCredentialSource === "environment") {
            for (const field of descriptor.fields.filter((candidate) => candidate.secret)) {
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
              if (requestedCredentialSource !== "environment" && value) {
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
            requestedCredentialSource,
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
                  keySetAt: secretChanged ? timestamp : (existing?.keySetAt ?? timestamp),
                }
              : {}),
            ...(existing?.lastUsedAt ? { lastUsedAt: existing.lastUsedAt } : {}),
            ...(!connectionTargetChanged && existing?.publishedModels
              ? { publishedModels: structuredClone(existing.publishedModels) }
              : {}),
            revision: (existing?.revision ?? 0) + 1,
            createdAt: existing?.createdAt ?? timestamp,
            updatedAt: timestamp,
          };
          if (existing) {
            stored.connectionHistory = appendRevisionHistory(stored.connectionHistory, existing);
          }
          stored.connections = [
            ...stored.connections.filter((candidate) => candidate.id !== connection.id),
            connection,
          ];
          if (existing) {
            const invalidatedProfileIds = new Set(
              stored.profiles
                .filter((profile) => profile.connectionId === connection.id)
                .map((profile) => profile.id),
            );
            stored.profiles = stored.profiles.map((profile) =>
              profile.connectionId === connection.id
                ? { ...profile, verification: undefined }
                : profile,
            );
            if (
              stored.defaultChatProfileId &&
              invalidatedProfileIds.has(stored.defaultChatProfileId)
            ) {
              stored.defaultChatProfileId = null;
            }
            if (
              stored.defaultEmbeddingProfileId &&
              invalidatedProfileIds.has(stored.defaultEmbeddingProfileId)
            ) {
              stored.defaultEmbeddingProfileId = null;
            }
          }

          const initialModelId = descriptor.recommendedModel ?? publicValues.modelId;
          const connectionProfiles = stored.profiles.filter(
            (profile) => profile.connectionId === connection.id,
          );
          const previousCustomModelId =
            existing?.providerKind === "custom" ? existing.values.modelId : undefined;
          const customModelProfile =
            descriptor.kind === "custom" && previousCustomModelId
              ? (connectionProfiles.find((profile) => profile.modelId === previousCustomModelId) ??
                connectionProfiles.find((profile) => profile.id === stored.defaultChatProfileId))
              : undefined;
          if (
            customModelProfile &&
            initialModelId &&
            customModelProfile.modelId !== initialModelId
          ) {
            stored.profileHistory = appendRevisionHistory(
              stored.profileHistory,
              customModelProfile,
            );
            stored.profiles = stored.profiles.map((profile) =>
              profile.id === customModelProfile.id
                ? {
                    ...profile,
                    name: profile.name === previousCustomModelId ? initialModelId : profile.name,
                    modelId: initialModelId,
                    verification: undefined,
                    revision: profile.revision + 1,
                    updatedAt: timestamp,
                  }
                : profile,
            );
          } else if (connectionProfiles.length === 0 && initialModelId) {
            const profile: ModelProfile = {
              id: `profile_${createId()}`,
              name: initialModelId,
              connectionId: connection.id,
              modelId: initialModelId,
              purpose: "chat",
              generation: defaultModelGenerationSettings(),
              ...(descriptor.kind === "custom"
                ? {
                    capabilityOverrides: {
                      tools: true,
                      streaming: true,
                    },
                  }
                : {}),
              custom:
                descriptor.kind === "custom" ||
                !Boolean(
                  listModelCatalogEntries().find(
                    (entry) =>
                      entry.providerKind === descriptor.kind && entry.modelId === initialModelId,
                  ),
                ),
              revision: 1,
              createdAt: timestamp,
              updatedAt: timestamp,
            };
            stored.profiles.push(profile);
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

    async clearConnectionCredential(input) {
      return mutate(async (stored) => {
        const existing = stored.connections.find((candidate) => candidate.id === input.id);
        if (!existing) {
          return { ok: false, message: "服务商连接不存在。" };
        }
        if (existing.revision !== input.expectedRevision) {
          return {
            ok: false,
            message: "连接已更新，未移除较新修订中的凭证；请重新加载后再试。",
          };
        }
        const timestamp = now();
        const sanitizedHistory = stored.connectionHistory.map((connection) =>
          connection.id === input.id ? withoutConnectionSecrets(connection) : connection,
        );
        stored.connectionHistory = appendRevisionHistory(
          sanitizedHistory,
          withoutConnectionSecrets(existing),
        );
        const connection: StoredProviderConnection = {
          ...withoutConnectionSecrets(existing),
          revision: existing.revision + 1,
          updatedAt: timestamp,
        };
        stored.connections = stored.connections.map((candidate) =>
          candidate.id === input.id ? connection : candidate,
        );
        const affectedProfileIds = new Set(
          stored.profiles
            .filter((profile) => profile.connectionId === input.id)
            .map((profile) => profile.id),
        );
        stored.profiles = stored.profiles.map((profile) =>
          profile.connectionId === input.id
            ? { ...profile, verification: undefined }
            : profile,
        );
        if (
          stored.defaultChatProfileId &&
          affectedProfileIds.has(stored.defaultChatProfileId)
        ) {
          stored.defaultChatProfileId = null;
        }
        if (
          stored.defaultEmbeddingProfileId &&
          affectedProfileIds.has(stored.defaultEmbeddingProfileId)
        ) {
          stored.defaultEmbeddingProfileId = null;
        }
        stored.updatedAt = timestamp;
        await writeStoredSettings(stored);
        return { ok: true, catalog: await loadCatalogFrom(stored) };
      });
    },

    async recordConnectionVerification(connectionId, expectedRevision, verification) {
      return mutate(async (stored) => {
        const connection = stored.connections.find((candidate) => candidate.id === connectionId);
        if (!connection) {
          return { ok: false, message: "服务商连接不存在。" };
        }
        if (connection.revision !== expectedRevision) {
          return {
            ok: false,
            message: "连接已在测试期间更新，请重新测试。",
          };
        }
        connection.verification = {
          ...verification,
          connectionRevision: connection.revision,
        };
        if (verification.status === "failed") {
          const affectedProfileIds = new Set(
            stored.profiles
              .filter((profile) => profile.connectionId === connectionId)
              .map((profile) => profile.id),
          );
          if (
            stored.defaultChatProfileId &&
            affectedProfileIds.has(stored.defaultChatProfileId)
          ) {
            stored.defaultChatProfileId = null;
          }
          if (
            stored.defaultEmbeddingProfileId &&
            affectedProfileIds.has(stored.defaultEmbeddingProfileId)
          ) {
            stored.defaultEmbeddingProfileId = null;
          }
        }
        const timestamp = now();
        connection.updatedAt = timestamp;
        stored.updatedAt = timestamp;
        await writeStoredSettings(stored);
        return { ok: true, catalog: await loadCatalogFrom(stored) };
      });
    },

    async recordProfileVerification(
      profileId,
      expectedProfileRevision,
      expectedConnectionRevision,
      verification,
    ) {
      return mutate(async (stored) => {
        const profile = stored.profiles.find((candidate) => candidate.id === profileId);
        if (!profile) {
          return { ok: false, message: "模型档案不存在。" };
        }
        const connection = stored.connections.find(
          (candidate) => candidate.id === profile.connectionId,
        );
        if (!connection) {
          return { ok: false, message: "模型档案引用的服务商连接不存在。" };
        }
        if (
          profile.revision !== expectedProfileRevision ||
          connection.revision !== expectedConnectionRevision
        ) {
          return {
            ok: false,
            message: "模型或连接已在测试期间更新，请重新测试。",
          };
        }
        profile.verification = {
          ...verification,
          profileRevision: profile.revision,
          connectionRevision: connection.revision,
        };
        if (verification.status === "passed") {
          if (
            profile.purpose === "chat" &&
            !stored.defaultChatProfileId &&
            profileCanBecomeDefault(profile, connection)
          ) {
            stored.defaultChatProfileId = profile.id;
          }
          if (
            profile.purpose === "embedding" &&
            !stored.defaultEmbeddingProfileId &&
            profileCanBecomeDefault(profile, connection)
          ) {
            stored.defaultEmbeddingProfileId = profile.id;
          }
        } else {
          if (stored.defaultChatProfileId === profile.id) {
            stored.defaultChatProfileId = null;
          }
          if (stored.defaultEmbeddingProfileId === profile.id) {
            stored.defaultEmbeddingProfileId = null;
          }
        }
        const timestamp = now();
        profile.updatedAt = timestamp;
        stored.updatedAt = timestamp;
        await writeStoredSettings(stored);
        return { ok: true, catalog: await loadCatalogFrom(stored) };
      });
    },

    async recordPublishedModels(connectionId, models) {
      await mutate(async (stored) => {
        const connection = stored.connections.find(
          (candidate) => candidate.id === connectionId,
        );
        if (!connection) {
          return;
        }
        const normalized = normalizePublishedModels(models);
        if (
          JSON.stringify(connection.publishedModels ?? []) ===
          JSON.stringify(normalized)
        ) {
          return;
        }
        connection.publishedModels = normalized;
        stored.updatedAt = now();
        await writeStoredSettings(stored);
      });
    },

    async deleteConnection(input) {
      return mutate(async (stored) => {
        const connection = stored.connections.find((candidate) => candidate.id === input.id);
        if (!connection) {
          return { ok: false, message: "服务商连接不存在。" };
        }
        if (connection.revision !== input.expectedRevision) {
          return {
            ok: false,
            message: "连接已更新，未删除较新修订；请重新加载后再试。",
          };
        }
        if (await options.isConnectionReferenced?.(input.id)) {
          return {
            ok: false,
            message: "该连接仍被活动或待确认计划引用，不能删除。",
          };
        }
        if (stored.profiles.some((profile) => profile.connectionId === input.id)) {
          return {
            ok: false,
            message: "该连接仍被模型档案引用，请先删除相关模型档案。",
          };
        }
        stored.connections = stored.connections.filter(
          (candidate) => candidate.id !== input.id,
        );
        stored.connectionHistory = stored.connectionHistory.filter(
          (candidate) => candidate.id !== input.id,
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
        if (input.id && !existing) {
          return {
            ok: false,
            message: "要更新的模型档案不存在，请重新加载后再试。",
          };
        }
        if (existing && input.expectedRevision === undefined) {
          return {
            ok: false,
            message: "更新模型档案必须提供当前修订号，请重新加载后再试。",
          };
        }
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
        if (
          input.purpose === "embedding" &&
          !providerSupportsEmbeddings(connection.providerKind, connection.values)
        ) {
          return {
            ok: false,
            message: "该服务商或接口协议尚未实现 Embedding 调用，不能创建 Embedding 模型。",
          };
        }
        const timestamp = now();
        const generation = {
          ...defaultModelGenerationSettings(),
          ...(existing?.generation ?? {}),
          ...(input.generation ?? {}),
        };
        const capabilityOverrides = input.capabilityOverrides
          ? { ...input.capabilityOverrides }
          : existing?.capabilityOverrides
            ? { ...existing.capabilityOverrides }
            : connection.providerKind === "custom"
              ? { tools: true, streaming: true }
              : undefined;
        const profile: ModelProfile = {
          id: existing?.id ?? `profile_${createId()}`,
          name: input.name.trim() || modelId,
          connectionId: connection.id,
          modelId,
          purpose: input.purpose,
          generation,
          ...(capabilityOverrides ? { capabilityOverrides } : {}),
          custom: !Boolean(
            listModelCatalogEntries().find(
              (entry) =>
                entry.providerKind === connection.providerKind && entry.modelId === modelId,
            ),
          ),
          revision: (existing?.revision ?? 0) + 1,
          createdAt: existing?.createdAt ?? timestamp,
          updatedAt: timestamp,
        };
        if (existing) {
          stored.profileHistory = appendRevisionHistory(stored.profileHistory, existing);
          if (stored.defaultChatProfileId === existing.id) {
            stored.defaultChatProfileId = null;
          }
          if (stored.defaultEmbeddingProfileId === existing.id) {
            stored.defaultEmbeddingProfileId = null;
          }
        }
        stored.profiles = [
          ...stored.profiles.filter((candidate) => candidate.id !== profile.id),
          profile,
        ];
        if (
          profile.purpose === "chat" &&
          !stored.defaultChatProfileId &&
          profileCanBecomeDefault(profile, connection)
        ) {
          stored.defaultChatProfileId = profile.id;
        }
        if (
          profile.purpose === "embedding" &&
          !stored.defaultEmbeddingProfileId &&
          profileCanBecomeDefault(profile, connection)
        ) {
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

    async deleteProfile(input) {
      return mutate(async (stored) => {
        const existing = stored.profiles.find((candidate) => candidate.id === input.id);
        if (!existing) {
          return { ok: false, message: "模型档案不存在。" };
        }
        if (existing.revision !== input.expectedRevision) {
          return {
            ok: false,
            message: "模型档案已更新，未删除较新修订；请重新加载后再试。",
          };
        }
        if (await options.isProfileReferenced?.(input.id)) {
          return {
            ok: false,
            message: "该模型档案仍被活动或待确认计划引用，不能删除。",
          };
        }
        stored.profiles = stored.profiles.filter((candidate) => candidate.id !== input.id);
        stored.profileHistory = stored.profileHistory.filter(
          (candidate) => candidate.id !== input.id,
        );
        if (stored.defaultChatProfileId === input.id) {
          stored.defaultChatProfileId =
            stored.profiles.find(
              (candidate) =>
                candidate.purpose === "chat" &&
                profileCanBecomeDefault(
                  candidate,
                  stored.connections.find(
                    (connection) => connection.id === candidate.connectionId,
                  ),
                ),
            )?.id ?? null;
        }
        if (stored.defaultEmbeddingProfileId === input.id) {
          stored.defaultEmbeddingProfileId =
            stored.profiles.find(
              (candidate) =>
                candidate.purpose === "embedding" &&
                profileCanBecomeDefault(
                  candidate,
                  stored.connections.find(
                    (connection) => connection.id === candidate.connectionId,
                  ),
                ),
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
            (candidate) => candidate.id === profileId && candidate.purpose === purpose,
          );
          if (!profile) {
            return { ok: false, message: "默认模型档案不存在或用途不匹配。" };
          }
          const connection = stored.connections.find(
            (candidate) => candidate.id === profile.connectionId,
          );
          if (!profileCanBecomeDefault(profile, connection)) {
            return {
              ok: false,
              message: "该模型及其连接尚未通过当前修订的测试，不能设为默认。",
            };
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
      if (profileId) {
        return resolveProfileFrom(await readStoredSettings(), profileId);
      }
      return mutate(async (stored) => {
        await persistRecoveredDefaults(stored);
        const resolved = await resolveProfileFrom(stored);
        return resolved;
      });
    },

    async resolveBinding(binding) {
      return resolveProfileFrom(await readStoredSettings(), binding.profileId, binding);
    },

    async resolveConnection(connectionId) {
      const stored = await readStoredSettings();
      const connection = stored.connections.find((candidate) => candidate.id === connectionId);
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
        credentialSource: connection.credentialSource,
        connectionValues: { ...connection.values },
        secrets,
        revision: connection.revision,
      };
    },

    async markConnectionUsed(connectionId) {
      await mutate(async (stored) => {
        const connection = stored.connections.find((candidate) => candidate.id === connectionId);
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

  /**
   * A default is a convenience pointer, not proof that no model is usable.
   * Older app versions and interrupted settings saves may leave it null even
   * though a current verified profile exists. Recover it before returning any
   * public settings so the UI and the runtime make the same decision.
   */
  async function persistRecoveredDefaults(stored: StoredModelSettingsV2): Promise<void> {
    let changed = false;
    if (!stored.defaultChatProfileId) {
      const profile = findRecoverableDefaultProfile(stored, "chat");
      if (profile) {
        stored.defaultChatProfileId = profile.id;
        changed = true;
      }
    }
    if (!stored.defaultEmbeddingProfileId) {
      const profile = findRecoverableDefaultProfile(stored, "embedding");
      if (profile) {
        stored.defaultEmbeddingProfileId = profile.id;
        changed = true;
      }
    }
    if (changed) {
      stored.updatedAt = now();
      await writeStoredSettings(stored);
    }
  }

  function migrateV1(legacy: StoredModelSettingsV1, timestamp: string): StoredModelSettingsV2 {
    const providerKind = normalizeLegacyProviderKind(legacy.providerId);
    const connectionId = "connection_migrated_default";
    const chatProfileId = "profile_migrated_chat";
    const embeddingProfileId = legacy.embeddingModel ? "profile_migrated_embedding" : null;
    const descriptor = requireProviderDescriptor(providerKind);
    const connection: StoredProviderConnection = {
      id: connectionId,
      name: descriptor.title,
      providerKind,
      values: legacy.baseUrl ? { baseUrl: legacy.baseUrl } : {},
      encryptedSecrets: legacy.encryptedApiKey ? { apiKey: legacy.encryptedApiKey } : {},
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
                  entry.providerKind === providerKind && entry.modelId === legacy.chatModel,
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
    connections: Array.isArray(stored.connections)
      ? stored.connections.map(normalizeStoredConnection)
      : [],
    connectionHistory: Array.isArray(stored.connectionHistory)
      ? stored.connectionHistory.map(normalizeStoredConnection)
      : [],
    profiles: Array.isArray(stored.profiles) ? stored.profiles : [],
    profileHistory: Array.isArray(stored.profileHistory) ? stored.profileHistory : [],
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

function toPublicConnection(connection: StoredProviderConnection): PublicProviderConnection {
  return {
    id: connection.id,
    name: connection.name,
    providerKind: connection.providerKind,
    values: { ...connection.values },
    credentialSource: connection.credentialSource,
    hasCredential: hasUsableCredential(connection),
    ...(connection.verification &&
    connection.verification.connectionRevision === connection.revision
      ? { verification: { ...connection.verification } }
      : {}),
    ...(connection.keySetAt ? { keySetAt: connection.keySetAt } : {}),
    ...(connection.lastUsedAt ? { lastUsedAt: connection.lastUsedAt } : {}),
    ...(connection.publishedModels?.length
      ? { publishedModels: structuredClone(connection.publishedModels) }
      : {}),
    revision: connection.revision,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

function normalizeStoredConnection(
  connection: StoredProviderConnection,
): StoredProviderConnection {
  return {
    ...connection,
    ...(connection.publishedModels
      ? { publishedModels: normalizePublishedModels(connection.publishedModels) }
      : {}),
  };
}

function normalizePublishedModels(value: unknown): PublishedModelMetadata[] {
  if (!Array.isArray(value)) return [];
  const byModelId = new Map<string, PublishedModelMetadata>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const item = candidate as Partial<PublishedModelMetadata>;
    const modelId =
      typeof item.modelId === "string" ? item.modelId.trim() : "";
    const contextWindow =
      typeof item.contextWindow === "number" &&
      Number.isFinite(item.contextWindow) &&
      item.contextWindow > 0
        ? Math.floor(item.contextWindow)
        : 0;
    const source = item.contextWindowSource;
    if (
      !modelId ||
      !contextWindow ||
      !source ||
      source.kind !== "provider_metadata" ||
      typeof source.label !== "string" ||
      !source.label.trim()
    ) {
      continue;
    }
    byModelId.set(modelId, {
      modelId,
      contextWindow,
      contextWindowSource: {
        kind: "provider_metadata",
        label: source.label.trim(),
        ...(typeof source.checkedAt === "string" && source.checkedAt.trim()
          ? { checkedAt: source.checkedAt }
          : {}),
      },
    });
  }
  return [...byModelId.values()].sort((left, right) =>
    left.modelId.localeCompare(right.modelId),
  );
}

function toPublicProfile(
  profile: ModelProfile,
  connection: StoredProviderConnection | undefined,
): ModelProfile {
  const publicProfile = structuredClone(profile);
  if (
    !connection ||
    publicProfile.verification?.profileRevision !== publicProfile.revision ||
    publicProfile.verification.connectionRevision !== connection.revision
  ) {
    delete publicProfile.verification;
  }
  return publicProfile;
}

function toLegacyPublicSettings(stored: StoredModelSettingsV2): PublicModelSettings {
  const defaults = getDefaultModelSettings();
  const profile = stored.profiles.find((candidate) => candidate.id === stored.defaultChatProfileId);
  const connection = profile
    ? stored.connections.find((candidate) => candidate.id === profile.connectionId)
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
      connection.providerKind === "openai" ? "openai-compatible" : connection.providerKind,
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
    if (method === "iam" && (!values.awsAccessKeyId?.trim() || !hasSecret("awsSecretAccessKey"))) {
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

function hasUsableCredential(connection: StoredProviderConnection): boolean {
  if (Object.keys(connection.encryptedSecrets).length > 0) {
    return true;
  }
  if (connection.credentialSource === "environment") {
    const environmentKey = getProviderDescriptor(connection.providerKind)?.environmentKey;
    return Boolean(environmentKey && process.env[environmentKey]);
  }
  return connection.credentialSource === "ambient" || connection.providerKind === "ollama";
}

function connectionCanBecomeDefault(
  connection: StoredProviderConnection | undefined,
): boolean {
  if (!connection || !hasUsableCredential(connection)) {
    return false;
  }
  return (
    connection.verification?.status === "passed" &&
    connection.verification.connectionRevision === connection.revision
  );
}

function profileCanBecomeDefault(
  profile: ModelProfile,
  connection: StoredProviderConnection | undefined,
): boolean {
  return (
    connectionCanBecomeDefault(connection) &&
    profile.verification?.status === "passed" &&
    profile.verification.profileRevision === profile.revision &&
    profile.verification.connectionRevision === connection?.revision
  );
}

function findRecoverableDefaultProfile(
  stored: StoredModelSettingsV2,
  purpose: "chat" | "embedding",
): ModelProfile | undefined {
  return stored.profiles
    .filter(
      (profile) =>
        profile.purpose === purpose &&
        profileCanBecomeDefault(
          profile,
          stored.connections.find(
            (connection) => connection.id === profile.connectionId,
          ),
        ),
    )
    .sort(
      (left, right) =>
        Date.parse(right.verification?.checkedAt ?? right.updatedAt) -
          Date.parse(left.verification?.checkedAt ?? left.updatedAt) ||
        right.updatedAt.localeCompare(left.updatedAt) ||
        left.id.localeCompare(right.id),
    )[0];
}

function isProviderFieldVisible(
  field: { showWhen?: Record<string, string> },
  values: Record<string, string>,
): boolean {
  return (
    !field.showWhen ||
    Object.entries(field.showWhen).every(([key, expected]) => values[key] === expected)
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
    (descriptor.kind === "bedrock" && (values.authMethod === "profile" || !values.authMethod)) ||
    (descriptor.kind === "vertex" && (values.authMethod === "adc" || !values.authMethod))
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
  return secrets.apiKey ?? secrets.bedrockApiKey ?? secrets.vertexApiKey ?? null;
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
      (candidate) => candidate.id !== value.id || candidate.revision !== value.revision,
    ),
    structuredClone(value),
  ];
}

function withoutConnectionSecrets(connection: StoredProviderConnection): StoredProviderConnection {
  const sanitized: StoredProviderConnection = {
    ...structuredClone(connection),
    encryptedSecrets: {},
    credentialSource: "none",
  };
  delete sanitized.keySetAt;
  delete sanitized.verification;
  return sanitized;
}
