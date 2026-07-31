import { describe, expect, it } from "vitest";
import type { RunContext } from "./kernelTypes";
import {
  createCheckpointIntervalPolicy,
  createEvidenceJudgePolicy,
} from "./stopPolicy";

describe("kernel stop policies", () => {
  it("stops when judge success evidence is present in transcript", async () => {
    const policy = createEvidenceJudgePolicy({
      condition: "verification passed",
      transcriptMessages: [
        { role: "assistant", content: "I ran npm run verify -> passed." },
      ],
      async judge() {
        return {
          ok: true,
          reason: "verification evidence is present",
          evidence: ["npm run verify -> passed"],
        };
      },
    });

    await expect(policy.shouldStop(createContext(policy), {})).resolves.toEqual({
      stop: true,
      reason: "verification evidence is present",
      evidence: ["npm run verify -> passed"],
    });
  });

  it("continues when judge reports missing work", async () => {
    const policy = createEvidenceJudgePolicy({
      condition: "three files written",
      transcriptMessages: [
        { role: "assistant", content: "I wrote two files." },
      ],
      async judge() {
        return {
          ok: false,
          reason: "one file is missing",
          missing: ["third file"],
        };
      },
    });

    await expect(policy.shouldStop(createContext(policy), {})).resolves.toEqual({
      stop: false,
      reason: "one file is missing",
      missing: ["third file"],
    });
  });

  it("rejects successful verdicts whose evidence is not in transcript", async () => {
    const policy = createEvidenceJudgePolicy({
      condition: "verification passed",
      transcriptMessages: [
        { role: "assistant", content: "I plan to run verification later." },
      ],
      async judge() {
        return {
          ok: true,
          reason: "verification passed",
          evidence: ["npm run verify -> passed"],
        };
      },
    });

    await expect(policy.shouldStop(createContext(policy), {})).resolves.toEqual({
      stop: false,
      reason: "insufficient evidence in transcript",
      missing: ["npm run verify -> passed"],
    });
  });

  it("stops as impossible when judge reports an impossible condition", async () => {
    const policy = createEvidenceJudgePolicy({
      condition: "upload to unavailable service",
      transcriptMessages: [
        { role: "assistant", content: "The required external service is unavailable." },
      ],
      async judge() {
        return {
          ok: false,
          impossible: true,
          reason: "required external service is unavailable",
        };
      },
    });

    await expect(policy.shouldStop(createContext(policy), {})).resolves.toEqual({
      stop: true,
      impossible: true,
      reason: "required external service is unavailable",
    });
  });

  it("caps evidence judge attempts with an impossible decision", async () => {
    let judgeCalls = 0;
    const policy = createEvidenceJudgePolicy({
      condition: "finish eventually",
      maxReact: 1,
      transcriptMessages: [
        { role: "assistant", content: "Still working." },
      ],
      async judge() {
        judgeCalls += 1;
        return {
          ok: false,
          reason: "not done",
        };
      },
    });

    await expect(policy.shouldStop(createContext(policy), {})).resolves.toEqual({
      stop: false,
      reason: "not done",
    });
    await expect(policy.shouldStop(createContext(policy), {})).resolves.toEqual({
      stop: true,
      impossible: true,
      reason: "evidence judge stalled without verifiable progress",
    });
    expect(judgeCalls).toBe(1);
  });

  it("treats the legacy turn limit as a checkpoint interval", async () => {
    const policy = createCheckpointIntervalPolicy();
    await expect(policy.shouldStop(createContext(policy, { turn: 2, maxTurns: 2 }), {}))
      .resolves.toEqual({
        stop: false,
        reason: "continue after checkpoint",
      });
    await expect(
      policy.shouldStop(
        createContext(policy, { turn: 3, maxTurns: 2 }),
        { completed: true },
      ),
    ).resolves.toEqual({
        stop: true,
        reason: "run completed",
      });
  });
});

function createContext(
  stopPolicy: RunContext["stopPolicy"],
  overrides: Partial<RunContext> = {},
): RunContext {
  return {
    runId: "run_1",
    mode: "goal",
    turn: 1,
    maxTurns: 12,
    stopPolicy,
    ...overrides,
  };
}
