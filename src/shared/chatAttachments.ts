import type {
  ChatAttachmentKind,
  ChatAttachmentMetadata,
} from "./chat";

export const CHAT_ATTACHMENT_MAX_COUNT = 6;
export const CHAT_ATTACHMENT_MAX_IMAGE_BYTES = 7 * 1024 * 1024;
export const CHAT_ATTACHMENT_MAX_TEXT_BYTES = 1024 * 1024;
export const CHAT_ATTACHMENT_MAX_TOTAL_BYTES = 12 * 1024 * 1024;
export const CHAT_ATTACHMENT_MAX_TEXT_CONTEXT_CHARS = 24_000;

const imageMediaTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const imageMediaTypeByExtension: Record<string, string> = {
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const textExtensions = new Set([
  "c",
  "cc",
  "cpp",
  "css",
  "csv",
  "go",
  "h",
  "hpp",
  "html",
  "java",
  "js",
  "json",
  "jsx",
  "log",
  "md",
  "mjs",
  "py",
  "rb",
  "rs",
  "sh",
  "sql",
  "svg",
  "toml",
  "ts",
  "tsx",
  "txt",
  "xml",
  "yaml",
  "yml",
]);

export type ResolvedChatAttachmentType = {
  kind: ChatAttachmentKind;
  mediaType: string;
};

export function resolveChatAttachmentType(
  name: string,
  mediaType: string,
): ResolvedChatAttachmentType | null {
  const normalizedMediaType = mediaType.trim().toLowerCase().split(";", 1)[0] ?? "";
  const extension = getFileExtension(name);
  if (imageMediaTypes.has(normalizedMediaType)) {
    return { kind: "image", mediaType: normalizedMediaType };
  }
  const inferredImageMediaType = imageMediaTypeByExtension[extension];
  if ((!normalizedMediaType || normalizedMediaType === "application/octet-stream") && inferredImageMediaType) {
    return { kind: "image", mediaType: inferredImageMediaType };
  }
  if (
    normalizedMediaType.startsWith("text/") ||
    normalizedMediaType === "application/json" ||
    normalizedMediaType === "application/xml" ||
    normalizedMediaType === "application/yaml" ||
    textExtensions.has(extension)
  ) {
    return {
      kind: "text",
      mediaType: normalizedMediaType || "text/plain",
    };
  }
  return null;
}

export function getChatAttachmentByteLimit(kind: ChatAttachmentKind): number {
  return kind === "image"
    ? CHAT_ATTACHMENT_MAX_IMAGE_BYTES
    : CHAT_ATTACHMENT_MAX_TEXT_BYTES;
}

export function formatChatAttachmentTypeLabel(
  attachment: Pick<ChatAttachmentMetadata, "kind" | "name" | "mediaType">,
): string {
  const extension = getFileExtension(attachment.name).toUpperCase();
  if (extension && extension.length <= 5) {
    return extension;
  }
  if (attachment.kind === "image") {
    return attachment.mediaType.replace(/^image\//, "").slice(0, 5).toUpperCase();
  }
  return "TEXT";
}

export function formatChatAttachmentSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileExtension(name: string): string {
  const match = name.trim().toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}
