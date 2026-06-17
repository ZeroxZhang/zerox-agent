import { describe, expect, it } from "vitest";
import { serializeToolObservation } from "../shared/agentProtocol";
import {
  serializeToolObservationWithOffload,
  type SerializedToolObservation,
} from "./toolObservationOffload";
import type { ToolResultOffloadStore } from "./toolResultOffloadStore";

describe("tool observation offload serializer", () => {
  it("preserves small observations in the existing format", async () => {
    const observation = {
      tool: "file_read" as const,
      ok: true,
      result: { content: "hello" },
      toolCallId: "call_1",
    };

    const serialized = await serializeToolObservationWithOffload(observation, {
      store: createRecordingStore(),
      thresholdChars: 10_000,
      runId: "run_1",
    });

    expect(serialized).toEqual<SerializedToolObservation>({
      content: serializeToolObservation(observation),
      offloaded: false,
      originalChars: serializeToolObservation(observation).length,
    });
  });

  it("offloads oversized successful observations and returns a compact ref", async () => {
    const store = createRecordingStore();
    const largeContent = "x".repeat(500);
    const observation = {
      tool: "file_read" as const,
      ok: true,
      result: {
        path: "/tmp/large.txt",
        content: largeContent,
      },
      toolCallId: "call_1",
    };
    const original = serializeToolObservation(observation);

    const serialized = await serializeToolObservationWithOffload(observation, {
      store,
      thresholdChars: 120,
      runId: "run_1",
    });
    const compact = JSON.parse(serialized.content) as Record<string, unknown>;

    expect(serialized.offloaded).toBe(true);
    expect(serialized.resultRef).toBe("tool-result-refs/ref_1.json");
    expect(serialized.originalChars).toBe(original.length);
    expect(compact).toEqual(
      expect.objectContaining({
        type: "tool_result",
        tool: "file_read",
        ok: true,
        offloaded: true,
        result_ref: "tool-result-refs/ref_1.json",
        original_chars: original.length,
        tool_call_id: "call_1",
      }),
    );
    expect(compact.summary).toEqual(expect.stringContaining("path"));
    expect(compact.summary).toEqual(expect.stringContaining("content"));
    expect(compact.result_preview).toEqual(
      expect.objectContaining({
        path: "/tmp/large.txt",
        content: expect.stringContaining("[truncated"),
      }),
    );
    expect(
      (compact.result_preview as { content: string }).content,
    ).not.toBe(largeContent);
    expect(serialized.content).not.toContain(largeContent);
    expect(store.writes).toEqual([
      {
        runId: "run_1",
        toolCallId: "call_1",
        toolName: "file_read",
        content: original,
      },
    ]);
  });

  it("keeps answerPreview prominent when oversized observations are offloaded", async () => {
    const store = createRecordingStore();
    const answerPreview = "Chrome 书签：\n- OpenAI - https://openai.com/";
    const observation = {
      tool: "chrome_bookmarks_read" as const,
      ok: true,
      result: {
        bookmarks: Array.from({ length: 200 }, (_, index) => ({
          title: `Bookmark ${index + 1}`,
          url: `https://example.com/${index + 1}`,
        })),
        profiles: [{ profileName: "Default" }],
        browser: "Google Chrome",
        bookmarkCount: 200,
        returnedBookmarkCount: 80,
        folderCount: 12,
        answerPreview,
      },
      toolCallId: "call_chrome",
    };

    const serialized = await serializeToolObservationWithOffload(observation, {
      store,
      thresholdChars: 120,
      runId: "run_chrome",
    });
    const compact = JSON.parse(serialized.content) as {
      result_preview: { answerPreview?: string };
    };

    expect(serialized.offloaded).toBe(true);
    expect(compact.result_preview.answerPreview).toBe(answerPreview);
  });

  it("keeps failed observations inline", async () => {
    const store = createRecordingStore();
    const observation = {
      tool: "file_read" as const,
      ok: false,
      error: "not found",
      toolCallId: "call_1",
    };

    const serialized = await serializeToolObservationWithOffload(observation, {
      store,
      thresholdChars: 1,
      runId: "run_1",
    });

    expect(serialized).toEqual<SerializedToolObservation>({
      content: serializeToolObservation(observation),
      offloaded: false,
      originalChars: serializeToolObservation(observation).length,
    });
    expect(store.writes).toHaveLength(0);
  });
});

function createRecordingStore(): ToolResultOffloadStore & {
  writes: Array<{
    runId?: string;
    toolCallId?: string;
    toolName: string;
    content: string;
  }>;
} {
  const writes: Array<{
    runId?: string;
    toolCallId?: string;
    toolName: string;
    content: string;
  }> = [];

  return {
    writes,
    async write(input) {
      writes.push(input);
      return {
        refId: "ref_1",
        relativePath: "tool-result-refs/ref_1.json",
        absolutePath: "/tmp/tool-result-refs/ref_1.json",
        bytesWritten: Buffer.byteLength(input.content, "utf8"),
      };
    },
    async read() {
      return null;
    },
  };
}
