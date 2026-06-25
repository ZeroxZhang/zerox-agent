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

  it("returns the registration source for dynamic authorization", () => {
    const registry = createDynamicToolRegistry();
    registry.register(
      {
        type: "function",
        function: {
          name: "remote_source_lookup",
          description: "Lookup remote source.",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      async () => ({ ok: true, result: {} }),
      "mcp:research-writer:source-fetcher",
    );

    expect(registry.getSource("remote_source_lookup")).toBe(
      "mcp:research-writer:source-fetcher",
    );
    expect(registry.getSource("missing_tool")).toBeNull();
  });

  it("records source health and conflict evidence for duplicate registrations", () => {
    const registry = createDynamicToolRegistry({ now: () => "2026-06-25T00:00:00.000Z" });
    registry.register(
      {
        type: "function",
        function: {
          name: "skill_load",
          description: "Load skill.",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      async () => ({ ok: true, result: {} }),
      "built-in",
    );

    expect(() =>
      registry.register(
        {
          type: "function",
          function: {
            name: "skill_load",
            description: "Conflicting loader.",
            parameters: { type: "object", properties: {}, required: [] },
          },
        },
        async () => ({ ok: true, result: {} }),
        "skill:conflict",
      ),
    ).toThrow(/already registered/);

    expect(registry.getRegistrationConflicts()).toEqual([
      {
        toolName: "skill_load",
        existingSource: "built-in",
        attemptedSource: "skill:conflict",
        reason: "duplicate_tool_name",
        createdAt: "2026-06-25T00:00:00.000Z",
      },
    ]);
    expect(registry.getSourceHealthSnapshot()).toEqual([
      {
        source: "built-in",
        status: "ready",
        toolCount: 1,
        conflictCount: 0,
      },
      {
        source: "skill:conflict",
        status: "conflict",
        toolCount: 0,
        conflictCount: 1,
      },
    ]);
  });

  it("filters visible tools by explicit name and source without mutating registry state", () => {
    const registry = createDynamicToolRegistry();
    registry.register(
      {
        type: "function",
        function: {
          name: "skill_load",
          description: "Load skill.",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      async () => ({ ok: true, result: {} }),
      "built-in",
    );
    registry.register(
      {
        type: "function",
        function: {
          name: "skill_pack",
          description: "Skill tool.",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      async () => ({ ok: true, result: {} }),
      "skill:writer",
    );

    expect(
      registry.getVisibleDefinitions({
        allowedNames: ["skill_load"],
        allowedSources: ["skill:writer"],
      }).map((definition) => definition.function.name),
    ).toEqual(["skill_load", "skill_pack"]);
    expect(registry.getDefinitions()).toHaveLength(2);
  });

  it("returns recoverable validation errors before invoking handlers", async () => {
    let executed = false;
    const registry = createDynamicToolRegistry();
    registry.register(
      {
        type: "function",
        function: {
          name: "history_search",
          description: "Search raw history.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string" },
              limit: { type: "number" },
            },
            required: ["query"],
          },
        },
      },
      async () => {
        executed = true;
        return { ok: true, result: {} };
      },
      "built-in",
    );

    await expect(registry.execute("history_search", { limit: "10" })).resolves.toEqual({
      ok: false,
      error: "Recoverable tool argument error: query is required; limit must be number.",
      errorDetails: {
        recoverable: true,
        validationErrors: ["query is required", "limit must be number"],
      },
    });
    expect(executed).toBe(false);
  });
});
