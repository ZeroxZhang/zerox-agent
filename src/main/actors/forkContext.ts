// ForkContext builder (contracts v1.4 §5.1/§5.3, Patch 16).
//
// Captures the parent request's prompt-cache prefix (byte-stable, via P3
// `buildCachePrefix`) so the fork actor's model request reuses it and hits the
// cache. `frozenAt` is the trajectory sequence number at capture time — the
// anchor the actor uses to cold-read the transcript from that point forward.

import { buildCachePrefix } from "../providers/cachePrefix";
import type { CachePrefix, NormalizedMessage, ToolDefinition } from "../providers/provider";
import type { ForkContext } from "./actorRuntime";

export interface BuildForkContextInput {
  parentRunId: string;
  parentMessages: NormalizedMessage[];
  system?: string;
  tools?: ToolDefinition[];
  /** Trajectory seq at capture time (defaults to 0 = full transcript read). */
  frozenAt?: number;
}

export function buildForkContext(input: BuildForkContextInput): ForkContext {
  const cachePrefix: CachePrefix = buildCachePrefix(input.parentMessages, {
    ...(input.system ? { system: input.system } : {}),
    ...(input.tools ? { tools: input.tools } : {}),
  });
  return {
    cachePrefix,
    parentRunId: input.parentRunId,
    frozenAt: input.frozenAt ?? 0,
  };
}
