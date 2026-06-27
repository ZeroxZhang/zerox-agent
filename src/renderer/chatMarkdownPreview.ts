export const LONG_MARKDOWN_PREVIEW_CHAR_LIMIT = 120;
export const LONG_MARKDOWN_PREVIEW_LINE_LIMIT = 12;

const MARKDOWN_PREVIEW_NOTICE =
  "... preview truncated. Expand to render the full message.";

export function shouldRenderMarkdownPreview(content: string): boolean {
  return (
    content.length > LONG_MARKDOWN_PREVIEW_CHAR_LIMIT ||
    hasMoreLinesThanPreviewLimit(content)
  );
}

export function createMarkdownPreview(content: string): string {
  if (!shouldRenderMarkdownPreview(content)) {
    return content;
  }

  const charLimited =
    content.length > LONG_MARKDOWN_PREVIEW_CHAR_LIMIT
      ? content.slice(0, LONG_MARKDOWN_PREVIEW_CHAR_LIMIT)
      : content;
  const lineLimited = sliceMarkdownLines(
    charLimited,
    LONG_MARKDOWN_PREVIEW_LINE_LIMIT,
  );
  const preview = lineLimited.trimEnd();
  const fenceCloser = hasOpenMarkdownFence(preview) ? "\n```" : "";

  return `${preview}${fenceCloser}\n\n${MARKDOWN_PREVIEW_NOTICE}`;
}

function hasMoreLinesThanPreviewLimit(content: string): boolean {
  let lineCount = 1;
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) {
      lineCount += 1;
      if (lineCount > LONG_MARKDOWN_PREVIEW_LINE_LIMIT) {
        return true;
      }
    }
  }
  return false;
}

function sliceMarkdownLines(content: string, maxLines: number): string {
  let lineCount = 1;
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) {
      lineCount += 1;
      if (lineCount > maxLines) {
        return content.slice(0, index);
      }
    }
  }
  return content;
}

function hasOpenMarkdownFence(content: string): boolean {
  const fences = content.match(/^```/gm);
  return Boolean(fences && fences.length % 2 === 1);
}
