import { describe, expect, it } from "vitest";
import { formatChatMessageTime } from "./chatMessageTime";

describe("chat message time formatting", () => {
  it("updates user message relative time from the original ISO timestamp", () => {
    expect(
      formatChatMessageTime({
        role: "user",
        createdAt: "2026-06-26T08:00:00.000Z",
        now: new Date("2026-06-26T08:03:30.000Z"),
      }),
    ).toBe("3 分钟前");
  });

  it("formats assistant replies in the user's local timezone with readable labels", () => {
    expect(
      formatChatMessageTime({
        role: "assistant",
        createdAt: "2026-06-26T08:00:00.000Z",
        now: new Date("2026-06-26T10:00:00.000Z"),
        timeZone: "Asia/Shanghai",
      }),
    ).toBe("今天 16:00");
  });
});
