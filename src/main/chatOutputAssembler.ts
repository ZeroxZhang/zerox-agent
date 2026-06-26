import {
  maskPreviewSecrets,
  type ChatDiagnosticPart,
  type ChatInputRequestPart,
  type ChatLedgerEventPart,
  type ChatOutputPart,
  type ChatTextPart,
  type ChatToolCallPart,
  type ChatToolResultPart,
} from "../shared/chatOutput";
import type { SkillUserInputRequest } from "../shared/chat";

export type ChatOutputAssembler = {
  appendText(text: string): ChatTextPart | undefined;
  setFinalText(text: string): ChatTextPart | undefined;
  appendToolCall(input: {
    toolCallId: string;
    toolName?: string;
    toolSource?: string;
    argumentsText?: string;
  }): ChatToolCallPart;
  appendToolResult(input: {
    toolCallId: string;
    ok: boolean;
    resultPreview?: unknown;
    error?: string;
  }): ChatToolResultPart;
  appendLedgerEvent(input: {
    status: ChatLedgerEventPart["status"];
    title: string;
    detail?: string;
    toolName?: string;
  }): ChatLedgerEventPart;
  appendInputRequest(inputRequest: SkillUserInputRequest): ChatInputRequestPart;
  appendDiagnostic(input: {
    severity: ChatDiagnosticPart["severity"];
    title: string;
    message: string;
    relatedToolCallId?: string;
  }): ChatDiagnosticPart;
  parts(): ChatOutputPart[];
};

type ToolCallBuffer = {
  part: ChatToolCallPart;
  argumentsText: string;
};

export function createChatOutputAssembler(
  now = () => new Date().toISOString(),
): ChatOutputAssembler {
  const parts: ChatOutputPart[] = [];
  const toolCalls = new Map<string, ToolCallBuffer>();

  function pushPart<T extends ChatOutputPart>(part: T): T {
    parts.push(part);
    return clonePart(part);
  }

  function appendOrUpdateText(text: string): ChatTextPart | undefined {
    if (!text) {
      return undefined;
    }

    const lastPart = parts.at(-1);
    if (lastPart?.type === "text") {
      lastPart.text += text;
      return clonePart(lastPart);
    }

    return pushPart({
      id: `text_${parts.length + 1}`,
      type: "text",
      text,
      format: "markdown",
      createdAt: now(),
    });
  }

  return {
    appendText(text) {
      return appendOrUpdateText(text);
    },

    setFinalText(text) {
      if (!text) {
        return undefined;
      }

      const firstTextIndex = parts.findIndex((part) => part.type === "text");
      if (firstTextIndex === -1) {
        return pushPart({
          id: `text_${parts.length + 1}`,
          type: "text",
          text,
          format: "markdown",
          createdAt: now(),
        });
      }

      const firstTextPart = parts[firstTextIndex];
      if (firstTextPart?.type !== "text") {
        return undefined;
      }

      firstTextPart.text = text;
      for (let index = parts.length - 1; index > firstTextIndex; index -= 1) {
        if (parts[index]?.type === "text") {
          parts.splice(index, 1);
        }
      }
      return clonePart(firstTextPart);
    },

    appendToolCall(input) {
      const toolCallId = input.toolCallId || `tool_call_${toolCalls.size + 1}`;
      const existing = toolCalls.get(toolCallId);
      const accumulatedArguments = `${existing?.argumentsText ?? ""}${input.argumentsText ?? ""}`;
      const argsPreview = normalizeArgsPreview(accumulatedArguments);

      if (existing) {
        existing.argumentsText = accumulatedArguments;
        existing.part.toolName = input.toolName ?? existing.part.toolName;
        existing.part.toolSource = input.toolSource ?? existing.part.toolSource;
        existing.part.argsPreview = maskPreviewSecrets(argsPreview);
        return clonePart(existing.part);
      }

      const part: ChatToolCallPart = {
        id: `tool_${toolCallId}`,
        type: "tool_call",
        toolCallId,
        toolName: input.toolName ?? "tool",
        ...(input.toolSource ? { toolSource: input.toolSource } : {}),
        ...(argsPreview !== undefined
          ? { argsPreview: maskPreviewSecrets(argsPreview) }
          : {}),
        createdAt: now(),
      };
      parts.push(part);
      toolCalls.set(toolCallId, {
        part,
        argumentsText: accumulatedArguments,
      });
      return clonePart(part);
    },

    appendToolResult(input) {
      return pushPart({
        id: `tool_result_${input.toolCallId}_${parts.length + 1}`,
        type: "tool_result",
        toolCallId: input.toolCallId,
        ok: input.ok,
        ...(input.ok
          ? input.resultPreview !== undefined
            ? { resultPreview: maskPreviewSecrets(input.resultPreview) }
            : {}
          : {}),
        ...(!input.ok && input.error ? { error: input.error } : {}),
        ...(!input.ok && input.resultPreview !== undefined
          ? { resultPreview: maskPreviewSecrets(input.resultPreview) }
          : {}),
        createdAt: now(),
      });
    },

    appendLedgerEvent(input) {
      return pushPart({
        id: `ledger_${parts.length + 1}`,
        type: "ledger_event",
        status: input.status,
        title: input.title,
        ...(input.detail ? { detail: input.detail } : {}),
        ...(input.toolName ? { toolName: input.toolName } : {}),
        createdAt: now(),
      });
    },

    appendInputRequest(inputRequest) {
      return pushPart({
        id: `input_${inputRequest.id}`,
        type: "input_request",
        inputRequestId: inputRequest.id,
        skillName: inputRequest.skillName,
        reason: inputRequest.reason,
        fields: inputRequest.fields.map((field) => ({
          name: field.name,
          label: field.label,
          required: field.required,
          type: field.type,
          ...(field.description ? { description: field.description } : {}),
          ...(field.defaultValue !== undefined
            ? { defaultValue: field.defaultValue }
            : {}),
          ...(field.choices?.length ? { choices: [...field.choices] } : {}),
        })),
        createdAt: now(),
      });
    },

    appendDiagnostic(input) {
      return pushPart({
        id: `diagnostic_${parts.length + 1}`,
        type: "diagnostic",
        severity: input.severity,
        title: input.title,
        message: input.message,
        ...(input.relatedToolCallId
          ? { relatedToolCallId: input.relatedToolCallId }
          : {}),
        createdAt: now(),
      });
    },

    parts() {
      return parts.map((part) => clonePart(part));
    },
  };
}

function normalizeArgsPreview(argumentsText: string): unknown {
  if (!argumentsText) {
    return undefined;
  }

  try {
    return JSON.parse(argumentsText) as unknown;
  } catch {
    return argumentsText;
  }
}

function clonePart<T extends ChatOutputPart>(part: T): T {
  return structuredClone(part);
}
