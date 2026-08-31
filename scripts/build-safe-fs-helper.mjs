#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";

if (process.platform !== "darwin") {
  console.log(JSON.stringify({ kind: "zerox-safe-fs-build", status: "skipped", platform: process.platform }));
  process.exit(0);
}

const root = path.resolve(import.meta.dirname, "..");
const architecture = process.arch === "x64" ? "x86_64" : process.arch;
if (!new Set(["arm64", "x86_64"]).has(architecture)) {
  throw new Error(`Unsupported macOS safe-fs architecture: ${process.arch}`);
}
const sourcePath = path.join(root, "native/macos/zerox-safe-fs.c");
const outputDirectory = path.join(root, `dist-native/darwin-${process.arch}`);
const outputPath = path.join(outputDirectory, "zerox-safe-fs");
const temporaryDirectory = path.join(
  outputDirectory,
  `.build-${process.pid}`,
);
const temporaryPath = path.join(temporaryDirectory, "zerox-safe-fs");
mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
mkdirSync(temporaryDirectory, { mode: 0o700 });

try {
  run("/usr/bin/xcrun", [
    "clang",
    "-arch", architecture,
    "-mmacosx-version-min=12.0",
    "-std=c17",
    "-Os",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-D_DARWIN_C_SOURCE",
    "-D_FORTIFY_SOURCE=2",
    "-fstack-protector-strong",
    "-fPIE",
    "-Wl,-pie",
    "-Wl,-dead_strip",
    "-o", temporaryPath,
    sourcePath,
  ]);
  chmodSync(temporaryPath, 0o755);
  renameSync(temporaryPath, outputPath);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

const bytes = readFileSync(outputPath);
const metadata = statSync(outputPath);
if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o755) {
  throw new Error("safe-fs helper must be a regular 0755 file");
}
const fileOutput = run("/usr/bin/file", [outputPath], true);
if (!fileOutput.includes(`Mach-O 64-bit executable ${architecture}`)) {
  throw new Error(`safe-fs helper architecture is invalid: ${fileOutput.trim()}`);
}
const loadCommands = run("/usr/bin/otool", ["-l", outputPath], true);
if (!/cmd LC_BUILD_VERSION[\s\S]*?minos 12\.0(?:\.0)?\b/.test(loadCommands)) {
  throw new Error("safe-fs helper does not preserve the macOS 12.0 deployment target");
}
const linkedLibraries = run("/usr/bin/otool", ["-L", outputPath], true);
const unexpectedLibraries = linkedLibraries
  .split("\n")
  .slice(1)
  .map((line) => line.trim())
  .filter(Boolean)
  .filter((line) => !line.startsWith("/usr/lib/libSystem.B.dylib "));
if (unexpectedLibraries.length > 0) {
  throw new Error(`safe-fs helper has unexpected libraries: ${unexpectedLibraries.join(", ")}`);
}

console.log(JSON.stringify({
  kind: "zerox-safe-fs-build",
  status: "passed",
  platform: process.platform,
  architecture: process.arch,
  minimumSystemVersion: "12.0",
  outputPath: path.relative(root, outputPath),
  bytes: bytes.length,
  sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
}));

function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.signal || result.status !== 0) {
    throw new Error(
      `${command} failed${result.signal ? ` with ${result.signal}` : ` with ${result.status}`}`
      + `${result.stderr ? `: ${result.stderr.trim()}` : ""}`,
    );
  }
  return result.stdout ?? "";
}
