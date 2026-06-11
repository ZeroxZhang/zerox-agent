import { useEffect, useMemo, useState } from "react";
import type { ScheduledTask } from "../../shared/scheduledTasks";
import { buildToolSafetySummary } from "../../shared/toolSafetySummary";
import type {
  AgentToolName,
  ToolAuditEvent,
  ToolCallRequest,
} from "../../shared/toolPermissions";
import { demoTasks } from "../demoAgentData";
import { ToolSafetySummaryCard } from "./ToolSafetySummaryCard";

type ToolsStatus =
  | { kind: "idle"; message: string }
  | { kind: "checking"; message: string }
  | { kind: "saved"; message: string }
  | { kind: "error"; message: string };

const toolOptions: Array<{ name: AgentToolName; label: string }> = [
  { name: "file_list", label: "列出目录 (file_list)" },
  { name: "file_stat", label: "文件元信息 (file_stat)" },
  { name: "file_search", label: "搜索文件 (file_search)" },
  { name: "file_read", label: "读取文件 (file_read)" },
  { name: "file_write", label: "写入文件 (file_write)" },
  { name: "web_search", label: "网页搜索 (web_search)" },
  { name: "web_fetch", label: "抓取网页 (web_fetch)" },
  { name: "shell_exec", label: "执行命令 (shell_exec)" },
];

