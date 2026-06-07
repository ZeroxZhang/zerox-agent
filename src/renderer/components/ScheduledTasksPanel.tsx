import { useEffect, useMemo, useState } from "react";
import type { AgentRunRecord } from "../../shared/agentRuns";
import {
  describeSchedule,
  draftScheduleFromText,
  type ScheduledTask,
  type ScheduledTaskInput,
  type ScheduledTaskValidationErrors,
  type TaskSchedule,
} from "../../shared/scheduledTasks";
import type { SkillDiscoveryResult } from "../../shared/skills";
import { buildToolSafetySummary } from "../../shared/toolSafetySummary";
import type { TaskPermissionPolicy } from "../../shared/toolPermissions";
import { demoRuns, demoTasks } from "../demoAgentData";
import { ToolSafetySummaryCard } from "./ToolSafetySummaryCard";

type TaskStatus =
  | { kind: "idle"; message: string }
  | { kind: "saving"; message: string }
  | { kind: "saved"; message: string }
  | { kind: "error"; message: string };

const emptySkillResult: SkillDiscoveryResult = {
  skills: [],
  errors: [],
};

const defaultInputJson = `{
  "targetDir": "~/Downloads"
}`;

const defaultPermissionPolicy: TaskPermissionPolicy = {
  files: {
    read: ["~/Downloads"],
    write: ["~/Downloads"],
  },
  web: {
    search: false,
    fetchDomains: [],
  },
  shell: {
    commands: [],
  },
};

