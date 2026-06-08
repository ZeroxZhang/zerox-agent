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
        memory: { read: false, write: false },
      },
    });
    expect(buildToolSafetySummary(demoTasks[0].permissions)).toMatchObject({
      tone: "confirm",
      title: "需要确认：任务可访问文件、网页或记忆",
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

  it("includes workspace context and child lineage in demo runs", () => {
    expect(demoRuns[0]).toMatchObject({
      runContext: {
        workspaceId: "workspace_demo",
        workspaceRoot: "/Users/demo/Zerox/workspaces/default",
        agentRole: "primary",
        depth: 0,
      },
      childRunIds: ["demo_run_3"],
    });
    expect(demoRuns.find((run) => run.id === "demo_run_3")).toMatchObject({
      runContext: {
        parentRunId: "demo_run_1",
        sessionId: "session_demo",
        agentRole: "executor",
        depth: 1,
      },
    });
  });
});
