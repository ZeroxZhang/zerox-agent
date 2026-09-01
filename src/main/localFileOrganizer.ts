import {
  access,
  lstat,
  open,
  readdir,
  realpath,
} from "node:fs/promises";
import { constants, type BigIntStats } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { validatePathInsideLocationRoots } from "../shared/locationResource";
import { assertSafeStoreEntityId } from "./storeEntityId";

const RECONCILIATION_MARKER_BODY =
  '{"schemaVersion":1,"kind":"local-file-organization-reconciliation-required"}\n';
const MAX_TRANSACTION_LOG_BYTES = 4 * 1024 * 1024;
const MAX_RECONCILIATION_MARKER_BYTES = Buffer.byteLength(
  RECONCILIATION_MARKER_BODY,
  "utf8",
);

export type LocalFileCategory =
  | "Images"
  | "Documents"
  | "Archives"
  | "Audio"
  | "Video"
  | "Code"
  | "Spreadsheets"
  | "Presentations"
  | "Other";

export type LocalFileMovePlan = {
  from: string;
  to: string;
  category: LocalFileCategory;
  reason: string;
  sourceIdentity?: LocalFileIdentity;
};

type LocalFileIdentity = {
  dev: string;
  ino: string;
  size: string;
  uid: string;
  sha256: string;
};

type LocalDirectoryIdentity = {
  dev: string;
  ino: string;
  uid: string;
  mode: string;
};

export type LocalFileMoveConflict = {
  from: string;
  to: string;
  reason: "target_exists" | "source_not_file";
};

export type LocalFileOrganizationPreview = {
  id: string;
  root: string;
  generatedAt: string;
  confirmationRequired: true;
  inventory: {
    files: number;
    directories: number;
    skipped: number;
  };
  moves: LocalFileMovePlan[];
  conflicts: LocalFileMoveConflict[];
  rootIdentity?: LocalDirectoryIdentity;
};

export type LocalFileOrganizationTransaction = {
  id: string;
  root: string;
  status: "pending" | "applied" | "rolled_back" | "reconciliation_required";
  createdAt: string;
  appliedAt?: string;
  rolledBackAt?: string;
  logPath: string;
  moves: LocalFileMovePlan[];
  movesApplied: number;
  movesRolledBack?: number;
  rootIdentity?: LocalDirectoryIdentity;
  logIdentity?: LocalFileIdentity;
  reconciliation?: {
    required: true;
    kind: "marker" | "legacy_journal";
    markerPath?: string;
    reason?:
      | "v3.9.1_transaction_requires_manual_reconciliation"
      | "journal_unreadable_requires_manual_reconciliation";
  };
  history: Array<{ status: "pending" | "applied" | "rolled_back"; at: string }>;
};

export type LocalFileOrganizationVerification = {
  verified: boolean;
  checked: number;
  missingTargets: string[];
  changedTargets: string[];
  unmovedSources: string[];
  sourceConflicts: string[];
};

export type LocalFileOrganizerRuntimeOptions = {
  createId?: () => string;
  now?: () => string;
  safeFsHelperPath?: string;
  safeFsTestDelayMs?: number;
  safeFsTestReadyStage?:
    | "directories-opened"
    | "journal-bound"
    | "source-verified"
    | "move-applied"
    | "post-move-target-digest-read"
    | "log-before-mutation"
    | "log-opened"
    | "log-mutated";
  safeFsTestOnReady?: (command: string) => void;
};

export async function previewLocalFileOrganization(
  root: string,
  options: LocalFileOrganizerRuntimeOptions = {},
): Promise<LocalFileOrganizationPreview> {
  const resolvedRoot = await realpath(resolveUserPath(root));
  await assertStableDirectory(resolvedRoot, resolvedRoot);
  const rootIdentity = await readDirectoryIdentity(resolvedRoot);
  const entries = await readdir(resolvedRoot, { withFileTypes: true });
  const moves: LocalFileMovePlan[] = [];
  const conflicts: LocalFileMoveConflict[] = [];
  let fileCount = 0;
  let directoryCount = 0;
  let skipped = 0;

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const sourcePath = path.join(resolvedRoot, entry.name);
    if (entry.isDirectory()) {
      directoryCount += 1;
      skipped += 1;
      continue;
    }

    if (!entry.isFile()) {
      skipped += 1;
      conflicts.push({
        from: sourcePath,
        to: sourcePath,
        reason: "source_not_file",
      });
      continue;
    }

    fileCount += 1;
    if (entry.name.startsWith(".")) {
      skipped += 1;
      continue;
    }

    const category = categorizeFile(entry.name);
    const targetPath = path.join(resolvedRoot, category, entry.name);
    if (targetPath === sourcePath) {
      skipped += 1;
      continue;
    }

    if (await pathExists(targetPath)) {
      conflicts.push({
        from: sourcePath,
        to: targetPath,
        reason: "target_exists",
      });
      continue;
    }

    moves.push({
      from: sourcePath,
      to: targetPath,
      category,
      reason: `extension:${path.extname(entry.name).toLowerCase() || "none"}`,
      sourceIdentity: await readRegularFileIdentity(sourcePath),
    });
  }

  const id = options.createId?.() ?? `organize_${randomUUID()}`;
  assertSafeStoreEntityId(id, "Local file organization transaction id");
  return {
    id,
    root: resolvedRoot,
    generatedAt: currentTimestamp(options),
    confirmationRequired: true,
    inventory: {
      files: fileCount,
      directories: directoryCount,
      skipped,
    },
    moves,
    conflicts,
    rootIdentity,
  };
}

