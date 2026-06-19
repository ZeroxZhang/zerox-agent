// Built-in deep-research workflow (contracts v1.4 §6).
//
// plan → search → extract → group → verify (3-voter adversarial, REJECT_QUORUM=2)
// → report. Caps at 15 sources / 25 facts (workflow_fact_capped). Voters spawn
// via the `agent()` host hook with a read-only toolWhitelist and contextMode:state
// (reuse parent cache). Registered under name "deep-research".

import type { WorkflowFn, WorkflowSandbox, SearchHit } from "./workflowRuntime";

export const DEEP_RESEARCH_MAX_SOURCES = 15;
export const DEEP_RESEARCH_MAX_FACTS = 25;
export const REJECT_QUORUM = 2;
export const DEEP_RESEARCH_WORKFLOW_NAME = "deep-research";

interface ResearchFact {
  claim: string;
  sources: string[];
}

export const deepResearchWorkflow: WorkflowFn = async (args, sandbox, journal) => {
  const query = typeof args === "string" ? args : (args as { query?: string })?.query ?? "";
  journal.phase("plan");
  const subQueries = [query, `${query} overview`, `${query} recent 2026`];

  journal.phase("search");
  const searchResults: SearchHit[] = [];
  for (const q of subQueries.slice(0, 3)) {
    try {
      const hits = await sandbox.websearch(q);
      searchResults.push(...hits);
    } catch {
      // tolerate per-query failure
    }
  }
  const sources = searchResults.slice(0, DEEP_RESEARCH_MAX_SOURCES);
  if (searchResults.length > DEEP_RESEARCH_MAX_SOURCES) journal.factCapped(`sources capped at ${DEEP_RESEARCH_MAX_SOURCES}`);

  journal.phase("extract");
  const facts: ResearchFact[] = [];
  for (const src of sources) {
    if (facts.length >= DEEP_RESEARCH_MAX_FACTS) { journal.factCapped(`facts capped at ${DEEP_RESEARCH_MAX_FACTS}`); break; }
    try {
      const text = await sandbox.webfetch(src.url);
      // Naive extraction: first 2 sentences as a candidate fact per source.
      const sentences = text.split(/(?<=[.。])\s+/).slice(0, 2).join(" ");
      if (sentences.trim()) facts.push({ claim: sentences.trim().slice(0, 400), sources: [src.url] });
    } catch {
      // tolerate fetch failure
    }
  }

  journal.phase("group");
  // Group by coarse keyword overlap (deterministic, no LLM required for grouping).
  const groups = new Map<string, ResearchFact[]>();
  for (const f of facts) {
    const key = f.claim.split(/\s+/).slice(0, 3).join(" ").toLowerCase();
    const arr = groups.get(key) ?? [];
    arr.push(f);
    groups.set(key, arr);
  }

  journal.phase("verify");
  const survivors: ResearchFact[] = [];
  for (const fact of facts) {
    // 3-voter adversarial verification: spawn 3 ephemeral actors; each judges
    // whether the source supports the claim. REJECT_QUORUM=2 → drop if ≥2 reject.
    const voters = await sandbox.parallel([
      () => sandbox.agent({
        contextMode: "state", lifecycle: "ephemeral",
        task: `Does this source support this claim? Source: ${fact.sources[0]} Claim: ${fact.claim}. Reply "support" or "reject".`,
        toolWhitelist: ["websearch", "webfetch", "file_read"],
      }),
      () => sandbox.agent({
        contextMode: "state", lifecycle: "ephemeral",
        task: `Adversarially check: is claim "${fact.claim}" contradicted by source ${fact.sources[0]}? Reply "support" or "reject".`,
        toolWhitelist: ["websearch", "webfetch", "file_read"],
      }),
      () => sandbox.agent({
        contextMode: "state", lifecycle: "ephemeral",
        task: `Independent vote: source ${fact.sources[0]} vs claim "${fact.claim}". Reply "support" or "reject".`,
        toolWhitelist: ["websearch", "webfetch", "file_read"],
      }),
    ]);
    const rejects = voters.filter((v) => v.status !== "done" || /reject/i.test(v.summary)).length;
    if (rejects < REJECT_QUORUM) survivors.push(fact);
  }

  journal.phase("report");
  const lines = [`# Deep Research: ${query}`, "", `Synthesized ${survivors.length} verified fact(s) from ${sources.length} source(s).`, ""];
  for (const f of survivors) {
    lines.push(`- ${f.claim}`);
    for (const s of f.sources) lines.push(`  - ${s}`);
  }
  return { query, factCount: survivors.length, sourceCount: sources.length, report: lines.join("\n"), groups: [...groups.keys()] };
};

/** Register the built-in deep-research workflow on a runtime. */
export function registerDeepResearchWorkflow(
  register: (name: string, fn: WorkflowFn) => void,
): void {
  register(DEEP_RESEARCH_WORKFLOW_NAME, deepResearchWorkflow);
}

export type { WorkflowSandbox };
