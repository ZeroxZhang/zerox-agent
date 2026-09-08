import {
  REASONING_PART_MAX_CHARS,
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
  type ChatModelCallPart,
  type ChatOutputPart,
  type ChatPlanStepPart,
  type ChatPlanStepStatus,
  type ChatReasoningPart,
  type ChatTextPart,
  type ChatToolCallPart,
  type ChatToolResultPart,
} from "../shared/chatOutput";
import {
  sanitizeSkillUserInputRequest,
  type SkillUserInputRequest,
} from "../shared/chat";
import {
  redactCredentials,
  redactCredentialString,
} from "../shared/credentialRedaction";
import { redactConversationDisclosurePaths } from "../shared/conversationDisclosure";

export type ChatOutputAssembler = {
  appendText(text: string): ChatTextPart | undefined;
  resetText(): void;
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
  /**
   * LD02: accumulate provider reasoning into one bounded, redacted fact.
   * Returns the current part so the caller can publish it as an output part.
   */
  appendReasoning(input: {
    text: string;
    turn?: number;
  }): ChatReasoningPart | undefined;
  /**
   * Close the current reasoning block. Returns the part once, or undefined
   * when no block is open.
   */
  completeReasoning(): ChatReasoningPart | undefined;
  /**
   * LD04: upsert one step of the active plan. The first call creates the part;
   * later calls update the same ordered step list.
   */
  upsertPlanStep(input: {
    stepId: string;
    label: string;
    status: ChatPlanStepStatus;
  }): ChatPlanStepPart;
  /** LD04: upsert the progress row for one model turn. */
  upsertModelCall(input: {
    turn: number;
    maxTurns?: number;
    toolCallsExecuted?: number;
    elapsedMs?: number;
  }): ChatModelCallPart;
  parts(): ChatOutputPart[];
};

type ToolCallBuffer = {
  part: ChatToolCallPart;
  argumentsText: string;
};

type ReasoningBuffer = {
  part: ChatReasoningPart;
  rawText: string;
};

