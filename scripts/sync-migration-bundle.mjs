// Regenerate src/main/storage/migrationBundle.ts from the .sql files in
// src/main/storage/migrations/. Run after editing any migration SQL.
//
//   node scripts/sync-migration-bundle.mjs
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const migrationsDir = path.join(root, "src/main/storage/migrations");
const outFile = path.join(root, "src/main/storage/migrationBundle.ts");

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const entries = files.map((name) => {
  const sql = readFileSync(path.join(migrationsDir, name), "utf8");
  const ordinal = Number.parseInt(name.split("_")[0] ?? "0", 10);
  const escaped = sql
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${");
  return `  {
    name: ${JSON.stringify(name)},
    ordinal: ${ordinal},
    sql: \`${escaped}\`,
  },`;
});

const ts = `// Auto-generated migration bundle. The canonical SQL lives in
// ./migrations/*.sql; this embedded copy is what the runtime executes (tsc
// does not copy .sql files to dist-electron, so embedding is the robust
// single-source approach). Regenerate via \`node scripts/sync-migration-bundle.mjs\`
// after editing any .sql file. Do not edit by hand.

export interface BundledMigration {
  name: string;
  ordinal: number;
  sql: string;
}

export const BUNDLED_MIGRATIONS: BundledMigration[] = [
${entries.join("\n")}
];
`;

writeFileSync(outFile, ts);
console.log(`synced ${files.length} migration(s) -> ${path.relative(root, outFile)}`);
