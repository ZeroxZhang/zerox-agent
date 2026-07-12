// ToolWorker / ShellAnalyzer flag options (contracts v1.4 §3.4, Patch 7).

import { readFeatureFlags } from "../../shared/featureFlags";

export type ToolWorkerMode = "inproc" | "subprocess";
export type ShellAnalyzerMode = "legacy" | "plan";

export interface ToolWorkerOptions {
  worker: ToolWorkerMode;
  shellAnalyzer: ShellAnalyzerMode;
}

export function getToolWorkerOptions(
  env: NodeJS.ProcessEnv = process.env,
): ToolWorkerOptions {
  const flags = readFeatureFlags(env);
  return {
    worker: flags.ZEROX_TOOL_WORKER,
    shellAnalyzer: flags.ZEROX_SHELL_ANALYZER,
  };
}
