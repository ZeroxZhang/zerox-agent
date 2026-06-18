import os from "node:os";
import path from "node:path";
import type { AgentTaskContract } from "../shared/agentTaskContract";
import type { AgentRunContext } from "../shared/agentWorkspace";
import { normalizeLocationPath } from "../shared/locationResource";
import type { TrustedArtifactWriteMetadata } from "./agentToolExecutor";

export type DeterministicGoalArtifact = {
  ref: string;
  path: string;
  provenanceRef?: string;
  provenancePath?: string;
};

export type DeterministicGoalPipelineResult = {
  status: "succeeded" | "failed";
  summary: string;
  toolNames: string[];
  artifacts: Record<string, DeterministicGoalArtifact>;
  replans: 0;
  error?: string;
};

export async function executeDeterministicGoalPipeline(input: {
  contract: AgentTaskContract;
  runContext: AgentRunContext;
  executeTool: (
    toolName: string,
    args: Record<string, unknown>,
    options?: DeterministicToolExecutionOptions,
  ) => Promise<unknown>;
}): Promise<DeterministicGoalPipelineResult> {
  const contract = input.contract as unknown as DeterministicPipelineContract;
  if (isChromeBookmarkContract(contract)) {
    return executeChromeBookmarkContract(input, contract);
  }
  if (isJsonMarkdownContract(contract)) {
    return executeJsonMarkdownContract(input, contract);
  }

  return failedResult([], "Unsupported deterministic goal contract.");
}

export function isDeterministicGoalPipelineSupported(
  contract: AgentTaskContract | undefined,
): contract is AgentTaskContract {
  if (!contract) {
    return false;
  }
  const structuralContract =
    contract as unknown as DeterministicPipelineContract;
  return (
    isChromeBookmarkContract(structuralContract) ||
    isJsonMarkdownContract(structuralContract)
  );
}

export type DeterministicToolExecutionOptions = {
  artifactWrite?: TrustedArtifactWriteMetadata;
};

export function getDeterministicGoalPipelineReadRoots(
  contract: AgentTaskContract | undefined,
  runContext: AgentRunContext,
): string[] {
  const structuralContract =
    contract as unknown as DeterministicPipelineContract | undefined;
  if (!structuralContract) {
    return [];
  }
  if (isChromeBookmarkContract(structuralContract)) {
    return [getChromeUserDataDir(runContext)];
  }
  return [];
}

async function executeChromeBookmarkContract(
  input: {
    runContext: AgentRunContext;
    executeTool: (
      toolName: string,
      args: Record<string, unknown>,
      options?: DeterministicToolExecutionOptions,
    ) => Promise<unknown>;
  },
  contract: ChromeBookmarkPipelineContract,
): Promise<DeterministicGoalPipelineResult> {
  const toolNames = ["chrome_bookmarks_read"];
  const args = {
    chromeUserDataDir: getChromeUserDataDir(input.runContext),
    ...(contract.source.profile ? { profile: contract.source.profile } : {}),
  };
  const toolResult = normalizeToolResult(
    await input.executeTool("chrome_bookmarks_read", args),
  );
  if (!toolResult.ok) {
    return failedResult(toolNames, toolResult.error);
  }

  const artifacts = collectArtifacts(toolResult.result);
  const validation = validateRequiredArtifacts(artifacts, [
    { key: "bookmarkList", ref: "artifact:bookmark_list" },
    { key: "goalEvidence", ref: "artifact:goalEvidence" },
  ]);
  if (validation) {
    return failedResult(toolNames, validation);
  }
  return {
    status: "succeeded",
    summary: "Deterministic Chrome bookmark artifact pipeline completed.",
    toolNames,
    artifacts,
    replans: 0,
  };
}

