import { describe, expect, it } from "vitest";
import { getAppMeta } from "./appMeta";

describe("getAppMeta", () => {
  it("returns the Zerox Agent desktop agent identity and areas", () => {
    expect(getAppMeta()).toEqual({
      productName: "Zerox Agent",
      tagline: "从留白开始行动的本地桌面智能体。",
      modules: ["会话", "运行", "任务", "设置"],
    });
  });
});
