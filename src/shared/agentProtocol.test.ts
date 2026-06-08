import { describe, expect, it } from "vitest";
import {
  buildAgentSystemPrompt,
  buildToolDefinitions,
  parseAgentModelResponse,
  parsePlanFromResponse,
  parseReflectionFromResponse,
  serializeToolObservation,
} from "./agentProtocol";

describe("agent JSON protocol", () => {
  it("parses a JSON tool call response (fallback protocol)", () => {
    expect(
      parseAgentModelResponse(`{
        "type": "tool_call",
        "tool": "file_list",
        "args": { "path": "~/Downloads" }
      }`),
    ).toEqual({
      ok: true,
      message: {
        type: "tool_call",
        tool: "file_list",
        args: { path: "~/Downloads" },
      },
    });
  });

  it("parses a JSON final response (fallback protocol)", () => {
    expect(
      parseAgentModelResponse(`{"type":"final","message":"Done"}`),
    ).toEqual({
      ok: true,
      message: { type: "final", message: "Done" },
    });
  });

  it("rejects non-JSON and unknown tool responses", () => {
    expect(parseAgentModelResponse("I will do it.")).toMatchObject({
      ok: false,
      message: "模型回复必须是有效的 JSON。",
    });
    expect(
      parseAgentModelResponse(
        `{"type":"tool_call","tool":"delete_everything","args":{}}`,
      ),
    ).toMatchObject({
      ok: false,
      message: "模型请求了不支持的工具。",
    });
  });

  it("serializes tool observations as JSON for the next model turn", () => {
    expect(
      serializeToolObservation({
        tool: "file_read",
        ok: true,
        result: { content: "hello" },
      }),
    ).toBe(
      `{"type":"tool_result","tool":"file_read","ok":true,"result":{"content":"hello"}}`,
    );
  });

  it("serializes tool observations with toolCallId", () => {
    expect(
      serializeToolObservation({
        tool: "file_read",
        ok: false,
        error: "not found",
        toolCallId: "call_abc",
      }),
    ).toBe(
      `{"type":"tool_result","tool":"file_read","ok":false,"error":"not found","tool_call_id":"call_abc"}`,
    );
  });

  it("builds a system prompt that names the available tools and working principles", () => {
    const prompt = buildAgentSystemPrompt();

    expect(prompt).toContain("本地桌面 AI agent");
    expect(prompt).toContain("file_list");
    expect(prompt).toContain("工具");
    expect(prompt).toContain("默认使用中文");
  });

  it("builds tool definitions with JSON Schema for built-in tools", () => {
    const definitions = buildToolDefinitions();

    expect(definitions).toHaveLength(8);
    const names = definitions.map((d) => d.function.name);
    expect(names).toContain("file_list");
    expect(names).toContain("file_read");
    expect(names).toContain("file_write");
    expect(names).toContain("memory_search");
    expect(names).toContain("conversation_search");
    expect(names).toContain("web_search");
    expect(names).toContain("web_fetch");
    expect(names).toContain("shell_exec");

    for (const def of definitions) {
      expect(def.type).toBe("function");
      expect(def.function.description).toBeTruthy();
      expect(def.function.parameters).toBeTruthy();
      expect(def.function.parameters.type).toBe("object");
    }
  });

  it("parses a valid execution plan from model response", () => {
    const plan = parsePlanFromResponse(JSON.stringify({
      steps: [
        {
          description: "列出目标目录",
          expectedTool: "file_list",
          expectedOutcome: "获取文件列表",
        },
        {
          description: "生成报告",
          expectedTool: "file_write",
          expectedOutcome: "写入 Markdown 报告",
        },
      ],
      reasoning: "先了解目录结构再生成报告",
    }));

    expect(plan).not.toBeNull();
    expect(plan!.steps).toHaveLength(2);
    expect(plan!.steps[0].status).toBe("pending");
    expect(plan!.estimatedTurns).toBe(7); // 2*2 + 3
  });

  it("returns null for invalid plan responses", () => {
    expect(parsePlanFromResponse("not json")).toBeNull();
    expect(parsePlanFromResponse(JSON.stringify({ steps: [] }))).toBeNull();
    expect(parsePlanFromResponse(JSON.stringify({}))).toBeNull();
  });

  it("parses a valid reflection response", () => {
    const reflection = parseReflectionFromResponse(JSON.stringify({
      analysis: "权限不足",
      suggestion: "skip",
      adjustedApproach: "跳过此步骤",
    }));

    expect(reflection).not.toBeNull();
    expect(reflection!.suggestion).toBe("skip");
  });

  it("returns null for invalid reflection responses", () => {
    expect(parseReflectionFromResponse("not json")).toBeNull();
    expect(parseReflectionFromResponse(JSON.stringify({
      suggestion: "invalid_choice",
    }))).toBeNull();
  });
});
