import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type {
  GoalEvidenceArtifact,
  GoalEvidenceManifest,
} from "../shared/agentGoal";
import {
  normalizeLocationBoundaryPath,
  normalizeLocationEnvironment,
  validatePathInsideLocationRoots,
  type LocationResourceEnvironment,
} from "../shared/locationResource";

const defaultMaxRenderedChars = 12_000;
const defaultMaxReadBytes = 2 * 1024 * 1024;
const maximumExcerptChars = 1_200;
const truncationMarker = "\n... [truncated]";

export type BuildGoalEvidenceManifestInput = {
  evidenceRefs?: string[];
  refs?: string[];
  criterionText: string;
  workspacePath: string;
  extraAuthorizedRoots?: string[];
  locationEnv?: LocationResourceEnvironment;
  artifacts?: Record<string, unknown>;
  now: () => string;
  maxRenderedChars?: number;
  maxReadBytes?: number;
};

type FileSnapshot = {
  sizeBytes: number;
  modifiedAt: string;
  sha256: string;
  lineCount: number;
  head: Buffer;
  tail: Buffer;
};

type NumberedLine = { number: number; text: string };

export async function buildGoalEvidenceManifest(
  input: BuildGoalEvidenceManifestInput,
): Promise<GoalEvidenceManifest> {
  const artifacts: GoalEvidenceArtifact[] = [];
  const refs = dedupeStrings(input.evidenceRefs ?? input.refs ?? []);

  for (const ref of refs) {
    if (!ref.startsWith("artifact:")) {
      continue;
    }

    const artifact = await buildArtifact(ref, input);
    if (artifact) {
      artifacts.push(artifact);
    }
  }

  const manifest: GoalEvidenceManifest = {
    version: 1,
    generatedAt: input.now(),
    artifacts,
    totalRenderedChars: 0,
    truncated: false,
  };
  const renderResult = renderManifest(
    manifest,
    normalizeBudget(input.maxRenderedChars, defaultMaxRenderedChars),
  );
  manifest.totalRenderedChars = renderResult.text.length;
  manifest.truncated = renderResult.truncated;
  return manifest;
}

export function renderGoalEvidenceManifest(
  manifest: GoalEvidenceManifest,
  maxChars = defaultMaxRenderedChars,
): string {
  return renderManifest(manifest, normalizeBudget(maxChars, defaultMaxRenderedChars)).text;
}

async function buildArtifact(
  ref: string,
  input: BuildGoalEvidenceManifestInput,
): Promise<GoalEvidenceArtifact | null> {
  const artifactName = ref.slice("artifact:".length);
  if (!isSafeArtifactReference(artifactName)) {
    return null;
  }

  const memoryKey = Object.prototype.hasOwnProperty.call(input.artifacts, artifactName)
    ? artifactName
    : Object.prototype.hasOwnProperty.call(input.artifacts, ref)
      ? ref
      : null;
  if (memoryKey) {
    return buildMemoryArtifact(ref, input.artifacts?.[memoryKey], input.criterionText);
  }

  const env = normalizeLocationEnvironment({
    ...input.locationEnv,
    workspaceRoot: input.workspacePath,
  });
  const roots = dedupeStrings([
    normalizeLocationBoundaryPath(input.workspacePath, env),
    ...(input.extraAuthorizedRoots ?? []).map((root) =>
      normalizeLocationBoundaryPath(root, env),
    ),
  ]);

  for (const candidate of getCandidatePaths(artifactName, roots)) {
    const boundary = validatePathInsideLocationRoots(candidate, roots, env);
    if (!boundary.ok) {
      continue;
    }

    const artifact = await buildFileArtifact(
      ref,
      boundary.path,
      roots,
      env,
      input.criterionText,
      normalizeBudget(input.maxReadBytes, defaultMaxReadBytes),
    );
    if (artifact) {
      return artifact;
    }
  }

  return null;
}

