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
});
