// Prompt-cache prefix builder (contracts v1.4 §2.3, Exit Criteria for P5).
//
// `buildCachePrefix` is a PURE function: identical inputs produce identical
// `CachePrefix` values, so the P5 checkpoint-writer fork agent can reconstruct
// the parent request's prefix byte-for-byte and hit the prompt cache. The
// watermark marks how many trailing messages are part of the cacheable prefix.

import type { CachePrefix, NormalizedMessage, ToolDefinition } from "./provider";

export function buildCachePrefix(
  messages: NormalizedMessage[],
  opts?: { system?: string; tools?: ToolDefinition[]; watermark?: number },
): CachePrefix {
  const system = opts?.system ?? "";
  const tools = opts?.tools ?? [];
  // Default watermark = all messages (the entire prefix is cacheable). P5 may
  // pass a smaller watermark to exclude the trailing fork-agent task message.
  const watermark = opts?.watermark ?? messages.length;
  const prefixMessages = messages.slice(0, Math.max(0, watermark));
  return {
    system,
    tools,
    messages: prefixMessages,
    watermark: Math.max(0, watermark),
  };
}

/**
 * Deterministic serialization of a CachePrefix for byte-stable comparison /
 * caching. Used by tests and by P5 to verify the fork-agent prefix matches the
 * parent's. The format is stable: do not change it without a contract patch.
 */
export function serializeCachePrefix(prefix: CachePrefix): string {
  return JSON.stringify({
    system: prefix.system,
    tools: prefix.tools,
    messages: prefix.messages,
    watermark: prefix.watermark,
  });
}
