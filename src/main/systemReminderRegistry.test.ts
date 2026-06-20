import { describe, expect, it, beforeEach } from "vitest";
import type { SystemReminderRegistry, SystemReminderContext } from "../shared/systemReminder";
import { createSystemReminderRegistry } from "./systemReminderRegistry";

describe("SystemReminderRegistry", () => {
  let registry: SystemReminderRegistry;

  beforeEach(() => {
    registry = createSystemReminderRegistry();
  });

  it("all triggers default to disabled", () => {
    expect(registry.isEnabled("context_pressure")).toBe(false);
    expect(registry.isEnabled("loop_detection")).toBe(false);
    expect(registry.isEnabled("structured_output_retry")).toBe(false);
    expect(registry.isEnabled("mode_transition")).toBe(false);
    expect(registry.isEnabled("output_continuation")).toBe(false);
    expect(registry.isEnabled("task_gate")).toBe(false);
  });

  it("evaluate returns empty when no triggers enabled", () => {
    const ctx: SystemReminderContext = {
      estimatedTokens: 800,
      tokenBudget: 1000,
      loopCount: 5,
    };
    const reminders = registry.evaluate(ctx);
    expect(reminders).toHaveLength(0);
  });

  it("evaluate returns reminders for enabled triggers that fire", () => {
    registry.enable("context_pressure");
    registry.enable("loop_detection");

    const ctx: SystemReminderContext = {
      estimatedTokens: 800,
      tokenBudget: 1000,
      loopCount: 3,
    };

    const reminders = registry.evaluate(ctx);
    expect(reminders.length).toBeGreaterThanOrEqual(1);
  });

  it("evaluate skips disabled triggers even if context matches", () => {
    // context_pressure is disabled by default, so even though ctx > 70%, no reminder
    const ctx: SystemReminderContext = {
      estimatedTokens: 900,
      tokenBudget: 1000,
    };

    const reminders = registry.evaluate(ctx);
    expect(reminders).toHaveLength(0);
  });

  it("enable/disable toggles trigger state", () => {
    expect(registry.isEnabled("context_pressure")).toBe(false);
    registry.enable("context_pressure");
    expect(registry.isEnabled("context_pressure")).toBe(true);
    registry.disable("context_pressure");
    expect(registry.isEnabled("context_pressure")).toBe(false);
  });

  it("can initialize with pre-enabled triggers", () => {
    const r = createSystemReminderRegistry(["context_pressure"]);
    expect(r.isEnabled("context_pressure")).toBe(true);
    expect(r.isEnabled("loop_detection")).toBe(false);
  });

  it("register adds a custom trigger that is enabled by default", () => {
    registry.register({
      type: "context_pressure", // override built-in
      shouldFire: () => true,
      build: () => "custom-reminder",
    });

    expect(registry.isEnabled("context_pressure")).toBe(true);
    const reminders = registry.evaluate({ estimatedTokens: 0, tokenBudget: 0 });
    expect(reminders).toEqual(["custom-reminder"]);
  });

  it("remove deletes a trigger", () => {
    registry.enable("context_pressure");
    expect(registry.isEnabled("context_pressure")).toBe(true);
    registry.remove("context_pressure");
    expect(registry.isEnabled("context_pressure")).toBe(false);
    // evaluate should not throw for removed trigger
    const reminders = registry.evaluate({ estimatedTokens: 0, tokenBudget: 0 });
    expect(reminders).toHaveLength(0);
  });
});
