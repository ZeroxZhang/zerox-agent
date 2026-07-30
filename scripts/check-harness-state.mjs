import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const requiredFiles = [
  "AGENTS.md",
  "init.sh",
  ".zerox/feature_list.json",
  ".zerox/progress.md",
  ".zerox/golden-principles.md",
  "docs/superpowers/specs/2026-06-09-harness-engineering-iteration-spec.md",
  "docs/superpowers/plans/2026-06-09-harness-engineering-iteration.md",
];

const requiredScripts = [
  "test",
  "build",
  "verify",
  "smoke:providers",
  "smoke:prod",
  "eval:agent",
  "eval:memory",
  "harness:check",
];

const missing = [];

for (const file of requiredFiles) {
  try {
    await access(path.join(root, file));
  } catch {
    missing.push(file);
  }
}

const packageJson = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);

for (const scriptName of requiredScripts) {
  if (!packageJson.scripts?.[scriptName]) {
    missing.push(`package.json scripts.${scriptName}`);
  }
}

if (missing.length) {
  console.error("Harness check failed:");
  for (const item of missing) {
    console.error(`- ${item}`);
  }
  process.exit(1);
}

console.log("Harness check passed.");
