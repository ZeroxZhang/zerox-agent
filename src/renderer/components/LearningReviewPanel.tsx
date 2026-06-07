import { useEffect, useState } from "react";
import type {
  AgentLearningCandidate,
  ApplyAcceptedLearningReport,
} from "../../shared/agentLearning";

type LearningStatus =
  | { kind: "idle"; message: string }
  | { kind: "loading"; message: string }
  | { kind: "error"; message: string };

export function LearningReviewPanel() {
  const [candidates, setCandidates] = useState<AgentLearningCandidate[]>([]);
  const [status, setStatus] = useState<LearningStatus>({
    kind: "loading",
    message: "正在加载学习候选...",
  });
  const [lastApplyReport, setLastApplyReport] =
    useState<ApplyAcceptedLearningReport | null>(null);

  useEffect(() => {
    void loadCandidates();
  }, []);

  async function loadCandidates() {
    if (!window.buildingAgent) {
      setCandidates([]);
      setStatus({
        kind: "idle",
        message: "浏览器预览模式暂无学习候选。",
      });
      return;
    }

    setStatus({ kind: "loading", message: "正在加载学习候选..." });
    try {
      const loaded = await window.buildingAgent.listLearningCandidates();
      setCandidates(loaded);
      setStatus({
        kind: "idle",
        message: loaded.length ? "学习候选已加载。" : "暂无待审核学习候选。",
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error ? error.message : "无法加载学习候选。",
      });
    }
  }

  async function setCandidateStatus(
    candidate: AgentLearningCandidate,
    action: "accept" | "reject",
  ) {
    if (!window.buildingAgent) return;

    setStatus({ kind: "loading", message: "正在更新候选状态..." });
    const updated =
      action === "accept"
        ? await window.buildingAgent.acceptLearningCandidate(candidate.id)
        : await window.buildingAgent.rejectLearningCandidate(candidate.id);

    if (!updated) {
      setStatus({ kind: "error", message: "候选不存在或已被更新。" });
      return;
    }

    setCandidates((current) =>
      current.map((item) => (item.id === updated.id ? updated : item)),
    );
    setStatus({ kind: "idle", message: "候选状态已更新。" });
  }

  async function applyAccepted() {
    if (!window.buildingAgent) return;

    setStatus({ kind: "loading", message: "正在应用已接受学习..." });
    const report = await window.buildingAgent.applyAcceptedLearning();
    setLastApplyReport(report);
    await loadCandidates();
    setStatus({
      kind: "idle",
      message: `已应用 ${report.applied} 条学习候选。`,
    });
  }

  const pending = candidates.filter(
    (candidate) => candidate.status === "pending_review",
  );
  const accepted = candidates.filter(
    (candidate) => candidate.status === "accepted",
  );

  return (
    <section className="memory-panel">
      <div className="panel-heading">
        <div>
          <h2>学习审核</h2>
          <p>从运行轨迹沉淀流程记忆、失败教训和技能改进建议。</p>
        </div>
        <button
          className="primary-action"
          disabled={!accepted.length || status.kind === "loading"}
          onClick={() => void applyAccepted()}
          type="button"
        >
          应用已接受
        </button>
      </div>

      <div className="memory-grid">
        {[...pending, ...accepted, ...candidates.filter((candidate) =>
          candidate.status !== "pending_review" && candidate.status !== "accepted"
        )].map((candidate) => (
          <article className="memory-card" key={candidate.id}>
            <div className="memory-card-heading">
              <span>{translateCandidateType(candidate.type)}</span>
              <strong>{translateCandidateStatus(candidate.status)}</strong>
            </div>
            <h3>{candidate.claim}</h3>
            <p>{candidate.recommendedAction}</p>
            <dl className="inspector-dl">
              <div>
                <dt>来源</dt>
                <dd>{candidate.sourceRunId}</dd>
              </div>
              <div>
                <dt>风险</dt>
                <dd>{candidate.risk}</dd>
              </div>
            </dl>
            {candidate.status === "pending_review" ? (
              <div className="button-row">
                <button
                  className="secondary-action"
                  disabled={status.kind === "loading"}
                  onClick={() => void setCandidateStatus(candidate, "reject")}
                  type="button"
                >
                  拒绝
                </button>
                <button
                  className="primary-action"
                  disabled={status.kind === "loading"}
                  onClick={() => void setCandidateStatus(candidate, "accept")}
                  type="button"
                >
                  接受
                </button>
              </div>
            ) : null}
          </article>
        ))}
      </div>

      {!candidates.length ? (
        <div className="empty-state">暂无学习候选。</div>
      ) : null}

      {lastApplyReport ? (
        <p className="settings-message is-idle">
          扫描 {lastApplyReport.scanned} 条，应用 {lastApplyReport.applied} 条。
        </p>
      ) : null}
      <p className={`settings-message is-${status.kind}`}>{status.message}</p>
    </section>
  );
}

function translateCandidateType(type: AgentLearningCandidate["type"]): string {
  if (type === "procedural_memory") return "流程记忆";
  if (type === "failure_lesson") return "失败教训";
  return "技能改进";
}

function translateCandidateStatus(
  status: AgentLearningCandidate["status"],
): string {
  if (status === "pending_review") return "待审核";
  if (status === "accepted") return "已接受";
  if (status === "applied") return "已应用";
  return "已拒绝";
}
