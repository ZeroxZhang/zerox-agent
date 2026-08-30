export type StartupRecoveryStage =
  | "storage_convergence"
  | "conversation_settlement_reconciliation"
  | "agent_run_admission_reconciliation"
  | "approval_interruption"
  | "causal_attempt_interruption";

export async function runStartupRecoverySequence(options: {
  initializeStorageConvergence(): Promise<unknown>;
  reconcileRequiredConversationSettlements(): Promise<unknown>;
  reconcileAgentRunAdmissions(): Promise<unknown>;
  interruptPriorProcessApprovals(): Promise<unknown>;
  interruptActiveCausalAttempts(): Promise<unknown>;
}): Promise<Readonly<{ completedStages: readonly StartupRecoveryStage[] }>> {
  const completedStages: StartupRecoveryStage[] = [];
  const run = async (
    stage: StartupRecoveryStage,
    operation: () => Promise<unknown>,
  ) => {
    await operation();
    completedStages.push(stage);
  };

  await run("storage_convergence", options.initializeStorageConvergence);
  await run(
    "conversation_settlement_reconciliation",
    options.reconcileRequiredConversationSettlements,
  );
  await run(
    "agent_run_admission_reconciliation",
    options.reconcileAgentRunAdmissions,
  );
  await run("approval_interruption", options.interruptPriorProcessApprovals);
  await run(
    "causal_attempt_interruption",
    options.interruptActiveCausalAttempts,
  );

  return Object.freeze({ completedStages: Object.freeze([...completedStages]) });
}
