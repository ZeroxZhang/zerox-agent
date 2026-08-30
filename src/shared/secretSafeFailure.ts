export type SecretSafeFailureCode =
  | "WORKSPACE_RUN_INITIALIZATION_FAILED"
  | "CROSS_DOMAIN_SETTLEMENT_FAILED"
  | "CHAT_SETTLEMENT_FAILED"
  | "WORKSPACE_SETTLEMENT_FAILED"
  | "SETTLEMENT_COMPENSATION_INCOMPLETE"
  | "AGENT_RUN_ADMISSION_FAILED"
  | "AGENT_RUN_EXECUTION_FAILED"
  | "INTERNAL_FAILURE"
  | "RUNTIME_CANCELED";

export type SecretSafeFailure = Readonly<{
  schemaVersion: 1;
  code: SecretSafeFailureCode;
  publicMessage: string;
  retryable: boolean;
  terminal: "failed" | "canceled";
  coverageReasonCodes: readonly string[];
}>;

const failureDefinitions: Record<
  SecretSafeFailureCode,
  Omit<SecretSafeFailure, "schemaVersion" | "code">
> = {
  WORKSPACE_RUN_INITIALIZATION_FAILED: {
    publicMessage: "工作区运行状态初始化失败，已安全停止本次任务。",
    retryable: true,
    terminal: "failed",
    coverageReasonCodes: ["workspace_run_initialize_failed"],
  },
  CROSS_DOMAIN_SETTLEMENT_FAILED: {
    publicMessage: "会话状态未能完成一致性结算，已安全停止本次任务。",
    retryable: true,
    terminal: "failed",
    coverageReasonCodes: ["cross_domain_settlement_failed"],
  },
  CHAT_SETTLEMENT_FAILED: {
    publicMessage: "会话状态持久化失败，已安全停止本次任务。",
    retryable: true,
    terminal: "failed",
    coverageReasonCodes: ["chat_settlement_failed"],
  },
  WORKSPACE_SETTLEMENT_FAILED: {
    publicMessage: "工作区状态持久化失败，已安全停止本次任务。",
    retryable: true,
    terminal: "failed",
    coverageReasonCodes: ["workspace_settlement_failed"],
  },
  SETTLEMENT_COMPENSATION_INCOMPLETE: {
    publicMessage: "会话失败状态未能完整持久化，请重新加载后重试。",
    retryable: true,
    terminal: "failed",
    coverageReasonCodes: ["settlement_compensation_incomplete"],
  },
  AGENT_RUN_ADMISSION_FAILED: {
    publicMessage: "任务运行未通过安全准入，未开始执行。",
    retryable: true,
    terminal: "failed",
    coverageReasonCodes: ["agent_run_admission_failed"],
  },
  AGENT_RUN_EXECUTION_FAILED: {
    publicMessage: "任务运行失败，已保留可审计的终态记录。",
    retryable: true,
    terminal: "failed",
    coverageReasonCodes: ["agent_run_execution_failed"],
  },
  INTERNAL_FAILURE: {
    publicMessage: "任务执行失败，已安全停止。",
    retryable: true,
    terminal: "failed",
    coverageReasonCodes: ["internal_failure"],
  },
  RUNTIME_CANCELED: {
    publicMessage: "已中断任务。",
    retryable: true,
    terminal: "canceled",
    coverageReasonCodes: ["runtime_canceled"],
  },
};

const privateCauses = new WeakMap<SecretSafeFailureError, unknown>();

export class SecretSafeFailureError extends Error {
  readonly failure: SecretSafeFailure;

  constructor(code: SecretSafeFailureCode, cause?: unknown) {
    const failure = createSecretSafeFailure(code);
    super(failure.publicMessage);
    this.name = "SecretSafeFailureError";
    this.failure = failure;
    if (cause !== undefined) privateCauses.set(this, cause);
  }
}

export function createSecretSafeFailure(
  code: SecretSafeFailureCode,
): SecretSafeFailure {
  const definition = failureDefinitions[code];
  return Object.freeze({
    schemaVersion: 1 as const,
    code,
    publicMessage: definition.publicMessage,
    retryable: definition.retryable,
    terminal: definition.terminal,
    coverageReasonCodes: Object.freeze([...definition.coverageReasonCodes]),
  });
}

export function toSecretSafeFailure(
  error: unknown,
  fallback: SecretSafeFailureCode = "INTERNAL_FAILURE",
): SecretSafeFailure {
  return error instanceof SecretSafeFailureError
    ? error.failure
    : createSecretSafeFailure(fallback);
}

/** For process-local diagnostics only; never serialize or publish this value. */
export function getSecretSafeFailurePrivateCause(
  error: SecretSafeFailureError,
): unknown {
  return privateCauses.get(error);
}
