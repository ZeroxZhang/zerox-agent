import type { SendChatMessageResult } from "../../shared/chat";

export function toChatSendMessageFailure(error: unknown): SendChatMessageResult {
  const detail = error instanceof Error ? error.message.trim() : "";
  return {
    ok: false,
    message: detail ? `消息发送失败：${detail}` : "消息发送失败。",
  };
}
