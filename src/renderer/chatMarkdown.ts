export type MarkdownInlineSegment =
  | { type: "text"; text: string }
  | { type: "strong"; text: string }
  | { type: "code"; text: string }
  | { type: "link"; href: string; text: string };

export type MarkdownBlock =
  | { type: "heading"; depth: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "unorderedList"; items: string[] }
  | { type: "orderedList"; items: string[] }
  | { type: "taskList"; items: Array<{ text: string; checked: boolean }> }
  | { type: "code"; language?: string; code: string }
  | { type: "table"; columns: string[]; rows: string[][]; caption?: string }
  | { type: "blockquote"; text: string };

export type ChatMarkdownBlock = MarkdownBlock;

export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const language = trimmed.slice(3).trim() || undefined;
      const codeLines: string[] = [];
      index += 1;

      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }

      if (index < lines.length) {
        index += 1;
      }
      blocks.push({ type: "code", ...(language ? { language } : {}), code: codeLines.join("\n") });
      continue;
    }

    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        depth: headingMatch[1].length as 1 | 2 | 3,
        text: headingMatch[2].trim(),
      });
      index += 1;
      continue;
    }

    const table = parseTable(lines, index);
    if (table) {
      blocks.push(table.block);
      index = table.nextIndex;
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith(">")) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "blockquote", text: quoteLines.join(" ").trim() });
      continue;
    }

    if (isTaskListLine(trimmed)) {
      const items: Array<{ text: string; checked: boolean }> = [];
      while (index < lines.length && isTaskListLine(lines[index].trim())) {
        const itemMatch = /^[-*]\s+\[([ xX])\]\s+(.*)$/.exec(lines[index].trim());
        if (itemMatch) {
          items.push({
            checked: itemMatch[1].toLowerCase() === "x",
            text: itemMatch[2].trim(),
          });
        }
        index += 1;
      }
      blocks.push({ type: "taskList", items });
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "unorderedList", items });
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "orderedList", items });
      continue;
    }

    const paragraphLines = [trimmed];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !isBlockStart(lines[index].trim())
    ) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraphLines.join(" ") });
  }

  return blocks;
}

export function parseInlineMarkdown(text: string): MarkdownInlineSegment[] {
  const segments: MarkdownInlineSegment[] = [];
  const tokenPattern =
    /(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s<)]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", text: text.slice(lastIndex, match.index) });
    }

    const token = match[0];
    if (token.startsWith("[") && token.includes("](")) {
      const linkMatch = /^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(token);
      if (linkMatch) {
        segments.push({ type: "link", text: linkMatch[1], href: linkMatch[2] });
      } else {
        segments.push({ type: "text", text: token });
      }
    } else if (token.startsWith("http://") || token.startsWith("https://")) {
      segments.push({ type: "link", text: token, href: token });
    } else if (token.startsWith("**")) {
      segments.push({ type: "strong", text: token.slice(2, -2) });
    } else {
      segments.push({ type: "code", text: token.slice(1, -1) });
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", text: text.slice(lastIndex) });
  }

  return segments.length ? segments : [{ type: "text", text }];
}

export const parseChatMarkdown = parseMarkdownBlocks;

function parseTable(
  lines: string[],
  startIndex: number,
): { block: MarkdownBlock; nextIndex: number } | undefined {
  const header = lines[startIndex];
  const divider = lines[startIndex + 1];
  if (!isTableRow(header) || !isTableDivider(divider)) {
    return undefined;
  }

  const columns = splitTableRow(header);
  const rows: string[][] = [];
  let index = startIndex + 2;
  while (index < lines.length && isTableRow(lines[index])) {
    rows.push(splitTableRow(lines[index]));
    index += 1;
  }

  return {
    block: { type: "table", columns, rows },
    nextIndex: index,
  };
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableRow(line: string | undefined): line is string {
  return Boolean(line?.trim().includes("|"));
}

function isTableDivider(line: string | undefined): boolean {
  if (!isTableRow(line)) {
    return false;
  }
  return splitTableRow(line).every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isTaskListLine(trimmedLine: string): boolean {
  return /^[-*]\s+\[[ xX]\]\s+/.test(trimmedLine);
}

function isBlockStart(trimmedLine: string): boolean {
  return (
    trimmedLine.startsWith("```") ||
    /^(#{1,3})\s+/.test(trimmedLine) ||
    trimmedLine.startsWith(">") ||
    isTaskListLine(trimmedLine) ||
    /^[-*]\s+/.test(trimmedLine) ||
    /^\d+\.\s+/.test(trimmedLine)
  );
}
