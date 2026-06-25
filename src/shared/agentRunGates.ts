import type { StopDecision } from "./kernelContract";

export type RunGateTask = {
  id: string;
  status: string;
  summary: string;
};

export type RunStopGateInput = {
  incompleteTasks?: RunGateTask[];
  goalJudge?: StopDecision;
};

export type RunStopGateDecision =
  | {
      shouldStop: true;
      gate: "none";
      eventType: "task_gate_checked" | "goal_judged";
      reminder?: undefined;
      evidence: string[];
    }
  | {
      shouldStop: false;
      gate: "task" | "goal";
      eventType: "task_gate_checked" | "goal_judged";
      reminder: string;
      evidence: string[];
    };

export function evaluateRunStopGates(
  input: RunStopGateInput,
): RunStopGateDecision {
  const actionableTasks = (input.incompleteTasks ?? []).filter(
    (task) =>
      task.status !== "completed" &&
      task.status !== "canceled" &&
      task.status !== "blocked",
  );
  if (actionableTasks.length > 0) {
    const taskList = actionableTasks
      .map((task) => `${task.summary || task.id}（${task.status}）`)
      .join("、");
    return {
      shouldStop: false,
      gate: "task",
      eventType: "task_gate_checked",
      reminder: `仍有 ${actionableTasks.length} 个可执行任务未完成：${taskList}。请继续执行，或明确标记 blocked/canceled。`,
      evidence: actionableTasks.map((task) => `task:${task.id}`),
    };
  }

  if (input.goalJudge && input.goalJudge.stop === false) {
    const missing = input.goalJudge.missing ?? [];
    return {
      shouldStop: false,
      gate: "goal",
      eventType: "goal_judged",
      reminder: [
        `目标验收尚未满足：${input.goalJudge.reason}。`,
        missing.length ? `缺失证据：${missing.join("、")}。` : "",
        "请继续收集证据或说明无法完成。",
      ].join(""),
      evidence: missing.map((item) => `missing:${item}`),
    };
  }

  return {
    shouldStop: true,
    gate: "none",
    eventType: input.goalJudge ? "goal_judged" : "task_gate_checked",
    evidence:
      input.goalJudge && "evidence" in input.goalJudge
        ? input.goalJudge.evidence ?? []
        : [],
  };
}
