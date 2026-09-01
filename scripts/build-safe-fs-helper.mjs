#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
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
const EXPECTED_COMPILER = Object.freeze({
  configuredPath: "/Library/Developer/CommandLineTools/usr/bin/clang",
  canonicalPath: "/Library/Developer/CommandLineTools/usr/bin/clang",
  digest: "sha256:f30550eab15fdf5ab8c0dc54c52679711241e5d4b636b027e18c09fef531775d",
});
const EXPECTED_SDK = Object.freeze({
  configuredPath: "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk",
  canonicalPath: "/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk",
  settingsDigest:
    "sha256:f8d005f09381389167f9e0aeaa169bc9e7dff162ef22ca2fd8e98df7ff1acafe",
});
const EXPECTED_SAFE_FS_HELPER_DIGEST =
  "sha256:58b2493f585d2bc814ff44092fdde3b3debb793ea715a4a14b7fc638b0c04ad6";
const TOOLCHAIN_POLICY_NAME = ".v392-pinned-safe-fs-toolchain.json";
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
const toolchainPolicy = loadPinnedToolchainPolicy();
const configuredCompiler = process.env.CC?.trim()
  || toolchainPolicy?.compiler.configuredPath
  || resolveXcrun(["--find", "clang"]);
if (toolchainPolicy && configuredCompiler !== toolchainPolicy.compiler.configuredPath) {
  throw new Error("CC differs from the caller-reviewed compiler path");
}
if (!path.isAbsolute(configuredCompiler)) {
  throw new Error("CC must resolve to an absolute compiler path");
}
const compilerPath = realpathSync(configuredCompiler);
if (toolchainPolicy && compilerPath !== toolchainPolicy.compiler.canonicalPath) {
  throw new Error("CC canonical path differs from the caller-reviewed compiler");
}
const configuredSdkRoot = process.env.SDKROOT?.trim()
  || toolchainPolicy?.sdk.configuredPath
  || resolveXcrun(["--show-sdk-path"]);
if (toolchainPolicy && configuredSdkRoot !== toolchainPolicy.sdk.configuredPath) {
  throw new Error("SDKROOT differs from the caller-reviewed SDK path");
}
if (!path.isAbsolute(configuredSdkRoot)) {
  throw new Error("SDKROOT must resolve to an absolute SDK path");
}
const sdkRoot = realpathSync(configuredSdkRoot);
if (toolchainPolicy && sdkRoot !== toolchainPolicy.sdk.canonicalPath) {
  throw new Error("SDKROOT canonical path differs from the caller-reviewed SDK");
}
const buildToolchainBefore = toolchainPolicy
  ? await capturePinnedBuildToolchain(toolchainPolicy)
  : null;
mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
mkdirSync(temporaryDirectory, { mode: 0o700 });

let buildError;
try {
  run(compilerPath, [
    "-arch", architecture,
    "-isysroot", sdkRoot,
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
} catch (error) {
  buildError = error;
}
let toolchainPostflightError;
if (toolchainPolicy) {
  try {
    const buildToolchainAfter = await capturePinnedBuildToolchain(toolchainPolicy);
    if (JSON.stringify(buildToolchainAfter) !== JSON.stringify(buildToolchainBefore)) {
      toolchainPostflightError = new Error(
        "caller-reviewed compiler or SDK changed during safe-fs build",
      );
    }
  } catch (error) {
    toolchainPostflightError = error;
  }
}
rmSync(temporaryDirectory, { recursive: true, force: true });
if (buildError && toolchainPostflightError) {
  throw new Error(
    `safe-fs build failed (${buildError.message}); toolchain postflight also failed: ${toolchainPostflightError.message}`,
    { cause: buildError },
  );
}
if (buildError) throw buildError;
if (toolchainPostflightError) throw toolchainPostflightError;

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

async function capturePinnedBuildToolchain(policy) {
  if (
    realpathSync(configuredCompiler) !== policy.compiler.canonicalPath
    || realpathSync(configuredSdkRoot) !== policy.sdk.canonicalPath
  ) {
    throw new Error("caller-reviewed compiler or SDK canonical path changed");
  }
  const compilerDigest = await sha256File(compilerPath);
  const sdkSettingsDigest = `sha256:${createHash("sha256")
    .update(readFileSync(path.join(sdkRoot, "SDKSettings.json")))
    .digest("hex")}`;
  if (
    compilerDigest !== policy.compiler.digest
    || sdkSettingsDigest !== policy.sdk.settingsDigest
  ) {
    throw new Error("caller-reviewed compiler or SDK digest changed");
  }
  return { compilerDigest, sdkSettingsDigest };
}

function loadPinnedToolchainPolicy() {
  const policyPath = path.join(path.dirname(root), TOOLCHAIN_POLICY_NAME);
  if (!existsSync(policyPath)) return null;
  const policy = JSON.parse(readFileSync(policyPath, "utf8"));
  const { digest, ...digestInput } = policy;
  const expectedShape = {
    schemaVersion: 1,
    kind: "v3.9.2-pinned-safe-fs-toolchain",
    compiler: EXPECTED_COMPILER,
    sdk: EXPECTED_SDK,
    safeFsHelperDigest: EXPECTED_SAFE_FS_HELPER_DIGEST,
  };
  if (
    JSON.stringify(digestInput) !== JSON.stringify(expectedShape)
    || digest !== hashCanonical(digestInput)
  ) {
    throw new Error("caller-owned safe-fs toolchain policy is invalid");
  }
  return policy;
}

function resolveXcrun(args) {
  const result = spawnSync("/usr/bin/xcrun", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.signal || result.status !== 0) {
    throw new Error(
      `/usr/bin/xcrun failed${result.signal ? ` with ${result.signal}` : ` with ${result.status}`}`
      + `${result.stderr ? `: ${result.stderr.trim()}` : ""}`,
    );
  }
  return result.stdout.trim();
}

function hashCanonical(value) {
  return `sha256:${createHash("sha256")
    .update(Buffer.from(canonicalJson(value)))
    .digest("hex")}`;
}

function canonicalJson(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return `sha256:${hash.digest("hex")}`;
}
