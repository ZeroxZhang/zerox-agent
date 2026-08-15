import type { Goal, GoalStatus } from "../shared/agentGoal";

export type GoalAcceptanceUiContext = {
  goalId: string | null;
  sessionId: string | null;
  generation: number;
};

export type ManualCompletionConfirmation = {
  goalId: string;
  sessionId: string | null;
  generation: number;
};

export type GoalAcceptanceOperationKind =
  | "continue_acceptance"
  | "mark_completed_unverified";

export type GoalAcceptanceOperationToken = {
  operationId: string;
  kind: GoalAcceptanceOperationKind;
  goalId: string;
  sessionId: string | null;
  generation: number;
};

export type GoalAcceptanceOperationOutcome = {
  applied: boolean;
  statusMessage: string;
  assistantMessage: string;
};

type GoalAcceptanceOperationResult = Pick<
  Goal,
  "id" | "status" | "manualCompletionAttestation"
>;

const goalStatuses = new Set<GoalStatus>([
  "planning",
  "executing",
  "waiting_for_review",
  "waiting_for_acceptance",
  "waiting_for_model",
  "achieved",
  "completed_unverified",
  "stopped_budget",
  "stopped_stalled",
  "stopped_blocked",
  "failed",
  "canceled",
]);

export function createManualCompletionConfirmation(
  context: GoalAcceptanceUiContext,
): ManualCompletionConfirmation | null {
  if (!context.goalId) {
    return null;
  }
  return {
    goalId: context.goalId,
    sessionId: context.sessionId,
    generation: context.generation,
  };
}

export function getConfirmedManualCompletionGoalId(
  confirmation: ManualCompletionConfirmation | null,
  context: GoalAcceptanceUiContext,
): string | undefined {
  return confirmation && contextMatches(confirmation, context)
    ? confirmation.goalId
    : undefined;
}

export function createGoalAcceptanceOperationToken(
  kind: GoalAcceptanceOperationKind,
  context: GoalAcceptanceUiContext,
  operationId: string,
): GoalAcceptanceOperationToken | null {
  if (!context.goalId || !operationId) {
    return null;
  }
  return {
    operationId,
    kind,
    goalId: context.goalId,
    sessionId: context.sessionId,
    generation: context.generation,
  };
}

export function isGoalAcceptanceOperationCurrent(
  token: GoalAcceptanceOperationToken,
  context: GoalAcceptanceUiContext,
  currentToken: GoalAcceptanceOperationToken | null,
): boolean {
  return doesGoalAcceptanceOperationOwnPending(token, currentToken) &&
    contextMatches(token, context);
}

export function doesGoalAcceptanceOperationOwnPending(
  token: GoalAcceptanceOperationToken,
  currentToken: GoalAcceptanceOperationToken | null,
): boolean {
  return Boolean(
    currentToken &&
      currentToken.operationId === token.operationId &&
      currentToken.kind === token.kind &&
      currentToken.goalId === token.goalId &&
      currentToken.sessionId === token.sessionId &&
      currentToken.generation === token.generation,
  );
}

export function isGoalAcceptanceResultForOperation(
  token: GoalAcceptanceOperationToken,
  result: GoalAcceptanceOperationResult,
): boolean {
  return token.goalId === result.id && goalStatuses.has(result.status);
}

export function projectGoalAcceptanceOperationOutcome(
  token: GoalAcceptanceOperationToken,
  result: GoalAcceptanceOperationResult,
): GoalAcceptanceOperationOutcome | null {
  if (!isGoalAcceptanceResultForOperation(token, result)) {
    return null;
  }
  return token.kind === "continue_acceptance"
    ? projectContinueAcceptanceOutcome(result.status)
    : projectManualCompletionOutcome(result);
}