export function createChatOutputAssembler(
  now = () => new Date().toISOString(),
): ChatOutputAssembler {
  const parts: ChatOutputPart[] = [];
  const toolCalls = new Map<string, ToolCallBuffer>();
  const rawTextByPartId = new Map<string, string>();
  let reasoningBuffer: ReasoningBuffer | null = null;

  function pushPart<T extends ChatOutputPart>(part: T): T {
    parts.push(part);
    return clonePart(part);
  }

  function completeReasoningPart(): boolean {
    if (!reasoningBuffer || !reasoningBuffer.part.streaming) {
      return false;
    }
    reasoningBuffer.part.streaming = false;
    return true;
  }

  function appendOrUpdateReasoning(input: {
    text: string;
    turn?: number;
  }): ChatReasoningPart | undefined {
    if (!input.text) {
      return undefined;
    }
    if (!reasoningBuffer) {
      const part: ChatReasoningPart = {
        id: "reasoning_1",
        type: "reasoning",
        text: "",
        redacted: false,
        truncated: false,
        streaming: true,
        ...(input.turn !== undefined ? { turn: input.turn } : {}),
        createdAt: now(),
      };
      parts.push(part);
      reasoningBuffer = { part, rawText: "" };
    }

    const buffer = reasoningBuffer;
    if (buffer.part.turn === undefined && input.turn !== undefined) {
      buffer.part.turn = input.turn;
    }
    buffer.rawText += input.text;
    const truncated = buffer.rawText.length > REASONING_PART_MAX_CHARS;
    const boundedText = truncated
      ? buffer.rawText.slice(0, REASONING_PART_MAX_CHARS)
      : buffer.rawText;
    const safeText = sanitizeReasoningText(boundedText);
    buffer.part.text = safeText;
    buffer.part.redacted = safeText !== boundedText;
    buffer.part.truncated = truncated;
    buffer.part.streaming = true;
    return clonePart(buffer.part);
  }

  function appendOrUpdateText(text: string): ChatTextPart | undefined {
    if (!text) {
      return undefined;
    }
    completeReasoningPart();

    const existingPart = parts.find(
      (part): part is ChatTextPart => part.type === "text",
    );
    if (existingPart) {
      const accumulated =
        `${rawTextByPartId.get(existingPart.id) ?? existingPart.text}${text}`;
      rawTextByPartId.set(existingPart.id, accumulated);
      existingPart.text = redactCredentialString(accumulated);
      return clonePart(existingPart);
    }

    const part: ChatTextPart = {
      id: `text_${parts.length + 1}`,
      type: "text",
      text: redactCredentialString(text),
      format: "markdown",
      createdAt: now(),
    };
    rawTextByPartId.set(part.id, text);
    return pushPart(part);
  }

  return {
    appendText(text) {
      return appendOrUpdateText(text);
    },

    resetText() {
      for (let index = parts.length - 1; index >= 0; index -= 1) {
        const part = parts[index];
        if (part?.type !== "text") continue;
        rawTextByPartId.delete(part.id);
        parts.splice(index, 1);
      }
    },

    setFinalText(text) {
      if (!text) {
        return undefined;
      }
      completeReasoningPart();

      const firstTextIndex = parts.findIndex((part) => part.type === "text");
      if (firstTextIndex === -1) {
        const part: ChatTextPart = {
          id: "text_1",
          type: "text",
          text: redactCredentialString(text),
          format: "markdown",
          createdAt: now(),
        };
        rawTextByPartId.set(part.id, text);
        parts.unshift(part);
        return clonePart(part);
      }

      const firstTextPart = parts[firstTextIndex];
      if (firstTextPart?.type !== "text") {
        return undefined;
      }

      const accumulatedRaw = rawTextByPartId.get(firstTextPart.id)
        ?? firstTextPart.text;
      const finalRaw = accumulatedRaw.endsWith(text) ? accumulatedRaw : text;
      firstTextPart.text = redactCredentialString(finalRaw);
      rawTextByPartId.set(firstTextPart.id, finalRaw);
      for (let index = parts.length - 1; index > firstTextIndex; index -= 1) {
        if (parts[index]?.type === "text") {
          rawTextByPartId.delete(parts[index].id);
          parts.splice(index, 1);
        }
      }
      return clonePart(firstTextPart);
    },

    appendToolCall(input) {
      completeReasoningPart();
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
        existing.part.argsPreview = sanitizePreview(argsPreview);
        return clonePart(existing.part);
      }

      const part: ChatToolCallPart = {
        id: `tool_${toolCallId}`,
        type: "tool_call",
        toolCallId,
        toolName: input.toolName ?? "tool",
        ...(input.toolSource ? { toolSource: input.toolSource } : {}),
        ...(argsPreview !== undefined
          ? { argsPreview: sanitizePreview(argsPreview) }
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
      completeReasoningPart();
      const emitted: ChatOutputPart[] = [];
      toolCalls.delete(input.toolCallId);
      emitted.push(pushPart({
        id: `tool_result_${input.toolCallId}_${parts.length + 1}`,
        type: "tool_result",
        toolCallId: input.toolCallId,
        ok: input.ok,
        ...(input.ok
          ? input.resultPreview !== undefined
            ? { resultPreview: sanitizePreview(input.resultPreview) }
            : {}
          : {}),
        ...(!input.ok && input.error
          ? { error: redactCredentialString(input.error) }
          : {}),
        ...(!input.ok && input.resultPreview !== undefined
          ? { resultPreview: sanitizePreview(input.resultPreview) }
          : {}),
        createdAt: now(),
      }));

      for (const derivedPart of deriveStructuredToolParts({
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        resultPreview: sanitizePreview(input.resultPreview),
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
        title: redactCredentialString(input.title),
        ...(input.detail
          ? { detail: redactCredentialString(input.detail) }
          : {}),
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
          ? { argsPreview: sanitizePreview(input.argsPreview) }
          : {}),
        createdAt: now(),
      });
    },

    appendInputRequest(inputRequest) {
      const safeInputRequest = sanitizeSkillUserInputRequest(inputRequest);
      return pushPart({
        id: `input_${safeInputRequest.id}`,
        type: "input_request",
        inputRequestId: safeInputRequest.id,
        skillName: safeInputRequest.skillName,
        reason: safeInputRequest.reason,
        fields: safeInputRequest.fields.map((field) => ({
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
        title: redactCredentialString(input.title),
        message: redactCredentialString(input.message),
        ...(input.relatedToolCallId
          ? { relatedToolCallId: input.relatedToolCallId }
          : {}),
        createdAt: now(),
      });
    },

    appendReasoning(input) {
      return appendOrUpdateReasoning(input);
    },

    completeReasoning() {
      if (!reasoningBuffer) {
        return undefined;
      }
      const changed = completeReasoningPart();
      return changed ? clonePart(reasoningBuffer.part) : undefined;
    },

    upsertPlanStep(input) {
      let part = parts.find(
        (candidate): candidate is ChatPlanStepPart =>
          candidate.type === "plan_step",
      );
      if (!part) {
        part = {
          id: "plan_step_1",
          type: "plan_step",
          steps: [],
          currentIndex: -1,
          total: 0,
          createdAt: now(),
        };
        parts.push(part);
      }
      const existing = part.steps.find((step) => step.id === input.stepId);
      if (existing) {
        existing.label = input.label;
        existing.status = input.status;
      } else {
        part.steps.push({
          id: input.stepId,
          label: input.label,
          status: input.status,
        });
      }
      part.total = part.steps.length;
      part.currentIndex = part.steps.findIndex(
        (step) => step.status === "active",
      );
      return clonePart(part);
    },

    upsertModelCall(input) {
      const id = `model_call_${input.turn}`;
      let part = parts.find(
        (candidate): candidate is ChatModelCallPart =>
          candidate.type === "model_call" && candidate.id === id,
      );
      if (!part) {
        part = {
          id,
          type: "model_call",
          turn: input.turn,
          createdAt: now(),
        };
        parts.push(part);
      }
      if (input.maxTurns !== undefined) part.maxTurns = input.maxTurns;
      if (input.toolCallsExecuted !== undefined) {
        part.toolCallsExecuted = input.toolCallsExecuted;
      }
      if (input.elapsedMs !== undefined) part.elapsedMs = input.elapsedMs;
      return clonePart(part);
    },

    parts() {
      completeReasoningPart();
      return parts.map((part) => clonePart(part));
    },
  };
}

function sanitizePreview(value: unknown): unknown {
  return maskPreviewSecrets(redactCredentials(value));
}

/**
 * LD02: reasoning text is a safe summary, never raw chain of thought. Apply
 * the same credential and path redaction used for disclosure summaries before
 * the text can be persisted or delivered.
 */
function sanitizeReasoningText(text: string): string {
  return redactConversationDisclosurePaths(redactCredentialString(text));
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