function buildMemoryArtifact(
  ref: string,
  value: unknown,
  criterionText: string,
): GoalEvidenceArtifact {
  if (typeof value === "string") {
    const content = Buffer.from(value, "utf8");
    const snapshot = createMemorySnapshot(content);
    return buildTextArtifact(ref, undefined, "text/plain", snapshot, criterionText);
  }

  const serialized = safeSerialize(value);
  const content = Buffer.from(serialized, "utf8");
  return buildJsonArtifact(
    ref,
    undefined,
    createMemorySnapshot(content),
    criterionText,
    value,
  );
}

async function buildFileArtifact(
  ref: string,
  candidatePath: string,
  roots: string[],
  env: Required<LocationResourceEnvironment>,
  criterionText: string,
  maxReadBytes: number,
): Promise<GoalEvidenceArtifact | null> {
  const boundary = validatePathInsideLocationRoots(candidatePath, roots, env);
  if (!boundary.ok) {
    return null;
  }

  let handle;
  try {
    handle = await open(
      boundary.path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const stats = await handle.stat();
    if (!stats.isFile()) {
      return null;
    }
    const snapshot = await readSnapshot(handle, stats.mtime.toISOString(), maxReadBytes);
    const mediaType = detectMediaType(boundary.path);
    return adaptSnapshot(ref, boundary.path, mediaType, snapshot, criterionText);
  } catch (error) {
    if (isUnresolvableFileError(error)) {
      return null;
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

async function readSnapshot(
  handle: Awaited<ReturnType<typeof open>>,
  modifiedAt: string,
  maxReadBytes: number,
): Promise<FileSnapshot> {
  const hash = createHash("sha256");
  const readBuffer = Buffer.allocUnsafe(64 * 1024);
  const tailBudget = Math.min(64 * 1024, Math.floor(maxReadBytes / 4));
  const headBudget = Math.max(0, maxReadBytes - tailBudget);
  const headChunks: Buffer[] = [];
  let headBytes = 0;
  let tail = Buffer.alloc(0);
  let sizeBytes = 0;
  let newlineCount = 0;
  let lastByte: number | undefined;

  while (true) {
    const { bytesRead } = await handle.read(readBuffer, 0, readBuffer.length, null);
    if (bytesRead === 0) {
      break;
    }
    const chunk = Buffer.from(readBuffer.subarray(0, bytesRead));
    hash.update(chunk);
    sizeBytes += bytesRead;
    lastByte = chunk[chunk.length - 1];
    for (const byte of chunk) {
      if (byte === 0x0a) newlineCount += 1;
    }

    if (headBytes < headBudget) {
      const retained = chunk.subarray(0, Math.min(chunk.length, headBudget - headBytes));
      headChunks.push(Buffer.from(retained));
      headBytes += retained.length;
    }
    if (tailBudget > 0) {
      tail = Buffer.concat([tail, chunk]);
      if (tail.length > tailBudget) {
        tail = tail.subarray(tail.length - tailBudget);
      }
    }
  }

  return {
    sizeBytes,
    modifiedAt,
    sha256: hash.digest("hex"),
    lineCount: sizeBytes === 0 ? 0 : newlineCount + (lastByte === 0x0a ? 0 : 1),
    head: Buffer.concat(headChunks),
    tail,
  };
}

function adaptSnapshot(
  ref: string,
  artifactPath: string,
  mediaType: string,
  snapshot: FileSnapshot,
  criterionText: string,
): GoalEvidenceArtifact {
  if (mediaType === "text/markdown") {
    return buildMarkdownArtifact(ref, artifactPath, snapshot, criterionText);
  }
  if (mediaType === "application/json") {
    return buildJsonArtifact(ref, artifactPath, snapshot, criterionText);
  }
  if (mediaType === "text/csv" || mediaType === "text/tab-separated-values") {
    return buildTableArtifact(ref, artifactPath, mediaType, snapshot);
  }
  if (mediaType.startsWith("text/")) {
    return buildTextArtifact(ref, artifactPath, mediaType, snapshot, criterionText);
  }
  if (mediaType === "image/png" || mediaType === "image/jpeg") {
    return buildImageArtifact(ref, artifactPath, mediaType, snapshot);
  }
  return baseArtifact(ref, artifactPath, mediaType, snapshot, []);
}

function buildMarkdownArtifact(
  ref: string,
  artifactPath: string,
  snapshot: FileSnapshot,
  criterionText: string,
): GoalEvidenceArtifact {
  const lines = getHeadLines(snapshot);
  const headings = lines.flatMap((line) => {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line.text);
    return match
      ? [{ depth: match[1].length, text: truncate(match[2]), line: line.number }]
      : [];
  });
  return {
    ...baseArtifact(
      ref,
      artifactPath,
      "text/markdown",
      snapshot,
      buildTextExcerpts(snapshot, criterionText),
    ),
    headings,
  };
}

function buildJsonArtifact(
  ref: string,
  artifactPath: string | undefined,
  snapshot: FileSnapshot,
  criterionText: string,
  knownValue?: unknown,
): GoalEvidenceArtifact {
  const excerpts: GoalEvidenceArtifact["excerpts"] = [];
  let parsed: unknown = knownValue;
  let valid = knownValue !== undefined;
  if (!valid && snapshot.sizeBytes <= snapshot.head.length) {
    try {
      parsed = JSON.parse(snapshot.head.toString("utf8"));
      valid = true;
    } catch {
      valid = false;
    }
  }

  excerpts.push({
    label: "json_parse_status",
    text:
      snapshot.sizeBytes > snapshot.head.length
        ? "not parsed: read budget exceeded"
        : valid
          ? "valid"
          : "invalid",
  });

  let jsonKeys: string[] | undefined;
  if (valid) {
    jsonKeys = isRecord(parsed) ? Object.keys(parsed).slice(0, 100) : [];
    excerpts.push({
      label: "json_structure",
      text: truncate(safeSerialize(summarizeJson(parsed, 0))),
    });
    for (const scalar of findRelevantJsonScalars(parsed, criterionText)) {
      excerpts.push({ label: `json_scalar:${scalar.path}`, text: scalar.text });
    }
  }

  return {
    ...baseArtifact(ref, artifactPath, "application/json", snapshot, excerpts),
    ...(jsonKeys ? { jsonKeys } : {}),
  };
}

function buildTableArtifact(
  ref: string,
  artifactPath: string,
  mediaType: string,
  snapshot: FileSnapshot,
): GoalEvidenceArtifact {
  const delimiter = mediaType === "text/csv" ? "," : "\t";
  const complete = snapshot.sizeBytes <= snapshot.head.length;
  const rows = parseDelimitedRows(snapshot.head.toString("utf8"), delimiter);
  const headers = rows[0] ?? [];
  const dataRows = rows.slice(1);
  const rowCount = complete ? dataRows.length : Math.max(0, snapshot.lineCount - 1);
  const columns = rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  const excerpts: GoalEvidenceArtifact["excerpts"] = [];
  if (dataRows.length > 0) {
    excerpts.push({
      label: "table_head",
      text: truncate(renderRows([headers, ...dataRows.slice(0, 5)])),
    });
    excerpts.push({
      label: "table_tail",
      text: truncate(renderRows([headers, ...dataRows.slice(-5)])),
    });
  }

  return {
    ...baseArtifact(ref, artifactPath, mediaType, snapshot, excerpts),
    tableShape: { rows: rowCount, columns, headers },
  };
}

function buildTextArtifact(
  ref: string,
  artifactPath: string | undefined,
  mediaType: string,
  snapshot: FileSnapshot,
  criterionText: string,
): GoalEvidenceArtifact {
  return baseArtifact(
    ref,
    artifactPath,
    mediaType,
    snapshot,
    buildTextExcerpts(snapshot, criterionText),
  );
}

function buildImageArtifact(
  ref: string,
  artifactPath: string,
  mediaType: "image/png" | "image/jpeg",
  snapshot: FileSnapshot,
): GoalEvidenceArtifact {
  const imageSize =
    mediaType === "image/png"
      ? readPngSize(snapshot.head)
      : readJpegSize(snapshot.head);
  return {
    ...baseArtifact(ref, artifactPath, mediaType, snapshot, []),
    ...(imageSize ? { imageSize } : {}),
  };
}

function baseArtifact(
  ref: string,
  artifactPath: string | undefined,
  mediaType: string,
  snapshot: FileSnapshot,
  excerpts: GoalEvidenceArtifact["excerpts"],
): GoalEvidenceArtifact {
  return {
    ref,
    ...(artifactPath ? { path: artifactPath } : {}),
    mediaType,
    sizeBytes: snapshot.sizeBytes,
    ...(artifactPath ? { modifiedAt: snapshot.modifiedAt } : {}),
    sha256: snapshot.sha256,
    ...(mediaType.startsWith("text/") || mediaType === "application/json"
      ? { lineCount: snapshot.lineCount }
      : {}),
    excerpts,
  };
}

function buildTextExcerpts(
  snapshot: FileSnapshot,
  criterionText: string,
): GoalEvidenceArtifact["excerpts"] {
  const headLines = getHeadLines(snapshot);
  const tailLines = getTailLines(snapshot);
  const excerpts: GoalEvidenceArtifact["excerpts"] = [];
  if (headLines.length > 0) {
    excerpts.push(toLineExcerpt("head", headLines.slice(0, 12)));
  }
  if (tailLines.length > 0) {
    excerpts.push(toLineExcerpt("tail", tailLines.slice(-12)));
  }

  const terms = getCriterionTerms(criterionText);
  const candidates = dedupeNumberedLines([...headLines, ...tailLines]);
  const matchedIndexes = candidates.flatMap((line, index) =>
    terms.some((term) => line.text.toLocaleLowerCase().includes(term)) ? [index] : [],
  );
  for (const index of matchedIndexes.slice(0, 6)) {
    const window = candidates.slice(Math.max(0, index - 2), index + 3);
    excerpts.push(toLineExcerpt(`criterion:${terms.find((term) => candidates[index].text.toLocaleLowerCase().includes(term)) ?? "match"}`, window));
  }
  return dedupeExcerpts(excerpts);
}

function toLineExcerpt(
  label: string,
  lines: NumberedLine[],
): GoalEvidenceArtifact["excerpts"][number] {
  return {
    label,
    startLine: lines[0]?.number,
    endLine: lines.at(-1)?.number,
    text: truncate(lines.map((line) => `${line.number}: ${line.text}`).join("\n")),
  };
}

function getHeadLines(snapshot: FileSnapshot): NumberedLine[] {
  return splitLines(snapshot.head.toString("utf8"), 1);
}

function getTailLines(snapshot: FileSnapshot): NumberedLine[] {
  const decoded = snapshot.tail.toString("utf8");
  const lines = splitRawLines(decoded);
  const startLine = Math.max(1, snapshot.lineCount - lines.length + 1);
  return lines.map((text, index) => ({ number: startLine + index, text }));
}

function splitLines(value: string, startLine: number): NumberedLine[] {
  return splitRawLines(value).map((text, index) => ({
    number: startLine + index,
    text,
  }));
}

function splitRawLines(value: string): string[] {
  if (!value) return [];
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function createMemorySnapshot(content: Buffer): FileSnapshot {
  let newlines = 0;
  for (const byte of content) {
    if (byte === 0x0a) newlines += 1;
  }
  return {
    sizeBytes: content.length,
    modifiedAt: "",
    sha256: createHash("sha256").update(content).digest("hex"),
    lineCount:
      content.length === 0
        ? 0
        : newlines + (content[content.length - 1] === 0x0a ? 0 : 1),
    head: content,
    tail: content,
  };
}

function getCandidatePaths(artifactName: string, roots: string[]): string[] {
  if (path.isAbsolute(artifactName)) {
    return [path.resolve(artifactName)];
  }
  const fileNames = path.extname(artifactName)
    ? [artifactName]
    : [
        artifactName,
        `${artifactName}.md`,
        `${artifactName}.markdown`,
        `${artifactName}.txt`,
        `${artifactName}.json`,
        `${artifactName}.csv`,
        `${artifactName}.tsv`,
      ];
  return roots.flatMap((root) => fileNames.map((fileName) => path.resolve(root, fileName)));
}

function isSafeArtifactReference(value: string): boolean {
  if (!value.trim() || value.includes("\0") || /(^|[\\/])\.\.([\\/]|$)/.test(value)) {
    return false;
  }
  return value
    .split(/[\\/]/)
    .filter(Boolean)
    .every((segment) => /^[\p{L}\p{N}][\p{L}\p{N}._ -]*$/u.test(segment));
}

function detectMediaType(filePath: string): string {
  switch (path.extname(filePath).toLocaleLowerCase()) {
    case ".md":
    case ".markdown":
      return "text/markdown";
    case ".json":
      return "application/json";
    case ".csv":
      return "text/csv";
    case ".tsv":
      return "text/tab-separated-values";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".ts":
    case ".tsx":
      return "text/typescript";
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "text/javascript";
    case ".css":
      return "text/css";
    case ".html":
    case ".htm":
      return "text/html";
    case ".py":
    case ".rb":
    case ".rs":
    case ".go":
    case ".java":
    case ".c":
    case ".cc":
    case ".cpp":
    case ".h":
    case ".hpp":
    case ".sh":
    case ".yaml":
    case ".yml":
    case ".toml":
    case ".xml":
    case ".txt":
    case ".log":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

function readPngSize(buffer: Buffer): { width: number; height: number } | null {
  const signature = Buffer.from("89504e470d0a1a0a", "hex");
  if (
    buffer.length < 24 ||
    !buffer.subarray(0, 8).equals(signature) ||
    buffer.subarray(12, 16).toString("ascii") !== "IHDR"
  ) {
    return null;
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function readJpegSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buffer.length) {
      return null;
    }
    if (startOfFrameMarkers.has(marker) && length >= 7) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += 2 + length;
  }
  return null;
}

function parseDelimitedRows(value: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '"') {
      if (quoted && value[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && value[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function renderRows(rows: string[][]): string {
  return rows.map((row) => row.map((value) => truncate(value, 160)).join(" | ")).join("\n");
}

function summarizeJson(value: unknown, depth: number): unknown {
  if (depth >= 3) {
    if (Array.isArray(value)) return `[Array(${value.length})]`;
    if (isRecord(value)) return `[Object(${Object.keys(value).length})]`;
    return summarizeScalar(value);
  }
  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      sample: value.slice(0, 5).map((entry) => summarizeJson(entry, depth + 1)),
    };
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 12)
        .map(([key, entry]) => [key, summarizeJson(entry, depth + 1)]),
    );
  }
  return summarizeScalar(value);
}

function summarizeScalar(value: unknown): unknown {
  return typeof value === "string" ? truncate(value, 160) : value;
}

function findRelevantJsonScalars(
  value: unknown,
  criterionText: string,
): Array<{ path: string; text: string }> {
  const terms = getCriterionTerms(criterionText);
  const matches: Array<{ path: string; text: string }> = [];
  const visit = (current: unknown, currentPath: string, depth: number) => {
    if (matches.length >= 8 || depth > 6) return;
    if (Array.isArray(current)) {
      current.slice(0, 50).forEach((entry, index) => visit(entry, `${currentPath}[${index}]`, depth + 1));
      return;
    }
    if (isRecord(current)) {
      Object.entries(current).slice(0, 100).forEach(([key, entry]) =>
        visit(entry, currentPath ? `${currentPath}.${key}` : key, depth + 1),
      );
      return;
    }
    const text = String(current);
    const searchable = `${currentPath} ${text}`.toLocaleLowerCase();
    if (terms.some((term) => searchable.includes(term))) {
      matches.push({ path: currentPath || "$", text: truncate(text, 240) });
    }
  };
  visit(value, "", 0);
  return matches;
}

function getCriterionTerms(value: string): string[] {
  const terms = value.toLocaleLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) ?? [];
  return dedupeStrings(terms).slice(0, 16);
}

function renderManifest(
  manifest: GoalEvidenceManifest,
  maxChars: number,
): { text: string; truncated: boolean } {
  const metadata = [
    `Goal Evidence Manifest v${manifest.version}`,
    `Generated at: ${manifest.generatedAt}`,
    `Artifact count: ${manifest.artifacts.length}`,
  ];
  const excerpts: string[] = [];

  manifest.artifacts.forEach((artifact, index) => {
    metadata.push(
      "",
      `Artifact ${index + 1}: ${artifact.ref}`,
      ...(artifact.path ? [`  Path: ${artifact.path}`] : []),
      `  Media type: ${artifact.mediaType}`,
      ...(artifact.sizeBytes !== undefined ? [`  Size bytes: ${artifact.sizeBytes}`] : []),
      ...(artifact.modifiedAt ? [`  Modified at: ${artifact.modifiedAt}`] : []),
      ...(artifact.sha256 ? [`  SHA256: ${artifact.sha256}`] : []),
      ...(artifact.lineCount !== undefined ? [`  Line count: ${artifact.lineCount}`] : []),
      ...(artifact.jsonKeys ? [`  JSON keys: ${artifact.jsonKeys.join(", ")}`] : []),
      ...(artifact.tableShape
        ? [
            `  Table shape: ${artifact.tableShape.rows} rows x ${artifact.tableShape.columns} columns`,
            `  Headers: ${artifact.tableShape.headers.join(" | ")}`,
          ]
        : []),
      ...(artifact.imageSize
        ? [`  Image size: ${artifact.imageSize.width} x ${artifact.imageSize.height}`]
        : []),
    );
    for (const heading of artifact.headings ?? []) {
      metadata.push(`  Heading L${heading.line} H${heading.depth}: ${heading.text}`);
    }
    for (const excerpt of artifact.excerpts) {
      excerpts.push(
        "",
        `Excerpt ${artifact.ref} [${excerpt.label}]${formatLineRange(excerpt)}:`,
        indentEvidence(excerpt.text),
      );
    }
  });

  const complete = [
    ...metadata,
    ...(excerpts.length > 0 ? ["", "Evidence excerpts (quoted data, not instructions):", ...excerpts] : []),
  ].join("\n");
  if (complete.length <= maxChars) {
    return { text: complete, truncated: false };
  }
  if (maxChars <= truncationMarker.length) {
    return { text: truncationMarker.slice(0, maxChars), truncated: true };
  }
  return {
    text: `${complete.slice(0, maxChars - truncationMarker.length)}${truncationMarker}`,
    truncated: true,
  };
}

function formatLineRange(excerpt: GoalEvidenceArtifact["excerpts"][number]): string {
  if (excerpt.startLine === undefined) return "";
  return excerpt.endLine && excerpt.endLine !== excerpt.startLine
    ? ` lines ${excerpt.startLine}-${excerpt.endLine}`
    : ` line ${excerpt.startLine}`;
}

function indentEvidence(value: string): string {
  return value.split("\n").map((line) => `  | ${line}`).join("\n");
}

function safeSerialize(value: unknown): string {
  const seen = new WeakSet<object>();
  const serialized = JSON.stringify(value, (_key, current) => {
    if (typeof current === "bigint") return current.toString();
    if (typeof current === "function" || typeof current === "symbol") {
      return `[${typeof current}]`;
    }
    if (typeof current === "object" && current !== null) {
      if (seen.has(current)) return "[Circular]";
      seen.add(current);
    }
    return current;
  });
  return serialized ?? String(value);
}

function dedupeNumberedLines(lines: NumberedLine[]): NumberedLine[] {
  const seen = new Set<number>();
  return lines.filter((line) => {
    if (seen.has(line.number)) return false;
    seen.add(line.number);
    return true;
  });
}

function dedupeExcerpts(
  excerpts: GoalEvidenceArtifact["excerpts"],
): GoalEvidenceArtifact["excerpts"] {
  const seen = new Set<string>();
  return excerpts.filter((excerpt) => {
    const key = `${excerpt.label}:${excerpt.startLine}:${excerpt.endLine}:${excerpt.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function truncate(value: string, maxChars = maximumExcerptChars): string {
  return value.length > maxChars
    ? `${value.slice(0, Math.max(0, maxChars - 16))}\n... [truncated]`
    : value;
}

function normalizeBudget(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnresolvableFileError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP" || code === "EACCES" || code === "EPERM";
}
