import { describe, expect, it } from "vitest";
import {
  createGoalAcceptanceOperationToken,
  createManualCompletionConfirmation,
  doesGoalAcceptanceOperationOwnPending,
  getConfirmedManualCompletionGoalId,
  isGoalAcceptanceResultForOperation,
  isGoalAcceptanceOperationCurrent,
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

  it("rejects a canonical result for a different goal", () => {
    const token = createGoalAcceptanceOperationToken(
      "continue_acceptance",
      contextA,
      "operation_3",
    )!;

    expect(isGoalAcceptanceResultForOperation(token, "goal_a")).toBe(true);
    expect(isGoalAcceptanceResultForOperation(token, "goal_b")).toBe(false);
  });
});
