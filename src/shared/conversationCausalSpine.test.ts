import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CONVERSATION_REQUEST_FINGERPRINT_VERSION,
  LEGACY_CONVERSATION_REQUEST_FINGERPRINT_VERSION,
  conversationCausalRefKey,
  createConversationCausalAttemptId,
  createConversationRequestFingerprint,
  createLegacyConversationRequestFingerprint,
  createConversationToolInvocationId,
  createConversationTurnId,
  fingerprintConversationAttemptControl,
  mergeConversationCausalCoverage,
  mergeConversationCausalRefs,
  resolveDurableConversationBinding,
  resolveConversationRequestFingerprintVersion,
  sanitizeToolApprovalIntentSummary,
} from "./conversationCausalSpine";

describe("conversation causal spine", () => {
  it("requires session and persisted user-message identity for a durable binding", () => {
    expect(resolveDurableConversationBinding(undefined)).toBeNull();
    expect(resolveDurableConversationBinding({ sessionId: "session-only" })).toBeNull();
    expect(resolveDurableConversationBinding({ userMessageId: "message-only" })).toBeNull();
    expect(resolveDurableConversationBinding({
      sessionId: " session-1 ",
      userMessageId: " message-1 ",
    })).toEqual({ sessionId: "session-1", userMessageId: "message-1" });
  });

  it("uses collision-safe stable identities and distinct run namespaces", () => {
    expect(createConversationTurnId("request:1")).toBe("turn-request:1");
    expect(createConversationCausalAttemptId({
      requestId: "a:b",
      turnId: "c",
      attempt: 1,
    })).not.toBe(createConversationCausalAttemptId({
      requestId: "a",
      turnId: "b:c",
      attempt: 1,
    }));
    expect(conversationCausalRefKey({ kind: "agent_run", id: "same" }))
      .not.toBe(conversationCausalRefKey({ kind: "trajectory_run", id: "same" }));
    expect(createConversationToolInvocationId({
      runId: "run:a:b",
      toolCallId: "call:c",
    })).not.toBe(createConversationToolInvocationId({
      runId: "run:a",
      toolCallId: "b:call:c",
    }));
    expect(createConversationToolInvocationId({
      runId: "run:1",
      toolCallId: "same-provider-id",
    })).not.toBe(createConversationToolInvocationId({
      runId: "run:2",
      toolCallId: "same-provider-id",
    }));
  });

  it("fingerprints canonical input independent of object key order", () => {
    expect(createConversationRequestFingerprint({ message: "hello", mode: "agent" }))
      .toBe(createConversationRequestFingerprint({ mode: "agent", message: "hello" }));
    expect(createConversationRequestFingerprint({ message: "hello" }))
      .not.toBe(createConversationRequestFingerprint({ message: "different" }));
    expect(createConversationRequestFingerprint({ value: undefined }))
      .not.toBe(createConversationRequestFingerprint({ value: "[undefined]" }));
    expect(createConversationRequestFingerprint({ value: 1n }))
      .not.toBe(createConversationRequestFingerprint({ value: "1" }));
    expect(createConversationRequestFingerprint({ value: -0 }))
      .not.toBe(createConversationRequestFingerprint({ value: 0 }));
    expect(createConversationRequestFingerprint({ message: "hello" }))
      .toMatch(/^[0-9a-f]{64}$/);
    expect(createConversationRequestFingerprint(undefined)).toBe(
      createHash("sha256").update("u").digest("hex"),
    );
  });

  it("versions exact request identity without misclassifying legacy digests", () => {
    const value = { message: "legacy-compatible" };
    const legacy = createLegacyConversationRequestFingerprint(value);
    const current = createConversationRequestFingerprint(value);
    expect(legacy).toMatch(/^[0-9a-f]{16}$/);
    expect(current).toMatch(/^[0-9a-f]{64}$/);
    expect(resolveConversationRequestFingerprintVersion({ inputFingerprint: legacy }))
      .toBe(LEGACY_CONVERSATION_REQUEST_FINGERPRINT_VERSION);
    expect(resolveConversationRequestFingerprintVersion({ inputFingerprint: current }))
      .toBe(CONVERSATION_REQUEST_FINGERPRINT_VERSION);
  });

  it("dedupes typed refs without conflating compound Tool Invocation identity", () => {
    const refs = mergeConversationCausalRefs(
      [{ kind: "tool_invocation", runId: "run:1", id: "tool:1" }],
      [
        { kind: "tool_invocation", runId: "run:1", id: "tool:1" },
        { kind: "tool_invocation", runId: "run:2", id: "tool:1" },
        { kind: "trajectory_event", runId: "run:1", eventId: "event:1" },
      ],
    );
    expect(refs).toHaveLength(3);
  });

  it("never upgrades partial or degraded coverage", () => {
    expect(mergeConversationCausalCoverage(
      { state: "complete", reasonCodes: [] },
      { state: "partial", reasonCodes: ["legacy", "legacy"] },
    )).toEqual({ state: "partial", reasonCodes: ["legacy"] });
    expect(mergeConversationCausalCoverage(
      { state: "partial", reasonCodes: ["legacy"] },
      { state: "degraded", reasonCodes: ["sink_failed"] },
    )).toEqual({
      state: "degraded",
      reasonCodes: ["legacy", "sink_failed"],
    });
  });

  it("redacts and bounds persisted approval summaries", () => {
    const safe = sanitizeToolApprovalIntentSummary({
      command: "curl -H 'Authorization: Bearer secret-token' https://example.com",
      count: 3,
      nested: { apiKey: "sk-secret-value" },
    });
    expect(JSON.stringify(safe)).not.toContain("secret-token");
    expect(JSON.stringify(safe)).not.toContain("sk-secret-value");
    expect(safe.count).toBe(3);
  });

  it("binds control fingerprints to state and accepted receipt", () => {
    const base = {
      requestId: "request:1",
      turnId: "turn:1",
      attempt: 1,
      controlSequence: 2,
      state: "accepted" as const,
      acceptedReceiptFingerprint: "receipt:1",
    };
    expect(fingerprintConversationAttemptControl(base)).not.toBe(
      fingerprintConversationAttemptControl({
        ...base,
        acceptedReceiptFingerprint: "receipt:2",
      }),
    );
  });
});
