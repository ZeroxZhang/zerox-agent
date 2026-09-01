import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
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
