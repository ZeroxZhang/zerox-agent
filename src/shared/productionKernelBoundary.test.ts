import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("production Kernel boundary", () => {
  it("cuts over scheduled execution and keeps other entry points explicit", () => {
    const container = read("src/main/container.ts");
    const runtime = read("src/main/agentRuntimeEngine.ts");
    const goal = read("src/main/goalRuntimeEngine.ts");
    const chat = read("src/main/chatService.ts");

    expect(container).toContain(
      'readFeatureFlags().ZEROX_PRODUCTION_KERNEL !== "scheduled"',
    );
    expect(container).toContain("createProductionKernelDriver({");
    expect(container).toContain(
      "productionKernelDriver:\n                productionKernelDriver()!",
    );
    expect(runtime).toContain(
      "await options.productionKernelDriver.run({",
    );
    expect(runtime).toContain(
      "const result = await persistLoopResult(settled);",
    );
    expect(runtime).toContain(
      "return (await executePersistedSegment()).result;",
    );
    expect(runtime).toContain("settleAborted(status) {");
    expect(goal).not.toContain("productionKernelDriver");
    expect(chat).not.toContain("productionKernelDriver");
  });

  it("projects shared AgentLoop evidence and exact terminal parity", () => {
    const runtime = read("src/main/agentRuntimeEngine.ts");
    const driver = read("src/main/kernel/productionKernelDriver.ts");

    expect(runtime).toContain("kernelReporter?.retry({");
    expect(runtime).toContain("kernelReporter?.toolCall(toolName, args)");
    expect(runtime).toContain("kernelReporter?.checkpoint(");
    expect(driver).toContain(
      "if (kernel.status !== settledSegment.status)",
    );
    expect(driver).toContain(
      "if (kernel.summary !== settledSegment.summary)",
    );
    expect(driver).toContain(
      "const unsubscribe = options.bus.subscribe((event) => {",
    );
    expect(driver).toContain("expected one run_end event");
    expect(driver).not.toContain("options.bus.history()");
  });

  it("keeps rollback explicit and scheduled checkpoint refs resumable", () => {
    const flags = read("src/shared/featureFlags.ts");
    const main = read("src/main/main.ts");

    expect(flags).toContain(
      'ZEROX_PRODUCTION_KERNEL: "scheduled" | "off"',
    );
    expect(flags).toContain('ZEROX_PRODUCTION_KERNEL: "scheduled"');
    expect(main).toContain(
      'parts.at(-3) === "agent-executions"',
    );
  });
});

function read(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}
