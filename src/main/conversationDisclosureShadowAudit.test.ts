import { describe, expect, it } from "vitest";
import {
  createConversationDisclosureScope,
  projectConversationDisclosureSnapshot,
  type ConversationDisclosureFact,
} from "../shared/conversationDisclosure";
import {
  auditConversationDisclosureShadow,
  buildConversationShadowParityArtifact,
  createConversationShadowBodyDigest,
  validateConversationShadowParityArtifact,
} from "./conversationDisclosureShadowAudit";

describe("conversation disclosure shadow parity", () => {
  it("accepts exact required facts and source cuts", () => {
    const snapshot = makeSnapshot();
    const expected = snapshot.items.map((item) => ({
      id: item.id,
      requiredness: "required" as const,
      lifecycle: item.lifecycle,
      canonicalBodyDigest: createConversationShadowBodyDigest(item),
    }));
    const audit = auditConversationDisclosureShadow({
      snapshot,
      expected,
      expectedSourceCuts: snapshot.sourceCuts,
    });
    expect(audit).toMatchObject({
      missingRequiredFacts: 0,
      lifecycleMismatches: 0,
      duplicateStableIdConflicts: 0,
      sensitiveLeaks: 0,
      optionalDifferences: [],
    });
  });

  it("accepts an independently frozen source-cut digest", () => {
    const snapshot = makeSnapshot();
    const audit = auditConversationDisclosureShadow({
      snapshot,
      expected: snapshot.items.map((item) => ({
        id: item.id,
        requiredness: "required" as const,
        lifecycle: item.lifecycle,
        canonicalBodyDigest: createConversationShadowBodyDigest(item),
      })),
      expectedSourceCutDigest:
        createConversationShadowBodyDigest(snapshot.sourceCuts),
    });

    expect(audit.lifecycleMismatches).toBe(0);
  });

  it("reports missing required, lifecycle, duplicate, and optional differences", () => {
    const snapshot = makeSnapshot();
    const item = snapshot.items[0]!;
    const conflicting = {
      ...item,
      summary: "different",
    };
    const audit = auditConversationDisclosureShadow({
      snapshot: {
        ...snapshot,
        items: [item, conflicting],
      },
      expected: [
        {
          id: "missing",
          requiredness: "required",
          lifecycle: "running",
          canonicalBodyDigest: createConversationShadowBodyDigest({}),
        },
        {
          id: item.id,
          requiredness: "required",
          lifecycle: "failed",
          canonicalBodyDigest: createConversationShadowBodyDigest(item),
        },
      ],
      expectedSourceCuts: snapshot.sourceCuts,
    });
    expect(audit).toMatchObject({
      missingRequiredFacts: 1,
      lifecycleMismatches: 1,
      duplicateStableIdConflicts: 1,
    });
  });

  it("separates body and source-cut mismatches from lifecycle mismatches", () => {
    const snapshot = makeSnapshot();
    const item = snapshot.items[0]!;
    const audit = auditConversationDisclosureShadow({
      snapshot,
      expected: [{
        id: item.id,
        requiredness: "required",
        lifecycle: item.lifecycle,
        canonicalBodyDigest: createConversationShadowBodyDigest({
          ...item,
          summary: "different",
        }),
      }],
      expectedSourceCutDigest: `sha256:${"a".repeat(64)}`,
    });

    expect(audit).toMatchObject({
      lifecycleMismatches: 0,
      bodyMismatches: 1,
      sourceCutMismatches: 1,
    });
  });

  it("does not also count a lifecycle difference as a body mismatch", () => {
    const snapshot = makeSnapshot();
    const item = snapshot.items[0]!;
    const audit = auditConversationDisclosureShadow({
      snapshot,
      expected: [{
        id: item.id,
        requiredness: "required",
        lifecycle: "failed",
        canonicalBodyDigest: createConversationShadowBodyDigest({
          ...item,
          lifecycle: "failed",
        }),
      }],
      expectedSourceCuts: snapshot.sourceCuts,
    });

    expect(audit).toMatchObject({
      lifecycleMismatches: 1,
      bodyMismatches: 0,
    });
  });

  it("compares requiredness independently from body and lifecycle", () => {
    const snapshot = makeSnapshot();
    const item = snapshot.items[0]!;
    const audit = auditConversationDisclosureShadow({
      snapshot,
      expected: [{
        id: item.id,
        requiredness: "optional",
        lifecycle: item.lifecycle,
        canonicalBodyDigest: createConversationShadowBodyDigest(item),
      }],
      expectedSourceCuts: snapshot.sourceCuts,
    });

    expect(audit).toMatchObject({
      requirednessMismatches: 1,
      lifecycleMismatches: 0,
      bodyMismatches: 0,
    });
  });

  it("classifies optional differences with a closed bounded reason", () => {
    const snapshot = makeSnapshot("optional");
    const audit = auditConversationDisclosureShadow({
      snapshot,
      expected: [],
      expectedSourceCuts: snapshot.sourceCuts,
      optionalReasons: {
        [snapshot.items[0]!.id]: "legacy_tail",
      },
    });
    expect(audit.optionalDifferences).toEqual([{
      id: snapshot.items[0]!.id,
      reasonCode: "legacy_tail",
      sourceCutWitness: audit.sourceCutDigest,
    }]);
  });

  it("rejects an unexpected required item instead of classifying it optional", () => {
    const snapshot = makeSnapshot();
    const audit = auditConversationDisclosureShadow({
      snapshot,
      expected: [],
      expectedSourceCuts: snapshot.sourceCuts,
    });

    expect(audit).toMatchObject({
      requirednessMismatches: 1,
      requirednessMismatchIds: [snapshot.items[0]!.id],
      optionalDifferences: [],
    });
    const artifact = buildConversationShadowParityArtifact({
      programId: "conversation-progressive-disclosure-v3.9.2-2026-08",
      featureId: "P108-conversation-disclosure-evidence-foundation",
      generatedAt: "2026-08-25T00:00:00.000Z",
      sourceDigest: `sha256:${"a".repeat(64)}`,
      fixtureDigest: `sha256:${"b".repeat(64)}`,
      integrationProof: makeIntegrationProof(),
      scopes: [audit],
    });
    expect(artifact.accepted).toBe(false);
  });

  it("detects forbidden fields and credential-shaped values recursively", () => {
    const snapshot = makeSnapshot();
    const unsafe = {
      ...snapshot,
      items: [{
        ...snapshot.items[0]!,
        summary: "api_key=must-not-persist",
        resultRef: "/private/tool-result.json",
      }],
    } as unknown as typeof snapshot;
    const audit = auditConversationDisclosureShadow({
      snapshot: unsafe,
      expected: [],
      expectedSourceCuts: unsafe.sourceCuts,
    });
    expect(audit.sensitiveLeaks).toBeGreaterThanOrEqual(2);
  });

  it("detects path-shaped values even when the containing key is allowed", () => {
    const snapshot = makeSnapshot();
    const unsafe = {
      ...snapshot,
      items: [{
        ...snapshot.items[0]!,
        summary: "Stored at [secrets/token.txt]",
      }],
    };
    const audit = auditConversationDisclosureShadow({
      snapshot: unsafe,
      expected: [],
      expectedSourceCuts: unsafe.sourceCuts,
    });

    expect(audit.sensitiveLeaks).toBeGreaterThanOrEqual(1);
  });

  it("builds and validates a canonical aggregate artifact", () => {
    const snapshot = makeSnapshot();
    const scope = auditConversationDisclosureShadow({
      snapshot,
      expected: snapshot.items.map((item) => ({
        id: item.id,
        requiredness: "required",
        lifecycle: item.lifecycle,
        canonicalBodyDigest: createConversationShadowBodyDigest(item),
      })),
      expectedSourceCuts: snapshot.sourceCuts,
    });
    const artifact = buildConversationShadowParityArtifact({
      programId: "conversation-progressive-disclosure-v3.9.2-2026-08",
      featureId: "P108-conversation-disclosure-evidence-foundation",
      generatedAt: "2026-08-25T00:00:00.000Z",
      sourceDigest: `sha256:${"a".repeat(64)}`,
      fixtureDigest: `sha256:${"b".repeat(64)}`,
      integrationProof: makeIntegrationProof(),
      scopes: [scope],
    });
    expect(artifact.schemaVersion).toBe(3);
    expect(artifact.accepted).toBe(true);
    expect(validateConversationShadowParityArtifact(artifact)).toEqual([]);
    expect(validateConversationShadowParityArtifact({
      ...artifact,
      accepted: false,
    })).toContain("shadow parity digest is stale");
    expect(validateConversationShadowParityArtifact({
      ...artifact,
      integrationProof: {
        ...artifact.integrationProof,
        status: "failed",
      },
    } as unknown as typeof artifact)).toContain(
      "shadow parity identity is invalid",
    );
  });

  it("orders parity scopes with locale-independent code-unit comparison", () => {
    const snapshot = makeSnapshot();
    const audit = auditConversationDisclosureShadow({
      snapshot,
      expected: snapshot.items.map((item) => ({
        id: item.id,
        requiredness: "required" as const,
        lifecycle: item.lifecycle,
        canonicalBodyDigest: createConversationShadowBodyDigest(item),
      })),
      expectedSourceCuts: snapshot.sourceCuts,
    });
    const artifact = buildConversationShadowParityArtifact({
      programId: "conversation-progressive-disclosure-v3.9.2-2026-08",
      featureId: "P108-conversation-disclosure-evidence-foundation",
      generatedAt: "2026-08-25T00:00:00.000Z",
      sourceDigest: `sha256:${"a".repeat(64)}`,
      fixtureDigest: `sha256:${"b".repeat(64)}`,
      integrationProof: makeIntegrationProof(),
      scopes: [
        { ...audit, scopeKey: "\u00e4" },
        { ...audit, scopeKey: "z" },
      ],
    });

    expect(artifact.scopes.map((scope) => scope.scopeKey)).toEqual([
      "z",
      "\u00e4",
    ]);
  });
});

function makeIntegrationProof() {
  return {
    kind: "production-container-vitest" as const,
    status: "passed" as const,
    command: "vitest run container parity",
    testFile: "src/main/container.test.ts",
    testFileSha256: `sha256:${"c".repeat(64)}`,
  };
}

function makeSnapshot(
  requiredness: ConversationDisclosureFact<"agent_run">["requiredness"]
    = "required",
) {
  const scope = createConversationDisclosureScope({
    surface: "chat",
    sessionId: "session_1",
    queryHash: "query:all",
  });
  const fact: ConversationDisclosureFact<"agent_run"> = {
    schemaVersion: 1,
    kind: "agent_run",
    authorityRef: "run_1",
    scope,
    domainRevision: "1",
    domainStatus: "running",
    requiredness,
    durability: "durable",
    sensitivity: "technical",
    occurredAt: "2026-08-25T00:00:00.000Z",
    payload: {
      semanticSlot: "agent-run:run_1",
      summary: "Agent run running",
      disclosureClass: "operation",
      runId: "run_1",
    },
  };
  return projectConversationDisclosureSnapshot({
    scope,
    generation: "generation:1",
    expectedSourceCuts: [],
    seeds: [{ primary: fact }],
  });
}
