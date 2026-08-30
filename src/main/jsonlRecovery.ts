import { constants } from "node:fs";
import { open, readFile, writeFile } from "node:fs/promises";

export const RECOVERABLE_JSONL_PAGE_MAX_BYTES = 8 * 1024 * 1024;
export const RECOVERABLE_JSONL_RECORD_MAX_BYTES = 1024 * 1024;

export type RecoverableJsonlPage<T> = {
  records: T[];
  sourceRevision: string;
  nextOffset?: number;
  complete: boolean;
  malformedLineCount: number;
  status: "complete" | "partial" | "incompatible";
  reasonCode?: "corrupt_record" | "truncated_tail" | "page_byte_limit"
    | "oversized_record" | "source_changed";
};

export async function readRecoverableJsonl<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await readFile(filePath, "utf8");
    const records: T[] = [];
    const corruptLines: Array<{
      lineNumber: number;
      line: string;
      error: string;
      at: string;
    }> = [];

    raw.split("\n").forEach((line, index) => {
      if (!line.trim()) {
        return;
      }
      try {
        records.push(JSON.parse(line) as T);
      } catch (error) {
        corruptLines.push({
          lineNumber: index + 1,
          line,
          error: (error as Error).message,
          at: new Date().toISOString(),
        });
      }
    });

    if (corruptLines.length) {
      await writeFile(
        `${filePath}.corrupt-lines-${Date.now()}.jsonl`,
        corruptLines.map((line) => JSON.stringify(line)).join("\n") + "\n",
        "utf8",
      ).catch(() => undefined);
    }

    return records;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