export async function applyLocalFileOrganization(
  preview: LocalFileOrganizationPreview,
  options: LocalFileOrganizerRuntimeOptions = {},
): Promise<LocalFileOrganizationTransaction> {
  assertSafeStoreEntityId(
    preview.id,
    "Local file organization transaction id",
  );
  if (preview.conflicts.length > 0) {
    throw new Error("Cannot apply local file organization while conflicts exist.");
  }

  const logPath = transactionLogPath(preview.root, preview.id);
  assertLocalOrganizationBoundary(preview.root, [
    logPath,
    ...preview.moves.flatMap((move) => [move.from, move.to]),
  ]);
  if (!preview.rootIdentity) {
    throw new Error("Local file organization preview lacks root identity.");
  }

  let transaction: LocalFileOrganizationTransaction = {
    id: preview.id,
    root: preview.root,
    status: "pending",
    createdAt: preview.generatedAt,
    logPath,
    moves: preview.moves,
    movesApplied: 0,
    rootIdentity: preview.rootIdentity,
    history: [{ status: "pending", at: preview.generatedAt }],
  };
  transaction = {
    ...transaction,
    logIdentity: await writeTransactionLog(transaction, options),
  };

  let movesApplied = 0;
  for (const move of preview.moves) {
    if (!move.sourceIdentity) {
      throw new Error("Local file organization preview lacks source identity.");
    }
    if (!transaction.logIdentity) {
      throw new Error("Local file organization transaction lacks log identity.");
    }
    assertMoveShape(transaction.root, move);
    await runMoveWithSafeFs(
      "move-into-category",
      transaction.root,
      transaction.rootIdentity!,
      transaction.id,
      transaction.logIdentity,
      move,
      options,
    );
    movesApplied += 1;
  }

  const appliedAt = currentTimestamp(options);
  const appliedTransaction: LocalFileOrganizationTransaction = {
    ...transaction,
    status: "applied",
    appliedAt,
    movesApplied,
    history: [
      ...transaction.history,
      { status: "applied", at: appliedAt },
    ],
  };
  return {
    ...appliedTransaction,
    logIdentity: await writeTransactionLog(appliedTransaction, options),
  };
}

export async function rollbackLocalFileOrganization(
  transaction: LocalFileOrganizationTransaction,
  options: LocalFileOrganizerRuntimeOptions = {},
): Promise<LocalFileOrganizationTransaction> {
  assertSafeStoreEntityId(
    transaction.id,
    "Local file organization transaction id",
  );
  const expectedLogPath = resolveUserPath(
    transactionLogPath(resolveUserPath(transaction.root), transaction.id),
  );
  if (resolveUserPath(transaction.logPath) !== expectedLogPath) {
    throw new Error(
      "Local file organization transaction log does not belong to the transaction.",
    );
  }
  assertLocalOrganizationBoundary(transaction.root, [
    transaction.logPath,
    ...transaction.moves.flatMap((move) => [move.from, move.to]),
  ]);
  transaction = await loadAuthoritativeTransaction(transaction);
  assertLocalOrganizationBoundary(transaction.root, [
    transaction.logPath,
    ...transaction.moves.flatMap((move) => [move.from, move.to]),
  ]);
  if (transaction.status === "reconciliation_required") {
    throw new Error(
      "Local file organization requires manual reconciliation before rollback.",
    );
  }
  if (!transaction.rootIdentity || !transaction.logIdentity) {
    throw new Error("Local file organization transaction lacks native identities.");
  }

  const rollbackSteps: Array<{
    move: LocalFileMovePlan;
    disposition: "move" | "already_restored";
  }> = [];
  // Preflight every move before changing any path. A rollback conflict must
  // leave the canonical transaction in its applied state; partial rollback
  // cannot be reported as complete.
  for (const move of [...transaction.moves].reverse()) {
    if (!move.sourceIdentity) {
      throw new Error("Local file organization transaction lacks source identity.");
    }
    const [fromIdentity, toIdentity] = await Promise.all([
      readRegularFileIdentityOrNull(move.from),
      readRegularFileIdentityOrNull(move.to),
    ]);
    if (fromIdentity && !identitiesEqual(fromIdentity, move.sourceIdentity)) {
      throw new Error(`Local file organization rollback source conflict: ${move.from}`);
    }
    if (toIdentity && !identitiesEqual(toIdentity, move.sourceIdentity)) {
      throw new Error(`Local file organization rollback target identity changed: ${move.to}`);
    }
    if (fromIdentity && toIdentity) {
      throw new Error(
        `Local file organization rollback preserved duplicate links for manual reconciliation: ${move.from}`,
      );
    } else if (fromIdentity) {
      rollbackSteps.push({ move, disposition: "already_restored" });
    } else if (toIdentity) {
      rollbackSteps.push({ move, disposition: "move" });
    } else {
      throw new Error(`Local file organization rollback lost both paths: ${move.from}`);
    }
  }

  let movesRolledBack = 0;
  for (const step of rollbackSteps) {
    const { move } = step;
    if (step.disposition === "already_restored") {
      movesRolledBack += 1;
      continue;
    }
    const identity = move.sourceIdentity;
    if (!identity) {
      throw new Error("Local file organization transaction lacks source identity.");
    }
    assertMoveShape(transaction.root, move);
    await runMoveWithSafeFs(
      "move-from-category",
      transaction.root,
      transaction.rootIdentity,
      transaction.id,
      transaction.logIdentity,
      move,
      options,
    );
    movesRolledBack += 1;
  }

  const rolledBackAt = currentTimestamp(options);
  const rolledBackTransaction: LocalFileOrganizationTransaction = {
    ...transaction,
    status: "rolled_back",
    rolledBackAt,
    movesRolledBack,
    history: [
      ...transaction.history,
      { status: "rolled_back", at: rolledBackAt },
    ],
  };
  return {
    ...rolledBackTransaction,
    logIdentity: await writeTransactionLog(rolledBackTransaction, options),
  };
}

