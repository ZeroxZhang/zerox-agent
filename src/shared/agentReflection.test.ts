import { describe, expect, it } from "vitest";
import { createToolFailureReflection } from "./agentReflection";

describe("agent reflection policy", () => {
  it("classifies failed test runs as verification gaps with one retry", () => {
    const reflection = createToolFailureReflection({
      toolName: "test_run",
      args: { workspaceRoot: "/repo", command: "npm test -- src/a.test.ts" },
      error: "test_run failed with exit code 1.",
      errorDetails: { kind: "exit", stdout: "", stderr: "expected 1 to equal 2" },
      previousReflections: [],
    });

    expect(reflection).toMatchObject({
      failureClass: "verification_failed",
      suggestion: "retry",
      retryAllowed: true,
      citedEvidence: "test_run failed with exit code 1.",
    });
    expect(reflection.argumentFingerprint).toContain("test_run:");
  });

  it("blocks retrying identical failed tool arguments twice", () => {
    const first = createToolFailureReflection({
      toolName: "code_search",
      args: { workspaceRoot: "/repo", query: "missingSymbol" },
      error: "No matches.",
      previousReflections: [],
    });
    const second = createToolFailureReflection({
      toolName: "code_search",
      args: { workspaceRoot: "/repo", query: "missingSymbol" },
      error: "No matches.",
      previousReflections: [first],
    });

    expect(second).toMatchObject({
      failureClass: "duplicate_retry_blocked",
      suggestion: "abort",
      retryAllowed: false,
    });
  });

  it("does not broaden permission-denied failures automatically", () => {
    const reflection = createToolFailureReflection({
      toolName: "file_write",
      args: { path: "/private/out.md" },
      error: "file_write 被运行沙箱阻止：路径不在工作区或额外可写目录内。",
      previousReflections: [],
    });

    expect(reflection).toMatchObject({
      failureClass: "permission_denied",
      suggestion: "abort",
      retryAllowed: false,
    });
  });
});
