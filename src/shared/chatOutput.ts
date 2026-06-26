export type ChatOutputPartBase = {
  id: string;
  evidenceRefs?: string[];
  createdAt?: string;
};

export type ChatTextPart = ChatOutputPartBase & {
  type: "text";
  text: string;
  format: "plain" | "markdown";
};

export type ChatTablePart = ChatOutputPartBase & {
  type: "table";
  columns: string[];
  rows: string[][];
  caption?: string;
};

export type ChatCodePart = ChatOutputPartBase & {
  type: "code";
  code: string;
  language?: string;
  title?: string;
};

export type ChatDiffPart = ChatOutputPartBase & {
  type: "file_diff";
  filePath?: string;
  patch: string;
  additions?: number;
  deletions?: number;
};

export type ChatCommandOutputPart = ChatOutputPartBase & {
  type: "command_output";
  command: string;
  cwd?: string;
  exitCode?: number;
  stdout: string;
  stderr: string;
  elapsedMs?: number;
};

export type ChatToolCallPart = ChatOutputPartBase & {
  type: "tool_call";
  toolCallId: string;
  toolName: string;
  toolSource?: string;
  argsPreview?: unknown;
};

export type ChatToolResultPart = ChatOutputPartBase & {
  type: "tool_result";
  toolCallId: string;
  ok: boolean;
  resultPreview?: unknown;
  error?: string;
};

export type ChatFileRefPart = ChatOutputPartBase & {
  type: "file_ref";
  path: string;
  label?: string;
  action: "read" | "wrote" | "changed" | "generated";
};

export type ChatArtifactPart = ChatOutputPartBase & {
  type: "artifact";
  artifactId: string;
  title: string;
  path?: string;
  mediaType?: string;
  sizeBytes?: number;
};

export type ChatCitationPart = ChatOutputPartBase & {
  type: "citation";
  citationId: string;
  label: string;
  sourceTitle: string;
  uri?: string;
  path?: string;
};

export type ChatApprovalPart = ChatOutputPartBase & {
  type: "approval_request";
  approvalId: string;
  toolName: string;
  riskLevel: "low" | "medium" | "high";
  argsPreview?: unknown;
};

export type ChatInputRequestPart = ChatOutputPartBase & {
  type: "input_request";
  inputRequestId: string;
  skillName: string;
  reason: string;
  fields: Array<{
    name: string;
    label: string;
    required: boolean;
    type: string;
    description?: string;
    defaultValue?: string | number | boolean;
    choices?: string[];
  }>;
};

export type ChatDiagnosticPart = ChatOutputPartBase & {
  type: "diagnostic";
  severity: "info" | "warning" | "error";
  title: string;
  message: string;
  relatedToolCallId?: string;
};

export type ChatLedgerEventPart = ChatOutputPartBase & {
  type: "ledger_event";
  status: "running" | "waiting" | "completed" | "failed" | "canceled";
  title: string;
  detail?: string;
  toolName?: string;
};

export type ChatOutputPart =
  | ChatTextPart
  | ChatTablePart
  | ChatCodePart
  | ChatDiffPart
  | ChatCommandOutputPart
  | ChatToolCallPart
  | ChatToolResultPart
  | ChatFileRefPart
  | ChatArtifactPart
  | ChatCitationPart
  | ChatApprovalPart
  | ChatInputRequestPart
  | ChatDiagnosticPart
  | ChatLedgerEventPart;

const SECRET_FIELD_PATTERN = /(token|key|secret|password|authorization)/i;

export function maskPreviewSecrets(value: unknown): unknown {
  return maskPreviewSecretsValue(value, new WeakMap<object, unknown>());
}

