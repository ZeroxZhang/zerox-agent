import { describe, expect, it } from "vitest";
import type { SystemPromptLayer, LayerProvider, AssembleOptions } from "./systemPromptLayer";

describe("SystemPromptLayer types", () => {
  it("creates a valid layer with all required fields", () => {
    const layer: SystemPromptLayer = {
      id: "agent.identity",
      label: "Test identity",
      content: "You are a test agent.",
      order: 1,
      protected: true,
      metadata: { version: "1.0" },
    };

    expect(layer.id).toBe("agent.identity");
    expect(layer.content).toBe("You are a test agent.");
    expect(layer.order).toBe(1);
    expect(layer.protected).toBe(true);
  });

  it("LayerProvider builds a layer from options", () => {
    const provider: LayerProvider = {
      id: "custom.user",
      order: 100,
      build(_options: AssembleOptions): SystemPromptLayer | null {
        return {
          id: "custom.user",
          label: "Custom",
          content: "Custom system text",
          order: 100,
          protected: false,
        };
      },
    };

    const layer = provider.build({ mode: "agent" });
    expect(layer).not.toBeNull();
    expect(layer!.content).toBe("Custom system text");
  });

  it("LayerProvider returns null to skip layer", () => {
    const provider: LayerProvider = {
      id: "mode.chat",
      order: 10,
      build(options: AssembleOptions): SystemPromptLayer | null {
        if (options.mode !== "chat") return null;
        return {
          id: "mode.chat",
          label: "Chat",
          content: "Chat-specific",
          order: 10,
          protected: true,
        };
      },
    };

    expect(provider.build({ mode: "agent" })).toBeNull();
    expect(provider.build({ mode: "chat" })).not.toBeNull();
  });
});
