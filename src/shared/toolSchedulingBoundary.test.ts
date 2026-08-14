import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("safe tool scheduling production boundary", () => {
  it("routes shared AgentLoop batches through the bounded scheduler", () => {
    const source = read("src/main/agentLoop.ts");
    const loopBody = between(
      source,
      "export async function runAgentLoop(",
      "\nfunction isStreamingChatClient(",
    );

    expect(loopBody).toContain("scheduleToolBatch(");
    expect(loopBody).toContain("maxParallel: maxParallelToolCalls");
    expect(loopBody).toContain("createSerialToolPolicyAdmission()");
    expect(loopBody).toContain('event.stage === "dispatching"');
    expect(loopBody).toContain("release();");
    expect(loopBody).toContain("async commit(batchResult)");
    expect(loopBody).not.toContain(
      "for (const preparedToolCall of preparedToolCalls)",
    );
  });

  it("keeps unknown and side-effecting tools exclusive by default", () => {
    const source = read("src/shared/agentToolCapabilities.ts");

    expect(source).toContain('export type ToolConcurrencyMode = "parallel" | "exclusive"');
    expect(source).toContain("const PARALLEL_TOOL_OPT_INS = new Set([");
    expect(source).toContain('return "exclusive";');
    expect(source).toContain('source !== "built-in"');
    expect(source).toContain("capability.requiresConfirmation");
    expect(source).not.toContain('"file_write",\n  "parallel"');
    expect(source).not.toContain('"shell_exec",\n  "parallel"');
  });

  it("drains groups and commits settled results in index order", () => {
    const source = read("src/main/toolBatchScheduler.ts");

    expect(source).toContain("await Promise.all(");
    expect(source).toContain("await commitGroup(");
    expect(source).toContain("for (let index = start; index < end; index += 1)");
    expect(source).toContain("admissionClosed = true");
    expect(source).toContain('reason: "canceled" | "prior_failure" | "stopped"');
  });
});

function read(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function between(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}
