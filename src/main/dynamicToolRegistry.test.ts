import { describe, expect, it } from "vitest";
import { createDynamicToolRegistry } from "./dynamicToolRegistry";
import { defineNativeToolDescriptor } from "../shared/nativeCapabilities";

describe("dynamic tool registry", () => {
  it("stores native descriptors next to tool definitions", async () => {
    const registry = createDynamicToolRegistry();
    const descriptor = defineNativeToolDescriptor({
      id: "git_status",
      kind: "git",
      label: "Git status",
      description: "Read status.",
      riskLevel: "low",
      permissionScope: { files: "read", shell: "none", web: "none" },
      observableEvents: ["native_tool_invocation", "native_tool_observation"],
    });

    registry.register(
      {
        type: "function",
        function: {
          name: "git_status",
          description: "Read status.",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      async () => ({ ok: true, result: { clean: true } }),
      "native",
      descriptor,
    );

    expect(registry.getNativeDescriptors()).toEqual([descriptor]);
    expect(registry.getNativeDescriptor("git_status")).toEqual(descriptor);
    await expect(registry.execute("git_status", {})).resolves.toEqual({
      ok: true,
      result: { clean: true },
    });
  });

  it("removes native descriptors when a tool is unregistered", () => {
    const registry = createDynamicToolRegistry();
    registry.register(
      {
        type: "function",
        function: {
          name: "git_diff",
          description: "Read diff.",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      async () => ({ ok: true, result: {} }),
      "native",
      defineNativeToolDescriptor({
        id: "git_diff",
        kind: "git",
        label: "Git diff",
        description: "Read diff.",
        riskLevel: "low",
        permissionScope: { files: "read", shell: "none", web: "none" },
        observableEvents: ["native_tool_invocation", "native_tool_observation"],
      }),
    );

    expect(registry.unregister("git_diff")).toBe(true);
    expect(registry.getNativeDescriptors()).toEqual([]);
    expect(registry.getNativeDescriptor("git_diff")).toBeNull();
  });
});
