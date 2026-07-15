import { describe, expect, it } from "vitest";
import { getAttachmentPasteBlockedMessage } from "./chatAttachmentPaste";

describe("chat attachment paste availability", () => {
  it("explains that attachment paste is unavailable while a task is running", () => {
    expect(
      getAttachmentPasteBlockedMessage({
        attachmentReadPending: false,
        working: true,
      }),
    ).toContain("当前任务执行中");
  });

  it("asks the user to retry when an earlier paste is still being read", () => {
    expect(
      getAttachmentPasteBlockedMessage({
        attachmentReadPending: true,
        working: false,
      }),
    ).toContain("上一批粘贴附件");
  });

  it("allows attachment paste when the composer is idle", () => {
    expect(
      getAttachmentPasteBlockedMessage({
        attachmentReadPending: false,
        working: false,
      }),
    ).toBeNull();
  });
});