function projectContinueAcceptanceOutcome(
  status: GoalStatus,
): GoalAcceptanceOperationOutcome {
  switch (status) {
    case "achieved":
      return {
        applied: true,
        statusMessage: "最终验收已通过",
        assistantMessage: "目标已通过最终验收。",
      };
    case "waiting_for_acceptance":
      return {
        applied: true,
        statusMessage: "最终验收仍暂不可用，进度已保留",
        assistantMessage: "最终验收仍暂不可用；任务产物和当前进度已保留。",
      };
    case "executing":
      return {
        applied: true,
        statusMessage: "正在继续最终验收",
        assistantMessage: "已发起最终验收，正在等待结果。",
      };
    case "canceled":
      return {
        applied: false,
        statusMessage: "目标已取消，最终验收未继续",
        assistantMessage: "最终验收未继续：目标已取消。",
      };
    case "stopped_blocked":
      return {
        applied: false,
        statusMessage: "目标当前受阻，最终验收未继续",
        assistantMessage: "最终验收未继续：目标当前受阻。",
      };
    case "stopped_budget":
      return neutralContinueOutcome("旧版预算停止任务为只读");
    case "stopped_stalled":
      return neutralContinueOutcome("目标已因停滞停止");
    case "failed":
      return neutralContinueOutcome("目标已失败");
    case "completed_unverified":
      return neutralContinueOutcome("目标已被手动标记完成，未经机器认证");
    case "planning":
      return neutralContinueOutcome("目标仍在规划中");
    case "waiting_for_review":
      return neutralContinueOutcome("目标正在等待人工审核");
    case "waiting_for_model":
      return neutralContinueOutcome("目标正在等待模型服务恢复");
  }
}

function neutralContinueOutcome(state: string): GoalAcceptanceOperationOutcome {
  return {
    applied: false,
    statusMessage: `${state}，最终验收未继续`,
    assistantMessage: `最终验收未继续：${state}。`,
  };
}

function projectManualCompletionOutcome(
  result: GoalAcceptanceOperationResult,
): GoalAcceptanceOperationOutcome {
  const attestation = result.manualCompletionAttestation;
  if (
    result.status === "completed_unverified" &&
    attestation?.goalId === result.id &&
    attestation.reason === "user_marked_complete"
  ) {
    return {
      applied: true,
      statusMessage: "已手动完成 · 未经机器认证",
      assistantMessage:
        "已按你的确认手动标记完成；此状态未经机器认证，不会生成验收证书。",
    };
  }

  if (result.status === "completed_unverified") {
    return {
      applied: false,
      statusMessage: "手动完成记录不可确认",
      assistantMessage:
        "手动完成记录不可确认；系统不会声称操作成功，也不会生成验收证书。",
    };
  }

  const currentState = manualCompletionRaceState(result.status);
  return {
    applied: false,
    statusMessage: `手动完成未生效：${currentState}`,
    assistantMessage: `手动完成未生效；${currentState}。`,
  };
}

function manualCompletionRaceState(status: GoalStatus): string {
  switch (status) {
    case "achieved":
      return "目标已通过机器验收";
    case "canceled":
      return "目标已取消";
    case "waiting_for_acceptance":
      return "目标仍在等待最终验收";
    case "executing":
      return "目标仍在执行";
    case "stopped_blocked":
      return "目标当前受阻";
    case "stopped_budget":
      return "旧版预算停止任务为只读";
    case "stopped_stalled":
      return "目标已因停滞停止";
    case "failed":
      return "目标已失败";
    case "planning":
      return "目标仍在规划中";
    case "waiting_for_review":
      return "目标正在等待人工审核";
    case "waiting_for_model":
      return "目标正在等待模型服务恢复";
    case "completed_unverified":
      return "手动完成记录不可确认";
  }
}

function contextMatches(
  snapshot: Pick<
    GoalAcceptanceOperationToken | ManualCompletionConfirmation,
    "goalId" | "sessionId" | "generation"
  >,
  context: GoalAcceptanceUiContext,
): boolean {
  return snapshot.goalId === context.goalId &&
    snapshot.sessionId === context.sessionId &&
    snapshot.generation === context.generation;
}