export function ScheduledTasksPanel() {
  const [skills, setSkills] = useState<SkillDiscoveryResult>(emptySkillResult);
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [runs, setRuns] = useState<AgentRunRecord[]>([]);
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [draftText, setDraftText] = useState("");
  const [inputJson, setInputJson] = useState(defaultInputJson);
  const [permissionPolicy, setPermissionPolicy] =
    useState<TaskPermissionPolicy>(defaultPermissionPolicy);
  const [errors, setErrors] = useState<ScheduledTaskValidationErrors>({});
  const [status, setStatus] = useState<TaskStatus>({
    kind: "idle",
    message: "还没有保存定时任务。",
  });
  const [form, setForm] = useState<ScheduledTaskInput>({
    name: "整理下载文件夹",
    skillName: "",
    enabled: true,
    schedule: { kind: "manual" },
    input: {},
  });

  useEffect(() => {
    if (!window.buildingAgent) {
      setTasks(demoTasks);
      setRuns(demoRuns);
      setStatus({
        kind: "idle",
        message: "浏览器预览模式，正在展示演示任务。",
      });
      setLoading(false);
      return;
    }

    Promise.all([
      window.buildingAgent.listSkills(),
      window.buildingAgent.listScheduledTasks(),
      window.buildingAgent.listAgentRuns(),
    ])
      .then(([skillResult, loadedTasks, loadedRuns]) => {
        setSkills(skillResult);
        setTasks(loadedTasks);
        setRuns(loadedRuns);
        setForm((current) => ({
          ...current,
          skillName:
            current.skillName || skillResult.skills[0]?.manifest.name || "",
        }));
        setStatus({
          kind: "idle",
          message: loadedTasks.length
            ? "定时任务已加载。"
            : "还没有保存定时任务。",
        });
      })
      .catch((error) => {
        setStatus({
          kind: "error",
          message:
            error instanceof Error
              ? error.message
              : "无法加载定时任务。",
        });
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  async function refreshTaskList() {
    if (!window.buildingAgent) {
      return;
    }

    const loadedTasks = await window.buildingAgent.listScheduledTasks();
    setTasks(loadedTasks);
  }

  const taskCountLabel = useMemo(() => {
    if (loading) {
      return "正在加载";
    }

    return `${tasks.length} 个任务`;
  }, [loading, tasks.length]);
  const draftSafetySummary = useMemo(
    () => buildToolSafetySummary(permissionPolicy),
    [permissionPolicy],
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus({ kind: "saving", message: "正在创建任务..." });
    setErrors({});

    if (!window.buildingAgent) {
      setStatus({
        kind: "error",
        message: "浏览器预览模式无法管理桌面任务。",
      });
      return;
    }

    const parsedInput = parseTaskInputJson(inputJson);
    if (!parsedInput.ok) {
      setErrors({ input: parsedInput.message });
      setStatus({ kind: "error", message: parsedInput.message });
      return;
    }

    const result = await window.buildingAgent.createScheduledTask({
      ...form,
      input: parsedInput.value,
      permissions: permissionPolicy,
    });

    if (!result.ok) {
      setErrors(result.errors);
      setStatus({ kind: "error", message: result.message });
      return;
    }

    setTasks((currentTasks) => [...currentTasks, result.task]);
    setStatus({ kind: "saved", message: "任务已创建。" });
  }

  async function handleRunTask(taskId: string) {
    setRunningTaskId(taskId);
    setStatus({ kind: "saving", message: "正在运行智能体任务..." });

    if (!window.buildingAgent) {
      setStatus({
        kind: "error",
        message: "浏览器预览模式无法运行桌面任务。",
      });
      setRunningTaskId(null);
      return;
    }

    const result = await window.buildingAgent.runScheduledTask(taskId);
    setRunningTaskId(null);

    if (!result.ok) {
      setStatus({ kind: "error", message: result.message });
      return;
    }

    setRuns((currentRuns) => [result.run, ...currentRuns]);
    await refreshTaskList();
    setStatus({
      kind: result.run.status === "succeeded" ? "saved" : "error",
      message:
        result.run.status === "succeeded"
          ? "智能体运行已完成。"
          : result.run.status === "canceled"
            ? "智能体运行已取消。"
          : "智能体运行失败。",
    });
  }

  async function handleCancelRunTask(taskId: string) {
    setStatus({ kind: "saving", message: "正在停止智能体任务..." });

    if (!window.buildingAgent) {
      setStatus({
        kind: "idle",
        message: "浏览器预览模式无法停止真实任务；桌面端会中断当前运行。",
      });
      return;
    }

    const result = await window.buildingAgent.cancelScheduledTaskRun(taskId);
    setStatus({
      kind: result.ok ? "idle" : "error",
      message: result.message,
    });
  }

  async function handleSetTaskEnabled(task: ScheduledTask, enabled: boolean) {
    setUpdatingTaskId(task.id);
    setStatus({
      kind: "saving",
      message: enabled ? "正在恢复任务..." : "正在暂停任务...",
    });

    if (!window.buildingAgent) {
      setStatus({
        kind: "error",
        message: "浏览器预览模式无法更新桌面任务。",
      });
      setUpdatingTaskId(null);
      return;
    }

    const result = await window.buildingAgent.setScheduledTaskEnabled(
      task.id,
      enabled,
    );
    setUpdatingTaskId(null);

    if (!result.ok) {
      setStatus({ kind: "error", message: result.message });
      return;
    }

    if (!result.task) {
      setStatus({ kind: "error", message: "没有找到这个任务。" });
      return;
    }

    setTasks((currentTasks) =>
      currentTasks.map((currentTask) =>
        currentTask.id === result.task!.id ? result.task! : currentTask,
      ),
    );
    setStatus({
      kind: "saved",
      message: enabled ? "任务已恢复。" : "任务已暂停。",
    });
  }

  async function handleDeleteTask(task: ScheduledTask) {
    if (!window.confirm(`删除任务“${task.name}”？这不会删除已有运行日志。`)) {
      return;
    }

    setUpdatingTaskId(task.id);
    setStatus({ kind: "saving", message: "正在删除任务..." });

    if (!window.buildingAgent) {
      setStatus({
        kind: "error",
        message: "浏览器预览模式无法删除桌面任务。",
      });
      setUpdatingTaskId(null);
      return;
    }

    const result = await window.buildingAgent.deleteScheduledTask(task.id);
    setUpdatingTaskId(null);

    if (!result.ok) {
      setStatus({ kind: "error", message: result.message });
      return;
    }

    if (!result.deleted) {
      setStatus({ kind: "error", message: "没有找到这个任务。" });
      return;
    }

    setTasks((currentTasks) =>
      currentTasks.filter((currentTask) => currentTask.id !== task.id),
    );
    setStatus({ kind: "saved", message: "任务已删除。" });
  }

  function handleDraftSchedule() {
    const draft = draftScheduleFromText(draftText);

    if (!draft) {
      setStatus({
        kind: "error",
        message: "可以试试：每 30 分钟、每天 09:00，或 cron: */15 * * * *。",
      });
      return;
    }

    setForm({ ...form, schedule: draft });
    setStatus({ kind: "idle", message: `已生成草稿：${describeSchedule(draft)}。` });
  }

  return (
    <section className="task-panel">
      <div className="settings-header">
        <div>
          <p className="kicker">本地调度器</p>
          <h3>定时任务</h3>
        </div>
        <span className={`settings-state is-${status.kind}`}>
          {taskCountLabel}
        </span>
      </div>

      <div className="task-layout">
        <form className="task-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>
              任务名称 <em>必填</em>
            </span>
            <input
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.currentTarget.value })
              }
            />
            {errors.name ? <small>{errors.name}</small> : null}
          </label>

          <label className="field">
            <span>
              技能 <em>必填</em>
            </span>
            <select
              value={form.skillName}
              onChange={(event) =>
                setForm({ ...form, skillName: event.currentTarget.value })
              }
            >
              <option value="">选择一个技能</option>
              {skills.skills.map((skill) => (
                <option key={skill.manifest.name} value={skill.manifest.name}>
                  {skill.manifest.displayName}
                </option>
              ))}
            </select>
            {errors.skillName ? <small>{errors.skillName}</small> : null}
          </label>

          <label className="field checkbox-field">
            <input
              checked={form.enabled}
              onChange={(event) =>
                setForm({ ...form, enabled: event.currentTarget.checked })
              }
              type="checkbox"
            />
            <span>启用</span>
          </label>

          <div className="field-grid">
            <label className="field">
              <span>
                调度方式 <em>必填</em>
              </span>
              <select
                value={form.schedule.kind}
                onChange={(event) =>
                  setForm({
                    ...form,
                    schedule: createDefaultSchedule(
                      event.currentTarget.value as TaskSchedule["kind"],
                    ),
                  })
                }
              >
                <option value="manual">手动</option>
                <option value="daily">每天</option>
                <option value="interval">间隔</option>
                <option value="cron">Cron</option>
              </select>
            </label>

            <ScheduleFields
              schedule={form.schedule}
              onChange={(schedule) => setForm({ ...form, schedule })}
            />
          </div>
          {errors.schedule ? <small>{errors.schedule}</small> : null}

          <div className="draft-row">
            <label className="field">
              <span>
                自然语言草稿 <em>选填</em>
              </span>
              <input
                value={draftText}
                onChange={(event) => setDraftText(event.currentTarget.value)}
                placeholder="每 30 分钟"
              />
            </label>
            <button className="secondary-action" onClick={handleDraftSchedule} type="button">
              生成草稿
            </button>
          </div>

          <label className="field">
            <span>
              任务输入 JSON <em>必填</em>
            </span>
            <textarea
              value={inputJson}
              onChange={(event) => setInputJson(event.currentTarget.value)}
              rows={5}
            />
            {errors.input ? <small>{errors.input}</small> : null}
          </label>

          <section className="permission-editor" aria-label="任务权限">
            <div className="section-heading">
              <span>任务权限</span>
              <small>默认拒绝，只允许这里列出的范围</small>
            </div>
            <div className="field-grid">
              <label className="field">
                <span>
                  可读目录 <em>每行一个</em>
                </span>
                <textarea
                  onChange={(event) =>
                    setPermissionPolicy({
                      ...permissionPolicy,
                      files: {
                        ...permissionPolicy.files,
                        read: parseLines(event.currentTarget.value),
                      },
                    })
                  }
                  rows={3}
                  value={formatLines(permissionPolicy.files.read)}
                />
              </label>
              <label className="field">
                <span>
                  可写目录 <em>每行一个</em>
                </span>
                <textarea
                  onChange={(event) =>
                    setPermissionPolicy({
                      ...permissionPolicy,
                      files: {
                        ...permissionPolicy.files,
                        write: parseLines(event.currentTarget.value),
                      },
                    })
                  }
                  rows={3}
                  value={formatLines(permissionPolicy.files.write)}
                />
              </label>
            </div>
            <label className="field checkbox-field">
              <input
                checked={permissionPolicy.web.search}
                onChange={(event) =>
                  setPermissionPolicy({
                    ...permissionPolicy,
                    web: {
                      ...permissionPolicy.web,
                      search: event.currentTarget.checked,
                    },
                  })
                }
                type="checkbox"
              />
              <span>允许 web_search</span>
            </label>
            <label className="field">
              <span>
                可抓取网页域名 <em>每行一个</em>
              </span>
              <textarea
                onChange={(event) =>
                  setPermissionPolicy({
                    ...permissionPolicy,
                    web: {
                      ...permissionPolicy.web,
                      fetchDomains: parseLines(event.currentTarget.value),
                    },
                  })
                }
                rows={3}
                placeholder="example.com"
                value={formatLines(permissionPolicy.web.fetchDomains)}
              />
            </label>
            <label className="field">
              <span>
                命令行模板 <em>每行一个</em>
              </span>
              <textarea
                onChange={(event) =>
                  setPermissionPolicy({
                    ...permissionPolicy,
                    shell: {
                      commands: parseLines(event.currentTarget.value),
                    },
                  })
                }
                rows={3}
                placeholder="find {{targetDir}} -maxdepth 1 -type f"
                value={formatLines(permissionPolicy.shell.commands)}
              />
            </label>
            {errors.permissions ? <small>{errors.permissions}</small> : null}
          </section>

          <ToolSafetySummaryCard summary={draftSafetySummary} />

          <div className="settings-actions">
            <button
              className="primary-action"
              disabled={status.kind === "saving"}
            >
              创建任务
            </button>
            <p className={`settings-message is-${status.kind}`}>
              {status.message}
            </p>
          </div>
        </form>

        <section className="task-list" aria-label="已保存的定时任务">
          {tasks.length ? (
            tasks.map((task) => (
              <article className="task-row" key={task.id}>
                <div>
                  <span>{task.enabled ? "已启用" : "已暂停"}</span>
                  <h4>{task.name}</h4>
                  <p>{task.skillName}</p>
                </div>
                <dl>
                  <div>
                    <dt>调度</dt>
                    <dd>{describeSchedule(task.schedule)}</dd>
                  </div>
                  <div>
                    <dt>下次运行</dt>
                    <dd>{formatNextRun(task.nextRunAt)}</dd>
                  </div>
                  <div>
                    <dt>权限</dt>
                    <dd>{summarizePermissions(task.permissions)}</dd>
                  </div>
                </dl>
                <ToolSafetySummaryCard summary={buildToolSafetySummary(task.permissions)} />
                {runningTaskId === task.id ? (
                  <button
                    className="danger-action"
                    onClick={() => void handleCancelRunTask(task.id)}
                    type="button"
                  >
                    停止运行
                  </button>
                ) : (
                  <button
                    className="secondary-action"
                    disabled={updatingTaskId === task.id}
                    onClick={() => void handleRunTask(task.id)}
                    type="button"
                  >
                    立即运行
                  </button>
                )}
                <div className="task-row-actions">
                  <button
                    className="secondary-action"
                    disabled={runningTaskId === task.id || updatingTaskId === task.id}
                    onClick={() => void handleSetTaskEnabled(task, !task.enabled)}
                    type="button"
                  >
                    {task.enabled ? "暂停" : "恢复"}
                  </button>
                  <button
                    className="danger-action"
                    disabled={runningTaskId === task.id || updatingTaskId === task.id}
                    onClick={() => void handleDeleteTask(task)}
                    type="button"
                  >
                    删除
                  </button>
                </div>
              </article>
            ))
          ) : (
            <div className="empty-state">还没有定时任务。</div>
          )}

          <section className="run-log" aria-label="智能体运行日志">
            <div className="section-heading">
              <span>智能体运行</span>
              <small>最近 {runs.length} 条</small>
            </div>
            {runs.length ? (
              runs.slice(0, 5).map((run) => (
                <article className={`run-row is-${run.status}`} key={run.id}>
                  <span>{translateRunStatus(run.status)}</span>
                  <div>
                    <strong>{run.taskName}</strong>
                    <p>{run.summary}</p>
                    <small>{new Date(run.finishedAt).toLocaleString()}</small>
                  </div>
                </article>
              ))
            ) : (
              <div className="empty-state">还没有智能体运行记录。</div>
            )}
          </section>
        </section>
      </div>
    </section>
  );
}

function ScheduleFields(props: {
  schedule: TaskSchedule;
  onChange: (schedule: TaskSchedule) => void;
}) {
  switch (props.schedule.kind) {
    case "manual":
      return <div className="schedule-placeholder">仅手动运行</div>;
    case "daily":
      return (
        <label className="field">
          <span>
            时间 <em>HH:mm</em>
          </span>
          <input
            onChange={(event) =>
              props.onChange({
                kind: "daily",
                time: event.currentTarget.value,
              })
            }
            type="time"
            value={props.schedule.time}
          />
        </label>
      );
    case "interval": {
      const schedule = props.schedule;

      return (
        <div className="interval-fields">
          <label className="field">
            <span>
              每隔 <em>数字</em>
            </span>
            <input
              min="1"
              onChange={(event) =>
                props.onChange({
                  kind: "interval",
                  every: Number(event.currentTarget.value),
                  unit: schedule.unit,
                })
              }
              type="number"
              value={schedule.every}
            />
          </label>
          <label className="field">
            <span>
              单位 <em>必填</em>
            </span>
            <select
              onChange={(event) =>
                props.onChange({
                  kind: "interval",
                  every: schedule.every,
                  unit: event.currentTarget.value === "hours" ? "hours" : "minutes",
                })
              }
              value={schedule.unit}
            >
              <option value="minutes">分钟</option>
              <option value="hours">小时</option>
            </select>
          </label>
        </div>
      );
    }
    case "cron":
      return (
        <label className="field">
          <span>
            表达式 <em>必填</em>
          </span>
          <input
            onChange={(event) =>
              props.onChange({
                kind: "cron",
                expression: event.currentTarget.value,
              })
            }
            placeholder="*/15 * * * *"
            value={props.schedule.expression}
          />
        </label>
      );
  }
}

function createDefaultSchedule(kind: TaskSchedule["kind"]): TaskSchedule {
  switch (kind) {
    case "manual":
      return { kind: "manual" };
    case "daily":
      return { kind: "daily", time: "09:00" };
    case "interval":
      return { kind: "interval", every: 30, unit: "minutes" };
    case "cron":
      return { kind: "cron", expression: "0 9 * * *" };
  }
}

function parseTaskInputJson(
  value: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  try {
    const parsed = JSON.parse(value) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, message: "任务输入必须是 JSON 对象。" };
    }

    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, message: "任务输入必须是有效 JSON。" };
  }
}

function formatNextRun(value: string | null): string {
  if (!value) {
    return "仅手动运行";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function parseLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function formatLines(values: string[]): string {
  return values.join("\n");
}

function summarizePermissions(policy: TaskPermissionPolicy): string {
  const fileCount = policy.files.read.length + policy.files.write.length;
  const webCount = policy.web.fetchDomains.length + (policy.web.search ? 1 : 0);
  const shellCount = policy.shell.commands.length;

  return `${fileCount} 个文件权限 / ${webCount} 个网页权限 / ${shellCount} 个命令权限`;
}

function translateRunStatus(status: AgentRunRecord["status"]): string {
  if (status === "succeeded") {
    return "成功";
  }

  if (status === "canceled") {
    return "已取消";
  }

  return "失败";
}
