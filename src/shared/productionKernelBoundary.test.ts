import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("production Kernel boundary", () => {
  it("cuts over Scheduled Task, Chat, and Goal execution", () => {
    const container = read("src/main/container.ts");
    const runtime = read("src/main/agentRuntimeEngine.ts");
    const goal = read("src/main/goalRuntimeEngine.ts");
    const chat = read("src/main/chatService.ts");
    const chatAdapter = read("src/main/kernel/chatKernelSegment.ts");
    const goalAdapter = read("src/main/kernel/goalKernelSegment.ts");
    const scope = read("src/main/kernel/productionKernelScope.ts");

    expect(container).toContain("productionKernelCovers(");
    expect(container).toContain("createProductionKernelDriver({");
    expect(container).toContain(
      "productionKernelDriver:\n                productionKernelDriver()!",
    );
    expect(runtime).toContain(
      "await options.productionKernelDriver.run({",
    );
    expect(runtime).toContain('mode: "scheduled_task"');
    expect(runtime).toContain(
      "const result = await persistLoopResult(settled);",
    );
    expect(runtime).toContain(
      "return (await executePersistedSegment()).result;",
    );
    expect(runtime).toContain("settleAborted(status) {");
    expect(driverModeContract(runtime)).toBe(true);
    expect(goal).toContain("productionKernelDriver?: ProductionKernelDriver");
    expect(goal).toContain("runGoalKernelSegment({");
    expect(chat).toContain("productionKernelDriver?: ProductionKernelDriver");
    expect(chat).toContain("runChatKernelSegment<SendChatMessageResult>");
    expect(container).toContain('productionKernelDriver("chat")');
    expect(container).toContain('productionKernelDriver("goal")');
    expect(scope).toContain('scope === "scheduled_chat"');
    expect(scope).toContain('mode !== "goal"');
    expect(chatAdapter).toContain('mode: "chat"');
    expect(chatAdapter).toContain("validateChatKernelSettlement");
    expect(chatAdapter).toContain("input.settleFailed");
    expect(goalAdapter).toContain('mode: "goal"');
    expect(goalAdapter).toContain("validateGoalKernelSettlement");
  });

  it("projects shared AgentLoop evidence and exact terminal parity", () => {
    const runtime = read("src/main/agentRuntimeEngine.ts");
    const driver = read("src/main/kernel/productionKernelDriver.ts");

    expect(runtime).toContain("kernelReporter?.retry({");
    expect(runtime).toContain(
      "const safeArgs = redactCredentials(args) as Record<string, unknown>",
    );
    expect(runtime).toContain("kernelReporter?.toolCall(toolName, safeArgs)");
    expect(runtime).not.toContain("kernelReporter?.toolCall(toolName, args)");
    expect(runtime).toContain("kernelReporter?.checkpoint(");
    expect(driver).toContain("mode: input.mode");
    expect(driver).toContain("Object.freeze({");
    expect(driver).toContain("input.settleFailed");
    expect(driver).toContain("assertSettlementStatus(settled, \"failed\"");
    expect(driver).toContain("assertSegmentParity(kernel, settledSegment)");
    expect(driver).toContain("if (kernel.status !== segment.status)");
    expect(driver).toContain("if (kernel.summary !== segment.summary)");
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
      'ZEROX_PRODUCTION_KERNEL: "all" | "scheduled_chat" | "scheduled" | "off"',
    );
    expect(flags).toContain('ZEROX_PRODUCTION_KERNEL: "all"');
    expect(main).toContain(
      'parts.at(-3) === "agent-executions"',
    );
  });
});

function read(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function driverModeContract(runtime: string): boolean {
  const invocation = runtime.slice(
    runtime.indexOf("await options.productionKernelDriver.run({"),
  );
  return invocation.indexOf('mode: "scheduled_task"') <
    invocation.indexOf("execute: executePersistedSegment");
}