async function executeJsonMarkdownContract(
  input: {
    runContext: AgentRunContext;
    executeTool: (
      toolName: string,
      args: Record<string, unknown>,
      options?: DeterministicToolExecutionOptions,
    ) => Promise<unknown>;
  },
  contract: JsonMarkdownPipelineContract,
): Promise<DeterministicGoalPipelineResult> {
  const toolNames: string[] = [];
  toolNames.push("file_read");
  const readResult = normalizeToolResult(
    await input.executeTool("file_read", { path: contract.source.path }),
  );
  if (!readResult.ok) {
    return failedResult(toolNames, readResult.error);
  }

  const content = readString(readResult.result.content);
  if (!content) {
    return failedResult(toolNames, "file_read did not return JSON content.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    return failedResult(toolNames, `JSON fixture could not be parsed: ${(error as Error).message}`);
  }

  const artifactPath = resolveDeliverablePath(contract, input.runContext);
  const markdown = formatJsonAsMarkdown(parsed, contract);
  toolNames.push("file_write");
  const writeResult = normalizeToolResult(
    await input.executeTool(
      "file_write",
      {
        path: artifactPath,
        content: markdown,
      },
      {
        artifactWrite: {
          artifactId: contract.deliverable.artifactId,
          artifactRef: contract.deliverable.artifactRef,
          source: {
            type: "json_file",
            path: contract.source.path,
          },
        },
      },
    ),
  );
  if (!writeResult.ok) {
    return failedResult(toolNames, writeResult.error);
  }

  const artifacts = collectArtifacts(writeResult.result);
  const validation = validateRequiredArtifacts(artifacts, [
    {
      key: toArtifactKey(contract.deliverable.artifactRef),
      ref: contract.deliverable.artifactRef,
    },
  ]);
  if (validation) {
    return failedResult(toolNames, validation);
  }

  return {
    status: "succeeded",
    summary: "Deterministic JSON Markdown artifact pipeline completed.",
    toolNames,
    artifacts,
    replans: 0,
  };
}

function validateRequiredArtifacts(
  artifacts: Record<string, DeterministicGoalArtifact>,
  required: Array<{ key: string; ref: string }>,
): string | null {
  for (const requirement of required) {
    const artifact = artifacts[requirement.key];
    if (!artifact) {
      return `Required artifact ${requirement.ref} is missing.`;
    }
    if (artifact.ref !== requirement.ref) {
      return `Required artifact ${requirement.ref} returned mismatched ref ${artifact.ref}.`;
    }
    const artifactId = artifactIdFromRef(artifact.ref);
    const expectedProvenanceRef = `provenance:${artifactId}`;
    if (artifact.provenanceRef !== expectedProvenanceRef) {
      return `Required artifact ${artifact.ref} is missing matching provenance ref.`;
    }
    const expectedProvenancePath = `${artifact.path}.provenance.json`;
    if (artifact.provenancePath !== expectedProvenancePath) {
      return `Required artifact ${artifact.ref} is missing matching provenance path.`;
    }
  }
  return null;
}

function collectArtifacts(
  result: Record<string, unknown>,
): Record<string, DeterministicGoalArtifact> {
  const artifacts: Record<string, DeterministicGoalArtifact> = {};
  appendArtifact(artifacts, {
    ref: readString(result.artifactRef),
    path: readString(result.artifactPath) ?? readString(result.path),
    provenanceRef: readString(result.provenanceRef),
    provenancePath: readString(result.provenancePath),
  });
  appendArtifact(artifacts, {
    ref: readString(result.goalEvidenceRef),
    path: readString(result.goalEvidencePath),
    provenanceRef: readString(result.goalEvidenceProvenanceRef),
    provenancePath: readString(result.goalEvidenceProvenancePath),
  });
  return artifacts;
}

function appendArtifact(
  artifacts: Record<string, DeterministicGoalArtifact>,
  artifact: {
    ref: string | null;
    path: string | null;
    provenanceRef: string | null;
    provenancePath: string | null;
  },
) {
  if (!artifact.ref || !artifact.path) {
    return;
  }
  artifacts[toArtifactKey(artifact.ref)] = {
    ref: artifact.ref,
    path: artifact.path,
    ...(artifact.provenanceRef
      ? { provenanceRef: artifact.provenanceRef }
      : {}),
    ...(artifact.provenancePath
      ? { provenancePath: artifact.provenancePath }
      : {}),
  };
}

function normalizeToolResult(value: unknown):
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; error: string } {
  if (!isRecord(value)) {
    return { ok: false, error: "Tool returned a non-object result." };
  }
  if (value.ok === false) {
    return {
      ok: false,
      error: readString(value.error) ?? "Tool execution failed.",
    };
  }
  if (value.ok === true) {
    return isRecord(value.result)
      ? { ok: true, result: value.result }
      : { ok: false, error: "Tool returned an invalid success payload." };
  }
  return { ok: true, result: value };
}

function resolveDeliverablePath(
  contract: JsonMarkdownPipelineContract,
  runContext: AgentRunContext,
): string {
  const destination = contract.deliverable.destination;
  const locationEnv = {
    ...runContext.locationEnv,
    workspaceRoot: runContext.workspaceRoot,
  };
  if (destination.kind === "desktop") {
    const outputRoot = runContext.sandbox.extraWriteRoots[0];
    if (outputRoot) {
      return path.join(outputRoot, destination.filename);
    }
    return normalizeLocationPath(path.join("Desktop", destination.filename), locationEnv);
  }
  return normalizeLocationPath(destination.path, locationEnv);
}

function getChromeUserDataDir(runContext: AgentRunContext): string {
  const homeDir = runContext.locationEnv?.homeDir ?? os.homedir();
  const platform = runContext.locationEnv?.platform ?? process.platform;
  switch (platform) {
    case "darwin":
      return path.join(homeDir, "Library", "Application Support", "Google", "Chrome");
    case "win32":
      return path.join(homeDir, "AppData", "Local", "Google", "Chrome", "User Data");
    default:
      return path.join(homeDir, ".config", "google-chrome");
  }
}

