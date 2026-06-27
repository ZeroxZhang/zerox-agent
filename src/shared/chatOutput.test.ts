import { describe, expect, it } from "vitest";
import {
  maskPreviewSecrets,
  outputPartsToPlainText,
  type ChatOutputPart,
} from "./chatOutput";

describe("chat output parts", () => {
  it("keeps fallback text for tables, code, command output, and citations", () => {
    const parts: ChatOutputPart[] = [
      { id: "p1", type: "text", text: "Result", format: "markdown" },
      {
        id: "t1",
        type: "table",
        caption: "Scores",
        columns: ["Name", "Score"],
        rows: [
          ["A", "9"],
          ["B", "8"],
        ],
      },
      {
        id: "c1",
        type: "code",
        language: "ts",
        code: "const ok = true;",
        title: "example.ts",
      },
      {
        id: "cmd1",
        type: "command_output",
        command: "npm test",
        cwd: "/repo",
        exitCode: 0,
        stdout: "1 passed",
        stderr: "",
      },
      {
        id: "s1",
        type: "citation",
        citationId: "1",
        label: "Spec",
        sourceTitle: "Design Spec",
        uri: "docs/spec.md",
      },
    ];

    expect(outputPartsToPlainText(parts)).toContain("Result");
    expect(outputPartsToPlainText(parts)).toContain("| Name | Score |");
    expect(outputPartsToPlainText(parts)).toContain("```ts");
    expect(outputPartsToPlainText(parts)).toContain("$ npm test");
    expect(outputPartsToPlainText(parts)).toContain("[1] Design Spec");
  });

  it("keeps fallback text for diffs, tool data, file refs, artifacts, approvals, guided input, and diagnostics", () => {
    const parts: ChatOutputPart[] = [
      {
        id: "d1",
        type: "file_diff",
        filePath: "src/shared/chat.ts",
        patch: "@@ -1 +1 @@\n-old\n+new",
      },
      {
        id: "tc1",
        type: "tool_call",
        toolCallId: "call_1",
        toolName: "file_read",
        toolSource: "local",
        argsPreview: { path: "/repo/src/shared/chat.ts", apiKey: "secret" },
      },
      {
        id: "tr1",
        type: "tool_result",
        toolCallId: "call_1",
        ok: true,
        resultPreview: { lines: 42, authorization: "Bearer secret" },
      },
      {
        id: "f1",
        type: "file_ref",
        path: "/repo/src/shared/chat.ts",
        label: "chat.ts",
        action: "changed",
      },
      {
        id: "a1",
        type: "artifact",
        artifactId: "artifact_1",
        title: "Task report",
        path: "/repo/report.md",
        mediaType: "text/markdown",
      },
      {
        id: "ap1",
        type: "approval_request",
        approvalId: "approval_1",
        toolName: "exec_command",
        riskLevel: "high",
        argsPreview: { command: "rm -rf /tmp/demo", token: "super-secret" },
      },
      {
        id: "i1",
        type: "input_request",
        inputRequestId: "input_1",
        skillName: "research",
        reason: "Need the target topic.",
        fields: [{ name: "topic", label: "Topic", required: true, type: "string" }],
      },
      {
        id: "diag1",
        type: "diagnostic",
        severity: "warning",
        title: "Preview truncated",
        message: "Showing the first 20 lines only.",
      },
    ];

    const plainText = outputPartsToPlainText(parts);

    expect(plainText).toContain("```diff");
    expect(plainText).toContain("Tool call: file_read");
    expect(plainText).toContain('"apiKey": "****"');
    expect(plainText).toContain("Tool result: success");
    expect(plainText).toContain('"authorization": "****"');
    expect(plainText).toContain("File changed: chat.ts");
    expect(plainText).toContain("Artifact: Task report");
    expect(plainText).toContain("Approval requested: exec_command");
    expect(plainText).toContain('"token": "****"');
    expect(plainText).toContain("Input requested: research");
    expect(plainText).toContain("- Topic (string, required)");
    expect(plainText).toContain("Preview truncated");
  });

  it("masks secret-like JSON fields in previews", () => {
    expect(
      maskPreviewSecrets({
        apiKey: "sk-local-secret",
        nested: { authorization: "Bearer token", count: 3 },
      }),
    ).toEqual({
      apiKey: "****",
      nested: { authorization: "****", count: 3 },
    });
  });

  it("preserves special objects while still masking plain object secrets", () => {
    const createdAt = new Date("2026-06-26T00:00:00.000Z");
    const failure = new Error("boom");

    const masked = maskPreviewSecrets({
      createdAt,
      failure,
      nested: { password: "super-secret" },
    }) as {
      createdAt: Date;
      failure: Error;
      nested: { password: string };
    };

    expect(masked.createdAt).toBe(createdAt);
    expect(masked.failure).toBe(failure);
    expect(masked.nested.password).toBe("****");
  });

  it("masks secret-like Map entries and nested Map values", () => {
    const masked = maskPreviewSecrets(
      new Map<string, unknown>([
        ["apiKey", "sk-local-secret"],
        ["nested", { password: "super-secret", count: 3 }],
      ]),
    ) as Map<string, unknown>;

    expect(masked).toBeInstanceOf(Map);
    expect(masked.get("apiKey")).toBe("****");
    expect(masked.get("nested")).toEqual({ password: "****", count: 3 });
  });

  it("masks secret-like values inside Sets", () => {
    const masked = maskPreviewSecrets(
      new Set<unknown>([{ authorization: "Bearer local-secret", count: 3 }]),
    ) as Set<unknown>;

    expect(masked).toBeInstanceOf(Set);
    expect(Array.from(masked)).toEqual([{ authorization: "****", count: 3 }]);
  });

  it("serializes circular preview values in plain text fallbacks while masking secrets", () => {
    const argsPreview: Record<string, unknown> = {
      command: "npm test",
      apiKey: "sk-local-secret",
    };
    argsPreview.self = argsPreview;
    const resultPreview: Record<string, unknown> = {
      ok: true,
      authorization: "Bearer local-secret",
    };
    resultPreview.self = resultPreview;
    const approvalArgsPreview: Record<string, unknown> = {
      command: "deploy",
      password: "local-secret",
    };
    approvalArgsPreview.self = approvalArgsPreview;

    const plainText = outputPartsToPlainText([
      {
        id: "tc-circular",
        type: "tool_call",
        toolCallId: "call_circular",
        toolName: "shell_exec",
        argsPreview,
      },
      {
        id: "tr-circular",
        type: "tool_result",
        toolCallId: "call_circular",
        ok: true,
        resultPreview,
      },
      {
        id: "ap-circular",
        type: "approval_request",
        approvalId: "approval_circular",
        toolName: "shell_exec",
        riskLevel: "high",
        argsPreview: approvalArgsPreview,
      },
    ]);

    expect(plainText).toContain("Tool call: shell_exec");
    expect(plainText).toContain("Tool result: success");
    expect(plainText).toContain("Approval requested: shell_exec");
    expect(plainText).toContain('"apiKey": "****"');
    expect(plainText).toContain('"authorization": "****"');
    expect(plainText).toContain('"password": "****"');
    expect(plainText).toContain('"self": "[Circular]"');
    expect(plainText).not.toContain("sk-local-secret");
    expect(plainText).not.toContain("Bearer local-secret");
    expect(plainText).not.toContain("local-secret");
  });
});
