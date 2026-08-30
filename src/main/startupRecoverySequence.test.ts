import { describe, expect, it, vi } from "vitest";
import { runStartupRecoverySequence } from "./startupRecoverySequence";

describe("startup recovery sequence", () => {
  it("settles durable owners in the required order before runtime admission", async () => {
    const calls: string[] = [];
    const operation = (name: string) => async () => {
      calls.push(name);
    };

    await expect(runStartupRecoverySequence({
      initializeStorageConvergence: operation("storage"),
      reconcileRequiredConversationSettlements: operation("settlements"),
      reconcileAgentRunAdmissions: operation("agent-runs"),
      interruptPriorProcessApprovals: operation("approvals"),
      interruptActiveCausalAttempts: operation("attempts"),
    })).resolves.toEqual({
      completedStages: [
        "storage_convergence",
        "conversation_settlement_reconciliation",
        "agent_run_admission_reconciliation",
        "approval_interruption",
        "causal_attempt_interruption",
      ],
    });
    expect(calls).toEqual([
      "storage",
      "settlements",
      "agent-runs",
      "approvals",
      "attempts",
    ]);
  });

  it("fails startup without admitting later owners when reconciliation fails", async () => {
    const laterStage = vi.fn(async () => undefined);
    await expect(runStartupRecoverySequence({
      initializeStorageConvergence: async () => undefined,
      reconcileRequiredConversationSettlements: async () => {
        throw new Error("required settlement authority unavailable");
      },
      reconcileAgentRunAdmissions: laterStage,
      interruptPriorProcessApprovals: laterStage,
      interruptActiveCausalAttempts: laterStage,
    })).rejects.toThrow("required settlement authority unavailable");
    expect(laterStage).not.toHaveBeenCalled();
  });
});
