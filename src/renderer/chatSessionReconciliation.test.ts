import { describe, expect, it } from "vitest";
import {
  isChatSessionSelectionCurrent,
  shouldApplyPersistedSessionRefresh,
  shouldApplySequencedSessionResult,
} from "./chatSessionReconciliation";

describe("chat session reconciliation", () => {
  it("accepts initial-session and still-active-session refreshes", () => {
    expect(shouldApplyPersistedSessionRefresh(null, "session_1")).toBe(true);
    expect(
      shouldApplyPersistedSessionRefresh("session_1", "session_1"),
    ).toBe(true);
  });

  it("rejects a late refresh after the user switched sessions", () => {
    expect(
      shouldApplyPersistedSessionRefresh("session_2", "session_1"),
    ).toBe(false);
    expect(
      shouldApplyPersistedSessionRefresh("session_1", "session_1", 2, 1),
    ).toBe(false);
  });

  it("keeps async operation results scoped to the captured selection", () => {
    const captured = { sessionId: "session_1", generation: 4 };

    expect(
      isChatSessionSelectionCurrent(captured, "session_1", 4),
    ).toBe(true);
    expect(
      isChatSessionSelectionCurrent(captured, "session_2", 5),
    ).toBe(false);
    expect(
      isChatSessionSelectionCurrent(captured, "session_1", 5),
    ).toBe(false);
  });

  it("rejects an older same-session request after a newer one starts", () => {
    const captured = { sessionId: "session_1", generation: 4 };

    expect(
      shouldApplySequencedSessionResult(
        captured,
        "session_1",
        4,
        8,
        8,
      ),
    ).toBe(true);
    expect(
      shouldApplySequencedSessionResult(
        captured,
        "session_1",
        4,
        7,
        8,
      ),
    ).toBe(false);
  });
});
