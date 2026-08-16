# RC13 Decision: Adaptive Context Orchestration

Status: Accepted

Date: 2026-08-16

## Context

Zerox already persists replay-safe context replacements, checkpoints, memories,
and offloaded tool results. The remaining control paths still disagree about
the effective model input budget, however. Plan investigation reconstructs a
model profile without its known context window, unknown models derive a hard
input limit from maximum output tokens, and compaction can report success
without proving that the next request fits.

The observed failure is deterministic: a DeepSeek V4 Flash planning prompt was
estimated at 11,682 tokens, but Plan omitted the public 128,000-token model
window. The compatibility fallback therefore converted an 8,192-token output
setting into a false 5,734-token hard input limit. The single current turn was
not compressible, so the investigation paused before its first model request.

## Decision

Introduce one automatic context contract shared by model settings, Plan, Chat,
Goal, and scheduled runtime.

1. Context windows come from a versioned public model catalog by default.
   Provider-published model metadata may enrich that catalog at runtime.
   There is no manual context-window input.
2. Every resolved window carries provenance. The UI displays the model window,
   usable input budget, and source, or states that the limit is unverified.
3. A verified window creates an enforced input budget after reserving maximum
   output and a tokenizer/provider safety margin. An unknown window creates an
   advisory compatibility budget and cannot cause a client-side hard failure
   solely from that estimate.
4. Plan investigation carries the complete frozen binding into AgentLoop and
   projects Skills and evidence against the effective input budget before the
   first request.
5. Compaction is accepted only when the resulting projection fits its target
   budget. Full source messages remain in the append-only context surface or
   local checkpoint and complete tool-call/result groups remain atomic.
6. An irreducible verified context pauses before dispatch with structured,
   user-facing diagnostics. Retrying an unchanged projection must not be
   presented as a likely recovery.

## Invariants

1. No user-entered context-window value becomes authoritative.
2. Public catalog and provider metadata never include credentials.
3. Permission policy, system instructions, current user intent, Goal
   continuity, and tool-call/result pairing survive projection.
4. Unknown provider limits remain visible and advisory; they are not
   misrepresented as verified hard limits.
5. A successful compaction result fits the effective target budget.
6. Raw context remains locally recoverable and replay provenance is preserved.
7. Provider-native context features remain optional and provider-scoped.

## Compatibility

Existing catalog entries, frozen Plan bindings, checkpoints, Chat context
snapshots, and Goal records remain readable because all provenance fields are
optional. Historical records without provenance render as legacy or
unverified. No SQLite migration is required.

## Rollback

Remove provider metadata enrichment and optional provenance fields, restore the
legacy budget resolver, and keep the existing append-only context surface,
checkpoints, and model matrix. Rollback changes no user data or permissions.

## Verification

- public catalog and provider metadata parsing tests;
- model binding and context telemetry compatibility tests;
- oversized initial Plan prompt and unknown-window tests;
- compaction target, replay, checkpoint, and tool-pair tests;
- renderer checks at desktop and 390px compact widths;
- full verify, runtime stress, production smoke, program, and harness gates.
