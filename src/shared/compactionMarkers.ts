// Compaction markers (contracts v1.4 §4, P2).
//
// Single source of truth for the markers that the (previously triplicated)
// compaction + goal-continuity code relied on via string equality. P2 collapses
// the three duplicate `NEVER_COMPACT_MARKER` literals onto this module and adds
// the rebuild-boundary marker inserted between the rebuilt prefix and the
// recent tail.

/** Messages containing this marker are never compacted (goal-continuity anchor). */
export const NEVER_COMPACT_MARKER = "[Goal continuity checkpoint - never compact]";

/**
 * Inserted by `RebuildFromCheckpoint` between the rebuilt prefix (checkpoint +
 * injected memories) and the retained recent tail. Treated as non-compactable
 * so the rebuilt prefix is not re-summarized on a later overflow.
 */
export const REBUILD_BOUNDARY_MARKER = "[Context rebuilt from checkpoint]";

/** Context budget ratio: maxTokens * 0.7 (previously a duplicated literal). */
export const CONTEXT_BUDGET_RATIO = 0.7;

export function buildRebuildBoundaryMessage(ref: string, iso: string): string {
  return `${REBUILD_BOUNDARY_MARKER} ${ref} at ${iso}`;
}

export function isRebuildBoundary(content: string): boolean {
  return content.includes(REBUILD_BOUNDARY_MARKER);
}
