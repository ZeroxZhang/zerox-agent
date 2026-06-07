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
  const [maintenanceReport, setMaintenanceReport] =
    useState<MemoryMaintenanceReport | null>(null);
  const [status, setStatus] = useState<MemoryStatus>({
    kind: "idle",
    message: "记忆系统已就绪。",
  });

  useEffect(() => {
    void loadMemories();
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
