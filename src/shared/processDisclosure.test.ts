import { describe, expect, it } from "vitest";
import {
  PROCESS_RECENT_WINDOW_SIZE,
  resolveLeadingGroupExpanded,
  resolveProcessBlockExpanded,
  resolveProcessDensity,
  resolveSettledTurnFolded,
  type ProcessDensityItem,
} from "./processDisclosure";

function item(
  id: string,
  attention: ProcessDensityItem["attention"] = "normal",
): ProcessDensityItem {
  return { id, attention };
}

describe("process density", () => {
  it("keeps the latest window visible and folds the older normal blocks", () => {
    const items = [item("a"), item("b"), item("c"), item("d"), item("e")];

    const density = resolveProcessDensity(items);

    expect(density.leading.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(density.recent.map((entry) => entry.id)).toEqual(["c", "d", "e"]);
    expect(density.hasLeadingGroup).toBe(true);
  });

  it("never folds an attention block, however old it is", () => {
    const items = [item("old-failure", "blocking"), item("b"), item("c"), item("d"), item("e")];

    const density = resolveProcessDensity(items);

    expect(density.leading).toEqual([]);
    expect(density.recent.map((entry) => entry.id)).toEqual([
      "old-failure",
      "b",
      "c",
      "d",
      "e",
    ]);
  });

  it("counts only non-attention blocks against the recent window", () => {
    const items = [
      item("a"),
      item("b"),
      item("approval", "blocking"),
      item("c"),
      item("d"),
    ];

    const density = resolveProcessDensity(items);

    // Latest three non-attention are b, c, d; the approval is always visible.
    expect(density.leading.map((entry) => entry.id)).toEqual(["a"]);
    expect(density.recent.map((entry) => entry.id)).toEqual([
      "b",
      "approval",
      "c",
      "d",
    ]);
  });

  it("has no group when every block fits the window", () => {
    const density = resolveProcessDensity([item("a"), item("b")]);

    expect(density.hasLeadingGroup).toBe(false);
    expect(density.leading).toEqual([]);
    expect(density.recent.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("honours an explicit recent window size", () => {
    const density = resolveProcessDensity(
      [item("a"), item("b"), item("c")],
      { recentWindowSize: 1 },
    );

    expect(density.leading.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(density.recent.map((entry) => entry.id)).toEqual(["c"]);
  });

  it("defaults the window to three blocks", () => {
    expect(PROCESS_RECENT_WINDOW_SIZE).toBe(3);
  });
});

describe("process block expansion", () => {
  it("auto-expands attention blocks and collapses the rest", () => {
    expect(resolveProcessBlockExpanded({ attention: "blocking", preference: "auto" }))
      .toBe(true);
    expect(resolveProcessBlockExpanded({ attention: "prominent", preference: "auto" }))
      .toBe(true);
    expect(resolveProcessBlockExpanded({ attention: "normal", preference: "auto" }))
      .toBe(false);
  });

  it("lets an explicit user toggle override the automatic decision", () => {
    expect(resolveProcessBlockExpanded({
      attention: "normal",
      preference: "auto",
      userExpanded: true,
    })).toBe(true);
    expect(resolveProcessBlockExpanded({
      attention: "blocking",
      preference: "auto",
      userExpanded: false,
    })).toBe(false);
  });

  it("opens everything in the open preference and nothing in compact", () => {
    expect(resolveProcessBlockExpanded({ attention: "normal", preference: "open" }))
      .toBe(true);
    expect(resolveProcessBlockExpanded({ attention: "blocking", preference: "compact" }))
      .toBe(false);
  });

  it("keeps pinned blocks and attention blocks open in the pinned preference", () => {
    expect(resolveProcessBlockExpanded({
      attention: "normal",
      preference: "pinned",
      pinnedExpanded: true,
    })).toBe(true);
    expect(resolveProcessBlockExpanded({
      attention: "normal",
      preference: "pinned",
    })).toBe(false);
    expect(resolveProcessBlockExpanded({
      attention: "blocking",
      preference: "pinned",
    })).toBe(true);
  });
});

describe("leading group and settled turn folding", () => {
  it("opens the group only for an explicit pin or the open preference", () => {
    expect(resolveLeadingGroupExpanded({ preference: "auto" })).toBe(false);
    expect(resolveLeadingGroupExpanded({ preference: "compact" })).toBe(false);
    expect(resolveLeadingGroupExpanded({ preference: "open" })).toBe(true);
    expect(resolveLeadingGroupExpanded({ preference: "pinned", pinnedExpanded: true }))
      .toBe(true);
    expect(resolveLeadingGroupExpanded({ preference: "pinned" })).toBe(false);
  });

  it("folds a settled turn until the user reopens it", () => {
    expect(resolveSettledTurnFolded({ settled: false, preference: "auto" }))
      .toBe(false);
    expect(resolveSettledTurnFolded({ settled: true, preference: "auto" }))
      .toBe(true);
    expect(resolveSettledTurnFolded({
      settled: true,
      preference: "auto",
      userExpanded: true,
    })).toBe(false);
    expect(resolveSettledTurnFolded({ settled: true, preference: "open" }))
      .toBe(false);
  });
});
