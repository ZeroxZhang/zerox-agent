import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
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
import { verifyArtifactProvenance } from "../shared/agentArtifactProvenance";

const defaultMaxRenderedChars = 12_000;
const defaultMaxReadBytes = 2 * 1024 * 1024;
const maximumExcerptChars = 1_200;
const maximumHeadings = 2_000;
const maximumJsonKeys = 100;
const redactedMarker = "[REDACTED]";
const truncationMarker = "... [truncated]";
const quotedDataStart = "BEGIN QUOTED ARTIFACT DATA";
const quotedDataEnd = "END QUOTED ARTIFACT DATA";

export type GoalEvidenceProvenanceRequirement = {
  required: boolean;
  runId: string;
  goalId?: string;
  milestoneId?: string;
};

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
  provenance?: GoalEvidenceProvenanceRequirement;
  afterProvenanceVerified?: (artifactPath: string) => Promise<void>;
};

type NumberedLine = { number: number; text: string };

type StreamTextScan = {
  lineCount: number;
  headLines: NumberedLine[];
  tailLines: NumberedLine[];
  criterionLines: Array<NumberedLine & { term: string }>;
  headings: NonNullable<GoalEvidenceArtifact["headings"]>;
  headingCount: number;
};

type StreamTableScan = {
  rows: number;
  columns: number;
  headers: string[];
  headRows: string[][];
  tailRows: string[][];
};

type FileSnapshot = {
  sizeBytes: number;
  modifiedAt: string;
  sha256: string;
  head: Buffer;
  tail: Buffer;
  text?: StreamTextScan;
  jsonKeys?: string[];
  table?: StreamTableScan;
};

export async function buildGoalEvidenceManifest(
  input: BuildGoalEvidenceManifestInput,
): Promise<GoalEvidenceManifest> {
  const artifacts: GoalEvidenceArtifact[] = [];
  const refs = dedupeStrings(input.evidenceRefs ?? input.refs ?? []);

  for (const ref of refs) {
    if (!ref.startsWith("artifact:")) continue;
    const artifact = await buildArtifact(ref, input);
    if (artifact) artifacts.push(artifact);
  }

  const manifest: GoalEvidenceManifest = {
    version: 1,
    generatedAt: input.now(),
    artifacts,
    totalRenderedChars: 0,
    truncated: false,
  };
  const result = renderManifest(
    manifest,
    normalizeBudget(input.maxRenderedChars, defaultMaxRenderedChars),
  );
  manifest.totalRenderedChars = result.text.length;
  manifest.truncated = result.truncated;
  return manifest;
}

export function renderGoalEvidenceManifest(
  manifest: GoalEvidenceManifest,
  maxChars = defaultMaxRenderedChars,
): string {
  const requestedCap = normalizeBudget(maxChars, defaultMaxRenderedChars);
  const intrinsicCap = manifest.truncated
    ? manifest.totalRenderedChars
    : requestedCap;
  return renderManifest(manifest, Math.min(requestedCap, intrinsicCap)).text;
}

async function buildArtifact(
  ref: string,
  input: BuildGoalEvidenceManifestInput,
): Promise<GoalEvidenceArtifact | null> {
  const artifactName = ref.slice("artifact:".length);
  if (!isSafeArtifactReference(artifactName)) return null;

  const artifacts = input.artifacts;
  const memoryKey = artifacts && Object.prototype.hasOwnProperty.call(artifacts, artifactName)
    ? artifactName
    : artifacts && Object.prototype.hasOwnProperty.call(artifacts, ref)
      ? ref
      : null;
  if (memoryKey) {
    const value = artifacts?.[memoryKey];
    if (value === undefined || input.provenance?.required) return null;
    return buildMemoryArtifact(
      ref,
      value,
      input.criterionText,
      normalizeBudget(input.maxReadBytes, defaultMaxReadBytes),
    );
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
    if (!boundary.ok) continue;

    let verifiedDestination:
      | { sha256: string; sizeBytes: number }
      | undefined;
    if (input.provenance?.required) {
      const verification = await verifyArtifactProvenance({
        artifactPath: boundary.path,
        artifactRef: ref,
        artifactId: artifactName,
        runId: input.provenance.runId,
        ...(input.provenance.goalId ? { goalId: input.provenance.goalId } : {}),
        ...(input.provenance.milestoneId
          ? { milestoneId: input.provenance.milestoneId }
          : {}),
      });
      if (!verification.ok) continue;
      verifiedDestination = verification.manifest.destination;
      await input.afterProvenanceVerified?.(boundary.path);
    }

    const artifact = await buildFileArtifact(
      ref,
      boundary.path,
      roots,
      env,
      input.criterionText,
      normalizeBudget(input.maxReadBytes, defaultMaxReadBytes),
    );
    if (
      artifact &&
      (!verifiedDestination ||
        (artifact.sha256 === verifiedDestination.sha256 &&
          artifact.sizeBytes === verifiedDestination.sizeBytes))
    ) {
      return artifact;
    }
  }
  return null;
}

