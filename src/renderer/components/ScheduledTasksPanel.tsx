import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentRunRecord } from "../../shared/agentRuns";
import {
  describeSchedule,
  draftScheduleFromText,
  type ScheduledTask,
  type ScheduledTaskInput,
  type ScheduledTaskValidationErrors,
  type TaskSchedule,
} from "../../shared/scheduledTasks";
import { buildToolSafetySummary } from "../../shared/toolSafetySummary";
import type { TaskPermissionPolicy } from "../../shared/toolPermissions";
import { demoRuns, demoTasks } from "../demoAgentData";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";
import { ToolSafetySummaryCard } from "./ToolSafetySummaryCard";

type TaskStatus =
  | { kind: "idle"; message: string }
  | { kind: "saving"; message: string }
  | { kind: "saved"; message: string }
  | { kind: "error"; message: string };

const defaultInputJson = "{}";

const defaultPermissionPolicy: TaskPermissionPolicy = {
  files: {
    read: [],
    write: [],
  },
  web: {
    search: false,
    fetchDomains: [],
  },
  shell: {
    commands: [],
  },
  memory: {
    read: false,
    write: false,
  },
};

export function ScheduledTasksPanel() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [runs, setRuns] = useState<AgentRunRecord[]>([]);
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [createMenuOpen, setCreateMenuOpen] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [pendingDeleteTask, setPendingDeleteTask] =
    useState<ScheduledTask | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [isSubmittingCreateTask, setIsSubmittingCreateTask] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [scheduleDraftText, setScheduleDraftText] = useState("");
  const [inputJson, setInputJson] = useState(defaultInputJson);
  const [permissionPolicy, setPermissionPolicy] =
    useState<TaskPermissionPolicy>(defaultPermissionPolicy);
  const [errors, setErrors] = useState<ScheduledTaskValidationErrors>({});
  const [status, setStatus] = useState<TaskStatus>({
    kind: "idle",
    message: "还没有保存定时任务。",
  });
  const [createStatus, setCreateStatus] = useState<TaskStatus>({
    kind: "idle",
    message: "",
  });
  const createDialogRef = useRef<HTMLElement>(null);
  const createDialogHeadingRef = useRef<HTMLHeadingElement>(null);
  const isSubmittingCreateTaskRef = useRef(false);
  const [form, setForm] = useState<ScheduledTaskInput>({
    name: "整理下载文件夹",
    skillName: "",
    enabled: true,
    schedule: { kind: "daily", time: "09:00" },
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
      window.buildingAgent.listScheduledTasks(),
      window.buildingAgent.listAgentRuns(),
    ])
      .then(([loadedTasks, loadedRuns]) => {
        setTasks(loadedTasks);
        setRuns(loadedRuns);
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

  useEffect(() => {
    isSubmittingCreateTaskRef.current = isSubmittingCreateTask;
  }, [isSubmittingCreateTask]);

  useEffect(() => {
    if (!createDialogOpen) {
      return;
    }

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    createDialogHeadingRef.current?.focus();

    function handleDialogKeyDown(event: KeyboardEvent) {
      const dialog = createDialogRef.current;
      if (!dialog) {
        return;
      }

      if (event.key === "Escape") {
        if (!isSubmittingCreateTaskRef.current) {
          event.preventDefault();
          setCreateDialogOpen(false);
        }
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          [
            "button:not([disabled])",
            "input:not([disabled])",
            "select:not([disabled])",
            "textarea:not([disabled])",
            "summary",
            "[href]",
            '[tabindex]:not([tabindex="-1"])',
          ].join(","),
        ),
      ).filter((element) => element.offsetParent !== null);

      if (!focusableElements.length) {
        return;
      }

      const firstFocusable = focusableElements[0];
      const lastFocusable = focusableElements[focusableElements.length - 1];
      const activeElement =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;

      if (event.shiftKey) {
        if (!activeElement || activeElement === firstFocusable) {
          event.preventDefault();
          lastFocusable.focus();
        }
        return;
      }

      if (activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable.focus();
      }
    }

    document.addEventListener("keydown", handleDialogKeyDown);

    return () => {
      document.removeEventListener("keydown", handleDialogKeyDown);
      previouslyFocused?.focus();
    };
  }, [createDialogOpen]);

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

    const enabledCount = tasks.filter((task) => task.enabled).length;

    return `${tasks.length} 个任务 · ${enabledCount} 个启用`;
  }, [loading, tasks]);
  const draftSafetySummary = useMemo(
    () => buildToolSafetySummary(permissionPolicy),
    [permissionPolicy],
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmittingCreateTask(true);
    setCreateStatus({
      kind: "saving",
      message: editingTaskId ? "正在保存修改..." : "正在创建任务...",
    });
    setErrors({});

    try {
      if (!window.buildingAgent) {
        const message = "浏览器预览模式无法管理桌面任务。";
        setCreateStatus({ kind: "error", message });
        setStatus({ kind: "error", message });
        return;
      }

      if (!draftText.trim()) {
        const message = "请先写清楚任务描述，包括要做什么、结果放在哪里、什么情况跳过。";
        setCreateStatus({ kind: "error", message });
        return;
      }

      const parsedInput = parseTaskInputJson(inputJson);
      if (!parsedInput.ok) {
        setErrors({ input: parsedInput.message });
        setCreateStatus({ kind: "error", message: parsedInput.message });
        return;
      }

      const taskInput: ScheduledTaskInput = {
        ...form,
        input: mergeDraftRequestIntoTaskInput(parsedInput.value, draftText),
        permissions: permissionPolicy,
      };
      const result = editingTaskId
        ? await window.buildingAgent.updateScheduledTask(editingTaskId, taskInput)
        : await window.buildingAgent.createScheduledTask(taskInput);

      if (!result.ok) {
        setErrors(result.errors);
        setCreateStatus({ kind: "error", message: result.message });
        return;
      }

      if (!result.task) {
        const message = "没有找到这个任务。";
        setCreateStatus({ kind: "error", message });
        setStatus({ kind: "error", message });
        return;
      }

      setTasks((currentTasks) =>
        editingTaskId
          ? currentTasks.map((currentTask) =>
              currentTask.id === result.task!.id ? result.task! : currentTask,
            )
          : [...currentTasks, result.task!],
      );
      setStatus({
        kind: "saved",
        message: editingTaskId ? "任务已更新。" : "任务已创建。",
      });
      setCreateStatus({
        kind: "saved",
        message: editingTaskId ? "任务已更新。" : "任务已创建。",
      });
      setCreateDialogOpen(false);
      setCreateMenuOpen(false);
      setEditingTaskId(null);
    } finally {
      setIsSubmittingCreateTask(false);
    }
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
    setPendingDeleteTask(task);
  }

  async function performDeleteTask(task: ScheduledTask) {
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
    const draft = draftScheduleFromText(scheduleDraftText);

    if (!draft) {
      setCreateStatus({
        kind: "error",
        message: "可以试试：每天 09:00、工作日 09:00、每周一 10:00，或每 30 分钟。",
      });
      return;
    }

    setForm({ ...form, schedule: draft });
    setCreateStatus({
      kind: "idle",
      message: `已生成草稿：${describeSchedule(draft)}。`,
    });
  }

  function handleOpenCreateDialog() {
    setErrors({});
    setCreateStatus({ kind: "idle", message: "" });
    setScheduleDraftText("");
    setEditingTaskId(null);
    setDraftText("");
    setInputJson(defaultInputJson);
    setPermissionPolicy(defaultPermissionPolicy);
    setForm({
      name: "整理下载文件夹",
      skillName: "",
      enabled: true,
      schedule: { kind: "daily", time: "09:00" },
      input: {},
    });
    setCreateDialogOpen(true);
    setCreateMenuOpen(false);
  }

  function handleOpenEditDialog(task: ScheduledTask) {
    setErrors({});
    setCreateStatus({ kind: "idle", message: "" });
    setScheduleDraftText("");
    setEditingTaskId(task.id);
    setDraftText(
      typeof task.input.request === "string" ? task.input.request : "",
    );
    setInputJson(formatTaskInputJsonForEdit(task.input));
    setPermissionPolicy(task.permissions);
    setForm({
      name: task.name,
      skillName: task.skillName,
      enabled: task.enabled,
      schedule: task.schedule,
      input: task.input,
      permissions: task.permissions,
    });
    setCreateDialogOpen(true);
    setCreateMenuOpen(false);
  }

  function handleCloseCreateDialog() {
    if (!isSubmittingCreateTask) {
      setCreateDialogOpen(false);
      setEditingTaskId(null);
    }
  }

  function handleCreateFromChat() {
    window.location.hash = "chat";
  }

  return (
    <section className="task-panel scheduled-tasks-panel">
      <div className="settings-header scheduled-tasks-heading">
        <div>
          <p className="kicker">自动任务</p>
          <h3>让 Zerox 按计划替你执行</h3>
          <p>
            用一句话交代要做什么、什么时候做；权限和高级输入在保存前再确认。
          </p>
        </div>
        <span className={`settings-state is-${status.kind}`}>
          {taskCountLabel}
        </span>
      </div>

      <div className="scheduled-tasks-shell">
        <section className="scheduled-task-grid" aria-label="已保存的定时任务">
          {tasks.length ? (
            tasks.map((task) => {
              const taskIsBusy =
                runningTaskId === task.id || updatingTaskId === task.id;

              return (
                <article
                  className={`scheduled-task-card ${
                    task.enabled ? "is-enabled" : "is-paused"
                  }`}
                  key={task.id}
                >
                  <div className="scheduled-task-card-header">
                    <div className="scheduled-task-title-block">
                      <div className="scheduled-task-title-line">
                        <span
                          className={`scheduled-task-status ${
                            task.enabled ? "is-enabled" : "is-paused"
                          }`}
                        >
                          {task.enabled ? "已启用" : "已暂停"}
                        </span>
                        <h4>{task.name}</h4>
                      </div>
                      <p>{summarizeTaskIntent(task)}</p>
                    </div>
                    <button
                      aria-label={`${task.enabled ? "暂停" : "恢复"}${task.name}`}
                      aria-pressed={task.enabled}
                      className={`scheduled-task-switch ${
                        task.enabled ? "is-on" : ""
                      }`}
                      disabled={taskIsBusy}
                      onClick={() =>
                        void handleSetTaskEnabled(task, !task.enabled)
                      }
                      type="button"
                    />
                  </div>

                  <dl className="scheduled-task-meta">
                    <div>
                      <dt>频率</dt>
                      <dd>{describeSchedule(task.schedule)}</dd>
                    </div>
                    <div>
                      <dt>下一次</dt>
                      <dd>{formatNextRun(task.nextRunAt)}</dd>
                    </div>
                  </dl>

                  <div className="scheduled-task-card-actions">
                    <button
                      className="secondary-action"
                      onClick={() => navigateToHash("runs")}
                      type="button"
                    >
                      查看记录
                    </button>
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
                    <details className="scheduled-task-more">
                      <summary>更多</summary>
                      <div>
                        <p>{summarizePermissions(task.permissions)}</p>
                        <ToolSafetySummaryCard
                          summary={buildToolSafetySummary(task.permissions)}
                        />
                        <button
                          className="secondary-action"
                          disabled={taskIsBusy}
                          onClick={() => handleOpenEditDialog(task)}
                          type="button"
                        >
                          编辑
                        </button>
                        <button
                          className="secondary-action"
                          disabled={taskIsBusy}
                          onClick={() =>
                            void handleSetTaskEnabled(task, !task.enabled)
                          }
                          type="button"
                        >
                          {task.enabled ? "暂停" : "恢复"}
                        </button>
                        <button
                          className="danger-action"
                          disabled={taskIsBusy}
                          onClick={() => void handleDeleteTask(task)}
                          type="button"
                        >
                          删除
                        </button>
                      </div>
                    </details>
                  </div>
                </article>
              );
            })
          ) : (
            <div className="scheduled-task-empty-state">
              <div>
                <h4>还没有自动任务</h4>
                <p>创建一个任务后，Zerox 会按计划在本地调度器里执行。</p>
              </div>
              <button
                className="primary-action"
                onClick={handleOpenCreateDialog}
                type="button"
              >
                新建任务
              </button>
            </div>
          )}
        </section>

        <aside className={`scheduled-task-create ${createMenuOpen ? "is-open" : ""}`}>
          <button
            className="primary-action"
            onClick={() => setCreateMenuOpen((open) => !open)}
            type="button"
          >
            新建任务
          </button>
          <div className="scheduled-task-create-menu" aria-label="新建任务菜单">
            <button onClick={handleOpenCreateDialog} type="button">
              <Icon name="edit" size={16} />
              <span>手动创建</span>
            </button>
            <button onClick={handleCreateFromChat} type="button">
              <Icon name="chat" size={16} />
              <span>从会话生成</span>
            </button>
          </div>
        </aside>
      </div>

      <p className={`settings-message is-${status.kind}`}>
        {status.message}
        {runs.length ? ` 最近有 ${runs.length} 条运行记录。` : ""}
      </p>

      {createDialogOpen ? (
        <div
          className="scheduled-task-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              handleCloseCreateDialog();
            }
          }}
        >
          <section
            aria-label={editingTaskId ? "编辑任务" : "新建任务"}
            aria-modal="true"
            className="scheduled-task-dialog"
            ref={createDialogRef}
            role="dialog"
          >
            <header className="scheduled-task-dialog-header">
              <div>
                <h2 ref={createDialogHeadingRef} tabIndex={-1}>
                  {editingTaskId ? "编辑任务" : "新建任务"}
                </h2>
                <p>
                  {editingTaskId
                    ? "调整任务目标、执行时间和权限，保存后从下一次调度生效。"
                    : "描述任务目标和执行时间，Zerox 会按计划自动执行。"}
                </p>
              </div>
              <button
                aria-label="关闭"
                className="secondary-action scheduled-task-dialog-close"
                disabled={isSubmittingCreateTask}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  handleCloseCreateDialog();
                }}
                onMouseDown={(event) => {
                  event.stopPropagation();
                }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                }}
                type="button"
              >
                ×
              </button>
            </header>

            <form className="scheduled-task-form" onSubmit={handleSubmit}>
              <label className="field">
                <span>
                  任务名称 <em>必填</em>
                </span>
                <input
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.currentTarget.value })
                  }
                  placeholder="例如：尾盘选股策略检查"
                />
                {errors.name ? <small>{errors.name}</small> : null}
              </label>

              <label className="field">
                <span>
                  任务描述 <em>必填</em>
                </span>
                <textarea
                  onChange={(event) => setDraftText(event.currentTarget.value)}
                  placeholder="写清楚要做什么、用什么方式或资料、结果放在哪里、什么情况跳过。"
                  value={draftText}
                />
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
                    <option value="daily">每天</option>
                    <option value="weekdays">工作日</option>
                    <option value="weekly">每周</option>
                    <option value="interval">间隔</option>
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
                    从说明生成时间 <em>选填</em>
                  </span>
                  <input
                    value={scheduleDraftText}
                    onChange={(event) =>
                      setScheduleDraftText(event.currentTarget.value)
                    }
                    placeholder="例如：每天 14:35"
                  />
                </label>
                <button
                  className="secondary-action"
                  onClick={handleDraftSchedule}
                  type="button"
                >
                  生成
                </button>
              </div>

              <details className="scheduled-task-advanced">
                <summary>高级输入与权限</summary>
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
                  <div className="field-grid">
                    <label className="field checkbox-field">
                      <input
                        checked={Boolean(permissionPolicy.memory?.read)}
                        onChange={(event) =>
                          setPermissionPolicy({
                            ...permissionPolicy,
                            memory: {
                              read: event.currentTarget.checked,
                              write: Boolean(permissionPolicy.memory?.write),
                            },
                          })
                        }
                        type="checkbox"
                      />
                      <span>允许读取本地记忆</span>
                    </label>
                    <label className="field checkbox-field">
                      <input
                        checked={Boolean(permissionPolicy.memory?.write)}
                        onChange={(event) =>
                          setPermissionPolicy({
                            ...permissionPolicy,
                            memory: {
                              read: Boolean(permissionPolicy.memory?.read),
                              write: event.currentTarget.checked,
                            },
                          })
                        }
                        type="checkbox"
                      />
                      <span>允许写入本地记忆</span>
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
              </details>

              <p className="scheduled-task-dialog-note">
                保存后任务会按计划自动运行。请确认描述、模型、工具、文件和记忆权限足够明确；不确定或权限不足时，Zerox 应停止并写入运行记录。
              </p>

              {createStatus.message ? (
                <p
                  className={`settings-message scheduled-task-dialog-message is-${createStatus.kind}`}
                  role={createStatus.kind === "error" ? "alert" : "status"}
                >
                  {createStatus.message}
                </p>
              ) : null}

              <div className="scheduled-task-dialog-actions">
                <button
                  className="secondary-action"
                  disabled={isSubmittingCreateTask}
                  onClick={handleCloseCreateDialog}
                  type="button"
                >
                  取消
                </button>
                <button
                  className="primary-action"
                  disabled={isSubmittingCreateTask}
                  type="submit"
                >
                  {editingTaskId ? "保存修改" : "保存任务"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
      {pendingDeleteTask ? (
        <ConfirmDialog
          confirmLabel="删除"
          message={`删除“${pendingDeleteTask.name}”？这不会删除已有运行日志。`}
          onCancel={() => setPendingDeleteTask(null)}
          onConfirm={async () => {
            const task = pendingDeleteTask;
            setPendingDeleteTask(null);
            await performDeleteTask(task);
          }}
          title="删除自动任务"
          variant="danger"
        />
      ) : null}
    </section>
  );
}

