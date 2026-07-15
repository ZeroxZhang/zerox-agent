import type { ChatAttachmentInput } from "../shared/chat";
import {
  CHAT_ATTACHMENT_MAX_COUNT,
  CHAT_ATTACHMENT_MAX_TOTAL_BYTES,
  getChatAttachmentByteLimit,
  resolveChatAttachmentType,
} from "../shared/chatAttachments";

export class ChatAttachmentReadError extends Error {}

export function getAttachmentPasteBlockedMessage(input: {
  attachmentReadPending: boolean;
  working: boolean;
}): string | null {
  if (input.working) {
    return "当前任务执行中，暂时无法粘贴附件；请等待完成或中断任务后重试。";
  }
  if (input.attachmentReadPending) {
    return "正在读取上一批粘贴附件，请完成后重试。";
  }
  return null;
}

export async function readPastedChatAttachments(
  files: File[],
  existing: ChatAttachmentInput[],
): Promise<ChatAttachmentInput[]> {
  if (existing.length + files.length > CHAT_ATTACHMENT_MAX_COUNT) {
    throw new ChatAttachmentReadError(
      `一次最多发送 ${CHAT_ATTACHMENT_MAX_COUNT} 个附件。`,
    );
  }
  const existingBytes = existing.reduce((total, attachment) => total + attachment.size, 0);
  const incomingBytes = files.reduce((total, file) => total + file.size, 0);
  if (existingBytes + incomingBytes > CHAT_ATTACHMENT_MAX_TOTAL_BYTES) {
    throw new ChatAttachmentReadError(
      `附件总大小不能超过 ${CHAT_ATTACHMENT_MAX_TOTAL_BYTES / (1024 * 1024)} MB。`,
    );
  }

  return Promise.all(
    files.map(async (file, index) => {
      const fallbackName = file.type.startsWith("image/")
        ? `粘贴图片-${existing.length + index + 1}`
        : `粘贴附件-${existing.length + index + 1}`;
      const name = file.name.trim() || fallbackName;
      const resolved = resolveChatAttachmentType(name, file.type);
      if (!resolved) {
        throw new ChatAttachmentReadError(`暂不支持附件“${name}”的文件类型。`);
      }
      if (!file.size || file.size > getChatAttachmentByteLimit(resolved.kind)) {
        const limitMb = getChatAttachmentByteLimit(resolved.kind) / (1024 * 1024);
        throw new ChatAttachmentReadError(
          `附件“${name}”为空或超过 ${limitMb} MB 限制。`,
        );
      }
      return {
        id: createAttachmentId(),
        name,
        mediaType: resolved.mediaType,
        size: file.size,
        kind: resolved.kind,
        dataBase64: await readFileBase64(file),
      };
    }),
  );
}

function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => {
      reject(new ChatAttachmentReadError(`无法读取附件“${file.name || "未命名附件"}”。`));
    };
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      const commaIndex = dataUrl.indexOf(",");
      const dataBase64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : "";
      if (!dataBase64) {
        reject(new ChatAttachmentReadError(`附件“${file.name || "未命名附件"}”内容为空。`));
        return;
      }
      resolve(dataBase64);
    };
    reader.readAsDataURL(file);
  });
}

function createAttachmentId(): string {
  if (typeof crypto.randomUUID === "function") {
    return `attachment_${crypto.randomUUID()}`;
  }
  return `attachment_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}
