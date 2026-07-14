import { describe, expect, it } from "vitest";
import {
  isChatSessionSelectionCurrent,
  rollbackFailedAttachmentTurn,
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

  it("rolls back the optimistic user turn and streamed reply before an attachment retry", () => {
    const messages = [
      {
        id: "assistant_previous",
        role: "assistant" as const,
        content: "previous",
        createdAt: "2026-07-14T15:00:00.000Z",
      },
      {
        id: "user_failed",
        role: "user" as const,
        content: "分析截图",
        createdAt: "2026-07-14T15:01:00.000Z",
        attachments: [
          {
            id: "attachment_1",
            name: "screen.png",
            mediaType: "image/png",
            size: 68,
            kind: "image" as const,
          },
        ],
      },
      {
        id: "assistant_stream",
        role: "assistant" as const,
        content: "partial",
        createdAt: "2026-07-14T15:01:01.000Z",
        streamRequestId: "request_failed",
      },
    ];

    expect(
      rollbackFailedAttachmentTurn(messages, {
        userMessageId: "user_failed",
        requestId: "request_failed",
      }),
    ).toEqual([messages[0]]);
  });
});