export async function readRecoverableJsonlPage<T>(
  filePath: string,
  options: {
    offset?: number;
    limit: number;
    endOffset?: number;
    expectedIdentity?: { dev: string; ino: string };
    maxBytes?: number;
    maxRecordBytes?: number;
    signal?: AbortSignal;
  },
): Promise<RecoverableJsonlPage<T>> {
  throwIfAborted(options.signal);
  const limit = Math.max(1, Math.floor(options.limit));
  const maxBytes = Math.max(
    1,
    Math.min(
      RECOVERABLE_JSONL_PAGE_MAX_BYTES,
      Math.floor(options.maxBytes ?? RECOVERABLE_JSONL_PAGE_MAX_BYTES),
    ),
  );
  const maxRecordBytes = Math.max(
    1,
    Math.min(
      RECOVERABLE_JSONL_RECORD_MAX_BYTES,
      Math.floor(options.maxRecordBytes ?? RECOVERABLE_JSONL_RECORD_MAX_BYTES),
    ),
  );
  let handle;
  try {
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        records: [],
        sourceRevision: "jsonl:missing",
        complete: true,
        malformedLineCount: 0,
        status: "complete",
      };
    }
    throw error;
  }

  try {
    const initial = await handle.stat({ bigint: true });
    if (!initial.isFile() || initial.nlink !== 1n) {
      throw new Error("JSONL source must be a single-link regular file.");
    }
    const identity = {
      dev: initial.dev.toString(),
      ino: initial.ino.toString(),
    };
    if (
      options.expectedIdentity
      && (
        options.expectedIdentity.dev !== identity.dev
        || options.expectedIdentity.ino !== identity.ino
      )
    ) {
      return incompatiblePage<T>(
        jsonlRevision(initial),
        "source_changed",
      );
    }

    const offset = normalizeOffset(options.offset);
    const requestedEnd = options.endOffset === undefined
      ? Number(initial.size)
      : normalizeOffset(options.endOffset);
    const endOffset = Math.min(Number(initial.size), requestedEnd);
    if (offset > endOffset || requestedEnd > Number(initial.size)) {
      return incompatiblePage<T>(
        jsonlRevision(initial),
        "source_changed",
      );
    }

    const records: T[] = [];
    let malformedLineCount = 0;
    let readOffset = offset;
    let consumedOffset = offset;
    let scannedBytes = 0;
    let pending = Buffer.alloc(0);
    let reasonCode: RecoverableJsonlPage<T>["reasonCode"];
    const chunk = Buffer.allocUnsafe(64 * 1024);

    while (
      records.length < limit
      && readOffset < endOffset
      && scannedBytes < maxBytes
    ) {
      throwIfAborted(options.signal);
      const requested = Math.min(
        chunk.length,
        endOffset - readOffset,
        maxBytes - scannedBytes,
      );
      const { bytesRead } = await handle.read(
        chunk,
        0,
        requested,
        readOffset,
      );
      if (bytesRead === 0) break;
      readOffset += bytesRead;
      scannedBytes += bytesRead;
      pending = Buffer.concat([pending, chunk.subarray(0, bytesRead)]);

      let newline = pending.indexOf(0x0a);
      while (newline >= 0 && records.length < limit) {
        const line = pending.subarray(0, newline);
        pending = pending.subarray(newline + 1);
        consumedOffset += newline + 1;
        if (line.length > maxRecordBytes) {
          return incompatiblePage<T>(
            jsonlRevision(initial),
            "oversized_record",
          );
        }
        if (line.toString("utf8").trim()) {
          try {
            records.push(JSON.parse(line.toString("utf8")) as T);
          } catch {
            malformedLineCount += 1;
            reasonCode ??= "corrupt_record";
          }
        }
        newline = pending.indexOf(0x0a);
      }
      if (pending.length > maxRecordBytes) {
        return incompatiblePage<T>(
          jsonlRevision(initial),
          "oversized_record",
        );
      }
    }

    if (records.length < limit && readOffset >= endOffset && pending.length > 0) {
      consumedOffset = endOffset;
      malformedLineCount += 1;
      reasonCode = "truncated_tail";
    } else if (
      records.length < limit
      && scannedBytes >= maxBytes
      && consumedOffset < endOffset
    ) {
      reasonCode ??= "page_byte_limit";
    }

    throwIfAborted(options.signal);
    const final = await handle.stat({ bigint: true });
    if (
      final.dev !== initial.dev
      || final.ino !== initial.ino
      || final.size < BigInt(endOffset)
      || final.mtimeNs !== initial.mtimeNs
      || final.ctimeNs !== initial.ctimeNs
    ) {
      return incompatiblePage<T>(
        jsonlRevision(final),
        "source_changed",
      );
    }

    const complete = consumedOffset >= endOffset;
    const status = reasonCode || malformedLineCount > 0
      ? "partial"
      : "complete";
    return {
      records,
      sourceRevision: jsonlRevision(initial, endOffset),
      complete,
      malformedLineCount,
      status,
      ...(!complete ? { nextOffset: consumedOffset } : {}),
      ...(reasonCode ? { reasonCode } : {}),
    };
  } finally {
    await handle.close();
  }
}

function jsonlRevision(
  source: Awaited<ReturnType<Awaited<ReturnType<typeof open>>["stat"]>>,
  endOffset = Number(source.size),
): string {
  const record = source as unknown as {
    dev: bigint;
    ino: bigint;
    size: bigint;
    mtimeNs: bigint;
    ctimeNs: bigint;
  };
  return [
    "jsonl",
    record.dev.toString(),
    record.ino.toString(),
    String(endOffset),
    record.mtimeNs.toString(),
    record.ctimeNs.toString(),
  ].join(":");
}

function incompatiblePage<T>(
  sourceRevision: string,
  reasonCode: Extract<
    RecoverableJsonlPage<T>["reasonCode"],
    "oversized_record" | "source_changed"
  >,
): RecoverableJsonlPage<T> {
  return {
    records: [],
    sourceRevision,
    complete: false,
    malformedLineCount: 0,
    status: "incompatible",
    reasonCode,
  };
}

function normalizeOffset(value: number | undefined): number {
  const parsed = Math.floor(Number(value ?? 0));
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("JSONL page offset is invalid.");
  }
  return parsed;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("JSONL page read was canceled.", "AbortError");
}
