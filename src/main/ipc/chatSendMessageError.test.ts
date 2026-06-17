import { describe, expect, it } from "vitest";
import { toChatSendMessageFailure } from "./chatSendMessageError";

describe("toChatSendMessageFailure", () => {
  it("converts thrown sendMessage errors into structured failures", () => {
    expect(
      toChatSendMessageFailure(new SyntaxError("Unexpected end of JSON input")),
    ).toEqual({
      ok: false,
      message: "消息发送失败：Unexpected end of JSON input",
    });
  });

  it("handles non-error throw values", () => {
    expect(toChatSendMessageFailure("boom")).toEqual({
      ok: false,
      message: "消息发送失败。",
    });
  });
});
