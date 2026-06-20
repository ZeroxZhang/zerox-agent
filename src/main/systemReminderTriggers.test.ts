import { describe, expect, it } from "vitest";
import type { SystemReminderContext } from "../shared/systemReminder";
import {
  contextPressureTrigger,
  loopDetectionTrigger,
  structuredOutputRetryTrigger,
  modeTransitionTrigger,
  outputContinuationTrigger,
  taskGateTrigger,
} from "./systemReminderTriggers";

type Ctx = SystemReminderContext;

describe("contextPressureTrigger", () => {
  it("fires when estimatedTokens > 70% of budget", () => {
    expect(contextPressureTrigger.shouldFire({ estimatedTokens: 800, tokenBudget: 1000 })).toBe(true);
  });

  it("does not fire when under 70%", () => {
    expect(contextPressureTrigger.shouldFire({ estimatedTokens: 699, tokenBudget: 1000 })).toBe(false);
  });

  it("does not fire with zero budget", () => {
    expect(contextPressureTrigger.shouldFire({ estimatedTokens: 1, tokenBudget: 0 })).toBe(false);
  });

  it("build returns Chinese reminder with system-reminder tags", () => {
    const text = contextPressureTrigger.build({ estimatedTokens: 0, tokenBudget: 0 });
    expect(text).toContain("<system-reminder>");
    expect(text).toContain("</system-reminder>");
    expect(text).toContain("70%");
  });
});

describe("loopDetectionTrigger", () => {
  it("fires when loopCount >= 3", () => {
    expect(loopDetectionTrigger.shouldFire({ estimatedTokens: 0, tokenBudget: 0, loopCount: 3 })).toBe(true);
    expect(loopDetectionTrigger.shouldFire({ estimatedTokens: 0, tokenBudget: 0, loopCount: 5 })).toBe(true);
  });

  it("does not fire when loopCount < 3", () => {
    expect(loopDetectionTrigger.shouldFire({ estimatedTokens: 0, tokenBudget: 0, loopCount: 2 })).toBe(false);
    expect(loopDetectionTrigger.shouldFire({ estimatedTokens: 0, tokenBudget: 0, loopCount: 0 })).toBe(false);
  });

  it("does not fire when loopCount is undefined", () => {
    expect(loopDetectionTrigger.shouldFire({ estimatedTokens: 0, tokenBudget: 0 })).toBe(false);
  });

  it("build includes loop signature and count", () => {
    const text = loopDetectionTrigger.build({
      estimatedTokens: 0, tokenBudget: 0,
      loopSignature: "file_read:{path:/x}",
      loopCount: 3,
    });
    expect(text).toContain("file_read:{path:/x}");
    expect(text).toContain("3");
  });
});

describe("structuredOutputRetryTrigger", () => {
  it("fires when attempts >= 2", () => {
    expect(structuredOutputRetryTrigger.shouldFire({ estimatedTokens: 0, tokenBudget: 0, structuredOutputAttempts: 2 })).toBe(true);
  });

  it("does not fire when attempts < 2", () => {
    expect(structuredOutputRetryTrigger.shouldFire({ estimatedTokens: 0, tokenBudget: 0, structuredOutputAttempts: 1 })).toBe(false);
  });

  it("build references JSON Schema", () => {
    const text = structuredOutputRetryTrigger.build({ estimatedTokens: 0, tokenBudget: 0, structuredOutputAttempts: 3 });
    expect(text).toContain("JSON Schema");
    expect(text).toContain("3");
  });
});

describe("modeTransitionTrigger", () => {
  it("fires when mode is execution", () => {
    expect(modeTransitionTrigger.shouldFire({ estimatedTokens: 0, tokenBudget: 0, mode: "execution" })).toBe(true);
  });

  it("does not fire when mode is planning", () => {
    expect(modeTransitionTrigger.shouldFire({ estimatedTokens: 0, tokenBudget: 0, mode: "planning" })).toBe(false);
  });

  it("does not fire when mode is undefined", () => {
    expect(modeTransitionTrigger.shouldFire({ estimatedTokens: 0, tokenBudget: 0 })).toBe(false);
  });

  it("build tells model to stop planning", () => {
    const text = modeTransitionTrigger.build({ estimatedTokens: 0, tokenBudget: 0, mode: "execution" });
    expect(text).toContain("执行模式");
    expect(text).toContain("不要");
  });
});

describe("outputContinuationTrigger", () => {
  it("fires when outputTruncated is true", () => {
    expect(outputContinuationTrigger.shouldFire({ estimatedTokens: 0, tokenBudget: 0, outputTruncated: true })).toBe(true);
  });

  it("does not fire when outputTruncated is false", () => {
    expect(outputContinuationTrigger.shouldFire({ estimatedTokens: 0, tokenBudget: 0, outputTruncated: false })).toBe(false);
  });

  it("does not fire when outputTruncated is undefined", () => {
    expect(outputContinuationTrigger.shouldFire({ estimatedTokens: 0, tokenBudget: 0 })).toBe(false);
  });
});

describe("taskGateTrigger", () => {
  it("fires when there are incomplete tasks", () => {
    expect(taskGateTrigger.shouldFire({
      estimatedTokens: 0, tokenBudget: 0,
      incompleteTasks: [{ id: "1", status: "pending", summary: "Task 1" }],
    })).toBe(true);
  });

  it("does not fire when all tasks are completed", () => {
    expect(taskGateTrigger.shouldFire({
      estimatedTokens: 0, tokenBudget: 0,
      incompleteTasks: [{ id: "1", status: "completed", summary: "Task 1" }],
    })).toBe(false);
  });

  it("does not fire with empty task list", () => {
    expect(taskGateTrigger.shouldFire({ estimatedTokens: 0, tokenBudget: 0, incompleteTasks: [] })).toBe(false);
  });

  it("build lists incomplete tasks", () => {
    const text = taskGateTrigger.build({
      estimatedTokens: 0, tokenBudget: 0,
      incompleteTasks: [
        { id: "t1", status: "pending", summary: "Write tests" },
        { id: "t2", status: "in_progress", summary: "Fix bugs" },
      ],
    });
    expect(text).toContain("Write tests");
    expect(text).toContain("Fix bugs");
    expect(text).not.toContain("completed");
  });
});
