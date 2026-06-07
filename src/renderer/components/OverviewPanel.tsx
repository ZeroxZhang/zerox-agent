import { useEffect, useMemo, useState } from "react";
import { getRunGuidance } from "../../shared/agentRunInsights";
import {
  buildAgentReadinessChecklist,
  type AgentReadinessItem,
} from "../../shared/agentReadiness";
import { buildAgentDataBoundary } from "../../shared/dataBoundary";
import {
  buildAgentOnboardingState,
  type AgentOnboardingAction,
} from "../../shared/agentOnboarding";
import type { AgentRunRecord } from "../../shared/agentRuns";
import type {
  AgentBootstrapReport,
  AgentBootstrapStep,
  AgentBootstrapValidationReport,
  AgentBootstrapValidationSnapshot,
} from "../../shared/agentBootstrap";
import type { MemoryRecord } from "../../shared/memory";
import type { PublicModelSettings } from "../../shared/modelSettings";
import type { NavigationSectionId } from "../../shared/navigation";
import type { ScheduledTask } from "../../shared/scheduledTasks";
import {
  buildDesktopRuntimeInfo,
  type DesktopRuntimeInfo,
} from "../../shared/desktopRuntime";
import {
  createDemoValidationSnapshot,
  demoMemories,
  demoModelSettings,
  demoRuns,
  demoTasks,
} from "../demoAgentData";
import {
  clearPreviewValidationSnapshot,
  loadPreviewValidationSnapshot,
  savePreviewValidationSnapshot,
} from "../agentValidationPreviewStore";

type OverviewData = {
  memories: MemoryRecord[];
  modelSettings: PublicModelSettings;
  runs: AgentRunRecord[];
  skillCount: number;
  tasks: ScheduledTask[];
};

type AttentionItem = {
  action: string;
  target: NavigationSectionId;
  title: string;
  tone: "error" | "warn";
};

