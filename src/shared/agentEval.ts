export type AgentEvalReport = {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  toolSuccessRate: number;
  recoverabilityRate: number;
  failures: Array<{ fixtureId: string; reason: string }>;
};
