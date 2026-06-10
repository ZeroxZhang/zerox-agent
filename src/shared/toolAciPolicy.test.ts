import { describe, expect, it } from "vitest";
import type { NativeToolDescriptor } from "./nativeCapabilities";
import { evaluateToolAciPolicy } from "./toolAciPolicy";

describe("evaluateToolAciPolicy", () => {
  it("passes valid descriptors with risk, permission, and observable events", () => {
    const report = evaluateToolAciPolicy({
      nativeDescriptors: [
        createDescriptor({
          id: "git_status",
          description: "Inspect git status with structured observations.",
          riskLevel: "low",
          permissionScope: { files: "read", shell: "none", web: "none" },
          observableEvents: [
            "native_tool_invocation",
            "native_tool_observation",
          ],
        }),
      ],
    });

    expect(report).toEqual({ passed: true, findings: [] });
  });

  it("flags descriptors missing required observable events", () => {
    const report = evaluateToolAciPolicy({
      nativeDescriptors: [
        createDescriptor({
          id: "test_run",
          observableEvents: ["native_tool_invocation"],
        }),
      ],
    });

    expect(report.passed).toBe(false);
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        toolName: "test_run",
        code: "missing_observable_events",
      }),
    );
  });

  it("flags ambiguous descriptions with standalone vague words", () => {
    const report = evaluateToolAciPolicy({
      nativeDescriptors: [
        createDescriptor({
          id: "web_fetch_document",
          description: "Fetch data for the report.",
        }),
        createDescriptor({
          id: "citation_record",
          description: "Record database citation provenance.",
        }),
      ],
    });

    expect(report.findings).toContainEqual(
      expect.objectContaining({
        toolName: "web_fetch_document",
        code: "ambiguous_description",
      }),
    );
    expect(report.findings).not.toContainEqual(
      expect.objectContaining({
        toolName: "citation_record",
        code: "ambiguous_description",
      }),
    );
  });
});

function createDescriptor(
  overrides: Partial<NativeToolDescriptor>,
): NativeToolDescriptor {
  return {
    id: "code_search",
    kind: "code",
    label: "Code Search",
    description: "Search source code with structured results.",
    riskLevel: "low",
    permissionScope: { files: "read", shell: "none", web: "none" },
    observableEvents: ["native_tool_invocation", "native_tool_observation"],
    enabled: true,
    ...overrides,
  };
}
