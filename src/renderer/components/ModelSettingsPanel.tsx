import { useEffect, useMemo, useState } from "react";
import {
  defaultModelGenerationSettings,
  type ModelProfile,
  type ModelProfileInput,
  type ProviderConnectionInput,
  type ProviderCredentialSource,
  type ProviderDescriptor,
  type ProviderField,
  type ProviderKind,
  type PublicModelCatalog,
  type PublicProviderConnection,
  type TestProviderConnectionResult,
} from "../../shared/modelSettings";
import { modelConnectionState } from "../modelConnectionPresentation";
import { canReuseDisplayedCredential } from "../modelCredentialReuse";

type PanelStatus = {
  kind: "idle" | "working" | "saved" | "error";
  message: string;
};

type ConnectionDraft = ProviderConnectionInput;
type ProfileDraft = ModelProfileInput;

const emptyCatalog: PublicModelCatalog = {
  schemaVersion: 2,
  descriptors: [],
  entries: [],
  connections: [],
  profiles: [],
  defaultChatProfileId: null,
  defaultEmbeddingProfileId: null,
  hiddenRoutedModelIds: [],
  updatedAt: null,
};

export function ModelSettingsPanel() {
  const [catalog, setCatalog] = useState<PublicModelCatalog>(emptyCatalog);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(
    null,
  );
  const [connectionDraft, setConnectionDraft] =
    useState<ConnectionDraft | null>(null);
  const [connectionErrors, setConnectionErrors] = useState<
    Record<string, string>
  >({});
  const [profileDraft, setProfileDraft] = useState<ProfileDraft | null>(null);
  const [status, setStatus] = useState<PanelStatus>({
    kind: "idle",
    message: "正在加载服务商与模型配置…",
  });
  const [testResult, setTestResult] =
    useState<TestProviderConnectionResult | null>(null);

  useEffect(() => {
    if (!window.buildingAgent) {
      setStatus({
        kind: "error",
        message: "浏览器预览模式无法读取桌面端模型配置。",
      });
      return;
    }
    void window.buildingAgent
      .loadModelCatalog()
      .then((loaded) => {
        setCatalog(loaded);
        const firstConnection = loaded.connections[0];
        if (firstConnection) {
          setSelectedConnectionId(firstConnection.id);
          setConnectionDraft(connectionToDraft(firstConnection));
        } else if (loaded.descriptors[0]) {
          setConnectionDraft(newConnectionDraft(loaded.descriptors[0]));
        }
        setStatus({
          kind: "idle",
          message: loaded.connections.length
            ? `已加载 ${loaded.connections.length} 个服务商连接。`
            : "添加第一个服务商；测试通过后即可设为默认模型。",
        });
      })
      .catch((error) => {
        setStatus({
          kind: "error",
          message: error instanceof Error ? error.message : "无法加载模型配置。",
        });
      });
  }, []);

  const descriptor = useMemo(
    () =>
      catalog.descriptors.find(
        (candidate) => candidate.kind === connectionDraft?.providerKind,
      ) ?? null,
    [catalog.descriptors, connectionDraft?.providerKind],
  );
  const selectedConnection = useMemo(
    () =>
      catalog.connections.find(
        (connection) => connection.id === selectedConnectionId,
      ) ?? null,
    [catalog.connections, selectedConnectionId],
  );
  const selectedProfiles = useMemo(
    () =>
      catalog.profiles.filter(
        (profile) => profile.connectionId === selectedConnectionId,
      ),
    [catalog.profiles, selectedConnectionId],
  );
  const selectedEntries = useMemo(
    () =>
      selectedConnection
        ? catalog.entries.filter(
            (entry) =>
              entry.providerKind === selectedConnection.providerKind &&
              !catalog.hiddenRoutedModelIds.includes(entry.routedModelId),
          )
        : [],
    [
      catalog.entries,
      catalog.hiddenRoutedModelIds,
      selectedConnection,
    ],
  );
  const defaultChatProfile = catalog.profiles.find(
    (profile) => profile.id === catalog.defaultChatProfileId,
  );
  const defaultEmbeddingProfile = catalog.profiles.find(
    (profile) => profile.id === catalog.defaultEmbeddingProfileId,
  );
  const displayedCredentialReusable = Boolean(
    descriptor &&
      connectionDraft &&
      canReuseDisplayedCredential(
        descriptor,
        selectedConnection,
        connectionDraft,
      ),
  );

  function adoptCatalog(
    nextCatalog: PublicModelCatalog,
    connectionId?: string | null,
  ) {
    setCatalog(nextCatalog);
    const nextConnection =
      nextCatalog.connections.find(
        (candidate) => candidate.id === connectionId,
      ) ?? nextCatalog.connections[0] ?? null;
    setSelectedConnectionId(nextConnection?.id ?? null);
    if (nextConnection) {
      setConnectionDraft(connectionToDraft(nextConnection));
    }
  }

  function selectConnection(connection: PublicProviderConnection) {
    setSelectedConnectionId(connection.id);
    setConnectionDraft(connectionToDraft(connection));
    setConnectionErrors({});
    setProfileDraft(null);
    setTestResult(null);
  }

  function startNewConnection(kind?: ProviderKind) {
    const nextDescriptor =
      catalog.descriptors.find((candidate) => candidate.kind === kind) ??
      catalog.descriptors[0];
    if (!nextDescriptor) return;
    setSelectedConnectionId(null);
    setConnectionDraft(newConnectionDraft(nextDescriptor));
    setConnectionErrors({});
    setProfileDraft(null);
    setTestResult(null);
  }

  function changeProvider(kind: ProviderKind) {
    const nextDescriptor = catalog.descriptors.find(
      (candidate) => candidate.kind === kind,
    );
    if (nextDescriptor) {
      startNewConnection(nextDescriptor.kind);
    }
  }

  async function saveConnection(
    event?: React.FormEvent<HTMLFormElement>,
  ) {
    event?.preventDefault();
    if (!connectionDraft || !window.buildingAgent) return;
    setStatus({ kind: "working", message: "正在安全保存服务商连接…" });
    setConnectionErrors({});
    const result = await window.buildingAgent.saveProviderConnection(
      connectionDraft,
    );
    if (!result.ok) {
      setConnectionErrors(result.errors ?? {});
      setStatus({ kind: "error", message: result.message });
      return;
    }
    adoptCatalog(result.catalog, result.connection.id);
    setTestResult(null);
    setStatus({
      kind: "saved",
      message: "连接已保存，尚未验证；密钥不会回传到界面或运行轨迹。",
    });
  }

  async function testAndSaveConnection() {
    if (!connectionDraft || !window.buildingAgent) return;
    setStatus({ kind: "working", message: "正在测试；通过后自动安全保存…" });
    setConnectionErrors({});
    setTestResult(null);
    const result =
      await window.buildingAgent.testAndSaveProviderConnection(connectionDraft);
    if (!result.ok) {
      setConnectionErrors(result.errors ?? {});
      setTestResult(result.test ?? null);
      setStatus({ kind: "error", message: result.message });
      return;
    }
    adoptCatalog(result.catalog, result.connection.id);
    setTestResult(result.test);
    setStatus({
      kind: "saved",
      message: `连接已验证并保存 · ${result.test.latencyMs} ms`,
    });
  }

  async function testProfile(profile: ModelProfile) {
    if (!window.buildingAgent) return;
    setStatus({
      kind: "working",
      message: `正在测试 ${profile.name}…`,
    });
    const result = await window.buildingAgent.testProviderConnection({
      profileId: profile.id,
    });
    setTestResult(result);
    const nextCatalog = await window.buildingAgent.loadModelCatalog();
    adoptCatalog(nextCatalog, profile.connectionId);
    setStatus({
      kind: result.ok ? "saved" : "error",
      message: result.message,
    });
  }

  async function clearCredential(connection: PublicProviderConnection) {
    if (!window.buildingAgent) return;
    if (
      !window.confirm(
        `移除“${connection.name}”的凭证？连接和模型会保留，但在重新配置并验证前不可运行。`,
      )
    ) {
      return;
    }
    const result = await window.buildingAgent.clearProviderCredential(
      { id: connection.id, expectedRevision: connection.revision },
    );
    if (!result.ok) {
      setStatus({ kind: "error", message: result.message });
      return;
    }
    adoptCatalog(result.catalog, connection.id);
    setTestResult(null);
    setStatus({ kind: "saved", message: "凭证已从安全存储中移除。" });
  }

  async function removeConnection(connection: PublicProviderConnection) {
    if (!window.buildingAgent) return;
    if (
      !window.confirm(
        `删除“${connection.name}”？请先删除它下面的模型档案。`,
      )
    ) {
      return;
    }
    const result = await window.buildingAgent.deleteProviderConnection(
      { id: connection.id, expectedRevision: connection.revision },
    );
    if (!result.ok) {
      setStatus({ kind: "error", message: result.message });
      return;
    }
    adoptCatalog(result.catalog, null);
    const first = result.catalog.connections[0];
    if (!first && result.catalog.descriptors[0]) {
      setConnectionDraft(newConnectionDraft(result.catalog.descriptors[0]));
    }
    setStatus({ kind: "saved", message: "服务商连接已删除。" });
  }

  function startNewProfile(connectionId?: string) {
    const connection =
      catalog.connections.find((candidate) => candidate.id === connectionId) ??
      selectedConnection;
    if (!connection) {
      setStatus({ kind: "error", message: "请先保存服务商连接。" });
      return;
    }
    const recommended =
      connection.values.modelId ||
      catalog.descriptors.find(
        (candidate) => candidate.kind === connection.providerKind,
      )?.recommendedModel ||
      "";
    setProfileDraft({
      name: recommended,
      connectionId: connection.id,
      modelId: recommended,
      purpose: "chat",
      generation: defaultModelGenerationSettings(),
      ...(connection.providerKind === "custom"
        ? {
            capabilityOverrides: {
              tools: true,
              streaming: true,
            },
          }
        : {}),
    });
  }

  function editProfile(profile: ModelProfile) {
    setProfileDraft({
      id: profile.id,
      name: profile.name,
      connectionId: profile.connectionId,
      modelId: profile.modelId,
      purpose: profile.purpose,
      generation: { ...profile.generation },
      ...(profile.capabilityOverrides
        ? { capabilityOverrides: { ...profile.capabilityOverrides } }
        : {}),
      expectedRevision: profile.revision,
    });
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profileDraft || !window.buildingAgent) return;
    setStatus({ kind: "working", message: "正在保存模型…" });
    const result = await window.buildingAgent.saveModelProfile(profileDraft);
    if (!result.ok) {
      setStatus({ kind: "error", message: result.message });
      return;
    }
    adoptCatalog(result.catalog, result.profile.connectionId);
    setProfileDraft(null);
    setStatus({
      kind: "saved",
      message: result.profile.custom
        ? "自定义模型已保存；请测试后再设为默认。"
        : "模型已保存。",
    });
  }

  async function removeProfile(profile: ModelProfile) {
    if (!window.buildingAgent) return;
    if (!window.confirm(`删除模型“${profile.name}”？`)) return;
    const result = await window.buildingAgent.deleteModelProfile({
      id: profile.id,
      expectedRevision: profile.revision,
    });
    if (!result.ok) {
      setStatus({ kind: "error", message: result.message });
      return;
    }
    adoptCatalog(result.catalog, profile.connectionId);
    setProfileDraft((current) => (current?.id === profile.id ? null : current));
    setStatus({ kind: "saved", message: "模型已删除。" });
  }

  async function setDefaultProfile(profile: ModelProfile) {
    if (!window.buildingAgent) return;
    const result = await window.buildingAgent.setDefaultModelProfile(
      profile.purpose,
      profile.id,
    );
    if (!result.ok) {
      setStatus({ kind: "error", message: result.message });
      return;
    }
    adoptCatalog(result.catalog, profile.connectionId);
    setStatus({
      kind: "saved",
      message:
        profile.purpose === "chat"
          ? `${profile.name} 已设为默认对话模型。`
          : `${profile.name} 已设为默认 Embedding 模型。`,
    });
  }

  async function hideBuiltInModel(routedModelId: string) {
    if (!window.buildingAgent) return;
    const result = await window.buildingAgent.setModelHidden(
      routedModelId,
      true,
    );
    if (result.ok) {
      adoptCatalog(result.catalog, selectedConnectionId);
      setStatus({ kind: "saved", message: "推荐模型已隐藏。" });
    } else {
      setStatus({ kind: "error", message: result.message });
    }
  }

  return (
    <div className="settings-panel model-catalog-panel">
      <header className="settings-header model-manager-header">
        <div>
          <p className="kicker">Providers & Models</p>
          <h3>模型服务商</h3>
          <p>
            先配置并验证连接，再管理该服务商下的模型。所有密钥只留在主进程安全存储中。
          </p>
        </div>
        <div className="model-default-summary" aria-label="当前默认模型">
          <span>默认对话</span>
          <strong>{defaultChatProfile?.name ?? "未设置"}</strong>
          <small>
            Embedding：{defaultEmbeddingProfile?.name ?? "未设置"}
          </small>
        </div>
      </header>

      <div className="provider-manager-layout">
        <aside className="provider-manager-sidebar">
          <div className="provider-manager-sidebar-heading">
            <div>
              <strong>连接</strong>
              <span>{catalog.connections.length}</span>
            </div>
            <button
              aria-label="添加服务商连接"
              className="icon-action"
              onClick={() => startNewConnection()}
              type="button"
            >
              +
            </button>
          </div>
          <nav className="provider-connection-list" aria-label="服务商连接列表">
            {catalog.connections.map((connection) => {
              const connectionDescriptor = catalog.descriptors.find(
                (candidate) => candidate.kind === connection.providerKind,
              );
              return (
                <button
                  className={
                    connection.id === selectedConnectionId ? "is-active" : ""
                  }
                  key={connection.id}
                  onClick={() => selectConnection(connection)}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className={`connection-state-dot is-${connectionState(
                      connection,
                    )}`}
                  />
                  <span>
                    <strong>{connection.name}</strong>
                    <small>
                      {connectionDescriptor?.title ?? connection.providerKind}
                    </small>
                  </span>
                  <em>{connectionStateLabel(connection)}</em>
                </button>
              );
            })}
            {!catalog.connections.length ? (
              <p>还没有已保存的连接。</p>
            ) : null}
          </nav>
          <label className="provider-add-select">
            <span>添加服务商</span>
            <select
              onChange={(event) =>
                startNewConnection(event.currentTarget.value as ProviderKind)
              }
              value={selectedConnectionId ? "" : connectionDraft?.providerKind ?? ""}
            >
              <option disabled value="">
                选择服务商…
              </option>
              {catalog.descriptors.map((candidate) => (
                <option key={candidate.kind} value={candidate.kind}>
                  {candidate.title}
                </option>
              ))}
            </select>
          </label>
        </aside>

        <main className="provider-manager-detail">
          {connectionDraft && descriptor ? (
            <>
              <form
                className="provider-connection-form"
                onSubmit={(event) => void saveConnection(event)}
              >
                <div className="provider-detail-heading">
                  <div>
                    <span>{selectedConnection ? "已保存连接" : "新连接"}</span>
                    <h4>{connectionDraft.name || descriptor.title}</h4>
                    <p>{descriptor.description}</p>
                  </div>
                  {selectedConnection ? (
                    <ConnectionStatusBadge connection={selectedConnection} />
                  ) : (
                    <span className="connection-status-badge is-unknown">
                      尚未保存
                    </span>
                  )}
                </div>

                <div className="provider-identity-grid">
                  <label className="field">
                    <span>服务商</span>
                    <select
                      disabled={Boolean(connectionDraft.id)}
                      onChange={(event) =>
                        changeProvider(event.currentTarget.value as ProviderKind)
                      }
                      value={connectionDraft.providerKind}
                    >
                      {catalog.descriptors.map((candidate) => (
                        <option key={candidate.kind} value={candidate.kind}>
                          {candidate.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>连接名称</span>
                    <input
                      onChange={(event) =>
                        setConnectionDraft({
                          ...connectionDraft,
                          name: event.currentTarget.value,
                        })
                      }
                      value={connectionDraft.name}
                    />
                  </label>
                  {descriptor.needsCredential && descriptor.environmentKey ? (
                    <label className="field">
                      <span>凭证来源</span>
                      <select
                        onChange={(event) =>
                          setConnectionDraft({
                            ...connectionDraft,
                            credentialSource: event.currentTarget
                              .value as ProviderCredentialSource,
                          })
                        }
                        value={
                          connectionDraft.credentialSource === "environment"
                            ? "environment"
                            : "stored"
                        }
                      >
                        <option value="stored">安全存储</option>
                        <option value="environment">
                          环境变量 {descriptor.environmentKey}
                        </option>
                      </select>
                    </label>
                  ) : null}
                </div>

                <div className="provider-field-grid">
                  {descriptor.fields
                    .filter(
                      (field) =>
                        isProviderFieldVisible(field, connectionDraft.values) &&
                        !(
                          field.secret &&
                          connectionDraft.credentialSource === "environment"
                        ),
                    )
                    .map((field) => (
                      <ProviderFieldControl
                        connectionHasCredential={
                          selectedConnection?.hasCredential ?? false
                        }
                        credentialReusable={displayedCredentialReusable}
                        error={connectionErrors[field.key]}
                        field={field}
                        key={field.key}
                        onChange={(value) =>
                          setConnectionDraft({
                            ...connectionDraft,
                            values: {
                              ...connectionDraft.values,
                              [field.key]: value,
                            },
                          })
                        }
                        value={connectionDraft.values[field.key] ?? ""}
                      />
                    ))}
                </div>

                {selectedConnection ? (
                  <dl className="connection-metadata">
                    <div>
                      <dt>凭证</dt>
                      <dd>
                        {selectedConnection.hasCredential
                          ? formatCredentialSource(
                              selectedConnection.credentialSource,
                            )
                          : "未配置"}
                        {selectedConnection.keySetAt
                          ? ` · ${formatTimestamp(selectedConnection.keySetAt)} 更新`
                          : ""}
                      </dd>
                    </div>
                    <div>
                      <dt>最近测试</dt>
                      <dd>
                        {selectedConnection.verification
                          ? `${formatTimestamp(
                              selectedConnection.verification.checkedAt,
                            )} · ${
                              selectedConnection.verification.latencyMs ?? "—"
                            } ms`
                          : "尚未测试"}
                      </dd>
                    </div>
                    <div>
                      <dt>最近使用</dt>
                      <dd>
                        {selectedConnection.lastUsedAt
                          ? formatTimestamp(selectedConnection.lastUsedAt)
                          : "尚未使用"}
                      </dd>
                    </div>
                  </dl>
                ) : null}

                <div className="settings-actions provider-primary-actions">
                  <button
                    className="primary-action"
                    disabled={status.kind === "working"}
                    onClick={() => void testAndSaveConnection()}
                    type="button"
                  >
                    测试并保存
                  </button>
                  <button
                    className="secondary-action"
                    disabled={status.kind === "working"}
                    type="submit"
                  >
                    仅保存
                  </button>
                  {selectedConnection?.hasCredential &&
                  descriptor.needsCredential ? (
                    <button
                      className="secondary-action"
                      disabled={status.kind === "working"}
                      onClick={() => void clearCredential(selectedConnection)}
                      type="button"
                    >
                      移除凭证
                    </button>
                  ) : null}
                  {selectedConnection ? (
                    <button
                      className="danger-action"
                      disabled={
                        status.kind === "working" ||
                        selectedProfiles.length > 0
                      }
                      onClick={() => void removeConnection(selectedConnection)}
                      title={
                        selectedProfiles.length
                          ? "请先删除该连接下的模型"
                          : undefined
                      }
                      type="button"
                    >
                      删除连接
                    </button>
                  ) : null}
                </div>
                {testResult ? (
                  <p
                    className={`connection-test-summary ${
                      testResult.ok ? "is-success" : "is-error"
                    }`}
                    role="status"
                  >
                    {testResult.message}
                    {testResult.latencyMs !== undefined
                      ? ` · ${testResult.latencyMs} ms`
                      : ""}
                  </p>
                ) : null}
              </form>

              {selectedConnection ? (
                <section
                  aria-labelledby="connection-models-heading"
                  className="connection-model-section"
                >
                  <div className="connection-model-heading">
                    <div>
                      <span>该连接的模型</span>
                      <h4 id="connection-models-heading">
                        {selectedProfiles.length} 个模型
                      </h4>
                    </div>
                    <button
                      className="secondary-action"
                      onClick={() => startNewProfile(selectedConnection.id)}
                      type="button"
                    >
                      添加模型
                    </button>
                  </div>

                  <div className="model-profile-list">
                    {selectedProfiles.map((profile) => {
                      const entry = catalog.entries.find(
                        (candidate) =>
                          candidate.providerKind ===
                            selectedConnection.providerKind &&
                          candidate.modelId === profile.modelId,
                      );
                      const publishedModel =
                        selectedConnection.publishedModels?.find(
                          (candidate) => candidate.modelId === profile.modelId,
                        );
                      const contextWindow =
                        entry?.contextWindow ?? publishedModel?.contextWindow;
                      const contextWindowSource =
                        entry?.contextWindowSource ??
                        publishedModel?.contextWindowSource;
                      const isDefault =
                        profile.id === catalog.defaultChatProfileId ||
                        profile.id === catalog.defaultEmbeddingProfileId;
                      const canBecomeDefault =
                        profileCanBecomeDefault(
                          profile,
                          selectedConnection,
                        );
                      return (
                        <article className="model-profile-card" key={profile.id}>
                          <div>
                            <span>
                              {profile.purpose === "chat"
                                ? "对话模型"
                                : "Embedding"}
                            </span>
                            <strong>{profile.name}</strong>
                            <p>{profile.modelId}</p>
                            <p
                              title={
                                contextWindowSource?.checkedAt
                                  ? `${contextWindowSource.label} · ${contextWindowSource.checkedAt}`
                                  : undefined
                              }
                            >
                              模型窗口：
                              {contextWindow
                                ? `${formatTokenCapacity(contextWindow)} · ${
                                    contextWindowSource?.label ??
                                    "公开模型目录"
                                  }`
                                : "公开元数据未提供"}
                            </p>
                          </div>
                          <div className="model-profile-badges">
                            <span
                              className={
                                entry?.verified ? "is-verified" : "is-custom"
                              }
                            >
                              {entry?.verified ? "已收录" : "自定义"}
                            </span>
                            <span
                              className={
                                profile.verification?.status === "passed"
                                  ? "is-verified"
                                  : profile.verification?.status === "failed"
                                    ? "is-failed"
                                    : "is-custom"
                              }
                            >
                              {profile.verification?.status === "passed"
                                ? "模型已验证"
                                : profile.verification?.status === "failed"
                                  ? "模型测试失败"
                                  : "模型未验证"}
                            </span>
                            {isDefault ? <span>默认</span> : null}
                          </div>
                          <div className="model-profile-actions">
                            {!isDefault ? (
                              <button
                                disabled={!canBecomeDefault}
                                onClick={() => void setDefaultProfile(profile)}
                                title={
                                  canBecomeDefault
                                    ? "设为默认模型"
                                    : "先测试并通过这个模型，再设为默认"
                                }
                                type="button"
                              >
                                设为默认
                              </button>
                            ) : null}
                            <button
                              onClick={() => void testProfile(profile)}
                              type="button"
                            >
                              测试
                            </button>
                            <button
                              onClick={() => editProfile(profile)}
                              type="button"
                            >
                              编辑
                            </button>
                            <button
                              onClick={() => void removeProfile(profile)}
                              type="button"
                            >
                              删除
                            </button>
                          </div>
                        </article>
                      );
                    })}
                    {!selectedProfiles.length ? (
                      <p className="model-empty-state">
                        该连接还没有模型。保存新连接时会自动添加推荐模型。
                      </p>
                    ) : null}
                  </div>

                  {profileDraft?.connectionId === selectedConnection.id ? (
                    <ModelProfileForm
                      allowCapabilityOverrides={
                        selectedConnection.providerKind === "custom"
                      }
                      allowEmbedding={providerSupportsEmbeddings(
                        catalog.descriptors.find(
                          (candidate) =>
                            candidate.kind === selectedConnection.providerKind,
                        ),
                        selectedConnection,
                      )}
                      draft={profileDraft}
                      entries={selectedEntries}
                      onCancel={() => setProfileDraft(null)}
                      onChange={setProfileDraft}
                      onSubmit={saveProfile}
                    />
                  ) : null}

                  {selectedEntries.length ? (
                    <details className="model-matrix-disclosure">
                      <summary>
                        可添加的推荐模型（{selectedEntries.length}）
                      </summary>
                      <div className="model-matrix-list">
                        {selectedEntries.map((entry) => (
                          <div key={entry.routedModelId}>
                            <span>
                              <strong>{entry.label}</strong>
                              <small>{entry.modelId}</small>
                            </span>
                            <span>
                              {entry.capabilities.tools ? "工具" : "无工具"} ·{" "}
                              {entry.contextWindow
                                ? `${formatTokenCapacity(
                                    entry.contextWindow,
                                  )} · ${
                                    entry.contextWindowSource?.label ??
                                    "公开模型目录"
                                  }`
                                : "上下文未知"}
                            </span>
                            <button
                              onClick={() =>
                                void hideBuiltInModel(entry.routedModelId)
                              }
                              type="button"
                            >
                              隐藏
                            </button>
                          </div>
                        ))}
                      </div>
                    </details>
                  ) : null}
                </section>
              ) : null}
            </>
          ) : null}
        </main>
      </div>

      <p
        className={`settings-message is-${status.kind}`}
        role={status.kind === "error" ? "alert" : "status"}
      >
        {status.message}
      </p>
    </div>
  );
}

function ConnectionStatusBadge(props: {
  connection: PublicProviderConnection;
}) {
  const state = connectionState(props.connection);
  return (
    <span className={`connection-status-badge is-${state}`}>
      {connectionStateLabel(props.connection)}
    </span>
  );
}

function ModelProfileForm(props: {
  allowCapabilityOverrides: boolean;
  allowEmbedding: boolean;
  draft: ProfileDraft;
  entries: PublicModelCatalog["entries"];
  onChange: (draft: ProfileDraft) => void;
  onCancel: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="model-profile-form" onSubmit={props.onSubmit}>
      <div className="field-grid">
        <label className="field">
          <span>用途</span>
          <select
            onChange={(event) =>
              props.onChange({
                ...props.draft,
                purpose: event.currentTarget.value as "chat" | "embedding",
              })
            }
            value={props.draft.purpose}
          >
            <option value="chat">对话</option>
            {props.allowEmbedding ? (
              <option value="embedding">Embedding</option>
            ) : null}
          </select>
        </label>
        <label className="field">
          <span>显示名称</span>
          <input
            onChange={(event) =>
              props.onChange({
                ...props.draft,
                name: event.currentTarget.value,
              })
            }
            value={props.draft.name}
          />
        </label>
        <label className="field">
          <span>模型 ID</span>
          <input
            list="connection-model-suggestions"
            onChange={(event) =>
              props.onChange({
                ...props.draft,
                modelId: event.currentTarget.value,
              })
            }
            placeholder="服务端接受的 model 值"
            value={props.draft.modelId}
          />
          <datalist id="connection-model-suggestions">
            {props.entries.map((entry) => (
              <option key={entry.routedModelId} value={entry.modelId}>
                {entry.label}
              </option>
            ))}
          </datalist>
        </label>
      </div>
      {props.draft.purpose === "chat" ? (
        <div className="field-grid model-generation-grid">
          <label className="field">
            <span>温度</span>
            <input
              max="2"
              min="0"
              onChange={(event) =>
                props.onChange({
                  ...props.draft,
                  generation: {
                    ...props.draft.generation,
                    temperature: Number(event.currentTarget.value),
                  },
                })
              }
              step="0.01"
              type="number"
              value={props.draft.generation?.temperature ?? 0.2}
            />
          </label>
          <label className="field">
            <span>最大输出 Token</span>
            <input
              min="1"
              onChange={(event) =>
                props.onChange({
                  ...props.draft,
                  generation: {
                    ...props.draft.generation,
                    maxTokens: Number(event.currentTarget.value),
                  },
                })
              }
              type="number"
              value={props.draft.generation?.maxTokens ?? 8192}
            />
          </label>
        </div>
      ) : null}
      {props.allowCapabilityOverrides && props.draft.purpose === "chat" ? (
        <div className="field-grid model-capability-grid">
          <label className="field field-checkbox">
            <input
              checked={props.draft.capabilityOverrides?.tools ?? true}
              onChange={(event) =>
                props.onChange({
                  ...props.draft,
                  capabilityOverrides: {
                    ...props.draft.capabilityOverrides,
                    tools: event.currentTarget.checked,
                  },
                })
              }
              type="checkbox"
            />
            <span>支持工具调用</span>
          </label>
          <label className="field field-checkbox">
            <input
              checked={props.draft.capabilityOverrides?.streaming ?? true}
              onChange={(event) =>
                props.onChange({
                  ...props.draft,
                  capabilityOverrides: {
                    ...props.draft.capabilityOverrides,
                    streaming: event.currentTarget.checked,
                  },
                })
              }
              type="checkbox"
            />
            <span>支持流式输出</span>
          </label>
        </div>
      ) : null}
      <p className="field-hint">
        {props.allowCapabilityOverrides
          ? "兼容协议默认启用工具调用与流式输出；请按网关实际能力调整，并在设为默认前测试。"
          : "未收录的模型使用保守能力值；保存后先测试，再设为默认。"}
      </p>
      <div className="settings-actions">
        <button className="primary-action">保存模型</button>
        <button
          className="secondary-action"
          onClick={props.onCancel}
          type="button"
        >
          取消
        </button>
      </div>
    </form>
  );
}

function ProviderFieldControl(props: {
  field: ProviderField;
  value: string;
  error?: string;
  connectionHasCredential: boolean;
  credentialReusable: boolean;
  onChange: (value: string) => void;
}) {
  const placeholder =
    props.field.secret && props.connectionHasCredential
      ? props.credentialReusable
        ? "留空沿用安全存储中的凭证"
        : "连接目标或凭证来源已变更，请输入新凭证"
      : props.field.placeholder;
  const errorId = props.error
    ? `provider-field-${props.field.key}-error`
    : undefined;
  return (
    <label className="field">
      <span>
        {props.field.label}
        {props.field.required ? <em>必填</em> : null}
      </span>
      {props.field.choices ? (
        <select
          aria-describedby={errorId}
          aria-invalid={Boolean(props.error)}
          onChange={(event) => props.onChange(event.currentTarget.value)}
          value={props.value || props.field.defaultValue || ""}
        >
          {props.field.choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
              {choice.tag ? ` · ${choice.tag}` : ""}
            </option>
          ))}
        </select>
      ) : props.field.key === "serviceAccountJson" ? (
        <textarea
          aria-describedby={errorId}
          aria-invalid={Boolean(props.error)}
          onChange={(event) => props.onChange(event.currentTarget.value)}
          placeholder={placeholder}
          rows={4}
          value={props.value}
        />
      ) : (
        <input
          aria-describedby={errorId}
          aria-invalid={Boolean(props.error)}
          onChange={(event) => props.onChange(event.currentTarget.value)}
          placeholder={placeholder}
          type={props.field.secret ? "password" : "text"}
          value={props.value}
        />
      )}
      {props.field.help ? (
        <strong className="field-hint">{props.field.help}</strong>
      ) : null}
      {props.field.secret &&
      props.connectionHasCredential &&
      !props.credentialReusable ? (
        <strong className="field-hint">
          为避免把旧密钥发送到新端点，必须重新输入凭证。
        </strong>
      ) : null}
      {props.error ? (
        <small className="field-error" id={errorId} role="alert">
          {props.error}
        </small>
      ) : null}
    </label>
  );
}

function isProviderFieldVisible(
  field: ProviderField,
  values: Record<string, string>,
): boolean {
  return (
    !field.showWhen ||
    Object.entries(field.showWhen).every(
      ([key, expected]) => (values[key] || "") === expected,
    )
  );
}

function newConnectionDraft(
  descriptor: ProviderDescriptor,
): ConnectionDraft {
  return {
    name: descriptor.title,
    providerKind: descriptor.kind,
    credentialSource:
      descriptor.kind === "bedrock" || descriptor.kind === "vertex"
        ? "ambient"
        : descriptor.needsCredential
          ? "stored"
          : "none",
    values: Object.fromEntries(
      descriptor.fields.map((field) => [
        field.key,
        field.defaultValue ?? field.choices?.[0]?.value ?? "",
      ]),
    ),
  };
}

function connectionToDraft(
  connection: PublicProviderConnection,
): ConnectionDraft {
  return {
    id: connection.id,
    name: connection.name,
    providerKind: connection.providerKind,
    values: { ...connection.values },
    credentialSource: connection.credentialSource,
    expectedRevision: connection.revision,
  };
}

function connectionState(
  connection: PublicProviderConnection,
): "verified" | "failed" | "unknown" {
  return modelConnectionState(connection);
}

function connectionStateLabel(connection: PublicProviderConnection): string {
  const state = connectionState(connection);
  if (state === "verified") return "已验证";
  if (!connection.hasCredential) return "缺少凭证";
  if (state === "failed") return "测试失败";
  return "未验证";
}

function connectionCanBecomeDefault(
  connection: PublicProviderConnection,
): boolean {
  return (
    connection.hasCredential &&
    connection.availability === "available" &&
    connection.verification?.status === "passed" &&
    connection.verification.connectionRevision === connection.revision
  );
}

function profileCanBecomeDefault(
  profile: ModelProfile,
  connection: PublicProviderConnection,
): boolean {
  return (
    connectionCanBecomeDefault(connection) &&
    profile.verification?.status === "passed" &&
    profile.verification.profileRevision === profile.revision &&
    profile.verification.connectionRevision === connection.revision
  );
}

function providerSupportsEmbeddings(
  descriptor: ProviderDescriptor | undefined,
  connection: PublicProviderConnection,
): boolean {
  return Boolean(
    descriptor?.capabilities.embeddings &&
      (connection.providerKind !== "custom" ||
        (connection.values.protocol || "openai") === "openai"),
  );
}

function formatCredentialSource(source: ProviderCredentialSource): string {
  const labels: Record<ProviderCredentialSource, string> = {
    stored: "安全存储",
    environment: "环境变量",
    ambient: "系统凭证",
    none: "无凭证",
  };
  return labels[source];
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatTokenCapacity(value: number): string {
  if (value >= 1_000_000) {
    return `${Number((value / 1_000_000).toFixed(2))}m`;
  }
  return `${Number((value / 1_000).toFixed(1))}k`;
}
