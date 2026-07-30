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
            : "先添加一个服务商连接，再创建模型档案。",
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
  const configuredKinds = useMemo(
    () =>
      new Set(
        catalog.connections
          .filter(
            (connection) =>
              connection.providerKind === "ollama"
                ? connection.availability === "available"
                : connection.hasCredential,
          )
          .map((connection) => connection.providerKind),
      ),
    [catalog.connections],
  );
  const visibleEntries = useMemo(
    () =>
      catalog.entries.filter(
        (entry) =>
          configuredKinds.has(entry.providerKind) &&
          !catalog.hiddenRoutedModelIds.includes(entry.routedModelId),
      ),
    [catalog.entries, catalog.hiddenRoutedModelIds, configuredKinds],
  );
  const profileConnection = useMemo(
    () =>
      catalog.connections.find(
        (connection) => connection.id === profileDraft?.connectionId,
      ) ?? null,
    [catalog.connections, profileDraft?.connectionId],
  );
  const suggestedModels = useMemo(
    () =>
      profileConnection
        ? visibleEntries.filter(
            (entry) => entry.providerKind === profileConnection.providerKind,
          )
        : [],
    [profileConnection, visibleEntries],
  );

  function selectConnection(connection: PublicProviderConnection) {
    setSelectedConnectionId(connection.id);
    setConnectionDraft(connectionToDraft(connection));
    setConnectionErrors({});
    setTestResult(null);
  }

  function startNewConnection(kind?: ProviderKind) {
    const nextDescriptor =
      catalog.descriptors.find((candidate) => candidate.kind === kind) ??
      catalog.descriptors[0];
    if (!nextDescriptor) {
      return;
    }
    setSelectedConnectionId(null);
    setConnectionDraft(newConnectionDraft(nextDescriptor));
    setConnectionErrors({});
    setTestResult(null);
  }

  function changeProvider(kind: ProviderKind) {
    const nextDescriptor = catalog.descriptors.find(
      (candidate) => candidate.kind === kind,
    );
    if (nextDescriptor) {
      setSelectedConnectionId(null);
      setConnectionDraft(newConnectionDraft(nextDescriptor));
      setConnectionErrors({});
      setTestResult(null);
    }
  }

  async function saveConnection(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!connectionDraft || !window.buildingAgent) {
      return;
    }
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
    setCatalog(result.catalog);
    setSelectedConnectionId(result.connection.id);
    setConnectionDraft(connectionToDraft(result.connection));
    setTestResult(null);
    setStatus({
      kind: "saved",
      message: "连接已保存；密钥不会回传到界面或运行轨迹。",
    });
  }

  async function testConnection() {
    if (!connectionDraft || !window.buildingAgent) {
      return;
    }
    setStatus({ kind: "working", message: "正在用当前表单临时值测试连接…" });
    setTestResult(null);
    const result = await window.buildingAgent.testProviderConnection({
      connection: connectionDraft,
      ...(descriptor?.recommendedModel
        ? { modelId: descriptor.recommendedModel }
        : {}),
    });
    setTestResult(result);
    setStatus({
      kind: result.ok ? "saved" : "error",
      message: result.message,
    });
  }

  async function removeConnection(connection: PublicProviderConnection) {
    if (!window.buildingAgent) {
      return;
    }
    const result = await window.buildingAgent.deleteProviderConnection(
      connection.id,
    );
    if (!result.ok) {
      setStatus({ kind: "error", message: result.message });
      return;
    }
    setCatalog(result.catalog);
    setSelectedConnectionId(null);
    const first = result.catalog.connections[0];
    setConnectionDraft(
      first
        ? connectionToDraft(first)
        : result.catalog.descriptors[0]
          ? newConnectionDraft(result.catalog.descriptors[0])
          : null,
    );
    setStatus({ kind: "saved", message: "服务商连接已删除。" });
  }

  function startNewProfile(connectionId?: string) {
    const connection =
      catalog.connections.find((candidate) => candidate.id === connectionId) ??
      selectedConnection ??
      catalog.connections[0];
    if (!connection) {
      setStatus({ kind: "error", message: "请先保存一个服务商连接。" });
      return;
    }
    const recommended =
      catalog.descriptors.find(
        (candidate) => candidate.kind === connection.providerKind,
      )?.recommendedModel ?? "";
    setProfileDraft({
      name: recommended,
      connectionId: connection.id,
      modelId: recommended,
      purpose: "chat",
      generation: defaultModelGenerationSettings(),
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
    if (!profileDraft || !window.buildingAgent) {
      return;
    }
    setStatus({ kind: "working", message: "正在保存模型档案…" });
    const result = await window.buildingAgent.saveModelProfile(profileDraft);
    if (!result.ok) {
      setStatus({ kind: "error", message: result.message });
      return;
    }
    setCatalog(result.catalog);
    setProfileDraft(null);
    setStatus({
      kind: "saved",
      message: result.profile.custom
        ? "自定义模型档案已保存，并按保守能力值运行。"
        : "模型档案已保存。",
    });
  }

  async function removeProfile(profile: ModelProfile) {
    if (!window.buildingAgent) {
      return;
    }
    const result = await window.buildingAgent.deleteModelProfile(profile.id);
    if (!result.ok) {
      setStatus({ kind: "error", message: result.message });
      return;
    }
    setCatalog(result.catalog);
    setProfileDraft((current) => (current?.id === profile.id ? null : current));
    setStatus({ kind: "saved", message: "模型档案已删除。" });
  }

  async function setDefaultProfile(
    purpose: "chat" | "embedding",
    profileId: string | null,
  ) {
    if (!window.buildingAgent) {
      return;
    }
    const result = await window.buildingAgent.setDefaultModelProfile(
      purpose,
      profileId,
    );
    if (!result.ok) {
      setStatus({ kind: "error", message: result.message });
      return;
    }
    setCatalog(result.catalog);
    setStatus({ kind: "saved", message: "默认模型已更新。" });
  }

  async function hideBuiltInModel(routedModelId: string) {
    if (!window.buildingAgent) {
      return;
    }
    const result = await window.buildingAgent.setModelHidden(
      routedModelId,
      true,
    );
    if (result.ok) {
      setCatalog(result.catalog);
      setStatus({ kind: "saved", message: "内置模型已隐藏。" });
    } else {
      setStatus({ kind: "error", message: result.message });
    }
  }

  return (
    <div className="settings-panel model-catalog-panel">
      <header className="settings-header">
        <div>
          <p className="kicker">Provider · Connection · Model Profile</p>
          <h3>多服务商与模型配置</h3>
          <p>
            声明式表单统一管理原生 API、云平台、本地模型与兼容 OpenAI
            接口；每个模型档案绑定一个稳定连接。
          </p>
        </div>
        <span className={`settings-state is-${status.kind}`}>
          {catalog.connections.length} 个连接
        </span>
      </header>

      <section className="model-settings-section" aria-labelledby="provider-heading">
        <div className="model-settings-section-heading">
          <div>
            <span>01</span>
            <h4 id="provider-heading">服务商连接</h4>
          </div>
          <button
            className="secondary-action"
            onClick={() => startNewConnection()}
            type="button"
          >
            添加连接
          </button>
        </div>
        <div className="provider-settings-layout">
          <nav className="provider-connection-list" aria-label="服务商连接列表">
            {catalog.connections.length ? (
              catalog.connections.map((connection) => {
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
                    <strong>{connection.name}</strong>
                    <span>{connectionDescriptor?.title ?? connection.providerKind}</span>
                    <small>
                      {connection.providerKind === "ollama"
                        ? connection.availability === "available"
                          ? "本地服务可用"
                          : connection.availability === "unavailable"
                            ? "本地服务不可达"
                            : "等待探测"
                        : connection.hasCredential
                          ? "凭证可用"
                          : "等待凭证"}{" "}
                      ·{" "}
                      {formatCredentialSource(connection.credentialSource)}
                    </small>
                  </button>
                );
              })
            ) : (
              <p>还没有连接。选择服务商并填写连接信息。</p>
            )}
          </nav>

          {connectionDraft && descriptor ? (
            <form
              className="provider-connection-form"
              onSubmit={(event) => void saveConnection(event)}
            >
              <div className="field-grid provider-identity-grid">
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
                      value={connectionDraft.credentialSource ?? "stored"}
                    >
                      <option value="stored">安全存储</option>
                      <option value="environment">
                        环境变量 {descriptor.environmentKey}
                      </option>
                    </select>
                  </label>
                ) : null}
              </div>
              <p className="provider-description">{descriptor.description}</p>
              <div className="provider-field-grid">
                {descriptor.fields
                  .filter((field) =>
                    isProviderFieldVisible(field, connectionDraft.values),
                  )
                  .map((field) => (
                    <ProviderFieldControl
                      connectionHasCredential={selectedConnection?.hasCredential ?? false}
                      error={connectionErrors[field.key]}
                      field={field}
                      key={field.key}
                      value={connectionDraft.values[field.key] ?? ""}
                      onChange={(value) =>
                        setConnectionDraft({
                          ...connectionDraft,
                          values: {
                            ...connectionDraft.values,
                            [field.key]: value,
                          },
                        })
                      }
                    />
                  ))}
              </div>
              <div className="settings-actions">
                <button
                  className="primary-action"
                  disabled={status.kind === "working"}
                >
                  保存连接
                </button>
                <button
                  className="secondary-action"
                  disabled={status.kind === "working"}
                  onClick={() => void testConnection()}
                  type="button"
                >
                  测试临时配置
                </button>
                {selectedConnection ? (
                  <button
                    className="danger-action"
                    disabled={status.kind === "working"}
                    onClick={() => void removeConnection(selectedConnection)}
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
                  {testResult.ok ? ` · ${testResult.latencyMs} ms` : ""}
                </p>
              ) : null}
            </form>
          ) : null}
        </div>
      </section>

      <section className="model-settings-section" aria-labelledby="profiles-heading">
        <div className="model-settings-section-heading">
          <div>
            <span>02</span>
            <h4 id="profiles-heading">模型档案</h4>
          </div>
          <button
            className="secondary-action"
            disabled={!catalog.connections.length}
            onClick={() => startNewProfile()}
            type="button"
          >
            添加模型档案
          </button>
        </div>
        <div className="model-profile-list">
          {catalog.profiles.map((profile) => {
            const connection = catalog.connections.find(
              (candidate) => candidate.id === profile.connectionId,
            );
            const entry = catalog.entries.find(
              (candidate) =>
                candidate.providerKind === connection?.providerKind &&
                candidate.modelId === profile.modelId,
            );
            const isDefault =
              profile.id === catalog.defaultChatProfileId ||
              profile.id === catalog.defaultEmbeddingProfileId;
            return (
              <article className="model-profile-card" key={profile.id}>
                <div>
                  <span>{profile.purpose === "chat" ? "Chat" : "Embedding"}</span>
                  <strong>{profile.name}</strong>
                  <p>
                    {connection?.name ?? "连接缺失"} · {profile.modelId}
                  </p>
                </div>
                <div className="model-profile-badges">
                  <span className={entry?.verified ? "is-verified" : "is-custom"}>
                    {entry?.verified ? "已验证" : "未验证"}
                  </span>
                  {isDefault ? <span>默认</span> : null}
                  <span>r{profile.revision}</span>
                </div>
                <div className="model-profile-actions">
                  <button onClick={() => editProfile(profile)} type="button">
                    编辑
                  </button>
                  <button
                    disabled={isDefault}
                    onClick={() => void removeProfile(profile)}
                    type="button"
                  >
                    删除
                  </button>
                </div>
              </article>
            );
          })}
          {!catalog.profiles.length ? <p>还没有模型档案。</p> : null}
        </div>

        {profileDraft ? (
          <form
            className="model-profile-form"
            onSubmit={(event) => void saveProfile(event)}
          >
            <div className="field-grid">
              <label className="field">
                <span>连接</span>
                <select
                  onChange={(event) =>
                    setProfileDraft({
                      ...profileDraft,
                      connectionId: event.currentTarget.value,
                    })
                  }
                  value={profileDraft.connectionId}
                >
                  {catalog.connections.map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connection.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>用途</span>
                <select
                  onChange={(event) =>
                    setProfileDraft({
                      ...profileDraft,
                      purpose: event.currentTarget.value as "chat" | "embedding",
                    })
                  }
                  value={profileDraft.purpose}
                >
                  <option value="chat">Chat</option>
                  <option value="embedding">Embedding</option>
                </select>
              </label>
              <label className="field">
                <span>档案名称</span>
                <input
                  onChange={(event) =>
                    setProfileDraft({
                      ...profileDraft,
                      name: event.currentTarget.value,
                    })
                  }
                  value={profileDraft.name}
                />
              </label>
              <label className="field">
                <span>模型 ID</span>
                <input
                  list="configured-model-suggestions"
                  onChange={(event) =>
                    setProfileDraft({
                      ...profileDraft,
                      modelId: event.currentTarget.value,
                    })
                  }
                  placeholder="可填写任意自定义模型 ID"
                  value={profileDraft.modelId}
                />
                <datalist id="configured-model-suggestions">
                  {suggestedModels.map((entry) => (
                    <option key={entry.routedModelId} value={entry.modelId}>
                      {entry.label}
                    </option>
                  ))}
                </datalist>
              </label>
            </div>
            {profileDraft.purpose === "chat" ? (
              <div className="field-grid">
                <label className="field">
                  <span>温度</span>
                  <input
                    max="2"
                    min="0"
                    onChange={(event) =>
                      setProfileDraft({
                        ...profileDraft,
                        generation: {
                          ...profileDraft.generation,
                          temperature: Number(event.currentTarget.value),
                        },
                      })
                    }
                    step="0.01"
                    type="number"
                    value={profileDraft.generation?.temperature ?? 0.2}
                  />
                </label>
                <label className="field">
                  <span>最大输出 Token</span>
                  <input
                    min="1"
                    onChange={(event) =>
                      setProfileDraft({
                        ...profileDraft,
                        generation: {
                          ...profileDraft.generation,
                          maxTokens: Number(event.currentTarget.value),
                        },
                      })
                    }
                    type="number"
                    value={profileDraft.generation?.maxTokens ?? 8192}
                  />
                </label>
              </div>
            ) : null}
            <p className="field-hint">
              矩阵外的模型会标记为“未验证”，工具、视觉和并行调用能力默认关闭。
            </p>
            <div className="settings-actions">
              <button className="primary-action">保存档案</button>
              <button
                className="secondary-action"
                onClick={() => setProfileDraft(null)}
                type="button"
              >
                取消
              </button>
            </div>
          </form>
        ) : null}
      </section>

      <section className="model-settings-section" aria-labelledby="defaults-heading">
        <div className="model-settings-section-heading">
          <div>
            <span>03</span>
            <h4 id="defaults-heading">默认模型与可见性</h4>
          </div>
        </div>
        <div className="field-grid">
          <label className="field">
            <span>默认 Chat 模型</span>
            <select
              onChange={(event) =>
                void setDefaultProfile("chat", event.currentTarget.value || null)
              }
              value={catalog.defaultChatProfileId ?? ""}
            >
              <option value="">未设置</option>
              {catalog.profiles
                .filter((profile) => profile.purpose === "chat")
                .map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            <span>默认 Embedding 模型</span>
            <select
              onChange={(event) =>
                void setDefaultProfile(
                  "embedding",
                  event.currentTarget.value || null,
                )
              }
              value={catalog.defaultEmbeddingProfileId ?? ""}
            >
              <option value="">未设置</option>
              {catalog.profiles
                .filter((profile) => profile.purpose === "embedding")
                .map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
        {visibleEntries.length ? (
          <details className="model-matrix-disclosure">
            <summary>已配置服务商的模型矩阵（{visibleEntries.length}）</summary>
            <div className="model-matrix-list">
              {visibleEntries.map((entry) => (
                <div key={entry.routedModelId}>
                  <span>
                    <strong>{entry.label}</strong>
                    <small>
                      {entry.providerKind}:{entry.modelId}
                    </small>
                  </span>
                  <span>
                    {entry.capabilities.tools ? "工具" : "无工具"} ·{" "}
                    {entry.contextWindow
                      ? `${Math.round(entry.contextWindow / 1000)}k`
                      : "上下文未知"}
                  </span>
                  <button
                    onClick={() => void hideBuiltInModel(entry.routedModelId)}
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

      <p className={`settings-message is-${status.kind}`} role="status">
        {status.message}
      </p>
    </div>
  );
}

function ProviderFieldControl(props: {
  field: ProviderField;
  value: string;
  error?: string;
  connectionHasCredential: boolean;
  onChange: (value: string) => void;
}) {
  const placeholder =
    props.field.secret && props.connectionHasCredential
      ? "留空沿用已安全存储的值"
      : props.field.placeholder;
  return (
    <label className="field">
      <span>
        {props.field.label}
        {props.field.required ? <em>必填</em> : null}
      </span>
      {props.field.choices ? (
        <select
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
          onChange={(event) => props.onChange(event.currentTarget.value)}
          placeholder={placeholder}
          rows={4}
          value={props.value}
        />
      ) : (
        <input
          onChange={(event) => props.onChange(event.currentTarget.value)}
          placeholder={placeholder}
          type={props.field.secret ? "password" : "text"}
          value={props.value}
        />
      )}
      {props.field.help ? (
        <strong className="field-hint">{props.field.help}</strong>
      ) : null}
      {props.error ? <small>{props.error}</small> : null}
    </label>
  );
}

function isProviderFieldVisible(
  field: ProviderField,
  values: Record<string, string>,
): boolean {
  if (!field.showWhen) {
    return true;
  }
  return Object.entries(field.showWhen).every(
    ([key, expected]) => (values[key] || "") === expected,
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

function formatCredentialSource(source: ProviderCredentialSource): string {
  const labels: Record<ProviderCredentialSource, string> = {
    stored: "安全存储",
    environment: "环境变量",
    ambient: "系统凭证",
    none: "无凭证",
  };
  return labels[source];
}
