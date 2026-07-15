import {
  createHash,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { blake2b } from "@noble/hashes/blake2.js";
import { stringify } from "yaml";
import { createPackage } from "@electron/asar";
import { describe, expect, it } from "vitest";

// The release gate stays executable as plain Node.js while exporting its
// artifact inspector for deterministic fixture tests.
// @ts-expect-error JavaScript release script intentionally has no declaration file.
import * as releasePreflight from "../../scripts/release-preflight.mjs";

const {
  createAppBundleDigest,
  inspectReleaseArtifacts,
  resolveReleaseMode,
  validateBundleContentConsistency,
  validateLegacyAdhocRequirementOutput,
  validatePackagedBuildMetadata,
  validateReleaseContainerRoot,
} = releasePreflight;

const signatureDomain = Buffer.from(
  "ZEROX_AGENT_UPDATE_MANIFEST\0V2\0ZeroxZhang/zerox-agent\0darwin\0stable\0",
  "utf8",
);

function sha512(value: string | Buffer): string {
  return createHash("sha512").update(value).digest("base64");
}

function blockmapChecksum(value: string): string {
  return Buffer.from(blake2b(Buffer.from(value), { dkLen: 18 })).toString("base64");
}

function createReleaseFixture(
  options: { unsafeNames?: boolean; corruptHash?: boolean; corruptBlockmap?: boolean } = {},
) {
  const rootDir = mkdtempSync(path.join(tmpdir(), "zerox-release-preflight-"));
  const releaseDir = path.join(rootDir, "release");
  const buildDir = path.join(rootDir, "build");
  mkdirSync(releaseDir);
  mkdirSync(buildDir);
  writeFileSync(path.join(rootDir, "package.json"), JSON.stringify({ version: "3.7.1" }));

  const zipName = options.unsafeNames
    ? "Zerox Agent-3.7.1-arm64-mac.zip"
    : "Zerox-Agent-3.7.1-arm64.zip";
  const dmgName = options.unsafeNames
    ? "Zerox Agent-3.7.1-arm64.dmg"
    : "Zerox-Agent-3.7.1-arm64.dmg";
  const zipBody = "zip-body";
  const dmgBody = "dmg-body";

  for (const [name, body] of [
    [zipName, zipBody],
    [dmgName, dmgBody],
  ] as const) {
    writeFileSync(path.join(releaseDir, name), body);
    writeFileSync(
      path.join(releaseDir, `${name}.blockmap`),
      options.corruptBlockmap
        ? "not-gzip"
        : gzipSync(
            JSON.stringify({
              version: "2",
              files: [
                {
                  name: "file",
                  offset: 0,
                  checksums: [blockmapChecksum(body)],
                  sizes: [Buffer.byteLength(body)],
                },
              ],
            }),
          ),
    );
  }

  const manifestBytes = Buffer.from(
    stringify({
      version: "3.7.1",
      files: [
        {
          url: zipName,
          sha512: options.corruptHash ? "invalid" : sha512(zipBody),
          size: Buffer.byteLength(zipBody),
        },
        {
          url: dmgName,
          sha512: sha512(dmgBody),
          size: Buffer.byteLength(dmgBody),
        },
      ],
      path: zipName,
      sha512: options.corruptHash ? "invalid" : sha512(zipBody),
    }),
  );
  writeFileSync(path.join(releaseDir, "latest-mac.yml"), manifestBytes);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" });
  writeFileSync(
    path.join(buildDir, "update-signing-public-key.pem"),
    publicKeyPem,
  );
  const publicDer = publicKey.export({ format: "der", type: "spki" });
  const keyId = createHash("sha256")
    .update(publicDer)
    .digest("hex")
    .slice(0, 32);
  const tag = "v3.7.1";
  const sequence = 3_007_001;
  const issuedAt = new Date(Date.now() - 60_000).toISOString();
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000 - 60_000).toISOString();
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(manifestBytes.length));
  const signature = sign(
    null,
    Buffer.concat([
      signatureDomain,
      Buffer.from(`${keyId}\0${tag}\0${sequence}\0${issuedAt}\0${expiresAt}\0`),
      length,
      manifestBytes,
    ]),
    privateKey,
  );
  writeFileSync(
    path.join(releaseDir, "latest-mac.yml.sig"),
    JSON.stringify({
      schema: 2,
      algorithm: "ed25519",
      keyId,
      tag,
      sequence,
      issuedAt,
      expiresAt,
      manifestSha512: sha512(manifestBytes),
      signature: signature.toString("base64"),
    }),
  );

  return rootDir;
}

