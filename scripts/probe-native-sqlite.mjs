import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const expectedRuntime = process.argv
  .find((argument) => argument.startsWith("--expect-runtime="))
  ?.slice("--expect-runtime=".length);
const runtime = process.versions.electron ? "electron" : "node";

try {
  if (expectedRuntime && runtime !== expectedRuntime) {
    throw new Error(
      `Expected ${expectedRuntime} runtime but native probe is running under ${runtime}.`,
    );
  }

  const Database = require("better-sqlite3");
  const database = new Database(":memory:");
  try {
    database.exec(
      "CREATE TABLE native_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL);",
    );
    database
      .prepare("INSERT INTO native_probe (value) VALUES (?)")
      .run("native-sqlite-loaded");
    const row = database
      .prepare("SELECT value FROM native_probe WHERE id = 1")
      .get();
    if (row?.value !== "native-sqlite-loaded") {
      throw new Error("Native SQLite probe did not round-trip its test row.");
    }
    console.log(
      `[smoke:native-probe] ${JSON.stringify({
        ok: true,
        runtime,
        node: process.versions.node,
        electron: process.versions.electron ?? null,
        modulesAbi: process.versions.modules,
        sqlite: database.prepare("SELECT sqlite_version() AS version").get()
          ?.version,
      })}`,
    );
  } finally {
    database.close();
  }
} catch (error) {
  console.error(
    `[smoke:native-probe] ${JSON.stringify({
      ok: false,
      runtime,
      node: process.versions.node,
      electron: process.versions.electron ?? null,
      modulesAbi: process.versions.modules,
      error: error instanceof Error ? error.message : String(error),
    })}`,
  );
  process.exitCode = 1;
}
