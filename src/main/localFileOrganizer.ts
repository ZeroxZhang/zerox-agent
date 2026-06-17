import {
  access,
  mkdir,
  readdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

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
};

export type LocalFileOrganizationTransaction = {
  id: string;
  root: string;
  status: "pending" | "applied" | "rolled_back";
  createdAt: string;
  appliedAt?: string;
  rolledBackAt?: string;
  logPath: string;
  moves: LocalFileMovePlan[];
  movesApplied: number;
  movesRolledBack?: number;
  history: Array<{ status: "pending" | "applied" | "rolled_back"; at: string }>;
};

export type LocalFileOrganizerRuntimeOptions = {
  createId?: () => string;
  now?: () => string;
};

export async function previewLocalFileOrganization(
  root: string,
  options: LocalFileOrganizerRuntimeOptions = {},
): Promise<LocalFileOrganizationPreview> {
  const resolvedRoot = resolveUserPath(root);
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
      skipped += isOrganizerManagedDirectory(entry.name) ? 1 : 0;
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
    });
  }

  return {
    id: options.createId?.() ?? `organize_${randomUUID()}`,
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
  };
}

export async function applyLocalFileOrganization(
  preview: LocalFileOrganizationPreview,
  options: LocalFileOrganizerRuntimeOptions = {},
): Promise<LocalFileOrganizationTransaction> {
  if (preview.conflicts.length > 0) {
    throw new Error("Cannot apply local file organization while conflicts exist.");
  }

  const transaction: LocalFileOrganizationTransaction = {
    id: preview.id,
    root: preview.root,
    status: "pending",
    createdAt: preview.generatedAt,
    logPath: transactionLogPath(preview.root, preview.id),
    moves: preview.moves,
    movesApplied: 0,
    history: [{ status: "pending", at: preview.generatedAt }],
  };

  await writeTransactionLog(transaction);

  let movesApplied = 0;
  for (const move of preview.moves) {
    await mkdir(path.dirname(move.to), { recursive: true });
    await rename(move.from, move.to);
    movesApplied += 1;
  }

  const appliedTransaction: LocalFileOrganizationTransaction = {
    ...transaction,
    status: "applied",
    appliedAt: currentTimestamp(options),
    movesApplied,
    history: [
      ...transaction.history,
      { status: "applied", at: currentTimestamp(options) },
    ],
  };
  await writeTransactionLog(appliedTransaction);
  return appliedTransaction;
}

export async function rollbackLocalFileOrganization(
  transaction: LocalFileOrganizationTransaction,
  options: LocalFileOrganizerRuntimeOptions = {},
): Promise<LocalFileOrganizationTransaction> {
  let movesRolledBack = 0;

  for (const move of [...transaction.moves].reverse()) {
    if (!(await pathExists(move.to)) || (await pathExists(move.from))) {
      continue;
    }
    await mkdir(path.dirname(move.from), { recursive: true });
    await rename(move.to, move.from);
    movesRolledBack += 1;
  }

  const rolledBackTransaction: LocalFileOrganizationTransaction = {
    ...transaction,
    status: "rolled_back",
    rolledBackAt: currentTimestamp(options),
    movesRolledBack,
    history: [
      ...transaction.history,
      { status: "rolled_back", at: currentTimestamp(options) },
    ],
  };
  await writeTransactionLog(rolledBackTransaction);
  return rolledBackTransaction;
}

export async function readLocalFileOrganizationTransaction(
  logPath: string,
): Promise<LocalFileOrganizationTransaction> {
  return JSON.parse(
    await readFile(resolveUserPath(logPath), "utf8"),
  ) as LocalFileOrganizationTransaction;
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

async function writeTransactionLog(
  transaction: LocalFileOrganizationTransaction,
): Promise<void> {
  await mkdir(path.dirname(transaction.logPath), { recursive: true });
  await writeFile(transaction.logPath, `${JSON.stringify(transaction, null, 2)}\n`, "utf8");
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

function isOrganizerManagedDirectory(name: string): boolean {
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
    ".zerox-organize-transactions",
  ].includes(name);
}