export async function verifyLocalFileOrganization(
  transaction: LocalFileOrganizationTransaction,
): Promise<LocalFileOrganizationVerification> {
  assertSafeStoreEntityId(
    transaction.id,
    "Local file organization transaction id",
  );
  assertLocalOrganizationBoundary(transaction.root, [
    transaction.logPath,
    ...transaction.moves.flatMap((move) => [move.from, move.to]),
  ]);
  transaction = await loadAuthoritativeTransaction(transaction);
  assertLocalOrganizationBoundary(transaction.root, [
    transaction.logPath,
    ...transaction.moves.flatMap((move) => [move.from, move.to]),
  ]);
  const missingTargets: string[] = [];
  const changedTargets: string[] = [];
  const unmovedSources: string[] = [];
  const sourceConflicts: string[] = [];
  if (transaction.status === "reconciliation_required") {
    return {
      verified: false,
      checked: transaction.moves.length,
      missingTargets,
      changedTargets,
      unmovedSources,
      sourceConflicts,
    };
  }
  if (!transaction.rootIdentity || !transaction.logIdentity) {
    throw new Error("Local file organization transaction lacks native identities.");
  }
  for (const move of transaction.moves) {
    if (!move.sourceIdentity) {
      throw new Error("Local file organization transaction lacks source identity.");
    }
    assertMoveShape(transaction.root, move);
    const [source, target] = await Promise.all([
      inspectRegularFileIdentity(move.from),
      inspectRegularFileIdentity(move.to),
    ]);
    if (target.kind === "missing") {
      missingTargets.push(move.to);
    } else if (
      target.kind === "invalid"
      || !identitiesEqual(target.identity, move.sourceIdentity)
    ) {
      changedTargets.push(move.to);
    }
    if (source.kind === "regular") {
      if (identitiesEqual(source.identity, move.sourceIdentity)) {
        unmovedSources.push(move.from);
      } else {
        sourceConflicts.push(move.from);
      }
    } else if (source.kind === "invalid") {
      sourceConflicts.push(move.from);
    }
    if (
      source.kind === "missing"
      && target.kind === "regular"
      && identitiesEqual(target.identity, move.sourceIdentity)
    ) {
      try {
        await runVerifyWithSafeFs(
          transaction.root,
          transaction.rootIdentity,
          transaction.id,
          transaction.logIdentity,
          move,
        );
      } catch {
        changedTargets.push(move.to);
      }
    }
  }
  return {
    verified:
      transaction.status === "applied"
      && missingTargets.length === 0
      && changedTargets.length === 0
      && unmovedSources.length === 0
      && sourceConflicts.length === 0,
    checked: transaction.moves.length,
    missingTargets,
    changedTargets,
    unmovedSources,
    sourceConflicts,
  };
}

function assertLocalOrganizationBoundary(root: string, paths: string[]): void {
  const resolvedRoot = resolveUserPath(root);
  for (const candidatePath of [resolvedRoot, ...paths.map(resolveUserPath)]) {
    const result = validatePathInsideLocationRoots(candidatePath, [resolvedRoot], {
      workspaceRoot: resolvedRoot,
    });
    if (!result.ok) {
      throw new Error(`Local file organization path is outside the preview root: ${candidatePath}`);
    }
  }
}