function mergeDraftRequestIntoTaskInput(
  input: Record<string, unknown>,
  draftText: string,
): Record<string, unknown> {
  const request = draftText.trim();

  if (!request) {
    return input;
  }

  return {
    ...input,
    request,
  };
}

function formatTaskInputJsonForEdit(input: Record<string, unknown>): string {
  const editableInput = { ...input };
  if (typeof editableInput.request === "string") {
    delete editableInput.request;
  }

  return JSON.stringify(editableInput, null, 2);
}

function summarizeTaskIntent(task: ScheduledTask): string {
  const request = task.input.request;

  if (typeof request === "string" && request.trim()) {
    return request.trim();
  }

  const targetDir = task.input.targetDir;

  if (typeof targetDir === "string" && targetDir.trim()) {
    return `处理 ${targetDir.trim()}，并按任务配置保存执行结果。`;
  }

  if (task.skillName.trim()) {
    return `使用 ${task.skillName} 执行本地任务，运行前会遵守已配置的权限范围。`;
  }

  return "根据任务描述自动规划并执行；运行前会遵守已配置的权限范围。";
}

function navigateToHash(sectionId: "runs" | "chat"): void {
  window.location.hash = sectionId;
}

function ScheduleFields(props: {
  schedule: TaskSchedule;
  onChange: (schedule: TaskSchedule) => void;
}) {
  switch (props.schedule.kind) {
    case "manual":
      return (
        <label className="field">
          <span>
            执行时间 <em>历史任务</em>
          </span>
          <div className="schedule-placeholder">手动任务</div>
        </label>
      );
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
    case "weekdays":
      return (
        <label className="field">
          <span>
            时间 <em>HH:mm</em>
          </span>
          <input
            onChange={(event) =>
              props.onChange({
                kind: "weekdays",
                time: event.currentTarget.value,
              })
            }
            type="time"
            value={props.schedule.time}
          />
        </label>
      );
    case "weekly": {
      const schedule = props.schedule;

      return (
        <div className="weekly-fields">
          <label className="field">
            <span>
              星期 <em>必填</em>
            </span>
            <select
              onChange={(event) =>
                props.onChange({
                  kind: "weekly",
                  weekday: Number(event.currentTarget.value),
                  time: schedule.time,
                })
              }
              value={schedule.weekday}
            >
              <option value={1}>周一</option>
              <option value={2}>周二</option>
              <option value={3}>周三</option>
              <option value={4}>周四</option>
              <option value={5}>周五</option>
              <option value={6}>周六</option>
              <option value={7}>周日</option>
            </select>
          </label>
          <label className="field">
            <span>
              时间 <em>HH:mm</em>
            </span>
            <input
              onChange={(event) =>
                props.onChange({
                  kind: "weekly",
                  weekday: schedule.weekday,
                  time: event.currentTarget.value,
                })
              }
              type="time"
              value={schedule.time}
            />
          </label>
        </div>
      );
    }
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
    case "weekdays":
      return { kind: "weekdays", time: "09:00" };
    case "weekly":
      return { kind: "weekly", weekday: 1, time: "09:00" };
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
  const memoryCount =
    (policy.memory?.read ? 1 : 0) + (policy.memory?.write ? 1 : 0);

  return `${fileCount} 个文件权限 / ${memoryCount} 个记忆权限 / ${webCount} 个网页权限 / ${shellCount} 个命令权限`;
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