describe("macOS release preflight artifacts", () => {
  it("defaults to Developer ID releases and requires an explicit legacy override", () => {
    expect(resolveReleaseMode(undefined)).toBe("developer-id");
    expect(resolveReleaseMode("")).toBe("developer-id");
    expect(resolveReleaseMode("developer-id")).toBe("developer-id");
    expect(resolveReleaseMode("legacy-adhoc")).toBe("legacy-adhoc");
    expect(() => resolveReleaseMode("unsigned")).toThrow(
      "ZEROX_RELEASE_MODE must be unset, developer-id, or legacy-adhoc",
    );
  });

  it("requires every packaged application to embed the Git commit and release mode", async () => {
    const expectedBuildCommit = "a".repeat(40);

    async function packagedApp(buildCommit?: string, releaseMode?: string) {
      const fixtureRoot = mkdtempSync(path.join(tmpdir(), "zerox-build-commit-"));
      const sourceDir = path.join(fixtureRoot, "source");
      const appPath = path.join(fixtureRoot, "Zerox Agent.app");
      mkdirSync(sourceDir);
      mkdirSync(path.join(appPath, "Contents", "Resources"), { recursive: true });
      writeFileSync(
        path.join(sourceDir, "package.json"),
        JSON.stringify({
          name: "fixture",
          version: "3.7.1",
          buildCommit,
          releaseMode,
        }),
      );
      await createPackage(
        sourceDir,
        path.join(appPath, "Contents", "Resources", "app.asar"),
      );
      return appPath;
    }

    const matchingErrors: string[] = [];
    validatePackagedBuildMetadata({
      appPath: await packagedApp(expectedBuildCommit, "legacy-adhoc"),
      errors: matchingErrors,
      expectedBuildCommit,
      expectedReleaseMode: "legacy-adhoc",
      label: "matching app",
    });
    expect(matchingErrors).toEqual([]);

    for (const [label, buildCommit, releaseMode, expectedReleaseMode, expectedMessage] of [
      ["missing commit", undefined, "developer-id", "developer-id", "must embed"],
      ["invalid commit", "not-a-commit", "developer-id", "developer-id", "must embed"],
      [
        "stale commit",
        "b".repeat(40),
        "developer-id",
        "developer-id",
        "does not match current Git HEAD",
      ],
      [
        "missing mode",
        expectedBuildCommit,
        undefined,
        "developer-id",
        "releaseMode <missing> does not match requested release mode developer-id",
      ],
      [
        "wrong mode",
        expectedBuildCommit,
        "legacy-adhoc",
        "developer-id",
        "releaseMode legacy-adhoc does not match requested release mode developer-id",
      ],
    ] as const) {
      const errors: string[] = [];
      validatePackagedBuildMetadata({
        appPath: await packagedApp(buildCommit, releaseMode),
        errors,
        expectedBuildCommit,
        expectedReleaseMode,
        label,
      });
      expect(errors.join("\n")).toContain(expectedMessage);
    }
  });

  it("keeps bundle byte consistency mandatory in both release modes", () => {
    for (const releaseMode of ["developer-id", "legacy-adhoc"] as const) {
      const matchingErrors: string[] = [];
      validateBundleContentConsistency({
        bundleSha512: "same-bundle",
        errors: matchingErrors,
        expectedIntegrity: { bundleSha512: "same-bundle" },
        label: `${releaseMode} matching app`,
      });
      expect(matchingErrors).toEqual([]);

      const mismatchErrors: string[] = [];
      validateBundleContentConsistency({
        bundleSha512: "changed-bundle",
        errors: mismatchErrors,
        expectedIntegrity: { bundleSha512: "frozen-bundle" },
        label: `${releaseMode} changed app`,
      });
      expect(mismatchErrors).toEqual([
        `${releaseMode} changed app bundle contents do not match the frozen packaged application`,
      ]);
    }
  });

  it("accepts only the stable cross-version legacy designated requirement", () => {
    const matchingErrors: string[] = [];
    validateLegacyAdhocRequirementOutput({
      errors: matchingErrors,
      label: "matching app",
      output:
        'Executable=/tmp/Zerox Agent.app/Contents/MacOS/Zerox Agent\ndesignated => identifier "local.zerox.agent.desktop"',
    });
    expect(matchingErrors).toEqual([]);

    for (const output of [
      'designated => cdhash H"be373641df5a12774918b5fef1b2f0bab0ad4b1a"',
      'designated => identifier "local.zerox.agent.desktop" and anchor apple generic',
      'designated => identifier "com.example.attacker"',
    ]) {
      const errors: string[] = [];
      validateLegacyAdhocRequirementOutput({
        errors,
        label: "changed app",
        output,
      });
      expect(errors).toEqual([
        "changed app must use the stable legacy designated requirement for local.zerox.agent.desktop",
      ]);
    }
  });

  it("rejects extra payloads at ZIP and DMG container roots", () => {
    const zipRoot = mkdtempSync(path.join(tmpdir(), "zerox-zip-root-"));
    mkdirSync(path.join(zipRoot, "Zerox Agent.app"));
    const zipErrors: string[] = [];
    validateReleaseContainerRoot({
      errors: zipErrors,
      kind: "zip",
      label: "ZIP fixture",
      rootPath: zipRoot,
    });
    expect(zipErrors).toEqual([]);
    writeFileSync(path.join(zipRoot, "payload"), "unexpected");
    validateReleaseContainerRoot({
      errors: zipErrors,
      kind: "zip",
      label: "ZIP fixture",
      rootPath: zipRoot,
    });
    expect(zipErrors).toContain(
      "ZIP fixture ZIP root must contain only Zerox Agent.app",
    );

    const dmgRoot = mkdtempSync(path.join(tmpdir(), "zerox-dmg-root-"));
    mkdirSync(path.join(dmgRoot, "Zerox Agent.app"));
    symlinkSync("/Applications", path.join(dmgRoot, "Applications"));
    writeFileSync(path.join(dmgRoot, "second-app"), "unexpected");
    const dmgErrors: string[] = [];
    validateReleaseContainerRoot({
      errors: dmgErrors,
      kind: "dmg",
      label: "DMG fixture",
      rootPath: dmgRoot,
    });
    expect(dmgErrors).toContain(
      "DMG fixture contains unexpected root entries: second-app",
    );
  });

  it("pins system verification tools and inspects every published app copy", () => {
    const source = readFileSync(
      path.join(process.cwd(), "scripts", "release-preflight.mjs"),
      "utf8",
    );

    expect(source).toContain('codesign: "/usr/bin/codesign"');
    expect(source).toContain('spctl: "/usr/sbin/spctl"');
    expect(source).toContain('stapler: "/usr/bin/stapler"');
    expect(source).toContain('hdiutil: "/usr/bin/hdiutil"');
    expect(source).toContain('"--untracked-files=all"');
    expect(source).toContain('"ls-files",');
    expect(source).toContain('"--ignored",');
    expect(source).toContain('if (key.startsWith("GIT_")) delete env[key]');
    expect(source).toContain('["rev-parse", "--show-toplevel"]');
    expect(source).toContain('"core.fsmonitor=false"');
    expect(source).toContain('["ls-files", "-v"]');
    expect(source).toContain("process.env.APPLE_TEAM_ID");
    expect(source).toContain("TeamIdentifier=${teamId}");
    expect(source).toContain("signed identifier must be local.zerox.agent.desktop");
    expect(source).toContain('["-x", "-k", zipAsset.filePath, zipDirectory]');
    expect(source).toContain('"attach", "-readonly", "-nobrowse"');
    expect(source).toContain("expectedIntegrity: frozenIntegrity");
    expect(source).toContain("sealed CodeResources manifest is missing");
    expect(source).toContain("signed resource seal does not match");
    expect(source).toContain('runGit(["rev-parse", "--verify", "HEAD^{commit}"])');
    expect(source.match(/expectedBuildCommit,/g)?.length).toBeGreaterThanOrEqual(4);
    expect(source.match(/releaseMode,/g)?.length).toBeGreaterThanOrEqual(4);
    expect(source).toContain('if (releaseMode === "developer-id")');
    expect(source).toContain("bundle contents do not match the frozen packaged application");
    expect(source).toContain("return { bundleSha512, cdHash, codeResourcesSha512 }");
  });

  it("hashes physical app bundles while rejecting root and escaping symlinks", async () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), "zerox-app-bundle-"));
    const appPath = path.join(fixtureRoot, "Zerox Agent.app");
    mkdirSync(path.join(appPath, "Contents"), { recursive: true });
    writeFileSync(path.join(appPath, "Contents", "app.asar"), "app");
    symlinkSync("app.asar", path.join(appPath, "Contents", "current.asar"));

    await expect(createAppBundleDigest(appPath)).resolves.toMatch(/^[A-Za-z0-9+/]+={0,2}$/);

    const escapedPath = path.join(fixtureRoot, "Escaped.app");
    mkdirSync(path.join(escapedPath, "Contents"), { recursive: true });
    symlinkSync("/tmp", path.join(escapedPath, "Contents", "outside"));
    await expect(createAppBundleDigest(escapedPath)).rejects.toThrow(
      "application bundle symlink escapes its root",
    );

    const rootLink = path.join(fixtureRoot, "Linked.app");
    symlinkSync(appPath, rootLink);
    await expect(createAppBundleDigest(rootLink)).rejects.toThrow(
      "application bundle root must be a physical directory",
    );
  });

  it("accepts exact updater-safe assets with matching hashes and blockmaps", async () => {
    const manifest = await inspectReleaseArtifacts(createReleaseFixture());

    expect(manifest.version).toBe("3.7.1");
    expect(manifest.assets.map((asset: { url: string }) => asset.url)).toEqual([
      "Zerox-Agent-3.7.1-arm64.zip",
      "Zerox-Agent-3.7.1-arm64.dmg",
    ]);
    expect(manifest.appPath).toContain("release/mac-arm64/Zerox Agent.app");
  });

  it("rejects names that diverge from the update metadata publication contract", async () => {
    await expect(inspectReleaseArtifacts(createReleaseFixture({ unsafeNames: true }))).rejects.toThrow(
      "release asset URL must use the updater-safe name",
    );
  });

  it("rejects release bytes that do not match latest-mac.yml", async () => {
    await expect(inspectReleaseArtifacts(createReleaseFixture({ corruptHash: true }))).rejects.toThrow(
      "SHA-512 does not match latest-mac.yml",
    );
  });

  it("rejects malformed blockmaps before publication", async () => {
    await expect(
      inspectReleaseArtifacts(createReleaseFixture({ corruptBlockmap: true })),
    ).rejects.toThrow("blockmap is not valid gzip-compressed JSON");
  });

  it("rejects a structurally valid blockmap whose checksum does not match the asset", async () => {
    const rootDir = createReleaseFixture();
    writeFileSync(
      path.join(rootDir, "release", "Zerox-Agent-3.7.1-arm64.zip.blockmap"),
      gzipSync(
        JSON.stringify({
          version: "2",
          files: [
            {
              name: "file",
              offset: 0,
              checksums: ["AAAAAAAAAAAAAAAAAAAAAAAA"],
              sizes: [Buffer.byteLength("zip-body")],
            },
          ],
        }),
      ),
    );

    await expect(inspectReleaseArtifacts(rootDir)).rejects.toThrow(
      "blockmap checksum mismatch",
    );
  });

  it("rejects blockmap gaps even when the final covered byte matches the asset size", async () => {
    const rootDir = createReleaseFixture();
    const zipBlockmap = path.join(
      rootDir,
      "release",
      "Zerox-Agent-3.7.1-arm64.zip.blockmap",
    );
    writeFileSync(
      zipBlockmap,
      gzipSync(
        JSON.stringify({
          version: "2",
          files: [
            {
              name: "file",
              offset: 1,
              checksums: ["AAAAAAAAAAAAAAAAAAAAAAAA"],
              sizes: [7],
            },
          ],
        }),
      ),
    );

    await expect(inspectReleaseArtifacts(rootDir)).rejects.toThrow(
      "blockmap has a gap or overlap",
    );
  });
});
