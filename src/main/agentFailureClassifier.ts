import type { AgentFailureClass } from "../shared/agentExecution";

export function classifyAgentFailure(error: unknown): AgentFailureClass {
  const message = formatFailureMessage(error);

  if (!message) return "unknown";
  if (/permission|unauthori[sz]ed|未授权|拒绝授权|denied|被拒绝/i.test(message)) {
    return "permission_denied";
  }
  if (/json|parse|解析|invalid model output|模型输出/i.test(message)) {
    return "invalid_model_output";
  }
  if (/timeout|timed out|超时/i.test(message)) {
    return "timeout";
  }
  if (/abort|cancel|canceled|cancelled|取消/i.test(message)) {
    return "canceled";
  }
  if (/tool|工具/i.test(message)) {
    return "tool_error";
  }
  if (/model|llm|api/i.test(message)) {
    return "model_error";
  }

  return "unknown";
}

function formatFailureMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error ?? "").trim();
}
