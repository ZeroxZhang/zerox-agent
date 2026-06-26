import {
  maskPreviewSecrets,
  type ChatApprovalPart,
  type ChatArtifactPart,
  type ChatCitationPart,
  type ChatCommandOutputPart,
  type ChatDiagnosticPart,
  type ChatDiffPart,
  type ChatFileRefPart,
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
    toolName?: string;
    ok: boolean;
    resultPreview?: unknown;
    error?: string;
  }): ChatOutputPart[];
  appendLedgerEvent(input: {
    status: ChatLedgerEventPart["status"];
    title: string;
    detail?: string;
    toolName?: string;
  }): ChatLedgerEventPart;
  appendApprovalRequest(input: {
    approvalId: string;
    toolName: string;
    riskLevel: ChatApprovalPart["riskLevel"];
    argsPreview?: unknown;
  }): ChatApprovalPart;
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
      let existing = toolCalls.get(toolCallId);
      if (
        existing &&
        isValidJson(existing.argumentsText) &&
        startsFreshJsonValue(input.argumentsText)
      ) {
        existing = undefined;
        toolCalls.delete(toolCallId);
      }
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
      const emitted: ChatOutputPart[] = [];
      toolCalls.delete(input.toolCallId);
      emitted.push(pushPart({
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
      }));

      for (const derivedPart of deriveStructuredToolParts({
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        resultPreview: input.resultPreview,
        now,
      })) {
        emitted.push(pushPart(derivedPart));
      }

      return emitted;
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

    appendApprovalRequest(input) {
      return pushPart({
        id: `approval_${input.approvalId}`,
        type: "approval_request",
        approvalId: input.approvalId,
        toolName: input.toolName,
        riskLevel: input.riskLevel,
        ...(input.argsPreview !== undefined
          ? { argsPreview: maskPreviewSecrets(input.argsPreview) }
          : {}),
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
    return "[partial arguments redacted until valid JSON]";
  }
}

function isValidJson(argumentsText: string): boolean {
  if (!argumentsText) {
    return false;
  }

  try {
    JSON.parse(argumentsText);
    return true;
  } catch {
    return false;
  }
}

function startsFreshJsonValue(argumentsText: string | undefined): boolean {
  const trimmed = argumentsText?.trimStart();
  return trimmed?.startsWith("{") === true || trimmed?.startsWith("[") === true;
}

function clonePart<T extends ChatOutputPart>(part: T): T {
  return structuredClone(part);
}

function deriveStructuredToolParts(options: {
  toolCallId: string;
  toolName?: string;
  resultPreview?: unknown;
  now: () => string;
}): ChatOutputPart[] {
  const payload = toRecord(options.resultPreview);
  if (!payload) {
    return [];
  }

  const derivedParts: ChatOutputPart[] = [];
  const createdAt = options.now();
  const toolName = options.toolName ?? "";

  const command = toStringValue(payload.command);
  const stdout = toOptionalStringValue(payload.stdout);
  const stderr = toOptionalStringValue(payload.stderr);
  if (command && stdout !== undefined && stderr !== undefined) {
    const commandOutput: ChatCommandOutputPart = {
      id: `command_output_${options.toolCallId}`,
      type: "command_output",
      command,
      stdout,
      stderr,
      ...(toStringValue(payload.cwd) ? { cwd: String(payload.cwd) } : {}),
      ...(toFiniteNumber(payload.exitCode) !== undefined
        ? { exitCode: toFiniteNumber(payload.exitCode) }
        : {}),
      ...(toFiniteNumber(payload.elapsedMs) !== undefined
        ? { elapsedMs: toFiniteNumber(payload.elapsedMs) }
        : {}),
      createdAt,
    };
    derivedParts.push(commandOutput);
  }

  const patch = toStringValue(payload.patch) ?? toStringValue(payload.diff);
  const diffPath = toStringValue(payload.filePath) ?? toStringValue(payload.path);
  if (patch) {
    const diffPart: ChatDiffPart = {
      id: `file_diff_${options.toolCallId}`,
      type: "file_diff",
      patch,
      ...(diffPath ? { filePath: diffPath } : {}),
      ...(toFiniteNumber(payload.additions) !== undefined
        ? { additions: toFiniteNumber(payload.additions) }
        : toFiniteNumber(payload.added) !== undefined
          ? { additions: toFiniteNumber(payload.added) }
          : {}),
      ...(toFiniteNumber(payload.deletions) !== undefined
        ? { deletions: toFiniteNumber(payload.deletions) }
        : toFiniteNumber(payload.deleted) !== undefined
          ? { deletions: toFiniteNumber(payload.deleted) }
          : {}),
      createdAt,
    };
    derivedParts.push(diffPart);
  }

  const filePath = toStringValue(payload.path);
  const fileRefAction =
    toolName === "file_read"
      ? "read"
      : toolName === "file_write" || toolName === "markdown_report_write"
        ? "wrote"
        : toolName === "git_diff"
          ? "changed"
          : undefined;
  if (filePath && fileRefAction) {
    const fileRef: ChatFileRefPart = {
      id: `file_ref_${options.toolCallId}_${fileRefAction}`,
      type: "file_ref",
      path: filePath,
      action: fileRefAction,
      createdAt,
    };
    derivedParts.push(fileRef);
  }

  const artifactId = toStringValue(payload.artifactId);
  const artifactTitle = toStringValue(payload.title);
  const artifactPath = toStringValue(payload.path);
  const mediaType = toStringValue(payload.mediaType);
  const sizeBytes = toFiniteNumber(payload.sizeBytes);
  if (artifactId || artifactTitle || (artifactPath && mediaType)) {
    const artifactPart: ChatArtifactPart = {
      id: `artifact_${options.toolCallId}`,
      type: "artifact",
      artifactId: artifactId ?? `derived_${options.toolCallId}`,
      title: artifactTitle ?? artifactPath ?? "Artifact",
      ...(artifactPath ? { path: artifactPath } : {}),
      ...(mediaType ? { mediaType } : {}),
      ...(sizeBytes !== undefined ? { sizeBytes } : {}),
      createdAt,
    };
    derivedParts.push(artifactPart);
  }

  if (Array.isArray(payload.citations)) {
    payload.citations.forEach((citation, index) => {
      const citationRecord = toRecord(citation);
      if (!citationRecord) {
        return;
      }
      const citationId = toStringValue(citationRecord.id);
      const label = toStringValue(citationRecord.label);
      const sourceTitle = toStringValue(citationRecord.sourceTitle);
      if (!citationId || !label || !sourceTitle) {
        return;
      }
      const citationPart: ChatCitationPart = {
        id: `citation_${options.toolCallId}_${index + 1}`,
        type: "citation",
        citationId,
        label,
        sourceTitle,
        ...(toStringValue(citationRecord.uri) ? { uri: String(citationRecord.uri) } : {}),
        ...(toStringValue(citationRecord.path) ? { path: String(citationRecord.path) } : {}),
        createdAt,
      };
      derivedParts.push(citationPart);
    });
  }

  return derivedParts;
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toOptionalStringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
