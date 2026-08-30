import {
  redactCredentialString,
  stringifyRedactedCredentials,
} from "../shared/credentialRedaction";

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
  /** turn of the most recent successful read. */
  lastTurn: number;
  /**
   * Compact excerpt of the most recent read result. Carrying the digest in
   * the dedup note is what lets the model actually reuse prior evidence:
   * in goal mode the transcript is bounded, so the original tool result may
   * no longer be present in the conversation.
   */
  digest?: string;
};

export type ExplorationDedupTracker = {
  /** Call before executing a read-class tool. */
  check(toolName: string, args: Record<string, unknown>, turn: number): ExplorationDedupCheck | null;
  /** Record a successful read-class result, with a compact result digest. */
  recordRead(toolName: string, args: Record<string, unknown>, turn: number, digest?: string): void;
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
  const reads = new Map<
    string,
    { count: number; firstTurn: number; lastTurn: number; digest?: string }
  >();
  let duplicates = 0;

  return {
    check(toolName, args, _turn) {
      if (!isReadClassTool(toolName)) return null;
      const signature = `${toolName}:${stableSignature(normalizeArgsForSignature(args))}`;
      const recorded = reads.get(signature);
      if (!recorded) {
        return { isDuplicate: false, priorReads: 0, firstTurn: 0, lastTurn: 0 };
      }
      if (recorded.count > 0) {
        duplicates += 1;
      }
      return {
        isDuplicate: true,
        priorReads: recorded.count,
        firstTurn: recorded.firstTurn,
        lastTurn: recorded.lastTurn,
        ...(recorded.digest ? { digest: recorded.digest } : {}),
      };
    },
    recordRead(toolName, args, turn, digest) {
      if (!isReadClassTool(toolName)) return;
      const signature = `${toolName}:${stableSignature(normalizeArgsForSignature(args))}`;
      const recorded = reads.get(signature);
      if (recorded) {
        recorded.count += 1;
        recorded.lastTurn = turn;
        if (digest) {
          recorded.digest = digest;
        }
      } else {
        reads.set(signature, {
          count: 1,
          firstTurn: turn,
          lastTurn: turn,
          ...(digest ? { digest } : {}),
        });
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

/** Maximum characters of a prior read result carried in a dedup note. */
export const EXPLORATION_DIGEST_MAX_CHARS = 600;

/**
 * Build a compact digest from a serialized tool observation. Strips the
 * XML result wrapper and collapses whitespace so the excerpt is cheap to
 * carry in a steering note.
 */
export function buildReadResultDigest(serializedContent: string): string {
  const inner = serializedContent
    .replace(/^<tool_result[^>]*>\n?/, "")
    .replace(/\n?<\/tool_result>\s*$/, "");
  const collapsed = inner.replace(/\s+/g, " ").trim();
  return collapsed.length > EXPLORATION_DIGEST_MAX_CHARS
    ? `${collapsed.slice(0, EXPLORATION_DIGEST_MAX_CHARS)}…`
    : collapsed;
}

export function buildExplorationDedupNote(input: {
  toolName: string;
  args: Record<string, unknown>;
  priorReads: number;
  firstTurn: number;
  lastTurn?: number;
  digest?: string;
}): string {
  const target = redactCredentialString(
    String(
      input.args.path ?? input.args.root ?? input.args.query ?? input.args.ref ?? "",
    ),
  ).slice(0, 120) || stringifyRedactedCredentials(input.args).slice(0, 120);
  const lines = [
    `探索去重提示：「${input.toolName} ${target}」在本轮运行中已经成功读取过 ${input.priorReads} 次（最早第 ${input.firstTurn} 轮${
      input.lastTurn && input.lastTurn !== input.firstTurn
        ? `，最近一次第 ${input.lastTurn} 轮`
        : ""
    }）。`,
  ];
  if (input.digest) {
    lines.push(`最近一次读取结果摘要：${redactCredentialString(input.digest)}`);
    lines.push(
      "若上述摘要足以支撑当前步骤，请直接复用，不要再次读取；只有需要摘要之外的具体内容时才重新读取，并优先用 offset/limit 等参数精确读取所需片段。",
    );
  } else {
    lines.push("若该结果仍在上文对话中，请直接复用，不要再次读取。");
  }
  lines.push("把后续动作集中在尚未探索的区域、或直接产出交付物。");
  return lines.join("\n");
}