function buildMemoryArtifact(
  ref: string,
  value: unknown,
  criterionText: string,
  maxReadBytes: number,
): GoalEvidenceArtifact {
  const binary = getBinaryView(value);
  if (binary) {
    return {
      ref,
      mediaType: "application/octet-stream",
      sizeBytes: binary.byteLength,
      sha256: createHash("sha256").update(binary).digest("hex"),
      excerpts: [],
    };
  }

  if (typeof value === "string") {
    const snapshot = createStringSnapshot(value, criterionText, maxReadBytes);
    return buildTextArtifact(ref, undefined, "text/plain", snapshot, criterionText);
  }

  const sanitized = sanitizeMemoryValue(value, maxReadBytes);
  const serialized = JSON.stringify(sanitized) ?? "null";
  const content = truncateUtf8Buffer(serialized, maxReadBytes);
  return buildJsonArtifact(
    ref,
    undefined,
    createBufferSnapshot(content, criterionText, "application/json"),
    criterionText,
    sanitized,
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
  if (!boundary.ok) return null;

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(
      boundary.path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const stats = await handle.stat();
    if (!stats.isFile()) return null;
    const mediaType = detectMediaType(boundary.path);
    const snapshot = await readSnapshot(
      handle,
      stats.mtime.toISOString(),
      maxReadBytes,
      mediaType,
      criterionText,
    );
    return adaptSnapshot(ref, boundary.path, mediaType, snapshot, criterionText);
  } catch (error) {
    if (isUnresolvableFileError(error)) return null;
    throw error;
  } finally {
    await handle?.close();
  }
}

async function readSnapshot(
  handle: Awaited<ReturnType<typeof open>>,
  modifiedAt: string,
  maxReadBytes: number,
  mediaType: string,
  criterionText: string,
): Promise<FileSnapshot> {
  const hash = createHash("sha256");
  const readBuffer = Buffer.allocUnsafe(64 * 1024);
  const tailBudget = Math.min(64 * 1024, Math.floor(maxReadBytes / 4));
  const headBudget = Math.max(0, maxReadBytes - tailBudget);
  const headChunks: Buffer[] = [];
  let headBytes = 0;
  let tail: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let sizeBytes = 0;
  const isText = isTextMedia(mediaType);
  const decoder = isText ? new StringDecoder("utf8") : null;
  const textScanner = isText ? new TextScanner(criterionText) : null;
  const jsonScanner = mediaType === "application/json" ? new JsonTopLevelScanner() : null;
  const tableScanner =
    mediaType === "text/csv" || mediaType === "text/tab-separated-values"
      ? new DelimitedTableScanner(mediaType === "text/csv" ? "," : "\t")
      : null;

  while (true) {
    const { bytesRead } = await handle.read(readBuffer, 0, readBuffer.length, null);
    if (bytesRead === 0) break;
    const chunk = Buffer.from(readBuffer.subarray(0, bytesRead));
    hash.update(chunk);
    sizeBytes += bytesRead;
    if (headBytes < headBudget) {
      const retained = chunk.subarray(0, Math.min(chunk.length, headBudget - headBytes));
      headChunks.push(Buffer.from(retained));
      headBytes += retained.length;
    }
    if (tailBudget > 0) {
      tail = appendBoundedTail(tail, chunk, tailBudget);
    }
    if (decoder) {
      const decoded = decoder.write(chunk);
      textScanner?.push(decoded);
      jsonScanner?.push(decoded);
      tableScanner?.push(decoded);
    }
  }
  if (decoder) {
    const finalText = decoder.end();
    textScanner?.push(finalText);
    jsonScanner?.push(finalText);
    tableScanner?.push(finalText);
  }

  return {
    sizeBytes,
    modifiedAt,
    sha256: hash.digest("hex"),
    head: Buffer.concat(headChunks),
    tail,
    ...(textScanner ? { text: textScanner.finish() } : {}),
    ...(jsonScanner ? { jsonKeys: jsonScanner.finish() } : {}),
    ...(tableScanner ? { table: tableScanner.finish() } : {}),
  };
}

function createStringSnapshot(
  value: string,
  criterionText: string,
  maxReadBytes: number,
): FileSnapshot {
  const hash = createHash("sha256");
  const scanner = new TextScanner(criterionText);
  const tailBudget = Math.min(64 * 1024, Math.floor(maxReadBytes / 4));
  const headBudget = Math.max(0, maxReadBytes - tailBudget);
  const headChunks: Buffer[] = [];
  let headBytes = 0;
  let tail: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let sizeBytes = 0;
  for (let offset = 0; offset < value.length; offset += 32 * 1024) {
    const textChunk = value.slice(offset, offset + 32 * 1024);
    const chunk = Buffer.from(textChunk, "utf8");
    hash.update(chunk);
    scanner.push(textChunk);
    sizeBytes += chunk.length;
    if (headBytes < headBudget) {
      const retained = chunk.subarray(0, Math.min(chunk.length, headBudget - headBytes));
      headChunks.push(Buffer.from(retained));
      headBytes += retained.length;
    }
    if (tailBudget > 0) tail = appendBoundedTail(tail, chunk, tailBudget);
  }
  return {
    sizeBytes,
    modifiedAt: "",
    sha256: hash.digest("hex"),
    head: Buffer.concat(headChunks),
    tail,
    text: scanner.finish(),
  };
}

function createBufferSnapshot(
  content: Buffer,
  criterionText: string,
  mediaType: string,
): FileSnapshot {
  const scanner = isTextMedia(mediaType) ? new TextScanner(criterionText) : null;
  scanner?.push(content.toString("utf8"));
  const jsonScanner = mediaType === "application/json" ? new JsonTopLevelScanner() : null;
  jsonScanner?.push(content.toString("utf8"));
  return {
    sizeBytes: content.length,
    modifiedAt: "",
    sha256: createHash("sha256").update(content).digest("hex"),
    head: content,
    tail: content,
    ...(scanner ? { text: scanner.finish() } : {}),
    ...(jsonScanner ? { jsonKeys: jsonScanner.finish() } : {}),
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
    const excerpts = buildTextExcerpts(snapshot);
    const headingCount = snapshot.text?.headingCount ?? 0;
    const retainedHeadings = snapshot.text?.headings.length ?? 0;
    if (headingCount > retainedHeadings) {
      excerpts.push({
        label: "heading_scan_status",
        text: `total=${headingCount}; retained=${retainedHeadings}; truncated=true`,
      });
    }
    return {
      ...baseArtifact(
        ref,
        artifactPath,
        mediaType,
        snapshot,
        excerpts,
      ),
      headings: snapshot.text?.headings ?? [],
    };
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

function buildJsonArtifact(
  ref: string,
  artifactPath: string | undefined,
  snapshot: FileSnapshot,
  _criterionText: string,
  knownValue?: unknown,
): GoalEvidenceArtifact {
  const excerpts: GoalEvidenceArtifact["excerpts"] = [];
  const complete = snapshot.sizeBytes <= snapshot.head.length;
  let parsed = knownValue;
  let valid = knownValue !== undefined;
  if (!valid && complete) {
    try {
      parsed = JSON.parse(snapshot.head.toString("utf8"));
      valid = true;
    } catch {
      valid = false;
    }
  }
  excerpts.push({
    label: "json_parse_status",
    text: complete ? (valid ? "valid" : "invalid") : "streamed: full parse exceeds read budget",
  });

  const jsonKeys = valid && isRecord(parsed)
    ? Object.keys(parsed).slice(0, maximumJsonKeys)
    : snapshot.jsonKeys ?? [];
  excerpts.push({
    label: "json_structure",
    text: valid
      ? truncate(JSON.stringify(summarizeJson(parsed, 0)))
      : JSON.stringify({ topLevelKeys: jsonKeys }),
  });

  if (valid) {
    for (const scalar of findRelevantJsonScalars(parsed, snapshot.text?.criterionLines ?? [])) {
      excerpts.push({ label: `json_scalar:${scalar.path}`, text: scalar.text });
    }
  } else {
    for (const line of snapshot.text?.criterionLines ?? []) {
      excerpts.push({
        label: `json_scalar:line_${line.number}`,
        startLine: line.number,
        endLine: line.number,
        text: line.text,
      });
    }
  }

  return {
    ...baseArtifact(ref, artifactPath, "application/json", snapshot, excerpts),
    jsonKeys,
  };
}

function buildTableArtifact(
  ref: string,
  artifactPath: string,
  mediaType: string,
  snapshot: FileSnapshot,
): GoalEvidenceArtifact {
  const table = snapshot.table ?? {
    rows: 0,
    columns: 0,
    headers: [],
    headRows: [],
    tailRows: [],
  };
  const excerpts: GoalEvidenceArtifact["excerpts"] = [];
  if (table.headRows.length > 0) {
    excerpts.push({
      label: "table_head",
      text: truncate(renderRows([table.headers, ...table.headRows])),
    });
  }
  if (table.tailRows.length > 0) {
    excerpts.push({
      label: "table_tail",
      text: truncate(renderRows([table.headers, ...table.tailRows])),
    });
  }
  return {
    ...baseArtifact(ref, artifactPath, mediaType, snapshot, excerpts),
    tableShape: {
      rows: table.rows,
      columns: table.columns,
      headers: table.headers,
    },
  };
}

function buildTextArtifact(
  ref: string,
  artifactPath: string | undefined,
  mediaType: string,
  snapshot: FileSnapshot,
  _criterionText: string,
): GoalEvidenceArtifact {
  return baseArtifact(ref, artifactPath, mediaType, snapshot, buildTextExcerpts(snapshot));
}

function buildImageArtifact(
  ref: string,
  artifactPath: string,
  mediaType: "image/png" | "image/jpeg",
  snapshot: FileSnapshot,
): GoalEvidenceArtifact {
  const imageSize = mediaType === "image/png"
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
    ...(snapshot.text ? { lineCount: snapshot.text.lineCount } : {}),
    excerpts,
  };
}

function buildTextExcerpts(snapshot: FileSnapshot): GoalEvidenceArtifact["excerpts"] {
  const scan = snapshot.text;
  if (!scan) return [];
  const excerpts: GoalEvidenceArtifact["excerpts"] = [];
  if (scan.headLines.length > 0) excerpts.push(toLineExcerpt("head", scan.headLines));
  if (scan.tailLines.length > 0) excerpts.push(toLineExcerpt("tail", scan.tailLines));
  for (const line of scan.criterionLines) {
    excerpts.push(toLineExcerpt(`criterion:${line.term}`, [line]));
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

class TextScanner {
  private readonly terms: string[];
  private readonly headLines: NumberedLine[] = [];
  private readonly tailLines: NumberedLine[] = [];
  private readonly criterionLines: Array<NumberedLine & { term: string }> = [];
  private readonly firstHeadings: NonNullable<GoalEvidenceArtifact["headings"]> = [];
  private readonly lastHeadings: NonNullable<GoalEvidenceArtifact["headings"]> = [];
  private headingCount = 0;
  private lineNumber = 1;
  private prefix = "";
  private tail = "";
  private lineLength = 0;
  private sawContent = false;
  private endedWithNewline = false;
  private readonly matchedTerms = new Set<string>();
  private readonly searchOverlapChars: number;

  constructor(criterionText: string) {
    this.terms = getCriterionTerms(criterionText);
    this.searchOverlapChars = Math.max(0, ...this.terms.map((term) => term.length - 1));
  }

  push(value: string): void {
    if (!value) return;
    this.sawContent = true;
    let start = 0;
    while (start <= value.length) {
      const newline = value.indexOf("\n", start);
      const end = newline === -1 ? value.length : newline;
      this.processSegment(value.slice(start, end).replace(/\r/g, ""));
      if (newline === -1) {
        this.endedWithNewline = false;
        break;
      }
      this.finishLine();
      this.endedWithNewline = true;
      start = newline + 1;
      if (start === value.length) break;
    }
  }

  finish(): StreamTextScan {
    if (this.sawContent && !this.endedWithNewline) this.finishLine();
    return {
      lineCount: this.lineNumber - 1,
      headLines: this.headLines,
      tailLines: this.tailLines,
      criterionLines: this.criterionLines,
      headings: [...this.firstHeadings, ...this.lastHeadings],
      headingCount: this.headingCount,
    };
  }

  private processSegment(segment: string): void {
    if (!segment) return;
    const previousTail = this.tail;
    this.lineLength += segment.length;
    if (this.prefix.length < 4_096) {
      this.prefix += segment.slice(0, 4_096 - this.prefix.length);
    }
    this.tail = `${previousTail}${segment}`.slice(-512);
    if (this.criterionLines.length >= 8 || this.terms.length === 0) return;

    const overlap = previousTail.slice(-this.searchOverlapChars);
    const searchable = `${overlap}${segment}`;
    const lowered = searchable.toLocaleLowerCase();
    for (const term of this.terms) {
      if (this.matchedTerms.has(term)) continue;
      const matchIndex = lowered.indexOf(term);
      if (matchIndex === -1) continue;
      this.matchedTerms.add(term);
      this.criterionLines.push({
        number: this.lineNumber,
        term,
        text: truncate(
          searchable.slice(Math.max(0, matchIndex - 200), matchIndex + term.length + 300),
          700,
        ),
      });
      if (this.criterionLines.length >= 8) break;
    }
  }

  private finishLine(): void {
    const text = this.lineLength <= 4_096
      ? this.prefix
      : `${this.prefix}\n... [line truncated]\n${this.tail}`;
    const line = { number: this.lineNumber, text };
    if (this.headLines.length < 12) this.headLines.push(line);
    this.tailLines.push(line);
    if (this.tailLines.length > 12) this.tailLines.shift();
    for (const match of this.criterionLines) {
      if (match.number === this.lineNumber && this.lineLength <= 4_096) {
        match.text = text;
      }
    }
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(this.prefix);
    if (heading) {
      this.headingCount += 1;
      const entry = {
        depth: heading[1].length,
        text: truncate(heading[2], 500),
        line: this.lineNumber,
      };
      const firstBudget = Math.floor(maximumHeadings / 2);
      const lastBudget = maximumHeadings - firstBudget;
      if (this.firstHeadings.length < firstBudget) {
        this.firstHeadings.push(entry);
      } else {
        this.lastHeadings.push(entry);
        if (this.lastHeadings.length > lastBudget) this.lastHeadings.shift();
      }
    }
    this.lineNumber += 1;
    this.prefix = "";
    this.tail = "";
    this.lineLength = 0;
    this.matchedTerms.clear();
  }
}

class JsonTopLevelScanner {
  private depth = 0;
  private inString = false;
  private escaped = false;
  private stringValue = "";
  private expectTopKey = false;
  private pendingTopKey: string | null = null;
  private readonly keys: string[] = [];

  push(value: string): void {
    for (const character of value) {
      if (this.inString) {
        if (this.escaped) {
          this.escaped = false;
          if (this.stringValue.length < 300) this.stringValue += character;
        } else if (character === "\\") {
          this.escaped = true;
        } else if (character === '"') {
          this.inString = false;
          if (this.depth === 1 && this.expectTopKey) {
            this.pendingTopKey = this.stringValue;
          }
        } else if (this.stringValue.length < 300) {
          this.stringValue += character;
        }
        continue;
      }
      if (character === '"') {
        this.inString = true;
        this.stringValue = "";
      } else if (character === "{" || character === "[") {
        this.depth += 1;
        if (character === "{" && this.depth === 1) this.expectTopKey = true;
      } else if (character === "}" || character === "]") {
        this.depth = Math.max(0, this.depth - 1);
      } else if (character === ":" && this.depth === 1 && this.pendingTopKey !== null) {
        if (this.keys.length < maximumJsonKeys && !this.keys.includes(this.pendingTopKey)) {
          this.keys.push(this.pendingTopKey);
        }
        this.pendingTopKey = null;
        this.expectTopKey = false;
      } else if (character === "," && this.depth === 1) {
        this.expectTopKey = true;
        this.pendingTopKey = null;
      }
    }
  }

  finish(): string[] {
    return this.keys;
  }
}

class DelimitedTableScanner {
  private readonly delimiter: string;
  private quoted = false;
  private quotePending = false;
  private skipLf = false;
  private field = "";
  private row: string[] = [];
  private fieldCount = 0;
  private headers: string[] = [];
  private seenHeader = false;
  private rows = 0;
  private columns = 0;
  private readonly headRows: string[][] = [];
  private readonly tailRows: string[][] = [];

  constructor(delimiter: string) {
    this.delimiter = delimiter;
  }

  push(value: string): void {
    for (let index = 0; index < value.length; index += 1) {
      const character = value[index];
      if (this.skipLf) {
        this.skipLf = false;
        if (character === "\n") continue;
      }
      if (this.quotePending) {
        if (character === '"') {
          this.appendField('"');
          this.quotePending = false;
          continue;
        }
        this.quoted = false;
        this.quotePending = false;
        index -= 1;
        continue;
      }
      if (this.quoted) {
        if (character === '"') this.quotePending = true;
        else this.appendField(character);
        continue;
      }
      if (character === '"' && this.field.length === 0) {
        this.quoted = true;
      } else if (character === this.delimiter) {
        this.finishField();
      } else if (character === "\n" || character === "\r") {
        this.finishField();
        this.finishRow();
        if (character === "\r") this.skipLf = true;
      } else {
        this.appendField(character);
      }
    }
  }

  finish(): StreamTableScan {
    if (this.quotePending) {
      this.quoted = false;
      this.quotePending = false;
    }
    if (this.field.length > 0 || this.row.length > 0) {
      this.finishField();
      this.finishRow();
    }
    return {
      rows: this.rows,
      columns: this.columns,
      headers: this.headers,
      headRows: this.headRows,
      tailRows: this.tailRows,
    };
  }

  private appendField(character: string): void {
    if (this.field.length < 300) this.field += character;
  }

  private finishField(): void {
    this.fieldCount += 1;
    if (this.row.length < 100) this.row.push(this.field);
    this.field = "";
  }

  private finishRow(): void {
    this.columns = Math.max(this.columns, this.fieldCount);
    if (!this.seenHeader) {
      this.seenHeader = true;
      this.headers = this.fieldCount > this.row.length
        ? [...this.row, `... [${this.fieldCount - this.row.length} columns omitted]`]
        : this.row;
    } else {
      this.rows += 1;
      if (this.headRows.length < 5) this.headRows.push(this.row);
      this.tailRows.push(this.row);
      if (this.tailRows.length > 5) this.tailRows.shift();
    }
    this.row = [];
    this.fieldCount = 0;
  }
}

function renderManifest(
  manifest: GoalEvidenceManifest,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (maxChars === 0) return { text: "", truncated: true };
  const safeHeader = [
    `Goal Evidence Manifest v${manifest.version}`,
    `Generated at: ${manifest.generatedAt}`,
    `Artifact count: ${manifest.artifacts.length}`,
  ].join("\n");
  const prefix = `${safeHeader}\n${quotedDataStart}`;
  const footer = `\n${quotedDataEnd}`;
  const minimalSuffix = `${footer}\n${truncationMarker}`;
  if (prefix.length + minimalSuffix.length > maxChars) {
    const omission = `${safeHeader}\nArtifact data omitted: render budget too small.`;
    return { text: truncateExact(omission, maxChars), truncated: true };
  }
  const parts = [prefix];
  let length = prefix.length;
  for (const token of iterateManifestTokens(manifest)) {
    const addition = `\n${token}`;
    if (length + addition.length + minimalSuffix.length <= maxChars) {
      parts.push(addition);
      length += addition.length;
      continue;
    }
    const available = maxChars - length - minimalSuffix.length;
    if (available > 0) {
      parts.push(addition.slice(0, available));
      length += available;
    }
    parts.push(minimalSuffix);
    return { text: parts.join(""), truncated: true };
  }
  parts.push(footer);
  return { text: parts.join(""), truncated: false };
}

function* iterateManifestTokens(
  manifest: GoalEvidenceManifest,
): Generator<string> {
  for (const [index, artifact] of manifest.artifacts.entries()) {
    yield quoteLine(`Artifact ${index + 1}: ${artifact.ref}`);
    if (artifact.path) yield quoteLine(`  Path: ${artifact.path}`);
    yield quoteLine(`  Media type: ${artifact.mediaType}`);
    if (artifact.sizeBytes !== undefined) yield quoteLine(`  Size bytes: ${artifact.sizeBytes}`);
    if (artifact.modifiedAt) yield quoteLine(`  Modified at: ${artifact.modifiedAt}`);
    if (artifact.sha256) yield quoteLine(`  SHA256: ${artifact.sha256}`);
    if (artifact.lineCount !== undefined) yield quoteLine(`  Line count: ${artifact.lineCount}`);
    if (artifact.jsonKeys) yield quoteLine(`  JSON keys: ${artifact.jsonKeys.join(", ")}`);
    if (artifact.tableShape) {
      yield quoteLine(
        `  Table shape: ${artifact.tableShape.rows} rows x ${artifact.tableShape.columns} columns`,
      );
      yield quoteLine(`  Headers: ${artifact.tableShape.headers.join(" | ")}`);
    }
    if (artifact.imageSize) {
      yield quoteLine(`  Image size: ${artifact.imageSize.width} x ${artifact.imageSize.height}`);
    }
    const headingStatus = artifact.excerpts.find(
      (excerpt) => excerpt.label === "heading_scan_status",
    );
    if (headingStatus) {
      yield quoteLine(`  Heading scan: ${headingStatus.text}`);
    }
    for (const heading of iterateHeadingsForRender(artifact.headings ?? [])) {
      yield quoteLine(`  Heading L${heading.line} H${heading.depth}: ${heading.text}`);
    }
  }

  for (const artifact of manifest.artifacts) {
    for (const excerpt of artifact.excerpts) {
      if (isCriterionExcerpt(excerpt.label)) {
        yield* iterateExcerptTokens(artifact.ref, excerpt);
      }
    }
  }
  for (const artifact of manifest.artifacts) {
    for (const excerpt of artifact.excerpts) {
      if (!isCriterionExcerpt(excerpt.label) && excerpt.label !== "heading_scan_status") {
        yield* iterateExcerptTokens(artifact.ref, excerpt);
      }
    }
  }
}

function* iterateHeadingsForRender(
  headings: NonNullable<GoalEvidenceArtifact["headings"]>,
): Generator<NonNullable<GoalEvidenceArtifact["headings"]>[number]> {
  const edgeCount = Math.min(20, Math.ceil(headings.length / 2));
  for (let index = 0; index < edgeCount; index += 1) yield headings[index];
  const tailStart = Math.max(edgeCount, headings.length - edgeCount);
  for (let index = tailStart; index < headings.length; index += 1) yield headings[index];
  for (let index = edgeCount; index < tailStart; index += 1) yield headings[index];
}

function* iterateExcerptTokens(
  ref: string,
  excerpt: GoalEvidenceArtifact["excerpts"][number],
): Generator<string> {
  yield quoteLine(`Excerpt ${ref} [${excerpt.label}]${formatLineRange(excerpt)}:`);
  for (const line of excerpt.text.split("\n")) yield quoteLine(line);
}

function isCriterionExcerpt(label: string): boolean {
  return label.startsWith("criterion:") || label.startsWith("json_scalar:");
}

function quoteLine(value: string): string {
  return `| ${value}`;
}

function formatLineRange(excerpt: GoalEvidenceArtifact["excerpts"][number]): string {
  if (excerpt.startLine === undefined) return "";
  return excerpt.endLine && excerpt.endLine !== excerpt.startLine
    ? ` lines ${excerpt.startLine}-${excerpt.endLine}`
    : ` line ${excerpt.startLine}`;
}

function getCandidatePaths(artifactName: string, roots: string[]): string[] {
  if (path.isAbsolute(artifactName)) return [path.resolve(artifactName)];
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
  return dedupeStrings(
    roots.flatMap((root) => fileNames.map((fileName) => path.resolve(root, fileName))),
  );
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
    case ".markdown": return "text/markdown";
    case ".json": return "application/json";
    case ".csv": return "text/csv";
    case ".tsv": return "text/tab-separated-values";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".ts":
    case ".tsx": return "text/typescript";
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs": return "text/javascript";
    case ".css": return "text/css";
    case ".html":
    case ".htm": return "text/html";
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
    case ".log": return "text/plain";
    default: return "application/octet-stream";
  }
}

function isTextMedia(mediaType: string): boolean {
  return mediaType.startsWith("text/") || mediaType === "application/json";
}

function readPngSize(buffer: Buffer): { width: number; height: number } | null {
  const signature = Buffer.from("89504e470d0a1a0a", "hex");
  if (
    buffer.length < 24 ||
    !buffer.subarray(0, 8).equals(signature) ||
    buffer.subarray(12, 16).toString("ascii") !== "IHDR"
  ) return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function readJpegSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
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
    if (length < 2 || offset + 2 + length > buffer.length) return null;
    if (startOfFrameMarkers.has(marker) && length >= 7) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += 2 + length;
  }
  return null;
}

function sanitizeMemoryValue(value: unknown, maxReadBytes: number): unknown {
  const seen = new WeakSet<object>();
  const state = {
    nodes: 0,
    maxNodes: Math.max(4, Math.min(100, Math.floor(Math.max(1, maxReadBytes) / 16))),
    maxStringChars: Math.max(16, Math.min(512, Math.floor(Math.max(1, maxReadBytes) / 4))),
  };
  const visit = (current: unknown, key: string, depth: number): unknown => {
    if (isSecretLikeKey(key)) return redactedMarker;
    if (state.nodes >= state.maxNodes || depth > 6) return "[TRUNCATED]";
    state.nodes += 1;
    if (typeof current === "string") return truncate(current, state.maxStringChars);
    if (typeof current === "bigint") return current.toString();
    if (typeof current === "function" || typeof current === "symbol") return `[${typeof current}]`;
    if (current === null || typeof current !== "object") return current;
    if (seen.has(current)) return "[Circular]";
    seen.add(current);
    if (Array.isArray(current)) {
      return current.slice(0, state.maxNodes).map((entry) => visit(entry, "", depth + 1));
    }
    const result: Record<string, unknown> = {};
    let propertyCount = 0;
    try {
      for (const entryKey in current as Record<string, unknown>) {
        if (propertyCount >= state.maxNodes || state.nodes >= state.maxNodes) break;
        let own = false;
        try {
          own = Object.prototype.hasOwnProperty.call(current, entryKey);
        } catch {
          result[entryKey] = "[UNAVAILABLE]";
          propertyCount += 1;
          continue;
        }
        if (!own) continue;
        propertyCount += 1;
        if (isSecretLikeKey(entryKey)) {
          result[entryKey] = redactedMarker;
          continue;
        }
        try {
          result[entryKey] = visit(
            (current as Record<string, unknown>)[entryKey],
            entryKey,
            depth + 1,
          );
        } catch {
          result[entryKey] = "[UNAVAILABLE]";
        }
      }
    } catch {
      return "[UNAVAILABLE]";
    }
    return result;
  };
  return visit(value, "", 0);
}

function isSecretLikeKey(value: string): boolean {
  return /api.?key|password|passphrase|token|secret|authorization|credential|private.?key/i.test(value);
}

function getBinaryView(value: unknown): Uint8Array | null {
  if (Buffer.isBuffer(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
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
  criterionLines: Array<NumberedLine & { term: string }>,
): Array<{ path: string; text: string }> {
  const terms = dedupeStrings(criterionLines.map((line) => line.term));
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
  return dedupeStrings(value.toLocaleLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) ?? []).slice(0, 16);
}

function renderRows(rows: string[][]): string {
  return rows.map((row) => row.map((value) => truncate(value, 160)).join(" | ")).join("\n");
}

function appendBoundedTail(current: Buffer, chunk: Buffer, budget: number): Buffer {
  if (chunk.length >= budget) return Buffer.from(chunk.subarray(chunk.length - budget));
  const keep = Math.max(0, budget - chunk.length);
  return Buffer.concat([current.subarray(Math.max(0, current.length - keep)), chunk]);
}

function truncateUtf8Buffer(value: string, maxBytes: number): Buffer {
  if (maxBytes <= 0) return Buffer.alloc(0);
  const buffer = Buffer.from(value, "utf8");
  if (buffer.length <= maxBytes) return buffer;
  return Buffer.from(buffer.subarray(0, maxBytes));
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
  if (value.length <= maxChars) return value;
  const suffix = `\n${truncationMarker}`;
  return `${value.slice(0, Math.max(0, maxChars - suffix.length))}${suffix}`;
}

function truncateExact(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  if (maxChars <= truncationMarker.length) return truncationMarker.slice(0, maxChars);
  return `${value.slice(0, maxChars - truncationMarker.length)}${truncationMarker}`;
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
