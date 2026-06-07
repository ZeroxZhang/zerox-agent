export type ChunkStrategy = "sliding-window" | "paragraph" | "sentence";

export type TextChunk = {
  index: number;
  content: string;
  startChar: number;
  endChar: number;
  metadata?: Record<string, unknown>;
};

export type ChunkingOptions = {
  strategy?: ChunkStrategy;
  chunkSize?: number;
  chunkOverlap?: number;
  minChunkSize?: number;
  maxChunks?: number;
};

export type ChunkingService = {
  chunk(text: string, options?: ChunkingOptions): TextChunk[];
};

export function createChunkingService(
  defaults: ChunkingOptions = {},
): ChunkingService {
  return {
    chunk(text, options) {
      const opts = { ...defaults, ...options };
      const strategy = opts.strategy ?? "sliding-window";

      switch (strategy) {
        case "sliding-window":
          return slidingWindowChunk(text, opts);
        case "paragraph":
          return paragraphChunk(text, opts);
        case "sentence":
          return sentenceChunk(text, opts);
      }
    },
  };
}

function slidingWindowChunk(
  text: string,
  options: ChunkingOptions,
): TextChunk[] {
  const chunkSize = options.chunkSize ?? 800;
  const chunkOverlap = options.chunkOverlap ?? 100;
  const minChunkSize = options.minChunkSize ?? 100;
  const maxChunks = options.maxChunks ?? 50;

  if (text.length <= chunkSize) {
    return [
      { index: 0, content: text.trim(), startChar: 0, endChar: text.length },
    ];
  }

  const chunks: TextChunk[] = [];
  let start = 0;

  while (start < text.length && chunks.length < maxChunks) {
    let end = start + chunkSize;

    if (end >= text.length) {
      const content = text.slice(start).trim();
      if (content.length >= minChunkSize) {
        chunks.push({
          index: chunks.length,
          content,
          startChar: start,
          endChar: text.length,
        });
      }
      break;
    }

    // Try to break at a natural boundary within the last 20% of the window
    const lookbackStart = Math.max(start, end - Math.floor(chunkSize * 0.2));
    const naturalBreak = findNaturalBreak(text, lookbackStart, end);

    if (naturalBreak > start) {
      end = naturalBreak;
    }

    const content = text.slice(start, end).trim();
    if (content.length >= minChunkSize) {
      chunks.push({
        index: chunks.length,
        content,
        startChar: start,
        endChar: end,
      });
    }

    start = end - chunkOverlap;
  }

  return chunks;
}

function paragraphChunk(
  text: string,
  options: ChunkingOptions,
): TextChunk[] {
  const maxChunks = options.maxChunks ?? 50;
  const paragraphs = text.split(/\n\s*\n/);
  const chunks: TextChunk[] = [];

  let currentChunk = "";
  let chunkStart = 0;
  let searchPos = 0;

  for (const paragraph of paragraphs) {
    const paragraphStart = text.indexOf(paragraph, searchPos);
    searchPos = paragraphStart + paragraph.length;

    if (
      currentChunk.length + paragraph.length > (options.chunkSize ?? 1200) &&
      currentChunk.length > 0
    ) {
      chunks.push({
        index: chunks.length,
        content: currentChunk.trim(),
        startChar: chunkStart,
        endChar: paragraphStart,
      });
      currentChunk = "";
      chunkStart = paragraphStart;
    }

    if (!currentChunk) {
      chunkStart = paragraphStart;
    }
    currentChunk += (currentChunk ? "\n\n" : "") + paragraph;

    if (chunks.length >= maxChunks) break;
  }

  if (currentChunk.trim() && chunks.length < maxChunks) {
    chunks.push({
      index: chunks.length,
      content: currentChunk.trim(),
      startChar: chunkStart,
      endChar: text.length,
    });
  }

  return chunks;
}

function sentenceChunk(
  text: string,
  options: ChunkingOptions,
): TextChunk[] {
  const maxChunks = options.maxChunks ?? 50;
  const sentences = text.split(/(?<=[。！？.!?\n])\s*/);
  const chunks: TextChunk[] = [];

  let currentChunk = "";
  let chunkStart = 0;
  let searchPos = 0;

  for (const sentence of sentences) {
    const sentenceStart = text.indexOf(sentence, searchPos);
    searchPos = sentenceStart + sentence.length;

    if (
      currentChunk.length + sentence.length > (options.chunkSize ?? 600) &&
      currentChunk.length > 0
    ) {
      chunks.push({
        index: chunks.length,
        content: currentChunk.trim(),
        startChar: chunkStart,
        endChar: sentenceStart,
      });
      currentChunk = "";
      chunkStart = sentenceStart;
    }

    if (!currentChunk) {
      chunkStart = sentenceStart;
    }
    currentChunk += sentence;

    if (chunks.length >= maxChunks) break;
  }

  if (currentChunk.trim() && chunks.length < maxChunks) {
    chunks.push({
      index: chunks.length,
      content: currentChunk.trim(),
      startChar: chunkStart,
      endChar: text.length,
    });
  }

  return chunks;
}

function findNaturalBreak(
  text: string,
  start: number,
  end: number,
): number {
  const window = text.slice(start, end);
  const breakPatterns = [
    /\n\n/,    // paragraph break (highest priority)
    /\n/,      // line break
    /[。！？]/, // Chinese sentence end
    /[.!?]\s/, // English sentence end
    /[，,；;]/, // Chinese/English clause
    /\s{2,}/,  // multiple spaces
  ];

  for (const pattern of breakPatterns) {
    const match = window.match(pattern);
    if (match?.index !== undefined) {
      const breakPos = start + match.index + match[0].length;
      if (breakPos > start && breakPos < end) {
        return breakPos;
      }
    }
  }

  return -1;
}
