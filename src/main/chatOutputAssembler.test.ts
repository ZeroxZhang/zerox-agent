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
});
