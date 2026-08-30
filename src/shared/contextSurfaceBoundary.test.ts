import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("context surface production boundary", () => {
  it("keeps the shared AgentLoop surface-owned and incrementally metered", () => {
    const source = read("src/main/agentLoop.ts");
    const surface = read("src/main/contextSurface.ts");
    const body = between(
      source,
      "export async function runAgentLoop(",
      "\nfunction isStreamingChatClient(",
    );
    const appendBody = between(
      surface,
      "  function appendSource(",
      "\n  return {\n    append(message)",
    );

    expect(body).toContain("createContextSurface({");
    expect(body).toContain(
      "contextSurface.append(redactChatMessageCredentials(message))",
    );
    expect(body).toContain(
      "redactChatMessageCredentials(message),",
    );
    expect(body).toContain(
      "redactChatMessagesCredentials(replacement),",
    );
    expect(body).not.toContain("contextSurface.append(message)");
    expect(body).not.toContain("contextSurface.insert(index, message)");
    expect(body).not.toContain("contextSurface.replace(replacement, input)");
    expect(body).toContain("messages: contextSurface.messages()");
    expect(body).toContain("contextSurface: contextSurface.snapshot()");
    expect(body.match(/\bmessages\.push\(/g)).toHaveLength(1);
    expect(body).toContain(
      "const event = contextSurface.append(redactChatMessageCredentials(message));\n    messages.push(event.message);",
    );
    expect(body).not.toContain("contextManager.estimateTokens(messages)");
    expect(appendBody).not.toContain("projectContextSurface(state)");
    expect(appendBody).toContain(
      "projection.estimatedTokens += event.estimatedTokens",
    );
  });

  it("persists the optional surface beside compatibility messages", () => {
    const execution = read("src/shared/agentExecution.ts");
    const runtime = read("src/main/agentRuntimeEngine.ts");

    expect(execution).toContain("contextSurface?: ContextSurfaceState");
    expect(runtime).toContain(
      "resumeContextSurface: current.contextSurface",
    );
    expect(runtime).toContain(
      "contextSurface: redactContextSurfaceCredentials(\n              loopCheckpoint.contextSurface",
    );
    expect(runtime).toContain(
      "contextSurface: redactContextSurfaceCredentials(\n                  loopResult.contextSurface",
    );
    expect(runtime).not.toContain(
      "contextSurface: loopCheckpoint.contextSurface",
    );
    expect(runtime).not.toContain(
      "contextSurface: loopResult.contextSurface",
    );
  });

  it("requires exact tool-name resolution before microcompaction", () => {
    const source = read("src/main/kernel/compactionStrategy.ts");

    expect(source).toContain("resolveToolNamesByCallId(messages)");
    expect(source).toContain(
      "toolNamesByCallId.get(message.tool_call_id) ?? message.name",
    );
    expect(source).toContain("regenerable.includes(toolName)");
    expect(source).not.toContain(
      "conservatively\n  // microcompact any large tool result",
    );
  });
});

function read(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function between(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}
