import { describe, expect, it } from "vitest";
import {
  computeNextRunAt,
  describeSchedule,
  draftScheduleFromText,
  normalizeScheduledTaskInput,
  validateScheduledTaskInput,
  type ScheduledTaskInput,
} from "./scheduledTasks";
import { getDefaultTaskPermissionPolicy } from "./toolPermissions";

describe("scheduled task schedules", () => {
  it("describes manual, daily, interval, and cron schedules", () => {
    expect(describeSchedule({ kind: "manual" })).toBe("手动运行");
    expect(describeSchedule({ kind: "daily", time: "09:30" })).toBe(
      "每天 09:30",
    );
    expect(
      describeSchedule({ kind: "interval", every: 45, unit: "minutes" }),
    ).toBe("每 45 分钟");
    expect(describeSchedule({ kind: "cron", expression: "*/15 * * * *" })).toBe(
      "Cron: */15 * * * *",
    );
  });

  it("computes the next interval run from a reference date", () => {
    expect(
      computeNextRunAt(
        { kind: "interval", every: 30, unit: "minutes" },
        new Date("2026-06-05T08:00:00.000Z"),
      ),
    ).toBe("2026-06-05T08:30:00.000Z");
  });

  it("computes the next daily run for today or tomorrow", () => {
    const morning = new Date(2026, 5, 5, 8, 0, 0);
    const noon = new Date(2026, 5, 5, 12, 0, 0);

    expect(computeNextRunAt({ kind: "daily", time: "09:00" }, morning)).toBe(
      new Date(2026, 5, 5, 9, 0, 0).toISOString(),
    );
    expect(computeNextRunAt({ kind: "daily", time: "09:00" }, noon)).toBe(
      new Date(2026, 5, 6, 9, 0, 0).toISOString(),
    );
  });

  it("computes the next cron run", () => {
    expect(
      computeNextRunAt(
        { kind: "cron", expression: "*/10 * * * *" },
        new Date("2026-06-05T08:03:00.000Z"),
      ),
    ).toBe("2026-06-05T08:10:00.000Z");
  });

  it("does not compute a next run for manual tasks", () => {
    expect(
      computeNextRunAt({ kind: "manual" }, new Date("2026-06-05T08:00:00Z")),
    ).toBeNull();
  });
});

describe("scheduled task validation", () => {
  const validInput: ScheduledTaskInput = {
    name: "Organize downloads",
    skillName: "local-file-organizer",
    enabled: true,
    schedule: { kind: "daily", time: "09:00" },
    input: { targetDir: "/Users/demo/Downloads" },
  };

  it("accepts a valid task input", () => {
    expect(validateScheduledTaskInput(validInput)).toEqual({
      valid: true,
      errors: {},
    });
  });

  it("normalizes names, skill names, cron expressions, and input objects", () => {
    expect(
      normalizeScheduledTaskInput({
        ...validInput,
        name: "  Organize downloads  ",
        skillName: "  local-file-organizer  ",
        schedule: { kind: "cron", expression: "  */30 * * * *  " },
        input: null as unknown as Record<string, unknown>,
      }),
    ).toEqual({
      name: "Organize downloads",
      skillName: "local-file-organizer",
      enabled: true,
      schedule: { kind: "cron", expression: "*/30 * * * *" },
      input: {},
      permissions: getDefaultTaskPermissionPolicy(),
    });
  });

  it("normalizes omitted permissions to the default deny policy", () => {
    expect(normalizeScheduledTaskInput(validInput).permissions).toEqual(
      getDefaultTaskPermissionPolicy(),
    );
  });

  it("rejects invalid schedule fields", () => {
    expect(
      validateScheduledTaskInput({
        ...validInput,
        schedule: { kind: "daily", time: "25:99" },
      }).errors.schedule,
    ).toContain("HH:mm");

    expect(
      validateScheduledTaskInput({
        ...validInput,
        schedule: { kind: "interval", every: 0, unit: "minutes" },
      }).errors.schedule,
    ).toContain("正整数");

    expect(
      validateScheduledTaskInput({
        ...validInput,
        schedule: { kind: "cron", expression: "not cron" },
      }).errors.schedule,
    ).toContain("cron");
  });

  it("rejects invalid task permission policies", () => {
    expect(
      validateScheduledTaskInput({
        ...validInput,
        permissions: {
          files: { read: ["relative/path"], write: [] },
          web: { search: false, fetchDomains: [] },
          shell: { commands: [] },
        },
      }).errors.permissions,
    ).toContain("文件权限");
  });
});

describe("natural language schedule drafts", () => {
  it("drafts interval, daily, and cron schedules from simple text", () => {
    expect(draftScheduleFromText("every 30 minutes")).toEqual({
      kind: "interval",
      every: 30,
      unit: "minutes",
    });
    expect(draftScheduleFromText("daily at 18:45")).toEqual({
      kind: "daily",
      time: "18:45",
    });
    expect(draftScheduleFromText("cron: 0 9 * * 1-5")).toEqual({
      kind: "cron",
      expression: "0 9 * * 1-5",
    });
  });

  it("drafts schedules from common Chinese text", () => {
    expect(draftScheduleFromText("每天 9 点整理下载文件夹")).toEqual({
      kind: "daily",
      time: "09:00",
    });
    expect(draftScheduleFromText("每日 09:30 运行一次")).toEqual({
      kind: "daily",
      time: "09:30",
    });
    expect(draftScheduleFromText("每 30 分钟检查一次")).toEqual({
      kind: "interval",
      every: 30,
      unit: "minutes",
    });
    expect(draftScheduleFromText("每2小时同步一次")).toEqual({
      kind: "interval",
      every: 2,
      unit: "hours",
    });
  });

  it("returns null when the text is too vague", () => {
    expect(draftScheduleFromText("sometime later")).toBeNull();
  });
});
