import { spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBlockMap } from "app-builder-lib/out/targets/blockmap/blockmap.js";
import { parse, stringify } from "yaml";

const defaultRootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dittoBin = "/usr/bin/ditto";
const productName = "Zerox Agent";

function fail(message) {
  throw new Error(`macOS ZIP finalization failed: ${message}`);
}

function expectedAppDirectory(releaseDir, arch) {
  if (arch === "x64") return join(releaseDir, "mac", `${productName}.app`);
  return join(releaseDir, `mac-${arch}`, `${productName}.app`);
}

export async function finalizeMacZip(rootDir = defaultRootDir) {
  if (process.platform !== "darwin") {
    fail("ditto packaging is only available on macOS");
  }

  const packageJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
  const version = packageJson.version;
  if (typeof version !== "string" || version.length === 0) {
    fail("package.json does not declare a version");
  }

  const releaseDir = join(rootDir, "release");
  const metadataPath = join(releaseDir, "latest-mac.yml");
  const metadata = parse(readFileSync(metadataPath, "utf8"));
  const zipEntries = Array.isArray(metadata?.files)
    ? metadata.files.filter((entry) => typeof entry?.url === "string" && entry.url.endsWith(".zip"))
    : [];
  if (zipEntries.length !== 1) {
    fail("latest-mac.yml must contain exactly one ZIP entry");
  }

  const zipEntry = zipEntries[0];
  const match = new RegExp(
    `^Zerox-Agent-${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(arm64|x64|universal)\\.zip$`,
  ).exec(zipEntry.url);
  if (!match) {
    fail("latest-mac.yml contains an unsafe or unexpected ZIP name");
  }

  const appPath = expectedAppDirectory(releaseDir, match[1]);
  if (!existsSync(appPath)) {
    fail(`unpacked app is missing: ${appPath}`);
  }

  const zipPath = join(releaseDir, zipEntry.url);
  const blockmapPath = `${zipPath}.blockmap`;
  const temporaryZipPath = `${zipPath}.ditto-tmp`;
  const temporaryBlockmapPath = `${blockmapPath}.ditto-tmp`;
  const temporaryMetadataPath = `${metadataPath}.ditto-tmp`;
  rmSync(temporaryZipPath, { force: true });
  rmSync(temporaryBlockmapPath, { force: true });
  rmSync(temporaryMetadataPath, { force: true });

  try {
    const result = spawnSync(
      dittoBin,
      ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, temporaryZipPath],
      { cwd: rootDir, encoding: "utf8" },
    );
    if (result.error || result.status !== 0 || !existsSync(temporaryZipPath)) {
      fail(result.error?.message || result.stderr?.trim() || "ditto did not create the ZIP");
    }

    const blockmap = await buildBlockMap(
      temporaryZipPath,
      "gzip",
      temporaryBlockmapPath,
    );
    if (!existsSync(temporaryBlockmapPath) || statSync(temporaryBlockmapPath).size === 0) {
      fail("blockmap generation produced no output");
    }

    renameSync(temporaryZipPath, zipPath);
    renameSync(temporaryBlockmapPath, blockmapPath);
    zipEntry.size = blockmap.size;
    zipEntry.sha512 = blockmap.sha512;
    metadata.path = zipEntry.url;
    metadata.sha512 = blockmap.sha512;
    writeFileSync(temporaryMetadataPath, stringify(metadata), "utf8");
    renameSync(temporaryMetadataPath, metadataPath);
  } finally {
    rmSync(temporaryZipPath, { force: true });
    rmSync(temporaryBlockmapPath, { force: true });
    rmSync(temporaryMetadataPath, { force: true });
  }

  console.log(`Rebuilt ${zipEntry.url} with ditto and regenerated its blockmap.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await finalizeMacZip();
}
