import { execFileSync, spawnSync } from "node:child_process";
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
// @ts-expect-error Local toolchain selection intentionally remains executable JavaScript.
import * as safeFsToolchain from "../../scripts/safe-fs-toolchain-selection.mjs";

const {
  EXPECTED_SAFE_FS_COMPILER,
  EXPECTED_SAFE_FS_HELPER_DIGEST,
  EXPECTED_SAFE_FS_SDK,
  hashCanonicalSafeFsToolchainPolicy,
  loadPinnedSafeFsToolchainPolicy,
  selectSafeFsToolchain,
} = safeFsToolchain;

describe.skipIf(process.platform !== "darwin")("safe-fs helper inspection", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps the complete safe-fs toolchain boundary in the active P113 roster", () => {
    const featureList = JSON.parse(readFileSync(
      path.join(process.cwd(), ".zerox/feature_list.json"),
      "utf8",
    ));
    const p113 = featureList.features.find(
      (feature: { id?: string }) =>
        feature.id === "P113-v3.9.2-disclosure-adversarial-acceptance",
    );

    expect(p113?.files).toEqual(expect.arrayContaining([
      "native/macos/zerox-safe-fs.c",
      "scripts/build-safe-fs-helper.mjs",
      "scripts/safe-fs-toolchain-selection.mjs",
      "scripts/inspect-safe-fs-helper.mjs",
      "src/shared/safeFsHelperInspection.test.ts",
    ]));
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
    expect(buildSource).toContain("loadPinnedSafeFsToolchainPolicy(root)");
    expect(buildSource).toContain("selectSafeFsToolchain({");
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

  it("keeps unpinned tool selection portable without host side effects", () => {
    const calls: string[][] = [];
    const selected = selectSafeFsToolchain({
      policy: null,
      environment: { CC: "clang", SDKROOT: "macosx" },
      resolveXcrun: (args: string[]) => {
        calls.push(args);
        return args[0] === "--find"
          ? EXPECTED_SAFE_FS_COMPILER.configuredPath
          : EXPECTED_SAFE_FS_SDK.configuredPath;
      },
    });

    expect(calls).toEqual([
      ["--find", "clang"],
      ["--show-sdk-path"],
    ]);
    expect(selected).toEqual({
      configuredCompiler: EXPECTED_SAFE_FS_COMPILER.configuredPath,
      configuredSdkRoot: EXPECTED_SAFE_FS_SDK.configuredPath,
    });
  });

  it("does not parse successful otool stderr diagnostics as libraries", () => {
    const helperPath = path.join(
      process.cwd(),
      `dist-native/darwin-${process.arch}/zerox-safe-fs`,
    );
    const inspected = inspectSafeFsHelper(helperPath, {
      run: (command: string, args: string[]) => {
        const result = spawnSync(command, args, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
        if (command !== "/usr/bin/otool" || result.status !== 0) return result;
        return {
          ...result,
          stderr: `${result.stderr ?? ""}otool: error: couldn't create cache file '/private/tmp/xcrun_db-denied'\n`,
        };
      },
    });

    expect(inspected.linkedLibraries).toEqual([
      "/usr/lib/libSystem.B.dylib",
    ]);
  });

  it("discovers and fail-closes the caller-owned toolchain policy", () => {
    const directory = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "zerox-safe-fs-toolchain-")),
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
      path.join(process.cwd(), "scripts/safe-fs-toolchain-selection.mjs"),
      path.join(scriptsRoot, "safe-fs-toolchain-selection.mjs"),
    );
    copyFileSync(
      path.join(process.cwd(), "native/macos/zerox-safe-fs.c"),
      path.join(nativeRoot, "zerox-safe-fs.c"),
    );
    const policyInput = {
      schemaVersion: 1,
      kind: "v3.9.2-pinned-safe-fs-toolchain",
      compiler: EXPECTED_SAFE_FS_COMPILER,
      sdk: EXPECTED_SAFE_FS_SDK,
      safeFsHelperDigest: EXPECTED_SAFE_FS_HELPER_DIGEST,
    };
    const policy = {
      ...policyInput,
      digest: hashCanonicalSafeFsToolchainPolicy(policyInput),
    };
    const policyPath = path.join(
      directory,
      ".v392-pinned-safe-fs-toolchain.json",
    );
    writeFileSync(
      policyPath,
      `${JSON.stringify(policy, null, 2)}\n`,
      { mode: 0o600 },
    );
    const loaded = loadPinnedSafeFsToolchainPolicy(executionRoot);
    const resolveXcrun = () => {
      throw new Error("pinned selection must not invoke xcrun");
    };

    expect(selectSafeFsToolchain({
      policy: loaded,
      environment: {},
      resolveXcrun,
    })).toEqual({
      configuredCompiler: EXPECTED_SAFE_FS_COMPILER.configuredPath,
      configuredSdkRoot: EXPECTED_SAFE_FS_SDK.configuredPath,
    });
    expect(selectSafeFsToolchain({
      policy: loaded,
      environment: {
        CC: EXPECTED_SAFE_FS_COMPILER.configuredPath,
        SDKROOT: EXPECTED_SAFE_FS_SDK.configuredPath,
      },
      resolveXcrun,
    })).toEqual({
      configuredCompiler: EXPECTED_SAFE_FS_COMPILER.configuredPath,
      configuredSdkRoot: EXPECTED_SAFE_FS_SDK.configuredPath,
    });
    expect(() => selectSafeFsToolchain({
      policy: loaded,
      environment: { CC: "clang" },
      resolveXcrun,
    })).toThrowError("CC differs from the caller-reviewed compiler path");
    expect(() => selectSafeFsToolchain({
      policy: loaded,
      environment: { SDKROOT: "macosx" },
      resolveXcrun,
    })).toThrowError("SDKROOT differs from the caller-reviewed SDK path");

    const build = (environment: NodeJS.ProcessEnv) => execFileSync(
      process.execPath,
      [copiedBuildScript],
      {
        cwd: executionRoot,
        env: { ...process.env, ...environment },
        stdio: "pipe",
      },
    );
    build({
      CC: EXPECTED_SAFE_FS_COMPILER.configuredPath,
      SDKROOT: EXPECTED_SAFE_FS_SDK.configuredPath,
    });
    expect(inspectSafeFsHelper(path.join(
      executionRoot,
      `dist-native/darwin-${process.arch}/zerox-safe-fs`,
    ))).toMatchObject({
      mode: "0755",
      architecture: process.arch,
      minimumSystemVersion: expect.stringMatching(/^12\.0/),
      linkedLibraries: ["/usr/lib/libSystem.B.dylib"],
    });
    expect(() => build({ CC: "clang" }))
      .toThrowError(/CC differs from the caller-reviewed compiler path/);
    expect(() => build({ SDKROOT: "macosx" }))
      .toThrowError(/SDKROOT differs from the caller-reviewed SDK path/);

    writeFileSync(
      policyPath,
      `${JSON.stringify({ ...policy, digest: `sha256:${"0".repeat(64)}` })}\n`,
      { mode: 0o600 },
    );
    expect(() => loadPinnedSafeFsToolchainPolicy(executionRoot))
      .toThrowError("caller-owned safe-fs toolchain policy is invalid");

    const tamperedPolicyInput = {
      ...policyInput,
      compiler: {
        ...policyInput.compiler,
        canonicalPath: "/tmp/unreviewed-clang",
      },
    };
    writeFileSync(
      policyPath,
      `${JSON.stringify({
        ...tamperedPolicyInput,
        digest: hashCanonicalSafeFsToolchainPolicy(tamperedPolicyInput),
      })}\n`,
      { mode: 0o600 },
    );
    expect(() => loadPinnedSafeFsToolchainPolicy(executionRoot))
      .toThrowError("caller-owned safe-fs toolchain policy is invalid");
  });

  it("loads the external runner's generated toolchain policy with the production parser", () => {
    const directory = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "zerox-safe-fs-runner-policy-")),
    );
    temporaryDirectories.push(directory);
    const executionRoot = path.join(directory, "execution");
    mkdirSync(executionRoot, { recursive: true, mode: 0o700 });
    const policy = execFileSync(
      process.execPath,
      [
        "scripts/build-v392-acceptance-anchor.mjs",
        "--self-test-safe-fs-toolchain-policy",
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    writeFileSync(
      path.join(directory, ".v392-pinned-safe-fs-toolchain.json"),
      policy,
      { mode: 0o600 },
    );

    expect(loadPinnedSafeFsToolchainPolicy(executionRoot)).toMatchObject({
      schemaVersion: 1,
      kind: "v3.9.2-pinned-safe-fs-toolchain",
      safeFsHelperDigest: EXPECTED_SAFE_FS_HELPER_DIGEST,
    });
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
