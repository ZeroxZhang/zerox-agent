// v3.6.0: Central feature flag registry (S2-33, ARCH-04).
//
// All environment-variable-driven feature flags are declared here with their
// type, default value, and documentation. Individual modules import from this
// file instead of reading process.env directly. This replaces the 11 scattered
// flag definitions that existed prior to v3.6.0.
//
// New flags MUST be added here; reading process.env for feature toggles
// outside this module is a lint error.

// ── Flag definitions ────────────────────────────────────────────────────────

export interface FeatureFlags {
  /** Actor runtime mode: "full" (default), "v0", or "legacy". */
  ZEROX_ACTOR_RUNTIME: "full" | "v0" | "legacy";
  /** Workflow runtime: "on" (default) or "off". */
  ZEROX_WORKFLOW_RUNTIME: "on" | "off";
  /** Tool worker isolation: "process" (default) or "inline". */
  ZEROX_TOOL_WORKER: "process" | "inline";
  /** Shell analyzer mode: "modern" (default) or "legacy" (regex fallback). */
  ZEROX_SHELL_ANALYZER: "modern" | "legacy";
  /** Checkpoint writer mode: "on" (default) or "off". */
  ZEROX_CHECKPOINT_WRITER: "on" | "off";
  /** Storage backend: "dual" (default), "sqlite", or "json". */
  ZEROX_STORAGE_BACKEND: "dual" | "sqlite" | "json";
  /** Self-improvement / dream-distill background loop: "off" (default) or "on". */
  ZEROX_SELF_IMPROVEMENT: "on" | "off";
  /** Max-mode (best-of-N reasoning): "off" (default) or "on". */
  ZEROX_MAX_MODE: "on" | "off";
  /** Compaction strategy: "auto" (default), "rebuild", or "summarize". */
  ZEROX_COMPACTION_STRATEGY: "auto" | "rebuild" | "summarize";
  /** Multi-segment system prompt for Claude extended thinking: "0" (default) or "1". */
  ZEROX_MULTI_SEGMENT_SYSTEM: "0" | "1";
  /** Override for user data directory path. */
  ZEROX_AGENT_USER_DATA_DIR: string;
}

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULTS: FeatureFlags = {
  ZEROX_ACTOR_RUNTIME: "full",
  ZEROX_WORKFLOW_RUNTIME: "on",
  ZEROX_TOOL_WORKER: "process",
  ZEROX_SHELL_ANALYZER: "modern",
  ZEROX_CHECKPOINT_WRITER: "on",
  ZEROX_STORAGE_BACKEND: "dual",
  ZEROX_SELF_IMPROVEMENT: "off",
  ZEROX_MAX_MODE: "off",
  ZEROX_COMPACTION_STRATEGY: "auto",
  ZEROX_MULTI_SEGMENT_SYSTEM: "0",
  ZEROX_AGENT_USER_DATA_DIR: "",
};

// ── Resolver ─────────────────────────────────────────────────────────────────

let cached: FeatureFlags | null = null;

export function readFeatureFlags(env: NodeJS.ProcessEnv = process.env): FeatureFlags {
  if (cached) return cached;

  cached = {
    ZEROX_ACTOR_RUNTIME: resolveEnum(
      env.ZEROX_ACTOR_RUNTIME,
      ["full", "v0", "legacy"],
      DEFAULTS.ZEROX_ACTOR_RUNTIME,
    ),
    ZEROX_WORKFLOW_RUNTIME: resolveEnum(
      env.ZEROX_WORKFLOW_RUNTIME,
      ["on", "off"],
      DEFAULTS.ZEROX_WORKFLOW_RUNTIME,
    ),
    ZEROX_TOOL_WORKER: resolveEnum(
      env.ZEROX_TOOL_WORKER ?? env.BUILDING_AGENT_TOOL_WORKER,
      ["process", "inline"],
      DEFAULTS.ZEROX_TOOL_WORKER,
    ),
    ZEROX_SHELL_ANALYZER: resolveEnum(
      env.ZEROX_SHELL_ANALYZER,
      ["modern", "legacy"],
      DEFAULTS.ZEROX_SHELL_ANALYZER,
    ),
    ZEROX_CHECKPOINT_WRITER: resolveEnum(
      env.ZEROX_CHECKPOINT_WRITER,
      ["on", "off"],
      DEFAULTS.ZEROX_CHECKPOINT_WRITER,
    ),
    ZEROX_STORAGE_BACKEND: resolveEnum(
      env.ZEROX_STORAGE_BACKEND,
      ["dual", "sqlite", "json"],
      DEFAULTS.ZEROX_STORAGE_BACKEND,
    ),
    ZEROX_SELF_IMPROVEMENT: resolveEnum(
      env.ZEROX_SELF_IMPROVEMENT,
      ["on", "off"],
      DEFAULTS.ZEROX_SELF_IMPROVEMENT,
    ),
    ZEROX_MAX_MODE: resolveEnum(
      env.ZEROX_MAX_MODE,
      ["on", "off"],
      DEFAULTS.ZEROX_MAX_MODE,
    ),
    ZEROX_COMPACTION_STRATEGY: resolveEnum(
      env.ZEROX_COMPACTION_STRATEGY,
      ["auto", "rebuild", "summarize"],
      DEFAULTS.ZEROX_COMPACTION_STRATEGY,
    ),
    ZEROX_MULTI_SEGMENT_SYSTEM: resolveEnum(
      env.ZEROX_MULTI_SEGMENT_SYSTEM,
      ["0", "1"],
      DEFAULTS.ZEROX_MULTI_SEGMENT_SYSTEM,
    ) as "0" | "1",
    ZEROX_AGENT_USER_DATA_DIR:
      (env.ZEROX_AGENT_USER_DATA_DIR ?? env.BUILDING_AGENT_USER_DATA_DIR ?? "").trim(),
  };

  return cached;
}

/** Clear the cached flags so that environment changes take effect on next read. */
export function clearFeatureFlagsCache(): void {
  cached = null;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function resolveEnum<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  const normalized = (raw ?? "").toLowerCase() as T;
  if ((allowed as readonly string[]).includes(normalized)) {
    return normalized;
  }
  return fallback;
}
