export type AgentValidationModeOptions = {
  enabled: boolean;
  timeoutMs: number;
  apiInfoPath: string;
};

const defaultValidationTimeoutMs = 180_000;
const defaultApiInfoPath = ".api_info.md";

export function getAgentValidationModeOptions(
  env: Record<string, string | undefined>,
): AgentValidationModeOptions {
  const timeoutMs = Number(env.BUILDING_AGENT_VALIDATE_TIMEOUT_MS);
  const apiInfoPath = env.BUILDING_AGENT_API_INFO_PATH?.trim();

  return {
    enabled: env.BUILDING_AGENT_VALIDATE === "1",
    timeoutMs:
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? timeoutMs
        : defaultValidationTimeoutMs,
    apiInfoPath: apiInfoPath || defaultApiInfoPath,
  };
}
