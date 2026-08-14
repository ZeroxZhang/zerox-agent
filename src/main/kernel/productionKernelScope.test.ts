import { describe, expect, it } from "vitest";
import { productionKernelCovers } from "./productionKernelScope";

describe("Production Kernel scope", () => {
  it.each([
    ["all", [true, true, true]],
    ["scheduled_chat", [true, true, false]],
    ["scheduled", [true, false, false]],
    ["off", [false, false, false]],
  ] as const)("%s has explicit surface coverage", (scope, expected) => {
    expect([
      productionKernelCovers(scope, "scheduled_task"),
      productionKernelCovers(scope, "chat"),
      productionKernelCovers(scope, "goal"),
    ]).toEqual(expected);
  });
});
