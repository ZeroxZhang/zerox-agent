import { readFile, writeFile } from "node:fs/promises";

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