export function OverviewPanel(props: {
  onNavigate: (sectionId: NavigationSectionId) => void;
}) {
  const dataBoundary = buildAgentDataBoundary(
    window.buildingAgent ? "desktop" : "preview",
  );
  const [data, setData] = useState<OverviewData | null>(null);
  const [status, setStatus] = useState({
    kind: "loading",
    message: "正在加载指挥中心...",
  });
  const [bootstrapReport, setBootstrapReport] =
    useState<AgentBootstrapReport | AgentBootstrapValidationReport | null>(
      null,
    );
  const [lastValidationSnapshot, setLastValidationSnapshot] =
    useState<AgentBootstrapValidationSnapshot | null>(null);
  const [runtimeInfo, setRuntimeInfo] = useState<DesktopRuntimeInfo | null>(null);

  useEffect(() => {
    if (!window.buildingAgent) {
      setRuntimeInfo(
        buildDesktopRuntimeInfo({
          appPath: "浏览器预览",
          isPackaged: false,
          productName: "Zerox Agent",
          rendererMode: "development",
          userDataPath: "浏览器 localStorage / 桌面端为系统用户数据目录",
          version: "preview",
        }),
      );
      setData({
        memories: demoMemories,
        modelSettings: demoModelSettings,
        runs: demoRuns,
        skillCount: 1,
        tasks: demoTasks,
      });
      const snapshot = loadPreviewValidationSnapshot(window.localStorage);
      if (snapshot) {
        setLastValidationSnapshot(snapshot);
        setBootstrapReport(snapshot.report);
      }
      setStatus({
        kind: "idle",
        message: "浏览器预览模式，正在展示演示指挥中心。",
      });
      return;
    }

    Promise.all([
      window.buildingAgent.loadModelSettings(),
      window.buildingAgent.listScheduledTasks(),
      window.buildingAgent.listAgentRuns(),
      window.buildingAgent.listMemories({ limit: 100 }),
      window.buildingAgent.listSkills(),
      window.buildingAgent.loadAgentValidation(),
      window.buildingAgent.getRuntimeInfo(),
    ])
      .then(
        ([
          modelSettings,
          tasks,
          runs,
          memories,
          skills,
          validation,
          runtime,
        ]) => {
        setData({
          memories,
          modelSettings,
          runs,
          skillCount: skills.skills.length,
          tasks,
        });
        setRuntimeInfo(runtime);
        if (validation.ok && validation.snapshot) {
          setLastValidationSnapshot(validation.snapshot);
          setBootstrapReport(validation.snapshot.report);
        }
        setStatus({ kind: "idle", message: "指挥中心已加载。" });
      })
      .catch((error) => {
        setStatus({
          kind: "error",
          message:
            error instanceof Error
              ? error.message
              : "无法加载指挥中心。",
        });
      });
  }, []);

  const latestRun = data?.runs[0] ?? null;
  const attentionItems = useMemo(
    () => (data ? buildAttentionItems(data) : []),
    [data],
  );
  const readinessChecklist = useMemo(
    () =>
      data
        ? buildAgentReadinessChecklist({
            modelSettings: data.modelSettings,
            tasks: data.tasks,
            runs: data.runs,
            memories: data.memories,
            skillCount: data.skillCount,
            report:
              lastValidationSnapshot?.report ??
              (bootstrapReport && isValidationReport(bootstrapReport)
                ? bootstrapReport
                : undefined),
          })
        : null,
    [bootstrapReport, data, lastValidationSnapshot],
  );
  const onboardingState = useMemo(
    () =>
      readinessChecklist
        ? buildAgentOnboardingState(
            readinessChecklist,
            lastValidationSnapshot?.validatedAt,
          )
        : null,
    [lastValidationSnapshot, readinessChecklist],
  );

  return (
    <section className="overview-panel">
      <div className="command-hero">
        <div>
          <h2>指挥中心</h2>
          <p>把系统健康、最近运行和下一步动作放在同一个操作视图里。</p>
        </div>
        <div className="command-actions">
          <button
            className="secondary-action"
            onClick={() => props.onNavigate("chat")}
            type="button"
          >
            进入会话窗口
          </button>
          <button
            className="primary-action"
            disabled={status.kind === "loading"}
            onClick={() => void handlePrepareAgent()}
            type="button"
          >
            一键准备
          </button>
          <button
            className="primary-action"
            disabled={status.kind === "loading"}
            onClick={() => void handleValidateAgent()}
            type="button"
          >
            一键验收运行
          </button>
          <span className={`command-state ${attentionItems.length ? "is-warn" : "is-ready"}`}>
            {attentionItems.length ? `${attentionItems.length} 项待处理` : "已就绪"}
          </span>
        </div>
      </div>

      {onboardingState ? (
        <section
          className={`onboarding-banner is-${onboardingState.tone}`}
          aria-label="本地智能体下一步"
        >
          <div>
            <span>下一步</span>
            <h3>{onboardingState.title}</h3>
            <p>{onboardingState.message}</p>
          </div>
          <div className="onboarding-actions">
            <button
              className="primary-action"
              type="button"
              onClick={() => handleOnboardingAction(onboardingState.primaryAction)}
            >
              {onboardingState.primaryAction.label}
            </button>
            {onboardingState.secondaryAction ? (
              <button
                className="secondary-action"
                type="button"
                onClick={() =>
                  handleOnboardingAction(onboardingState.secondaryAction!)
                }
              >
                {onboardingState.secondaryAction.label}
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      <section
        className={`data-boundary-panel is-${dataBoundary.mode}`}
        aria-label="数据边界"
      >
        <div>
          <span>数据边界</span>
          <h3>{dataBoundary.title}</h3>
          <p>{dataBoundary.message}</p>
        </div>
        <div className="data-boundary-actions">
          <article>
            <strong>当前存储</strong>
            <span>{dataBoundary.storageLabel}</span>
          </article>
          {dataBoundary.canClearDemoData ? (
            <button
              className="secondary-action"
              type="button"
              onClick={handleClearPreviewData}
            >
              {dataBoundary.cleanupLabel}
            </button>
          ) : (
            <span className="data-boundary-note">
              {dataBoundary.cleanupLabel}
            </span>
          )}
        </div>
      </section>

      <div className="health-grid">
        <HealthCard
          label="模型"
          status={data?.modelSettings.chatModel ? "已就绪" : "缺失"}
          tone={data?.modelSettings.chatModel ? "good" : "bad"}
          value={data?.modelSettings.chatModel || "尚未配置"}
        />
        <HealthCard
          label="任务"
          status={`${data?.tasks.filter((task) => task.enabled).length ?? 0} 个启用`}
          tone={data?.tasks.length ? "good" : "warn"}
          value={`共 ${data?.tasks.length ?? 0} 个`}
        />
        <HealthCard
          label="运行"
          status={latestRun ? translateRunStatus(latestRun.status) : "空闲"}
          tone={latestRun?.status === "failed" ? "bad" : "good"}
          value={latestRun ? latestRun.taskName : "还没有运行"}
        />
        <HealthCard
          label="记忆"
          status={`${data?.memories.length ?? 0} 条`}
          tone={data?.memories.length ? "good" : "warn"}
          value="本地优先"
        />
      </div>

      {readinessChecklist ? (
        <section className="readiness-panel" aria-label="本地智能体正式可用检查">
          <div className="section-heading">
            <span>正式可用检查</span>
            <small>
              {readinessChecklist.completeCount}/{readinessChecklist.totalCount}
              {lastValidationSnapshot
                ? ` · 最近验收 ${formatDate(lastValidationSnapshot.validatedAt)}`
                : ""}
            </small>
          </div>
          <div className="readiness-progress" aria-hidden="true">
            <span
              style={{
                width: `${Math.round(
                  (readinessChecklist.completeCount /
                    readinessChecklist.totalCount) *
                    100,
                )}%`,
              }}
            />
          </div>
          <div className="readiness-list">
            {readinessChecklist.items.map((item) => (
              <article
                className={`readiness-item is-${item.status}`}
                key={item.id}
              >
                <div>
                  <strong>{item.label}</strong>
                  <span>{item.message}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleReadinessAction(item)}
                >
                  {item.actionLabel}
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <div className="overview-layout">
        <section className="latest-run-card">
          <div className="section-heading">
            <span>最近运行</span>
            <button
              className="secondary-action"
              onClick={() => props.onNavigate("runs")}
              type="button"
            >
              打开运行
            </button>
          </div>
          {latestRun ? (
            <>
              <span className={`run-status is-${latestRun.status}`}>
                {translateRunStatus(latestRun.status)}
              </span>
              <h3>{latestRun.taskName}</h3>
              <p>{latestRun.summary}</p>
              <dl className="inspector-dl">
                <div>
                  <dt>技能</dt>
                  <dd>{latestRun.skillName}</dd>
                </div>
                <div>
                  <dt>完成时间</dt>
                  <dd>{formatDate(latestRun.finishedAt)}</dd>
                </div>
              </dl>
            </>
          ) : (
            <div className="empty-state">还没有运行记录。</div>
          )}
        </section>

        <section className="attention-panel">
          <div className="section-heading">
            <span>需要处理</span>
            <small>{attentionItems.length} 项</small>
          </div>
          {attentionItems.length ? (
            attentionItems.map((item) => (
              <button
                className={`attention-item is-${item.tone}`}
                key={`${item.target}:${item.title}`}
                onClick={() => props.onNavigate(item.target)}
                type="button"
              >
                <strong>{item.title}</strong>
                <span>{item.action}</span>
              </button>
            ))
          ) : (
            <div className="empty-state">暂无待处理项。</div>
          )}
        </section>

        <section className="quick-actions">
          <div className="section-heading">
            <span>快捷入口</span>
            <small>操作流程</small>
          </div>
          {[
            ["settings", "配置模型"],
            ["scheduled-tasks", "创建或运行任务"],
            ["tools", "检查工具权限"],
            ["memory", "查看记忆"],
          ].map(([target, label]) => (
            <button
              className="quick-action"
              key={target}
              onClick={() => props.onNavigate(target as NavigationSectionId)}
              type="button"
            >
              {label}
            </button>
          ))}
        </section>
      </div>

      {runtimeInfo ? (
        <section className="runtime-panel" aria-label="本地数据与启动">
          <div className="section-heading">
            <span>本地数据与启动</span>
            <small>
              {runtimeInfo.rendererMode === "production" ? "生产模式" : "开发模式"}
            </small>
          </div>
          <div className="runtime-grid">
            <article>
              <strong>应用路径</strong>
              <span>{runtimeInfo.appPath}</span>
            </article>
            <article>
              <strong>用户数据</strong>
              <span>{runtimeInfo.userDataPath}</span>
            </article>
            <article>
              <strong>配置目录</strong>
              <span>{runtimeInfo.configDir}</span>
            </article>
          </div>
          <div className="runtime-files">
            {runtimeInfo.dataFiles.map((file) => (
              <article key={file.fileName}>
                <strong>{file.label}</strong>
                <span>{file.path}</span>
              </article>
            ))}
          </div>
          <div className="runtime-commands">
            {runtimeInfo.commands.map((command) => (
              <article key={command.command}>
                <strong>{command.label}</strong>
                <code>{command.command}</code>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {bootstrapReport ? (
        <section className="bootstrap-report" aria-label="本地智能体准备结果">
          <div className="section-heading">
            <span>{isValidationReport(bootstrapReport) ? "验收结果" : "准备结果"}</span>
            <small>
              {bootstrapReport.ready ? "可开始使用" : "仍需处理"}
              {lastValidationSnapshot && isValidationReport(bootstrapReport)
                ? ` · ${formatDate(lastValidationSnapshot.validatedAt)}`
                : ""}
            </small>
          </div>
          {toBootstrapSteps(bootstrapReport).map(([label, step]) => (
            <article
              className={`bootstrap-step ${
                step.ready
                  ? "is-ready"
                  : "is-blocked"
              }`}
              key={label}
            >
              <strong>{label}</strong>
              <span>{step.message}</span>
            </article>
          ))}
        </section>
      ) : null}

      <p className={`settings-message is-${status.kind}`}>{status.message}</p>
    </section>
  );

  async function handlePrepareAgent() {
    setStatus({ kind: "loading", message: "正在准备本地智能体..." });

    if (!window.buildingAgent) {
      const report: AgentBootstrapReport = {
        ready: true,
        model: { ready: true, message: "浏览器预览：模型配置已就绪。" },
        skill: { ready: true, message: "浏览器预览：内置文件整理技能已就绪。" },
        task: {
          ready: true,
          created: false,
          task: demoTasks[0] ?? null,
          message: "浏览器预览：默认文件整理任务已存在。",
        },
      };
      setBootstrapReport(report);
      setStatus({ kind: "idle", message: "浏览器预览模式，已展示准备结果。" });
      return;
    }

    const result = await window.buildingAgent.prepareAgent();

    if (!result.ok) {
      setStatus({ kind: "error", message: result.message });
      return;
    }

    setBootstrapReport(result.report);
    const [modelSettings, tasks, runs, memories, skills] = await Promise.all([
      window.buildingAgent.loadModelSettings(),
      window.buildingAgent.listScheduledTasks(),
      window.buildingAgent.listAgentRuns(),
      window.buildingAgent.listMemories({ limit: 100 }),
      window.buildingAgent.listSkills(),
    ]);
    setData({
      modelSettings,
      tasks,
      runs,
      memories,
      skillCount: skills.skills.length,
    });
    setStatus({
      kind: result.report.ready ? "idle" : "error",
      message: result.report.ready
        ? "本地智能体已准备好。"
        : "准备完成，但仍有项目需要处理。",
    });
  }

  async function handleValidateAgent() {
    setStatus({ kind: "loading", message: "正在验收运行本地智能体..." });

    if (!window.buildingAgent) {
      const snapshot = createDemoValidationSnapshot();
      const report = snapshot.report;
      savePreviewValidationSnapshot(window.localStorage, snapshot);
      setBootstrapReport(report);
      setLastValidationSnapshot(snapshot);
      setStatus({ kind: "idle", message: "浏览器预览模式，已展示验收结果。" });
      return;
    }

    const result = await window.buildingAgent.validateAgent();

    if (!result.ok) {
      setStatus({ kind: "error", message: result.message });
      return;
    }

    setBootstrapReport(result.report);
    setLastValidationSnapshot(result.snapshot);
    const [modelSettings, tasks, runs, memories, skills] = await Promise.all([
      window.buildingAgent.loadModelSettings(),
      window.buildingAgent.listScheduledTasks(),
      window.buildingAgent.listAgentRuns(),
      window.buildingAgent.listMemories({ limit: 100 }),
      window.buildingAgent.listSkills(),
    ]);
    setData({
      modelSettings,
      tasks,
      runs,
      memories,
      skillCount: skills.skills.length,
    });
    setStatus({
      kind: result.report.ready ? "idle" : "error",
      message: result.report.ready
        ? "本地智能体已完成验收运行。"
        : "验收运行结束，但仍有项目需要处理。",
    });
  }

  function handleReadinessAction(item: AgentReadinessItem) {
    if (item.id === "task" && item.status !== "ready") {
      void handlePrepareAgent();
      return;
    }

    if (
      (item.id === "connection" || item.id === "run") &&
      item.status !== "ready"
    ) {
      void handleValidateAgent();
      return;
    }

    props.onNavigate(item.target);
  }

  function handleOnboardingAction(action: AgentOnboardingAction) {
    if (action.command === "prepare") {
      void handlePrepareAgent();
      return;
    }

    if (action.command === "validate") {
      void handleValidateAgent();
      return;
    }

    props.onNavigate(action.target);
  }

  function handleClearPreviewData() {
    if (window.buildingAgent) {
      return;
    }

    clearPreviewValidationSnapshot(window.localStorage);
    setBootstrapReport(null);
    setLastValidationSnapshot(null);
    setStatus({
      kind: "idle",
      message: "预览验收数据已清理；静态演示数据仍仅用于界面说明。",
    });
  }
}

function HealthCard(props: {
  label: string;
  status: string;
  tone: "bad" | "good" | "warn";
  value: string;
}) {
  return (
    <article className={`health-card is-${props.tone}`}>
      <span>{props.label}</span>
      <strong>{props.status}</strong>
      <small>{props.value}</small>
    </article>
  );
}

function buildAttentionItems(data: OverviewData): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (!data.modelSettings.chatModel || !data.modelSettings.hasApiKey) {
      items.push({
      tone: "error",
      title: "模型配置不完整",
      action: "打开“设置”，保存对话模型和 API Key。",
      target: "settings",
    });
  }

  if (!data.tasks.length) {
    items.push({
      tone: "warn",
      title: "还没有任务",
      action: "创建一个定时或手动任务，让智能体能真正执行工作。",
      target: "scheduled-tasks",
    });
  }

  const latestFailedRun = data.runs.find((run) => run.status === "failed");
  if (latestFailedRun) {
    const guidance = getRunGuidance(latestFailedRun);
    items.push({
      tone: guidance.tone === "warn" ? "warn" : "error",
      title: guidance.title,
      action: guidance.action,
      target: "runs",
    });
  }

  return items;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
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

function isValidationReport(
  report: AgentBootstrapReport | AgentBootstrapValidationReport,
): report is AgentBootstrapValidationReport {
  return "connection" in report && "run" in report;
}

function toBootstrapSteps(
  report: AgentBootstrapReport | AgentBootstrapValidationReport,
): [string, AgentBootstrapStep][] {
  const steps: [string, AgentBootstrapStep][] = [
    ["模型", report.model],
    ["技能", report.skill],
    ["任务", report.task],
  ];

  if (isValidationReport(report)) {
    steps.push(["模型连接", report.connection], ["验收运行", report.run]);
  }

  return steps;
}