export async function readLocalFileOrganizationTransaction(
  logPath: string,
): Promise<LocalFileOrganizationTransaction> {
  const resolvedLogPath = resolveUserPath(logPath);
  const reconciliationContext = deriveReconciliationContext(resolvedLogPath);
  let markerStats = await readReconciliationMarker(
    reconciliationContext.markerPath,
  );
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(
      resolvedLogPath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
  } catch (error) {
    markerStats ??= await readReconciliationMarker(
      reconciliationContext.markerPath,
    );
    if (markerStats) {
      return createUnreadableJournalReconciliation(
        reconciliationContext,
        markerStats,
      );
    }
    throw error;
  }
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n) {
      throw new Error("Local file organization journal is not a single-link regular file.");
    }
    if ((before.mode & 0o022n) !== 0n) {
      throw new Error("Legacy local file organization journal permissions are unsafe.");
    }
    const oversized = before.size > BigInt(MAX_TRANSACTION_LOG_BYTES);
    const bytes = oversized
      ? undefined
      : await readBoundedFileHandle(
          handle,
          Number(before.size),
          "Local file organization journal",
        );
    const [after, leaf, directory, canonicalPath] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(resolvedLogPath, { bigint: true }),
      lstat(path.dirname(resolvedLogPath), { bigint: true }),
      realpath(resolvedLogPath),
    ]);
    if (
      !directory.isDirectory()
      || directory.isSymbolicLink()
      || before.uid !== directory.uid
      || !after.isFile()
      || after.nlink !== 1n
      || after.uid !== before.uid
      || after.dev !== before.dev
      || after.ino !== before.ino
      || (after.mode & 0o777n) !== (before.mode & 0o777n)
      || after.size !== before.size
      || after.mtimeNs !== before.mtimeNs
      || after.ctimeNs !== before.ctimeNs
      || !leaf.isFile()
      || leaf.isSymbolicLink()
      || leaf.dev !== before.dev
      || leaf.ino !== before.ino
      || canonicalPath !== resolvedLogPath
    ) {
      throw new Error("Local file organization journal identity changed while reading.");
    }
    if (oversized) {
      throw new Error("Local file organization journal exceeds the safe size limit.");
    }
    const body = bytes!.toString("utf8");
    const parsed = parseTransactionJournal(body);
    const transaction = parsed.transaction;
    if (parsed.format === "current") {
      if (
        (before.mode & 0o777n) !== 0o600n
        || (after.mode & 0o777n) !== 0o600n
      ) {
        throw new Error("Local file organization journal identity changed while reading.");
      }
    } else if (
      (before.mode & 0o022n) !== 0n
      || (after.mode & 0o022n) !== 0n
    ) {
      throw new Error("Legacy local file organization journal permissions are unsafe.");
    }
    assertSafeStoreEntityId(
      transaction.id,
      "Local file organization transaction id",
    );
    const canonicalTransactionLogPath = resolveUserPath(
      transactionLogPath(resolveUserPath(transaction.root), transaction.id),
    );
    if (
      resolveUserPath(transaction.logPath) !== resolvedLogPath
      || canonicalTransactionLogPath !== resolvedLogPath
    ) {
      throw new Error("Local file organization journal path does not match its transaction.");
    }
    if (
      transaction.id !== reconciliationContext.id
      || resolveUserPath(transaction.root) !== reconciliationContext.root
    ) {
      throw new Error("Local file organization journal path does not match its transaction.");
    }
    return {
      ...transaction,
      ...(markerStats
        ? {
            status: "reconciliation_required" as const,
            reconciliation: {
              required: true as const,
              kind: "marker" as const,
              markerPath: reconciliationContext.markerPath,
            },
          }
        : parsed.format === "legacy_v3.9.1"
          ? {
              status: "reconciliation_required" as const,
              reconciliation: {
                required: true as const,
                kind: "legacy_journal" as const,
                reason: "v3.9.1_transaction_requires_manual_reconciliation" as const,
              },
            }
          : {}),
      ...(parsed.format === "current"
        ? {
            logIdentity: {
              dev: after.dev.toString(),
              ino: after.ino.toString(),
              size: after.size.toString(),
              uid: after.uid.toString(),
              sha256: `sha256:${createHash("sha256").update(bytes!).digest("hex")}`,
            },
          }
        : { logIdentity: undefined }),
    };
  } catch (error) {
    markerStats ??= await readReconciliationMarker(
      reconciliationContext.markerPath,
    );
    if (markerStats) {
      return createUnreadableJournalReconciliation(
        reconciliationContext,
        markerStats,
      );
    }
    throw error;
  } finally {
    await handle.close();
  }
}

function deriveReconciliationContext(logPath: string): {
  id: string;
  root: string;
  logPath: string;
  markerPath: string;
} {
  const directory = path.dirname(logPath);
  const leaf = path.basename(logPath);
  if (path.basename(directory) !== ".zerox-organize-transactions") {
    throw new Error("Local file organization journal is outside its transaction directory.");
  }
  const match = /^([A-Za-z0-9][A-Za-z0-9._:-]{0,249})\.json$/.exec(leaf);
  if (!match) {
    throw new Error("Local file organization journal name is invalid.");
  }
  const id = match[1];
  assertSafeStoreEntityId(id, "Local file organization transaction id");
  const root = resolveUserPath(path.dirname(directory));
  return {
    id,
    root,
    logPath,
    markerPath: reconciliationMarkerPath(root, id),
  };
}

