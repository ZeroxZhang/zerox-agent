import { useEffect, useMemo, useState } from "react";
import type {
  AgentEvalCandidate,
  AgentEvalCandidateStatus,
} from "../../shared/agentEvalCandidate";

type EvalReviewStatus =
  | { kind: "idle"; message: string }
  | { kind: "loading"; message: string }
  | { kind: "error"; message: string };

const statusOrder: Record<AgentEvalCandidateStatus, number> = {
  pending_review: 0,
  accepted: 1,
  promoted: 2,
  rejected: 3,
};

export function EvalReviewPanel() {
  const [candidates, setCandidates] = useState<AgentEvalCandidate[]>([]);
  const [status, setStatus] = useState<EvalReviewStatus>({
    kind: "loading",
    message: "正在加载评测候选...",
  });

  useEffect(() => {
    void loadCandidates();
  }, []);

  const sortedCandidates = useMemo(
    () =>
      [...candidates].sort((left, right) => {
        const statusDelta = statusOrder[left.status] - statusOrder[right.status];
        if (statusDelta !== 0) {
          return statusDelta;
        }

        return right.updatedAt.localeCompare(left.updatedAt);
      }),
    [candidates],
  );

  async function loadCandidates() {
    if (!window.buildingAgent) {
      setCandidates([]);
      setStatus({
        kind: "idle",
        message: "浏览器预览模式暂无评测候选。",
      });
      return;
    }

    setStatus({ kind: "loading", message: "正在加载评测候选..." });
    try {
      const loaded = await window.buildingAgent.listEvalCandidates();
      setCandidates(loaded);
      setStatus({
        kind: "idle",
        message: loaded.length ? "评测候选已加载。" : "暂无待审核评测候选。",
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error ? error.message : "无法加载评测候选。",
      });
    }
  }

  async function setCandidateStatus(
    candidate: AgentEvalCandidate,
    action: "accept" | "reject",
  ) {
    if (!window.buildingAgent) {
      return;
    }

    setStatus({ kind: "loading", message: "正在更新评测候选..." });
    try {
      const updated =
        action === "accept"
          ? await window.buildingAgent.acceptEvalCandidate(candidate.id)
          : await window.buildingAgent.rejectEvalCandidate(candidate.id);

      if (!updated) {
        setStatus({ kind: "error", message: "候选不存在或已被更新。" });
        return;
      }

      upsertCandidate(updated);
      setStatus({
        kind: "idle",
        message: action === "accept" ? "评测候选已接受。" : "评测候选已拒绝。",
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error ? error.message : "无法更新评测候选。",
      });
    }
  }

  async function promoteCandidate(candidate: AgentEvalCandidate) {
    if (!window.buildingAgent) {
      return;
    }

    setStatus({ kind: "loading", message: "正在提升评测候选..." });
    try {
      const result = await window.buildingAgent.promoteEvalCandidate(
        candidate.id,
      );

      if (!result.ok) {
        setStatus({ kind: "error", message: result.message });
        return;
      }

      upsertCandidate(result.candidate);
      setStatus({
        kind: "idle",
        message: `已提升为固定评测：${result.fixtureId}。`,
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error ? error.message : "无法提升评测候选。",
      });
    }
  }

  function upsertCandidate(candidate: AgentEvalCandidate) {
    setCandidates((current) => {
      const exists = current.some((item) => item.id === candidate.id);
      if (!exists) {
        return [candidate, ...current];
      }

      return current.map((item) =>
        item.id === candidate.id ? candidate : item,
      );
    });
  }

  return (
    <section className="memory-panel">
      <div className="panel-heading">
        <div>
          <h2>评测审核</h2>
          <p>审核从运行轨迹生成的 fixture 候选，接受后提升为固定回归样例。</p>
        </div>
        <span className={`settings-state is-${status.kind}`}>
          {candidates.length} 个候选
        </span>
      </div>

      <div className="memory-grid">
        {sortedCandidates.map((candidate) => (
          <article className="memory-card" key={candidate.id}>
            <div className="memory-card-header">
              <span>{translateCandidateStatus(candidate.status)}</span>
              <strong>{candidate.fixture.id}</strong>
            </div>
            <h3>{candidate.fixture.description}</h3>
            <p>{candidate.rationale}</p>
            <dl className="inspector-dl">
              <div>
                <dt>状态</dt>
                <dd>{translateCandidateStatus(candidate.status)}</dd>
              </div>
              <div>
                <dt>来源运行</dt>
                <dd>{candidate.sourceRunId}</dd>
              </div>
              <div>
                <dt>必需事件</dt>
                <dd>{formatRequiredEventTypes(candidate)}</dd>
              </div>
              <div>
                <dt>断言</dt>
                <dd>{candidate.fixture.assertions?.length ?? 0} 条</dd>
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
            {candidate.status === "accepted" ? (
              <div className="button-row">
                <button
                  className="primary-action"
                  disabled={status.kind === "loading"}
                  onClick={() => void promoteCandidate(candidate)}
                  type="button"
                >
                  提升为固定评测
                </button>
              </div>
            ) : null}
          </article>
        ))}
      </div>

      {!candidates.length ? (
        <div className="empty-state">暂无评测候选。</div>
      ) : null}

      <p className={`settings-message is-${status.kind}`}>{status.message}</p>
    </section>
  );
}

function formatRequiredEventTypes(candidate: AgentEvalCandidate): string {
  return candidate.fixture.requiredEventTypes.length
    ? candidate.fixture.requiredEventTypes.join(", ")
    : "未记录";
}

function translateCandidateStatus(status: AgentEvalCandidateStatus): string {
  if (status === "pending_review") return "待审核";
  if (status === "accepted") return "已接受";
  if (status === "promoted") return "已提升";
  return "已拒绝";
}
