import { describe, expect, it } from "vitest";
import { createChatOutputAssembler } from "./chatOutputAssembler";

describe("chat output assembler", () => {
  it("inserts final text before tool evidence when the answer arrives after tools", () => {
    const assembler = createChatOutputAssembler(
      () => "2026-06-26T08:00:00.000Z",
    );

    assembler.appendToolCall({
      toolCallId: "tool_order_1",
      toolName: "file_list",
      argumentsText: JSON.stringify({ path: "." }),
    });
    assembler.appendToolResult({
      toolCallId: "tool_order_1",
      toolName: "file_list",
      ok: true,
      resultPreview: { files: ["README.md"] },
    });

    const finalTextPart = assembler.setFinalText("Answer first.");
    if (finalTextPart) {
      finalTextPart.text = "mutated clone";
    }

    const parts = assembler.parts();
    expect(parts.map((part) => part.type)).toEqual([
      "text",
      "tool_call",
      "tool_result",
    ]);
    expect(parts[0]).toMatchObject({
      type: "text",
      text: "Answer first.",
      format: "markdown",
    });
  });

  it("redacts embedded credentials from persisted tool result and ledger parts", () => {
    const assembler = createChatOutputAssembler(
      () => "2026-08-24T00:00:00.000Z",
    );
    assembler.appendToolResult({
      toolCallId: "tool_secret_safe",
      toolName: "shell_exec",
      ok: false,
      error: "Authorization: Bearer output-error-canary",
      resultPreview: {
        stderr: "request failed api_key=output-preview-canary",
        password: "output-password-canary",
      },
    });
    assembler.appendLedgerEvent({
      status: "failed",
      title: "Bearer output-title-canary",
      detail: "token=output-detail-canary",
      toolName: "shell_exec",
    });
    assembler.appendDiagnostic({
      severity: "error",
      title: "X-Api-Key: output-diagnostic-title-canary",
      message: "client_secret=output-diagnostic-message-canary",
    });

    const serialized = JSON.stringify(assembler.parts());
    expect(serialized).toContain("[redacted]");
    expect(serialized).not.toMatch(
      /output-error-canary|output-preview-canary|output-password-canary|output-title-canary|output-detail-canary|output-diagnostic-title-canary|output-diagnostic-message-canary/,
    );
  });

  it("recomputes text redaction across split streaming chunks", () => {
    const assembler = createChatOutputAssembler(
      () => "2026-08-24T00:00:00.000Z",
    );

    assembler.appendText("api_");
    assembler.appendText("key=assembler-");
    assembler.appendText("split-canary");

    const serialized = JSON.stringify(assembler.parts());
    expect(serialized).toContain("[redacted]");
    expect(serialized).not.toContain("assembler-split-canary");
  });

  it("recomputes one answer projection across intervening tool parts", () => {
    const assembler = createChatOutputAssembler(
      () => "2026-08-24T00:00:00.000Z",
    );

    assembler.appendText("api_key=");
    assembler.appendToolCall({
      toolCallId: "tool_between_answer_chunks",
      toolName: "file_list",
      argumentsText: '{"path":"."}',
    });
    assembler.appendToolResult({
      toolCallId: "tool_between_answer_chunks",
      toolName: "file_list",
      ok: true,
      resultPreview: { files: [] },
    });
    assembler.appendText("assembler-interleaved-canary");

    const parts = assembler.parts();
    const serialized = JSON.stringify(parts);
    expect(parts.filter((part) => part.type === "text")).toEqual([
      expect.objectContaining({ text: "api_key=[redacted]" }),
    ]);
    expect(serialized).not.toContain("assembler-interleaved-canary");
  });

  it("does not replace split-safe accumulated text with an unsafe final suffix", () => {
    const assembler = createChatOutputAssembler(
      () => "2026-08-24T00:00:00.000Z",
    );
    const canary = "assembler-final-suffix-canary";

    assembler.appendText("api_key=");
    assembler.appendToolCall({
      toolCallId: "tool_before_final_suffix",
      toolName: "file_list",
    });
    assembler.appendText(canary);
    const finalPart = assembler.setFinalText(canary);

    expect(finalPart?.text).toBe("api_key=[redacted]");
    expect(JSON.stringify(assembler.parts())).not.toContain(canary);
  });

  it("sanitizes guided-input metadata without mutating the authority request", () => {
    const canary = "guided-output-canary";
    const inputRequest = {
      id: "input_secret_safe",
      executionId: "execution_secret_safe",
      sessionId: "session_secret_safe",
      requestId: "request_secret_safe",
      skillName: "publisher",
      reason: `api_key=${canary}`,
      fields: [{
        name: "api%255fkey",
        label: "Credential",
        type: "choice" as const,
        required: true,
        description: `client_secret=${canary}`,
        defaultValue: canary,
        choices: [canary],
      }],
      createdAt: "2026-08-24T00:00:00.000Z",
    };
    const original = structuredClone(inputRequest);
    const assembler = createChatOutputAssembler();

    assembler.appendInputRequest(inputRequest);

    const serialized = JSON.stringify(assembler.parts());
    expect(serialized).toContain("[redacted]");
    expect(serialized).not.toContain(canary);
    expect(inputRequest).toEqual(original);
  });
});