function createUnreadableJournalReconciliation(
  context: ReturnType<typeof deriveReconciliationContext>,
  authorityStats: BigIntStats,
): LocalFileOrganizationTransaction {
  return {
    id: context.id,
    root: context.root,
    status: "reconciliation_required",
    createdAt: new Date(Number(authorityStats.mtimeMs)).toISOString(),
    logPath: context.logPath,
    moves: [],
    movesApplied: 0,
    reconciliation: {
      required: true,
      kind: "marker",
      markerPath: context.markerPath,
      reason: "journal_unreadable_requires_manual_reconciliation",
    },
    history: [],
  };
}

async function loadAuthoritativeTransaction(
  provided: LocalFileOrganizationTransaction,
): Promise<LocalFileOrganizationTransaction> {
  assertSafeStoreEntityId(
    provided.id,
    "Local file organization transaction id",
  );
  const providedRoot = resolveUserPath(provided.root);
  const expectedLogPath = resolveUserPath(
    transactionLogPath(providedRoot, provided.id),
  );
  if (resolveUserPath(provided.logPath) !== expectedLogPath) {
    throw new Error(
      "Local file organization transaction log does not belong to the transaction.",
    );
  }
  const authoritative = await readLocalFileOrganizationTransaction(
    expectedLogPath,
  );
  if (
    authoritative.id !== provided.id
    || resolveUserPath(authoritative.root) !== providedRoot
    || resolveUserPath(authoritative.logPath) !== expectedLogPath
  ) {
    throw new Error(
      "Local file organization transaction input does not match journal authority.",
    );
  }
  return authoritative;
}

function parseTransactionJournal(body: string): {
  transaction: LocalFileOrganizationTransaction;
  format: "current" | "legacy_v3.9.1";
} {
  let transaction: LocalFileOrganizationTransaction | undefined;
  try {
    transaction = parseLastJournalTransaction(body);
  } catch {
    try {
      const parsed = JSON.parse(body) as Partial<LocalFileOrganizationTransaction>;
      if (isJournalTransactionShape(parsed)) {
        transaction = parsed as LocalFileOrganizationTransaction;
      }
    } catch {
      // The canonical error below covers malformed legacy and current logs.
    }
  }
  if (!transaction) {
    throw new Error("Local file organization journal has no complete transaction record.");
  }
  const current = Boolean(
    transaction.rootIdentity
    && transaction.moves.every((move) =>
      /^sha256:[0-9a-f]{64}$/.test(move.sourceIdentity?.sha256 ?? "")
    ),
  );
  return {
    transaction,
    format: current ? "current" : "legacy_v3.9.1",
  };
}

function parseLastJournalTransaction(body: string): LocalFileOrganizationTransaction {
  const records = body.split("\n");
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index]?.trim();
    if (!record) continue;
    try {
      const value = JSON.parse(record) as Partial<LocalFileOrganizationTransaction>;
      if (isJournalTransactionShape(value)) {
        return value as LocalFileOrganizationTransaction;
      }
    } catch {
      // A killed append may leave one incomplete trailing record. Earlier
      // fsynced records remain authoritative and recoverable.
    }
  }
  throw new Error("Local file organization journal has no complete transaction record.");
}

function isJournalTransactionShape(
  value: Partial<LocalFileOrganizationTransaction>,
): boolean {
  return typeof value.id === "string"
    && typeof value.root === "string"
    && typeof value.logPath === "string"
    && ["pending", "applied", "rolled_back"].includes(value.status ?? "")
    && Array.isArray(value.moves)
    && value.moves.every((move) =>
      move
      && typeof move.from === "string"
      && typeof move.to === "string"
      && typeof move.category === "string"
      && typeof move.reason === "string"
    )
    && Array.isArray(value.history);
}

function categorizeFile(fileName: string): LocalFileCategory {
  const extension = path.extname(fileName).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".svg"].includes(extension)) {
    return "Images";
  }
  if ([".pdf", ".txt", ".rtf", ".doc", ".docx", ".pages"].includes(extension)) {
    return "Documents";
  }
  if ([".zip", ".tar", ".gz", ".rar", ".7z", ".dmg"].includes(extension)) {
    return "Archives";
  }
  if ([".mp3", ".wav", ".m4a", ".flac", ".aac"].includes(extension)) {
    return "Audio";
  }
  if ([".mp4", ".mov", ".avi", ".mkv", ".webm"].includes(extension)) {
    return "Video";
  }
  if ([
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".py",
    ".rb",
    ".go",
    ".rs",
    ".java",
    ".css",
    ".html",
    ".json",
    ".md",
  ].includes(extension)) {
    return "Code";
  }
  if ([".csv", ".xls", ".xlsx", ".numbers"].includes(extension)) {
    return "Spreadsheets";
  }
  if ([".ppt", ".pptx", ".key"].includes(extension)) {
    return "Presentations";
  }
  return "Other";
}

function transactionLogPath(root: string, id: string): string {
  return path.join(root, ".zerox-organize-transactions", `${id}.json`);
}

function reconciliationMarkerPath(root: string, id: string): string {
  return path.join(
    root,
    ".zerox-organize-transactions",
    `${id}.reconciliation`,
  );
}

