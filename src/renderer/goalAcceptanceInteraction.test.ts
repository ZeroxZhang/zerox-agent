import { describe, expect, it } from "vitest";
import {
  createGoalAcceptanceOperationToken,
  createManualCompletionConfirmation,
  doesGoalAcceptanceOperationOwnPending,
  getConfirmedManualCompletionGoalId,
  isGoalAcceptanceResultForOperation,
  isGoalAcceptanceOperationCurrent,
  projectGoalAcceptanceOperationOutcome,
  type GoalAcceptanceUiContext,
} from "./goalAcceptanceInteraction";

describe("goal acceptance renderer interaction fences", () => {
  const contextA: GoalAcceptanceUiContext = {
    goalId: "goal_a",
    sessionId: "session_a",
    generation: 3,
  };

  it("binds manual completion confirmation to the exact goal context", () => {
    const confirmation = createManualCompletionConfirmation(contextA);

    expect(confirmation).toMatchObject({ goalId: "goal_a" });
    expect(getConfirmedManualCompletionGoalId(confirmation, contextA)).toBe(
      "goal_a",
    );
    expect(
      getConfirmedManualCompletionGoalId(confirmation, {
        ...contextA,
        goalId: "goal_b",
      }),
    ).toBeUndefined();
    expect(
      getConfirmedManualCompletionGoalId(confirmation, {
        ...contextA,
        sessionId: "session_b",
      }),
    ).toBeUndefined();
    expect(
      getConfirmedManualCompletionGoalId(confirmation, {
        ...contextA,
        generation: 4,
      }),
    ).toBeUndefined();
  });

  it("rejects a stale operation result after the active context changes", () => {
    const token = createGoalAcceptanceOperationToken(
      "continue_acceptance",
      contextA,
      "operation_1",
    )!;

    expect(isGoalAcceptanceOperationCurrent(token, contextA, token)).toBe(true);
    expect(
      isGoalAcceptanceOperationCurrent(
        token,
        { ...contextA, generation: 4 },
        token,
      ),
    ).toBe(false);
    expect(
      isGoalAcceptanceOperationCurrent(
        token,
        { ...contextA, sessionId: "session_b" },
        token,
      ),
    ).toBe(false);
  });

  it("does not let an old finally clear a newer operation", () => {
    const oldToken = createGoalAcceptanceOperationToken(
      "continue_acceptance",
      contextA,
      "operation_1",
    )!;
    const newToken = createGoalAcceptanceOperationToken(
      "mark_completed_unverified",
      { ...contextA, generation: 4 },
      "operation_2",
    )!;

    expect(doesGoalAcceptanceOperationOwnPending(oldToken, newToken)).toBe(false);
    expect(doesGoalAcceptanceOperationOwnPending(newToken, newToken)).toBe(true);
  });

  it("rejects a canonical result for a different goal or an invalid outcome", () => {
    const token = createGoalAcceptanceOperationToken(
      "continue_acceptance",
      contextA,
      "operation_3",
    )!;

    expect(
      isGoalAcceptanceResultForOperation(token, {
        id: "goal_a",
        status: "waiting_for_acceptance",
      }),
    ).toBe(true);
    expect(
      isGoalAcceptanceResultForOperation(token, {
        id: "goal_b",
        status: "waiting_for_acceptance",
      }),
    ).toBe(false);
    expect(
      isGoalAcceptanceResultForOperation(token, {
        id: "goal_a",
        status: "unknown_status",
      } as never),
    ).toBe(false);
  });

  it.each([
    ["achieved", "最终验收已通过", "已通过最终验收"],
    ["waiting_for_acceptance", "最终验收仍暂不可用", "进度已保留"],
    ["waiting_for_model", "等待模型服务恢复", "未继续"],
    ["canceled", "目标已取消", "未继续"],
    ["stopped_blocked", "目标当前受阻", "未继续"],
  ] as const)(
    "reports continue-acceptance %s outcomes truthfully",
    (status, statusFragment, assistantFragment) => {
      const token = createGoalAcceptanceOperationToken(
        "continue_acceptance",
        contextA,
        `continue_${status}`,
      )!;

      const outcome = projectGoalAcceptanceOperationOutcome(token, {
        id: "goal_a",
        status,
      });

      expect(outcome?.statusMessage).toContain(statusFragment);
      expect(outcome?.assistantMessage).toContain(assistantFragment);
      if (status === "canceled" || status === "stopped_blocked") {
        expect(outcome?.assistantMessage).not.toBe("已继续最终验收。");
      }
    },
  );

  it("only reports manual completion success for an attested completed-unverified result", () => {
    const token = createGoalAcceptanceOperationToken(
      "mark_completed_unverified",
      contextA,
      "manual_1",
    )!;
    const attestation = {
      version: 1 as const,
      goalId: "goal_a",
      completedAt: "2026-07-12T00:00:00.000Z",
      reason: "user_marked_complete" as const,
      failedCheckIds: [],
      evidenceRefs: [],
      evidenceFingerprint: "a".repeat(64),
      lastFailureCode: "judge_timeout",
      retryCycles: 1,
    };

    const applied = projectGoalAcceptanceOperationOutcome(token, {
      id: "goal_a",
      status: "completed_unverified",
      manualCompletionAttestation: attestation,
    });
    const missingAttestation = projectGoalAcceptanceOperationOutcome(token, {
      id: "goal_a",
      status: "completed_unverified",
    });
    const cancelWon = projectGoalAcceptanceOperationOutcome(token, {
      id: "goal_a",
      status: "canceled",
    });
    const achievementWon = projectGoalAcceptanceOperationOutcome(token, {
      id: "goal_a",
      status: "achieved",
    });

    expect(applied).toMatchObject({
      applied: true,
      statusMessage: "已手动完成 · 未经机器认证",
    });
    expect(missingAttestation).toMatchObject({ applied: false });
    expect(missingAttestation?.assistantMessage).toContain("记录不可确认");
    expect(cancelWon).toMatchObject({ applied: false });
    expect(cancelWon?.assistantMessage).toContain("目标已取消");
    expect(achievementWon).toMatchObject({ applied: false });
    expect(achievementWon?.assistantMessage).toContain("目标已通过机器验收");
  });
});
