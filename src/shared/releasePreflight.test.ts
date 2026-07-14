import { createHash } from "node:crypto";
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
import { describe, expect, it } from "vitest";

// The release gate stays executable as plain Node.js while exporting its
// artifact inspector for deterministic fixture tests.
// @ts-expect-error JavaScript release script intentionally has no declaration file.
import { createAppBundleDigest, inspectReleaseArtifacts } from "../../scripts/release-preflight.mjs";

function sha512(value: string): string {
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
  mkdirSync(releaseDir);
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

  writeFileSync(
    path.join(releaseDir, "latest-mac.yml"),
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

  return rootDir;
}

describe("macOS release preflight artifacts", () => {
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