async function readBoundedFileHandle(
  handle: Awaited<ReturnType<typeof open>>,
  expectedBytes: number,
  label: string,
): Promise<Buffer> {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0) {
    throw new Error(`${label} has an invalid size.`);
  }
  const bytes = Buffer.alloc(expectedBytes);
  let offset = 0;
  while (offset < expectedBytes) {
    const result = await handle.read(
      bytes,
      offset,
      expectedBytes - offset,
      offset,
    );
    if (result.bytesRead === 0) break;
    offset += result.bytesRead;
  }
  if (offset !== expectedBytes) {
    throw new Error(`${label} identity changed while reading.`);
  }
  return bytes;
}

async function readReconciliationMarker(
  markerPath: string,
): Promise<BigIntStats | null> {
  let handle;
  try {
    handle = await open(
      markerPath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    const before = await handle.stat({ bigint: true });
    if (before.size !== BigInt(MAX_RECONCILIATION_MARKER_BYTES)) {
      throw new Error(
        "Local file organization reconciliation marker is invalid: unexpected size.",
      );
    }
    const body = (
      await readBoundedFileHandle(
        handle,
        MAX_RECONCILIATION_MARKER_BYTES,
        "Local file organization reconciliation marker",
      )
    ).toString("utf8");
    const [after, leaf, directory, canonicalPath] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(markerPath, { bigint: true }),
      lstat(path.dirname(markerPath), { bigint: true }),
      realpath(markerPath),
    ]);
    if (
      !before.isFile()
      || before.nlink !== 1n
      || (before.mode & 0o777n) !== 0o600n
      || !directory.isDirectory()
      || directory.isSymbolicLink()
      || before.uid !== directory.uid
      || !after.isFile()
      || after.nlink !== 1n
      || (after.mode & 0o777n) !== 0o600n
      || after.uid !== before.uid
      || after.dev !== before.dev
      || after.ino !== before.ino
      || after.size !== before.size
      || after.mtimeNs !== before.mtimeNs
      || after.ctimeNs !== before.ctimeNs
      || !leaf.isFile()
      || leaf.isSymbolicLink()
      || leaf.dev !== before.dev
      || leaf.ino !== before.ino
      || canonicalPath !== markerPath
      || body !== RECONCILIATION_MARKER_BODY
    ) {
      throw new Error(
        "Local file organization reconciliation marker is invalid or changed while reading.",
      );
    }
    return after;
  } finally {
    await handle.close();
  }
}

async function writeTransactionLog(
  transaction: LocalFileOrganizationTransaction,
  options: LocalFileOrganizerRuntimeOptions,
): Promise<LocalFileIdentity> {
  if (!transaction.rootIdentity) {
    throw new Error("Local file organization transaction lacks root identity.");
  }
  if (transaction.status === "pending") {
    return runLogWithSafeFs(
      "log-create",
      transaction,
      `${JSON.stringify(transaction)}\n`,
      options,
    );
  }
  if (!transaction.logIdentity) {
    throw new Error("Local file organization transaction lacks log identity.");
  }
  return runLogWithSafeFs(
    "log-append",
    transaction,
    `\n${JSON.stringify(transaction)}\n`,
    options,
  );
}

async function readRegularFileIdentity(targetPath: string): Promise<LocalFileIdentity> {
  const resolvedPath = resolveUserPath(targetPath);
  const handle = await open(
    resolvedPath,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) {
      throw new Error(`Local file organization source is not a regular file: ${targetPath}`);
    }
    const hash = createHash("sha256");
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      hash.update(chunk);
    }
    const [after, leaf, canonicalPath] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(resolvedPath, { bigint: true }),
      realpath(resolvedPath),
    ]);
    if (
      !after.isFile()
      || after.dev !== before.dev
      || after.ino !== before.ino
      || after.size !== before.size
      || after.uid !== before.uid
      || after.mtimeNs !== before.mtimeNs
      || after.ctimeNs !== before.ctimeNs
      || !leaf.isFile()
      || leaf.isSymbolicLink()
      || leaf.dev !== before.dev
      || leaf.ino !== before.ino
      || canonicalPath !== resolvedPath
    ) {
      throw new Error(
        `Local file organization source changed while hashing: ${targetPath}`,
      );
    }
    return {
      dev: after.dev.toString(),
      ino: after.ino.toString(),
      size: after.size.toString(),
      uid: after.uid.toString(),
      sha256: `sha256:${hash.digest("hex")}`,
    };
  } finally {
    await handle.close();
  }
}

async function readDirectoryIdentity(
  targetPath: string,
): Promise<LocalDirectoryIdentity> {
  const stats = await lstat(targetPath, { bigint: true });
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`Local file organization root is not a stable directory: ${targetPath}`);
  }
  return {
    dev: stats.dev.toString(),
    ino: stats.ino.toString(),
    uid: stats.uid.toString(),
    mode: (stats.mode & 0o777n).toString(),
  };
}

