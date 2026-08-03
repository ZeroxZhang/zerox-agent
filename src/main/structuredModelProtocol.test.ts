import { describe, expect, it } from "vitest";
import { completeStructuredBoundary } from "./structuredModelProtocol";
import type { ChatMessage } from "./openAiCompatibleClient";
import type { StructuredBoundaryResponse } from "./structuredModelProtocol";
import { ModelServiceNoticeError } from "../shared/modelServiceNotice";

type Call = { maxTokens: number; messages: ChatMessage[] };

const baseMessages: ChatMessage[] = [
  { role: "system", content: "system contract" },
  { role: "user", content: "user payload" },
];

function makeContract(parse?: (text: string) => { title: string }) {
  return {
    name: "test-boundary",
    baseMessages,
    parse:
      parse ??
      ((text: string) => {
        const value = JSON.parse(text) as Record<string, unknown>;
        if (typeof value.title !== "string" || !value.title.trim()) {
          throw new Error("title 必须是非空字符串。");
        }
        return { title: value.title };
      }),
    buildRepairPrompt: (error: unknown) =>
      `repair please: ${error instanceof Error ? error.message : "unknown"}`,
    buildFailure: (error: unknown) =>
      new Error(
        `boundary failed: ${error instanceof Error ? error.message : "unknown"}`,
      ),
    emptyContentError: "模型没有返回结构化内容。",
  };
}

function fakeComplete(
  queue: Array<StructuredBoundaryResponse | Error>,
  calls: Call[],
) {
  return async (request: Call): Promise<StructuredBoundaryResponse> => {
    calls.push(request);
    const next = queue.shift();
    if (!next) throw new Error("no queued response");
    if (next instanceof Error) throw next;
    return next;
  };
}

function ok(content: string): StructuredBoundaryResponse {
  return {
    content,
    finishReason: "stop",
    usage: { inputTokens: 10, outputTokens: 5 },
  };
}

function truncated(content: string): StructuredBoundaryResponse {
  return {
    content,
    finishReason: "length",
    modelServiceNotice: {
      kind: "output_limit",
      message: "模型或服务商已达到本次输出长度限制，当前内容可能不完整。",
    },
    usage: { inputTokens: 10, outputTokens: 5 },
  };
}

describe("structured model boundary protocol", () => {
  it("returns the parsed output on the first attempt", async () => {
    const calls: Call[] = [];
    const result = await completeStructuredBoundary({
      complete: fakeComplete([ok('{"title":"直达"}')], calls),
      contract: makeContract(),
      initialMaxTokens: 4096,
    });
    expect(result.output).toEqual({ title: "直达" });
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(result.diagnostics).toMatchObject({
      completionCount: 1,
      repairAttempted: false,
      outputLimitRecovered: false,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.maxTokens).toBe(4096);
  });

  it("continues a truncated response once with an escalated budget", async () => {
    const calls: Call[] = [];
    const full = '{"title":"续写恢复","extra":"done"}';
    const splitAt = Math.floor(full.length / 2);
    const result = await completeStructuredBoundary({
      complete: fakeComplete(
        [truncated(full.slice(0, splitAt)), ok(full.slice(splitAt))],
        calls,
      ),
      contract: makeContract(),
      initialMaxTokens: 4096,
    });
    expect(result.output).toEqual({ title: "续写恢复" });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.maxTokens).toBe(16384);
    expect(calls[1]?.messages).toHaveLength(4);
    expect(calls[1]?.messages[2]?.role).toBe("assistant");
    expect(calls[1]?.messages[2]?.content).toBe(full.slice(0, splitAt));
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 10 });
  });

  it("repairs malformed output once with the echoed text and accurate error", async () => {
    const calls: Call[] = [];
    const result = await completeStructuredBoundary({
      complete: fakeComplete(
        [ok('{"broken": true}'), ok('{"title":"修复成功"}')],
        calls,
      ),
      contract: makeContract(),
      initialMaxTokens: 4096,
    });
    expect(result.output).toEqual({ title: "修复成功" });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.messages).toHaveLength(4);
    expect(calls[1]?.messages[2]?.content).toBe('{"broken": true}');
    expect(calls[1]?.messages[3]?.content).toContain("repair please: title");
    expect(result.diagnostics).toMatchObject({
      completionCount: 2,
      repairAttempted: true,
      outputLimitRecovered: false,
    });
  });

  it("fails through buildFailure when the ladder is exhausted", async () => {
    const calls: Call[] = [];
    await expect(
      completeStructuredBoundary({
        complete: fakeComplete(
          [ok('{"broken": 1}'), ok('{"broken": 2}')],
          calls,
        ),
        contract: makeContract(),
        initialMaxTokens: 4096,
      }),
    ).rejects.toThrow("boundary failed: title 必须是非空字符串。");
    expect(calls).toHaveLength(2);
  });

  it("throws non-recoverable service notices without spending repairs", async () => {
    const calls: Call[] = [];
    await expect(
      completeStructuredBoundary({
        complete: fakeComplete(
          [
            {
              content: "",
              finishReason: "stop",
              modelServiceNotice: {
                kind: "rate_limit",
                message: "模型服务商正在限流，请稍后由你手动重试。",
              },
            },
          ],
          calls,
        ),
        contract: makeContract(),
        initialMaxTokens: 4096,
      }),
    ).rejects.toBeInstanceOf(ModelServiceNoticeError);
    expect(calls).toHaveLength(1);
  });

  it("treats empty content as a contract failure and repairs it", async () => {
    const calls: Call[] = [];
    const result = await completeStructuredBoundary({
      complete: fakeComplete(
        [ok(""), ok('{"title":"空响应修复"}')],
        calls,
      ),
      contract: makeContract(),
      initialMaxTokens: 4096,
    });
    expect(result.output).toEqual({ title: "空响应修复" });
    // No assistant echo for empty content: base messages + repair only.
    expect(calls[1]?.messages).toHaveLength(3);
    expect(calls[1]?.messages[2]?.content).toContain(
      "模型没有返回结构化内容。",
    );
  });
});