function formatJsonAsMarkdown(
  value: unknown,
  contract: JsonMarkdownPipelineContract,
): string {
  const title = isRecord(value) && typeof value.title === "string"
    ? toTitleCase(value.title)
    : toTitleCase(contract.deliverable.artifactId.replace(/[_-]+/g, " "));
  return [`# ${title}`, "", ...formatJsonValue(value, 2), ""].join("\n");
}

function formatJsonValue(value: unknown, headingLevel: number): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => formatJsonArrayEntry(entry));
  }
  if (!isRecord(value)) {
    return [`- ${String(value)}`];
  }

  const lines: string[] = [];
  for (const [key, entry] of Object.entries(value)) {
    if (key === "title") {
      continue;
    }
    if (Array.isArray(entry)) {
      lines.push(`${"#".repeat(headingLevel)} ${toTitleCase(key)}`, "");
      lines.push(...entry.flatMap((item) => formatJsonArrayEntry(item)));
      lines.push("");
      continue;
    }
    if (isRecord(entry)) {
      lines.push(`${"#".repeat(headingLevel)} ${toTitleCase(key)}`, "");
      lines.push(...formatJsonValue(entry, headingLevel + 1));
      lines.push("");
      continue;
    }
    lines.push(`- **${toTitleCase(key)}:** ${String(entry)}`);
  }
  return lines;
}

function formatJsonArrayEntry(value: unknown): string[] {
  if (!isRecord(value)) {
    return [`- ${String(value)}`];
  }
  return [`- ${JSON.stringify(value)}`];
}

function failedResult(
  toolNames: string[],
  error: string,
): DeterministicGoalPipelineResult {
  return {
    status: "failed",
    summary: error,
    toolNames,
    artifacts: {},
    replans: 0,
    error,
  };
}

function toArtifactKey(ref: string): string {
  const id = artifactIdFromRef(ref);
  return id.replace(/[_:-]+([a-zA-Z0-9])/g, (_match, next: string) =>
    next.toUpperCase()
  );
}

function artifactIdFromRef(ref: string): string {
  return ref.startsWith("artifact:") ? ref.slice("artifact:".length) : ref;
}

function toTitleCase(value: string): string {
  return value
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isChromeBookmarkContract(
  contract: DeterministicPipelineContract,
): contract is ChromeBookmarkPipelineContract {
  return (
    contract.mode === "deterministic" &&
    contract.taskKind === "local_data_to_artifact" &&
    contract.source?.type === "chrome_bookmarks" &&
    contract.transform?.type === "grouped_markdown" &&
    contract.deliverable?.artifactRef === "artifact:bookmark_list" &&
    contract.capabilities?.some(
      (capability) => capability.toolName === "chrome_bookmarks_read",
    ) === true
  );
}

function isJsonMarkdownContract(
  contract: DeterministicPipelineContract,
): contract is JsonMarkdownPipelineContract {
  return (
    contract.mode === "deterministic" &&
    contract.taskKind === "local_data_to_artifact" &&
    contract.source?.type === "json_file" &&
    typeof contract.source.path === "string" &&
    contract.transform?.type === "json_markdown" &&
    contract.deliverable?.mediaType === "text/markdown" &&
    typeof contract.deliverable.artifactId === "string" &&
    typeof contract.deliverable.artifactRef === "string" &&
    contract.capabilities?.some(
      (capability) => capability.toolName === "file_read",
    ) === true &&
    contract.capabilities?.some(
      (capability) => capability.toolName === "file_write",
    ) === true
  );
}

type DeterministicPipelineContract = {
  taskKind?: unknown;
  mode?: unknown;
  source?: { type?: unknown; profile?: string; path?: unknown };
  transform?: { type?: unknown };
  deliverable?: {
    artifactId?: unknown;
    artifactRef?: unknown;
    mediaType?: unknown;
    destination?: unknown;
  };
  capabilities?: Array<{ toolName?: unknown }>;
};

type ChromeBookmarkPipelineContract = DeterministicPipelineContract & {
  taskKind: "local_data_to_artifact";
  mode: "deterministic";
  source: { type: "chrome_bookmarks"; profile?: string };
  transform: { type: "grouped_markdown" };
  deliverable: {
    artifactId: "bookmark_list";
    artifactRef: "artifact:bookmark_list";
    mediaType: "text/markdown";
    destination: { kind: "desktop"; filename: "bookmark_list.md" };
  };
  capabilities: Array<{ toolName: "chrome_bookmarks_read" }>;
};

type JsonMarkdownPipelineContract = DeterministicPipelineContract & {
  taskKind: "local_data_to_artifact";
  mode: "deterministic";
  source: { type: "json_file"; path: string };
  transform: { type: "json_markdown" };
  deliverable: {
    artifactId: string;
    artifactRef: string;
    mediaType: "text/markdown";
    destination:
      | { kind: "desktop"; filename: string }
      | { kind: "path"; path: string };
  };
  capabilities: Array<{ toolName: "file_read" | "file_write" }>;
};
