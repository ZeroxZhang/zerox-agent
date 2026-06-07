import { describe, expect, it } from "vitest";
import { createDemoValidationSnapshot, demoRuns, demoTasks } from "./demoAgentData";
import { buildToolSafetySummary } from "../shared/toolSafetySummary";

describe("demo agent data", () => {
  it("mirrors the built-in local file organizer default task permissions", () => {
    expect(demoTasks[0]).toMatchObject({
      name: "整理下载文件夹",
      skillName: "local-file-organizer",
      schedule: { kind: "manual" },
      input: { targetDir: "~/Downloads", reportName: "agent-report.md" },
      permissions: {
        files: { read: ["~/Downloads"], write: ["~/Downloads"] },
        web: { search: false, fetchDomains: [] },
        shell: { commands: [] },
      },
    });
    expect(buildToolSafetySummary(demoTasks[0].permissions)).toMatchObject({
      tone: "confirm",
      title: "需要确认：任务可访问文件或网页",
    });
  });

  it("creates a ready preview validation snapshot for first-run flows", () => {
    const snapshot = createDemoValidationSnapshot("2026-06-07T08:00:00.000Z");

    expect(snapshot.validatedAt).toBe("2026-06-07T08:00:00.000Z");
    expect(snapshot.report).toMatchObject({
      ready: true,
      task: {
        ready: true,
        task: demoTasks[0],
      },
      run: {
        ready: true,
        ran: true,
        run: demoRuns[0],
      },
    });
  });
});
