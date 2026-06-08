import { describe, expect, it } from "vitest";
import {
  extractToolResultRef,
  isSafeToolResultRef,
  summarizeToolResultContent,
} from "./toolResultRefs";

describe("tool result refs", () => {
  it("extracts safe result refs from trajectory payloads", () => {
    expect(
      extractToolResultRef({
        resultRef: "tool-result-refs/run_call_file_read_ref.json",
      }),
    ).toBe("tool-result-refs/run_call_file_read_ref.json");
    expect(
      extractToolResultRef({
        result_ref: "tool-result-refs/legacy_ref.json",
      }),
    ).toBe("tool-result-refs/legacy_ref.json");
  });

  it("rejects refs outside the tool result directory", () => {
    expect(isSafeToolResultRef("tool-result-refs/ref.json")).toBe(true);
    expect(isSafeToolResultRef("../secret.json")).toBe(false);
    expect(isSafeToolResultRef("tool-result-refs/../secret.json")).toBe(false);
    expect(isSafeToolResultRef("agent-executions/run.json")).toBe(false);
  });

  it("summarizes parsed tool result content for UI inspection", () => {
    const summary = summarizeToolResultContent(
      JSON.stringify({
        type: "tool_result",
        tool: "file_read",
        ok: true,
        result: {
          path: "/tmp/report.md",
          content: "hello world",
        },
      }),
    );

    expect(summary).toEqual({
      ok: true,
      tool: "file_read",
      resultKeys: ["path", "content"],
      originalChars: expect.any(Number),
      preview: expect.stringContaining("hello world"),
    });
  });

  it("returns a raw preview for non-json content", () => {
    expect(summarizeToolResultContent("plain text")).toEqual({
      ok: null,
      tool: "unknown",
      resultKeys: [],
      originalChars: 10,
      preview: "plain text",
    });
  });
});
