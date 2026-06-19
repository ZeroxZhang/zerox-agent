// ToolWorker / ShellAnalyzer flag options (contracts v1.4 §3.4, Patch 7).

export type ToolWorkerMode = "inproc" | "subprocess";
export type ShellAnalyzerMode = "legacy" | "shadow" | "plan";

export interface ToolWorkerOptions {
  worker: ToolWorkerMode;
  shellAnalyzer: ShellAnalyzerMode;
}

export function getToolWorkerOptions(
  env: NodeJS.ProcessEnv = process.env,
): ToolWorkerOptions {
  return {
    worker: resolveWorker(env),
    shellAnalyzer: resolveShellAnalyzer(env),
  };
}

function resolveWorker(env: NodeJS.ProcessEnv): ToolWorkerMode {
  const raw = (env.ZEROX_TOOL_WORKER ?? env.BUILDING_AGENT_TOOL_WORKER ?? "").toLowerCase();
  return raw === "inproc" ? "inproc" : "subprocess"; // default subprocess (contract §3.4)
}

function resolveShellAnalyzer(env: NodeJS.ProcessEnv): ShellAnalyzerMode {
  const raw = (env.ZEROX_SHELL_ANALYZER ?? "").toLowerCase();
  if (raw === "legacy") return "legacy";
  if (raw === "plan") return "plan";
  return "shadow"; // default shadow (dual-run, gate on legacy) per spec G4
}
