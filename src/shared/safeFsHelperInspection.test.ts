import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// @ts-expect-error Local build inspection intentionally remains executable JavaScript.
import { inspectSafeFsHelper } from "../../scripts/inspect-safe-fs-helper.mjs";

describe.skipIf(process.platform !== "darwin")("safe-fs helper inspection", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("builds reproducibly with the constrained Mach-O contract", () => {
    const helperPath = path.join(
      process.cwd(),
      `dist-native/darwin-${process.arch}/zerox-safe-fs`,
    );
    execFileSync(process.execPath, ["scripts/build-safe-fs-helper.mjs"], {
      cwd: process.cwd(),
    });
    const first = inspectSafeFsHelper(helperPath);
    execFileSync(process.execPath, ["scripts/build-safe-fs-helper.mjs"], {
      cwd: process.cwd(),
    });
    const second = inspectSafeFsHelper(helperPath);

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      mode: "0755",
      architecture: process.arch,
      minimumSystemVersion: expect.stringMatching(/^12\.0/),
      linkedLibraries: ["/usr/lib/libSystem.B.dylib"],
    });
    const source = readFileSync(
      path.join(process.cwd(), "native/macos/zerox-safe-fs.c"),
      "utf8",
    );
    const buildSource = readFileSync(
      path.join(process.cwd(), "scripts/build-safe-fs-helper.mjs"),
      "utf8",
    );
    expect(buildSource).toContain("const configuredCompiler = toolchainPolicy");
    expect(buildSource).toContain("? process.env.CC?.trim() || toolchainPolicy.compiler.configuredPath");
    expect(buildSource).toContain(': resolveXcrun(["--find", "clang"])');
    expect(buildSource).toContain("const compilerPath = realpathSync(configuredCompiler)");
    expect(buildSource).toContain("const sdkRoot = realpathSync(configuredSdkRoot)");
    expect(buildSource).toContain("const buildToolchainBefore = toolchainPolicy");
    expect(buildSource).toContain("await capturePinnedBuildToolchain(toolchainPolicy)");
    expect(buildSource).toContain("const buildToolchainAfter = await capturePinnedBuildToolchain(toolchainPolicy)");
    expect(buildSource).toContain("caller-reviewed compiler or SDK changed during safe-fs build");
    expect(buildSource).not.toContain('run("/usr/bin/xcrun"');
    expect(source).toContain("renameatx_np(");
    expect(source).toContain("RENAME_EXCL");
    expect(source).toContain("restore_moved_entry(");
    expect(source).toContain("record_reconciliation_marker(");
    expect(source).toContain("record_reconciliation_marker_at(");
    expect(source).toContain("validate_reconciliation_marker(");
    expect(source).toContain("require_no_reconciliation_marker(");
    expect(source).toContain("lock_transaction_file(");
    expect(source).toContain("flock(transaction_fd, LOCK_EX | LOCK_NB)");
    expect(source).toContain("verify_opened_regular_path(");
    expect(source).toContain("verify-into-category");
    expect(source).toContain("journal-bound");
    expect(source).toContain("pread(");
    expect(source).toContain("CC_SHA256_Init(");
    expect(source).toContain("digest_matches_with_checkpoint(");
    expect(source).toContain("stat_snapshot_matches(");
    expect(source).toContain("st_mtimespec.tv_nsec");
    expect(source).toContain("st_ctimespec.tv_nsec");
    expect(source).toContain("safe_directory_mode(");
    expect(source).toContain("RECONCILIATION_SUFFIX");
    expect(source).toContain("reconciliation-marker-temp-synced");
    expect(source).toContain("reconciliation-marker-published");
    expect(source).toContain(".zerox-reconciliation-%ld-%08x.tmp");
    expect(source).toMatch(/renameatx_np\(\s*log_fd,\s*temporary_name,\s*log_fd,\s*marker_name,\s*RENAME_EXCL/);
    expect(source).toContain("unlinkat(log_fd, temporary_name, 0)");
    expect(source).not.toContain("unlinkat(log_fd, marker_name, 0)");
    expect(source).toMatch(/record_reconciliation_marker\([^]*open_child_directory\([^]*TRANSACTION_DIRECTORY[^]*verify_directories\([^]*record_reconciliation_marker_at\([^]*verify_directories\(/);
    expect(source).not.toMatch(/\blinkat\(/);
    expect(source).not.toContain("remove-category-duplicate");
    const organizerSource = readFileSync(
      path.join(process.cwd(), "src/main/localFileOrganizer.ts"),
      "utf8",
    );
    expect(organizerSource).not.toContain('child.kill("SIGKILL")');
    expect(organizerSource).not.toMatch(/setTimeout\([^]*10_000/);
    expect(organizerSource).toContain('child.stdin.on("error"');
    expect(organizerSource).toContain("MAX_TRANSACTION_LOG_BYTES");
    expect(organizerSource).toContain("readBoundedFileHandle(");
  });

  it("keeps relative tool overrides portable when no policy exists", () => {
    const directory = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "zerox-safe-fs-portable-")),
    );
    temporaryDirectories.push(directory);
    const executionRoot = path.join(directory, "execution");
    const scriptsRoot = path.join(executionRoot, "scripts");
    const nativeRoot = path.join(executionRoot, "native/macos");
    mkdirSync(scriptsRoot, { recursive: true, mode: 0o700 });
    mkdirSync(nativeRoot, { recursive: true, mode: 0o700 });
    const copiedBuildScript = path.join(scriptsRoot, "build-safe-fs-helper.mjs");
    copyFileSync(
      path.join(process.cwd(), "scripts/build-safe-fs-helper.mjs"),
      copiedBuildScript,
    );
    copyFileSync(
      path.join(process.cwd(), "native/macos/zerox-safe-fs.c"),
      path.join(nativeRoot, "zerox-safe-fs.c"),
    );
    execFileSync(process.execPath, [copiedBuildScript], {
      cwd: executionRoot,
      env: {
        ...process.env,
        CC: "clang",
        SDKROOT: "macosx",
      },
    });
    const helperPath = path.join(
      executionRoot,
      `dist-native/darwin-${process.arch}/zerox-safe-fs`,
    );
    expect(inspectSafeFsHelper(helperPath)).toMatchObject({
      mode: "0755",
      architecture: process.arch,
      minimumSystemVersion: expect.stringMatching(/^12\.0/),
      linkedLibraries: ["/usr/lib/libSystem.B.dylib"],
    });
  });

  it("rejects candidate-controlled compiler and SDK overrides", () => {
    const directory = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "zerox-safe-fs-toolchain-")),
    );
    temporaryDirectories.push(directory);
    const executionRoot = path.join(directory, "execution");
    const scriptsRoot = path.join(executionRoot, "scripts");
    mkdirSync(scriptsRoot, { recursive: true, mode: 0o700 });
    const copiedBuildScript = path.join(scriptsRoot, "build-safe-fs-helper.mjs");
    copyFileSync(
      path.join(process.cwd(), "scripts/build-safe-fs-helper.mjs"),
      copiedBuildScript,
    );
    const fakeCompiler = path.join(executionRoot, "clang");
    const fakeSdk = path.join(executionRoot, "MacOSX.sdk");
    writeFileSync(fakeCompiler, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    mkdirSync(fakeSdk, { mode: 0o700 });
    const policyInput = {
      schemaVersion: 1,
      kind: "v3.9.2-pinned-safe-fs-toolchain",
      compiler: {
        configuredPath: "/Library/Developer/CommandLineTools/usr/bin/clang",
        canonicalPath: "/Library/Developer/CommandLineTools/usr/bin/clang",
        digest:
          "sha256:f30550eab15fdf5ab8c0dc54c52679711241e5d4b636b027e18c09fef531775d",
      },
      sdk: {
        configuredPath: "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk",
        canonicalPath:
          "/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk",
        settingsDigest:
          "sha256:f8d005f09381389167f9e0aeaa169bc9e7dff162ef22ca2fd8e98df7ff1acafe",
      },
      safeFsHelperDigest:
        "sha256:58b2493f585d2bc814ff44092fdde3b3debb793ea715a4a14b7fc638b0c04ad6",
    };
    const policy = {
      ...policyInput,
      digest: `sha256:${createHash("sha256")
        .update(Buffer.from(canonicalJson(policyInput)))
        .digest("hex")}`,
    };
    writeFileSync(
      path.join(directory, ".v392-pinned-safe-fs-toolchain.json"),
      `${JSON.stringify(policy, null, 2)}\n`,
      { mode: 0o600 },
    );
    const build = (environment: NodeJS.ProcessEnv) => execFileSync(
      process.execPath,
      [copiedBuildScript],
      {
        cwd: executionRoot,
        env: { ...process.env, ...environment },
        stdio: "pipe",
      },
    );

    expect(() => build({ CC: fakeCompiler })).toThrow();
    expect(() => build({ SDKROOT: fakeSdk })).toThrow();
  });

  it("requires hardened signing and an empty entitlement set", () => {
    const directory = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "zerox-safe-fs-signature-")),
    );
    temporaryDirectories.push(directory);
    const helperPath = path.join(directory, "zerox-safe-fs");
    copyFileSync(
      path.join(process.cwd(), `dist-native/darwin-${process.arch}/zerox-safe-fs`),
      helperPath,
    );
    chmodSync(helperPath, 0o755);
    execFileSync("/usr/bin/codesign", [
      "--force",
      "--sign",
      "-",
      "--timestamp=none",
      "--options",
      "runtime",
      "--entitlements",
      path.join(process.cwd(), "build/entitlements.safe-fs.plist"),
      helperPath,
    ]);

    expect(inspectSafeFsHelper(helperPath, { requireSignature: true }))
      .toMatchObject({
        signatureVerified: true,
        hardenedRuntime: true,
        entitlements: "empty",
      });

    const expandedEntitlements = path.join(directory, "expanded.plist");
    const emptyEntitlements = readFileSync(
      path.join(process.cwd(), "build/entitlements.safe-fs.plist"),
      "utf8",
    );
    const expanded = emptyEntitlements.replace(
      "<dict>\n</dict>",
      "<dict>\n<key>com.apple.security.network.client</key>\n<true/>\n</dict>",
    );
    // The fixture is created inside a disposable test directory and never
    // enters a package or source manifest.
    writeFileSync(expandedEntitlements, expanded);
    execFileSync("/usr/bin/codesign", [
      "--force",
      "--sign",
      "-",
      "--timestamp=none",
      "--options",
      "runtime",
      "--entitlements",
      expandedEntitlements,
      helperPath,
    ]);
    expect(() => inspectSafeFsHelper(helperPath, { requireSignature: true }))
      .toThrow("empty entitlement set");
  });
});

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
