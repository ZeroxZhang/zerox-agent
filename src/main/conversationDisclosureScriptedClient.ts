import type {
  ChatClient,
  ChatCompletionRequest,
  ChatCompletionResponse,
  StreamEvent,
  StreamingChatClient,
} from "./openAiCompatibleClient";
import type { ConversationDisclosureScenarioId } from "../shared/conversationDisclosureAcceptance";

export function createConversationDisclosureScriptedClient(
  scenarioId: ConversationDisclosureScenarioId,
  options: { secretCanary?: string } = {},
): ChatClient & StreamingChatClient {
  let streamAttempt = 0;
  return {
    async complete(): Promise<ChatCompletionResponse> {
      if (scenarioId === "S15-goal-acceptance") {
        return {
          content: JSON.stringify({
            verdict: "accepted",
            reason: "The sealed bounded trajectory proves completion.",
            evidenceRefs: ["trajectory-S15-goal-acceptance"],
          }),
          toolCalls: [],
          finishReason: "stop",
          usage: {
            inputTokens: 24,
            outputTokens: 12,
            totalTokens: 36,
          },
        };
      }
      return {
        content: `Accepted production response for ${scenarioId}.`,
        toolCalls: [],
        finishReason: "stop",
        usage: {
          inputTokens: 24,
          outputTokens: 12,
          totalTokens: 36,
        },
      };
    },
    async *streamComplete(
      _request: ChatCompletionRequest,
    ): AsyncIterable<StreamEvent> {
      streamAttempt += 1;
      const lastUserContent = [..._request.messages].reverse().find(
        (message) => message.role === "user",
      )?.content ?? "";
      if (scenarioId === "S01-default-narrative" && streamAttempt === 1) {
        yield {
          type: "tool_call_delta",
          id: "cd09-s01-file-list",
          index: 0,
          name: "file_list",
          arguments: JSON.stringify({ path: "." }),
        };
        yield { type: "done", finishReason: "tool_calls" };
        return;
      }
      if (scenarioId === "S11-secret-safety" && streamAttempt === 1) {
        yield {
          type: "tool_call_delta",
          id: "cd09-s11-secret-boundary",
          index: 0,
          name: "file_list",
          arguments: JSON.stringify({
            path: `api_key=${options.secretCanary ?? "missing-canary"}`,
          }),
        };
        yield { type: "done", finishReason: "tool_calls" };
        return;
      }
      if (
        scenarioId === "S17-cancel-interruption"
        && lastUserContent.includes("cancelable")
      ) {
        yield {
          type: "content_delta",
          text: "Cancelable in-flight response.",
        };
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
      if (
        scenarioId === "S17-cancel-interruption"
        && lastUserContent.includes("real approval")
      ) {
        yield {
          type: "tool_call_delta",
          id: "cd09-s17-shell-dry-run",
          index: 0,
          name: "shell_exec",
          arguments: JSON.stringify({
            command: "git push --force-with-lease --dry-run origin HEAD",
          }),
        };
        yield { type: "done", finishReason: "tool_calls" };
        return;
      }
      if (scenarioId === "S12-retry-attempt" && streamAttempt === 1) {
        yield {
          type: "content_delta",
          text: "Rejected partial attempt.",
        };
        throw new Error("Deterministic first-attempt provider failure.");
      }
      yield {
        type: "content_delta",
        text: `Accepted production response for ${scenarioId}.`,
      };
      yield { type: "done", finishReason: "stop" };
    },
    async countTokens(request) {
      if (scenarioId === "S18-context-usage") {
        return request.messages.reduce(
          (total, message) =>
            total + Math.ceil(message.content.length / 4) + 4,
          0,
        );
      }
      return 24;
    },
  };
}
