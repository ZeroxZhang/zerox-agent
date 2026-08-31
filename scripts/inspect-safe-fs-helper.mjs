import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

export function inspectSafeFsHelper(helperPath, options = {}) {
  const run = options.run ?? runCommand;
  const absolutePath = path.resolve(helperPath);
  const metadata = lstatSync(absolutePath);
  if (
    !metadata.isFile()
    || metadata.isSymbolicLink()
    || (metadata.mode & 0o777) !== 0o755
    || realpathSync(absolutePath) !== absolutePath
  ) {
    throw new Error("safe-fs helper must be a canonical 0755 regular file");
  }
  const bytes = readFileSync(absolutePath);
  const fileOutput = runChecked(run, "/usr/bin/file", [absolutePath]);
  const architecture = fileOutput.match(
    /Mach-O 64-bit executable (arm64|x86_64)\b/,
  )?.[1];
  if (!architecture) {
    throw new Error(`safe-fs helper architecture is invalid: ${fileOutput}`);
  }
  const loadCommands = runChecked(run, "/usr/bin/otool", ["-l", absolutePath]);
  const minimumSystemVersion = loadCommands.match(
    /cmd LC_BUILD_VERSION[\s\S]*?minos (12\.0(?:\.0)?)\b/,
  )?.[1];
  if (!minimumSystemVersion) {
    throw new Error("safe-fs helper does not preserve the macOS 12.0 target");
  }
  const libraryOutput = runChecked(run, "/usr/bin/otool", ["-L", absolutePath]);
  const linkedLibraries = libraryOutput
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(" (")[0]);
  if (
    linkedLibraries.length !== 1
    || linkedLibraries[0] !== "/usr/lib/libSystem.B.dylib"
  ) {
    throw new Error(
      `safe-fs helper has unexpected libraries: ${linkedLibraries.join(", ")}`,
    );
  }

  const result = {
    path: absolutePath,
    bytes: bytes.length,
    sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    mode: "0755",
    architecture,
    minimumSystemVersion,
    linkedLibraries,
    signatureVerified: false,
    hardenedRuntime: false,
    entitlements: "unchecked",
  };
  if (options.requireSignature !== true) return result;

  runChecked(run, "/usr/bin/codesign", [
    "--verify",
    "--strict",
    "--verbose=2",
    absolutePath,
  ]);
  const signature = runChecked(run, "/usr/bin/codesign", [
    "-dv",
    "--verbose=4",
    absolutePath,
  ]);
  if (!/flags=.*\bruntime\b/.test(signature)) {
    throw new Error("safe-fs helper signature lacks hardened runtime");
  }
  const entitlements = runChecked(run, "/usr/bin/codesign", [
    "-d",
    "--entitlements",
    ":-",
    absolutePath,
  ]);
  if (!/<dict>\s*<\/dict>/.test(entitlements) || /<key>/.test(entitlements)) {
    throw new Error("safe-fs helper must have an empty entitlement set");
  }
  return {
    ...result,
    signatureVerified: true,
    hardenedRuntime: true,
    entitlements: "empty",
  };
}

function runCommand(command, args) {
  return spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runChecked(run, command, args) {
  const result = run(command, args);
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(
      `${command} failed${output ? `: ${output}` : result.error ? `: ${result.error.message}` : ""}`,
    );
  }
  return output;
}