export function ToolsPanel() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [auditEvents, setAuditEvents] = useState<ToolAuditEvent[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [toolName, setToolName] = useState<AgentToolName>("file_read");
  const [argsJson, setArgsJson] = useState(defaultArgsJson("file_read"));
  const [decision, setDecision] = useState<ToolAuditEvent | null>(null);
  const [status, setStatus] = useState<ToolsStatus>({
    kind: "idle",
    message: "选择任务和工具；越权但参数合法时，桌面端会主动弹窗请求授权。",
  });

  useEffect(() => {
    if (!window.buildingAgent) {
      setTasks(demoTasks);
      setSelectedTaskId(demoTasks[0]?.id ?? "");
      setAuditEvents([]);
      setStatus({
        kind: "idle",
        message: "浏览器预览模式，正在展示演示任务的权限边界。",
      });
      return;
    }

    Promise.all([
      window.buildingAgent.listScheduledTasks(),
      window.buildingAgent.listToolAuditEvents(),
    ])
      .then(([loadedTasks, loadedAuditEvents]) => {
        setTasks(loadedTasks);
        setAuditEvents(loadedAuditEvents);
        setSelectedTaskId(loadedTasks[0]?.id ?? "");
        setStatus({
          kind: "idle",
          message: loadedTasks.length
            ? "工具授权闸门已就绪；风险操作会弹窗请求一次性授权。"
            : "请先创建一个任务，再检查工具权限。",
        });
      })
      .catch((error) => {
        setStatus({
          kind: "error",
          message:
            error instanceof Error
              ? error.message
              : "无法加载工具权限。",
        });
      });
  }, []);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, tasks],
  );
  const selectedTaskSafetySummary = useMemo(
    () =>
      selectedTask ? buildToolSafetySummary(selectedTask.permissions) : null,
    [selectedTask],
  );

  async function handleAuthorize(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus({ kind: "checking", message: "正在检查工具权限..." });

    if (!window.buildingAgent) {
      setStatus({
        kind: "error",
        message: "浏览器预览模式无法检查桌面工具权限。",
      });
      return;
    }

    const parsedArgs = parseArgsJson(argsJson);
    if (!parsedArgs.ok) {
      setStatus({ kind: "error", message: parsedArgs.message });
      return;
    }

    const request: ToolCallRequest = {
      toolName,
      args: parsedArgs.value,
    };
    const result = await window.buildingAgent.authorizeToolCall(
      selectedTaskId,
      request,
    );

    if (!result.ok) {
      setStatus({ kind: "error", message: result.message });
      return;
    }

    setDecision(result.auditEvent);
    setAuditEvents((currentEvents) => [result.auditEvent, ...currentEvents]);
    setStatus({
      kind: result.decision.allowed ? "saved" : "error",
      message: result.decision.allowed ? "工具调用已允许。" : "工具调用被拒绝。",
    });
  }

  return (
    <section className="tools-panel">
      <div className="settings-header">
        <div>
          <p className="kicker">权限闸门</p>
          <h3>工具授权</h3>
        </div>
        <span className={`settings-state is-${status.kind}`}>
          {auditEvents.length} 条审计
        </span>
      </div>

      <div className="tools-layout">
        <form className="tool-checker" onSubmit={handleAuthorize}>
          <label className="field">
            <span>
              任务 <em>必填</em>
            </span>
            <select
              onChange={(event) => setSelectedTaskId(event.currentTarget.value)}
              value={selectedTaskId}
            >
              <option value="">选择一个任务</option>
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>
              工具 <em>必填</em>
            </span>
            <select
              onChange={(event) => {
                const nextToolName = event.currentTarget.value as AgentToolName;
                setToolName(nextToolName);
                setArgsJson(defaultArgsJson(nextToolName));
              }}
              value={toolName}
            >
              {toolOptions.map((tool) => (
                <option key={tool.name} value={tool.name}>
                  {tool.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>
              工具参数 JSON <em>必填</em>
            </span>
            <textarea
              onChange={(event) => setArgsJson(event.currentTarget.value)}
              rows={6}
              value={argsJson}
            />
          </label>

          {selectedTaskSafetySummary ? (
            <ToolSafetySummaryCard
              summary={selectedTaskSafetySummary}
              actionLabel="查看审计日志"
              onAction={() => {
                document
                  .querySelector('[aria-label="工具审计日志"]')
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            />
          ) : null}

          <div className="settings-actions">
            <button
              className="primary-action"
              disabled={!selectedTaskId || status.kind === "checking"}
            >
            检查并请求授权
            </button>
            <p className={`settings-message is-${status.kind}`}>
              {status.message}
            </p>
          </div>
        </form>

        <section className="audit-panel" aria-label="工具审计日志">
          {decision ? (
            <article
              className={`decision-card ${
                decision.decision.allowed ? "is-allowed" : "is-denied"
              }`}
            >
              <span>{decision.decision.allowed ? "已允许" : "已拒绝"}</span>
              <h4>{decision.request.toolName}</h4>
              <p>{decision.decision.reason}</p>
            </article>
          ) : null}

          <div className="audit-list">
            {auditEvents.length ? (
              auditEvents.map((event) => (
                <article
                  className={`audit-row ${
                    event.decision.allowed ? "is-allowed" : "is-denied"
                  }`}
                  key={event.id}
                >
                  <span>{event.decision.allowed ? "允许" : "拒绝"}</span>
                  <div>
                    <strong>{event.request.toolName}</strong>
                    <p>{event.decision.reason}</p>
                    <small>{new Date(event.createdAt).toLocaleString()}</small>
                  </div>
                </article>
              ))
            ) : (
              <div className="empty-state">还没有审计事件。</div>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

function defaultArgsJson(toolName: AgentToolName): string {
  const defaults: Record<AgentToolName, Record<string, unknown>> = {
    file_list: { path: "~/Downloads" },
    file_stat: { path: "~/Downloads/notes.md" },
    file_search: { root: "~/Downloads", query: "report", mode: "both" },
    file_read: { path: "~/Downloads/notes.md" },
    file_write: { path: "~/Downloads/reports/today.md" },
    code_search: { workspaceRoot: "~/Projects/demo", query: "Agent" },
    git_status: { workspaceRoot: "~/Projects/demo" },
    git_diff: { workspaceRoot: "~/Projects/demo" },
    test_run: {
      workspaceRoot: "~/Projects/demo",
      command: "npm test -- src/shared/nativeCapabilities.test.ts",
    },
    memory_search: { query: "下载目录偏好", kind: "all", limit: "5" },
    conversation_search: { query: "报告 保存", limit: "5" },
    web_search: { query: "智能体记忆设计" },
    web_fetch: { url: "https://example.com" },
    web_fetch_document: { url: "https://example.com" },
    citation_record: {
      id: "src_example",
      url: "https://example.com",
      title: "Example",
      quote: "A short sourced excerpt.",
    },
    citation_coverage_check: {
      citations: [
        {
          id: "src_example",
          url: "https://example.com",
          title: "Example",
        },
      ],
      claims: [
        {
          id: "fact_1",
          kind: "sourced_fact",
          text: "Example sourced fact.",
          citationIds: ["src_example"],
        },
      ],
    },
    markdown_report_write: {
      path: "~/Downloads/reports/research.md",
      title: "Research Report",
      citations: [
        {
          id: "src_example",
          url: "https://example.com",
          title: "Example",
        },
      ],
      claims: [
        {
          id: "fact_1",
          kind: "sourced_fact",
          text: "Example sourced fact.",
          citationIds: ["src_example"],
        },
      ],
      sections: [{ heading: "Findings", claimIds: ["fact_1"] }],
    },
    shell_exec: { command: "find ~/Downloads -maxdepth 1 -type f" },
  };

  return JSON.stringify(defaults[toolName], null, 2);
}

function parseArgsJson(
  value: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, message: "工具参数必须是 JSON 对象。" };
    }

    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, message: "工具参数必须是有效 JSON。" };
  }
}
