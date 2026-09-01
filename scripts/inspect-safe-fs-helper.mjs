import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

export function inspectSafeFsHelper(helperPath, options = {}) {
  const run = options.run ?? runCommand;
  const absolutePath = path.resolve(helperPath);
  const initialCapture = captureSafeFsHelper(absolutePath);
  const fileOutput = runChecked(
    run,
    "/usr/bin/file",
    [absolutePath],
    { output: "stdout" },
  );
  const architecture = fileOutput.match(
    /Mach-O 64-bit executable (arm64|x86_64)\b/,
  )?.[1];
  if (!architecture) {
    throw new Error(`safe-fs helper architecture is invalid: ${fileOutput}`);
  }
  const loadCommands = runChecked(
    run,
    "/usr/bin/otool",
    ["-l", absolutePath],
    { output: "stdout" },
  );
  const minimumSystemVersion = loadCommands.match(
    /cmd LC_BUILD_VERSION[\s\S]*?minos (12\.0(?:\.0)?)\b/,
  )?.[1];
  if (!minimumSystemVersion) {
    throw new Error("safe-fs helper does not preserve the macOS 12.0 target");
  }
  const libraryOutput = runChecked(
    run,
    "/usr/bin/otool",
    ["-L", absolutePath],
    { output: "stdout" },
  );
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

  assertSameSafeFsCapture(
    initialCapture,
    captureSafeFsHelper(absolutePath),
  );

  const result = {
    path: absolutePath,
    bytes: initialCapture.bytes.length,
    sha256: initialCapture.digest,
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
  assertSameSafeFsCapture(
    initialCapture,
    captureSafeFsHelper(absolutePath),
  );
  return {
    ...result,
    signatureVerified: true,
    hardenedRuntime: true,
    entitlements: "empty",
  };
}

export function inspectPinnedUnsignedSafeFsHelper(
  helperPath,
  policy,
  options = {},
) {
  const inspection = inspectSafeFsHelper(helperPath, options);
  if (
    policy
    && inspection.sha256 !== policy.safeFsHelperDigest
  ) {
    throw new Error(
      "unsigned safe-fs helper digest differs from the caller-reviewed policy",
    );
  }
  return inspection;
}

export function assertUnchangedUnsignedSafeFsHelper(before, after) {
  const fields = [
    "bytes",
    "sha256",
    "mode",
    "architecture",
    "minimumSystemVersion",
  ];
  if (
    fields.some((field) => before?.[field] !== after?.[field])
    || JSON.stringify(before?.linkedLibraries)
      !== JSON.stringify(after?.linkedLibraries)
  ) {
    throw new Error("unsigned safe-fs helper changed before packaging");
  }
}

function captureSafeFsHelper(absolutePath) {
  const descriptor = openSync(
    absolutePath,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const before = fstatSync(descriptor);
    if (
      !before.isFile()
      || before.nlink !== 1
      || (before.mode & 0o777) !== 0o755
    ) {
      throw new Error("safe-fs helper must be a canonical 0755 regular file");
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    const leaf = lstatSync(absolutePath);
    if (
      !after.isFile()
      || after.dev !== before.dev
      || after.ino !== before.ino
      || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs
      || after.ctimeMs !== before.ctimeMs
      || !leaf.isFile()
      || leaf.isSymbolicLink()
      || leaf.nlink !== 1
      || leaf.dev !== before.dev
      || leaf.ino !== before.ino
      || realpathSync(absolutePath) !== absolutePath
    ) {
      throw new Error("safe-fs helper identity changed while reading");
    }
    return {
      bytes,
      dev: before.dev,
      ino: before.ino,
      size: before.size,
      mtimeMs: before.mtimeMs,
      ctimeMs: before.ctimeMs,
      digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    };
  } finally {
    closeSync(descriptor);
  }
}

function assertSameSafeFsCapture(before, after) {
  if (
    before.dev !== after.dev
    || before.ino !== after.ino
    || before.size !== after.size
    || before.mtimeMs !== after.mtimeMs
    || before.ctimeMs !== after.ctimeMs
    || before.digest !== after.digest
  ) {
    throw new Error("safe-fs helper identity changed during inspection");
  }
}

function runCommand(command, args) {
  return spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runChecked(run, command, args, options = {}) {
  const result = run(command, args);
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const diagnosticOutput = `${stdout}${stderr}`.trim();
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(
      `${command} failed${diagnosticOutput ? `: ${diagnosticOutput}` : result.error ? `: ${result.error.message}` : ""}`,
    );
  }
  return (options.output === "stdout" ? stdout : diagnosticOutput).trim();
}
