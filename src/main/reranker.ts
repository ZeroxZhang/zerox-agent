import type { MemoryRecord, MemorySearchResult } from "../shared/memory";

export type RerankerOptions = {
  topN?: number;
  keywordWeight?: number;
  vectorWeight?: number;
};

export type Reranker = {
  rerank(
    results: MemorySearchResult[],
    query: string,
    options?: RerankerOptions,
  ): MemorySearchResult[];
};

export type HybridSearchScorer = {
  score(
    record: MemoryRecord,
    query: string,
    queryEmbedding?: number[],
  ): number;
};

export function createReranker(): Reranker {
  return {
    rerank(results, query, options) {
      const topN = options?.topN ?? 10;

      if (results.length <= 1) return results;

      // Take top candidates
      const candidates = results.slice(0, topN);

      // Boost scores based on query term proximity and density
      const reranked = candidates.map((result) => {
        const proximityBoost = calculateProximityBoost(
          result.record,
          query,
        );
        const densityBoost = calculateDensityBoost(result.record, query);
        const recencyBoost = calculateRecencyBoost(result.record);

        const adjustedScore =
          result.score + proximityBoost + densityBoost + recencyBoost;

        return { ...result, score: Math.round(adjustedScore * 100) / 100 };
      });

      // Sort by adjusted score
      reranked.sort((a, b) => b.score - a.score);

      // Add back remaining results below topN
      const remaining = results.slice(topN);
      return [...reranked, ...remaining];
    },
  };
}

function calculateProximityBoost(
  record: MemoryRecord,
  query: string,
): number {
  const terms = tokenize(query);
  const text = `${record.title} ${record.content}`.toLowerCase();

  let boost = 0;

  for (let i = 0; i < terms.length - 1; i++) {
    const pair = `${terms[i]} ${terms[i + 1]}`;
    if (text.includes(pair)) {
      boost += 2;
    }
  }

  // Check if all terms appear in close proximity
  if (terms.length >= 2) {
    const firstPos = text.indexOf(terms[0]);
    const lastPos = text.lastIndexOf(terms[terms.length - 1]);
    if (firstPos >= 0 && lastPos >= 0 && lastPos - firstPos < 200) {
      boost += 3;
    }
  }

  return boost;
}

function calculateDensityBoost(
  record: MemoryRecord,
  query: string,
): number {
  const terms = tokenize(query);
  const textLength = record.content.length;
  if (textLength === 0) return 0;

  let matchCount = 0;
  const text = `${record.title} ${record.content}`.toLowerCase();

  for (const term of terms) {
    let pos = 0;
    while ((pos = text.indexOf(term, pos)) >= 0) {
      matchCount += 1;
      pos += term.length;
    }
  }

  // Density: matches per 1000 chars
  const density = (matchCount / textLength) * 1000;
  return Math.min(density * 2, 5);
}

function calculateRecencyBoost(record: MemoryRecord): number {
  if (!record.createdAt) return 0;

  const ageMs = Date.now() - new Date(record.createdAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  if (ageDays < 1) return 3;
  if (ageDays < 7) return 2;
  if (ageDays < 30) return 1;
  return 0;
}

export function createHybridScorer(
  options: { keywordWeight?: number; vectorWeight?: number } = {},
): HybridSearchScorer {
  const keywordWeight = options.keywordWeight ?? 0.6;
  const vectorWeight = options.vectorWeight ?? 0.4;

  return {
    score(record, query, queryEmbedding) {
      let score = 0;

      // Keyword scoring
      if (query) {
        score += scoreByKeywords(record, query) * keywordWeight;
      }

      // Vector similarity scoring
      if (queryEmbedding?.length && record.embedding?.vector.length) {
        score += cosineSimilarity(queryEmbedding, record.embedding.vector) * 100 * vectorWeight;
      }

      return Math.round(score * 100) / 100;
    },
  };
}

function scoreByKeywords(record: MemoryRecord, query: string): number {
  const terms = tokenize(query);
  if (!terms.length) return 0;

  const titleTokens = tokenize(record.title);
  const contentTokens = tokenize(record.content);
  const tagTokens = record.tags.flatMap(tokenize);

  let score = 0;
  const matchedTerms: string[] = [];

  for (const term of terms) {
    if (titleTokens.includes(term)) {
      score += 3;
      matchedTerms.push(term);
    }
    if (tagTokens.includes(term)) {
      score += 2;
      matchedTerms.push(term);
    }
    if (contentTokens.includes(term)) {
      score += 1;
      matchedTerms.push(term);
    }
  }

  // Bonus for matching multiple terms
  if (matchedTerms.length >= terms.length * 0.5) {
    score += 2;
  }

  return score;
}

function cosineSimilarity(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftMag = 0;
  let rightMag = 0;

  for (let i = 0; i < length; i++) {
    dot += left[i] * right[i];
    leftMag += left[i] ** 2;
    rightMag += right[i] ** 2;
  }

  if (!leftMag || !rightMag) return 0;
  return dot / (Math.sqrt(leftMag) * Math.sqrt(rightMag));
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9一-龥]+/i)
    .map((t) => t.trim())
    .filter(Boolean);
}
