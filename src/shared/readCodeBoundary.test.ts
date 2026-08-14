import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("read-only Code Mode boundary", () => {
  it("registers only the typed Worker DAG pilot behind its flag", () => {
    const container = read("src/main/container.ts");
    const tool = read("src/main/readCodeTool.ts");

    expect(container).toContain(
      'readFeatureFlags().ZEROX_READ_CODE_MODE === "on"',
    );
    expect(container).toContain("registerReadCodeTool(registry");
    expect(container).toContain("subcallRuntime.execute({");
    expect(tool).toContain('required: ["steps"]');
    expect(tool).toContain("runReadCodeProgram(program");
    expect(tool).not.toContain("shell_exec");
  });

  it("never evaluates model input as source code", () => {
    const runtime = read("src/main/readCodeRuntime.ts");

    expect(runtime).toContain("new Worker(READ_CODE_WORKER_SOURCE");
    expect(runtime).toContain("workerData.program");
    expect(runtime).not.toContain('require("node:fs")');
    expect(runtime).not.toContain('require("node:child_process")');
    expect(runtime).not.toContain('require("node:vm")');
    expect(runtime).not.toContain("new Function");
    expect(runtime).not.toContain("eval(workerData");
  });

  it("keeps every subcall read-only, reauthorized, bounded, and non-recursive", () => {
    const runtime = read("src/main/readCodeRuntime.ts");
    const tool = read("src/main/readCodeTool.ts");
    const toolRuntime = read("src/main/toolRuntime.ts");

    for (const denied of [
      "file_write",
      "test_run",
      "shell_exec",
      "actor",
      "workflow",
    ]) {
      expect(extractAllowlist(runtime)).not.toContain(`"${denied}"`);
    }
    expect(runtime).toContain('toolName === "read_code"');
    expect(runtime).toContain("resourceLimits:");
    expect(runtime).toContain("maxProgramBytes");
    expect(runtime).toContain("maxOutputBytes");
    expect(runtime).toContain("await Promise.allSettled([...activeCalls])");
    expect(runtime).toContain("await worker.terminate()");
    expect(tool).toContain("options.executeSubcall({");
    expect(toolRuntime).toContain("taskId,");
    expect(toolRuntime).toContain("...(runtimeTask ? { runtimeTask } : {})");
  });
});

function extractAllowlist(source: string): string {
  const start = source.indexOf("export const READ_CODE_ALLOWED_TOOLS");
  const end = source.indexOf("]);", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end + 3);
}

function read(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}