function maskPreviewSecretsValue(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (Array.isArray(value)) {
    const existing = seen.get(value);
    if (existing) {
      return existing;
    }
    const masked: unknown[] = [];
    seen.set(value, masked);
    for (const item of value) {
      masked.push(maskPreviewSecretsValue(item, seen));
    }
    return masked;
  }
  if (value instanceof Date || value instanceof Error) {
    return value;
  }
  if (value instanceof Map) {
    const existing = seen.get(value);
    if (existing) {
      return existing;
    }
    const masked = new Map<unknown, unknown>();
    seen.set(value, masked);
    for (const [key, item] of value) {
      masked.set(
        key,
        typeof key === "string" && SECRET_FIELD_PATTERN.test(key)
          ? "****"
          : maskPreviewSecretsValue(item, seen),
      );
    }
    return masked;
  }
  if (value instanceof Set) {
    const existing = seen.get(value);
    if (existing) {
      return existing;
    }
    const masked = new Set<unknown>();
    seen.set(value, masked);
    for (const item of value) {
      masked.add(maskPreviewSecretsValue(item, seen));
    }
    return masked;
  }
  if (value && typeof value === "object") {
    const existing = seen.get(value);
    if (existing) {
      return existing;
    }
    const masked: Record<string, unknown> = {};
    seen.set(value, masked);
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      masked[key] = SECRET_FIELD_PATTERN.test(key) ? "****" : maskPreviewSecretsValue(item, seen);
    }
    return masked;
  }
  return value;
}

export function outputPartsToPlainText(parts: ChatOutputPart[]): string {
  return parts
    .map((part) => {
      switch (part.type) {
        case "text":
          return part.text;
        case "table":
          return [
            part.caption,
            `| ${part.columns.join(" | ")} |`,
            `| ${part.columns.map(() => "---").join(" | ")} |`,
            ...part.rows.map((row) => `| ${row.join(" | ")} |`),
          ]
            .filter(Boolean)
            .join("\n");
        case "code":
          return `\`\`\`${part.language ?? ""}\n${part.code}\n\`\`\``;
        case "file_diff":
          return `\`\`\`diff\n${part.patch}\n\`\`\``;
        case "command_output":
          return [`$ ${part.command}`, part.stdout, part.stderr].filter(Boolean).join("\n");
        case "tool_call":
          return [
            `Tool call: ${part.toolName}`,
            part.toolSource ? `Source: ${part.toolSource}` : undefined,
            part.argsPreview === undefined
              ? undefined
              : `Args: ${JSON.stringify(maskPreviewSecrets(part.argsPreview), null, 2)}`,
          ]
            .filter(Boolean)
            .join("\n");
        case "tool_result":
          return [
            `Tool result: ${part.ok ? "success" : "error"}`,
            part.error,
            part.resultPreview === undefined
              ? undefined
              : `Result: ${JSON.stringify(maskPreviewSecrets(part.resultPreview), null, 2)}`,
          ]
            .filter(Boolean)
            .join("\n");
        case "file_ref":
          return `File ${part.action}: ${part.label ?? part.path}`;
        case "artifact":
          return [
            `Artifact: ${part.title}`,
            part.path,
            part.mediaType,
          ]
            .filter(Boolean)
            .join("\n");
        case "citation":
          return `[${part.citationId}] ${part.sourceTitle}`;
        case "approval_request":
          return [
            `Approval requested: ${part.toolName}`,
            `Risk: ${part.riskLevel}`,
            part.argsPreview === undefined
              ? undefined
              : `Args: ${JSON.stringify(maskPreviewSecrets(part.argsPreview), null, 2)}`,
          ]
            .filter(Boolean)
            .join("\n");
        case "input_request":
          return [
            `Input requested: ${part.skillName}`,
            part.reason,
            ...part.fields.map(
              (field) => `- ${field.label} (${field.type}, ${field.required ? "required" : "optional"})`,
            ),
          ].join("\n");
        case "diagnostic":
          return `${part.title}\n${part.message}`;
        case "ledger_event":
          return `${part.title}${part.detail ? `: ${part.detail}` : ""}`;
        default:
          return "";
      }
    })
    .filter(Boolean)
    .join("\n\n");
}
