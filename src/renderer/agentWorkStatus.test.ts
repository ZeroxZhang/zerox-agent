import { describe, expect, it } from "vitest";
import { buildAgentWorkSteps } from "./agentWorkStatus";

describe("agent work status", () => {
  it("shows a calm idle state before a request starts", () => {
    expect(buildAgentWorkSteps("idle").map((step) => step.status)).toEqual([
      "active",
      "waiting",
      "waiting",
      "waiting",
    ]);
  });

  it("moves the active step to model work while a reply is being generated", () => {
    expect(buildAgentWorkSteps("model")).toMatchObject([
      { label: "理解请求", status: "done" },
      { label: "检索记忆", status: "done" },
      { label: "调用模型", status: "active" },
      { label: "整理回复", status: "waiting" },
    ]);
  });

  it("marks every step complete after the agent replies", () => {
    expect(buildAgentWorkSteps("done").every((step) => step.status === "done")).toBe(
      true,
    );
  });

  it("keeps the final step active while a long task is paused", () => {
    expect(buildAgentWorkSteps("paused")).toMatchObject([
      { label: "理解请求", status: "done" },
      { label: "检索记忆", status: "done" },
      { label: "调用模型", status: "done" },
      { label: "整理回复", status: "active" },
    ]);
  });
});
