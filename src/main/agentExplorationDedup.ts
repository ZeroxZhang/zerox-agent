/**
 * Exploration dedup tracker.
 *
 * Observed in production trajectories (paper-to-mp replay, 2026-08-01):
 * long goal-mode runs re-read the same files and re-list the same
 * directories dozens of times — the runtime stayed healthy, but the model
 * burned turns and tokens rediscovering what it already knew. The existing
 * FRAGMENTED_TOOL_CALLS guard only fires on 4 consecutive same-tool calls
 * and the repeated-call finalizer only catches an immediately repeated
 * signature, so cross-turn duplicate exploration went unaddressed.
 *
 * This tracker records successful read-class tool calls per run. When the
 * model reads a target it has already successfully read (and no mutating
 * call has happened since), the loop injects a short dedup note so the
 * model reuses its existing evidence, and emits a REPEATED_EXPLORATION
 * strategy-guard event for trajectory/UI observability. It never blocks a
 * call: freshness-sensitive re-reads after writes stay legitimate because
 * any successful mutating call invalidates the recorded read state.
 */

export type ExplorationDedupCheck = {
  isDuplicate: boolean;
  /** number of prior successful reads of this exact target. */
  priorReads: number;
  /** turn of the first successful read. */
  firstTurn: number;
};

export type ExplorationDedupTracker = {
  /** Call before executing a read-class tool. */
  check(toolName: string, args: Record<string, unknown>, turn: number): ExplorationDedupCheck | null;
  /** Record a successful read-class result. */
  recordRead(toolName: string, args: Record<string, unknown>, turn: number): void;
  /** Record a successful mutating call; invalidates recorded reads. */
  recordMutation(toolName: string): void;
  /** Total duplicate reads observed in this run. */
  duplicateCount(): number;
};

const READ_CLASS_TOOLS = new Set([
  "file_read",
  "file_list",
  "file_search",
  "file_stat",
  "file_inventory",
  "code_search",
  "git_status",
  "git_diff",
  "tool_result_read",
  "skill_resource_list",
]);

const HARD_MUTATING_TOOLS = new Set([
  "file_write",
  "file_edit",
  "file_delete",
  "file_move",
  "file_append",
]);

/** shell_exec heuristics: commands that very likely mutate state. */
const SHELL_MUTATION_PATTERN =
  /(>>|>(?!\s*\&)|\bmv\b|\brm\b|\bcp\b|\bmkdir\b|\btouch\b|\bsed\s+-i\b|\bchmod\b|\bchown\b|\bln\b|\bgit\s+(add|commit|checkout|reset|restore|merge|rebase)\b|\bnpm\s+(install|run\s+build)\b|\bpip\s+install\b|\btee\b)/i;

export function isReadClassTool(toolName: string): boolean {
  return READ_CLASS_TOOLS.has(toolName);
}

export function isMutatingToolCall(
  toolName: string,
  args: Record<string, unknown>,
): boolean {
  if (HARD_MUTATING_TOOLS.has(toolName)) return true;
  if (toolName === "shell_exec") {
    return SHELL_MUTATION_PATTERN.test(String(args.command ?? ""));
  }
  if (toolName === "test_run") {
    // Tests can write snapshots/fixtures; stay conservative.
    return true;
  }
  return false;
}

function normalizeArgsForSignature(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string" && (key === "path" || key === "root")) {
      normalized[key] = value.replace(/\/+$/, "");
    } else {
      normalized[key] = value;
    }
  }
  return normalized;
}

function stableSignature(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSignature).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSignature(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

export function createExplorationDedupTracker(): ExplorationDedupTracker {
  const reads = new Map<string, { count: number; firstTurn: number }>();
  let duplicates = 0;

  return {
    check(toolName, args, _turn) {
      if (!isReadClassTool(toolName)) return null;
      const signature = `${toolName}:${stableSignature(normalizeArgsForSignature(args))}`;
      const recorded = reads.get(signature);
      if (!recorded) {
        return { isDuplicate: false, priorReads: 0, firstTurn: 0 };
      }
      if (recorded.count > 0) {
        duplicates += 1;
      }
      return {
        isDuplicate: true,
        priorReads: recorded.count,
        firstTurn: recorded.firstTurn,
      };
    },
    recordRead(toolName, args, turn) {
      if (!isReadClassTool(toolName)) return;
      const signature = `${toolName}:${stableSignature(normalizeArgsForSignature(args))}`;
      const recorded = reads.get(signature);
      if (recorded) {
        recorded.count += 1;
      } else {
        reads.set(signature, { count: 1, firstTurn: turn });
      }
    },
    recordMutation(_toolName) {
      // Any successful mutation may change what earlier reads observed.
      reads.clear();
    },
    duplicateCount() {
      return duplicates;
    },
  };
}

export function buildExplorationDedupNote(input: {
  toolName: string;
  args: Record<string, unknown>;
  priorReads: number;
  firstTurn: number;
}): string {
  const target =
    String(
      input.args.path ?? input.args.root ?? input.args.query ?? input.args.ref ?? "",
    ).slice(0, 120) || JSON.stringify(input.args).slice(0, 120);
  return [
    `探索去重提示：「${input.toolName} ${target}」在本轮运行中已经成功读取过 ${input.priorReads} 次（最早第 ${input.firstTurn} 轮），结果仍在上文对话中。`,
    "除非该目标刚刚被你修改过，请直接复用已有结果，不要再次读取；把后续动作集中在尚未探索的区域、或直接产出交付物。",
  ].join("\n");
}
