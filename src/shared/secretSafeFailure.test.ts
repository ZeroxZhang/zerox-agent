import { describe, expect, it } from "vitest";
import {
  SecretSafeFailureError,
  getSecretSafeFailurePrivateCause,
  toSecretSafeFailure,
} from "./secretSafeFailure";

describe("SecretSafeFailure", () => {
  it("keeps the private cause outside enumerable and serialized state", () => {
    const canary = "PRIVATE_STORAGE_CANARY";
    const error = new SecretSafeFailureError(
      "CHAT_SETTLEMENT_FAILED",
      new Error(canary),
    );

    expect(error.message).not.toContain(canary);
    expect(JSON.stringify(error)).not.toContain(canary);
    expect(JSON.stringify(error.failure)).not.toContain(canary);
    expect(getSecretSafeFailurePrivateCause(error)).toBeInstanceOf(Error);
  });

  it("maps unknown exceptions to one fixed public failure", () => {
    const failure = toSecretSafeFailure(
      new Error("PRIVATE_PROVIDER_CANARY"),
      "AGENT_RUN_EXECUTION_FAILED",
    );

    expect(failure.code).toBe("AGENT_RUN_EXECUTION_FAILED");
    expect(failure.publicMessage).not.toContain("PRIVATE_PROVIDER_CANARY");
    expect(failure.coverageReasonCodes).toEqual([
      "agent_run_execution_failed",
    ]);
  });
});
