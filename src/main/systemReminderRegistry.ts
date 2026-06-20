import type {
  SystemReminderContext,
  SystemReminderRegistry,
  SystemReminderTrigger,
  SystemReminderTriggerType,
} from "../shared/systemReminder";
import { builtInTriggers } from "./systemReminderTriggers";

/**
 * Creates a SystemReminderRegistry with the built-in triggers pre-registered
 * but all DISABLED by default. Callers enable specific triggers via `enable()`.
 */
export function createSystemReminderRegistry(
  initialEnabled: SystemReminderTriggerType[] = [],
): SystemReminderRegistry {
  const triggers = new Map<SystemReminderTriggerType, SystemReminderTrigger>();
  const enabled = new Set<SystemReminderTriggerType>();

  // Register all built-in triggers
  for (const trigger of builtInTriggers) {
    triggers.set(trigger.type, trigger);
  }

  // Enable any initially-requested triggers
  for (const type of initialEnabled) {
    if (triggers.has(type)) {
      enabled.add(type);
    }
  }

  function evaluate(ctx: SystemReminderContext): string[] {
    const reminders: string[] = [];
    for (const type of enabled) {
      const trigger = triggers.get(type);
      if (trigger && trigger.shouldFire(ctx)) {
        reminders.push(trigger.build(ctx));
      }
    }
    return reminders;
  }

  return {
    evaluate,

    enable(type: SystemReminderTriggerType): void {
      if (triggers.has(type)) {
        enabled.add(type);
      }
    },

    disable(type: SystemReminderTriggerType): void {
      enabled.delete(type);
    },

    isEnabled(type: SystemReminderTriggerType): boolean {
      return enabled.has(type);
    },

    register(trigger: SystemReminderTrigger): void {
      triggers.set(trigger.type, trigger);
      // New triggers are enabled by default
      enabled.add(trigger.type);
    },

    remove(type: SystemReminderTriggerType): void {
      triggers.delete(type);
      enabled.delete(type);
    },
  };
}
