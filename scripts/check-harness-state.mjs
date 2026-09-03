#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

const requiredFiles = [
  "AGENTS.md",
  "init.sh",
  ".zerox/feature_list.json",
  ".zerox/progress.md",
];
for (const relativePath of requiredFiles) {
  await access(path.join(root, relativePath));
}
const packageJson = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
for (const scriptName of [
  "test",
  "build",
  "verify",
  "smoke:prod",
  "harness:check",
  "program:check",
]) {
  if (!packageJson.scripts?.[scriptName]) {
    throw new Error(`package.json scripts.${scriptName} is required`);
  }
}

await import("./check-runtime-convergence-program.mjs");
await import("./check-kernel-migration-program.mjs");
await import("./check-storage-convergence-program.mjs");
await import("./check-release-program.mjs");

console.log("Harness product contract check passed.");
