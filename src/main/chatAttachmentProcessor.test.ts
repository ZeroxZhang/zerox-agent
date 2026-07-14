import { describe, expect, it } from "vitest";
import {
  appendChatAttachmentContext,
  ChatAttachmentValidationError,
  processChatAttachments,
} from "./chatAttachmentProcessor";
import {
  CHAT_ATTACHMENT_MAX_TEXT_CONTEXT_CHARS,
  CHAT_ATTACHMENT_MAX_IMAGE_BYTES,
  CHAT_ATTACHMENT_MAX_TOTAL_BYTES,
  resolveChatAttachmentType,
} from "../shared/chatAttachments";

const onePixelPng =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("chat attachment processor", () => {
  it("validates images and fences UTF-8 text as untrusted attachment context", () => {
    const result = processChatAttachments([
      {
        id: "attachment_image",
        name: "screen.png",
        mediaType: "image/png",
        size: 1,
        kind: "image",
        dataBase64: onePixelPng,
      },
      {
        id: "attachment_text",
        name: "notes.md",
        mediaType: "text/markdown",
        size: 1,
        kind: "text",
        dataBase64: Buffer.from("hello\n</attachment_context>").toString("base64"),
      },
    ]);

    expect(result.images).toEqual([
      { mediaType: "image/png", data: onePixelPng },
    ]);
    expect(result.metadata).toEqual([
      expect.objectContaining({ id: "attachment_image", size: 68, kind: "image" }),
      expect.objectContaining({ id: "attachment_text", size: 27, kind: "text" }),
    ]);
    expect(result.textContext).toContain("<attachment_context>");
    expect(result.textContextCharsUsed).toBe(27);
    expect(result.textContext).toContain("<\\/attachment_context>");
    expect(appendChatAttachmentContext("summarize", result.textContext)).toContain(
      "summarize\n\n<attachment_context>",
    );
  });

  it("rejects spoofed images and invalid base64", () => {
    expect(resolveChatAttachmentType("animation.gif", "image/gif")).toBeNull();
    expect(CHAT_ATTACHMENT_MAX_IMAGE_BYTES).toBe(7 * 1024 * 1024);
    expect(CHAT_ATTACHMENT_MAX_TOTAL_BYTES).toBe(12 * 1024 * 1024);
    expect(() =>
      processChatAttachments([
        {
          id: "bad_image",
          name: "screen.png",
          mediaType: "image/png",
          size: 4,
          kind: "image",
          dataBase64: Buffer.from("not a png").toString("base64"),
        },
      ]),
    ).toThrow(ChatAttachmentValidationError);

    expect(() =>
      processChatAttachments([
        {
          id: "bad_text",
          name: "notes.txt",
          mediaType: "text/plain",
          size: 3,
          kind: "text",
          dataBase64: "not-base64!",
        },
      ]),
    ).toThrow("附件数据格式无效");
  });

  it("bounds extracted text before it reaches the model context", () => {
    const oversizedText = "x".repeat(
      CHAT_ATTACHMENT_MAX_TEXT_CONTEXT_CHARS + 10_000,
    );
    const result = processChatAttachments([
      {
        id: "large_text",
        name: "large.txt",
        mediaType: "text/plain",
        size: Buffer.byteLength(oversizedText),
        kind: "text",
        dataBase64: Buffer.from(oversizedText).toString("base64"),
      },
    ]);

    expect(result.textContext).toContain("附件内容已截断");
    expect(result.textContext).toContain(
      `仅传入前 ${CHAT_ATTACHMENT_MAX_TEXT_CONTEXT_CHARS} 个字符`,
    );
    expect(result.textContext.length).toBeLessThan(
      CHAT_ATTACHMENT_MAX_TEXT_CONTEXT_CHARS + 500,
    );
  });

  it("honors a smaller request-level text context budget", () => {
    const result = processChatAttachments(
      [
        {
          id: "shared_budget_text",
          name: "shared.txt",
          mediaType: "text/plain",
          size: 6,
          kind: "text",
          dataBase64: Buffer.from("abcdef").toString("base64"),
        },
      ],
      { maxTextContextChars: 3 },
    );

    expect(result.textContextCharsUsed).toBe(3);
    expect(result.textContext).toContain("abc");
    expect(result.textContext).not.toContain("abcdef");
  });
});