async function readRegularFileIdentityOrNull(
  targetPath: string,
): Promise<LocalFileIdentity | null> {
  try {
    return await readRegularFileIdentity(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function inspectRegularFileIdentity(
  targetPath: string,
): Promise<
  | { kind: "missing" }
  | { kind: "invalid" }
  | { kind: "regular"; identity: LocalFileIdentity }
> {
  try {
    return { kind: "regular", identity: await readRegularFileIdentity(targetPath) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { kind: "missing" };
    }
    return { kind: "invalid" };
  }
}

function identitiesEqual(
  left: LocalFileIdentity,
  right: LocalFileIdentity,
): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.uid === right.uid
    && left.sha256 === right.sha256;
}

async function assertStableDirectory(
  root: string,
  directory: string,
): Promise<void> {
  const stats = await lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`Local file organization directory is not stable: ${directory}`);
  }
  const [resolvedRoot, resolvedDirectory] = await Promise.all([
    realpath(root),
    realpath(directory),
  ]);
  const boundary = validatePathInsideLocationRoots(
    resolvedDirectory,
    [resolvedRoot],
    { workspaceRoot: resolvedRoot },
  );
  if (!boundary.ok) {
    throw new Error(`Local file organization directory escaped its root: ${directory}`);
  }
}

function assertMoveShape(root: string, move: LocalFileMovePlan): void {
  const resolvedRoot = resolveUserPath(root);
  const sourceName = path.basename(move.from);
  const targetName = path.basename(move.to);
  if (
    path.dirname(resolveUserPath(move.from)) !== resolvedRoot
    || path.dirname(resolveUserPath(move.to)) !== path.join(resolvedRoot, move.category)
    || sourceName !== targetName
    || !isSinglePathComponent(sourceName)
    || !isOrganizerCategory(move.category)
  ) {
    throw new Error("Local file organization move shape is invalid.");
  }
}

async function runMoveWithSafeFs(
  command: "move-into-category" | "move-from-category",
  root: string,
  rootIdentity: LocalDirectoryIdentity,
  transactionId: string,
  journalIdentity: LocalFileIdentity,
  move: LocalFileMovePlan,
  options: LocalFileOrganizerRuntimeOptions,
): Promise<void> {
  const sourceIdentity = move.sourceIdentity;
  if (!sourceIdentity) {
    throw new Error("Local file organization move lacks source identity.");
  }
  await runSafeFsHelper(
    command,
    buildSafeFsMoveArgs(
      root,
      rootIdentity,
      transactionId,
      journalIdentity,
      move,
    ),
    undefined,
    options,
  );
}

async function runVerifyWithSafeFs(
  root: string,
  rootIdentity: LocalDirectoryIdentity,
  transactionId: string,
  journalIdentity: LocalFileIdentity,
  move: LocalFileMovePlan,
): Promise<void> {
  await runSafeFsHelper(
    "verify-into-category",
    buildSafeFsMoveArgs(
      root,
      rootIdentity,
      transactionId,
      journalIdentity,
      move,
    ),
    undefined,
    {},
  );
}

function buildSafeFsMoveArgs(
  root: string,
  rootIdentity: LocalDirectoryIdentity,
  transactionId: string,
  journalIdentity: LocalFileIdentity,
  move: LocalFileMovePlan,
): string[] {
  const sourceIdentity = move.sourceIdentity;
  if (!sourceIdentity) {
    throw new Error("Local file organization move lacks source identity.");
  }
  return [
    root,
    rootIdentity.dev,
    rootIdentity.ino,
    rootIdentity.uid,
    rootIdentity.mode,
    path.basename(move.from),
    move.category,
    path.basename(move.to),
    sourceIdentity.dev,
    sourceIdentity.ino,
    sourceIdentity.size,
    sourceIdentity.uid,
    sourceIdentity.sha256,
    transactionId,
    journalIdentity.dev,
    journalIdentity.ino,
    journalIdentity.size,
    journalIdentity.uid,
    journalIdentity.sha256,
  ];
}

async function runLogWithSafeFs(
  command: "log-create" | "log-append",
  transaction: LocalFileOrganizationTransaction,
  body: string,
  options: LocalFileOrganizerRuntimeOptions,
): Promise<LocalFileIdentity> {
  const rootIdentity = transaction.rootIdentity!;
  const bodyBytes = Buffer.byteLength(body, "utf8");
  const existingBytes = command === "log-append"
    ? Number(transaction.logIdentity!.size)
    : 0;
  if (
    !Number.isSafeInteger(existingBytes)
    || existingBytes < 0
    || bodyBytes > MAX_TRANSACTION_LOG_BYTES - existingBytes
  ) {
    throw new Error("Local file organization transaction log exceeds its safe size limit.");
  }
  const args = [
    transaction.root,
    rootIdentity.dev,
    rootIdentity.ino,
    rootIdentity.uid,
    rootIdentity.mode,
    transaction.id,
    ...(command === "log-append"
      ? [
          transaction.logIdentity!.dev,
          transaction.logIdentity!.ino,
          transaction.logIdentity!.size,
          transaction.logIdentity!.uid,
          transaction.logIdentity!.sha256,
        ]
      : []),
  ];
  const result = await runSafeFsHelper(command, args, body, options);
  const identity = result.identity;
  if (
    !identity
    || ![identity.dev, identity.ino, identity.size, identity.uid]
      .every((value) => typeof value === "string" && /^\d+$/.test(value))
    || !/^sha256:[0-9a-f]{64}$/.test(identity.sha256)
  ) {
    throw new Error("Local file organization helper returned an invalid log identity.");
  }
  return identity;
}

