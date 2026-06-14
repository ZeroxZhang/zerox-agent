import { useEffect, useMemo, useState } from "react";
import {
  getDefaultModelSettings,
  getGenerationSettingRecommendations,
  getModelSettingsFieldGuidance,
  type ModelSettingsInput,
  type ModelSettingsValidationErrors,
  type PublicModelSettings,
  type TestModelConnectionResult,
} from "../../shared/modelSettings";

type SaveStatus =
  | { kind: "idle"; message: string }
  | { kind: "saving"; message: string }
  | { kind: "saved"; message: string }
  | { kind: "error"; message: string };

const defaultSettings = getDefaultModelSettings();
const recommendations = getGenerationSettingRecommendations();
const fieldGuidance = getModelSettingsFieldGuidance();

export function ModelSettingsPanel() {
  const [settings, setSettings] =
    useState<PublicModelSettings>(defaultSettings);
  const [form, setForm] = useState<ModelSettingsInput>(() =>
    toModelSettingsInput(defaultSettings),
  );
  const [errors, setErrors] = useState<ModelSettingsValidationErrors>({});
  const [status, setStatus] = useState<SaveStatus>({
    kind: "idle",
    message: "还没有保存模型配置。",
  });
  const [connectionResult, setConnectionResult] =
    useState<TestModelConnectionResult | null>(null);

  useEffect(() => {
    window.buildingAgent
      ?.loadModelSettings()
      .then((loadedSettings) => {
        setSettings(loadedSettings);
        setForm(toModelSettingsInput(loadedSettings));
        setStatus({
          kind: "idle",
          message: loadedSettings.hasApiKey
            ? "模型配置已加载，API Key 已安全存储。"
            : "还没有保存模型配置。",
        });
      })
      .catch((error) => {
        setStatus({
          kind: "error",
          message:
            error instanceof Error
              ? error.message
              : "无法加载模型配置。",
        });
      });
  }, []);

  const apiKeyPlaceholder = useMemo(() => {
    return settings.hasApiKey
      ? "留空即可沿用已保存密钥"
      : "粘贴你的 API Key";
  }, [settings.hasApiKey]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus({ kind: "saving", message: "正在保存模型配置..." });
    setErrors({});

    if (!window.buildingAgent) {
      setStatus({
        kind: "error",
        message: "浏览器预览模式无法保存桌面配置。",
      });
      return;
    }

    const result = await window.buildingAgent.saveModelSettings(form);

    if (!result.ok) {
      setErrors(result.errors);
      setStatus({ kind: "error", message: result.message });
      return;
    }

    setSettings(result.settings);
    setForm(toModelSettingsInput(result.settings));
    setConnectionResult(null);
    setStatus({
      kind: "saved",
      message: "模型配置已保存，API Key 不会回传到界面。",
    });
  }

  async function handleTestConnection() {
    setStatus({ kind: "saving", message: "正在测试模型连接..." });
    setConnectionResult(null);

    if (!window.buildingAgent) {
      const previewResult: TestModelConnectionResult = settings.hasApiKey
        ? {
            ok: true,
            message: "浏览器预览模式：桌面端会使用已保存密钥发起真实测试。",
            model: form.chatModel || "未填写模型",
            latencyMs: 0,
            checkedAt: new Date().toISOString(),
            replyPreview: "OK",
          }
        : {
            ok: false,
            message: "浏览器预览模式无法读取桌面密钥，请在桌面端测试。",
          };
      setConnectionResult(previewResult);
      setStatus({
        kind: previewResult.ok ? "saved" : "error",
        message: previewResult.message,
      });
      return;
    }

    const result = await window.buildingAgent.testModelConnection();
    setConnectionResult(result);
    setStatus({
      kind: result.ok ? "saved" : "error",
      message: result.message,
    });
  }

  return (
    <form className="settings-panel" onSubmit={handleSubmit}>
      <div className="settings-header">
        <div>
          <p className="kicker">兼容 OpenAI 接口</p>
          <h3>模型配置</h3>
        </div>
        <span className={`settings-state is-${status.kind}`}>
          {settings.hasApiKey ? "密钥已保存" : "未保存密钥"}
        </span>
      </div>

      <label className="field">
        <span>
          {fieldGuidance.baseUrl.label} <em>必填</em>
        </span>
        <input
          value={form.baseUrl}
          onChange={(event) =>
            setForm({ ...form, baseUrl: event.currentTarget.value })
          }
          placeholder="https://api.openai.com/v1"
        />
        <strong className="field-hint">{fieldGuidance.baseUrl.hint}</strong>
        {errors.baseUrl ? <small>{errors.baseUrl}</small> : null}
      </label>

      <div className="field-grid">
        <label className="field">
          <span>
            {fieldGuidance.chatModel.label} <em>必填</em>
          </span>
          <input
            value={form.chatModel}
            onChange={(event) =>
              setForm({ ...form, chatModel: event.currentTarget.value })
            }
            placeholder="gpt-4.1-mini, deepseek-chat, qwen-plus"
            />
          <strong className="field-hint">{fieldGuidance.chatModel.hint}</strong>
          {errors.chatModel ? <small>{errors.chatModel}</small> : null}
        </label>

        <label className="field">
          <span>
            {fieldGuidance.embeddingModel.label} <em>选填</em>
          </span>
          <input
            value={form.embeddingModel}
            onChange={(event) =>
              setForm({ ...form, embeddingModel: event.currentTarget.value })
            }
            placeholder="text-embedding-3-small"
          />
          <strong className="field-hint">{fieldGuidance.embeddingModel.hint}</strong>
          {errors.embeddingModel ? (
            <small>{errors.embeddingModel}</small>
          ) : null}
        </label>
      </div>

      <label className="field">
        <span>
          {fieldGuidance.apiKey.label} <em>首次保存必填</em>
        </span>
        <input
          value={form.apiKey}
          onChange={(event) =>
            setForm({ ...form, apiKey: event.currentTarget.value })
          }
          placeholder={apiKeyPlaceholder}
          type="password"
        />
        <strong className="field-hint">{fieldGuidance.apiKey.hint}</strong>
        {errors.apiKey ? <small>{errors.apiKey}</small> : null}
      </label>

      <section className="recommendations" aria-label="推荐生成参数">
        <div className="recommendations-copy">
          <span>推荐值</span>
          <p>
            第一版建议先用“智能体 / 编程”。只有想要更多变化时再提高温度；只有单次回复被截断时再提高最大输出。
          </p>
        </div>
        <div className="recommendation-list">
          {recommendations.map((recommendation) => (
            <button
              key={recommendation.id}
              className="recommendation"
              onClick={() =>
                setForm({
                  ...form,
                  temperature: recommendation.temperature,
                  maxTokens: recommendation.maxTokens,
                })
              }
              type="button"
            >
              <strong>{recommendation.label}</strong>
              <span>
                温度 {recommendation.temperature} / 输出 {recommendation.maxTokens}
              </span>
              <small>{recommendation.description}</small>
            </button>
          ))}
        </div>
      </section>

      <div className="field-grid">
        <label className="field">
          <span>
            {fieldGuidance.temperature.label} <em>选填</em>
          </span>
          <input
            max="2"
            min="0"
            onChange={(event) =>
              setForm({
                ...form,
                temperature: Number(event.currentTarget.value),
              })
            }
            step="0.01"
            type="number"
            value={form.temperature}
          />
          <strong className="field-hint">{fieldGuidance.temperature.hint}</strong>
          {errors.temperature ? <small>{errors.temperature}</small> : null}
        </label>

        <label className="field">
          <span>
            {fieldGuidance.maxTokens.label} <em>选填</em>
          </span>
          <input
            min="1"
            onChange={(event) =>
              setForm({
                ...form,
                maxTokens: Number(event.currentTarget.value),
              })
            }
            step="1"
            type="number"
            value={form.maxTokens}
          />
          <strong className="field-hint">{fieldGuidance.maxTokens.hint}</strong>
          {errors.maxTokens ? <small>{errors.maxTokens}</small> : null}
        </label>
      </div>

      <div className="field-grid">
        <label className="field is-checkbox">
          <span>{fieldGuidance.thinkingEnabled.label}</span>
          <input
            checked={form.thinkingEnabled ?? false}
            onChange={(event) =>
              setForm({
                ...form,
                thinkingEnabled: event.currentTarget.checked,
              })
            }
            type="checkbox"
          />
          <strong className="field-hint">
            {fieldGuidance.thinkingEnabled.hint}
          </strong>
        </label>

        {form.thinkingEnabled ? (
          <label className="field">
            <span>{fieldGuidance.thinkingBudgetTokens.label}</span>
            <input
              min="256"
              max="32000"
              onChange={(event) =>
                setForm({
                  ...form,
                  thinkingBudgetTokens: Number(event.currentTarget.value),
                })
              }
              step="1"
              type="number"
              value={form.thinkingBudgetTokens ?? 8192}
            />
            <strong className="field-hint">
              {fieldGuidance.thinkingBudgetTokens.hint}
            </strong>
            {errors.thinkingBudgetTokens ? (
              <small>{errors.thinkingBudgetTokens}</small>
            ) : null}
          </label>
        ) : null}
      </div>

      <div className="settings-actions">
        <button className="primary-action" disabled={status.kind === "saving"}>
          保存配置
        </button>
        <button
          className="secondary-action"
          disabled={status.kind === "saving" || !settings.hasApiKey}
          onClick={() => void handleTestConnection()}
          type="button"
        >
          测试连接
        </button>
        <p className={`settings-message is-${status.kind}`}>{status.message}</p>
      </div>
      {connectionResult ? (
        <section
          className={`connection-result ${
            connectionResult.ok ? "is-success" : "is-error"
          }`}
          aria-label="模型连接测试结果"
        >
          <strong>{connectionResult.message}</strong>
          {connectionResult.ok ? (
            <dl>
              <div>
                <dt>模型</dt>
                <dd>{connectionResult.model}</dd>
              </div>
              <div>
                <dt>耗时</dt>
                <dd>{connectionResult.latencyMs} ms</dd>
              </div>
              <div>
                <dt>回复</dt>
                <dd>{connectionResult.replyPreview}</dd>
              </div>
            </dl>
          ) : null}
        </section>
      ) : null}
    </form>
  );
}

function toModelSettingsInput(
  settings: PublicModelSettings,
): ModelSettingsInput {
  return {
    baseUrl: settings.baseUrl,
    chatModel: settings.chatModel,
    embeddingModel: settings.embeddingModel,
    apiKey: "",
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    thinkingEnabled: settings.thinkingEnabled,
    thinkingBudgetTokens: settings.thinkingBudgetTokens,
  };
}
