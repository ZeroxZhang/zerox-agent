import { useEffect, useMemo, useState } from "react";
import {
  getMemoryKindLabel,
  getMemoryKinds,
  type MemoryInput,
  type MemoryKind,
  type MemoryMaintenanceReport,
  type MemoryRecord,
  type MemorySearchResult,
  type MemoryValidationErrors,
} from "../../shared/memory";
import type { MemoryEvalReport } from "../../shared/memoryEval";
import type { MemoryGovernanceReport } from "../../shared/memoryGovernance";

type MemoryStatus =
  | { kind: "idle"; message: string }
  | { kind: "saving"; message: string }
  | { kind: "saved"; message: string }
  | { kind: "error"; message: string };

const defaultForm: MemoryInput = {
  kind: "semantic",
  title: "",
  content: "",
  tags: [],
  importance: 3,
};

export function MemoryPanel() {
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [searchResults, setSearchResults] = useState<MemorySearchResult[]>([]);
  const [kindFilter, setKindFilter] = useState<MemoryKind | "all">("all");
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<MemoryInput>(defaultForm);
  const [tagText, setTagText] = useState("");
  const [errors, setErrors] = useState<MemoryValidationErrors>({});
  const [exportedJson, setExportedJson] = useState("");
  const [profileContent, setProfileContent] = useState("");
  const [profileUpdatedAt, setProfileUpdatedAt] = useState("");
  const [evalReport, setEvalReport] = useState<MemoryEvalReport | null>(null);
  const [governanceReport, setGovernanceReport] =
    useState<MemoryGovernanceReport | null>(null);
  const [maintenanceReport, setMaintenanceReport] =
    useState<MemoryMaintenanceReport | null>(null);
  const [status, setStatus] = useState<MemoryStatus>({
    kind: "idle",
    message: "记忆系统已就绪。",
  });

  useEffect(() => {
    void loadMemories();
    void loadMemoryProfile();
  }, []);

  const displayedMemories = useMemo(() => {
    if (query.trim()) {
      return searchResults.map((result) => result.record);
    }

    return memories;
  }, [memories, query, searchResults]);

  async function loadMemories() {
    if (!window.buildingAgent) {
      setStatus({
        kind: "error",
        message: "需要桌面桥接能力才能管理记忆。",
      });
      return;
    }

    try {
      const loadedMemories = await window.buildingAgent.listMemories({
        kind: kindFilter,
        limit: 100,
      });
      setMemories(loadedMemories);
      setStatus({
        kind: "idle",
        message: loadedMemories.length ? "记忆已加载。" : "还没有记忆。",
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error ? error.message : "无法加载记忆。",
      });
    }
  }

  async function loadMemoryProfile() {
    if (!window.buildingAgent) {
      return;
    }

    const result = await window.buildingAgent.readMemoryProfile();
    if (result.ok) {
      setProfileContent(result.profile.content);
      setProfileUpdatedAt(result.profile.updatedAt);
    }
  }

  async function handleSearch(nextQuery = query, nextKind = kindFilter) {
    setQuery(nextQuery);
    setKindFilter(nextKind);

    if (!window.buildingAgent) {
      setStatus({
        kind: "error",
        message: "浏览器预览模式无法管理桌面记忆。",
      });
      return;
    }

    if (!nextQuery.trim()) {
      const loadedMemories = await window.buildingAgent.listMemories({
        kind: nextKind,
        limit: 100,
      });
      setMemories(loadedMemories);
      setSearchResults([]);
      setStatus({
        kind: "idle",
        message: loadedMemories.length ? "记忆已加载。" : "还没有记忆。",
      });
      return;
    }

    const results = await window.buildingAgent.searchMemories({
      query: nextQuery,
      kind: nextKind,
      limit: 50,
    });
    setSearchResults(results);
    setStatus({
      kind: "idle",
      message: `${results.length} 条结果。`,
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus({ kind: "saving", message: "正在保存记忆..." });
    setErrors({});

    if (!window.buildingAgent) {
      setStatus({
        kind: "error",
        message: "浏览器预览模式无法保存桌面记忆。",
      });
      return;
    }

    const result = await window.buildingAgent.createMemory({
      ...form,
      tags: parseTags(tagText),
      importance: Number(form.importance),
      source: { type: "manual" },
    });

    if (!result.ok) {
      setErrors(result.errors);
      setStatus({ kind: "error", message: result.message });
      return;
    }

    setForm(defaultForm);
    setTagText("");
    setExportedJson("");
    setStatus({ kind: "saved", message: "记忆已保存。" });
    await handleSearch(query, kindFilter);
  }

  async function handleDelete(memoryId: string) {
    if (!window.buildingAgent) {
      setStatus({
        kind: "error",
        message: "浏览器预览模式无法删除桌面记忆。",
      });
      return;
    }

    const result = await window.buildingAgent.deleteMemory(memoryId);

    if (!result.ok) {
      setStatus({ kind: "error", message: result.message });
      return;
    }

    setExportedJson("");
    setStatus({
      kind: result.deleted ? "saved" : "error",
      message: result.deleted ? "记忆已删除。" : "没有找到这条记忆。",
    });
    await handleSearch(query, kindFilter);
  }

  async function handleExport() {
    if (!window.buildingAgent) {
      setStatus({
        kind: "error",
        message: "浏览器预览模式无法导出桌面记忆。",
      });
      return;
    }

    const exported = await window.buildingAgent.exportMemories();
    setExportedJson(exported);
    setStatus({ kind: "saved", message: "记忆已导出。" });
  }

  async function handleRunMaintenance() {
    setStatus({ kind: "saving", message: "正在整理记忆..." });

    if (!window.buildingAgent) {
      setStatus({
        kind: "error",
        message: "浏览器预览模式无法整理桌面记忆。",
      });
      return;
    }

    const result = await window.buildingAgent.runMemoryMaintenance();

    if (!result.ok) {
      setStatus({ kind: "error", message: result.message });
      return;
    }

    setMaintenanceReport(result.report);
    setExportedJson("");
    setStatus({
      kind: "saved",
      message: result.report.consolidated
        ? "记忆已整理。"
        : "没有发现需要整理的候选记忆。",
    });
    await handleSearch(query, kindFilter);
  }

  async function handleRunMemoryEval() {
    setStatus({ kind: "saving", message: "正在评估记忆检索..." });

    if (!window.buildingAgent) {
      setStatus({
        kind: "error",
        message: "浏览器预览模式无法评估桌面记忆。",
      });
      return;
    }

    const result = await window.buildingAgent.runMemoryEval();
    if (!result.ok) {
      setStatus({ kind: "error", message: result.message });
      return;
    }

    setEvalReport(result.report);
    setStatus({
      kind: result.report.failed ? "error" : "saved",
      message: `记忆评估完成：${result.report.passed}/${result.report.total} 通过。`,
    });
  }

  async function handleReviewGovernance() {
    setStatus({ kind: "saving", message: "正在生成记忆治理报告..." });

    if (!window.buildingAgent) {
      setStatus({
        kind: "error",
        message: "浏览器预览模式无法生成治理报告。",
      });
      return;
    }

    const result = await window.buildingAgent.reviewMemoryGovernance();
    if (!result.ok) {
      setStatus({ kind: "error", message: result.message });
      return;
    }

    setGovernanceReport(result.report);
    setStatus({
      kind: "saved",
      message: "记忆治理报告已生成。",
    });
  }

  async function handleSaveProfile() {
    setStatus({ kind: "saving", message: "正在保存记忆画像..." });

    if (!window.buildingAgent) {
      setStatus({
        kind: "error",
        message: "浏览器预览模式无法保存记忆画像。",
      });
      return;
    }

    const result = await window.buildingAgent.saveMemoryProfile(profileContent);
    if (!result.ok) {
      setStatus({ kind: "error", message: result.message });
      return;
    }

    setProfileContent(result.profile.content);
    setProfileUpdatedAt(result.profile.updatedAt);
    setStatus({ kind: "saved", message: "记忆画像已保存。" });
  }

  return (
    <section className="memory-panel">
      <div className="settings-header">
        <div>
          <p className="kicker">本地记忆</p>
          <h3>记忆</h3>
        </div>
        <span className={`settings-state is-${status.kind}`}>
          {memories.length} 条已保存
        </span>
      </div>

      <div className="memory-toolbar">
        <label className="field">
          <span>搜索</span>
          <input
            onChange={(event) => void handleSearch(event.currentTarget.value)}
            placeholder="智能体记忆"
            value={query}
          />
        </label>

        <label className="field">
          <span>类型</span>
          <select
            onChange={(event) =>
              void handleSearch(query, event.currentTarget.value as MemoryKind | "all")
            }
            value={kindFilter}
          >
            <option value="all">全部</option>
            {getMemoryKinds().map((kind) => (
              <option key={kind} value={kind}>
                {getMemoryKindLabel(kind)}
              </option>
            ))}
          </select>
        </label>

        <button className="secondary-action" onClick={handleExport} type="button">
          导出
        </button>
        <button
          className="secondary-action"
          disabled={status.kind === "saving"}
          onClick={handleRunMaintenance}
          type="button"
        >
          整理
        </button>
        <button
          className="secondary-action"
          disabled={status.kind === "saving"}
          onClick={handleReviewGovernance}
          type="button"
        >
          治理
        </button>
        <button
          className="secondary-action"
          disabled={status.kind === "saving"}
          onClick={handleRunMemoryEval}
          type="button"
        >
          评估
        </button>
      </div>

      {maintenanceReport ? (
        <section className="maintenance-report" aria-label="记忆维护报告">
          <dl>
            <div>
              <dt>已扫描</dt>
              <dd>{maintenanceReport.scanned}</dd>
            </div>
            <div>
              <dt>候选</dt>
              <dd>{maintenanceReport.candidates}</dd>
            </div>
            <div>
              <dt>已合并</dt>
              <dd>{maintenanceReport.consolidated}</dd>
            </div>
            <div>
              <dt>已归档</dt>
              <dd>{maintenanceReport.archived}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      {governanceReport ? (
        <section className="maintenance-report" aria-label="记忆治理报告">
          <dl>
            <div>
              <dt>已扫描</dt>
              <dd>{governanceReport.scanned}</dd>
            </div>
            <div>
              <dt>重复</dt>
              <dd>{governanceReport.duplicateGroups.length}</dd>
            </div>
            <div>
              <dt>冲突</dt>
              <dd>{governanceReport.conflictGroups.length}</dd>
            </div>
            <div>
              <dt>陈旧</dt>
              <dd>{governanceReport.staleLowSignalRecords.length}</dd>
            </div>
          </dl>
          <ul className="memory-report-list">
            {governanceReport.recommendations.map((recommendation) => (
              <li key={recommendation}>{recommendation}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {evalReport ? (
        <section className="maintenance-report" aria-label="记忆评估报告">
          <dl>
            <div>
              <dt>用例</dt>
              <dd>{evalReport.total}</dd>
            </div>
            <div>
              <dt>通过</dt>
              <dd>{evalReport.passed}</dd>
            </div>
            <div>
              <dt>失败</dt>
              <dd>{evalReport.failed}</dd>
            </div>
            <div>
              <dt>通过率</dt>
              <dd>{Math.round(evalReport.passRate * 100)}%</dd>
            </div>
          </dl>
          {evalReport.failures.length ? (
            <ul className="memory-report-list">
              {evalReport.failures.map((failure) => (
                <li key={failure.caseId}>
                  {failure.caseId}: {failure.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <section className="memory-profile-editor" aria-label="记忆画像">
        <div className="section-heading">
          <span>记忆画像</span>
          <small>
            {profileUpdatedAt
              ? `更新时间 ${new Date(profileUpdatedAt).toLocaleString()}`
              : "未加载"}
          </small>
        </div>
        <textarea
          onChange={(event) => setProfileContent(event.currentTarget.value)}
          rows={8}
          value={profileContent}
        />
        <div className="settings-actions">
          <button
            className="secondary-action"
            disabled={status.kind === "saving"}
            onClick={() => void loadMemoryProfile()}
            type="button"
          >
            重新加载
          </button>
          <button
            className="primary-action"
            disabled={status.kind === "saving"}
            onClick={() => void handleSaveProfile()}
            type="button"
          >
            保存画像
          </button>
        </div>
      </section>

      <div className="memory-layout">
        <form className="memory-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>
              类型 <em>必填</em>
            </span>
            <select
              onChange={(event) =>
                setForm({
                  ...form,
                  kind: event.currentTarget.value as MemoryKind,
                })
              }
              value={form.kind}
            >
              {getMemoryKinds().map((kind) => (
                <option key={kind} value={kind}>
                  {getMemoryKindLabel(kind)}
                </option>
              ))}
            </select>
            {errors.kind ? <small>{errors.kind}</small> : null}
          </label>

          <label className="field">
            <span>
              标题 <em>必填</em>
            </span>
            <input
              onChange={(event) =>
                setForm({ ...form, title: event.currentTarget.value })
              }
              value={form.title}
            />
            {errors.title ? <small>{errors.title}</small> : null}
          </label>

          <label className="field">
            <span>
              内容 <em>必填</em>
            </span>
            <textarea
              onChange={(event) =>
                setForm({ ...form, content: event.currentTarget.value })
              }
              rows={6}
              value={form.content}
            />
            {errors.content ? <small>{errors.content}</small> : null}
          </label>

          <div className="field-grid memory-form-grid">
            <label className="field">
              <span>标签</span>
              <input
                onChange={(event) => setTagText(event.currentTarget.value)}
                placeholder="智能体, 记忆"
                value={tagText}
              />
            </label>

            <label className="field">
              <span>重要度</span>
              <select
                onChange={(event) =>
                  setForm({
                    ...form,
                    importance: Number(event.currentTarget.value),
                  })
                }
                value={form.importance}
              >
                {[1, 2, 3, 4, 5].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              {errors.importance ? <small>{errors.importance}</small> : null}
            </label>
          </div>

          <div className="settings-actions">
            <button className="primary-action" disabled={status.kind === "saving"}>
              保存记忆
            </button>
            <p className={`settings-message is-${status.kind}`}>
              {status.message}
            </p>
          </div>
        </form>

        <section className="memory-list" aria-label="已保存的记忆">
          {displayedMemories.length ? (
            displayedMemories.map((memory) => {
              const searchResult = searchResults.find(
                (result) => result.record.id === memory.id,
              );

              return (
                <article className="memory-card" key={memory.id}>
                  <div className="memory-card-header">
                    <span>{getMemoryKindLabel(memory.kind)}</span>
                    <button
                      className="danger-action"
                      onClick={() => void handleDelete(memory.id)}
                      type="button"
                    >
                      删除
                    </button>
                  </div>
                  <h4>{memory.title}</h4>
                  <p>{memory.content}</p>
                  <dl>
                    <div>
                      <dt>来源</dt>
                      <dd>{formatSource(memory)}</dd>
                    </div>
                    <div>
                      <dt>重要度</dt>
                      <dd>{memory.importance}</dd>
                    </div>
                    <div>
                      <dt>更新时间</dt>
                      <dd>{new Date(memory.updatedAt).toLocaleString()}</dd>
                    </div>
                    {searchResult ? (
                      <div>
                        <dt>分数</dt>
                        <dd>{searchResult.score}</dd>
                      </div>
                    ) : null}
                    {memory.embedding ? (
                      <div>
                        <dt>Embedding</dt>
                        <dd>
                          {memory.embedding.model} / {memory.embedding.dimensions}d
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                  {memory.tags.length ? (
                    <div className="memory-tags">
                      {memory.tags.map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </div>
                  ) : null}
                </article>
              );
            })
          ) : (
            <div className="empty-state">还没有记忆记录。</div>
          )}
        </section>
      </div>

      {exportedJson ? (
        <label className="field export-preview">
          <span>导出 JSON</span>
          <textarea readOnly rows={8} value={exportedJson} />
        </label>
      ) : null}
    </section>
  );
}

function parseTags(value: string): string[] {
  return value
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function formatSource(memory: MemoryRecord): string {
  if ("refId" in memory.source) {
    return `${memory.source.type}:${memory.source.refId}`;
  }

  return memory.source.type;
}