async function runSafeFsHelper(
  command: string,
  args: string[],
  input: string | undefined,
  options: LocalFileOrganizerRuntimeOptions,
): Promise<{ ok: true; identity?: LocalFileIdentity }> {
  const helperPath = await resolveSafeFsHelper(options.safeFsHelperPath);
  const inputBody = input ?? "";
  if (Buffer.byteLength(inputBody, "utf8") > MAX_TRANSACTION_LOG_BYTES) {
    throw new Error("Local file organization helper input exceeds its safe size limit.");
  }
  return new Promise((resolve, reject) => {
    const child = spawn(helperPath, [command, ...args], {
      cwd: "/",
      env: {
        ...(options.safeFsTestDelayMs === undefined
          ? {}
          : { ZEROX_SAFE_FS_TEST_DELAY_MS: String(options.safeFsTestDelayMs) }),
        ...(options.safeFsTestOnReady
          ? { ZEROX_SAFE_FS_TEST_READY: "1" }
          : {}),
        ...(options.safeFsTestReadyStage
          ? { ZEROX_SAFE_FS_TEST_READY_STAGE: options.safeFsTestReadyStage }
          : {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let outputOverflow = false;
    let readySignaled = false;
    let settled = false;
    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const resolveOnce = (value: { ok: true; identity?: LocalFileIdentity }) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      const next = appendBoundedOutput(stdout, chunk);
      if (next === null) {
        outputOverflow = true;
      } else {
        stdout = next;
      }
    });
    child.stderr.on("data", (chunk: string) => {
      const next = appendBoundedOutput(stderr, chunk);
      if (next === null) {
        outputOverflow = true;
      } else {
        stderr = next;
      }
      if (
        !readySignaled
        && stderr.includes("zerox-safe-fs-test-ready")
      ) {
        readySignaled = true;
        options.safeFsTestOnReady?.(command);
      }
    });
    child.on("error", (error) => {
      if (outputOverflow) {
        rejectOnce(new Error("Local file organization helper output exceeded its limit."));
        return;
      }
      rejectOnce(error);
    });
    child.stdin.on("error", (error) => {
      rejectOnce(new Error(
        `Local file organization helper input failed: ${error.message}`,
      ));
    });
    child.on("close", (code, signal) => {
      if (outputOverflow) {
        rejectOnce(new Error("Local file organization helper output exceeded its limit."));
        return;
      }
      if (code !== 0) {
        rejectOnce(new Error(
          stderr.trim()
          || `Local file organization helper failed (${signal ?? code ?? "unknown"}).`,
        ));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as {
          ok?: boolean;
          identity?: LocalFileIdentity;
        };
        if (parsed.ok !== true) {
          throw new Error("Local file organization helper did not confirm success.");
        }
        resolveOnce(parsed as { ok: true; identity?: LocalFileIdentity });
      } catch (error) {
        rejectOnce(error);
      }
    });
    child.stdin.end(inputBody);
  });
}

async function resolveSafeFsHelper(override?: string): Promise<string> {
  if (process.platform !== "darwin") {
    throw new Error("Secure local file organization is supported only on macOS.");
  }
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string })
    .resourcesPath;
  const candidates = override
    ? [override]
    : resourcesPath
      ? [path.join(resourcesPath, "safe-fs", "zerox-safe-fs")]
      : [path.resolve(
          __dirname,
          "..",
          "..",
          `dist-native/darwin-${process.arch}/zerox-safe-fs`,
        )];
  for (const candidate of candidates) {
    try {
      const metadata = await lstat(candidate);
      if (
        metadata.isFile()
        && !metadata.isSymbolicLink()
        && (metadata.mode & 0o111) !== 0
        && await realpath(candidate) === path.resolve(candidate)
      ) {
        return candidate;
      }
    } catch {
      continue;
    }
  }
  throw new Error("Secure local file organization helper is unavailable.");
}

function appendBoundedOutput(current: string, chunk: string): string | null {
  const combined = current + chunk;
  if (combined.length > 64 * 1024) {
    return null;
  }
  return combined;
}

function isSinglePathComponent(value: string): boolean {
  return value.length > 0
    && value !== "."
    && value !== ".."
    && !value.includes(path.sep);
}

function isOrganizerCategory(value: string): value is LocalFileCategory {
  return [
    "Images",
    "Documents",
    "Archives",
    "Audio",
    "Video",
    "Code",
    "Spreadsheets",
    "Presentations",
    "Other",
  ].includes(value);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function resolveUserPath(targetPath: string): string {
  if (targetPath === "~") {
    return os.homedir();
  }
  if (targetPath.startsWith("~/")) {
    return path.join(os.homedir(), targetPath.slice(2));
  }
  return path.resolve(targetPath);
}

function currentTimestamp(options: LocalFileOrganizerRuntimeOptions): string {
  return options.now?.() ?? new Date().toISOString();
}
