/**
 * LD03 process density policy.
 *
 * A two-state block (summary line vs body) is not enough to keep a long turn
 * from piling up. Process facts therefore render in three levels:
 *
 *   L0  one folded group line for older non-attention blocks
 *   L1  one-line summaries for the latest window plus every attention block
 *   L2  the block body, only when the block is opened
 *
 * Attention state (failed, blocked, waiting for approval, denied) is never
 * hidden by density: it always stays at L1 and auto-expands. This inherits the
 * P104 D9 rule that actionable state overrides compaction.
 */

export const PROCESS_RECENT_WINDOW_SIZE = 3;

export type ProcessDisclosurePreference =
  | "auto"
  | "compact"
  | "open"
  | "pinned";

export type ProcessAttention = "normal" | "prominent" | "blocking";

export type ProcessDensityItem = {
  id: string;
  attention: ProcessAttention;
};

export type ProcessDensity<T extends ProcessDensityItem> = {
  /** Older non-attention blocks, chronological. Rendered as the L0 group. */
  leading: T[];
  /** Latest window plus every attention block, chronological. L1 summaries. */
  recent: T[];
  hasLeadingGroup: boolean;
};

export function isProcessAttention(attention: ProcessAttention): boolean {
  return attention !== "normal";
}

/**
 * Split a turn's process facts into the folded group and the visible rows.
 *
 * The latest `recentWindowSize` non-attention blocks stay visible, and every
 * attention block stays visible regardless of age, so a failure early in a
 * long turn cannot be folded away. Only the CONTIGUOUS prefix of blocks that
 * fall outside that set is folded, which keeps the rendered order identical to
 * the causal order: a later block is never pulled in front of an older one.
 */
export function resolveProcessDensity<T extends ProcessDensityItem>(
  items: readonly T[],
  options: { recentWindowSize?: number } = {},
): ProcessDensity<T> {
  const recentWindowSize = normalizeWindowSize(options.recentWindowSize);
  const visibleIds = new Set<string>();
  let remaining = recentWindowSize;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!;
    if (isProcessAttention(item.attention)) {
      visibleIds.add(item.id);
      continue;
    }
    if (remaining > 0) {
      visibleIds.add(item.id);
      remaining -= 1;
    }
  }
  let leadingCount = 0;
  while (
    leadingCount < items.length
    && !visibleIds.has(items[leadingCount]!.id)
  ) {
    leadingCount += 1;
  }
  const leading = items.slice(0, leadingCount);
  const recent = items.slice(leadingCount);
  return {
    leading,
    recent,
    hasLeadingGroup: leading.length > 0,
  };
}

export function resolveProcessBlockExpanded(input: {
  attention: ProcessAttention;
  preference: ProcessDisclosurePreference;
  /** Explicit per-block user toggle for this session. */
  userExpanded?: boolean;
  /** Per-block pinned state. */
  pinnedExpanded?: boolean;
}): boolean {
  switch (input.preference) {
    case "open":
      return true;
    case "compact":
      return false;
    case "pinned":
      return input.pinnedExpanded === true
        || isProcessAttention(input.attention);
    case "auto":
    default:
      return input.userExpanded ?? isProcessAttention(input.attention);
  }
}

/** The L0 group opens only on an explicit user action or the open preference. */
export function resolveLeadingGroupExpanded(input: {
  preference: ProcessDisclosurePreference;
  pinnedExpanded?: boolean;
}): boolean {
  switch (input.preference) {
    case "open":
      return true;
    case "compact":
      return false;
    default:
      return input.pinnedExpanded === true;
  }
}

/**
 * A settled turn folds its whole process stream into one summary line, unless
 * the user opened it again or asked for everything to be open.
 */
export function resolveSettledTurnFolded(input: {
  settled: boolean;
  preference: ProcessDisclosurePreference;
  userExpanded?: boolean;
}): boolean {
  if (!input.settled) {
    return false;
  }
  if (input.preference === "open") {
    return false;
  }
  return input.userExpanded !== true;
}

function normalizeWindowSize(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return PROCESS_RECENT_WINDOW_SIZE;
  }
  return Math.max(0, Math.floor(value));
}
